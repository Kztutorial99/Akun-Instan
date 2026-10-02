/**
 * Asisten AI + antrian kirim komentar YouTube.
 * - Asisten: cari video (kata kunci, relevansi, min views, terpopuler), buat draft komentar.
 * - Antrian: admin Apply -> status 'queued'. Worker mengirim 1 komentar tiap 15 menit.
 * - Anti duplikat: 1 komentar per video, video yang sudah pernah diproses tidak dipakai lagi.
 */
const yt = require("./_youtube");
const P = require("./_yt-promo");

const GAP_MINUTES = 15;
const DEFAULT_KEYWORDS = [
  "cara buat akun google",
  "cara buat akun google tanpa verifikasi nomor",
  "cara membuat akun gmail baru",
  "akun google",
];

async function ensureQueueSchema(sql) {
  await sql`ALTER TABLE codexa_yt_drafts ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ`;
  await sql`ALTER TABLE codexa_yt_drafts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ`;
}

async function readState(sql) {
  const rows = await sql`SELECT value FROM codexa_yt_settings WHERE key = 'queue_state' LIMIT 1`;
  return { paused: false, reason: "", ...((rows[0] && rows[0].value) || {}) };
}
async function writeState(sql, state) {
  await sql`
    INSERT INTO codexa_yt_settings (key, value, updated_at)
    VALUES ('queue_state', ${JSON.stringify(state)}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`;
}

async function usedVideoIds(sql, ids) {
  if (!ids.length) return new Set();
  const rows = await sql`
    SELECT video_id AS "videoId" FROM codexa_yt_drafts WHERE video_id = ANY(${ids}) AND status <> 'rejected'
    UNION
    SELECT video_id AS "videoId" FROM codexa_yt_promotions WHERE video_id = ANY(${ids}) AND status = 'sent'`;
  return new Set(rows.map((r) => r.videoId));
}

/** Asisten: cari video cocok + buat draft komentar. */
async function assistantFind(sql, input) {
  await ensureQueueSchema(sql);
  const settings = await P.readSettings(sql);
  const count = P.clampInt(input.count, 1, 10, 5);
  const minViews = Math.max(0, Number(input.minViews) || 2000);
  const fromPrompt = String(input.prompt || "")
    .split(/[\n,;]+/).map((s) => P.trim(s, 100)).filter((s) => s.length > 2);
  const keywords = (fromPrompt.length ? fromPrompt : DEFAULT_KEYWORDS).slice(0, 3);

  const blacklist = await P.readBlacklist(sql);
  const isBlocked = P.blacklistFilter(blacklist);
  const pool = new Map();
  const found = await Promise.all(keywords.map((keyword) =>
    yt.searchVideos({ keyword, order: "viewCount", maxResults: 15 })
      .then((list) => list.map((v) => ({ v, keyword })))
      .catch(() => [])));
  for (const { v, keyword } of found.flat()) {
    const category = P.detectCategory(keyword);
    {
      if (pool.has(v.videoId) || Number(v.views) < minViews || isBlocked(v)) continue;
      pool.set(v.videoId, { ...v, keyword, category, relevance: P.relevanceScore({ ...v, keyword, category }) });
    }
  }
  const used = await usedVideoIds(sql, [...pool.keys()]);
  const picked = [...pool.values()]
    .filter((v) => !used.has(v.videoId) && v.relevance >= settings.minRelevance)
    .sort((a, b) => b.relevance - a.relevance || b.views - a.views)
    .slice(0, count);

  for (const v of picked) {
    await sql`
      INSERT INTO codexa_yt_videos (video_id, channel_id, channel_title, title, description, thumbnail, published_at, views, keyword, category, relevance, status, updated_at)
      VALUES (${v.videoId}, ${v.channelId}, ${v.channelTitle}, ${P.trim(v.title, 300)}, ${P.trim(v.description, 1500)},
              ${v.thumbnail}, ${v.publishedAt}, ${Math.round(Number(v.views) || 0)}, ${v.keyword}, ${v.category}, ${v.relevance}, 'found', NOW())
      ON CONFLICT (video_id) DO UPDATE SET views = EXCLUDED.views, relevance = EXCLUDED.relevance, updated_at = NOW()`;
  }
  const results = picked.map((v) => ({
    videoId: v.videoId, title: v.title, channelTitle: v.channelTitle, thumbnail: v.thumbnail,
    views: v.views, relevance: v.relevance, keyword: v.keyword,
  }));
  await P.logActivity(sql, { status: "assistant", detail: `Asisten menemukan ${results.length} video (${keywords.join(", ")})` });
  return { results, keywords, scanned: pool.size };
}

/** Buat 1 draft komentar untuk 1 video hasil asisten. */
async function assistantDraft(sql, videoId) {
  await ensureQueueSchema(sql);
  const settings = await P.readSettings(sql);
  const [v] = await sql`
    SELECT video_id AS "videoId", title, description, channel_title AS "channelTitle", keyword, category
      FROM codexa_yt_videos WHERE video_id = ${videoId} LIMIT 1`;
  if (!v) { const e = new Error("Video tidak ditemukan, cari ulang."); e.status = 404; throw e; }
  const used = await usedVideoIds(sql, [videoId]);
  if (used.has(videoId)) { const e = new Error("Video ini sudah pernah diproses."); e.status = 409; throw e; }
  const draft = await P.generateDraft(sql, { video: v, keyword: v.keyword, category: v.category, profile: settings.profile });
  const comment = P.humanizeComment(draft.comment) || draft.comment;
  const id = P.newId("ytd");
  await sql`
    INSERT INTO codexa_yt_drafts (id, video_id, keyword, category, comment, status, source)
    VALUES (${id}, ${videoId}, ${v.keyword}, ${v.category}, ${comment}, 'pending', 'assistant')`;
  await sql`UPDATE codexa_yt_videos SET status = 'drafted', updated_at = NOW() WHERE video_id = ${videoId}`;
  return { id, comment, source: draft.source };
}

/** Apply: masukkan draft ke antrian (boleh sekalian edit komentar). */
async function enqueue(sql, items) {
  await ensureQueueSchema(sql);
  let added = 0;
  for (const item of (Array.isArray(items) ? items : []).slice(0, 30)) {
    const id = P.trim(item && item.id, 60);
    if (!id) continue;
    const comment = item.comment ? P.trim(item.comment, 400) : null;
    const rows = await sql`
      UPDATE codexa_yt_drafts
         SET status = 'queued', queued_at = NOW(), error = NULL, updated_at = NOW(),
             comment = COALESCE(${comment}, comment)
       WHERE id = ${id} AND status IN ('pending', 'approved', 'failed')
       RETURNING id`;
    added += rows.length;
  }
  return added;
}

async function queueOverview(sql) {
  await ensureQueueSchema(sql);
  const state = await readState(sql);
  const items = await sql`
    SELECT d.id, d.video_id AS "videoId", d.comment, d.status, d.error, d.queued_at AS "queuedAt",
           d.sent_at AS "sentAt", v.title, v.channel_title AS "channelTitle", v.thumbnail, v.views
      FROM codexa_yt_drafts d LEFT JOIN codexa_yt_videos v ON v.video_id = d.video_id
     WHERE d.queued_at IS NOT NULL
     ORDER BY CASE WHEN d.status IN ('queued','sending') THEN 0 ELSE 1 END, d.queued_at ASC
     LIMIT 60`;
  const [counts] = await sql`
    SELECT COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
           COUNT(*) FILTER (WHERE status = 'sent' AND queued_at IS NOT NULL)::int AS sent,
           COUNT(*) FILTER (WHERE status IN ('failed','skipped') AND queued_at IS NOT NULL)::int AS failed
      FROM codexa_yt_drafts`;
  const [last] = await sql`SELECT MAX(created_at) AS at FROM codexa_yt_promotions`;
  const lastAt = last && last.at ? new Date(last.at).getTime() : 0;
  const nextAt = Math.max(Date.now(), lastAt + GAP_MINUTES * 60000);
  return { state, counts, items, gapMinutes: GAP_MINUTES, nextAt: new Date(nextAt).toISOString() };
}

/** Worker: kirim maksimal 1 komentar bila jeda 15 menit sudah lewat. */
async function processQueue(sql, { readAccount, activeAccessToken, accountId }) {
  await ensureQueueSchema(sql);
  const settings = await P.readSettings(sql);
  const state = await readState(sql);
  if (!settings.enabled || state.paused) return { ran: false, reason: state.paused ? "paused" : "stopped" };

  const [last] = await sql`SELECT MAX(created_at) AS at FROM codexa_yt_promotions`;
  if (last && last.at && Date.now() - new Date(last.at).getTime() < GAP_MINUTES * 60000) {
    return { ran: false, reason: "gap" };
  }
  // kunci: ambil 1 item secara atomik
  await sql`UPDATE codexa_yt_drafts SET status = 'queued' WHERE status = 'sending' AND updated_at < NOW() - INTERVAL '5 minutes'`;
  const [draft] = await sql`
    UPDATE codexa_yt_drafts SET status = 'sending', updated_at = NOW()
     WHERE id = (SELECT id FROM codexa_yt_drafts WHERE status = 'queued' ORDER BY queued_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)
       AND NOT EXISTS (SELECT 1 FROM codexa_yt_drafts WHERE status = 'sending')
     RETURNING id, video_id AS "videoId", comment, keyword`;
  if (!draft) return { ran: false, reason: "empty" };

  const [dup] = await sql`SELECT 1 AS ok FROM codexa_yt_promotions WHERE video_id = ${draft.videoId} AND status = 'sent' LIMIT 1`;
  if (dup) {
    await sql`UPDATE codexa_yt_drafts SET status = 'skipped', error = 'Video sudah pernah dikomentari', updated_at = NOW() WHERE id = ${draft.id}`;
    return { ran: true, skipped: true };
  }
  const [video] = await sql`SELECT title, channel_title AS "channelTitle" FROM codexa_yt_videos WHERE video_id = ${draft.videoId} LIMIT 1`;
  const account = await readAccount(sql);
  const promoId = P.newId("ytp");
  const text = P.humanizeComment(draft.comment);
  try {
    if (!text || text.length < 8) throw new Error("Komentar terlalu pendek setelah dibersihkan");
    const token = await activeAccessToken(sql, account);
    const sent = await yt.postComment({ accessToken: token, videoId: draft.videoId, text });
    await sql`
      INSERT INTO codexa_yt_promotions (id, draft_id, video_id, account_id, channel_title, comment, comment_id, status, admin)
      VALUES (${promoId}, ${draft.id}, ${draft.videoId}, ${accountId}, ${(account && account.channelTitle) || ""}, ${text}, ${sent.commentId}, 'sent', 'auto')`;
    await sql`UPDATE codexa_yt_drafts SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = ${draft.id}`;
    await sql`UPDATE codexa_yt_videos SET status = 'promoted', updated_at = NOW() WHERE video_id = ${draft.videoId}`;
    await P.logActivity(sql, {
      videoId: draft.videoId, videoTitle: video && video.title, channelTitle: video && video.channelTitle,
      keyword: draft.keyword, draft: text, status: "sent", admin: "auto", account: (account && account.channelTitle) || "", commentId: sent.commentId,
    });
    return { ran: true, ok: true };
  } catch (error) {
    const message = ((error && error.message) || "Gagal mengirim").slice(0, 500);
    await sql`
      INSERT INTO codexa_yt_promotions (id, draft_id, video_id, account_id, channel_title, comment, status, error, admin)
      VALUES (${promoId}, ${draft.id}, ${draft.videoId}, ${accountId}, ${(account && account.channelTitle) || ""}, ${text || draft.comment}, 'failed', ${message}, 'auto')`;
    await sql`UPDATE codexa_yt_drafts SET status = 'failed', error = ${message}, updated_at = NOW() WHERE id = ${draft.id}`;
    await P.logActivity(sql, { videoId: draft.videoId, videoTitle: video && video.title, status: "failed", admin: "auto", detail: message });
    // Pemutus otomatis: masalah akun/kuota -> antrian dijeda, tidak dicoba terus.
    if (/quota|kuota|forbidden|403|401|belum terhubung|invalid_grant|izin|permission/i.test(message)) {
      await writeState(sql, { paused: true, reason: message, at: new Date().toISOString() });
    }
    return { ran: true, ok: false, error: message };
  }
}

module.exports = { assistantFind, assistantDraft, enqueue, queueOverview, processQueue, readState, writeState, ensureQueueSchema, GAP_MINUTES };
