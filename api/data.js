const { neon } = require("@neondatabase/serverless");
const crypto = require("crypto");
const { once } = require("./_schema");
const { effectiveAccountPrice, agedInfo, readAgedConfig } = require("./_aged");
const { readCustomEmailFee } = require("./_custom-email-fee");
const { currentUser, bodyOf } = require("./_users");
const { recordVisit } = require("./_visits");

/* ── Statistik sosial listing: jumlah terjual + rating bintang dari pembeli ── */
const ensureSocialTables = once(async function ensureSocialTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_listing_sales (
      listing_id TEXT PRIMARY KEY,
      sold_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_listing_reviews (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS codexa_listing_reviews_uniq ON codexa_listing_reviews (listing_id, user_id)`;
  /* Ulasan teks ditambahkan menyusul, jadi kolomnya dibuat idempotent. */
  await sql`ALTER TABLE codexa_listing_reviews ADD COLUMN IF NOT EXISTS comment TEXT NOT NULL DEFAULT ''`;
  /* Ulasan yang dibuat dari panel admin menyimpan nama penulisnya sendiri. */
  await sql`ALTER TABLE codexa_listing_reviews ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE codexa_listing_reviews ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user'`;
});

/* Nama penulis ulasan disensor bagian tengahnya: "Rizky Pratama" -> "Ri***y Pr***a" */
function maskWord(word) {
  const w = String(word || "");
  if (!w) return "";
  if (w.length <= 2) return w[0] + "*";
  if (w.length === 3) return w[0] + "**" + w[2];
  return w.slice(0, 2) + "***" + w.slice(-1);
}

function reviewerName(name, email) {
  const raw = String(name || "").trim();
  if (!raw) {
    const local = String(email || "").split("@")[0] || "Pengguna";
    return maskWord(local);
  }
  return raw.split(/\s+/).slice(0, 2).map(maskWord).join(" ");
}

/* Ulasan terbaru (maks 30 per listing) untuk ditampilkan di halaman produk. */
async function readReviewList(sql) {
  const byListing = new Map();
  try {
    const rows = await sql`
      SELECT r.listing_id AS "listingId", r.id, r.rating, r.comment,
             r.updated_at AS "updatedAt",
             COALESCE(NULLIF(r.author_name, ''), u.name) AS name, u.email
      FROM codexa_listing_reviews r
      LEFT JOIN codexa_users u ON u.id = r.user_id
      WHERE r.comment <> ''
      ORDER BY r.updated_at DESC
    `;
    for (const row of rows) {
      const list = byListing.get(row.listingId) || [];
      if (list.length >= 30) continue;
      list.push({
        id: row.id,
        rating: Number(row.rating) || 0,
        comment: String(row.comment || ""),
        author: reviewerName(row.name, row.email),
        createdAt: row.updatedAt,
      });
      byListing.set(row.listingId, list);
    }
  } catch (error) {
    console.error("review list: gagal dibaca", error && error.message);
  }
  return byListing;
}

/* Ringkasan terjual + rating untuk semua listing sekaligus (1 round-trip per tabel). */
async function readSocialStats(sql, userId) {
  const stats = new Map();
  const put = (id) => {
    if (!stats.has(id)) stats.set(id, { soldCount: 0, ratingAvg: 0, ratingCount: 0, myRating: 0, myComment: "" });
    return stats.get(id);
  };
  try {
    const sales = await sql`SELECT listing_id AS "listingId", sold_count AS "soldCount" FROM codexa_listing_sales`;
    for (const row of sales) put(row.listingId).soldCount = Math.max(0, Number(row.soldCount) || 0);
    const reviews = await sql`
      SELECT listing_id AS "listingId", AVG(rating)::float AS avg, COUNT(*)::int AS count
      FROM codexa_listing_reviews GROUP BY listing_id
    `;
    for (const row of reviews) {
      const entry = put(row.listingId);
      entry.ratingAvg = Math.round((Number(row.avg) || 0) * 10) / 10;
      entry.ratingCount = Number(row.count) || 0;
    }
    if (userId) {
      const mine = await sql`
        SELECT listing_id AS "listingId", rating, comment FROM codexa_listing_reviews WHERE user_id = ${userId}
      `;
      for (const row of mine) {
        const entry = put(row.listingId);
        entry.myRating = Number(row.rating) || 0;
        entry.myComment = String(row.comment || "");
      }
    }
  } catch (error) {
    console.error("social stats: gagal dibaca", error && error.message);
  }
  return stats;
}

const ensureTable = once(async function ensureTableUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_account_listings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      login_type TEXT NOT NULL,
      price BIGINT NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold')),
      credential_blob TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
});

function key() { return process.env.ACCOUNT_CREDENTIALS_KEY || ""; }
function cipherKey() { return crypto.createHash("sha256").update(key()).digest(); }
function decryptCredentials(value) {
  if (!key()) return null;
  try {
    const [ivText, tagText, encryptedText] = String(value).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedText, "base64url")), decipher.final()]).toString("utf8"));
  } catch (_) { return null; }
}

function maskEmail(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  const at = value.lastIndexOf("@");
  const local = at > 0 ? value.slice(0, at) : value;
  const domain = at > 0 ? value.slice(at) : "";
  if (local.length <= 2) return local[0] + "****" + domain;
  const keep = Math.min(5, local.length - 1);
  return local.slice(0, keep) + "****" + domain;
}

function maskPassword(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  return "*".repeat(6);
}

/* ── Sitemap helpers (mirror dari src/main.jsx) ── */
const SITE = "https://akuninstan.com";

const STATIC_URLS = [
  { loc: "/", changefreq: "daily", priority: "1.0" },
  { loc: "/katalog", changefreq: "daily", priority: "0.9" },
  { loc: "/custom-email", changefreq: "weekly", priority: "0.9" },
  { loc: "/produk/gmail-fresh", changefreq: "weekly", priority: "0.8" },
  { loc: "/produk/custom-gmail", changefreq: "weekly", priority: "0.8" },
  { loc: "/produk/gmail-aged", changefreq: "weekly", priority: "0.8" },
  { loc: "/produk/akun-game", changefreq: "weekly", priority: "0.8" },
  { loc: "/produk/akun-social-media", changefreq: "weekly", priority: "0.8" },
  { loc: "/help", changefreq: "monthly", priority: "0.6" },
  { loc: "/faq", changefreq: "monthly", priority: "0.7" },
  { loc: "/cara-beli", changefreq: "monthly", priority: "0.7" },
  { loc: "/terms", changefreq: "yearly", priority: "0.3" },
  { loc: "/privacy", changefreq: "yearly", priority: "0.3" },
  { loc: "/refund", changefreq: "yearly", priority: "0.3" },
  { loc: "/disclaimer", changefreq: "yearly", priority: "0.3" },
  { loc: "/keamanan.html", changefreq: "monthly", priority: "0.8" },
];

const BRAND_SLUGS = [
  [/mobile\s*legend|\bmlbb\b|\bml\b/, "mobile-legends"],
  [/free\s*fire|\bff\b/, "free-fire"],
  [/gmail|google/, "google"],
  [/facebook|\bfb\b/, "facebook"],
  [/instagram|\big\b/, "instagram"],
  [/tiktok/, "tiktok"],
  [/twitter|\bx\b/, "twitter"],
  [/telegram/, "telegram"],
  [/whats\s*app|\bwa\b/, "whatsapp"],
  [/discord/, "discord"],
  [/netflix/, "netflix"],
  [/spotify/, "spotify"],
  [/canva/, "canva"],
  [/chat\s*gpt|openai/, "chatgpt"],
  [/steam/, "steam"],
  [/roblox/, "roblox"],
  [/pubg/, "pubg"],
  [/genshin/, "genshin"],
  [/valorant/, "valorant"],
  [/youtube/, "youtube"],
  [/twitch/, "twitch"],
  [/linkedin/, "linkedin"],
  [/shopee/, "shopee"],
  [/yahoo/, "yahoo"],
  [/outlook|hotmail|microsoft/, "outlook"],
  [/apple|icloud/, "apple"],
];

const slugifyText = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "akun";

const productBaseSlug = (p) => {
  const hay = `${(p && p.title) || ""} ${(p && p.loginType) || ""}`.toLowerCase();
  for (const [re, slug] of BRAND_SLUGS) if (re.test(hay)) return slug;
  const words = slugifyText(p && p.title).split("-").filter(Boolean).slice(0, 2).join("-");
  return words || "akun";
};

function assignSlugs(products) {
  const seen = {};
  return products.map((p) => {
    const base = productBaseSlug(p);
    seen[base] = (seen[base] || 0) + 1;
    return { ...p, slug: seen[base] > 1 ? `${base}-${seen[base]}` : base };
  });
}

const xmlEscape = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function urlEntry({ loc, changefreq, priority, lastmod }) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(SITE + loc)}</loc>`,
    lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>` : "",
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : "",
    priority ? `    <priority>${priority}</priority>` : "",
    "  </url>",
  ].filter(Boolean).join("\n");
}

async function buildSitemap(sql) {
  let productUrls = [];
  try {
    const rows = await sql`
      SELECT id, title, login_type AS "loginType", stock, status, credential_blob AS "credentialBlob", updated_at AS "updatedAt"
      FROM codexa_account_listings
      WHERE status = 'available'
      ORDER BY created_at DESC
    `;
    const visible = rows.filter((row) => {
      const credentials = decryptCredentials(row.credentialBlob) || {};
      const accountCount = Array.isArray(credentials.accounts) && credentials.accounts.length
        ? credentials.accounts.length
        : (credentials.email || credentials.username || credentials.password ? 1 : 0);
      const effectiveStock = accountCount || Math.max(0, Number(row.stock) || 0);
      return effectiveStock > 0;
    });
    productUrls = assignSlugs(visible).map((p) => ({
      loc: `/produk/akun/${p.slug}`,
      changefreq: "daily",
      priority: "0.8",
      lastmod: p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : undefined,
    }));
  } catch (error) {
    console.error("sitemap: gagal membaca produk", error);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_URLS.map(urlEntry),
    ...productUrls.map(urlEntry),
    "</urlset>",
    "",
  ].join("\n");

  return xml;
}

module.exports = async function handler(request, response) {
  /* POST ?resource=visit = catat kunjungan halaman (Visitor Traffic, tanpa login). */
  if (request.method === "POST" && request.query && request.query.resource === "visit") {
    response.setHeader("Cache-Control", "no-store");
    if (!process.env.DATABASE_URL) return response.status(200).json({ ok: false });
    try {
      const sql = neon(process.env.DATABASE_URL);
      await recordVisit(sql, request, bodyOf(request) || {});
      return response.status(200).json({ ok: true });
    } catch (error) {
      console.error("visit: gagal dicatat", error && error.message);
      return response.status(200).json({ ok: false });
    }
  }

  /* POST = pembeli memberi rating bintang ke satu listing (1 rating per akun). */
  if (request.method === "POST") {
    if (!process.env.DATABASE_URL) return response.status(500).json({ error: "DATABASE_URL is not configured" });
    try {
      const sql = neon(process.env.DATABASE_URL);
      await ensureSocialTables(sql);
      const user = await currentUser(sql, request);
      if (!user) return response.status(401).json({ error: "Masuk dulu untuk memberi rating" });
      const body = bodyOf(request);
      const listingId = typeof body.listingId === "string" ? body.listingId.trim().slice(0, 120) : "";
      const rating = Math.round(Number(body.rating) || 0);
      /* Ulasan teks: opsional, dibatasi 600 karakter dan disimpan sebagai teks biasa. */
      const comment = typeof body.comment === "string" ? body.comment.trim().replace(/\s+/g, " ").slice(0, 600) : "";
      if (!listingId) return response.status(400).json({ error: "Listing tidak dikenal" });
      if (rating < 1 || rating > 5) return response.status(400).json({ error: "Rating harus 1 sampai 5 bintang" });
      await sql`
        INSERT INTO codexa_listing_reviews (id, listing_id, user_id, rating, comment)
        VALUES (${crypto.randomUUID()}, ${listingId}, ${user.id}, ${rating}, ${comment})
        ON CONFLICT (listing_id, user_id)
        DO UPDATE SET rating = ${rating},
                      comment = CASE WHEN ${comment} <> '' THEN ${comment} ELSE codexa_listing_reviews.comment END,
                      updated_at = NOW()
      `;
      const [agg] = await sql`
        SELECT AVG(rating)::float AS avg, COUNT(*)::int AS count
        FROM codexa_listing_reviews WHERE listing_id = ${listingId}
      `;
      const reviewMap = await readReviewList(sql);
      return response.status(200).json({
        listingId,
        myRating: rating,
        myComment: comment,
        reviews: reviewMap.get(listingId) || [],
        ratingAvg: Math.round(((agg && Number(agg.avg)) || 0) * 10) / 10,
        ratingCount: (agg && Number(agg.count)) || 0,
      });
    } catch (error) {
      console.error("Failed to save listing rating", error);
      return response.status(500).json({ error: "Rating gagal disimpan" });
    }
  }

  if (request.method !== "GET") { response.setHeader("Allow", "GET, POST"); return response.status(405).json({ error: "Method not allowed" }); }

  if (request.query && request.query.resource === "sitemap") {
    if (!process.env.DATABASE_URL) {
      return response.status(500).json({ error: "DATABASE_URL is not configured" });
    }
    try {
      const sql = neon(process.env.DATABASE_URL);
      await ensureTable(sql);
      const xml = await buildSitemap(sql);
      response.setHeader("Content-Type", "application/xml; charset=utf-8");
      response.setHeader("Cache-Control", "public, max-age=0, s-maxage=3600, must-revalidate");
      response.setHeader("X-Robots-Tag", "all");
      return response.status(200).send(xml);
    } catch (error) {
      console.error("Failed to generate sitemap", error);
      return response.status(500).json({ error: "Unable to generate sitemap" });
    }
  }

  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Expires", "0");
  if (!process.env.DATABASE_URL) return response.status(500).json({ error: "DATABASE_URL is not configured" });
  try {
    const sql = neon(process.env.DATABASE_URL);
    await ensureTable(sql);
    await ensureSocialTables(sql);
    const agedCfg = await readAgedConfig(sql);
    const viewerId = (await currentUser(sql, request).catch(() => null) || {}).id || "";
    const social = await readSocialStats(sql, viewerId);
    const reviewsByListing = await readReviewList(sql);
    const rows = await sql`
      SELECT id, title, description, login_type AS "loginType", price, stock, status, credential_blob AS "credentialBlob"
      FROM codexa_account_listings
      ORDER BY created_at DESC
    `;

    const products = rows.map((row) => {
      const credentials = decryptCredentials(row.credentialBlob) || {};
      const accounts = Array.isArray(credentials.accounts) && credentials.accounts.length
        ? credentials.accounts
        : (credentials.email || credentials.username || credentials.password
            ? [{ email: credentials.email || credentials.username || "", password: credentials.password || "", price: row.price }]
            : []);
      const basePrice = Math.max(0, Math.round(Number(row.price) || 0));
      const agedEnabled = credentials.agedPricing !== false && agedCfg.enabled !== false;
      const maskedAccounts = accounts.map((account, index) => {
        const info = agedEnabled ? agedInfo(account.createdAt, agedCfg) : { days: null, bonus: 0, label: "" };
        return {
          index: index + 1,
          /* harga tampil = harga dasar + bonus umur akun (otomatis, sistem aged) */
          price: effectiveAccountPrice(account, basePrice, agedEnabled, agedCfg),
          agedDays: info.days,
          agedLabel: info.label,
          agedBonus: info.bonus,
          maskedEmail: maskEmail(account.email || account.username || ""),
          maskedPassword: maskPassword(account.password),
        };
      });
      const effectiveStock = maskedAccounts.length || Math.max(0, Number(row.stock) || 0);
      const stats = social.get(row.id) || { soldCount: 0, ratingAvg: 0, ratingCount: 0, myRating: 0, myComment: "" };
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        loginType: row.loginType,
        price: maskedAccounts.length ? Math.min(...maskedAccounts.map((a) => a.price)) : basePrice,
        stock: effectiveStock,
        status: row.status,
        /* Listing tetap tampil di katalog meski habis; front-end memberi label. */
        soldOut: effectiveStock <= 0 || row.status !== "available",
        accounts: maskedAccounts,
        soldCount: stats.soldCount,
        ratingAvg: stats.ratingAvg,
        ratingCount: stats.ratingCount,
        myRating: stats.myRating,
        myComment: stats.myComment,
        reviews: reviewsByListing.get(row.id) || [],
        maskedEmail: maskedAccounts[0] ? maskedAccounts[0].maskedEmail : "",
        maskedPassword: maskedAccounts[0] ? maskedAccounts[0].maskedPassword : "",
      };
    });

    return response.status(200).json({ products, customEmailFee: await readCustomEmailFee(sql), source: "codexa_account_listings", generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Failed to read public catalog", error);
    return response.status(500).json({ error: "Unable to read product catalog" });
  }
};
