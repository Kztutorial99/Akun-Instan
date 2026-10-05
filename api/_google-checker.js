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
  await sql`ALTER TABLE google_account_checks ADD COLUMN IF NOT EXISTS listing_id TEXT`;
});

/* ── enkripsi stok (format sama dengan api/admin/products.js) ── */
function ckey() { return crypto.createHash("sha256").update(process.env.ACCOUNT_CREDENTIALS_KEY || "").digest(); }
function encCred(value) {
  if (!process.env.ACCOUNT_CREDENTIALS_KEY) throw new Error("ACCOUNT_CREDENTIALS_KEY is not configured");
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", ckey(), iv);
  const e = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return [iv.toString("base64url"), c.getAuthTag().toString("base64url"), e.toString("base64url")].join(".");
}
function decCred(value) {
  const [iv, tag, e] = String(value).split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", ckey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(e, "base64url")), d.final()]).toString("utf8"));
}

/* Daftar produk Google untuk dipilih saat memasukkan akun ke stok. */
async function googleListings(sql) {
  const rows = await sql`SELECT id, title, login_type AS "loginType", price, stock FROM codexa_account_listings
    WHERE (login_type ILIKE '%google%' OR title ILIKE '%google%' OR title ILIKE '%gmail%') AND id NOT LIKE 'demo-%'
    ORDER BY title`;
  return rows.map((r) => ({ ...r, price: Number(r.price) || 0 }));
}

/* Masukkan akun checker ke stok listing (compare-and-swap supaya aman dari checkout bersamaan). */
const NEW_DESC = "Tentang Produk:\nAkun Google (Gmail) Fresh \u2014 Siap Pakai. Detail paket dan masa aktif mengikuti judul produk.\n\nYang Didapat:\n- Data login lengkap\n- Akses sesuai paket yang dipilih\n- Panduan pengamanan akun\n\nCatatan penting:\n- Ganti password setelah login pertama.\n- Aktifkan verifikasi dua langkah jika tersedia.\n- Garansi login 1x24 jam sejak pembelian.";
const NEW_DELIVERY = "CARA MENGAMANKAN AKUN GOOGLE (WAJIB SEGERA):\n1. Login memakai email & password yang diterima.\n2. Ganti password di https://myaccount.google.com/signinoptions/password\n3. Ganti email & nomor pemulihan menjadi milikmu sendiri.\n4. Keluarkan semua perangkat lain di https://myaccount.google.com/device-activity\n5. Cek akses aplikasi pihak ketiga di https://myaccount.google.com/permissions\n6. Aktifkan verifikasi dua langkah.\n\nCATATAN: simpan data login dengan aman dan jangan dibagikan kepada siapa pun.";
/* Cek seluruh produk: email yang sama tidak boleh ada dua kali di stok. */
async function emailInAnyStock(sql, email) {
  const target = String(email || "").toLowerCase();
  const rows = await sql`SELECT credential_blob AS "blob" FROM codexa_account_listings WHERE credential_blob IS NOT NULL AND credential_blob <> ''`;
  for (const r of rows) {
    let cred; try { cred = decCred(r.blob); } catch (_) { continue; }
    if ((cred.accounts || []).some((a) => String(a.email || "").toLowerCase() === target)) return true;
  }
  return false;
}
async function addToStock(sql, { id, password, listingId, price, newTitle }) {
  await ensureTable(sql);
  const [acc] = await sql`SELECT email, status, listing_id FROM google_account_checks WHERE id = ${id}`;
  if (!acc) throw new Error("Akun tidak ditemukan");
  if (acc.status !== "ACTIVE") throw new Error("Hanya akun ACTIVE yang bisa dimasukkan ke stok");
  if (acc.listing_id) throw new Error("Akun ini sudah ada di stok produk");
  const pass = String(password || "").trim().slice(0, 200);
  if (!pass) throw new Error("Password wajib diisi");
  if (await emailInAnyStock(sql, acc.email)) throw new Error("Email ini sudah ada di stok produk lain");
  if (listingId === "__new__" || !listingId) {
    const p = Math.max(0, Math.round(Number(price) || 0));
    if (!p) throw new Error("Harga wajib diisi untuk produk baru");
    const title = String(newTitle || "").trim().slice(0, 160) || "Akun Google (Gmail) Fresh \u2014 Siap Pakai";
    listingId = require("crypto").randomUUID();
    await sql`INSERT INTO codexa_account_listings (id,title,description,login_type,price,stock,status,credential_blob)
      VALUES (${listingId},${title},${NEW_DESC},${"Google"},${p},${0},${"sold"},${encCred({ accounts: [], agedPricing: false, deliveryDetails: NEW_DELIVERY })})`;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await sql`SELECT id, price, credential_blob AS "blob" FROM codexa_account_listings WHERE id = ${String(listingId || "")}`;
    if (!row) throw new Error("Produk tidak ditemukan");
    const cred = decCred(row.blob);
    const accounts = Array.isArray(cred.accounts) ? cred.accounts : [];
    if (accounts.some((a) => String(a.email).toLowerCase() === acc.email)) throw new Error("Email ini sudah ada di produk tersebut");
    const p = Math.max(0, Math.round(Number(price) || Number(row.price) || 0));
    accounts.push({ email: acc.email, password: pass, price: p, createdAt: new Date().toISOString().slice(0, 10) });
    const next = { ...cred, accounts };
    const minPrice = Math.min(...accounts.map((a) => Number(a.price) || 0));
    const [ok] = await sql`UPDATE codexa_account_listings SET credential_blob = ${encCred(next)}, stock = ${accounts.length},
      price = ${minPrice}, status = 'available', updated_at = NOW() WHERE id = ${row.id} AND credential_blob = ${row.blob} RETURNING id`;
    if (ok) { await sql`UPDATE google_account_checks SET listing_id = ${row.id} WHERE id = ${id}`; return; }
  }
  throw new Error("Stok sedang berubah, coba lagi");
}

/* Tarik akun dari stok listing (dipakai saat akun SUSPENDED). */
async function pullFromStock(sql, email, listingId) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await sql`SELECT id, price, credential_blob AS "blob" FROM codexa_account_listings WHERE id = ${listingId}`;
    if (!row) return;
    const cred = decCred(row.blob);
    const accounts = (cred.accounts || []).filter((a) => String(a.email).toLowerCase() !== email);
    if (accounts.length === (cred.accounts || []).length) return;
    const minPrice = accounts.length ? Math.min(...accounts.map((a) => Number(a.price) || 0)) : Number(row.price) || 0;
    const [ok] = await sql`UPDATE codexa_account_listings SET credential_blob = ${encCred({ ...cred, accounts })}, stock = ${accounts.length},
      price = ${minPrice}, status = ${accounts.length ? "available" : "sold"}, updated_at = NOW()
      WHERE id = ${row.id} AND credential_blob = ${row.blob} RETURNING id`;
    if (ok) return;
  }
}

/* Dipanggil checkout: akun yang terjual → SOLD + cabut token checker. Best-effort. */
async function markSoldByEmails(sql, emails) {
  const list = [...new Set((emails || []).map((e) => String(e || "").toLowerCase()).filter(Boolean))];
  if (!list.length) return;
  await ensureTable(sql);
  const rows = await sql`SELECT id FROM google_account_checks WHERE email = ANY(${list}) AND status <> 'SOLD'`;
  for (const r of rows) await markSold(sql, r.id).catch(() => null);
}

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
    if (result.status === "SUSPENDED" && row.listing_id) {
      await pullFromStock(sql, row.email, row.listing_id).catch(() => null);
      await sql`UPDATE google_account_checks SET listing_id = NULL WHERE id = ${row.id}`;
    }
  } else {
    await sql`UPDATE google_account_checks SET last_checked = NOW(), last_error = ${result.error} WHERE id = ${row.id}`;
  }
}

async function checkAll(sql, onlyId) {
  await ensureTable(sql);
  const rows = onlyId
    ? await sql`SELECT id, email, listing_id, refresh_token FROM google_account_checks WHERE id = ${onlyId} AND status <> 'SOLD'`
    : await sql`SELECT id, email, listing_id, refresh_token FROM google_account_checks WHERE status <> 'SOLD' ORDER BY last_checked NULLS FIRST`;
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map((r) => checkRow(sql, r).catch(() => null)));
  }
  return rows.length;
}

async function list(sql) {
  await ensureTable(sql);
  return sql`SELECT c.id, c.email, c.status, c.last_checked AS "lastChecked", c.last_error AS "lastError",
    c.created_at AS "createdAt", c.sold_at AS "soldAt", c.listing_id AS "listingId", l.title AS "listingTitle"
    FROM google_account_checks c LEFT JOIN codexa_account_listings l ON l.id = c.listing_id ORDER BY c.status, c.email`;
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

module.exports = { emailInAnyStock, googleListings, addToStock, markSoldByEmails, authUrl, handleCallback, checkAll, list, markSold, remove, creds };
