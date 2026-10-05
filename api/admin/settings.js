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
const { readCustomEmailFee, writeCustomEmailFee } = require("../_custom-email-fee");
const GC = require("../_google-checker");

const page = (response, status, title, message) =>
  response.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
     <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0a10;color:#efeaff;font:14px/1.6 system-ui,sans-serif">
     <div style="max-width:420px;padding:28px;text-align:center"><h1 style="font-size:18px">${title}</h1>
     <p style="color:#b3a9cc">${String(message).replace(/[<>&]/g, "")}</p><a href="/admin" style="color:#c4a6ff">Kembali ke Admin Panel</a></div></body>`);

module.exports = async function handler(request, response) {
  const resource = (request.query && request.query.resource) || "";

  /* Callback OAuth Google Checker: dilindungi state bertanda tangan (cookie admin SameSite=Strict tidak terkirim). */
  if (resource === "gchecker-callback") {
    try {
      const email = await GC.handleCallback(db(), request);
      return page(response, 200, "Akun terhubung", `${email} berhasil disimpan dan berstatus ACTIVE.`);
    } catch (error) {
      return page(response, 400, "Gagal menghubungkan akun", (error && error.message) || "Terjadi kesalahan");
    }
  }

  /* Cron harian Vercel. */
  if (resource === "gchecker-cron") {
    const secret = process.env.CRON_SECRET || "";
    if (!secret || request.headers.authorization !== `Bearer ${secret}`) return response.status(401).json({ error: "Unauthorized" });
    const checked = await GC.checkAll(db());
    return response.status(200).json({ ok: true, checked });
  }

  if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });

  try {
    const sql = db();

    if (resource.startsWith("gchecker")) {
      response.setHeader("Cache-Control", "no-store");
      const body = request.method === "GET" ? {} : bodyOf(request);
      if (request.method === "GET" && resource === "gchecker") {
        const c = GC.creds();
        return response.status(200).json({ configured: Boolean(c.id && c.secret), accounts: await GC.list(sql), listings: await GC.googleListings(sql).catch(() => []) });
      }
      if (request.method === "POST" && resource === "gchecker-connect") return response.status(200).json({ url: GC.authUrl(request) });
      if (request.method === "POST" && resource === "gchecker-check") {
        const checked = await GC.checkAll(sql, body.id ? String(body.id) : undefined);
        return response.status(200).json({ ok: true, checked, accounts: await GC.list(sql) });
      }
      if (request.method === "POST" && resource === "gchecker-stock") {
        try { await GC.addToStock(sql, { id: String(body.id || ""), password: body.password, listingId: body.listingId, price: body.price }); }
        catch (e) { return response.status(400).json({ error: e.message }); }
        return response.status(200).json({ ok: true, accounts: await GC.list(sql), listings: await GC.googleListings(sql) });
      }
      if (request.method === "POST" && resource === "gchecker-sold") {
        await GC.markSold(sql, String(body.id || ""));
        return response.status(200).json({ ok: true, accounts: await GC.list(sql) });
      }
      if (request.method === "DELETE" && resource === "gchecker") {
        await GC.remove(sql, String(body.id || (request.query && request.query.id) || ""));
        return response.status(200).json({ ok: true, accounts: await GC.list(sql) });
      }
      return response.status(405).json({ error: "Method not allowed" });
    }

    /* Visitor Traffic: ringkasan kunjungan website untuk menu admin. */
    if (request.method === "GET" && request.query && request.query.resource === "visits") {
      const stats = await visitStats(sql, { days: request.query.days });
      response.setHeader("Cache-Control", "no-store");
      return response.status(200).json(stats);
    }

    if (request.method === "GET") {
      const cfg = await assistantConfig(sql);
      const aged = await readAgedConfig(sql, { fresh: true });
      return response.status(200).json({ assistant: publicAssistantConfig(cfg), aged, agedDefaults: DEFAULT_AGED_CONFIG, customEmailFee: await readCustomEmailFee(sql, { fresh: true }) });
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

    // Harga Custom Email per nama.
    if (body.customEmailFee !== undefined) {
      const customEmailFee = await writeCustomEmailFee(sql, body.customEmailFee);
      return response.status(200).json({ ok: true, customEmailFee });
    }

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
    if (body.maxSteps !== undefined) patch.maxSteps = clampInt(body.maxSteps, 1, 30, 20);
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
