const { ensureNotificationTables } = require("./_notifications");
const { bodyOf, text } = require("./_users");

/**
 * Handler notifikasi. Tidak dibuat file API sendiri karena Vercel Hobby
 * dibatasi 12 serverless function; endpoint /api/notifications di-rewrite
 * ke /api/topup?resource=notifications (lihat vercel.json).
 */
async function handleNotifications(sql, user, request, response) {
  try {
    await ensureNotificationTables(sql);
    if (request.method === "GET") {
      const rows = await sql`
        SELECT id, type, title, body, link, read_at AS "readAt", created_at AS "createdAt"
        FROM codexa_notifications WHERE user_id = ${user.id}
        ORDER BY created_at DESC LIMIT ${request.query && request.query.all ? 200 : 30}
      `;
      const [agg] = await sql`
        SELECT COUNT(*)::int AS unread FROM codexa_notifications
        WHERE user_id = ${user.id} AND read_at IS NULL
      `;
      return response.status(200).json({
        notifications: rows.map((r) => ({ ...r, read: Boolean(r.readAt) })),
        unread: Number(agg && agg.unread) || 0,
      });
    }

    if (request.method === "PATCH") {
      const body = bodyOf(request);
      const id = text(body.id, 60);
      if (id) {
        await sql`UPDATE codexa_notifications SET read_at = NOW()
                  WHERE user_id = ${user.id} AND id = ${id} AND read_at IS NULL`;
      } else {
        await sql`UPDATE codexa_notifications SET read_at = NOW()
                  WHERE user_id = ${user.id} AND read_at IS NULL`;
      }
      const [agg] = await sql`
        SELECT COUNT(*)::int AS unread FROM codexa_notifications
        WHERE user_id = ${user.id} AND read_at IS NULL
      `;
      return response.status(200).json({ ok: true, unread: Number(agg && agg.unread) || 0 });
    }

    if (request.method === "DELETE") {
      const body = bodyOf(request);
      const id = text(body.id, 60);
      if (id) await sql`DELETE FROM codexa_notifications WHERE user_id = ${user.id} AND id = ${id}`;
      else await sql`DELETE FROM codexa_notifications WHERE user_id = ${user.id}`;
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, PATCH, DELETE");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Notification failure", error && error.message);
    return response.status(500).json({ error: "Notifikasi gagal dimuat" });
  }
}

module.exports = { handleNotifications };
