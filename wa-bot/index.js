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
  default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, makeCacheableSignalKeyStore,
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

let starting = false;
let retryTimer = null;
let retries = 0;
const silent = pino({ level: "silent" });

function scheduleStart(ms) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => start().catch((e) => { log("error", e.message); scheduleStart(10000); }), ms);
}

async function start() {
  if (starting) return;
  starting = true;
  try {
    // Matikan socket lama dulu supaya tidak ada 2 koneksi bareng (penyebab WA memaksa logout)
    if (sock) {
      try { sock.ev.removeAllListeners(); sock.ws && sock.ws.close(); } catch {}
      sock = null;
    }
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    state.status = auth.creds.registered ? "connecting" : "offline";
    const s = makeWASocket({
      version,
      auth: { creds: auth.creds, keys: makeCacheableSignalKeyStore(auth.keys, silent) },
      logger: silent,
      printQRInTerminal: false,
      browser: Browsers.macOS("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      keepAliveIntervalMs: 25_000,
      connectTimeoutMs: 60_000,
      defaultQueryTimeoutMs: 60_000,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    sock = s;
    s.ev.on("creds.update", async () => { try { await saveCreds(); } catch (e) { log("error", "Gagal simpan sesi: " + e.message); } });
    s.ev.on("connection.update", ({ connection, lastDisconnect }) => {
      if (s !== sock) return; // event dari socket lama, abaikan
      if (connection === "open") {
        retries = 0;
        state.status = "online";
        state.pairingCode = "";
        state.number = (s.user && s.user.id || "").split(":")[0].split("@")[0];
        log("system", `Tersambung sebagai ${state.number}`);
      }
      if (connection === "close") {
        const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
        if (code === DisconnectReason.loggedOut && s.authState.creds.registered && manualLogout) {
          manualLogout = false;
          state.status = "offline";
          state.number = "";
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          log("system", "Bot diputuskan. Minta pairing code baru untuk menyambung.");
          scheduleStart(1500);
        } else if (code === DisconnectReason.loggedOut && s.authState.creds.registered) {
          // Logout dari HP / WA. Coba sambung ulang beberapa kali dulu sebelum hapus sesi.
          retries += 1;
          if (retries <= 3) {
            state.status = "connecting";
            log("system", `WhatsApp menolak sesi (401), coba lagi ${retries}/3...`);
            scheduleStart(5000 * retries);
          } else {
            retries = 0;
            state.status = "offline";
            state.number = "";
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            log("system", "Keluar dari WhatsApp. Minta pairing code baru untuk menyambung.");
            scheduleStart(1500);
          }
        } else if (code === DisconnectReason.connectionReplaced) {
          state.status = "connecting";
          log("system", "Ada koneksi lain memakai sesi ini, tunggu 30 detik...");
          scheduleStart(30000);
        } else {
          state.status = s.authState.creds.registered ? "connecting" : "offline";
          const wait = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 3000 * (retries + 1));
          if (code !== DisconnectReason.restartRequired) retries += 1;
          log("system", `Koneksi terputus (${code || "?"}), menyambung ulang...`);
          scheduleStart(wait);
        }
      }
    });
    s.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) onMessage(m);
    });
  } finally {
    starting = false;
  }
}

let manualLogout = false;

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
      manualLogout = true;
      await sock.logout().catch(() => {});
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: "Tidak ditemukan" });
  } catch (e) {
    return send(res, 400, { error: e.message || "Gagal" });
  }
}).listen(PORT, () => console.log(`Bot API jalan di port ${PORT}`));

start().catch((e) => { log("error", e.message); scheduleStart(10000); });
process.on("unhandledRejection", (e) => log("error", String(e && e.message || e)));
process.on("uncaughtException", (e) => log("error", String(e && e.message || e)));
// Railway mematikan container lama saat deploy: tutup koneksi rapi tanpa logout
process.on("SIGTERM", () => { try { sock && sock.ws && sock.ws.close(); } catch {} setTimeout(() => process.exit(0), 1500); });
