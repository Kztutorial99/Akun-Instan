import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { normalizePhone, shouldReply, pushHistory } = require("../wa-bot/rules.js");

const msg = (jid, text, fromMe = false) => ({ key: { remoteJid: jid, fromMe }, message: { conversation: text } });

test("nomor 08xx diubah ke 628xx", () => {
  assert.equal(normalizePhone("0812-3456-789"), "628123456789");
  assert.equal(normalizePhone("+62 812 3456 789"), "628123456789");
  assert.equal(normalizePhone("123"), "");
});

test("bot hanya membalas chat pribadi dari orang lain", () => {
  assert.equal(shouldReply(msg("6281@s.whatsapp.net", "halo")), true);
  assert.equal(shouldReply(msg("1203@g.us", "halo")), false);
  assert.equal(shouldReply(msg("status@broadcast", "halo")), false);
  assert.equal(shouldReply(msg("6281@s.whatsapp.net", "halo", true)), false);
  assert.equal(shouldReply(msg("6281@s.whatsapp.net", "")), false);
});

test("balasan AI mati saat dimatikan admin", () => {
  assert.equal(shouldReply(msg("6281@s.whatsapp.net", "halo"), { enabled: false }), false);
});

test("riwayat chat dibatasi 12 pesan", () => {
  const store = new Map();
  for (let i = 0; i < 20; i++) pushHistory(store, "a", "user", `p${i}`);
  assert.equal(store.get("a").length, 12);
  assert.equal(store.get("a")[0].content, "p8");
});
