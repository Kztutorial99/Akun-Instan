/* Baca inbox Gmail (IMAP, App Password) untuk email kode verifikasi login yang dikirim ke email pemulihan toko. */
const { filterInboxMessages } = require("./_inbox-match");

async function fetchRecentMessages({ account, sinceDays = 2, limit = 40 }) {
  const user = process.env.GMAIL_ADDRESS;
  const pass = String(process.env.GOOGLE_APP_PASSWORD || "").replace(/\s/g, "");
  if (!user || !pass) throw new Error("INBOX_NOT_CONFIGURED");
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");
  const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user, pass }, logger: false });
  const out = [];
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    /* Gmail mendukung pencarian teks penuh: batasi ke email yang menyebut akun, lalu saring lagi di kode. */
    const uids = await client.search({ since: new Date(Date.now() - sinceDays * 864e5), text: account }, { uid: true });
    for await (const m of client.fetch((uids || []).slice(-limit), { source: true }, { uid: true })) {
      const p = await simpleParser(m.source);
      out.push({
        id: String(m.uid),
        from: p.from && p.from.text || "",
        to: p.to && p.to.text || "",
        subject: p.subject || "",
        date: p.date || null,
        text: p.text || "",
      });
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return out;
}

async function readInbox({ account, since }) {
  const raw = await fetchRecentMessages({ account });
  return filterInboxMessages(raw, { account, since });
}

module.exports = { readInbox };
