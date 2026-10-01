const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { once } = require("./_schema");

const COOKIE_NAME = "codexa_user";
const MAX_AGE = 60 * 60 * 24 * 14; // 14 hari

function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(process.env.DATABASE_URL);
}

function secret() {
  const explicit = process.env.USER_SESSION_SECRET || "";
  if (explicit) return explicit;
  const admin = process.env.ADMIN_PASSWORD || "";
  if (!admin) return "";
  /* Fallback lama memakai ADMIN_PASSWORD apa adanya, sehingga kunci cookie
     user sama dengan kunci sesi admin. Sekarang kunci user diturunkan lewat
     HMAC dengan label khusus supaya password admin tidak bisa langsung
     dipakai memalsukan cookie user. */
  return crypto.createHmac("sha256", admin).update("codexa/user-session/v1").digest("hex");
}

async function ensureTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      balance BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_topups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    )
  `;
  // Bukti transfer disimpan di DB sebagai cadangan kalau kiriman Telegram gagal.
  await sql`ALTER TABLE codexa_topups ADD COLUMN IF NOT EXISTS proof_blob TEXT`;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_reports (
      id TEXT PRIMARY KEY,
      ticket TEXT NOT NULL UNIQUE,
      user_id TEXT REFERENCES codexa_users(id) ON DELETE SET NULL,
      user_name TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'lainnya',
      summary TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      urgency TEXT NOT NULL DEFAULT 'sedang',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
      source TEXT NOT NULL DEFAULT 'assistant',
      admin_note TEXT NOT NULL DEFAULT '',
      telegram_sent BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  // Sisa DDL tidak saling bergantung, jadi dikirim bersamaan (1 gelombang
  // round-trip) alih-alih satu per satu.
  await Promise.all([
    sql`CREATE INDEX IF NOT EXISTS codexa_reports_user_idx ON codexa_reports (user_id, created_at DESC)`,
    sql`CREATE INDEX IF NOT EXISTS codexa_reports_status_idx ON codexa_reports (status, created_at DESC)`,
    sql`ALTER TABLE codexa_reports ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'email'`,
    // Akun lama tetap aktif. Pendaftaran email baru secara eksplisit menyimpan NULL
    // sampai pengguna mengeklik link verifikasi.
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ DEFAULT NOW()`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ`,
    // Reset password lewat link email (berlaku 1 jam, sekali pakai).
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT`,
    sql`ALTER TABLE codexa_users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ`,
  ]);
  await sql`UPDATE codexa_users SET role = 'user' WHERE role NOT IN ('user','admin')`;
}

const ensureTables = once(ensureTablesUncached);

/* ── password hashing (scrypt) ── */
function hashPassword(password, salt) {
  const useSalt = salt || crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(String(password), useSalt, 32).toString("base64url");
  return `scrypt.${useSalt}.${derived}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, salt] = String(stored).split(".");
    if (scheme !== "scrypt" || !salt) return false;
    const expected = Buffer.from(stored);
    const actual = Buffer.from(hashPassword(password, salt));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

/* ── session cookie ── */
function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}
function setSession(response, userId) {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE * 1000 })).toString("base64url");
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=${payload}.${sign(payload)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`);
}
function clearSession(response) {
  response.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}
function sessionUserId(request) {
  if (!secret()) return "";
  const cookies = request.headers.cookie || "";
  const item = cookies.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!item) return "";
  const [payload, provided] = item.slice(COOKIE_NAME.length + 1).split(".");
  if (!payload || !provided) return "";
  const expected = sign(payload);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return "";
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.exp > Date.now() ? String(data.uid || "") : "";
  } catch (_) {
    return "";
  }
}

async function currentUser(sql, request) {
  const id = sessionUserId(request);
  if (!id) return null;
  const rows = await sql`
    SELECT id, name, email, phone, balance, status, role, avatar, provider,
           email_verified_at AS "emailVerifiedAt", created_at AS "createdAt"
    FROM codexa_users WHERE id = ${id} LIMIT 1
  `;
  if (!rows.length) return null;
  if (rows[0].status && rows[0].status !== "active") return null;
  if (rows[0].provider !== "google" && !rows[0].emailVerifiedAt) return null;
  return { ...rows[0], balance: Number(rows[0].balance) || 0, role: rows[0].role === "admin" ? "admin" : "user" };
}

function bodyOf(request) {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
}
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");


/* ── Rate limit sederhana berbasis database ──────────────────────────
   Endpoint login/register tanpa throttle bisa dibrute-force. Counter
   disimpan di tabel codexa_rate_limits per (kunci, jendela waktu).
   Kalau database bermasalah, fungsi ini fail-open supaya login tetap
   bisa dipakai — tujuannya menahan brute force, bukan jadi gerbang. */
function clientIp(request) {
  const forwarded = String((request.headers && request.headers["x-forwarded-for"]) || "");
  const first = forwarded.split(",")[0].trim();
  return first || String((request.headers && request.headers["x-real-ip"]) || "") || "unknown";
}

async function rateLimit(sql, { key, limit, windowSec }) {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS codexa_rate_limits (
        key TEXT PRIMARY KEY,
        hits INTEGER NOT NULL DEFAULT 0,
        window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    const rows = await sql`
      INSERT INTO codexa_rate_limits (key, hits, window_start)
      VALUES (${key}, 1, NOW())
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN codexa_rate_limits.window_start < NOW() - (${windowSec} * INTERVAL '1 second') THEN 1
          ELSE codexa_rate_limits.hits + 1 END,
        window_start = CASE
          WHEN codexa_rate_limits.window_start < NOW() - (${windowSec} * INTERVAL '1 second') THEN NOW()
          ELSE codexa_rate_limits.window_start END
      RETURNING hits, window_start AS "windowStart"
    `;
    const hits = Number(rows[0] && rows[0].hits) || 1;
    if (hits <= limit) return { allowed: true, retryAfter: 0 };
    const started = new Date(rows[0].windowStart).getTime();
    const retryAfter = Math.max(1, Math.ceil((started + windowSec * 1000 - Date.now()) / 1000));
    return { allowed: false, retryAfter };
  } catch (error) {
    console.error("Rate limit unavailable", error && error.message);
    return { allowed: true, retryAfter: 0 };
  }
}

async function resetRateLimit(sql, key) {
  try { await sql`DELETE FROM codexa_rate_limits WHERE key = ${key}`; } catch (_) { /* abaikan */ }
}

module.exports = {
  db, ensureTables, hashPassword, verifyPassword,
  setSession, clearSession, sessionUserId, currentUser, bodyOf, text,
  clientIp, rateLimit, resetRateLimit,
};

