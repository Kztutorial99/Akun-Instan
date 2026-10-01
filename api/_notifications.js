const crypto = require("crypto");
const { once } = require("./_schema");

/**
 * Notifikasi in-app untuk user Akun Instan.
 * Dipakai oleh: top up (diajukan / disetujui / ditolak) dan checkout akun.
 */

async function ensureNotificationTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL DEFAULT '',
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS codexa_notifications_user_idx ON codexa_notifications (user_id, created_at DESC)`;
  // Simpan hanya kabar stok terbaru milik setiap user, termasuk notifikasi lama.
  await sql`
    DELETE FROM codexa_notifications n USING (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS position
      FROM codexa_notifications WHERE type = 'stock_available'
    ) old WHERE n.id = old.id AND old.position > 1
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS codexa_notifications_one_stock_per_user
    ON codexa_notifications (user_id) WHERE type = 'stock_available'`;
}

const ensureNotificationTables = once(ensureNotificationTablesUncached);

const clamp = (value, max) => String(value == null ? "" : value).slice(0, max);

/**
 * Simpan satu notifikasi. Dibuat tahan gagal: kegagalan menulis notifikasi
 * tidak boleh membatalkan transaksi utama (top up / checkout).
 */
async function createNotification(sql, { userId, type, title, body, link } = {}) {
  if (!userId || !title) return null;
  try {
    await ensureNotificationTables(sql);
    const [row] = await sql`
      INSERT INTO codexa_notifications (id, user_id, type, title, body, link)
      VALUES (${crypto.randomUUID()}, ${userId}, ${clamp(type || "info", 30)},
              ${clamp(title, 160)}, ${clamp(body, 600)}, ${clamp(link, 60)})
      RETURNING id
    `;
    return row || null;
  } catch (error) {
    console.error("Notification write failure", error && error.message);
    return null;
  }
}

/**
 * Kirim satu notifikasi ke BANYAK user sekaligus (broadcast admin).
 * Memakai satu INSERT ... SELECT supaya tetap cepat walau user ribuan.
 * Akun yang diblokir (status suspended / banned) selalu dilewati.
 */
async function broadcastNotification(sql, { type, title, body, link } = {}) {
  if (!title) return 0;
  await ensureNotificationTables(sql);
  const t = clamp(type || "admin", 30);
  const ti = clamp(title, 160);
  const bo = clamp(body, 600);
  const li = clamp(link, 60);
  const rows = await sql`
    INSERT INTO codexa_notifications (id, user_id, type, title, body, link)
    SELECT gen_random_uuid()::text, u.id, ${t}, ${ti}, ${bo}, ${li}
    FROM codexa_users u WHERE u.status = 'active'
    RETURNING id`;
  return rows.length;
}

/** Kabar stok tunggal per pengguna: saat restock, angka dan waktu berubah di baris yang sama. */
async function updateStockNotification(sql, { title, body } = {}) {
  await ensureNotificationTables(sql);
  const rows = await sql`
    INSERT INTO codexa_notifications (id, user_id, type, title, body, link)
    SELECT gen_random_uuid()::text, u.id, 'stock_available',
           ${clamp(title, 160)}, ${clamp(body, 600)}, 'katalog'
    FROM codexa_users u WHERE u.status = 'active'
    ON CONFLICT (user_id) WHERE type = 'stock_available'
    DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, link = EXCLUDED.link,
                  read_at = NULL, created_at = NOW()
    RETURNING id
  `;
  return rows.length;
}

module.exports = { ensureNotificationTables, createNotification, broadcastNotification, updateStockNotification };
