/** Helper format teks (Rupiah, waktu WIB, escape HTML). */
const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const rupiah = (value) => `Rp${(Number(value) || 0).toLocaleString("id-ID")}`;

function waktuWib(date) {
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(date ? new Date(date) : new Date());
  } catch (_) {
    return new Date().toISOString();
  }
}

/** Susun isi pesan notifikasi top up. */
module.exports = { escapeHtml, rupiah, waktuWib };
