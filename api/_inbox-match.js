/* Aturan pencocokan email kode verifikasi login (murni, tanpa IMAP) supaya bisa diuji. */

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

/* Kode verifikasi Google: 6 digit, bisa muncul di subjek ("Gunakan 085911 untuk ...") atau di badan email. */
function extractCode(text) {
  const src = String(text || "");
  const fromSubject = src.match(/(?:gunakan|use)\s+(\d{6})\b/i);
  if (fromSubject) return fromSubject[1];
  const line = src.match(/(?:^|\n)\s*(\d{6})\s*(?:\n|$)/);
  if (line) return line[1];
  const any = src.match(/\b(\d{6})\b/);
  return any ? any[1] : "";
}

/* Email dianggap milik akun yang minta kode kalau alamat akunnya disebut di subjek/badan email. */
function mentionsAccount(message, account) {
  const acct = normalizeEmail(account);
  if (!acct) return false;
  const hay = `${message.subject || ""}\n${message.text || ""}`.toLowerCase();
  /* Harus alamat utuh: "test123@gmail.com" tidak boleh cocok dengan "mytest123@gmail.com"
     atau "test123@gmail.com.id". */
  const esc = acct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9._%+-])${esc}(?![a-z0-9.-]*[a-z0-9])`, "i").test(hay);
}

/* Hanya email kode yang relevan: disebut akunnya, ada kode 6 digit, dan datang setelah permintaan dibuat
   (toleransi 10 menit mundur supaya kode yang baru saja dikirim tetap terlihat). */
function filterInboxMessages(messages, { account, since } = {}) {
  const floor = since ? new Date(since).getTime() - 10 * 60 * 1000 : 0;
  return (messages || [])
    .filter((m) => {
      const at = m.date ? new Date(m.date).getTime() : 0;
      if (floor && at && at < floor) return false;
      if (!mentionsAccount(m, account)) return false;
      return !!extractCode(`${m.subject || ""}\n${m.text || ""}`);
    })
    .map((m) => ({
      id: String(m.id || ""),
      from: m.from || "",
      to: m.to || "",
      subject: m.subject || "",
      date: m.date ? new Date(m.date).toISOString() : "",
      code: extractCode(`${m.subject || ""}\n${m.text || ""}`),
      preview: String(m.text || "").replace(/\s+/g, " ").trim().slice(0, 220),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

module.exports = { normalizeEmail, extractCode, mentionsAccount, filterInboxMessages };
