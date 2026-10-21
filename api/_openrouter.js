/**
 * Penyedia AI Assisten: OpenRouter (https://openrouter.ai).
 *
 * - Satu API key OpenRouter (sk-or-...) membuka ratusan model.
 * - Admin hanya boleh memilih model GRATIS, supaya kuota tidak pernah
 *   tertagih. Daftar model gratis diambil langsung dari OpenRouter
 *   (endpoint publik /models, tanpa key) dan di-cache sebentar.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
/** Router resmi OpenRouter yang otomatis memilih model gratis yang sedang tersedia. */
const FREE_ROUTER = "openrouter/free";
const CACHE_MS = 10 * 60 * 1000;

let cache = { at: 0, models: null };

/** Header standar untuk setiap panggilan chat/completions ke OpenRouter. */
function aiHeaders(cfg) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${(cfg && cfg.apiKey) || ""}`,
    "HTTP-Referer": "https://akuninstan.com",
    "X-Title": "Akun Instan",
  };
}

const isZero = (value) => value !== undefined && value !== null && value !== "" && Number(value) === 0;

/**
 * Saring respons /models menjadi daftar model gratis yang bisa membalas teks.
 * Model gratis = harga prompt DAN completion 0.
 */
function pickFreeModels(payload) {
  const list = Array.isArray(payload && payload.data) ? payload.data : [];
  const models = list
    .filter((m) => m && typeof m.id === "string" && m.pricing)
    .filter((m) => isZero(m.pricing.prompt) && isZero(m.pricing.completion))
    .filter((m) => {
      const out = (m.architecture && m.architecture.output_modalities) || ["text"];
      return out.includes("text");
    })
    .map((m) => {
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      const input = (m.architecture && m.architecture.input_modalities) || ["text"];
      return {
        id: m.id,
        name: String(m.name || m.id).replace(/\s*\(free\)\s*$/i, ""),
        context: Number(m.context_length) || 0,
        tools: params.includes("tools"),
        vision: input.includes("image"),
      };
    });
  models.sort((a, b) => {
    if (a.id === FREE_ROUTER) return -1;
    if (b.id === FREE_ROUTER) return 1;
    if (a.tools !== b.tools) return a.tools ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return models;
}

/** Daftar model gratis OpenRouter (cache 10 menit). */
async function listFreeModels({ fresh = false } = {}) {
  if (!fresh && cache.models && Date.now() - cache.at < CACHE_MS) return cache.models;
  const res = await fetch(`${OPENROUTER_BASE}/models`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Gagal memuat daftar model OpenRouter (HTTP ${res.status})`);
  const models = pickFreeModels(await res.json());
  cache = { at: Date.now(), models };
  return models;
}

/** Pola cadangan bila daftar dari OpenRouter tidak bisa dimuat. */
function looksFree(id) {
  const value = String(id || "").trim();
  return value === FREE_ROUTER || /^[\w.-]+\/[\w.:-]+:free$/i.test(value);
}

/** Pastikan model yang dipilih admin memang gratis. */
async function isFreeModel(id) {
  const value = String(id || "").trim();
  if (!value) return false;
  try {
    const models = await listFreeModels();
    if (models.some((m) => m.id === value)) return true;
  } catch (_) {
    /* OpenRouter tidak bisa dihubungi → pakai pola cadangan */
  }
  return looksFree(value);
}

module.exports = { OPENROUTER_BASE, FREE_ROUTER, aiHeaders, pickFreeModels, listFreeModels, looksFree, isFreeModel };
