/**
 * Bot WhatsApp Akun Instan (Baileys + pairing code + AI).
 * Jalan terus di Railway. Website akuninstan.com mengontrolnya lewat HTTP API di bawah.
 *
 * ENV:
 *  BOT_API_TOKEN   token rahasia, harus SAMA dengan WA_BOT_TOKEN di Vercel
 *  STORE_URL       default https://akuninstan.com
 *  AUTH_DIR        folder sesi WhatsApp (pasang Railway Volume di sini), default ./auth
 *  PORT            otomatis dari Railway
 */
const fs = require("fs");
const http = require("http");
const pino = require("pino");
const {
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers,
} = require("@whiskeysockets/baileys");
const { normalizePhone, textOf, shouldReply, pushHistory } = require("./rules");

const TOKEN = (process.env.BOT_API_TOKEN || "").trim();
const STORE_URL = (process.env.STORE_URL || "https://akuninstan.com").replace(/\/+$/, "");
const AUTH_DIR = process.env.AUTH_DIR || "./auth";
const PORT = Number(process.env.PORT) || 3000;

const state = {
  status: "offline", // offline | connecting | pairing | online
  number: "",
  pairingCode: "",
  pairingExpires: 0,
  enabled: true,
  paused: [],
  startedAt: Date.now(),
  replied: 0,
};
const logs = [];
const histories = new Map();
let sock = null;

function log(type, text, extra = {}) {
  logs.unshift({ at: new Date().toISOString(), type, text: String(text).slice(0, 500), ...extra });
  if (logs.length > 100) logs.pop();
  console.log(`[${type}] ${text}`);
}

async function aiReply(jid, history) {
  const res = await fetch(`${STORE_URL}/api/admin/settings?resource=wabot-reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ chat: jid, history }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `AI gagal (${res.status})`);
  return String(data.reply || "").trim();
}

async function onMessage(message) {
  if (!shouldReply(message, state)) return;
  const jid = message.key.remoteJid;
  const text = textOf(message);
  const name = message.pushName || jid.split("@")[0];
  log("in", text, { from: name });
  const history = pushHistory(histories, jid, "user", text);
  try {
    await sock.sendPresenceUpdate("composing", jid);
    const reply = await aiReply(jid, history);
    if (!reply) return;
    await sock.sendMessage(jid, { text: reply }, { quoted: message });
    pushHistory(histories, jid, "assistant", reply);
    state.replied += 1;
    log("out", reply, { to: name });
  } catch (e) {
    log("error", e.message || "Gagal membalas");
  } finally {
    sock && sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
}

async function start() {
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  state.status = "connecting";
  sock = makeWASocket({
    version,
    auth,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
  });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      state.status = "online";
      state.pairingCode = "";
      state.number = (sock.user && sock.user.id || "").split(":")[0].split("@")[0];
      log("system", `Tersambung sebagai ${state.number}`);
    }
    if (connection === "close") {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      if (code === DisconnectReason.loggedOut) {
        state.status = "offline";
        state.number = "";
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        log("system", "Keluar dari WhatsApp. Minta pairing code baru untuk menyambung.");
        setTimeout(start, 1500);
      } else {
        state.status = "connecting";
        log("system", `Koneksi terputus (${code || "?"}), menyambung ulang...`);
        setTimeout(start, 3000);
      }
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) onMessage(m);
  });
}

async function requestPairing(phone) {
  const number = normalizePhone(phone);
  if (!number) throw new Error("Nomor WhatsApp tidak valid");
  if (sock && sock.authState.creds.registered) throw new Error("Bot sudah tersambung. Putuskan dulu kalau mau ganti nomor.");
  const code = await sock.requestPairingCode(number);
  state.status = "pairing";
  state.pairingCode = String(code).match(/.{1,4}/g).join("-");
  state.pairingExpires = Date.now() + 60_000;
  log("system", `Pairing code dibuat untuk ${number}`);
  return state.pairingCode;
}

/* ── HTTP API (dipanggil website lewat proxy admin) ── */
const send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); } });
});

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/") return send(res, 200, { ok: true, status: state.status });
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "Token bot salah" });
  try {
    if (req.method === "GET" && url.pathname === "/status") {
      const pairing = state.pairingCode && Date.now() < state.pairingExpires ? state.pairingCode : "";
      return send(res, 200, { ...state, pairingCode: pairing, logs: logs.slice(0, 50) });
    }
    const body = await readBody(req);
    if (req.method === "POST" && url.pathname === "/pair") return send(res, 200, { code: await requestPairing(body.phone) });
    if (req.method === "POST" && url.pathname === "/settings") {
      if (typeof body.enabled === "boolean") state.enabled = body.enabled;
      log("system", `Balasan AI ${state.enabled ? "dinyalakan" : "dimatikan"}`);
      return send(res, 200, { ok: true, enabled: state.enabled });
    }
    if (req.method === "POST" && url.pathname === "/logout") {
      await sock.logout().catch(() => {});
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Tidak ditemukan" });
  } catch (e) {
    return send(res, 400, { error: e.message || "Gagal" });
  }
}).listen(PORT, () => console.log(`Bot API jalan di port ${PORT}`));

start().catch((e) => { log("error", e.message); process.exit(1); });
