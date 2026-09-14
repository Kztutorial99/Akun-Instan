/**
 * Menu interaktif bot Telegram Akun Instan.
 * Semua tampilan menu (tombol + isi teks) dikumpulkan di sini supaya
 * webhook cukup memanggil satu fungsi.
 */

const { db, ensureTables } = require("./_users");
const { escapeHtml, rupiah, waktuWib, reviewKeyboard } = require("./_telegram");

const STATUS_ICON = { pending: "⏳", approved: "✅", rejected: "❌" };

/** Tombol menu utama. */
function mainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "⏳ Pending Top Up", callback_data: "menu:pending" },
        { text: "🧾 Riwayat", callback_data: "menu:history" },
      ],
      [
        { text: "📊 Statistik", callback_data: "menu:stats" },
        { text: "👥 Pengguna", callback_data: "menu:users" },
      ],
      [
        { text: "🩺 Status Sistem", callback_data: "menu:health" },
        { text: "ℹ️ Bantuan", callback_data: "menu:help" },
      ],
      [{ text: "🔄 Muat Ulang", callback_data: "menu:home" }],
    ],
  };
}

function backKeyboard(extraRows) {
  return {
    inline_keyboard: [
      ...(extraRows || []),
      [{ text: "⬅️ Menu Utama", callback_data: "menu:home" }],
    ],
  };
}

/* ── Isi tiap menu ── */

function homeView() {
  return {
    text: [
      "🤖 <b>Akun Instan — Panel Admin</b>",
      "",
      "Pilih menu di bawah untuk melihat data toko secara langsung.",
      "Permintaan top up baru otomatis dikirim ke chat ini beserta bukti transfer dan tombol verifikasi.",
      "",
      `🕒 ${waktuWib()} WIB`,
    ].join("\n"),
    keyboard: mainMenuKeyboard(),
  };
}

function helpView() {
  return {
    text: [
      "ℹ️ <b>Daftar Perintah</b>",
      "",
      "/start atau /menu — buka menu utama",
      "/pending — daftar top up menunggu verifikasi",
      "/riwayat — 10 transaksi top up terakhir",
      "/statistik — ringkasan angka toko",
      "/pengguna — pengguna terbaru",
      "/status — cek koneksi database & konfigurasi",
      "/id — tampilkan chat ID kamu",
      "/bantuan — pesan ini",
      "",
      "Setiap top up baru muncul dengan tombol <b>✅ Setujui</b> / <b>❌ Tolak</b>. Menekan tombol langsung memperbarui saldo pengguna di database.",
    ].join("\n"),
    keyboard: backKeyboard(),
  };
}

async function pendingView(sql) {
  const rows = await sql`
    SELECT t.id, t.amount, t.method, t.reference, t.created_at AS "createdAt",
           u.name AS "userName", u.email AS "userEmail"
    FROM codexa_topups t JOIN codexa_users u ON u.id = t.user_id
    WHERE t.status = 'pending'
    ORDER BY t.created_at ASC
    LIMIT 10
  `;
  if (!rows.length) {
    return { text: "✅ <b>Tidak ada top up pending.</b>\n\nSemua permintaan sudah diproses.", keyboard: backKeyboard() };
  }
  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const lines = [`⏳ <b>${rows.length} Top Up Menunggu Verifikasi</b>`, `Total nilai: <b>${rupiah(total)}</b>`, ""];
  const buttons = [];
  rows.forEach((r, i) => {
    lines.push(
      `<b>${i + 1}. ${rupiah(r.amount)}</b> • ${escapeHtml(r.method || "-")}`,
      `   👤 ${escapeHtml(r.userName || "-")} (${escapeHtml(r.userEmail || "-")})`,
      `   🧾 <code>${escapeHtml(r.reference || "-")}</code>`,
      `   🕒 ${waktuWib(r.createdAt)} WIB`,
      "",
    );
    buttons.push([
      { text: `✅ #${i + 1}`, callback_data: `tp:approve:${r.id}` },
      { text: `❌ #${i + 1}`, callback_data: `tp:reject:${r.id}` },
    ]);
  });
  return { text: lines.join("\n"), keyboard: backKeyboard(buttons) };
}

async function historyView(sql) {
  const rows = await sql`
    SELECT t.amount, t.method, t.status, t.created_at AS "createdAt", u.name AS "userName"
    FROM codexa_topups t JOIN codexa_users u ON u.id = t.user_id
    ORDER BY t.created_at DESC LIMIT 10
  `;
  if (!rows.length) return { text: "🧾 Belum ada transaksi top up.", keyboard: backKeyboard() };
  const lines = ["🧾 <b>10 Top Up Terakhir</b>", ""];
  rows.forEach((r) => {
    lines.push(
      `${STATUS_ICON[r.status] || "•"} <b>${rupiah(r.amount)}</b> — ${escapeHtml(r.userName || "-")}`,
      `   ${escapeHtml(r.method || "-")} • ${waktuWib(r.createdAt)} WIB`,
    );
  });
  return { text: lines.join("\n"), keyboard: backKeyboard() };
}

async function statsView(sql) {
  const [t] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
      COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
      COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::bigint AS "approvedAmount",
      COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::bigint AS "pendingAmount",
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS today
    FROM codexa_topups
  `;
  const [u] = await sql`
    SELECT COUNT(*)::int AS total,
           COALESCE(SUM(balance), 0)::bigint AS balance,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS baru
    FROM codexa_users
  `;
  return {
    text: [
      "📊 <b>Statistik Akun Instan</b>",
      "",
      "💰 <b>Top Up</b>",
      `Total permintaan : ${t.total}`,
      `⏳ Pending : ${t.pending} (${rupiah(t.pendingAmount)})`,
      `✅ Disetujui : ${t.approved} (${rupiah(t.approvedAmount)})`,
      `❌ Ditolak : ${t.rejected}`,
      `📅 24 jam terakhir : ${t.today}`,
      "",
      "👥 <b>Pengguna</b>",
      `Total akun : ${u.total}`,
      `Baru 7 hari : ${u.baru}`,
      `Total saldo beredar : <b>${rupiah(u.balance)}</b>`,
      "",
      `🕒 ${waktuWib()} WIB`,
    ].join("\n"),
    keyboard: backKeyboard(),
  };
}

async function usersView(sql) {
  const rows = await sql`
    SELECT name, email, balance, created_at AS "createdAt"
    FROM codexa_users ORDER BY created_at DESC LIMIT 10
  `;
  if (!rows.length) return { text: "👥 Belum ada pengguna terdaftar.", keyboard: backKeyboard() };
  const lines = ["👥 <b>10 Pengguna Terbaru</b>", ""];
  rows.forEach((r, i) => {
    lines.push(
      `<b>${i + 1}. ${escapeHtml(r.name || "-")}</b>`,
      `   ✉️ ${escapeHtml(r.email || "-")}`,
      `   💳 Saldo ${rupiah(r.balance)} • daftar ${waktuWib(r.createdAt)} WIB`,
    );
  });
  return { text: lines.join("\n"), keyboard: backKeyboard() };
}

async function healthView(sql) {
  let dbStatus = "✅ Terhubung";
  try {
    await sql`SELECT 1`;
  } catch (error) {
    dbStatus = `❌ Gagal (${escapeHtml((error && error.message) || "unknown")})`;
  }
  const flag = (name) => (process.env[name] ? "✅" : "❌");
  return {
    text: [
      "🩺 <b>Status Sistem</b>",
      "",
      `Database : ${dbStatus}`,
      `${flag("TELEGRAM_BOT_TOKEN")} TELEGRAM_BOT_TOKEN`,
      `${flag("TELEGRAM_ADMIN_CHAT_ID")} TELEGRAM_ADMIN_CHAT_ID`,
      `${flag("TELEGRAM_WEBHOOK_SECRET")} TELEGRAM_WEBHOOK_SECRET`,
      `${flag("ADMIN_PASSWORD")} ADMIN_PASSWORD`,
      "",
      `🕒 ${waktuWib()} WIB`,
    ].join("\n"),
    keyboard: backKeyboard(),
  };
}

/** Peta menu -> view. Mengembalikan { text, keyboard }. */
async function renderMenu(key) {
  if (key === "home") return homeView();
  if (key === "help") return helpView();
  const sql = db();
  await ensureTables(sql);
  if (key === "pending") return pendingView(sql);
  if (key === "history") return historyView(sql);
  if (key === "stats") return statsView(sql);
  if (key === "users") return usersView(sql);
  if (key === "health") return healthView(sql);
  return homeView();
}

/** Terjemahkan teks perintah jadi kunci menu. Null kalau bukan perintah. */
function commandToMenu(rawText) {
  const cmd = String(rawText || "").trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  const map = {
    "/start": "home",
    "/menu": "home",
    "/pending": "pending",
    "/riwayat": "history",
    "/history": "history",
    "/statistik": "stats",
    "/stats": "stats",
    "/pengguna": "users",
    "/users": "users",
    "/status": "health",
    "/health": "health",
    "/bantuan": "help",
    "/help": "help",
  };
  return map[cmd] || null;
}

const BOT_COMMANDS = [
  { command: "menu", description: "Buka menu utama" },
  { command: "pending", description: "Top up menunggu verifikasi" },
  { command: "riwayat", description: "10 top up terakhir" },
  { command: "statistik", description: "Ringkasan angka toko" },
  { command: "pengguna", description: "Pengguna terbaru" },
  { command: "status", description: "Cek koneksi & konfigurasi" },
  { command: "id", description: "Tampilkan chat ID" },
  { command: "bantuan", description: "Daftar perintah" },
];

module.exports = { renderMenu, commandToMenu, mainMenuKeyboard, backKeyboard, BOT_COMMANDS, reviewKeyboard };
