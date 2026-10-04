const { db, ensureTables, hashPassword, bodyOf, text } = require("../_users");
const { isAdmin } = require("./_auth");
const { handleAdminCheckin } = require("../_checkin");
const { ensureNotificationTables, createNotification, broadcastNotification } = require("../_notifications");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = ["active", "suspended", "banned"];
const ROLES = ["user", "admin"];

module.exports = async function handler(request, response) {
  if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });
  try {
    const sql = db();
    await ensureTables(sql);

    /* ── SEND CHAT & NOTIFIKASI (admin → user) ── */
    const notifyAction = request.query && typeof request.query.action === "string" ? request.query.action : "";
    if (notifyAction === "checkin") return handleAdminCheckin(sql, request, response);
    if (notifyAction === "notify") {
      await ensureNotificationTables(sql);
      if (request.method === "GET") {
        const history = await sql`
          SELECT n.title, n.body, n.type, n.link, MIN(n.created_at) AS "createdAt", COUNT(*)::int AS recipients,
                 COUNT(n.read_at)::int AS "readCount",
                 CASE WHEN COUNT(*) = 1 THEN MAX(u.email) ELSE NULL END AS "toEmail",
                 CASE WHEN COUNT(*) = 1 THEN MAX(u.name) ELSE NULL END AS "toName"
          FROM codexa_notifications n LEFT JOIN codexa_users u ON u.id = n.user_id
          WHERE n.type IN ('admin_msg','admin_info','admin_promo','admin_warn')
          GROUP BY n.title, n.body, n.type, n.link, date_trunc('second', n.created_at)
          ORDER BY MIN(n.created_at) DESC LIMIT 40
        `;
        return response.status(200).json({ history });
      }
      if (request.method === "POST") {
        const body = bodyOf(request);
        const title = text(body.title, 160);
        const message = text(body.body, 600);
        const kind = ["admin_msg", "admin_info", "admin_promo", "admin_warn"].includes(body.type) ? body.type : "admin_msg";
        const link = ["", "katalog", "topup", "orders", "reports", "notifications"].includes(body.link) ? body.link : "";
        if (title.length < 2) return response.status(400).json({ error: "Judul wajib diisi" });
        if (body.target === "all") {
          const sent = await broadcastNotification(sql, { type: kind, title, body: message, link });
          return response.status(200).json({ ok: true, sent });
        }
        const ids = (Array.isArray(body.userIds) ? body.userIds : []).map((v) => text(v, 80)).filter(Boolean).slice(0, 200);
        if (!ids.length) return response.status(400).json({ error: "Pilih minimal 1 user" });
        const rows = await sql`SELECT id, status FROM codexa_users WHERE id = ANY(${ids})`;
        let sent = 0;
        let skipped = 0;
        for (const r of rows) {
          if (r.status !== "active") { skipped += 1; continue; }
          if (await createNotification(sql, { userId: r.id, type: kind, title, body: message, link })) sent += 1;
        }
        if (!sent) return response.status(400).json({ error: skipped ? "Semua user terpilih sedang diblokir" : "User tidak ditemukan" });
        return response.status(200).json({ ok: true, sent, skipped });
      }
      return response.status(405).json({ error: "Method not allowed" });
    }

    /* ── DETAIL (satu user + aktivitas nyata) ── */
    const detailId = request.query && typeof request.query.id === "string" ? request.query.id : "";
    if (request.method === "GET" && detailId) {
      const rows = await sql`
        SELECT u.id, u.name, u.email, u.phone, u.balance, u.status, u.role, u.note,
               u.provider, u.avatar, u.email_verified_at AS "emailVerifiedAt", u.created_at AS "createdAt"
        FROM codexa_users u WHERE u.id = ${detailId} LIMIT 1
      `;
      if (!rows.length) return response.status(404).json({ error: "User tidak ditemukan" });
      const user = rows[0];

      const [agg] = await sql`
        SELECT COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS "topupTotal",
               COUNT(*) FILTER (WHERE status = 'approved') AS "topupCount",
               COUNT(*) FILTER (WHERE status = 'pending') AS "pendingCount",
               MAX(created_at) AS "lastTopupAt"
        FROM codexa_topups WHERE user_id = ${detailId}
      `;
      const topups = await sql`
        SELECT id, amount, method, status, created_at AS "createdAt"
        FROM codexa_topups WHERE user_id = ${detailId} ORDER BY created_at DESC LIMIT 8
      `;

      // Tabel pesanan dibuat oleh modul lain; jangan gagalkan detail bila belum ada.
      let orderStat = { orderCount: 0, orderTotal: 0, lastOrderAt: null, available: false };
      let orders = [];
      try {
        const [o] = await sql`
          SELECT COUNT(*) AS "orderCount", COALESCE(SUM(total), 0) AS "orderTotal",
                 MAX(created_at) AS "lastOrderAt"
          FROM codexa_orders WHERE user_id = ${detailId}
        `;
        orderStat = {
          orderCount: Number(o.orderCount) || 0,
          orderTotal: Number(o.orderTotal) || 0,
          lastOrderAt: o.lastOrderAt || null,
          available: true,
        };
        orders = await sql`
          SELECT id, total, item_count AS "itemCount", created_at AS "createdAt"
          FROM codexa_orders WHERE user_id = ${detailId} ORDER BY created_at DESC LIMIT 8
        `;
      } catch (_) { /* tabel pesanan belum tersedia */ }

      const activity = [
        {
          kind: "signup",
          label: `Akun dibuat${user.provider === "google" ? " via Google" : " via Email"}`,
          status: "Terdaftar",
          at: user.createdAt,
        },
        ...topups.map((t) => ({
          kind: "topup",
          label: `Top up ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(t.amount) || 0)}`,
          status: t.status === "approved" ? "Berhasil" : t.status === "pending" ? "Menunggu" : "Ditolak",
          at: t.createdAt,
        })),
        ...orders.map((o) => ({
          kind: "order",
          label: `Pembelian ${Number(o.itemCount) || 1} item`,
          status: new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(o.total) || 0),
          at: o.createdAt,
        })),
      ]
        .filter((a) => a.at)
        .sort((a, b) => new Date(b.at) - new Date(a.at))
        .slice(0, 10);

      return response.status(200).json({
        user: {
          ...user,
          balance: Number(user.balance) || 0,
          status: user.status || "active",
          role: user.role === "admin" ? "admin" : "user",
          provider: user.provider || "",
          topupTotal: Number(agg.topupTotal) || 0,
          topupCount: Number(agg.topupCount) || 0,
          pendingCount: Number(agg.pendingCount) || 0,
          lastTopupAt: agg.lastTopupAt || null,
          ...orderStat,
        },
        activity,
      });
    }

    /* ── LIST ── */
    if (request.method === "GET") {
      const users = await sql`
        SELECT u.id, u.name, u.email, u.phone, u.balance, u.status, u.role, u.note,
                u.provider, u.avatar, u.email_verified_at AS "emailVerifiedAt", u.created_at AS "createdAt",
               COALESCE(SUM(CASE WHEN t.status = 'approved' THEN t.amount ELSE 0 END), 0) AS "topupTotal",
               COUNT(t.id) FILTER (WHERE t.status = 'pending') AS "pendingCount",
               MAX(t.created_at) AS "lastTopupAt"
        FROM codexa_users u
        LEFT JOIN codexa_topups t ON t.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
        LIMIT 500
      `;
      return response.status(200).json({
        users: users.map((u) => ({
          ...u,
          balance: Number(u.balance) || 0,
          topupTotal: Number(u.topupTotal) || 0,
          pendingCount: Number(u.pendingCount) || 0,
          status: u.status || "active",
          role: u.role === "admin" ? "admin" : "user",
          provider: u.provider || "",
        })),
      });
    }


    const body = bodyOf(request);
    const id = text(body.id, 60);

    /* ── DELETE ── */
    if (request.method === "DELETE") {
      if (!id) return response.status(400).json({ error: "ID user wajib diisi" });
      const rows = await sql`DELETE FROM codexa_users WHERE id = ${id} RETURNING id`;
      if (!rows.length) return response.status(404).json({ error: "User tidak ditemukan" });
      return response.status(200).json({ ok: true });
    }

    if (request.method !== "PATCH") {
      response.setHeader("Allow", "GET, PATCH, DELETE");
      return response.status(405).json({ error: "Method not allowed" });
    }

    /* ── UPDATE ── */
    if (!id) return response.status(400).json({ error: "ID user wajib diisi" });
    const existing = await sql`SELECT id FROM codexa_users WHERE id = ${id} LIMIT 1`;
    if (!existing.length) return response.status(404).json({ error: "User tidak ditemukan" });

    // aksi cepat: ubah status saja
    const action = text(body.action, 20);
    if (action) {
      // aksi role: jadikan admin / turunkan ke user
      if (action === "promote" || action === "demote") {
        const role = action === "promote" ? "admin" : "user";
        await sql`UPDATE codexa_users SET role = ${role} WHERE id = ${id}`;
        return response.status(200).json({ ok: true, role });
      }
      const map = { activate: "active", suspend: "suspended", ban: "banned" };
      const status = map[action];
      if (!status) return response.status(400).json({ error: "Aksi tidak dikenal" });
      await sql`UPDATE codexa_users SET status = ${status} WHERE id = ${id}`;
      return response.status(200).json({ ok: true, status });
    }

    const name = text(body.name, 80);
    const email = text(body.email, 160).toLowerCase();
    const phone = text(body.phone, 30);
    const note = text(body.note, 300);
    const status = text(body.status, 20) || "active";
    const role = text(body.role, 10) || "user";
    const password = typeof body.password === "string" ? body.password : "";
    const balanceRaw = body.balance;

    if (name.length < 2) return response.status(400).json({ error: "Nama minimal 2 karakter" });
    if (!EMAIL_RE.test(email)) return response.status(400).json({ error: "Format email tidak valid" });
    if (!STATUSES.includes(status)) return response.status(400).json({ error: "Status tidak valid" });
    if (!ROLES.includes(role)) return response.status(400).json({ error: "Role tidak valid" });
    if (password && password.length < 6) return response.status(400).json({ error: "Password minimal 6 karakter" });

    const MAX_BALANCE = 1_000_000_000; // Rp1 miliar, cukup untuk toko dan mencegah angka absurd
    const balanceNumber = Number(balanceRaw) || 0;
    if (!Number.isFinite(balanceNumber)) return response.status(400).json({ error: "Saldo tidak valid" });
    const balance = Math.max(0, Math.round(balanceNumber));
    if (balance > MAX_BALANCE) {
      return response.status(400).json({ error: "Saldo maksimal Rp1.000.000.000" });
    }

    const dupe = await sql`SELECT id FROM codexa_users WHERE email = ${email} AND id <> ${id} LIMIT 1`;
    if (dupe.length) return response.status(409).json({ error: "Email sudah dipakai user lain" });

    await sql`
      UPDATE codexa_users
      SET name = ${name}, email = ${email}, phone = ${phone},
          balance = ${balance}, status = ${status}, role = ${role}, note = ${note}
      WHERE id = ${id}
    `;
    if (password) {
      await sql`UPDATE codexa_users SET password_hash = ${hashPassword(password)} WHERE id = ${id}`;
    }
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error("Admin users failure", error && error.message);
    return response.status(500).json({ error: "Gagal memproses data user" });
  }
};
