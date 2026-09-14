const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { isAdmin } = require("./_auth");
const { handleReviewRequest } = require("../_reviews");
const { effectiveAccountPrice, agedInfo, readAgedConfig, DEFAULT_AGED_CONFIG } = require("../_aged");

const LOGIN_TYPES = new Set(["Google", "Facebook", "Email/password", "Apple", "Microsoft", "Lainnya"]);
const STATUSES = new Set(["available", "sold"]);
function bodyOf(request) { if (typeof request.body === "string") return JSON.parse(request.body || "{}"); return request.body || {}; }
function text(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function key() { return process.env.ACCOUNT_CREDENTIALS_KEY || ""; }
function cipherKey() { return crypto.createHash("sha256").update(key()).digest(); }
function encryptCredentials(value) {
  if (!key()) throw new Error("ACCOUNT_CREDENTIALS_KEY is not configured");
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", cipherKey(), iv);
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
function accountPrice(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  return Math.max(0, Math.round(Number(fallback) || 0));
}
/* Tanggal pembuatan akun (YYYY-MM-DD) untuk sistem harga aged. */
function agedDate(value) {
  const raw = text(value, 40);
  if (!raw) return "";
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t) || t > Date.now() + 86400000) return "";
  return new Date(t).toISOString().slice(0, 10);
}
function normalizeAccounts(body, basePrice) {
  const raw = Array.isArray(body.accounts) ? body.accounts : [];
  const list = raw
    .map((item) => ({
      email: text(item && (item.email || item.username), 320),
      password: text(item && item.password, 500),
      price: accountPrice(item && item.price, basePrice),
      createdAt: agedDate(item && (item.createdAt || item.accountCreatedAt)),
    }))
    .filter((item) => item.email || item.password);
  if (list.length) return list;
  // Kompatibilitas format lama: satu kredensial per listing
  const legacy = {
    email: text(body.email, 320) || text(body.username, 320),
    password: text(body.password, 500),
    price: accountPrice(body.price, basePrice),
  };
  return legacy.email || legacy.password ? [legacy] : [];
}

function validate(body, requireId = false) {
  const id = text(body.id, 160); const title = text(body.title, 160); const description = text(body.description, 500);
  const loginType = text(body.loginType, 40); const status = text(body.status || "available", 20);
  const accounts = normalizeAccounts(body, body.price);
  const stock = accounts.length;
  // Harga listing = harga akun termurah (harga per akun diatur admin di tiap baris)
  const price = accounts.length ? Math.min(...accounts.map((a) => a.price)) : Number(body.price);
  if (requireId && !id) return { error: "id listing wajib diisi" };
  if (!title) return { error: "Nama listing wajib diisi" };
  if (!LOGIN_TYPES.has(loginType)) return { error: "Tipe login tidak valid" };
  if (!Number.isInteger(price) || price < 0) return { error: "Harga harus berupa angka bulat positif" };
  if (!STATUSES.has(status)) return { error: "Status listing tidak valid" };
  if (!accounts.length) return { error: "Minimal 1 data akun (email & password) wajib diisi" };
  if (accounts.some((a) => !a.email || !a.password)) return { error: "Setiap data akun harus punya email dan password" };
  if (accounts.some((a) => !Number.isInteger(a.price) || a.price < 0)) return { error: "Harga tiap akun harus angka bulat positif" };
  const seen = new Set();
  for (const a of accounts) { const k = a.email.toLowerCase(); if (seen.has(k)) return { error: `Email duplikat: ${a.email}` }; seen.add(k); }
  return { id, title, description, loginType, price, stock, status, credentials: { accounts, agedPricing: body.agedPricing !== false, deliveryDetails: text(body.deliveryDetails, 3000) } };
}

async function ensureTable(sql) { await sql`CREATE TABLE IF NOT EXISTS codexa_account_listings (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', login_type TEXT NOT NULL, price BIGINT NOT NULL DEFAULT 0, stock INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')), credential_blob TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`; }
function withAccounts(credentials, basePrice, agedCfg) {
  const cfg = agedCfg || DEFAULT_AGED_CONFIG;
  const c = credentials || {};
  const fallback = Math.max(0, Math.round(Number(basePrice) || 0));
  if (Array.isArray(c.accounts) && c.accounts.length) {
    const aged = c.agedPricing !== false && cfg.enabled !== false;
    return { ...c, agedPricing: aged, accounts: c.accounts.map((a) => {
      const info = aged ? agedInfo(a.createdAt, cfg) : { days: null, bonus: 0, label: "" };
      return {
        email: a.email || a.username || "",
        password: a.password || "",
        price: accountPrice(a.price, fallback),
        createdAt: a.createdAt || "",
        agedDays: info.days,
        agedLabel: info.label,
        agedBonus: info.bonus,
        agedPrice: effectiveAccountPrice(a, fallback, aged, cfg),
      };
    }) };
  }
  const legacy = { email: c.email || c.username || "", password: c.password || "", price: fallback };
  return { accounts: legacy.email || legacy.password ? [legacy] : [], deliveryDetails: c.deliveryDetails || "" };
}

function view(row, agedCfg) {
  const credentials = withAccounts(row.credentials, row.price, agedCfg);
  return { id: row.id, title: row.title, description: row.description, loginType: row.loginType, price: Number(row.price), stock: credentials.accounts.length, status: row.status, agedPricing: credentials.agedPricing !== false, accounts: credentials.accounts, deliveryDetails: credentials.deliveryDetails || "", createdAt: row.createdAt, updatedAt: row.updatedAt };
}
/* ── Produk etalase (inject) ────────────────────────────────────────────
   Listing hasil inject selalu berstatus "sold" tanpa akun sama sekali,
   jadi selalu tampil sebagai stok habis dan tidak pernah bisa dibeli.
   Judul, deskripsi, dan harga dibuat menyerupai listing asli. */
const DEMO_PREFIX = "etl-";
const LEGACY_DEMO_PREFIX = "demo-";
const DEMO_TEMPLATES = [
  /* ── Email ── */
  { key: "gmail", group: "Email", label: "Gmail", loginType: "Google", min: 7000, max: 22000,
    titles: ["Gmail Fresh Verified", "Gmail Aged 2019", "Gmail Aged 2021", "Gmail Recovery Aktif", "Gmail Siap Pakai"],
    notes: ["Recovery email aktif", "Sudah verifikasi nomor", "Belum pernah dipakai login", "Aman untuk pendaftaran layanan"] },
  { key: "outlook", group: "Email", label: "Outlook / Hotmail", loginType: "Microsoft", min: 5000, max: 16000,
    titles: ["Outlook Fresh Verified", "Hotmail Aged 2017", "Outlook Siap Pakai", "Outlook Recovery Aktif"],
    notes: ["Bisa dipakai untuk Office", "Recovery email diserahkan", "Aman untuk verifikasi layanan"] },
  { key: "yahoo", group: "Email", label: "Yahoo Mail", loginType: "Email/password", min: 5000, max: 15000,
    titles: ["Yahoo Mail Aged", "Yahoo Mail Fresh", "Yahoo Mail Siap Pakai"],
    notes: ["Login stabil", "Recovery diserahkan", "Aman untuk daftar layanan"] },
  { key: "custom-email", group: "Email", label: "Custom Email", loginType: "Email/password", min: 6000, max: 20000,
    titles: ["Custom Email Domain Pribadi", "Custom Email Bisnis", "Custom Email Siap Pakai"],
    notes: ["Nama email bisa dipilih", "Bisa dipakai untuk verifikasi", "Login lewat webmail"] },

  /* ── Media sosial ── */
  { key: "facebook", group: "Media Sosial", label: "Facebook", loginType: "Facebook", min: 11000, max: 42000,
    titles: ["Facebook Aged 2018", "Facebook Verified Email", "Facebook Marketplace Aktif", "Facebook Full Akses"],
    notes: ["Email login diserahkan penuh", "Belum pernah kena batasan", "Profil sudah terisi lengkap"] },
  { key: "instagram", group: "Media Sosial", label: "Instagram", loginType: "Email/password", min: 10000, max: 45000,
    titles: ["Instagram Aged 2019", "Instagram Fresh Verified", "Instagram Username Bersih", "Instagram Siap Branding"],
    notes: ["Email login diserahkan", "Belum pernah kena batasan", "Bisa ganti username sendiri"] },
  { key: "tiktok", group: "Media Sosial", label: "TikTok", loginType: "Email/password", min: 9000, max: 48000,
    titles: ["TikTok Fresh Verified", "TikTok Aged Aman", "TikTok Username Bersih", "TikTok Siap Konten"],
    notes: ["Email login diserahkan", "Belum pernah kena batasan", "Bisa ganti data sendiri"] },
  { key: "twitter", group: "Media Sosial", label: "Twitter / X", loginType: "Email/password", min: 9000, max: 38000,
    titles: ["Twitter/X Aged 2016", "Twitter/X Fresh Verified", "Twitter/X Siap Pakai"],
    notes: ["Email login diserahkan", "Aman untuk aktivitas harian", "Belum pernah kena limit"] },
  { key: "telegram", group: "Media Sosial", label: "Telegram", loginType: "Nomor/OTP", min: 8000, max: 30000,
    titles: ["Telegram Siap Pakai", "Telegram Aged Aman", "Telegram Full Akses"],
    notes: ["Login stabil", "Bisa pasang 2FA sendiri", "Aman untuk grup dan channel"] },
  { key: "whatsapp", group: "Media Sosial", label: "WhatsApp", loginType: "Nomor/OTP", min: 12000, max: 40000,
    titles: ["WhatsApp Siap Pakai", "WhatsApp Nomor Aktif", "WhatsApp Full Akses"],
    notes: ["Nomor aktif diserahkan", "Bisa pasang PIN sendiri", "Login stabil"] },
  { key: "discord", group: "Media Sosial", label: "Discord", loginType: "Email/password", min: 7000, max: 25000,
    titles: ["Discord Aged Aman", "Discord Fresh Verified", "Discord Siap Pakai"],
    notes: ["Email login diserahkan", "Belum pernah kena batasan", "Aman untuk join server"] },
  { key: "youtube", group: "Media Sosial", label: "YouTube Channel", loginType: "Google", min: 20000, max: 90000,
    titles: ["Channel YouTube Bersih", "Channel YouTube Aged", "Channel YouTube Siap Upload"],
    notes: ["Tanpa teguran hak cipta", "Email login diserahkan", "Bisa ganti nama channel"] },

  /* ── Game ── */
  { key: "freefire", group: "Akun Game", label: "Free Fire", loginType: "Email/password", min: 15000, max: 150000,
    titles: ["Free Fire Starter Aman", "Free Fire Banyak Skin", "Free Fire Level Tinggi", "Free Fire Bundle Lama"],
    notes: ["Login lewat email, bisa ganti sendiri", "Data lengkap diserahkan", "Progress aman"] },
  { key: "pubg", group: "Akun Game", label: "PUBG Mobile", loginType: "Email/password", min: 20000, max: 200000,
    titles: ["PUBG Mobile Rank Tinggi", "PUBG Mobile Banyak Skin", "PUBG Mobile Starter", "PUBG Mobile Set Lengkap"],
    notes: ["Login lewat email, bisa ganti sendiri", "Data lengkap diserahkan", "Progress aman"] },
  { key: "cod", group: "Akun Game", label: "Call of Duty Mobile", loginType: "Email/password", min: 20000, max: 180000,
    titles: ["COD Mobile Rank Tinggi", "COD Mobile Banyak Senjata", "COD Mobile Starter", "COD Mobile Skin Legendary"],
    notes: ["Login lewat email, bisa ganti sendiri", "Data lengkap diserahkan", "Progress aman"] },
  { key: "mobile-legends", group: "Akun Game", label: "Mobile Legends", loginType: "Email/password", min: 25000, max: 250000,
    titles: ["Mobile Legends Mythic", "Mobile Legends Banyak Skin", "Mobile Legends Starter", "Mobile Legends Hero Lengkap"],
    notes: ["Login lewat email/Moonton, bisa ganti sendiri", "Data lengkap diserahkan", "Progress aman"] },
  { key: "genshin", group: "Akun Game", label: "Genshin Impact", loginType: "Email/password", min: 35000, max: 300000,
    titles: ["Genshin Impact AR Tinggi", "Genshin Impact Karakter Bintang 5", "Genshin Impact Starter"],
    notes: ["Email login diserahkan penuh", "Bisa ganti data sendiri", "Progress aman"] },
  { key: "valorant", group: "Akun Game", label: "Valorant", loginType: "Email/password", min: 40000, max: 320000,
    titles: ["Valorant Skin Lengkap", "Valorant Rank Aman", "Valorant Starter"],
    notes: ["Email login diserahkan penuh", "Bisa ganti data sendiri", "Progress aman"] },
  { key: "roblox", group: "Akun Game", label: "Roblox", loginType: "Email/password", min: 12000, max: 120000,
    titles: ["Roblox Siap Pakai", "Roblox Item Lengkap", "Roblox Aged Aman"],
    notes: ["Email login diserahkan", "Bisa ganti data sendiri", "Progress aman"] },
  { key: "steam", group: "Akun Game", label: "Steam", loginType: "Email/password", min: 30000, max: 280000,
    titles: ["Steam Siap Pakai", "Steam Game Lengkap", "Steam Aged Aman"],
    notes: ["Email login diserahkan penuh", "Bisa pasang Steam Guard sendiri", "Progress aman"] },
  { key: "game-lain", group: "Akun Game", label: "Akun Game Lainnya", loginType: "Email/password", min: 18000, max: 120000,
    titles: ["Akun Game Starter", "Akun Game Rank Tinggi", "Akun Game Full Skin", "Akun Game Level Tinggi"],
    notes: ["Email login diserahkan penuh", "Bisa ganti data sendiri", "Progress aman"] },

  /* ── Streaming & hiburan ── */
  { key: "netflix", group: "Streaming", label: "Netflix", loginType: "Email/password", min: 20000, max: 70000,
    titles: ["Netflix Private 1 Profil", "Netflix Sharing Garansi", "Netflix Siap Tonton"],
    notes: ["Login stabil", "Tidak perlu ganti perangkat", "Siap tonton"] },
  { key: "spotify", group: "Streaming", label: "Spotify", loginType: "Email/password", min: 12000, max: 40000,
    titles: ["Spotify Premium Individu", "Spotify Premium Garansi", "Spotify Siap Pakai"],
    notes: ["Login stabil", "Bisa dipakai di HP dan laptop", "Siap dengar"] },
  { key: "youtube-premium", group: "Streaming", label: "YouTube Premium", loginType: "Google", min: 12000, max: 45000,
    titles: ["YouTube Premium Individu", "YouTube Premium Garansi", "YouTube Premium Siap Pakai"],
    notes: ["Login stabil", "Bebas iklan", "Siap tonton"] },
  { key: "disney", group: "Streaming", label: "Disney+ Hotstar", loginType: "Email/password", min: 12000, max: 45000,
    titles: ["Disney+ Hotstar Private", "Disney+ Hotstar Garansi", "Disney+ Hotstar Siap Tonton"],
    notes: ["Login stabil", "Tidak perlu ganti perangkat", "Siap tonton"] },
  { key: "vidio-wetv", group: "Streaming", label: "Vidio / WeTV / Viu", loginType: "Email/password", min: 8000, max: 30000,
    titles: ["Vidio Platinum Siap Pakai", "WeTV VIP Siap Pakai", "Viu Premium Siap Pakai"],
    notes: ["Login stabil", "Siap tonton", "Bisa dipakai di HP"] },
  { key: "streaming-lain", group: "Streaming", label: "Streaming Lainnya", loginType: "Email/password", min: 13000, max: 55000,
    titles: ["Akun Streaming Private", "Akun Streaming 1 Profil", "Akun Streaming Garansi", "Akun Streaming Full HD"],
    notes: ["Login stabil", "Tidak perlu ganti perangkat", "Siap tonton"] },

  /* ── Produktivitas & AI ── */
  { key: "canva", group: "Produktivitas", label: "Canva Pro", loginType: "Email/password", min: 8000, max: 30000,
    titles: ["Canva Pro Siap Pakai", "Canva Pro Garansi", "Canva Pro Akun Pribadi"],
    notes: ["Login stabil", "Semua fitur pro terbuka", "Aman untuk kerja desain"] },
  { key: "chatgpt", group: "Produktivitas", label: "ChatGPT Plus", loginType: "Email/password", min: 35000, max: 150000,
    titles: ["ChatGPT Plus Siap Pakai", "ChatGPT Plus Garansi", "ChatGPT Akun Pribadi"],
    notes: ["Email login diserahkan", "Login stabil", "Siap dipakai harian"] },
  { key: "capcut", group: "Produktivitas", label: "CapCut Pro", loginType: "Email/password", min: 8000, max: 30000,
    titles: ["CapCut Pro Siap Pakai", "CapCut Pro Garansi", "CapCut Pro Akun Pribadi"],
    notes: ["Semua fitur pro terbuka", "Login stabil", "Aman untuk edit konten"] },
  { key: "microsoft-office", group: "Produktivitas", label: "Microsoft 365", loginType: "Microsoft", min: 15000, max: 60000,
    titles: ["Microsoft 365 Siap Pakai", "Microsoft 365 Garansi", "Office 365 Akun Pribadi"],
    notes: ["Bisa dipakai untuk Office", "Login stabil", "Termasuk penyimpanan awan"] },

  /* ── E-commerce & lainnya ── */
  { key: "shopee-tokopedia", group: "Lainnya", label: "Shopee / Tokopedia", loginType: "Nomor/OTP", min: 10000, max: 50000,
    titles: ["Akun Shopee Siap Pakai", "Akun Tokopedia Siap Pakai", "Akun Marketplace Aged"],
    notes: ["Data login diserahkan", "Belum pernah kena batasan", "Aman untuk belanja"] },
  { key: "vpn", group: "Lainnya", label: "VPN Premium", loginType: "Email/password", min: 8000, max: 35000,
    titles: ["VPN Premium Siap Pakai", "VPN Premium Garansi", "VPN Premium Akun Pribadi"],
    notes: ["Login stabil", "Bisa dipakai beberapa perangkat", "Siap pakai"] },
];
const DEMO_TEMPLATE_MAP = new Map(DEMO_TEMPLATES.map((t) => [t.key, t]));
function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }
function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
function buildDemoListing(templateKey) {
  const tpl = DEMO_TEMPLATE_MAP.get(templateKey) || pick(DEMO_TEMPLATES);
  const title = pick(tpl.titles);
  const step = tpl.max > 60000 ? 1000 : 500;
  const price = Math.round(randInt(tpl.min, tpl.max) / step) * step;
  const id = DEMO_PREFIX + crypto.randomUUID();
  const credentials = {
    accounts: [],
    agedPricing: false,
    deliveryDetails: "",
  };
  return {
    id, title,
    description: `${pick(tpl.notes)}. Stok sedang habis, silakan cek akun lain yang tersedia.`,
    loginType: tpl.loginType, price, credentials,
  };
}


async function handleDemoProducts(sql, request, response, agedCfg) {
  const countDemo = async () => {
    const [row] = await sql`SELECT COUNT(*)::int AS n FROM codexa_account_listings
      WHERE id LIKE ${DEMO_PREFIX + "%"} OR id LIKE ${LEGACY_DEMO_PREFIX + "%"}`;
    return row ? row.n : 0;
  };
  const templates = DEMO_TEMPLATES.map((t) => ({ key: t.key, label: t.label, icon: t.key, group: t.group || "Lainnya", min: t.min, max: t.max }));
  if (request.method === "GET") return response.status(200).json({ demoCount: await countDemo(), templates });
  if (request.method === "POST") {
    const body = bodyOf(request);
    const count = Math.min(50, Math.max(1, Number(body.count) || 5));
    const templateKey = text(body.template, 40);
    if (templateKey && templateKey !== "mixed" && !DEMO_TEMPLATE_MAP.has(templateKey)) {
      return response.status(400).json({ error: "Templat produk tidak dikenal" });
    }
    const created = [];
    for (let i = 0; i < count; i += 1) {
      const item = buildDemoListing(templateKey === "mixed" ? "" : templateKey);

      const [row] = await sql`INSERT INTO codexa_account_listings (id,title,description,login_type,price,stock,status,credential_blob)
        VALUES (${item.id},${item.title},${item.description},${item.loginType},${item.price},${0},${"sold"},${encryptCredentials(item.credentials)})
        RETURNING id,title,description,login_type AS "loginType",price,stock,status,created_at AS "createdAt",updated_at AS "updatedAt"`;
      created.push(view({ ...row, credentials: item.credentials }, agedCfg));
    }
    return response.status(201).json({ inserted: created.length, demoCount: await countDemo(), products: created });
  }
  if (request.method === "DELETE") {
    const rows = await sql`DELETE FROM codexa_account_listings
      WHERE id LIKE ${DEMO_PREFIX + "%"} OR id LIKE ${LEGACY_DEMO_PREFIX + "%"} RETURNING id`;
    return response.status(200).json({ deleted: rows.length, demoCount: 0 });
  }

  response.setHeader("Allow", "GET, POST, DELETE");
  return response.status(405).json({ error: "Method not allowed" });
}

module.exports = async function handler(request, response) {
  if (!isAdmin(request)) return response.status(401).json({ error: "Admin login diperlukan" }); if (!process.env.DATABASE_URL) return response.status(500).json({ error: "DATABASE_URL is not configured" });
  try {
    const sql = neon(process.env.DATABASE_URL); await ensureTable(sql);
    /* Sub-resource ulasan & rating dipegang di file yang sama supaya jumlah
       serverless function Vercel tidak bertambah. */
    const resource = (request.query && request.query.resource) || "";
    if (resource === "reviews") {
      return await handleReviewRequest(sql, request, response);
    }
    if (resource === "demo") {
      return await handleDemoProducts(sql, request, response, await readAgedConfig(sql));
    }

    const agedCfg = await readAgedConfig(sql);
    if (request.method === "GET") { const rows = await sql`SELECT id, title, description, login_type AS "loginType", price, stock, status, credential_blob AS "credentialBlob", created_at AS "createdAt", updated_at AS "updatedAt" FROM codexa_account_listings ORDER BY created_at DESC`; return response.status(200).json({ products: rows.map((row) => view({ ...row, credentials: decryptCredentials(row.credentialBlob) }, agedCfg)) }); }
    if (request.method === "DELETE") { const id = text(bodyOf(request).id, 160) || text((request.query && request.query.id) || "", 160); if (!id) return response.status(400).json({ error: "id listing wajib diisi" }); const [row] = await sql`DELETE FROM codexa_account_listings WHERE id=${id} RETURNING id`; if (!row) return response.status(404).json({ error: "Listing tidak ditemukan" }); return response.status(200).json({ deleted: row }); }
    const input = validate(bodyOf(request), request.method === "PATCH" || request.method === "PUT"); if (input.error) return response.status(400).json({ error: input.error });
    if (request.method === "POST") { const id = crypto.randomUUID(); const [row] = await sql`INSERT INTO codexa_account_listings (id,title,description,login_type,price,stock,status,credential_blob) VALUES (${id},${input.title},${input.description},${input.loginType},${input.price},${input.stock},${input.status},${encryptCredentials(input.credentials)}) RETURNING id,title,description,login_type AS "loginType",price,stock,status,credential_blob AS "credentialBlob",created_at AS "createdAt",updated_at AS "updatedAt"`; return response.status(201).json({ product: view({ ...row, credentials: input.credentials }, agedCfg) }); }
    if (request.method === "PATCH" || request.method === "PUT") { const [existing] = await sql`SELECT credential_blob AS "credentialBlob" FROM codexa_account_listings WHERE id = ${input.id}`; if (!existing) return response.status(404).json({ error: "Listing tidak ditemukan" }); const credentials = input.credentials; const [row] = await sql`UPDATE codexa_account_listings SET title=${input.title},description=${input.description},login_type=${input.loginType},price=${input.price},stock=${input.stock},status=${input.status},credential_blob=${encryptCredentials(credentials)},updated_at=NOW() WHERE id=${input.id} RETURNING id,title,description,login_type AS "loginType",price,stock,status,credential_blob AS "credentialBlob",created_at AS "createdAt",updated_at AS "updatedAt"`; return response.status(200).json({ product: view({ ...row, credentials }, agedCfg) }); }
    response.setHeader("Allow", "GET, POST, PATCH, PUT, DELETE"); return response.status(405).json({ error: "Method not allowed" });
  } catch (error) { console.error("Admin products API failed", error); return response.status(500).json({ error: error.message === "ACCOUNT_CREDENTIALS_KEY is not configured" ? "Kunci enkripsi kredensial belum dikonfigurasi di Vercel" : "Operasi listing gagal diproses" }); }
};
