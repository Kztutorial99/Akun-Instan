/**
 * GET/POST /api/whatsapp-webhook — Webhook WhatsApp Cloud API (Meta).
 *
 * GET  : verifikasi langganan webhook dari Meta
 *        (hub.mode=subscribe + hub.verify_token harus sama dengan env
 *         WHATSAPP_VERIFY_TOKEN, lalu balas dengan hub.challenge).
 * POST : menerima semua notifikasi pesan masuk & update status kirim.
 *        Setiap event disimpan ke tabel whatsapp_events (jika database siap)
 *        supaya bisa diproses ulang, dan selalu dibalas 200 agar Meta
 *        tidak berhenti mengirim notifikasi.
 */

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";

function numFromPayload(body) {
  try {
    const entry = Array.isArray(body && body.entry) ? body.entry : [];
    for (const e of entry) {
      const changes = Array.isArray(e.changes) ? e.changes : [];
      for (const c of changes) {
        const value = c.value || {};
        if (value.metadata && value.metadata.phone_number_id) {
          return value.metadata.phone_number_id;
        }
      }
    }
  } catch (_) {}
  return "";
}

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge || "");
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Simpan payload mentah untuk diproses (kirim ulang status laporan, dll).
  try {
    const body = typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const { db, ensureTables } = require("./_users");
    await ensureTables();
    await db`
      CREATE TABLE IF NOT EXISTS whatsapp_events (
        id BIGSERIAL PRIMARY KEY,
        event_kind TEXT NOT NULL DEFAULT '',
        phone_number_id TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at TIMESTAMPTZ,
        processing_error TEXT
      )
    `;
    const kind = body && body.object ? String(body.object) : "";
    await db`
      INSERT INTO whatsapp_events (event_kind, phone_number_id, payload)
      VALUES (${kind}, ${numFromPayload(body)}, ${JSON.stringify(body)}::jsonb)
    `;
  } catch (err) {
    console.error("whatsapp-webhook store error:", err && err.message);
    // Tetap 200: Meta akan menghentikan pengiriman webhook kalau sering gagal.
  }

  return res.status(200).json({ received: true });
};
