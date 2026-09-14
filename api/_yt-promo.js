/**
 * Bot Telegram → YouTube Promotion.
 * Modul inti: skema tabel, pengaturan, skor relevansi, blacklist, anti-duplikat,
 * rate limit, draft AI, dan log aktivitas.
 *
 * Semua kredensial dibaca dari environment variable / pengaturan database,
 * tidak ada yang ditulis keras di kode.
 */

const crypto = require("crypto");
const { once } = require("./_schema");
const { assistantConfig } = require("./_settings");

/* ── Enkripsi token OAuth (AES-256-GCM, kunci sama dengan kredensial akun) ── */
function cryptoKey() {
  const raw = process.env.ACCOUNT_CREDENTIALS_KEY || "";
  return raw ? crypto.createHash("sha256").update(raw).digest() : null;
}

function encryptSecret(value) {
  const key = cryptoKey();
  if (!value) return "";
  if (!key) return `plain:${String(value)}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function decryptSecret(enc) {
  if (!enc) return "";
  const text = String(enc);
  if (text.startsWith("plain:")) return text.slice(6);
  const key = cryptoKey();
  if (!key) return "";
  try {
    const [ivText, tagText, dataText] = text.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
  } catch (_) {
    return "";
  }
}

/* ═══════════════════ SKEMA ═══════════════════ */

const ensureYtTables = once(async function ensureYtTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_accounts (
      id TEXT PRIMARY KEY,
      channel_id TEXT,
      channel_title TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at TIMESTAMPTZ,
      last_sync TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_keywords (
      id BIGSERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'lainnya',
      uses INTEGER NOT NULL DEFAULT 0,
      last_used TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (keyword, category)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_videos (
      video_id TEXT PRIMARY KEY,
      channel_id TEXT,
      channel_title TEXT,
      title TEXT,
      description TEXT,
      thumbnail TEXT,
      published_at TIMESTAMPTZ,
      views BIGINT NOT NULL DEFAULT 0,
      keyword TEXT,
      category TEXT,
      relevance INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'found',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_drafts (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      keyword TEXT,
      category TEXT,
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT NOT NULL DEFAULT 'ai',
      telegram_chat_id TEXT,
      telegram_message_id BIGINT,
      admin TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_promotions (
      id TEXT PRIMARY KEY,
      draft_id TEXT,
      video_id TEXT NOT NULL,
      account_id TEXT,
      channel_title TEXT,
      comment TEXT,
      comment_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      error TEXT,
      admin TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_blacklist (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      value TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (type, value)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_yt_logs (
      id BIGSERIAL PRIMARY KEY,
      video_id TEXT,
      video_title TEXT,
      channel_title TEXT,
      keyword TEXT,
      relevance INTEGER,
      draft TEXT,
      status TEXT NOT NULL,
      account TEXT,
      comment_id TEXT,
      admin TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS codexa_yt_logs_created_idx ON codexa_yt_logs (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS codexa_yt_drafts_status_idx ON codexa_yt_drafts (status)`;
});

/* ═══════════════════ PENGATURAN ═══════════════════ */

const SETTINGS_KEY = "promotion";

const DEFAULT_SETTINGS = {
  enabled: true,
  dailyLimit: 20,
  minRelevance: 70,
  cooldownMinutes: 30,
  requireApproval: true,
  allowAiDraft: true,
  duplicateProtection: true,
  stoppedAt: null,
  profile: {
    brand: "AkunInstan",
    website: "akuninstan.com",
    description: "Marketplace akun digital siap pakai.",
    cta: "Kunjungi katalog AkunInstan",
  },
};

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const trim = (value, max = 300) => String(value == null ? "" : value).trim().slice(0, max);

async function readSettings(sql) {
  await ensureYtTables(sql);
  let saved = {};
  try {
    const rows = await sql`SELECT value FROM codexa_yt_settings WHERE key = ${SETTINGS_KEY} LIMIT 1`;
    saved = (rows[0] && rows[0].value) || {};
  } catch (_) {
    saved = {};
  }
  const profile = { ...DEFAULT_SETTINGS.profile, ...(saved.profile || {}) };
  return {
    enabled: saved.enabled !== false,
    dailyLimit: clampInt(saved.dailyLimit, 1, 200, DEFAULT_SETTINGS.dailyLimit),
    minRelevance: clampInt(saved.minRelevance, 0, 100, DEFAULT_SETTINGS.minRelevance),
    cooldownMinutes: clampInt(saved.cooldownMinutes, 0, 1440, DEFAULT_SETTINGS.cooldownMinutes),
    requireApproval: saved.requireApproval !== false,
    allowAiDraft: saved.allowAiDraft !== false,
    duplicateProtection: saved.duplicateProtection !== false,
    stoppedAt: saved.stoppedAt || null,
    profile: {
      brand: trim(profile.brand, 80) || DEFAULT_SETTINGS.profile.brand,
      website: trim(profile.website, 120) || DEFAULT_SETTINGS.profile.website,
      description: trim(profile.description, 300) || DEFAULT_SETTINGS.profile.description,
      cta: trim(profile.cta, 160) || DEFAULT_SETTINGS.profile.cta,
    },
    updatedAt: saved.updatedAt || null,
  };
}

async function writeSettings(sql, patch) {
  const current = await readSettings(sql);
  const next = {
    ...current,
    ...(patch || {}),
    profile: { ...current.profile, ...((patch && patch.profile) || {}) },
    updatedAt: new Date().toISOString(),
  };
  const clean = {
    enabled: next.enabled !== false,
    dailyLimit: clampInt(next.dailyLimit, 1, 200, DEFAULT_SETTINGS.dailyLimit),
    minRelevance: clampInt(next.minRelevance, 0, 100, DEFAULT_SETTINGS.minRelevance),
    cooldownMinutes: clampInt(next.cooldownMinutes, 0, 1440, DEFAULT_SETTINGS.cooldownMinutes),
    requireApproval: next.requireApproval !== false,
    allowAiDraft: next.allowAiDraft !== false,
    duplicateProtection: next.duplicateProtection !== false,
    stoppedAt: next.stoppedAt || null,
    profile: {
      brand: trim(next.profile.brand, 80) || DEFAULT_SETTINGS.profile.brand,
      website: trim(next.profile.website, 120),
      description: trim(next.profile.description, 300),
      cta: trim(next.profile.cta, 160),
    },
    updatedAt: next.updatedAt,
  };
  await sql`
    INSERT INTO codexa_yt_settings (key, value, updated_at)
    VALUES (${SETTINGS_KEY}, ${JSON.stringify(clean)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
  return readSettings(sql);
}

/* ═══════════════════ RELEVANSI ═══════════════════ */

const CATEGORIES = [
  { key: "gmail", label: "Gmail", terms: ["gmail", "akun gmail", "buat gmail", "email google"] },
  { key: "gmail-custom", label: "Gmail Custom", terms: ["gmail custom", "custom gmail", "email custom", "custom domain email", "domain email"] },
  { key: "email-bisnis", label: "Email Bisnis", terms: ["email bisnis", "business email", "email profesional", "email perusahaan"] },
  { key: "google-workspace", label: "Google Workspace", terms: ["google workspace", "gsuite", "g suite", "workspace admin"] },
  { key: "akun-google", label: "Akun Google", terms: ["akun google", "google account", "daftar google", "verifikasi google"] },
  { key: "lainnya", label: "Lainnya", terms: [] },
];

const POSITIVE_TERMS = [
  "gmail", "email", "e-mail", "google", "workspace", "gsuite", "akun", "account",
  "domain", "bisnis", "business", "tutorial", "cara", "membuat", "daftar", "custom",
  "outlook", "smtp", "inbox", "verifikasi",
];

const NEGATIVE_TERMS = [
  "gameplay", "mobile legend", "free fire", "pubg", "genshin", "valorant", "roblox",
  "lagu", "musik", "cover", "vlog", "prank", "mukbang", "highlight", "anime", "drakor",
];

const normalize = (value) => String(value || "").toLowerCase();

/**
 * Skor relevansi internal (0-100). Ini BUKAN data resmi YouTube.
 */
function relevanceScore({ title, description, keyword, category, publishedAt, views }) {
  const haystack = `${normalize(title)} ${normalize(description).slice(0, 600)}`;
  const kw = normalize(keyword);
  let score = 0;

  if (kw && normalize(title).includes(kw)) score += 45;
  else if (kw && haystack.includes(kw)) score += 28;
  else if (kw) {
    const words = kw.split(/\s+/).filter((w) => w.length > 2);
    const hits = words.filter((w) => haystack.includes(w)).length;
    if (words.length) score += Math.round((hits / words.length) * 25);
  }

  const cat = CATEGORIES.find((c) => c.key === category);
  if (cat && cat.terms.length) {
    const catHits = cat.terms.filter((term) => haystack.includes(term)).length;
    score += Math.min(25, catHits * 12);
  }

  const positive = POSITIVE_TERMS.filter((term) => haystack.includes(term)).length;
  score += Math.min(22, positive * 4);

  const negative = NEGATIVE_TERMS.filter((term) => haystack.includes(term)).length;
  score -= negative * 22;

  // Video yang lebih baru sedikit lebih bernilai untuk promosi.
  const ageDays = publishedAt ? (Date.now() - new Date(publishedAt).getTime()) / 86400000 : 999;
  if (ageDays <= 30) score += 8;
  else if (ageDays <= 180) score += 4;
  else if (ageDays > 1460) score -= 5;

  const n = Number(views) || 0;
  if (n >= 100000) score += 5;
  else if (n >= 10000) score += 3;
  else if (n >= 1000) score += 1;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function detectCategory(text) {
  const value = normalize(text);
  for (const cat of CATEGORIES) {
    if (cat.key === "lainnya") continue;
    if (cat.terms.some((term) => value.includes(term))) return cat.key;
  }
  return "lainnya";
}

/* ═══════════════════ BLACKLIST & DUPLIKAT ═══════════════════ */

async function readBlacklist(sql) {
  await ensureYtTables(sql);
  const rows = await sql`SELECT id, type, value, note, created_at AS "createdAt" FROM codexa_yt_blacklist ORDER BY created_at DESC LIMIT 500`;
  return rows;
}

function channelKeyOf(value) {
  const raw = trim(value, 200);
  const match = /youtube\.com\/(?:channel\/|@)([^/?#]+)/i.exec(raw);
  return normalize(match ? match[1] : raw);
}

function blacklistFilter(blacklist) {
  const channels = new Set(blacklist.filter((b) => b.type === "channel").map((b) => channelKeyOf(b.value)));
  const keywords = blacklist.filter((b) => b.type === "keyword").map((b) => normalize(b.value)).filter(Boolean);
  return function isBlocked(video) {
    if (channels.has(normalize(video.channelId)) || channels.has(normalize(video.channelTitle))) return "channel";
    const haystack = `${normalize(video.title)} ${normalize(video.channelTitle)} ${normalize(video.description).slice(0, 400)}`;
    if (keywords.some((k) => k && haystack.includes(k))) return "keyword";
    return "";
  };
}

async function processedVideoIds(sql, ids) {
  if (!ids.length) return new Set();
  const rows = await sql`
    SELECT DISTINCT video_id AS "videoId" FROM codexa_yt_drafts WHERE video_id = ANY(${ids})
    UNION
    SELECT DISTINCT video_id AS "videoId" FROM codexa_yt_promotions WHERE video_id = ANY(${ids})
  `;
  return new Set(rows.map((r) => r.videoId));
}

/* ═══════════════════ LOG & STATISTIK ═══════════════════ */

async function logActivity(sql, entry) {
  try {
    await sql`
      INSERT INTO codexa_yt_logs
        (video_id, video_title, channel_title, keyword, relevance, draft, status, account, comment_id, admin, detail)
      VALUES (
        ${entry.videoId || null}, ${trim(entry.videoTitle, 300) || null}, ${trim(entry.channelTitle, 200) || null},
        ${trim(entry.keyword, 200) || null}, ${entry.relevance == null ? null : Number(entry.relevance) || 0},
        ${entry.draft ? String(entry.draft).slice(0, 2000) : null}, ${entry.status || "found"},
        ${trim(entry.account, 200) || null}, ${trim(entry.commentId, 120) || null},
        ${trim(entry.admin, 120) || null}, ${entry.detail ? String(entry.detail).slice(0, 1000) : null}
      )
    `;
  } catch (error) {
    console.error("yt log gagal:", error && error.message);
  }
}

async function promotionStats(sql) {
  await ensureYtTables(sql);
  const [videos] = await sql`SELECT COUNT(*)::int AS total FROM codexa_yt_videos`;
  const drafts = await sql`SELECT status, COUNT(*)::int AS total FROM codexa_yt_drafts GROUP BY status`;
  const promos = await sql`SELECT status, COUNT(*)::int AS total FROM codexa_yt_promotions GROUP BY status`;
  const map = (rows) => rows.reduce((acc, row) => ({ ...acc, [row.status]: row.total }), {});
  const d = map(drafts);
  const p = map(promos);
  const [today] = await sql`
    SELECT COUNT(*)::int AS total FROM codexa_yt_drafts WHERE created_at >= date_trunc('day', NOW())
  `;
  return {
    found: videos.total || 0,
    pending: d.pending || 0,
    approved: (d.approved || 0) + (d.sent || 0),
    rejected: d.rejected || 0,
    sent: p.sent || 0,
    failed: (p.failed || 0) + (d.failed || 0),
    todayDrafts: today.total || 0,
  };
}

/** Cek batas harian + cooldown sebelum draft/komentar baru. */
async function guardLimits(sql, settings) {
  if (!settings.enabled) return "Promosi sedang dinonaktifkan (STOP aktif). Aktifkan lagi di Pengaturan Promosi.";
  const [today] = await sql`
    SELECT COUNT(*)::int AS total FROM codexa_yt_drafts WHERE created_at >= date_trunc('day', NOW())
  `;
  if ((today.total || 0) >= settings.dailyLimit) {
    return `Batas harian ${settings.dailyLimit} draft sudah tercapai. Coba lagi besok atau ubah di Pengaturan Promosi.`;
  }
  if (settings.cooldownMinutes > 0) {
    const [last] = await sql`
      SELECT created_at AS "createdAt" FROM codexa_yt_drafts ORDER BY created_at DESC LIMIT 1
    `;
    if (last && last.createdAt) {
      const diffMin = (Date.now() - new Date(last.createdAt).getTime()) / 60000;
      if (diffMin < settings.cooldownMinutes) {
        return `Cooldown aktif. Tunggu ${Math.ceil(settings.cooldownMinutes - diffMin)} menit lagi sebelum membuat draft berikutnya.`;
      }
    }
  }
  return "";
}

/* ═══════════════════ DRAFT AI ═══════════════════ */

const STYLE_HINTS = [
  "buka dengan apresiasi singkat pada isi video",
  "mulai dengan satu insight praktis dari topik video",
  "sebutkan satu manfaat konkret bagi penonton pemula",
  "bandingkan singkat pengalaman memakai email/akun siap pakai",
  "awali dengan pertanyaan ringan yang relevan dengan isi video",
];

function fallbackDraft(video, profile) {
  const topic = trim(video.title, 90);
  return [
    `Penjelasannya cukup jelas untuk yang baru mulai soal ${topic.toLowerCase()}.`,
    `Buat yang butuh akun atau email siap pakai tanpa ribet, bisa lihat ${profile.brand}${profile.website ? ` (${profile.website})` : ""}.`,
  ].join(" ");
}

/**
 * Buat draft komentar promosi memakai konfigurasi AI (Qwen) yang sudah ada.
 * Selalu mengembalikan teks; kalau AI gagal, pakai draft cadangan sederhana.
 */
async function generateDraft(sql, { video, keyword, category, profile }) {
  const cfg = await assistantConfig(sql).catch(() => null);
  if (!cfg || !cfg.hasKey || cfg.enabled === false) {
    return { comment: fallbackDraft(video, profile), source: "fallback", warning: "AI belum dikonfigurasi, dipakai draft cadangan." };
  }

  const hint = STYLE_HINTS[Math.floor(Math.random() * STYLE_HINTS.length)];
  const system = [
    "Kamu menulis komentar YouTube berbahasa Indonesia yang natural dan sopan.",
    "Aturan wajib:",
    "- 1-2 kalimat, maksimal 300 karakter.",
    "- Relevan dengan isi video, bukan template umum.",
    "- Tidak terdengar seperti iklan/spam, tidak memaksa, tanpa huruf kapital berlebihan atau emoji berlebihan.",
    "- Tidak membuat klaim palsu, tidak menjanjikan hasil, tidak menyebut harga.",
    "- Sebut brand satu kali saja sebagai saran halus di akhir.",
    "- Jawab HANYA dengan teks komentarnya, tanpa tanda kutip dan tanpa penjelasan.",
    `Gaya kali ini: ${hint}.`,
  ].join("\n");

  const user = [
    `Judul video: ${trim(video.title, 200)}`,
    `Channel: ${trim(video.channelTitle, 120)}`,
    `Deskripsi: ${trim(video.description, 700)}`,
    `Keyword pencarian: ${trim(keyword, 120)}`,
    `Kategori: ${category}`,
    "",
    "Profil promosi:",
    `- Brand: ${profile.brand}`,
    `- Website: ${profile.website}`,
    `- Deskripsi: ${profile.description}`,
    `- Ajakan: ${profile.cta}`,
  ].join("\n");

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.modelAdmin,
        temperature: 0.9,
        max_tokens: 220,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      const message = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      return { comment: fallbackDraft(video, profile), source: "fallback", warning: `AI gagal (${message}), dipakai draft cadangan.` };
    }
    const text = trim(
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "",
      600,
    ).replace(/^["“']|["”']$/g, "");
    if (!text) return { comment: fallbackDraft(video, profile), source: "fallback", warning: "AI tidak mengembalikan teks, dipakai draft cadangan." };
    return { comment: text.slice(0, 400), source: "ai", warning: "" };
  } catch (error) {
    return { comment: fallbackDraft(video, profile), source: "fallback", warning: `AI error (${error && error.message}), dipakai draft cadangan.` };
  }
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

module.exports = {
  ensureYtTables,
  encryptSecret,
  decryptSecret,
  readSettings,
  writeSettings,
  DEFAULT_SETTINGS,
  CATEGORIES,
  relevanceScore,
  detectCategory,
  readBlacklist,
  blacklistFilter,
  channelKeyOf,
  processedVideoIds,
  logActivity,
  promotionStats,
  guardLimits,
  generateDraft,
  newId,
  trim,
  clampInt,
};
