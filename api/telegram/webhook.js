/**
 * Webhook Telegram: menerima tombol Setujui / Tolak dari chat admin
 * lalu memperbarui status top up + saldo pengguna.
 *
 * Keamanan: Telegram wajib mengirim header X-Telegram-Bot-Api-Secret-Token
 * yang cocok dengan TELEGRAM_WEBHOOK_SECRET, dan aksi hanya diterima
 * dari TELEGRAM_ADMIN_CHAT_ID.
 */

const crypto = require("crypto");
const { db, ensureTables, bodyOf } = require("../_users");
const { callTelegram, adminChatId, topupMessage } = require("../_telegram");
const { renderMenu, commandToMenu, mainMenuKeyboard } = require("../_telegram-menu");

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function ack(callbackId, textMessage, alert) {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackId,
    text: textMessage,
    show_alert: Boolean(alert),
  });
}

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET belum diatur");
    return response.status(500).json({ error: "Webhook belum dikonfigurasi" });
  }
  if (!safeEqual(request.headers["x-telegram-bot-api-secret-token"], secret)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  let update;
  try {
    update = bodyOf(request);
  } catch (_) {
    return response.status(200).json({ ok: true, ignored: true });
  }

  /* ── Pesan teks / perintah menu ── */
  const message = update && (update.message || update.edited_message);
  if (message && message.chat) {
    const from = String(message.chat.id);
    const teks = String(message.text || "").trim();
    if (from !== String(adminChatId())) {
      await callTelegram("sendMessage", {
        chat_id: from,
        text: `🤖 <b>Akun Instan Bot</b>\n\nBot ini khusus untuk admin toko.\nChat ID kamu: <code>${from}</code>`,
        parse_mode: "HTML",
      });
      return response.status(200).json({ ok: true, ignored: true });
    }
    if (/^\/id\b/i.test(teks)) {
      await callTelegram("sendMessage", {
        chat_id: from,
        text: `🆔 Chat ID: <code>${from}</code>`,
        parse_mode: "HTML",
      });
      return response.status(200).json({ ok: true });
    }
    const key = commandToMenu(teks);
    if (!key) {
      await callTelegram("sendMessage", {
        chat_id: from,
        text: "Perintah tidak dikenal. Pilih menu di bawah 👇",
        reply_markup: mainMenuKeyboard(),
      });
      return response.status(200).json({ ok: true });
    }
    try {
      const view = await renderMenu(key);
      await callTelegram("sendMessage", {
        chat_id: from,
        text: view.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: view.keyboard,
      });
    } catch (error) {
      console.error("Menu failure", error && error.message);
      await callTelegram("sendMessage", { chat_id: from, text: "⚠️ Gagal mengambil data, coba lagi sebentar." });
    }
    return response.status(200).json({ ok: true });
  }

  const callback = update && update.callback_query;
  if (!callback) return response.status(200).json({ ok: true, ignored: true });

  const chatId = String((callback.message && callback.message.chat && callback.message.chat.id) || "");
  if (!chatId || chatId !== String(adminChatId())) {
    await ack(callback.id, "Kamu tidak berwenang memproses top up.", true);
    return response.status(200).json({ ok: true, ignored: true });
  }

  const [namespace, action, topupId] = String(callback.data || "").split(":");

  /* ── Navigasi menu lewat tombol ── */
  if (namespace === "menu") {
    try {
      const view = await renderMenu(action || "home");
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: callback.message.message_id,
        text: view.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: view.keyboard,
      });
      await ack(callback.id, "");
    } catch (error) {
      console.error("Menu callback failure", error && error.message);
      await ack(callback.id, "Gagal memuat menu.", true);
    }
    return response.status(200).json({ ok: true });
  }

  if (namespace !== "tp" || !["approve", "reject"].includes(action) || !topupId) {

    await ack(callback.id, "Perintah tidak dikenal.");
    return response.status(200).json({ ok: true, ignored: true });
  }

  try {
    const sql = db();
    await ensureTables(sql);

    const rows = await sql`
      SELECT t.id, t.user_id AS "userId", t.amount, t.method, t.reference, t.note, t.status,
             t.created_at AS "createdAt",
             u.name AS "userName", u.email AS "userEmail", u.phone AS "userPhone", u.balance AS "userBalance"
      FROM codexa_topups t JOIN codexa_users u ON u.id = t.user_id
      WHERE t.id = ${topupId} LIMIT 1
    `;
    const topup = rows[0];
    if (!topup) {
      await ack(callback.id, "Permintaan top up tidak ditemukan.", true);
      return response.status(200).json({ ok: true });
    }
    if (topup.status !== "pending") {
      await ack(callback.id, `Permintaan ini sudah ${topup.status === "approved" ? "disetujui" : "ditolak"}.`, true);
      return response.status(200).json({ ok: true });
    }

    const amount = Number(topup.amount) || 0;
    let newBalance = Number(topup.userBalance) || 0;

    /* Klaim status dulu (atomic). Kalau webhook dikirim dua kali,
       hanya klaim pertama yang lolos sehingga saldo tidak dobel. */
    const nextStatus = action === "approve" ? "approved" : "rejected";
    const [claimed] = await sql`
      UPDATE codexa_topups SET status = ${nextStatus}, reviewed_at = NOW()
      WHERE id = ${topupId} AND status = 'pending'
      RETURNING id
    `;
    if (!claimed) {
      await ack(callback.id, "Permintaan ini sudah diproses admin lain.", true);
      return response.status(200).json({ ok: true });
    }

    if (action === "approve") {
      try {
        const updated = await sql`
          UPDATE codexa_users SET balance = balance + ${amount} WHERE id = ${topup.userId} RETURNING balance
        `;
        newBalance = Number(updated[0] && updated[0].balance) || newBalance;
      } catch (error) {
        // Saldo gagal ditambah → balikkan status ke pending supaya bisa diulang.
        await sql`UPDATE codexa_topups SET status = 'pending', reviewed_at = NULL WHERE id = ${topupId}`;
        throw error;
      }
    }

    const status = action === "approve" ? "approved" : "rejected";
    const reviewer = [callback.from && callback.from.first_name, callback.from && callback.from.username && `@${callback.from.username}`]
      .filter(Boolean)
      .join(" ");

    const isPhoto = Boolean(callback.message && (callback.message.photo || callback.message.document));
    await callTelegram(isPhoto ? "editMessageCaption" : "editMessageText", {
      chat_id: chatId,
      message_id: callback.message.message_id,
      [isPhoto ? "caption" : "text"]: topupMessage({
        topup: {
          id: topup.id,
          amount,
          method: topup.method,
          reference: topup.reference,
          note: topup.note,
          createdAt: topup.createdAt,
        },
        user: {
          name: topup.userName,
          email: topup.userEmail,
          phone: topup.userPhone,
          balance: newBalance,
        },
        status,
        reviewer: reviewer || "admin",
      }),
      parse_mode: "HTML",
    });

    await ack(callback.id, action === "approve" ? "Top up disetujui, saldo ditambahkan." : "Top up ditolak.");
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failure", error && error.message);
    await ack(callback.id, "Gagal memproses, coba lagi sebentar.", true);
    return response.status(200).json({ ok: false });
  }
};
