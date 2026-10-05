/**
 * Google Account Mass Status Checker.
 * Admin login satu per satu ke akun Gmail jualan (OAuth offline + consent),
 * refresh token disimpan terenkripsi, lalu dicek massal: invalid_grant → SUSPENDED.
 */
const crypto = require("crypto");
const { encryptSecret, decryptSecret } = require("./_settings");
const { once } = require("./_schema");

const REDIRECT_PATH = "/api/admin/google-checker-callback";

const ensureTable = once(async (sql) => {
  await sql`CREATE TABLE IF NOT EXISTS google_account_checks (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    refresh_token TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    last_checked TIMESTAMPTZ,
    last_error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sold_at TIMESTAMPTZ
  )`;
});

function creds() {
  return {
    id: process.env.GOOGLE_CHECKER_CLIENT_ID || "",
    secret: process.env.GOOGLE_CHECKER_CLIENT_SECRET || "",
  };
}

function originOf(request) {
  const host = request.headers["x-forwarded-host"] || request.headers.host || "akuninstan.com";
  return `https://${String(host).split(",")[0].trim()}`;
}

function stateSecret() {
  return process.env.ADMIN_PASSWORD || process.env.ACCOUNT_CREDENTIALS_KEY || "akuninstan";
}
function signState() {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString("hex")}`;
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyState(state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expect = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() - Number(parts[0]) < 30 * 60 * 1000;
}

function authUrl(request) {
  const { id } = creds();
  if (!id) throw new Error("GOOGLE_CHECKER_CLIENT_ID belum diatur");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: originOf(request) + REDIRECT_PATH,
    response_type: "code",
    scope: "openid email",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: signState(),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function packToken(token) {
  const { enc, plain } = encryptSecret(token);
  return enc ? `enc:${enc}` : plain;
}
function unpackToken(stored) {
  const v = String(stored || "");
  return v.startsWith("enc:") ? decryptSecret(v.slice(4)) : v;
}

async function handleCallback(sql, request) {
  const { code, state, error } = request.query || {};
  if (error) throw new Error(`Google menolak: ${error}`);
  if (!verifyState(state)) throw new Error("Sesi login kedaluwarsa, ulangi dari dashboard");
  const { id, secret } = creds();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(code || ""), client_id: id, client_secret: secret,
      redirect_uri: originOf(request) + REDIRECT_PATH, grant_type: "authorization_code",
    }),
  });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(tok.error_description || tok.error || `HTTP ${res.status}`);
  if (!tok.refresh_token) throw new Error("Google tidak memberi refresh token. Cabut akses aplikasi di akun itu lalu ulangi.");
  let email = "";
  try {
    email = JSON.parse(Buffer.from(String(tok.id_token).split(".")[1], "base64url").toString()).email || "";
  } catch (_) { /* ignore */ }
  if (!email) throw new Error("Email akun tidak terbaca");
  await ensureTable(sql);
  await sql`INSERT INTO google_account_checks (id, email, refresh_token, status, last_checked, last_error)
    VALUES (${crypto.randomUUID()}, ${email.toLowerCase()}, ${packToken(tok.refresh_token)}, 'ACTIVE', NOW(), '')
    ON CONFLICT (email) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, status = 'ACTIVE',
      last_checked = NOW(), last_error = '', sold_at = NULL`;
  return email;
}

async function checkToken(refreshToken) {
  const { id, secret } = creds();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (res.ok) return { status: "ACTIVE", error: "" };
  const body = await res.json().catch(() => ({}));
  if (body.error === "invalid_grant") return { status: "SUSPENDED", error: body.error_description || "invalid_grant" };
  return { status: null, error: body.error || `HTTP ${res.status}` }; // error sementara: status tidak diubah
}

async function checkRow(sql, row) {
  const token = unpackToken(row.refresh_token);
  const result = token ? await checkToken(token) : { status: "SUSPENDED", error: "Token tidak terbaca" };
  if (result.status) {
    await sql`UPDATE google_account_checks SET status = ${result.status}, last_checked = NOW(), last_error = ${result.error} WHERE id = ${row.id}`;
  } else {
    await sql`UPDATE google_account_checks SET last_checked = NOW(), last_error = ${result.error} WHERE id = ${row.id}`;
  }
}

async function checkAll(sql, onlyId) {
  await ensureTable(sql);
  const rows = onlyId
    ? await sql`SELECT id, refresh_token FROM google_account_checks WHERE id = ${onlyId} AND status <> 'SOLD'`
    : await sql`SELECT id, refresh_token FROM google_account_checks WHERE status <> 'SOLD' ORDER BY last_checked NULLS FIRST`;
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map((r) => checkRow(sql, r).catch(() => null)));
  }
  return rows.length;
}

async function list(sql) {
  await ensureTable(sql);
  return sql`SELECT id, email, status, last_checked AS "lastChecked", last_error AS "lastError",
    created_at AS "createdAt", sold_at AS "soldAt" FROM google_account_checks ORDER BY status, email`;
}

async function markSold(sql, id) {
  await ensureTable(sql);
  const rows = await sql`SELECT refresh_token FROM google_account_checks WHERE id = ${id}`;
  if (!rows[0]) throw new Error("Akun tidak ditemukan");
  const token = unpackToken(rows[0].refresh_token);
  if (token) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => null);
  }
  await sql`UPDATE google_account_checks SET status = 'SOLD', refresh_token = '', sold_at = NOW() WHERE id = ${id}`;
}

async function remove(sql, id) {
  await ensureTable(sql);
  await sql`DELETE FROM google_account_checks WHERE id = ${id}`;
}

module.exports = { authUrl, handleCallback, checkAll, list, markSold, remove, creds };
