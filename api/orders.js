const crypto = require("crypto");
const { db, ensureTables, currentUser, bodyOf } = require("./_users");
const { createNotification } = require("./_notifications");
const { isAdmin } = require("./admin/_auth");
const { once } = require("./_schema");
const GOOGLE_SECURITY_GUIDE = "CARA MENGAMANKAN AKUN GOOGLE (WAJIB SEGERA):\n1. Login memakai email & password yang diterima.\n2. Ganti password di https://myaccount.google.com/signinoptions/password\n3. Ganti email & nomor pemulihan menjadi milikmu sendiri.\n4. Keluarkan semua perangkat lain di https://myaccount.google.com/device-activity\n5. Cek akses aplikasi pihak ketiga di https://myaccount.google.com/permissions\n6. Aktifkan verifikasi dua langkah.\n\nCATATAN: simpan data login dengan aman dan jangan dibagikan kepada siapa pun.";
const { spendPoints, refundPoints } = require("./_checkin");
const { effectiveAccountPrice, agedInfo, readAgedConfig, DEFAULT_AGED_CONFIG } = require("./_aged");

/* ── enkripsi kredensial (format sama dengan api/admin/products.js) ── */
function key() { return process.env.ACCOUNT_CREDENTIALS_KEY || ""; }
function cipherKey() { return crypto.createHash("sha256").update(key()).digest(); }
function encryptCredentials(value) {
  if (!key()) throw new Error("ACCOUNT_CREDENTIALS_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptCredentials(value) {
  if (!key()) throw new Error("ACCOUNT_CREDENTIALS_KEY is not configured");
  const [ivText, tagText, encryptedText] = String(value).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8"));
}

function accountsOf(credentials, basePrice, agedCfg) {
  const cfg = agedCfg || DEFAULT_AGED_CONFIG;
  const c = credentials || {};
  const fallback = Math.max(0, Math.round(Number(basePrice) || 0));
  const aged = c.agedPricing !== false && cfg.enabled !== false;
  const price = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback; };
  if (Array.isArray(c.accounts) && c.accounts.length) {
    return c.accounts.map((a) => ({
      email: a.email || a.username || "",
      password: a.password || "",
      createdAt: a.createdAt || "",
      basePrice: price(a.price),
      /* harga yang ditagih = harga dasar + bonus umur akun (sistem aged) */
      price: effectiveAccountPrice(a, fallback, aged, cfg),
      agedLabel: aged ? agedInfo(a.createdAt, cfg).label : "",
    }));
  }
  const legacy = { email: c.email || c.username || "", password: c.password || "", price: fallback };
  return legacy.email || legacy.password ? [legacy] : [];
}

async function ensureOrderTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      total BIGINT NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','refunded')),
      payload_blob TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS codexa_orders_user_idx ON codexa_orders (user_id, created_at DESC)`;
}

const ensureOrderTables = once(ensureOrderTablesUncached);

/* ── permintaan email/username kustom dari pembeli ── */
async function ensureCustomEmailTableUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_custom_emails (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      order_id TEXT,
      requested TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`ALTER TABLE codexa_custom_emails ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`;
  // Hasil kerja admin: password akun Google yang dibuat + catatan untuk pembeli.
  await sql`ALTER TABLE codexa_custom_emails ADD COLUMN IF NOT EXISTS result_password TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE codexa_custom_emails ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT ''`;
  // Data pemilik akun (nama depan/belakang, tanggal lahir, gender) untuk pembuatan Gmail.
  await sql`ALTER TABLE codexa_custom_emails ADD COLUMN IF NOT EXISTS profile TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS codexa_custom_emails_unique ON codexa_custom_emails (lower(requested))`;
}

const ensureCustomEmailTable = once(ensureCustomEmailTableUncached);

/* ── catatan kapan pembeli pertama kali membuka password (untuk sengketa) ── */
async function ensureRevealTableUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_secret_reveals (
      user_id TEXT NOT NULL,
      ref TEXT NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, ref)
    )
  `;
}
const ensureRevealTable = once(ensureRevealTableUncached);

async function markRevealed(sql, userId, ref) {
  try {
    await ensureRevealTable(sql);
    await sql`INSERT INTO codexa_secret_reveals (user_id, ref) VALUES (${userId}, ${ref}) ON CONFLICT DO NOTHING`;
  } catch (_) {}
}

// Password disamarkan sebelum dikirim ke browser; aslinya hanya keluar lewat
// endpoint reveal saat pembeli benar-benar menekan tombol tampilkan/salin.
function maskSecret(value) {
  const raw = String(value || "");
  if (!raw) return "";
  return "•".repeat(Math.min(12, Math.max(6, raw.length)));
}

const CUSTOM_EMAIL_STATUS = ["pending", "processing", "done", "rejected"];
// Satu "tugas" custom email = maksimal 3 nama. Pembeli baru boleh beli lagi
// setelah semua permintaan sebelumnya selesai (done) atau ditolak (rejected).
const MAX_CUSTOM_EMAILS = 3;
const OPEN_CUSTOM_STATUS = ["pending", "processing"];

// "Nama Ku 99" → "namaku99@gmail.com". Username polos dianggap Gmail.
function normalizeCustomEmail(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase().replace(/\s+/g, "").slice(0, 80);
  if (!raw) return { ok: true, value: "", local: "", domain: "" };
  let local = raw;
  let domain = "gmail.com";
  if (raw.includes("@")) {
    const parts = raw.split("@");
    if (parts.length !== 2) return { ok: false, error: "Format email tidak valid" };
    local = parts[0];
    domain = parts[1];
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { ok: false, error: "Domain email tidak valid" };
  }
  if (!/^[a-z0-9._%+-]{3,64}$/.test(local)) {
    return { ok: false, error: "Gunakan 3-64 karakter: huruf, angka, titik, garis bawah, atau strip" };
  }
  return { ok: true, value: `${local}@${domain}`, local, domain };
}

const GOOGLE_DOMAINS = ["gmail.com", "googlemail.com"];

// Aturan resmi Google untuk username Gmail baru.
function gmailPolicyError(local) {
  if (local.length < 6 || local.length > 30) return "Username Gmail harus 6-30 karakter";
  if (!/^[a-z0-9.]+$/.test(local)) return "Gmail hanya menerima huruf, angka, dan titik";
  if (local.startsWith(".") || local.endsWith(".")) return "Tidak boleh diawali atau diakhiri titik";
  if (local.includes("..")) return "Tidak boleh ada dua titik berurutan";
  if (!/[a-z]/.test(local)) return "Harus mengandung minimal satu huruf";
  return "";
}

// Gmail mengabaikan titik: john.doe == johndoe (alias yang sama).
function canonicalOf(local, domain) {
  const isGoogle = GOOGLE_DOMAINS.includes(domain);
  const base = isGoogle ? local.replace(/\./g, "") : local;
  return `${base}@${isGoogle ? "gmail.com" : domain}`;
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms || 6000);
  try { return await fetch(url, { ...(options || {}), signal: controller.signal }); }
  finally { clearTimeout(timer); }
}

// Sinyal "sudah dipakai publik": alamat yang terdaftar di Gravatar pasti
// sudah dimiliki orang lain (dipakai untuk profil publik/WordPress/dll).
async function gravatarUsed(email) {
  const hash = crypto.createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  try {
    const res = await fetchWithTimeout(`https://en.gravatar.com/${hash}.json`, {
      headers: { "user-agent": "AkunInstan-EmailCheck/1.0" },
    }, 6000);
    return res.status === 200;
  } catch (_) { return null; }
}

// Domain harus punya MX supaya email benar-benar bisa dibuat/dikirimi surat.
async function domainHasMx(domain) {
  try {
    const res = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
    }, 6000);
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body.Answer) && body.Answer.some((a) => a.type === 15);
  } catch (_) { return null; }
}

/* ── cek ketersediaan Gmail definitif via actor Apify ──
   Actor "maximedupre/gmail-username-checker" mengecek langsung ke formulir
   pendaftaran Google, jadi hasilnya pasti (available/taken), bukan tebakan.
   Tiap run berbayar → hasilnya di-cache di database. */

const ensureEmailCheckCacheTable = once(async function ensureEmailCheckCacheTableUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_email_checks (
      canonical TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
});

/* Cache: "taken" disimpan 7 hari (Google tidak mendaur ulang username),
   "available" cuma 1 jam (bisa diambil orang kapan saja).
   Return true/false kalau ada cache segar, undefined kalau miss/error. */
async function cachedGmailStatus(sql, canonical) {
  try {
    await ensureEmailCheckCacheTable(sql);
    const [row] = await sql`
      SELECT status, checked_at AS "checkedAt" FROM codexa_email_checks WHERE canonical = ${canonical} LIMIT 1
    `;
    if (!row) return undefined;
    const ageMs = Date.now() - new Date(row.checkedAt).getTime();
    const ttlMs = row.status === "taken" ? 7 * 24 * 3600 * 1000 : 3600 * 1000;
    if (!(ageMs >= 0 && ageMs <= ttlMs)) return undefined;
    return row.status === "available";
  } catch (_) { return undefined; }
}

async function rememberGmailStatus(sql, canonical, available) {
  try {
    await ensureEmailCheckCacheTable(sql);
    await sql`
      INSERT INTO codexa_email_checks (canonical, status, checked_at)
      VALUES (${canonical}, ${available ? "available" : "taken"}, NOW())
      ON CONFLICT (canonical) DO UPDATE SET status = EXCLUDED.status, checked_at = NOW()
    `;
  } catch (_) { /* cache gagal tidak fatal */ }
}

/* Tanya actor Apify. Return true = tersedia, false = sudah dipakai,
   null = tidak bisa dipastikan (token hilang, timeout, error actor). */
async function apifyGmailAvailability(canonical) {
  const token = process.env.APIFY_TOKEN || "";
  if (!token) return null;
  try {
    const res = await fetchWithTimeout(
      `https://api.apify.com/v2/acts/maximedupre~gmail-username-checker/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targets: [canonical] }),
      },
      55000
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => String((r && r.email) || "").toLowerCase() === canonical)
      || rows.find((r) => String((r && r.username) || "").toLowerCase() === canonical.split("@")[0]);
    const status = String((row && row.availabilityStatus) || "").toLowerCase();
    if (status === "available") return true;
    if (status === "taken") return false;
    return null;
  } catch (_) { return null; }
}

async function isCustomEmailTaken(sql, value) {
  const [row] = await sql`SELECT id FROM codexa_custom_emails WHERE lower(requested) = ${value} LIMIT 1`;
  return Boolean(row);
}

/* Nama yang sudah pasti dipakai / dicadangkan Google & layanan besar.
   Dipakai untuk memblokir hasil "tersedia" palsu seperti test@gmail.com. */
const RESERVED_LOCALS = new Set([
  "test", "tester", "testing", "test123", "admin", "administrator", "root", "info",
  "support", "help", "helpdesk", "contact", "hello", "hi", "mail", "email", "gmail",
  "google", "youtube", "android", "abuse", "postmaster", "webmaster", "noreply",
  "no-reply", "security", "billing", "sales", "team", "office", "service", "user",
  "users", "demo", "example", "sample", "guest", "me", "you", "myself", "name",
  "developer", "dev", "official", "customerservice", "marketing", "news", "login",
  "password", "account", "accounts", "system", "server", "api", "bot", "spam",
]);

// Kata umum yang hampir pasti sudah dipakai kalau berdiri sendiri tanpa angka.
const COMMON_WORDS = [
  "john", "jane", "doe", "smith", "michael", "david", "maria", "anna", "andi",
  "budi", "agus", "rizky", "putri", "sari", "dewi", "love", "cool", "keren",
  "ganteng", "cantik", "gaming", "gamer", "music", "photo", "business", "shop",
  "store", "toko", "online", "indonesia", "jakarta", "bandung", "surabaya",
];

/* Blokir cepat nama yang sudah pasti dipakai/dicadangkan (hemat run Apify
   berbayar). Kasus lain diteruskan ke actor Apify untuk jawaban definitif. */
function gmailLikelyTaken(base) {
  if (RESERVED_LOCALS.has(base)) {
    return "Nama ini dicadangkan / sudah pasti dipakai Google. Pilih nama lain.";
  }
  const hasDigit = /[0-9]/.test(base);
  const stripped = base.replace(/[0-9]/g, "");
  if (COMMON_WORDS.includes(stripped) && (!hasDigit || /^[0-9]{1,2}$/.test(base.replace(/[^0-9]/g, "")))) {
    return "Kata ini terlalu umum, hampir pasti sudah dipakai. Tambahkan angka/nama unik.";
  }
  return "";
}

/* Cek lengkap: dipakai pembeli Akun Instan lain, aturan Gmail, heuristik nama
   umum/dicadangkan, lalu cek definitif ke pendaftaran Gmail via actor Apify
   (dengan cache). Kalau actor tidak bisa dijangkau, fallback ke jejak publik
   (Gravatar) + status "belum bisa dipastikan". */
async function inspectCustomEmail(sql, parsed) {
  const { value, local, domain } = parsed;
  const canonical = canonicalOf(local, domain);
  const isGoogle = GOOGLE_DOMAINS.includes(domain);
  const base = canonical.split("@")[0];
  const signals = [];

  await ensureCustomEmailTable(sql);
  const takenHere = (await isCustomEmailTaken(sql, value)) || (value !== canonical && await isCustomEmailTaken(sql, canonical));
  if (takenHere) {
    return { available: false, state: "taken", normalized: value, canonical, reason: "Sudah dipesan pembeli Akun Instan lain, pilih nama lain", signals: ["Sudah dipesan di Akun Instan"] };
  }
  signals.push("Belum dipesan di Akun Instan");

  if (isGoogle) {
    const policy = gmailPolicyError(local);
    if (policy) {
      return { available: false, state: "invalid", normalized: value, canonical, reason: `${policy} (aturan Gmail)`, signals };
    }
    signals.push("Lolos aturan penamaan Gmail");
  } else {
    const mx = await domainHasMx(domain);
    if (mx === false) {
      return { available: false, state: "invalid", normalized: value, canonical, reason: `Domain ${domain} tidak menerima email (tidak ada MX)`, signals };
    }
    if (mx) signals.push(`Domain ${domain} punya server email aktif`);
  }

  // Nama dicadangkan / terlalu umum → tolak sebelum cek jaringan.
  const likely = RESERVED_LOCALS.has(base)
    ? "Nama ini dicadangkan / sudah pasti dipakai. Pilih nama lain."
    : (isGoogle ? gmailLikelyTaken(base) : "");
  if (likely) {
    return {
      available: false, state: "taken", normalized: value, canonical,
      reason: likely,
      signals: [...signals, "Terdeteksi sebagai nama umum/dicadangkan"],
    };
  }

  if (isGoogle) {
    signals.push("Titik diabaikan Gmail, dicek sebagai " + canonical);

    // Cek definitif: cache dulu (hemat run berbayar), baru actor Apify.
    let status = await cachedGmailStatus(sql, canonical);
    if (status === undefined) {
      status = await apifyGmailAvailability(canonical);
      if (status === true || status === false) await rememberGmailStatus(sql, canonical, status);
    }
    if (status === false) {
      return {
        available: false, state: "taken", normalized: value, canonical,
        reason: `${canonical} sudah dipakai orang lain (dicek langsung ke Gmail)`,
        signals: [...signals, "Cek langsung ke pendaftaran Gmail → sudah dipakai"],
      };
    }
    if (status === true) {
      return {
        available: true, state: "available", normalized: value, canonical,
        reason: `${canonical} terverifikasi masih tersedia di Gmail`,
        signals: [...signals, "Cek langsung ke pendaftaran Gmail → tersedia"],
      };
    }

    // Actor tidak bisa dijangkau → fallback heuristik lama.
    const usedFallback = await gravatarUsed(canonical);
    if (usedFallback) {
      return { available: false, state: "taken", normalized: value, canonical, reason: "Alamat ini sudah dipakai orang lain (terdaftar di profil publik Gravatar)", signals: [...signals, "Terdaftar di Gravatar → sudah dimiliki orang"] };
    }
    signals.push(usedFallback === null ? "Cek jejak publik tidak bisa dijangkau" : "Tidak ada jejak pemakaian publik");
    signals.push("Cek langsung Gmail sedang tidak bisa dijangkau — final saat pembuatan akun");
    return {
      available: true,
      state: "unknown",
      normalized: value,
      canonical,
      reason: `${value} belum bisa dipastikan bebas — kalau ternyata sudah dipakai, admin akan hubungi kamu untuk ganti nama`,
      signals,
    };
  }

  const used = await gravatarUsed(canonical);
  if (used) {
    return { available: false, state: "taken", normalized: value, canonical, reason: "Alamat ini sudah dipakai orang lain (terdaftar di profil publik Gravatar)", signals: [...signals, "Terdaftar di Gravatar → sudah dimiliki orang"] };
  }
  signals.push(used === null ? "Cek jejak publik tidak bisa dijangkau" : "Tidak ada jejak pemakaian publik");
  return {
    available: true,
    state: "available",
    normalized: value,
    canonical,
    reason: `${value} kemungkinan besar masih bebas dipakai`,
    signals,
  };
}

// Kumpulkan daftar custom email dari body (baru: customEmails[], lama: customEmail).
function normalizeCustomEmailList(payload) {
  const raw = Array.isArray(payload.customEmails)
    ? payload.customEmails
    : [payload.customEmail];
  const checks = [];
  const seen = new Set();
  for (const entry of raw) {
    const check = normalizeCustomEmail(entry);
    if (!check.ok) return { ok: false, error: check.error, checks: [] };
    if (!check.value) continue;
    if (seen.has(check.value)) continue;
    seen.add(check.value);
    checks.push(check);
    if (checks.length > MAX_CUSTOM_EMAILS) {
      return { ok: false, error: `Maksimal ${MAX_CUSTOM_EMAILS} custom email dalam satu tugas`, checks: [] };
    }
  }
  return { ok: true, error: "", checks };
}

const CUSTOM_PROFILE_GENDERS = ["male", "female", "other"];
const NAME_RE = /^[A-Za-z'.\- ]{2,40}$/;

// Validasi data pemilik akun yang dipakai admin saat membuat Gmail baru.
function normalizeCustomProfileEntry(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const clean = (v, n) => String(v == null ? "" : v).trim().replace(/\s+/g, " ").slice(0, n);
  const firstName = clean(o.firstName, 40);
  const lastName = clean(o.lastName, 40);
  const gender = clean(o.gender, 12).toLowerCase();
  const birthDate = clean(o.birthDate, 10);
  if (!NAME_RE.test(firstName)) return { ok: false, error: "nama depan wajib diisi (2-40 huruf)" };
  if (!NAME_RE.test(lastName)) return { ok: false, error: "nama belakang wajib diisi (2-40 huruf)" };
  if (!CUSTOM_PROFILE_GENDERS.includes(gender)) return { ok: false, error: "jenis kelamin wajib dipilih" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { ok: false, error: "tanggal lahir wajib diisi" };
  const stamp = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(stamp.getTime())) return { ok: false, error: "tanggal lahir tidak valid" };
  const year = Number(birthDate.slice(0, 4));
  const maxYear = new Date().getUTCFullYear() - 10;
  if (year < 1920 || year > maxYear) return { ok: false, error: "tanggal lahir tidak wajar (usia minimal 10 tahun)" };
  return { ok: true, profile: { firstName, lastName, birthDate, gender } };
}

function normalizeCustomProfiles(payload) {
  const raw = Array.isArray(payload.customProfiles) ? payload.customProfiles : [];
  const map = new Map();
  for (const entry of raw.slice(0, MAX_CUSTOM_EMAILS + 2)) {
    const check = normalizeCustomEmail(entry && (entry.email || entry.requested));
    if (!check.ok || !check.value) continue;
    const prof = normalizeCustomProfileEntry(entry);
    if (!prof.ok) return { ok: false, error: `${check.value}: ${prof.error}`, map: new Map() };
    map.set(check.value, prof.profile);
  }
  return { ok: true, error: "", map };
}

function parseCustomProfile(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) { return null; }
}

async function openCustomEmails(sql, userId) {
  await ensureCustomEmailTable(sql);
  return sql`
    SELECT id, requested, status, order_id AS "orderId", created_at AS "createdAt"
    FROM codexa_custom_emails
    WHERE user_id = ${userId} AND status = ANY(${OPEN_CUSTOM_STATUS})
    ORDER BY created_at DESC
  `;
}

const { readCustomEmailFee } = require("./_custom-email-fee");

const MAX_ITEMS = 50;
const MAX_PICKS_PER_ITEM = 100;

function normalizeItems(body) {
  // Batasi jumlah listing & akun per request supaya tidak bisa dipakai
  // membanjiri server dengan ribuan query berurutan.
  const raw = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS);
  const merged = new Map();
  for (const item of raw) {
    const id = typeof item?.id === "string" ? item.id.trim().slice(0, 160) : "";
    if (!id) continue;
    const picks = Array.isArray(item.accounts) ? item.accounts : [];
    const indexes = picks
      .map((n) => Math.round(Number(n)))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 500);
    if (!indexes.length) continue;
    const set = merged.get(id) || new Set();
    indexes.slice(0, MAX_PICKS_PER_ITEM).forEach((n) => set.add(n));
    merged.set(id, set);
  }
  return [...merged.entries()].map(([id, set]) => ({ id, indexes: [...set].sort((a, b) => a - b) }));
}

// Ringkasan pesanan untuk panel admin (kredensial tetap disamarkan).
function maskEmail(value) {
  const raw = String(value || "");
  const [name, domain] = raw.split("@");
  if (!domain) return raw ? `${raw.slice(0, 2)}***` : "-";
  return `${name.slice(0, 2)}***@${domain}`;
}

async function handleAdmin(sql, request, response) {
  // Admin juga boleh memakai pengecekan ketersediaan email (menu Buat Akun Google).
  if (String((request.query && request.query.resource) || "") === "check-email") {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ error: "Method not allowed" });
    }
    const check = normalizeCustomEmail((request.query && request.query.value) || "");
    if (!check.ok) return response.status(200).json({ available: false, state: "invalid", normalized: "", reason: check.error, signals: [] });
    if (!check.value) return response.status(200).json({ available: false, state: "idle", normalized: "", reason: "Isi dulu nama yang diinginkan", signals: [] });
    const result = await inspectCustomEmail(sql, check);
    return response.status(200).json(result);
  }
  if (request.method === "GET") {

    const rows = await sql`
      SELECT o.id, o.total, o.item_count AS "itemCount", o.status, o.payload_blob AS "payloadBlob",
             o.created_at AS "createdAt",
             u.id AS "userId", u.name AS "userName", u.email AS "userEmail",
             u.phone AS "userPhone", u.balance AS "userBalance"
      FROM codexa_orders o JOIN codexa_users u ON u.id = o.user_id
      ORDER BY o.created_at DESC LIMIT 100
    `;
    let customByOrder = new Map();
    try {
      await ensureCustomEmailTable(sql);
      const custom = await sql`SELECT id, order_id AS "orderId", requested, status, result_password AS "password", note, profile, created_at AS "createdAt" FROM codexa_custom_emails WHERE order_id IS NOT NULL ORDER BY created_at ASC`;
      for (const c of custom) {
        const list = customByOrder.get(c.orderId) || [];
        list.push({ id: c.id, requested: c.requested, status: c.status || "pending", password: c.password || "", note: c.note || "", profile: parseCustomProfile(c.profile) });
        customByOrder.set(c.orderId, list);
      }
    } catch (_) { customByOrder = new Map(); }
    /* Status serah terima akun Google per pesanan: pembeli sudah klik "Selesai, akun aman"
       (secured_at) dan/atau sudah minta kode verifikasi (code_ticket -> laporan kode). */
    let handoverByOrder = new Map();
    try {
      const handRows = await sql`SELECT order_id AS "orderId", secured_at AS "securedAt", code_ticket AS "codeTicket" FROM codexa_google_handover`;
      const codeReports = await sql`SELECT ticket, status, admin_note AS "adminNote" FROM codexa_reports WHERE category = 'kode_login'`;
      const byTicket = new Map(codeReports.map((r) => [r.ticket, r]));
      for (const h of handRows) {
        const r = h.codeTicket ? byTicket.get(h.codeTicket) : null;
        handoverByOrder.set(h.orderId, {
          secured: !!(h.securedAt),
          securedAt: h.securedAt || "",
          ticket: h.codeTicket || "",
          codeStatus: r ? (r.status || "open") : (h.codeTicket ? "open" : ""),
          adminNote: (r && r.adminNote) || "",
        });
      }
    } catch (_) { handoverByOrder = new Map(); }
    // Ringkasan dari seluruh pesanan lunas, bukan dari status listing (produk
    // etalase juga berstatus sold) atau hanya 100 pesanan yang ditampilkan.
    // Jumlahkan harga akun yang benar-benar dibeli, tanpa biaya email kustom.
    const paidRows = await sql`SELECT payload_blob AS "payloadBlob" FROM codexa_orders WHERE status = 'paid'`;
    const salesSummary = { accounts: 0, revenue: 0 };
    for (const paid of paidRows) {
      try {
        const items = (decryptCredentials(paid.payloadBlob) || {}).items || [];
        for (const item of items) {
          if (/^(etl-|demo-)/.test(String(item.listingId || ""))) continue;
          for (const account of (item.accounts || [])) {
            salesSummary.accounts += 1;
            salesSummary.revenue += Number(account.price) || 0;
          }
        }
      } catch (error) { console.error("Sales summary order unreadable", error && error.message); }
    }
    const orders = rows.map((row) => {
      let items = [];
      try { items = (decryptCredentials(row.payloadBlob) || {}).items || []; } catch (_) { items = []; }
      const customList = customByOrder.get(row.id) || [];
      const custom = customList[0];
      return {
        id: row.id,
        total: Number(row.total) || 0,
        itemCount: row.itemCount,
        status: row.status,
        createdAt: row.createdAt,
        customEmails: customList,
        customEmail: (custom && custom.requested) || "",
        customEmailStatus: (custom && custom.status) || "",
        handover: handoverByOrder.get(row.id) || { secured: false, securedAt: "", ticket: "", codeStatus: "", adminNote: "" },
        buyer: {
          id: row.userId, name: row.userName, email: row.userEmail,
          phone: row.userPhone || "", balance: Number(row.userBalance) || 0,
        },
        items: items.map((item) => ({
          title: item.title || "Listing",
          loginType: item.loginType || "-",
          accounts: (item.accounts || []).map((a) => ({ index: a.index, email: maskEmail(a.email), price: Number(a.price) || 0 })),
        })),
      };
    });
    return response.status(200).json({ orders, salesSummary });
  }
  if (request.method === "PATCH") {
    // Update status / password / catatan permintaan custom email dari panel admin.
    const body = bodyOf(request) || {};
    const requestId = String(body.id || "").trim().slice(0, 60);
    const orderId = String(body.orderId || "").trim().slice(0, 60);
    const status = String(body.status || "").trim();
    const hasPassword = Object.prototype.hasOwnProperty.call(body, "password");
    const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
    const password = String(body.password == null ? "" : body.password).trim().slice(0, 120);
    const note = String(body.note == null ? "" : body.note).trim().slice(0, 600);
    if (!requestId && !orderId) {
      return response.status(400).json({ error: "id permintaan custom email wajib diisi" });
    }
    if (status && !CUSTOM_EMAIL_STATUS.includes(status)) {
      return response.status(400).json({ error: "Status tidak valid" });
    }
    if (!status && !hasPassword && !hasNote) {
      return response.status(400).json({ error: "Tidak ada perubahan yang dikirim" });
    }
    await ensureCustomEmailTable(sql);
    const [existing] = requestId
      ? await sql`SELECT id, user_id AS "userId", requested, status, result_password AS "password", note
                  FROM codexa_custom_emails WHERE id = ${requestId} LIMIT 1`
      : await sql`SELECT id, user_id AS "userId", requested, status, result_password AS "password", note
                  FROM codexa_custom_emails WHERE order_id = ${orderId} ORDER BY created_at ASC LIMIT 1`;
    if (!existing) return response.status(404).json({ error: "Permintaan custom email tidak ditemukan" });

    const nextStatus = status || existing.status || "pending";
    const nextPassword = hasPassword ? password : (existing.password || "");
    const nextNote = hasNote ? note : (existing.note || "");
    const [row] = await sql`
      UPDATE codexa_custom_emails
      SET status = ${nextStatus}, result_password = ${nextPassword}, note = ${nextNote}
      WHERE id = ${existing.id}
      RETURNING id, order_id AS "orderId", requested, status, result_password AS "password", note
    `;
    try {
      const changed = [];
      if (status && status !== existing.status) changed.push(`status menjadi ${status}`);
      if (hasPassword && nextPassword !== (existing.password || "")) changed.push("password akun sudah dikirim");
      if (hasNote && nextNote !== (existing.note || "")) changed.push("ada catatan baru dari admin");
      await createNotification(sql, {
        userId: existing.userId,
        type: "custom_email",
        title: "Custom email diperbarui",
        body: `Permintaan ${row.requested}: ${changed.length ? changed.join(", ") : "diperbarui admin"}. Buka Pesanan Saya untuk melihat detailnya.`,
        link: "orders",
      });
    } catch (_) {}
    return response.status(200).json({ custom: { ...row, password: row.password || "", note: row.note || "" } });
  }
  if (request.method === "DELETE") {
    const id = String((bodyOf(request) || {}).id || "").trim().slice(0, 60);
    if (!id) return response.status(400).json({ error: "id pesanan wajib diisi" });
    const [row] = await sql`DELETE FROM codexa_orders WHERE id = ${id} RETURNING id`;
    if (!row) return response.status(404).json({ error: "Pesanan tidak ditemukan" });
    return response.status(200).json({ deleted: row.id });
  }
  response.setHeader("Allow", "GET, PATCH, DELETE");
  return response.status(405).json({ error: "Method not allowed" });
}


module.exports = async function handler(request, response) {
  try {
    const sql = db();
    await Promise.all([ensureTables(sql), ensureOrderTables(sql)]);
    const adminScope = String((request.query && request.query.scope) || "") === "admin";
    if (adminScope) {
      if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });
      return await handleAdmin(sql, request, response);
    }

    const user = await currentUser(sql, request);
    if (!user) return response.status(401).json({ error: "Silakan masuk terlebih dahulu" });

    const resource = String((request.query && request.query.resource) || "");
    if (resource === "check-email") {
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed" });
      }
      const check = normalizeCustomEmail((request.query && request.query.value) || "");
      if (!check.ok) return response.status(200).json({ available: false, state: "invalid", normalized: "", reason: check.error, signals: [] });
      if (!check.value) return response.status(200).json({ available: false, state: "idle", normalized: "", reason: "Isi dulu nama yang diinginkan", signals: [] });
      const result = await inspectCustomEmail(sql, check);
      return response.status(200).json(result);

    }

    if (resource === "secret") {
      // Password asli hanya keluar lewat sini, per pesanan, milik user sendiri.
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return response.status(405).json({ error: "Method not allowed" });
      }
      const body = bodyOf(request) || {};
      const customId = String(body.customId || "").trim().slice(0, 60);
      if (customId) {
        await ensureCustomEmailTable(sql);
        const [row] = await sql`
          SELECT id, result_password AS "password" FROM codexa_custom_emails
          WHERE id = ${customId} AND user_id = ${user.id} LIMIT 1
        `;
        if (!row) return response.status(404).json({ error: "Permintaan tidak ditemukan" });
        if (!row.password) return response.status(404).json({ error: "Password belum tersedia" });
        await markRevealed(sql, user.id, `custom:${row.id}`);
        return response.status(200).json({ password: row.password });
      }

      const orderId = String(body.orderId || "").trim().slice(0, 60);
      const itemIndex = Math.round(Number(body.itemIndex));
      const accountIndex = Math.round(Number(body.accountIndex));
      if (!orderId || !Number.isInteger(itemIndex) || !Number.isInteger(accountIndex)) {
        return response.status(400).json({ error: "Permintaan tidak lengkap" });
      }
      const [order] = await sql`
        SELECT id, payload_blob AS "payloadBlob" FROM codexa_orders
        WHERE id = ${orderId} AND user_id = ${user.id} LIMIT 1
      `;
      if (!order) return response.status(404).json({ error: "Pesanan tidak ditemukan" });
      let items = [];
      try { items = decryptCredentials(order.payloadBlob).items || []; } catch (_) { items = []; }
      const account = ((items[itemIndex] || {}).accounts || [])[accountIndex];
      if (!account || !account.password) return response.status(404).json({ error: "Detail akun tidak ditemukan" });
      await markRevealed(sql, user.id, `order:${order.id}:${itemIndex}:${accountIndex}`);
      return response.status(200).json({ password: account.password });
    }

    if (resource === "custom-status") {
      // Kuota tugas custom email: berapa yang masih jalan & apakah boleh beli lagi.
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return response.status(405).json({ error: "Method not allowed" });
      }
      let open = [];
      try { open = await openCustomEmails(sql, user.id); } catch (_) { open = []; }
      return response.status(200).json({
        max: MAX_CUSTOM_EMAILS,
        fee: await readCustomEmailFee(sql),
        open: open.map((r) => ({ id: r.id, requested: r.requested, status: r.status || "pending", createdAt: r.createdAt })),
        canOrder: open.length === 0,
      });
    }

    if (request.method === "GET") {
      const rows = await sql`
        SELECT id, total, item_count AS "itemCount", status, payload_blob AS "payloadBlob", created_at AS "createdAt"
        FROM codexa_orders WHERE user_id = ${user.id} ORDER BY created_at DESC LIMIT 50
      `;
      let mine = new Map();
      try {
        await ensureCustomEmailTable(sql);
        const custom = await sql`SELECT id, order_id AS "orderId", requested, status, result_password AS "password", note, profile, created_at AS "createdAt" FROM codexa_custom_emails WHERE user_id = ${user.id} AND order_id IS NOT NULL ORDER BY created_at ASC`;
        for (const c of custom) {
          const list = mine.get(c.orderId) || [];
          list.push({
            id: c.id, requested: c.requested, status: c.status || "pending",
            hasPassword: !!c.password, maskedPassword: maskSecret(c.password),
            note: c.note || "", profile: parseCustomProfile(c.profile),
          });
          mine.set(c.orderId, list);
        }
      } catch (_) { mine = new Map(); }
      const orders = rows.map((row) => {
        let items = [];
        try { items = decryptCredentials(row.payloadBlob).items || []; } catch (_) { items = []; }
        // Password tidak ikut dikirim di listing; hanya versi tersamar.
        const safeItems = items.map((item) => ({
          ...item,
          accounts: (item.accounts || []).map((a) => ({
            index: a.index, email: a.email, price: a.price,
            hasPassword: !!a.password, maskedPassword: maskSecret(a.password),
          })),
        }));
        const customList = mine.get(row.id) || [];
        const custom = customList[0];
        return {
          id: row.id,
          total: Number(row.total) || 0,
          itemCount: row.itemCount,
          status: row.status,
          createdAt: row.createdAt,
          customEmails: customList,
          customEmail: (custom && custom.requested) || "",
          customEmailStatus: (custom && custom.status) || "",
          items: safeItems,
        };
      });
      return response.status(200).json({ orders, balance: user.balance });

    }

    if (request.method === "DELETE") {
      const id = String((bodyOf(request) || {}).id || "").trim().slice(0, 60);
      if (!id) return response.status(400).json({ error: "id pesanan wajib diisi" });
      const [row] = await sql`DELETE FROM codexa_orders WHERE id = ${id} AND user_id = ${user.id} RETURNING id`;
      if (!row) return response.status(404).json({ error: "Pesanan tidak ditemukan" });
      return response.status(200).json({ deleted: row.id });
    }

    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, DELETE");
      return response.status(405).json({ error: "Method not allowed" });
    }

    const payload = bodyOf(request) || {};
    const items = normalizeItems(payload);

    const customList = normalizeCustomEmailList(payload);
    if (!customList.ok) return response.status(400).json({ error: customList.error });
    const customChecks = customList.checks;
    const customEmails = customChecks.map((c) => c.value);
    const customEmail = customEmails[0] || "";

    // Data pemilik akun (seperti form pendaftaran Gmail) wajib lengkap per nama.
    const profileList = normalizeCustomProfiles(payload);
    if (!profileList.ok) return response.status(400).json({ error: profileList.error });
    const profileMap = profileList.map;
    for (const value of customEmails) {
      if (!profileMap.has(value)) {
        return response.status(400).json({
          error: `Lengkapi data pemilik akun (nama depan, nama belakang, tanggal lahir, jenis kelamin) untuk ${value}`,
        });
      }
    }

    // Custom email boleh dibeli sendiri tanpa akun di keranjang.
    if (!items.length && !customEmails.length) {
      return response.status(400).json({ error: "Keranjang kosong atau belum ada akun yang dipilih" });
    }

    if (customEmails.length) {
      // Tugas sebelumnya harus selesai dulu sebelum beli custom email lagi.
      let open = [];
      try { open = await openCustomEmails(sql, user.id); } catch (_) { open = []; }
      if (open.length) {
        return response.status(409).json({
          error: `Masih ada ${open.length} permintaan custom email yang belum selesai (${open.map((r) => r.requested).join(", ")}). Tunggu admin menyelesaikannya dulu.`,
          customEmailBlocked: true,
        });
      }
      for (const check of customChecks) {
        const inspection = await inspectCustomEmail(sql, check);
        if (!inspection.available) return response.status(409).json({ error: `${check.value}: ${inspection.reason}` });
      }
    }


    // Ambil listing yang dibeli, validasi ketersediaan & hitung total
    const purchases = [];
    const agedCfg = await readAgedConfig(sql);
    let total = 0;
    for (const item of items) {
      const [row] = await sql`
        SELECT id, title, login_type AS "loginType", price, status, credential_blob AS "credentialBlob"
        FROM codexa_account_listings WHERE id = ${item.id} LIMIT 1
      `;
      if (!row) return response.status(404).json({ error: "Salah satu listing sudah tidak tersedia", failedItemId: item.id });
      if (row.status !== "available") {
        return response.status(409).json({ error: `${row.title} sudah tidak tersedia`, failedItemId: row.id });
      }
      let credentials;
      try { credentials = decryptCredentials(row.credentialBlob); }
      catch (_) { return response.status(500).json({ error: "Kredensial listing tidak bisa dibaca" }); }
      const accounts = accountsOf(credentials, row.price, agedCfg);
      const taken = [];
      for (const index of item.indexes) {
        const account = accounts[index - 1];
        if (!account) {
          return response.status(409).json({ error: `Stok ${row.title} sudah berubah, muat ulang katalog`, failedItemId: row.id });
        }
        taken.push({ index, ...account });
        total += account.price;
      }
      const remaining = accounts.filter((_, i) => !item.indexes.includes(i + 1));
      purchases.push({ row, credentials, accounts, taken, remaining });
    }

    // Permintaan email/username khusus dikenakan biaya tetap.
    const customEmailFee = customEmails.length ? await readCustomEmailFee(sql, { fresh: true }) : 0;
    total += customEmails.length * customEmailFee;

    const payWithPoints = bodyOf(request).payWith === "points";
    if (!payWithPoints && total > user.balance) {
      return response.status(402).json({
        error: `Saldo tidak cukup. Butuh Rp${total.toLocaleString("id-ID")}, saldo kamu Rp${user.balance.toLocaleString("id-ID")}`,
        needTopup: true,
      });
    }

    /* Klaim akun dulu pakai compare-and-swap: UPDATE hanya jalan kalau
       credential_blob masih sama dengan yang kita baca. Dua checkout
       bersamaan untuk akun yang sama membuat yang kedua gagal, jadi satu
       akun tidak bisa terjual dua kali. */
    const orderItems = [];
    const claimed = [];
    const rollbackClaims = async () => {
      for (const c of claimed) {
        await sql`
          UPDATE codexa_account_listings
          SET credential_blob = ${c.blob}, stock = ${c.stock}, price = ${c.price},
              status = ${c.status}, updated_at = NOW()
          WHERE id = ${c.id}
        `;
      }
    };

    for (const purchase of purchases) {
      const { row, credentials, accounts, taken, remaining } = purchase;
      /* Simpan kembali dalam bentuk asli (harga dasar + tanggal buat akun),
         supaya bonus umur tidak ikut tersimpan jadi harga dasar. */
      const remainingRaw = remaining.map((a) => ({
        email: a.email,
        password: a.password,
        price: Number.isFinite(a.basePrice) ? a.basePrice : Number(a.price) || 0,
        ...(a.createdAt ? { createdAt: a.createdAt } : {}),
      }));
      const nextCredentials = { ...credentials, accounts: remainingRaw };
      const nextStock = remaining.length;
      const nextPrice = remaining.length ? Math.min(...remaining.map((a) => a.price)) : Number(row.price) || 0;
      const nextStatus = remaining.length ? "available" : "sold";
      const [claimedRow] = await sql`
        UPDATE codexa_account_listings
        SET credential_blob = ${encryptCredentials(nextCredentials)},
            stock = ${nextStock}, price = ${nextPrice}, status = ${nextStatus}, updated_at = NOW()
        WHERE id = ${row.id} AND status = 'available' AND credential_blob = ${row.credentialBlob}
        RETURNING id
      `;
      if (!claimedRow) {
        await rollbackClaims();
        return response.status(409).json({
          error: `${row.title} baru saja dibeli orang lain, muat ulang katalog`,
        });
      }
      claimed.push({
        id: row.id,
        blob: row.credentialBlob,
        stock: accounts.length,
        price: Number(row.price) || 0,
        status: row.status,
      });
      orderItems.push({
        listingId: row.id,
        title: row.title,
        loginType: row.loginType,
        deliveryDetails: credentials.deliveryDetails || (/google/i.test(row.loginType || "") ? GOOGLE_SECURITY_GUIDE : ""),
        accounts: taken.map((a) => ({ email: a.email, password: a.password, price: a.price })),
      });
    }

    /* Nama custom email dikunci SEBELUM saldo dipotong. Unique index
       lower(requested) yang jadi kuncinya: kalau nama direbut orang lain di
       antara pengecekan dan pembayaran, insert gagal dan pembeli tidak
       kehilangan saldo. (Sebelumnya insert dijalankan setelah saldo dipotong
       dengan ON CONFLICT DO NOTHING, jadi user bisa terbayar tanpa
       permintaan custom email tercatat sama sekali.) */
    const reserved = [];
    const releaseReserved = async () => {
      for (const r of reserved) {
        try { await sql`DELETE FROM codexa_custom_emails WHERE id = ${r.id}`; } catch (_) {}
      }
    };
    for (const requested of customEmails) {
      const reserveId = crypto.randomUUID();
      const profileJson = JSON.stringify(profileMap.get(requested) || {});
      const [reservedRow] = await sql`
        INSERT INTO codexa_custom_emails (id, user_id, order_id, requested, status, profile)
        VALUES (${reserveId}, ${user.id}, NULL, ${requested}, 'pending', ${profileJson})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      if (!reservedRow) {
        await releaseReserved();
        await rollbackClaims();
        return response.status(409).json({
          error: `${requested} baru saja dipesan pembeli lain, pilih nama lain`,
        });
      }
      reserved.push({ id: reserveId, requested, profile: profileMap.get(requested) || null });
    }

    // Akun & nama sudah dikunci untuk pembeli ini, baru potong saldo / poin.
    let debited;
    let pointsSpent = 0;
    if (payWithPoints) {
      const spend = await spendPoints(sql, user.id, total, `Tukar poin untuk pesanan Rp${total.toLocaleString("id-ID")}`);
      if (spend.error) {
        await releaseReserved();
        await rollbackClaims();
        return response.status(402).json({ error: spend.error });
      }
      pointsSpent = spend.spent;
      debited = { balance: user.balance };
    } else {
      [debited] = await sql`
        UPDATE codexa_users SET balance = balance - ${total}
        WHERE id = ${user.id} AND balance >= ${total}
        RETURNING balance
      `;
    }
    if (!debited) {
      await releaseReserved();
      await rollbackClaims();
      return response.status(402).json({ error: "Saldo tidak cukup", needTopup: true });
    }

    const orderId = crypto.randomUUID();
    const itemCount = orderItems.reduce((sum, i) => sum + i.accounts.length, 0);
    let order;
    try {
      [order] = await sql`
        INSERT INTO codexa_orders (id, user_id, total, item_count, payload_blob)
        VALUES (${orderId}, ${user.id}, ${total}, ${itemCount}, ${encryptCredentials({ items: orderItems })})
        RETURNING id, total, item_count AS "itemCount", status, created_at AS "createdAt"
      `;
    } catch (error) {
      // Pesanan gagal dicatat → kembalikan saldo, nama, dan akun.
      if (pointsSpent) await refundPoints(sql, user.id, pointsSpent);
      else await sql`UPDATE codexa_users SET balance = balance + ${total} WHERE id = ${user.id}`;
      await releaseReserved();
      await rollbackClaims();
      throw error;
    }

    /* Akun Google yang terhubung ke checker → otomatis SOLD + token checker dicabut. */
    try {
      await require("./_google-checker").markSoldByEmails(sql, orderItems.flatMap((i) => i.accounts.map((a) => a.email)));
    } catch (error) { console.error("Google checker sold sync failed", error && error.message); }

    // Nama yang sudah dikunci ditempelkan ke pesanan yang baru dibuat.
    const customRecords = [];
    for (const r of reserved) {
      try {
        await sql`UPDATE codexa_custom_emails SET order_id = ${order.id} WHERE id = ${r.id}`;
      } catch (error) {
        console.error("Custom email attach failure", error && error.message);
      }
      customRecords.push({ id: r.id, requested: r.requested, status: "pending", profile: r.profile });
    }

    /* Counter "terjual" per listing untuk ditampilkan di katalog.
       Best-effort: kegagalan di sini tidak boleh membatalkan pesanan. */
    try {
      await sql`
        CREATE TABLE IF NOT EXISTS codexa_listing_sales (
          listing_id TEXT PRIMARY KEY,
          sold_count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      for (const item of orderItems) {
        const qty = Array.isArray(item.accounts) ? item.accounts.length : 0;
        if (!qty) continue;
        await sql`
          INSERT INTO codexa_listing_sales (listing_id, sold_count)
          VALUES (${item.listingId}, ${qty})
          ON CONFLICT (listing_id)
          DO UPDATE SET sold_count = codexa_listing_sales.sold_count + ${qty}, updated_at = NOW()
        `;
      }
    } catch (error) {
      console.error("Sold counter update failure", error && error.message);
    }


    await createNotification(sql, {
      userId: user.id,
      type: "order_paid",
      title: "Pembelian berhasil",
      body: itemCount
        ? `${itemCount} akun senilai Rp${total.toLocaleString("id-ID")} sudah dibayar. Detail login bisa dilihat di halaman Pesanan.`
        : `Permintaan custom email ${customEmails.join(", ")} senilai Rp${total.toLocaleString("id-ID")} sudah dibayar dan sedang diproses admin.`,
      link: "orders",
    });

    return response.status(201).json({
      order: {
        ...order,
        total: Number(order.total) || 0,
        items: orderItems,
        customEmails: customRecords,
        customEmail,
        customEmailStatus: customEmail ? "pending" : "",
      },
      balance: Number(debited.balance) || 0,
      pointsSpent,
    });
  } catch (error) {
    console.error("Checkout failure", error && error.message);
    const message = error && error.message === "ACCOUNT_CREDENTIALS_KEY is not configured"
      ? "Kunci enkripsi kredensial belum dikonfigurasi"
      : "Checkout gagal diproses";
    return response.status(500).json({ error: message });
  }
};
