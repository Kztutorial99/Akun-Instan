const crypto = require("crypto");
const { db, ensureTables, currentUser, bodyOf, text } = require("./_users");
const { createNotification } = require("./_notifications");
const { handleNotifications } = require("./_notifications_handler");
const { handleStream } = require("./_stream");
const wijayapay = require("./_wijayapay");
const { once } = require("./_schema");

const MIN_TOPUP = 10000;
/* Bonus saldo per nominal top up (mengikuti tampilan halaman Top Up). */
const TOPUP_BONUS_TIERS = [
  { amount: 10000, bonus: 0 },
  { amount: 25000, bonus: 2000 },
  { amount: 50000, bonus: 4000 },
  { amount: 100000, bonus: 8000 },
  { amount: 250000, bonus: 20000 },
  { amount: 500000, bonus: 45000 },
];
const topupBonus = (value) => {
  const v = Math.round(Number(value) || 0);
  let bonus = 0;
  for (const t of TOPUP_BONUS_TIERS) if (v >= t.amount) bonus = t.bonus;
  return bonus;
};
const MAX_TOPUP = 20000000;
const METHOD_LABEL = "QRIS · WijayaPay";

/** Kolom tambahan untuk pembayaran QRIS otomatis (idempotent). */
const ensurePaymentColumns = once(async function ensurePaymentColumnsUncached(sql) {
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS trx_reference TEXT`;
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS qr_string TEXT`;
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS qr_image TEXT`;
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS total_fee BIGINT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ`;
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS codexa_topups_reference_idx ON codexa_topups (reference)`;
});

const rupiah = (n) => `Rp${(Number(n) || 0).toLocaleString("id-ID")}`;

/**
 * Tandai satu top up sebagai lunas dan tambah saldo user — aman dipanggil
 * berkali-kali (callback + polling bisa datang bersamaan).
 */
async function settlePaid(sql, refId) {
  const claimed = await sql`
    UPDATE codexa_topups SET status = 'approved', reviewed_at = NOW(), paid_at = NOW()
    WHERE reference = ${refId} AND status = 'pending'
    RETURNING id, user_id AS "userId", amount
  `;
  if (!claimed.length) return { credited: false };
  const row = claimed[0];
  const amount = Number(row.amount) || 0;
  const bonus = topupBonus(amount);
  const credit = amount + bonus;
  const [user] = await sql`
    UPDATE codexa_users SET balance = balance + ${credit} WHERE id = ${row.userId}
    RETURNING id, name, email, balance
  `;

  await createNotification(sql, {
    userId: row.userId,
    type: "topup_approved",
    title: "Top up berhasil",
    body: `Pembayaran QRIS ${rupiah(amount)} sudah diterima${bonus ? ` + bonus ${rupiah(bonus)}` : ""}, saldo kamu langsung bertambah ${rupiah(credit)}.`,
    link: "topup",
  });

  return { credited: true, amount, balance: user ? Number(user.balance) || 0 : null };
}

/** Tandai kedaluwarsa (tanpa menambah saldo). */
async function settleExpired(sql, refId) {
  await sql`
    UPDATE codexa_topups SET status = 'rejected', reviewed_at = NOW()
    WHERE reference = ${refId} AND status = 'pending'
  `;
}

/** Webhook WijayaPay — dipanggil tanpa sesi login, diverifikasi via X-Signature. */
async function handleCallback(sql, request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }
  const body = bodyOf(request);
  const data = (body && body.data) || {};
  const refId = text(data.ref_id || body.ref_id, 120);
  const status = String(body.status || data.status || "").toLowerCase();
  const provided =
    request.headers["x-signature"] || request.headers["X-Signature"] || (body && body.signature) || "";

  if (!refId) return response.status(400).json({ error: "ref_id tidak ada" });
  if (!wijayapay.signatureValid(refId, provided)) {
    console.error("WijayaPay callback signature invalid", refId);
    return response.status(401).json({ error: "Signature tidak valid" });
  }

  const mapped = wijayapay.mapStatus(status);
  if (mapped === "approved") {
    if (data.trx_reference) {
      await sql`UPDATE codexa_topups SET trx_reference = ${text(data.trx_reference, 120)} WHERE reference = ${refId}`;
    }
    await settlePaid(sql, refId);
  } else if (mapped === "rejected") {
    await settleExpired(sql, refId);
  }
  return response.status(200).json({ ok: true });
}

module.exports = async function handler(request, response) {
  try {
    const sql = db();
    await ensureTables(sql);
    await ensurePaymentColumns(sql);

    // Rewrite Vercel: beberapa endpoint dilayani file ini (batas function Hobby).
    const resource = (request.query && request.query.resource) || "";
    if (resource === "callback") return handleCallback(sql, request, response);

    const user = await currentUser(sql, request);
    if (!user) return response.status(401).json({ error: "Silakan masuk terlebih dahulu" });

    if (resource === "notifications") return handleNotifications(sql, user, request, response);

    // Saluran dorong real-time (SSE) untuk lonceng, saldo, dan status top up.
    if (resource === "stream") return handleStream(sql, user, request, response);

    // Cek status pembayaran QRIS milik user (dipakai polling di halaman top up).
    if (resource === "status") {
      const refId = text((request.query && (request.query.ref || request.query.reference)) || "", 120);
      if (!refId) return response.status(400).json({ error: "ref_id wajib diisi" });
      const [row] = await sql`
        SELECT id, status, amount FROM codexa_topups
        WHERE reference = ${refId} AND user_id = ${user.id} LIMIT 1
      `;
      if (!row) return response.status(404).json({ error: "Transaksi tidak ditemukan" });
      if (row.status !== "pending") {
        const [fresh] = await sql`SELECT balance FROM codexa_users WHERE id = ${user.id} LIMIT 1`;
        return response.status(200).json({
          status: row.status === "approved" ? "paid" : "expired",
          balance: Number(fresh && fresh.balance) || 0,
        });
      }
      let gateway = { status: "pending" };
      try {
        gateway = await wijayapay.checkQrisStatus(refId);
      } catch (statusError) {
        console.error("WijayaPay status failure", statusError && statusError.message);
        return response.status(200).json({ status: "pending", pendingCheck: false });
      }
      const mapped = wijayapay.mapStatus(gateway.status);
      if (mapped === "approved") await settlePaid(sql, refId);
      else if (mapped === "rejected") await settleExpired(sql, refId);
      const [fresh] = await sql`SELECT balance FROM codexa_users WHERE id = ${user.id} LIMIT 1`;
      return response.status(200).json({
        status: mapped === "approved" ? "paid" : mapped === "rejected" ? "expired" : "pending",
        balance: Number(fresh && fresh.balance) || 0,
      });
    }

    // Ambil ulang QR pembayaran yang masih menunggu (tombol "Lihat QR").
    if (resource === "qr") {
      const refId = text((request.query && (request.query.ref || request.query.reference)) || "", 120);
      if (!refId) return response.status(400).json({ error: "ref_id wajib diisi" });
      const [row] = await sql`
        SELECT amount, status, reference, qr_string AS "qrString", qr_image AS "qrImage",
               trx_reference AS "trxReference", expired_at AS "expiredAt"
        FROM codexa_topups WHERE reference = ${refId} AND user_id = ${user.id} LIMIT 1
      `;
      if (!row) return response.status(404).json({ error: "Transaksi tidak ditemukan" });
      if (row.status !== "pending") return response.status(409).json({ error: "Pembayaran ini sudah selesai" });
      return response.status(200).json({
        payment: {
          refId: row.reference,
          trxReference: row.trxReference,
          qrImage: row.qrImage,
          qrString: row.qrString,
          totalBayar: Number(row.amount) || 0,
          expired: row.expiredAt,
        },
      });
    }


    if (request.method === "GET") {
      const rows = await sql`
        SELECT id, amount, method, reference, note, status, trx_reference AS "trxReference",
               created_at AS "createdAt", reviewed_at AS "reviewedAt", paid_at AS "paidAt"
        FROM codexa_topups WHERE user_id = ${user.id}
        ORDER BY created_at DESC LIMIT 30
      `;
      const [agg] = await sql`
        SELECT COALESCE(SUM(amount), 0)::bigint AS "pendingTotal", COUNT(*)::int AS "pendingCount"
        FROM codexa_topups WHERE user_id = ${user.id} AND status = 'pending'
      `;
      return response.status(200).json({
        balance: user.balance,
        pendingTotal: Number(agg && agg.pendingTotal) || 0,
        pendingCount: Number(agg && agg.pendingCount) || 0,
        bonusTiers: TOPUP_BONUS_TIERS,
        minTopup: MIN_TOPUP,
        topups: rows.map((r) => ({ ...r, amount: Number(r.amount) || 0 })),
      });
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST");
      return response.status(405).json({ error: "Method not allowed" });
    }

    // ── Buat pembayaran QRIS baru lewat WijayaPay ──
    if (!wijayapay.configured()) {
      return response.status(503).json({ error: "Pembayaran QRIS belum aktif, hubungi admin" });
    }

    const body = bodyOf(request);
    const amount = Math.round(Number(body.amount) || 0);
    const note = text(body.note, 300);

    if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
      return response.status(400).json({ error: `Minimal top up ${rupiah(MIN_TOPUP)}` });
    }
    if (amount > MAX_TOPUP) return response.status(400).json({ error: "Nominal top up terlalu besar" });

    const pending = await sql`
      SELECT COUNT(*)::int AS total FROM codexa_topups WHERE user_id = ${user.id} AND status = 'pending'
    `;
    if ((pending[0] && pending[0].total) >= 3) {
      return response.status(429).json({ error: "Masih ada 3 pembayaran QRIS yang belum selesai" });
    }

    const refId = wijayapay.newRefId();
    let payment;
    try {
      payment = await wijayapay.createQrisTransaction({ refId, amount });
    } catch (createError) {
      console.error("WijayaPay create failure", createError && createError.message);
      return response.status(502).json({ error: createError.message || "Gagal membuat QRIS pembayaran" });
    }

    const rows = await sql`
      INSERT INTO codexa_topups (id, user_id, amount, method, reference, note,
                                 trx_reference, qr_string, qr_image, total_fee, expired_at)
      VALUES (${crypto.randomUUID()}, ${user.id}, ${payment.totalBayar || amount}, ${METHOD_LABEL},
              ${refId}, ${note}, ${payment.trxReference}, ${payment.qrString}, ${payment.qrImage},
              ${payment.totalFee || 0}, ${payment.expired ? new Date(payment.expired) : null})
      RETURNING id, amount, method, reference, note, status, created_at AS "createdAt"
    `;
    const topup = { ...rows[0], amount: Number(rows[0].amount) || 0 };

    await createNotification(sql, {
      userId: user.id,
      type: "topup_pending",
      title: "QRIS pembayaran dibuat",
      body: `Selesaikan pembayaran QRIS ${rupiah(topup.amount)}. Saldo bertambah otomatis setelah pembayaran terverifikasi.`,
      link: "topup",
    });

    return response.status(201).json({
      topup,
      payment: {
        refId,
        trxReference: payment.trxReference,
        qrImage: payment.qrImage,
        qrString: payment.qrString,
        totalBayar: payment.totalBayar || amount,
        totalFee: payment.totalFee,
        expired: payment.expired,
        paymentName: payment.paymentName,
      },
    });
  } catch (error) {
    console.error("Topup failure", error && error.message);
    return response.status(500).json({ error: "Permintaan top up gagal diproses" });
  }
};
