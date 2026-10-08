import test from "node:test";
import assert from "node:assert/strict";
import inbox from "../api/_inbox-match.js";
const { extractCode, mentionsAccount, filterInboxMessages } = inbox;

const googleMail = {
  id: "1",
  from: "noreply@google.com",
  to: "code@akuninstan.com",
  subject: "Gunakan 085911 untuk menyiapkan email pemulihan",
  date: "2026-10-08T12:26:00.000Z",
  text: "ameliacan85@gmail.com ingin menggunakan alamat email Anda sebagai email pemulihannya.\n\n085911\n\nMasa berlaku kode ini 24 jam.",
};

test("kode 6 digit diambil dari subjek", () => {
  assert.equal(extractCode(googleMail.subject), "085911");
});

test("kode diambil dari badan email saat subjek tanpa angka", () => {
  assert.equal(extractCode("Verifikasi email pemulihan\n\n906277\n\nBerlaku 24 jam"), "906277");
});

test("email cocok hanya untuk akun yang minta kode", () => {
  assert.equal(mentionsAccount(googleMail, "AmeliaCan85@gmail.com"), true);
  assert.equal(mentionsAccount(googleMail, "orang.lain@gmail.com"), false);
});

test("inbox difilter per akun, wajib ada kode, dan tidak menampilkan email sebelum permintaan", () => {
  const lama = { ...googleMail, id: "2", date: "2026-10-01T00:00:00.000Z" };
  const lain = { ...googleMail, id: "3", text: "orang.lain@gmail.com minta kode\n\n111222" };
  const tanpaKode = { ...googleMail, id: "4", subject: "Notifikasi keamanan", text: "ameliacan85@gmail.com login baru" };
  const out = filterInboxMessages([googleMail, lama, lain, tanpaKode], {
    account: "ameliacan85@gmail.com",
    since: "2026-10-08T12:20:00.000Z",
  });
  assert.deepEqual(out.map((m) => m.id), ["1"]);
  assert.equal(out[0].code, "085911");
});
