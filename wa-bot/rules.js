/* Aturan murni bot WhatsApp (tanpa Baileys) supaya bisa dites dengan node:test. */

/** Nomor HP → format WhatsApp internasional tanpa "+" (08xx → 628xx). */
function normalizePhone(input) {
  let d = String(input || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  if (d.startsWith("8")) d = `62${d}`;
  return /^\d{10,15}$/.test(d) ? d : "";
}

/** Ambil teks dari pesan Baileys (biasa, extended, caption gambar/video). */
function textOf(message) {
  const m = (message && message.message) || {};
  return String(
    m.conversation ||
    (m.extendedTextMessage && m.extendedTextMessage.text) ||
    (m.imageMessage && m.imageMessage.caption) ||
    (m.videoMessage && m.videoMessage.caption) ||
    ""
  ).trim();
}

/**
 * Pesan ini perlu dibalas AI?
 * Tolak: pesan dari bot sendiri, grup, status/broadcast/newsletter, teks kosong, chat yang dijeda admin.
 */
function shouldReply(message, { enabled = true, paused = [] } = {}) {
  if (!enabled || !message || !message.key) return false;
  const jid = String(message.key.remoteJid || "");
  if (message.key.fromMe) return false;
  if (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid")) return false;
  if (paused.includes(jid)) return false;
  return textOf(message).length > 0;
}

/** Simpan riwayat chat per nomor, maksimal `max` pesan terakhir. */
function pushHistory(store, jid, role, content, max = 12) {
  const list = store.get(jid) || [];
  list.push({ role, content: String(content).slice(0, 2000) });
  while (list.length > max) list.shift();
  store.set(jid, list);
  return list;
}

module.exports = { normalizePhone, textOf, shouldReply, pushHistory };
