/**
 * GET    /api/admin/settings          → konfigurasi Assisten (API key dimask)
 * PATCH  /api/admin/settings          → simpan konfigurasi Assisten
 * POST   /api/admin/settings?test=1   → tes koneksi ke penyedia AI pakai konfigurasi aktif
 *
 * Hanya untuk sesi admin.
 */

const { db, bodyOf, text } = require("../_users");
const { isAdmin } = require("./_auth");
const {
  assistantConfig, publicAssistantConfig, writeAssistantSettings, clampInt, clampNum,
} = require("../_settings");
const { readAgedConfig, writeAgedConfig, DEFAULT_AGED_CONFIG } = require("../_aged");
const { visitStats } = require("../_visits");

module.exports = async function handler(request, response) {
  if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });

  try {
    const sql = db();

    /* Visitor Traffic: ringkasan kunjungan website untuk menu admin. */
    if (request.method === "GET" && request.query && request.query.resource === "visits") {
      const stats = await visitStats(sql, { days: request.query.days });
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json(stats);
    }

    if (request.method === "GET") {
      const cfg = await assistantConfig(sql);
      const aged = await readAgedConfig(sql, { fresh: true });
      return response.status(200).json({ assistant: publicAssistantConfig(cfg), aged, agedDefaults: DEFAULT_AGED_CONFIG });
    }

    if (request.method === "POST") {
      const cfg = await assistantConfig(sql);
      if (!cfg.apiKey) return response.status(400).json({ error: "API key Assisten belum diisi" });
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.modelAdmin,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 8,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload || payload.error) {
        const message = (payload && payload.error && payload.error.message) || `HTTP ${res.status}`;
        return response.status(400).json({ error: `Tes gagal: ${message}` });
      }
      return response.status(200).json({ ok: true, model: cfg.modelAdmin, message: "Koneksi ke penyedia AI berhasil" });
    }

    if (request.method !== "PATCH") {
      response.setHeader("Allow", "GET, PATCH, POST");
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = bodyOf(request);

    // Pengaturan harga aged (tingkatan bonus umur akun) disimpan terpisah.
    if (body.aged && typeof body.aged === "object") {
      const aged = await writeAgedConfig(sql, body.aged);
      const cfg = await assistantConfig(sql);
      return response.status(200).json({ ok: true, aged, agedDefaults: DEFAULT_AGED_CONFIG, assistant: publicAssistantConfig(cfg) });
    }

    const patch = {};

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

    // apiKey: hanya ditimpa kalau admin mengirim nilai baru.
    if (typeof body.apiKey === "string") {
      const key = body.apiKey.trim();
      if (key === "__CLEAR__") patch.apiKey = "";
      else if (key && !key.includes("•")) {
        if (key.length < 12) return response.status(400).json({ error: "API key terlihat tidak valid (terlalu pendek)" });
        patch.apiKey = key.slice(0, 300);
      }
    }

    if (typeof body.baseUrl === "string") {
      const url = text(body.baseUrl, 200);
      if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
        return response.status(400).json({ error: "Base URL harus berupa URL https" });
      }
      patch.baseUrl = url;
    }

    if (typeof body.modelAdmin === "string") patch.modelAdmin = text(body.modelAdmin, 80);
    if (typeof body.modelUser === "string") patch.modelUser = text(body.modelUser, 80);
    if (typeof body.extraPrompt === "string") patch.extraPrompt = text(body.extraPrompt, 2000);
    if (body.maxSteps !== undefined) patch.maxSteps = clampInt(body.maxSteps, 1, 10, 6);
    if (body.temperature !== undefined) patch.temperature = clampNum(body.temperature, 0, 2, 0.3);

    await writeAssistantSettings(sql, patch);
    const cfg = await assistantConfig(sql);
    const aged = await readAgedConfig(sql);
    return response.status(200).json({ ok: true, assistant: publicAssistantConfig(cfg), aged, agedDefaults: DEFAULT_AGED_CONFIG });
  } catch (error) {
    console.error("Admin settings failure", (error && error.message) || error);
    return response.status(500).json({ error: "Gagal memproses pengaturan" });
  }
};
