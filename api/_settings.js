/**
 * Pengaturan runtime yang bisa diubah admin dari panel (disimpan di database).
 *
 * Kenapa di database: supaya admin bisa mengatur API key / model Assisten
 * langsung dari admin panel tanpa harus buka dashboard Vercel dan redeploy.
 * Env var tetap dipakai sebagai fallback bila belum diisi dari panel.
 */

const crypto = require("crypto");
const { once } = require("./_schema");

/* ── Enkripsi API key Assisten saat disimpan di database ─────────────
   Sebelumnya key tersimpan apa adanya, jadi siapa pun yang bisa membaca
   tabel bisa memakai kuota AI. Sekarang dienkripsi AES-256-GCM memakai
   ACCOUNT_CREDENTIALS_KEY (kunci yang sama dengan kredensial akun).
   Nilai lama yang masih plaintext tetap terbaca (kompatibel ke belakang). */
function cryptoKey() {
  const raw = process.env.ACCOUNT_CREDENTIALS_KEY || "";
  return raw ? crypto.createHash("sha256").update(raw).digest() : null;
}

function encryptSecret(value) {
  const key = cryptoKey();
  if (!key || !value) return { plain: value || "", enc: "" };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return {
    plain: "",
    enc: [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join("."),
  };
}

function decryptSecret(enc) {
  const key = cryptoKey();
  if (!key || !enc) return "";
  try {
    const [ivText, tagText, dataText] = String(enc).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
  } catch (_) {
    return "";
  }
}

const DEFAULT_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL_ADMIN = "qwen3.8-max";
const DEFAULT_MODEL_USER = "qwen3.7-flash";

const ASSISTANT_KEY = "assistant";

const DEFAULTS = {
  enabled: true,
  apiKey: "",
  apiKeyEnc: "",
  baseUrl: "",
  modelAdmin: "",
  modelUser: "",
  maxSteps: 6,
  temperature: 0.3,
  extraPrompt: "",
};

const ensureSettingsTable = once(async function ensureSettingsTableUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
});

/** Baca setting mentah (apa yang diisi admin), belum dicampur env. */
async function readAssistantSettings(sql) {
  await ensureSettingsTable(sql);
  const rows = await sql`SELECT value, updated_at AS "updatedAt" FROM codexa_settings WHERE key = ${ASSISTANT_KEY} LIMIT 1`;
  const stored = (rows.length && rows[0].value) || {};
  const parsed = typeof stored === "string" ? safeParse(stored) : stored;
  const merged = { ...DEFAULTS, ...parsed };
  // apiKeyEnc (terenkripsi) diutamakan; apiKey plaintext hanya sisa data lama.
  const apiKey = merged.apiKeyEnc ? decryptSecret(merged.apiKeyEnc) : merged.apiKey || "";
  // Migrasi otomatis: kalau masih ada key plaintext dari versi lama,
  // langsung tulis ulang dalam bentuk terenkripsi lalu kosongkan plaintext.
  if (!merged.apiKeyEnc && apiKey) {
    try {
      const { plain, enc } = encryptSecret(apiKey);
      const stored = { ...merged, apiKey: plain, apiKeyEnc: enc };
      await sql`
        UPDATE codexa_settings SET value = ${JSON.stringify(stored)}::jsonb WHERE key = ${ASSISTANT_KEY}
      `;
    } catch (error) {
      console.error("Assistant key migration failed", error && error.message);
    }
  }
  return {
    ...merged,
    apiKey,
    updatedAt: rows.length ? rows[0].updatedAt : null,
  };
}

async function writeAssistantSettings(sql, patch) {
  const current = await readAssistantSettings(sql);
  const { updatedAt, ...base } = current;
  const next = { ...base, ...patch };
  // Simpan API key dalam bentuk terenkripsi; jangan pernah tulis plaintext.
  const { plain, enc } = encryptSecret(trim(next.apiKey));
  const stored = { ...next, apiKey: plain, apiKeyEnc: enc };
  await sql`
    INSERT INTO codexa_settings (key, value, updated_at)
    VALUES (${ASSISTANT_KEY}, ${JSON.stringify(stored)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(stored)}::jsonb, updated_at = NOW()
  `;
  return next;
}

/**
 * Konfigurasi efektif Assisten: setting panel dulu, lalu env var, lalu default.
 * Selalu dipakai oleh /api/assistant dan otak assisten.
 */
async function assistantConfig(sql) {
  let saved = { ...DEFAULTS };
  try {
    saved = await readAssistantSettings(sql);
  } catch (_) {
    // database belum siap → tetap jalan pakai env
  }
  const apiKey = trim(saved.apiKey) || trim(process.env.QWEN_API_KEY);
  const maxSteps = clampInt(saved.maxSteps, 1, 30, 20);
  return {
    enabled: saved.enabled !== false,
    apiKey,
    hasKey: Boolean(apiKey),
    keySource: trim(saved.apiKey) ? "panel" : trim(process.env.QWEN_API_KEY) ? "env" : "none",
    baseUrl: (trim(saved.baseUrl) || trim(process.env.QWEN_BASE_URL) || DEFAULT_BASE).replace(/\/+$/, ""),
    modelAdmin: trim(saved.modelAdmin) || trim(process.env.QWEN_MODEL) || DEFAULT_MODEL_ADMIN,
    modelUser:
      trim(saved.modelUser) || trim(process.env.QWEN_MODEL_USER) || trim(process.env.QWEN_MODEL) || DEFAULT_MODEL_USER,
    maxSteps,
    temperature: clampNum(saved.temperature, 0, 2, 0.3),
    extraPrompt: trim(saved.extraPrompt).slice(0, 2000),
    updatedAt: saved.updatedAt || null,
  };
}

/** Bentuk aman untuk dikirim ke browser: key tidak pernah dikirim utuh. */
function publicAssistantConfig(cfg) {
  return {
    enabled: cfg.enabled,
    hasKey: cfg.hasKey,
    keySource: cfg.keySource,
    keyPreview: maskKey(cfg.apiKey),
    baseUrl: cfg.baseUrl,
    modelAdmin: cfg.modelAdmin,
    modelUser: cfg.modelUser,
    maxSteps: cfg.maxSteps,
    temperature: cfg.temperature,
    extraPrompt: cfg.extraPrompt,
    updatedAt: cfg.updatedAt,
  };
}

function maskKey(key) {
  const value = trim(key);
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}••••`;
  return `${value.slice(0, 5)}••••${value.slice(-4)}`;
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}
function safeParse(value) {
  try {
    return JSON.parse(value) || {};
  } catch (_) {
    return {};
  }
}
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function clampNum(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

module.exports = {
  DEFAULT_BASE,
  DEFAULT_MODEL_ADMIN,
  DEFAULT_MODEL_USER,
  ensureSettingsTable,
  readAssistantSettings,
  writeAssistantSettings,
  assistantConfig,
  publicAssistantConfig,
  maskKey,
  clampInt,
  clampNum,
};
