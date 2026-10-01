/**
 * Data Laporan — endpoint admin panel.
 *
 *  GET    → daftar laporan AI + statistik + info masalah user
 *  PATCH  → { id, status?, adminNote? } ubah status / balas laporan (user dapat notifikasi)
 *  DELETE → ?id=  hapus satu laporan
 */
const { db, ensureTables, bodyOf, text } = require("../_users");
const { isAdmin } = require("./_auth");
const { createNotification } = require("../_notifications");

const STATUSES = ["open", "in_progress", "resolved", "closed"];
const STATUS_LABEL = { open: "Baru", in_progress: "Diproses", resolved: "Selesai", closed: "Ditutup" };
const safe = async (fn, fallback) => { try { return await fn(); } catch (_) { return fallback; } };

module.exports = async function handler(request, response) {
  if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });
  try {
    const sql = db();
    await ensureTables(sql);

    if (request.method === "GET") {
      const reports = await sql`
        SELECT r.id, r.ticket, r.user_id AS "userId", r.user_name AS "userName", r.user_email AS "userEmail",
               r.category, r.summary, r.detail, r.urgency, r.status, r.source, r.admin_note AS "adminNote",
               r.created_at AS "createdAt", r.updated_at AS "updatedAt",
               u.balance AS "userBalance", u.status AS "userStatus", u.phone AS "userPhone",
               (SELECT COUNT(*)::int FROM codexa_reports x WHERE x.user_id = r.user_id) AS "userReportCount"
        FROM codexa_reports r LEFT JOIN codexa_users u ON u.id = r.user_id
        ORDER BY (r.status IN ('open','in_progress')) DESC,
                 CASE r.urgency WHEN 'tinggi' THEN 0 WHEN 'sedang' THEN 1 ELSE 2 END,
                 r.created_at DESC
        LIMIT 300
      `;
      const [stats] = await sql`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status = 'open')::int AS open,
               COUNT(*) FILTER (WHERE status = 'in_progress')::int AS "inProgress",
               COUNT(*) FILTER (WHERE status IN ('resolved','closed'))::int AS done,
               COUNT(*) FILTER (WHERE urgency = 'tinggi' AND status IN ('open','in_progress'))::int AS urgent,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS today
        FROM codexa_reports
      `;
      const categories = await sql`
        SELECT category, COUNT(*)::int AS total FROM codexa_reports GROUP BY category ORDER BY total DESC
      `;
      const topUsers = await sql`
        SELECT user_id AS "userId", MAX(user_name) AS name, MAX(user_email) AS email,
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS today,
               COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS "openCount"
        FROM codexa_reports WHERE user_id IS NOT NULL
        GROUP BY user_id ORDER BY total DESC LIMIT 8
      `;
      // Info masalah user di luar laporan AI.
      const issues = {
        pendingTopups: await safe(async () => (await sql`SELECT COUNT(*)::int AS n FROM codexa_topups WHERE status = 'pending'`)[0].n, 0),
        rejectedTopups7d: await safe(async () => (await sql`SELECT COUNT(*)::int AS n FROM codexa_topups WHERE status = 'rejected' AND created_at > NOW() - INTERVAL '7 days'`)[0].n, 0),
        suspendedUsers: await safe(async () => (await sql`SELECT COUNT(*)::int AS n FROM codexa_users WHERE status <> 'active'`)[0].n, 0),
        limitedUsers: topUsers.filter((u) => u.today >= 3).length,
      };
      return response.status(200).json({ reports, stats, categories, topUsers, issues, limit: { perDay: 3, cooldownMin: 10 } });
    }

    if (request.method === "PATCH") {
      const body = bodyOf(request);
      const id = text(body.id, 80);
      const status = STATUSES.includes(body.status) ? body.status : null;
      const note = body.adminNote == null ? null : text(body.adminNote, 1500);
      if (!id || (!status && note == null)) return response.status(400).json({ error: "Data tidak lengkap" });
      const rows = await sql`
        UPDATE codexa_reports
        SET status = COALESCE(${status}, status),
            admin_note = COALESCE(${note}, admin_note),
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, ticket, user_id AS "userId", status, admin_note AS "adminNote"
      `;
      if (!rows.length) return response.status(404).json({ error: "Laporan tidak ditemukan" });
      const r = rows[0];
      if (r.userId) {
        await safe(() => createNotification(sql, {
          userId: r.userId,
          type: "report_update",
          title: `Laporan ${r.ticket}: ${STATUS_LABEL[r.status] || r.status}`,
          body: r.adminNote ? `Balasan admin: ${r.adminNote}` : "Status laporan kamu sudah diperbarui oleh admin.",
          link: "",
        }), null);
      }
      return response.status(200).json({ ok: true, report: r });
    }

    if (request.method === "DELETE") {
      const id = request.query && typeof request.query.id === "string" ? request.query.id : "";
      if (!id) return response.status(400).json({ error: "ID wajib diisi" });
      await sql`DELETE FROM codexa_reports WHERE id = ${id}`;
      return response.status(200).json({ ok: true });
    }

    response.setHeader("Allow", "GET, PATCH, DELETE");
    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Admin reports failure", error && error.message);
    return response.status(500).json({ error: "Gagal memuat data laporan" });
  }
};
