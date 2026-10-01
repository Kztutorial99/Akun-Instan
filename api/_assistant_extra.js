/**
 * Tool tambahan Assisten Akun Instan (upgrade).
 *  - extraUserTools  : selalu terkunci ke ctx.user.id
 *  - extraAdminTools : hanya role admin; aksi yang mengubah data butuh confirm
 * Kredensial akun (password) tidak pernah dikirim ke model.
 */
const crypto = require("crypto");
const { text } = require("./_users");
const { rupiah, waktuWib } = require("./_telegram");
const { readCustomEmailFee, writeCustomEmailFee } = require("./_custom-email-fee");
const { createNotification } = require("./_notifications");

const num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const money = (v) => rupiah(num(v));
const ok = (data) => ({ ok: true, ...data });
const fail = (message) => ({ ok: false, error: message });
const lim = (v, d, max) => Math.min(max, Math.max(1, num(v, d)));
const isDemo = (id) => /^(etl-|demo-)/.test(String(id || ""));
const CUSTOM_STATUS = ["pending", "processing", "done", "rejected"];

function decrypt(value) {
  const k = process.env.ACCOUNT_CREDENTIALS_KEY || "";
  if (!k) throw new Error("no key");
  const ck = crypto.createHash("sha256").update(k).digest();
  const [iv, tag, enc] = String(value).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ck, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8"));
}
const maskEmail = (e) => {
  const s = String(e || "");
  const [u, dom] = s.split("@");
  if (!dom) return s ? `${s.slice(0, 2)}***` : "-";
  return `${u.slice(0, 3)}***@${dom}`;
};
function itemsOf(blob, { maskEmails = false } = {}) {
  try {
    return (decrypt(blob).items || []).map((i) => ({
      produk: i.title || "Listing",
      tipe: i.loginType || "-",
      jumlahAkun: (i.accounts || []).length,
      akun: (i.accounts || []).map((a) => (maskEmails ? maskEmail(a.email) : a.email || "-")),
      demo: isDemo(i.listingId),
    }));
  } catch (_) { return []; }
}
const parseProfile = (p) => { try { return p ? JSON.parse(p) : null; } catch (_) { return null; } };

/* ═════════════ USER ═════════════ */
const extraUserTools = {
  get_my_account_detail: {
    schema: {
      name: "get_my_account_detail",
      description: "Detail lengkap akun user yang login: metode login (Google/email), status verifikasi email, status akun, saldo, total belanja, jumlah pesanan, jumlah akun dibeli, top up disetujui, notifikasi belum dibaca.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    handler: async (_a, ctx) => {
      const [u] = await ctx.sql`
        SELECT name, email, phone, balance, status, provider, avatar, email_verified_at AS "verifiedAt", created_at AS "createdAt"
        FROM codexa_users WHERE id = ${ctx.user.id} LIMIT 1`;
      if (!u) return fail("Akun tidak ditemukan");
      const safe = async (q, d) => { try { return await q(); } catch (_) { return d; } };
      const [o] = await safe(() => ctx.sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::bigint AS t, COALESCE(SUM(item_count),0)::int AS a FROM codexa_orders WHERE user_id = ${ctx.user.id} AND status = 'paid'`, [{}]);
      const [t] = await safe(() => ctx.sql`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::bigint AS s FROM codexa_topups WHERE user_id = ${ctx.user.id} AND status = 'approved'`, [{}]);
      const [n] = await safe(() => ctx.sql`SELECT COUNT(*)::int AS n FROM codexa_notifications WHERE user_id = ${ctx.user.id} AND read_at IS NULL`, [{}]);
      return ok({
        akun: {
          nama: u.name, email: u.email, telepon: u.phone || "-",
          metodeLogin: u.provider === "google" ? "Google" : "Email & password",
          verifikasi: u.verifiedAt ? `Terverifikasi (${waktuWib(u.verifiedAt)})` : "Belum terverifikasi",
          fotoProfil: u.avatar ? "Ada" : "Belum ada",
          status: u.status || "active",
          saldo: money(u.balance),
          terdaftarSejak: waktuWib(u.createdAt),
        },
        ringkasan: {
          jumlahPesanan: num(o && o.n), totalBelanja: money(o && o.t), akunDibeli: num(o && o.a),
          topUpDisetujui: num(t && t.n), totalTopUp: money(t && t.s),
          notifikasiBelumDibaca: num(n && n.n),
        },
      });
    },
  },

  get_my_orders: {
    schema: {
      name: "get_my_orders",
      description: "Riwayat pembelian akun milik user yang login (produk, jumlah akun, email akun yang dibeli, total, status, custom email). Password TIDAK ditampilkan — arahkan user ke menu Pesanan untuk melihatnya.",
      parameters: { type: "object", properties: { limit: { type: "integer", description: "1-20, default 5" } }, required: [] },
    },
    handler: async (a, ctx) => {
      const rows = await ctx.sql`
        SELECT id, total, item_count AS "c", status, payload_blob AS "b", created_at AS "at"
        FROM codexa_orders WHERE user_id = ${ctx.user.id} ORDER BY created_at DESC LIMIT ${lim(a.limit, 5, 20)}`;
      let custom = [];
      try { custom = await ctx.sql`SELECT order_id AS "o", requested, status, note FROM codexa_custom_emails WHERE user_id = ${ctx.user.id}`; } catch (_) {}
      return ok({
        total: rows.length,
        pesanan: rows.map((r) => ({
          id: r.id.slice(0, 8), tanggal: waktuWib(r.at), total: money(r.total), jumlahAkun: r.c, status: r.status,
          item: itemsOf(r.b).map(({ demo, ...i }) => i),
          customEmail: custom.filter((c) => c.o === r.id).map((c) => ({ nama: c.requested, status: c.status, catatan: c.note || "-" })),
        })),
        catatan: "Password akun bisa dilihat di menu Pesanan.",
      });
    },
  },

  get_my_custom_emails: {
    schema: {
      name: "get_my_custom_emails",
      description: "Status pesanan Custom Email (Gmail dengan nama pilihan) milik user: pending, processing, done, rejected, plus catatan admin.",
      parameters: { type: "object", properties: {}, required: [] },
    },
    handler: async (_a, ctx) => {
      let rows = [];
      try { rows = await ctx.sql`SELECT requested, status, note, result_password AS p, created_at AS at FROM codexa_custom_emails WHERE user_id = ${ctx.user.id} AND order_id IS NOT NULL ORDER BY created_at DESC LIMIT 20`; } catch (_) {}
      return ok({ total: rows.length, customEmail: rows.map((r) => ({ nama: r.requested, status: r.status, sudahAdaPassword: !!r.p, catatanAdmin: r.note || "-", dipesan: waktuWib(r.at) })) });
    },
  },

  get_my_notifications: {
    schema: {
      name: "get_my_notifications",
      description: "Notifikasi terbaru milik user (top up, pembelian, stok baru, pesan admin).",
      parameters: { type: "object", properties: { unread_only: { type: "boolean" }, limit: { type: "integer" } }, required: [] },
    },
    handler: async (a, ctx) => {
      const unread = a.unread_only === true;
      let rows = [];
      try { rows = await ctx.sql`SELECT title, body, type, read_at AS r, created_at AS at FROM codexa_notifications WHERE user_id = ${ctx.user.id} AND (${!unread} OR read_at IS NULL) ORDER BY created_at DESC LIMIT ${lim(a.limit, 10, 30)}`; } catch (_) {}
      return ok({ total: rows.length, notifikasi: rows.map((n) => ({ judul: n.title, isi: n.body || "-", tipe: n.type, dibaca: !!n.r, waktu: waktuWib(n.at) })) });
    },
  },

  get_catalog: {
    schema: {
      name: "get_catalog",
      description: "Katalog produk Akun Instan: nama, tipe (Google Biasa/PVA dll), harga, stok tersedia, jumlah terjual, plus harga Custom Email. Pakai untuk pertanyaan stok, harga, rekomendasi produk.",
      parameters: { type: "object", properties: { query: { type: "string", description: "Kata kunci judul/tipe" } }, required: [] },
    },
    handler: async (a, ctx) => {
      const q = `%${text(a.query, 60).toLowerCase()}%`;
      let rows = [];
      try {
        rows = await ctx.sql`
          SELECT l.id, l.title, l.login_type AS t, l.price, l.stock, l.status, COALESCE(s.sold_count,0)::int AS sold
          FROM codexa_account_listings l LEFT JOIN codexa_listing_sales s ON s.listing_id = l.id
          WHERE (${q} = '%%' OR LOWER(l.title) LIKE ${q} OR LOWER(l.login_type) LIKE ${q})
          ORDER BY (l.stock > 0) DESC, sold DESC LIMIT 30`;
      } catch (_) { try { rows = await ctx.sql`SELECT id, title, login_type AS t, price, stock, status, 0 AS sold FROM codexa_account_listings WHERE (${q} = '%%' OR LOWER(title) LIKE ${q}) LIMIT 30`; } catch (_e) { rows = []; } }
      const fee = await readCustomEmailFee(ctx.sql).catch(() => 10000);
      return ok({
        produk: rows.map((p) => ({ nama: p.title, tipe: p.t, harga: money(p.price), stok: p.status === "available" ? num(p.stock) : 0, terjual: num(p.sold) })),
        hargaCustomEmail: `${money(fee)} per nama`,
      });
    },
  },
};

/* ═════════════ ADMIN ═════════════ */
const needConfirm = (a, what) => (a.confirm === true ? "" : `Butuh konfirmasi admin: ${what}. Panggil lagi dengan confirm=true setelah admin setuju.`);

const extraAdminTools = {
  admin_sales_summary: {
    schema: {
      name: "admin_sales_summary",
      description: "Ringkasan penjualan NYATA dari pesanan lunas (produk demo tidak dihitung): akun terjual, omzet, jumlah pesanan, per produk, untuk periode tertentu.",
      parameters: { type: "object", properties: { days: { type: "integer", description: "Periode hari terakhir, 0 = semua. Default 0." } }, required: [] },
    },
    handler: async (a, ctx) => {
      const days = Math.max(0, Math.min(3650, num(a.days, 0)));
      const rows = await ctx.sql`SELECT payload_blob AS b, total FROM codexa_orders WHERE status = 'paid' AND (${days} = 0 OR created_at > NOW() - ${`${days} days`}::interval)`;
      const per = new Map(); let accounts = 0; let revenue = 0;
      for (const r of rows) {
        try {
          for (const i of decrypt(r.b).items || []) {
            if (isDemo(i.listingId)) continue;
            const qty = (i.accounts || []).length;
            const sum = (i.accounts || []).reduce((s, x) => s + num(x.price), 0);
            accounts += qty; revenue += sum;
            const p = per.get(i.title) || { akun: 0, omzet: 0 };
            p.akun += qty; p.omzet += sum; per.set(i.title, p);
          }
        } catch (_) {}
      }
      return ok({
        periode: days ? `${days} hari terakhir` : "semua waktu",
        jumlahPesanan: rows.length, akunTerjual: accounts, omzetAkun: money(revenue),
        perProduk: [...per.entries()].sort((x, y) => y[1].akun - x[1].akun).slice(0, 15).map(([k, v]) => ({ produk: k, akun: v.akun, omzet: money(v.omzet) })),
      });
    },
  },

  admin_list_orders: {
    schema: {
      name: "admin_list_orders",
      description: "Daftar pesanan pembelian akun terbaru (pembeli, produk, jumlah, total, status). Bisa filter email/nama pembeli. Password tidak ditampilkan.",
      parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: [] },
    },
    handler: async (a, ctx) => {
      const q = `%${text(a.query, 80).toLowerCase()}%`;
      const rows = await ctx.sql`
        SELECT o.id, o.total, o.item_count AS c, o.status, o.payload_blob AS b, o.created_at AS at, u.name, u.email
        FROM codexa_orders o JOIN codexa_users u ON u.id = o.user_id
        WHERE (${q} = '%%' OR LOWER(u.email) LIKE ${q} OR LOWER(u.name) LIKE ${q})
        ORDER BY o.created_at DESC LIMIT ${lim(a.limit, 10, 50)}`;
      return ok({ total: rows.length, pesanan: rows.map((r) => ({ id: r.id, pembeli: `${r.name} (${r.email})`, tanggal: waktuWib(r.at), total: money(r.total), akun: r.c, status: r.status, item: itemsOf(r.b).map((i) => ({ produk: i.produk, jumlah: i.jumlahAkun, demo: i.demo })) })) });
    },
  },

  admin_refund_order: {
    schema: {
      name: "admin_refund_order",
      description: "Refund satu pesanan: tandai status refunded dan kembalikan total ke saldo pembeli. WAJIB konfirmasi.",
      parameters: { type: "object", properties: { order_id: { type: "string" }, reason: { type: "string" }, confirm: { type: "boolean" } }, required: ["order_id"] },
    },
    handler: async (a, ctx) => {
      const [o] = await ctx.sql`SELECT o.id, o.user_id AS uid, o.total, o.status, u.name, u.email FROM codexa_orders o JOIN codexa_users u ON u.id = o.user_id WHERE o.id = ${text(a.order_id, 80)} LIMIT 1`;
      if (!o) return fail("Pesanan tidak ditemukan");
      if (o.status === "refunded") return fail("Pesanan sudah di-refund");
      const c = needConfirm(a, `refund ${money(o.total)} ke ${o.name} (${o.email})`);
      if (c) return ok({ needConfirm: true, message: c });
      const [done] = await ctx.sql`UPDATE codexa_orders SET status = 'refunded' WHERE id = ${o.id} AND status = 'paid' RETURNING id`;
      if (!done) return fail("Gagal refund (status berubah)");
      const [u] = await ctx.sql`UPDATE codexa_users SET balance = balance + ${num(o.total)} WHERE id = ${o.uid} RETURNING balance`;
      await createNotification(ctx.sql, { userId: o.uid, type: "refund", title: "Pesanan di-refund", body: `${money(o.total)} dikembalikan ke saldo.${a.reason ? ` Alasan: ${text(a.reason, 200)}` : ""}`, link: "/pesanan" }).catch(() => {});
      return ok({ refunded: o.id, dikembalikan: money(o.total), saldoBaru: money(u && u.balance) });
    },
  },

  admin_list_custom_emails: {
    schema: {
      name: "admin_list_custom_emails",
      description: "Daftar pesanan Custom Email beserta pemesan, nama yang diminta, data pemilik (nama/tgl lahir/gender), status.",
      parameters: { type: "object", properties: { status: { type: "string", enum: ["all", ...CUSTOM_STATUS] }, limit: { type: "integer" } }, required: [] },
    },
    handler: async (a, ctx) => {
      const st = CUSTOM_STATUS.includes(a.status) ? a.status : "";
      const rows = await ctx.sql`
        SELECT c.id, c.requested, c.status, c.note, c.profile, c.created_at AS at, u.name, u.email
        FROM codexa_custom_emails c JOIN codexa_users u ON u.id = c.user_id
        WHERE c.order_id IS NOT NULL AND (${st} = '' OR c.status = ${st})
        ORDER BY c.created_at DESC LIMIT ${lim(a.limit, 15, 50)}`;
      return ok({ total: rows.length, customEmail: rows.map((r) => ({ id: r.id, nama: r.requested, pemesan: `${r.name} (${r.email})`, status: r.status, dataPemilik: parseProfile(r.profile), catatan: r.note || "-", dipesan: waktuWib(r.at) })) });
    },
  },

  admin_update_custom_email: {
    schema: {
      name: "admin_update_custom_email",
      description: "Ubah status pesanan Custom Email (pending/processing/done/rejected) dan/atau catatan untuk pembeli. Pembeli otomatis dapat notifikasi.",
      parameters: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: CUSTOM_STATUS }, note: { type: "string" } }, required: ["id"] },
    },
    handler: async (a, ctx) => {
      const st = CUSTOM_STATUS.includes(a.status) ? a.status : "";
      const note = typeof a.note === "string" ? text(a.note, 500) : null;
      if (!st && note === null) return fail("Sebutkan status atau catatan baru");
      const [r] = await ctx.sql`
        UPDATE codexa_custom_emails SET status = COALESCE(NULLIF(${st}, ''), status), note = COALESCE(${note}, note)
        WHERE id = ${text(a.id, 80)} RETURNING user_id AS uid, requested, status, note`;
      if (!r) return fail("Pesanan custom email tidak ditemukan");
      await createNotification(ctx.sql, { userId: r.uid, type: "custom_email", title: "Custom email diperbarui", body: `${r.requested}: ${r.status}${r.note ? ` · ${r.note}` : ""}`, link: "/pesanan" }).catch(() => {});
      return ok({ updated: { nama: r.requested, status: r.status, catatan: r.note || "-" } });
    },
  },

  admin_get_custom_email_price: {
    schema: { name: "admin_get_custom_email_price", description: "Lihat harga Custom Email per nama saat ini.", parameters: { type: "object", properties: {}, required: [] } },
    handler: async (_a, ctx) => ok({ harga: money(await readCustomEmailFee(ctx.sql, { fresh: true })) }),
  },

  admin_set_custom_email_price: {
    schema: {
      name: "admin_set_custom_email_price",
      description: "Ubah harga Custom Email per nama (rupiah, 0-10.000.000). Berlaku untuk pesanan baru. WAJIB konfirmasi.",
      parameters: { type: "object", properties: { price: { type: "integer" }, confirm: { type: "boolean" } }, required: ["price"] },
    },
    handler: async (a, ctx) => {
      const p = Math.round(num(a.price, -1));
      if (p < 0 || p > 10000000) return fail("Harga harus 0 - 10.000.000");
      const c = needConfirm(a, `ubah harga Custom Email jadi ${money(p)}`);
      if (c) return ok({ needConfirm: true, message: c });
      const saved = await writeCustomEmailFee(ctx.sql, p);
      return ok({ hargaBaru: money(typeof saved === "number" ? saved : p) });
    },
  },

  admin_update_product: {
    schema: {
      name: "admin_update_product",
      description: "Ubah judul, deskripsi, atau harga satu produk katalog (stok dikelola dari menu Produk karena berisi kredensial). Cari id dulu pakai admin_list_products. WAJIB konfirmasi.",
      parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, price: { type: "integer" }, confirm: { type: "boolean" } }, required: ["id"] },
    },
    handler: async (a, ctx) => {
      const title = text(a.title, 120); const desc = typeof a.description === "string" ? text(a.description, 2000) : null;
      const price = a.price == null ? null : Math.round(num(a.price, -1));
      if (price !== null && (price < 0 || price > 100000000)) return fail("Harga tidak valid");
      if (!title && desc === null && price === null) return fail("Tidak ada perubahan");
      const [p] = await ctx.sql`SELECT id, title, price FROM codexa_account_listings WHERE id = ${text(a.id, 80)} LIMIT 1`;
      if (!p) return fail("Produk tidak ditemukan");
      const c = needConfirm(a, `ubah produk "${p.title}"${price !== null ? ` harga ${money(p.price)} → ${money(price)}` : ""}${title ? ` judul → "${title}"` : ""}`);
      if (c) return ok({ needConfirm: true, message: c });
      const [r] = await ctx.sql`UPDATE codexa_account_listings SET title = COALESCE(NULLIF(${title}, ''), title), description = COALESCE(${desc}, description), price = COALESCE(${price}, price), updated_at = NOW() WHERE id = ${p.id} RETURNING title, price`;
      return ok({ updated: { judul: r.title, harga: money(r.price) } });
    },
  },

  admin_stock_report: {
    schema: { name: "admin_stock_report", description: "Laporan stok katalog: produk habis, stok menipis (<=3), total stok, urut paling laku.", parameters: { type: "object", properties: {}, required: [] } },
    handler: async (_a, ctx) => {
      let rows = [];
      try { rows = await ctx.sql`SELECT l.id, l.title, l.login_type AS t, l.price, l.stock, l.status, COALESCE(s.sold_count,0)::int AS sold FROM codexa_account_listings l LEFT JOIN codexa_listing_sales s ON s.listing_id = l.id ORDER BY sold DESC`; } catch (_) { return fail("Tabel produk belum tersedia"); }
      const real = rows.filter((r) => !isDemo(r.id));
      const stok = (r) => (r.status === "available" ? num(r.stock) : 0);
      return ok({
        totalProduk: real.length, totalStok: real.reduce((s, r) => s + stok(r), 0),
        habis: real.filter((r) => stok(r) === 0).map((r) => `${r.title} (terjual ${r.sold})`).slice(0, 20),
        menipis: real.filter((r) => stok(r) > 0 && stok(r) <= 3).map((r) => `${r.title}: ${stok(r)}`),
        palingLaku: real.slice(0, 5).map((r) => `${r.title}: ${r.sold} terjual`),
      });
    },
  },

  admin_visit_stats: {
    schema: { name: "admin_visit_stats", description: "Statistik pengunjung situs: total kunjungan, pengunjung unik, sumber, perangkat, negara/kota teratas, halaman teratas.", parameters: { type: "object", properties: { days: { type: "integer", description: "Default 7" } }, required: [] } },
    handler: async (a, ctx) => {
      const days = Math.max(1, Math.min(365, num(a.days, 7)));
      const iv = `${days} days`;
      try {
        const [t] = await ctx.sql`SELECT COUNT(*)::int AS n, COUNT(DISTINCT visitor_id)::int AS u FROM codexa_visits WHERE created_at > NOW() - ${iv}::interval`;
        const fmt = (rows) => rows.map((r) => `${r.k || "-"}: ${r.n}`);
        const src = await ctx.sql`SELECT source AS k, COUNT(*)::int AS n FROM codexa_visits WHERE created_at > NOW() - ${iv}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
        const dev = await ctx.sql`SELECT device AS k, COUNT(*)::int AS n FROM codexa_visits WHERE created_at > NOW() - ${iv}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
        const city = await ctx.sql`SELECT city AS k, COUNT(*)::int AS n FROM codexa_visits WHERE created_at > NOW() - ${iv}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
        const path = await ctx.sql`SELECT path AS k, COUNT(*)::int AS n FROM codexa_visits WHERE created_at > NOW() - ${iv}::interval GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
        return ok({ periode: `${days} hari`, kunjungan: t.n, pengunjungUnik: t.u, sumber: fmt(src), perangkat: fmt(dev), kota: fmt(city), halaman: fmt(path) });
      } catch (_) { return fail("Data kunjungan belum tersedia"); }
    },
  },

  admin_list_reviews: {
    schema: { name: "admin_list_reviews", description: "Ulasan/rating produk terbaru dari pembeli.", parameters: { type: "object", properties: { limit: { type: "integer" } }, required: [] } },
    handler: async (a, ctx) => {
      try {
        const rows = await ctx.sql`SELECT r.rating, r.comment, r.author_name AS an, r.source, r.created_at AS at, l.title, u.name FROM codexa_listing_reviews r LEFT JOIN codexa_account_listings l ON l.id = r.listing_id LEFT JOIN codexa_users u ON u.id = r.user_id ORDER BY r.created_at DESC LIMIT ${lim(a.limit, 10, 50)}`;
        const avg = rows.length ? (rows.reduce((s, r) => s + num(r.rating), 0) / rows.length).toFixed(1) : "-";
        return ok({ rataRata: avg, ulasan: rows.map((r) => ({ produk: r.title || "-", oleh: r.an || r.name || "-", rating: r.rating, komentar: r.comment || "-", sumber: r.source, waktu: waktuWib(r.at) })) });
      } catch (_) { return fail("Belum ada data ulasan"); }
    },
  },

  admin_user_activity: {
    schema: { name: "admin_user_activity", description: "Aktivitas lengkap satu user (cari pakai email/nama): profil, metode login, verifikasi, saldo, pesanan terakhir, top up terakhir, laporan, custom email.", parameters: { type: "object", properties: { query: { type: "string", description: "Email atau nama user" } }, required: ["query"] } },
    handler: async (a, ctx) => {
      const q = text(a.query, 120).toLowerCase();
      if (q.length < 2) return fail("Sebutkan email atau nama");
      const [u] = await ctx.sql`SELECT id, name, email, phone, balance, status, role, provider, email_verified_at AS v, created_at AS at FROM codexa_users WHERE LOWER(email) = ${q} OR LOWER(email) LIKE ${`%${q}%`} OR LOWER(name) LIKE ${`%${q}%`} ORDER BY (LOWER(email) = ${q}) DESC LIMIT 1`;
      if (!u) return fail("User tidak ditemukan");
      const safe = async (f) => { try { return await f(); } catch (_) { return []; } };
      const orders = await safe(() => ctx.sql`SELECT id, total, item_count AS c, status, created_at AS at FROM codexa_orders WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 5`);
      const tops = await safe(() => ctx.sql`SELECT amount, status, method, created_at AS at FROM codexa_topups WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 5`);
      const reps = await safe(() => ctx.sql`SELECT ticket, summary, status FROM codexa_reports WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 5`);
      const ce = await safe(() => ctx.sql`SELECT requested, status FROM codexa_custom_emails WHERE user_id = ${u.id} AND order_id IS NOT NULL ORDER BY created_at DESC LIMIT 5`);
      return ok({
        user: { id: u.id, nama: u.name, email: u.email, telepon: u.phone || "-", saldo: money(u.balance), status: u.status, role: u.role, metodeLogin: u.provider === "google" ? "Google" : "Email", verifikasi: u.v ? "Terverifikasi" : "Belum", daftar: waktuWib(u.at) },
        pesanan: orders.map((o) => ({ id: o.id, total: money(o.total), akun: o.c, status: o.status, waktu: waktuWib(o.at) })),
        topUp: tops.map((t) => ({ jumlah: money(t.amount), status: t.status, metode: t.method || "-", waktu: waktuWib(t.at) })),
        laporan: reps.map((r) => ({ tiket: r.ticket, masalah: r.summary, status: r.status })),
        customEmail: ce.map((c) => ({ nama: c.requested, status: c.status })),
      });
    },
  },
};

module.exports = { extraUserTools, extraAdminTools };
