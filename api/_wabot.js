/* Jembatan website ↔ bot WhatsApp (Railway). */

const { aiHeaders } = require("./_openrouter");

const OPS = { status: ["GET", "/status"], pair: ["POST", "/pair"], settings: ["POST", "/settings"], logout: ["POST", "/logout"] };

async function proxy(method, op, body) {
  const base = (process.env.WA_BOT_URL || "").trim().replace(/\/+$/, "");
  const token = (process.env.WA_BOT_TOKEN || "").trim();
  if (!base || !token) return { status: 200, data: { configured: false, status: "offline", logs: [] } };
  const route = OPS[op];
  if (!route || (route[0] !== method && !(op === "status" && method === "GET"))) return { status: 400, data: { error: "Aksi tidak dikenal" } };
  const res = await fetch(`${base}${route[1]}`, {
    method: route[0],
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: route[0] === "GET" ? undefined : JSON.stringify(body || {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: { configured: true, ...data } };
}

function catalogText(products) {
  return (products || []).slice(0, 40).map((p) =>
    `- ${p.title}: Rp${Number(p.price || 0).toLocaleString("id-ID")}, stok ${p.soldOut ? "habis" : p.stock}`).join("\n");
}

async function reply(sql, body, assistantConfig) {
  const cfg = await assistantConfig(sql);
  if (!cfg.enabled || !cfg.apiKey) { const e = new Error("Assisten AI belum aktif"); e.status = 503; throw e; }
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!history.length) { const e = new Error("Pesan kosong"); e.status = 400; throw e; }

  let catalog = "";
  try {
    const r = await fetch("https://akuninstan.com/api/catalog", { signal: AbortSignal.timeout(8000) });
    catalog = catalogText((await r.json()).products);
  } catch (_) { /* tanpa katalog tetap jalan */ }

  const system = [
    "Kamu CS WhatsApp toko Akun Instan (akuninstan.com), toko akun digital (Gmail fresh, Gmail aged, custom email, akun game, sosmed).",
    "Jawab singkat, ramah, bahasa Indonesia santai, cocok untuk chat WhatsApp (tanpa markdown tabel/heading). Maks 5 kalimat.",
    "Pembelian dilakukan di website akuninstan.com: daftar/masuk, top up saldo, pilih produk, beli. Garansi login 1x24 jam.",
    "Jangan mengarang harga/stok di luar daftar. Kalau tidak tahu atau ada masalah pesanan, arahkan ke menu Bantuan/Laporan di website.",
    "Jangan pernah meminta password atau kode OTP pembeli.",
    catalog ? `KATALOG SAAT INI:\n${catalog}` : "",
    cfg.extraPrompt ? `INSTRUKSI ADMIN:\n${cfg.extraPrompt}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: aiHeaders(cfg),
    body: JSON.stringify({ model: cfg.modelUser, temperature: cfg.temperature, messages: [{ role: "system", content: system }, ...history] }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error((data.error && data.error.message) || `AI error ${res.status}`); e.status = 502; throw e; }
  return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "").replace(/\*\*(.+?)\*\*/g, "*$1*").trim();
}

module.exports = { proxy, reply, catalogText };
