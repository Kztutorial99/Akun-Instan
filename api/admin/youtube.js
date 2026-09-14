/**
 * YouTube Promotion — endpoint admin panel (tanpa bot Telegram).
 *
 * Semua sub-resource lewat query ?resource= agar hemat jumlah serverless function.
 *
 *  GET    ?resource=overview     → statistik + pengaturan + status akun + status konfigurasi
 *  POST   ?resource=search       → cari video via YouTube Data API + skor relevansi
 *  POST   ?resource=draft        → buat draft komentar (AI) untuk satu video
 *  GET    ?resource=drafts       → daftar draft (filter status)
 *  PATCH  ?resource=draft        → edit / approve / reject draft
 *  POST   ?resource=send         → kirim komentar yang sudah di-approve ke YouTube
 *  GET    ?resource=settings     → baca pengaturan promosi
 *  PATCH  ?resource=settings     → simpan pengaturan promosi
 *  POST   ?resource=stop         → tombol STOP / lanjutkan promosi
 *  GET    ?resource=blacklist    → daftar blacklist
 *  POST   ?resource=blacklist    → tambah blacklist
 *  DELETE ?resource=blacklist    → hapus blacklist
 *  GET    ?resource=history      → riwayat promosi / log aktivitas
 *  POST   ?resource=connect      → buat URL OAuth YouTube
 *  DELETE ?resource=account      → putuskan akun YouTube
 *  GET    ?resource=callback     → callback OAuth (dipetakan dari /api/youtube/callback)
 */

const crypto = require("crypto");
const { db, bodyOf } = require("../_users");
const { isAdmin } = require("./_auth");
const yt = require("../_youtube");
const P = require("../_yt-promo");

const ACCOUNT_ID = "primary";

const html = (response, status, title, message) =>
  response.status(status).setHeader("Content-Type", "text/html; charset=utf-8").send(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0a10;color:#efeaff;font:14px/1.6 system-ui,sans-serif">
       <div style="max-width:420px;padding:28px;text-align:center">
         <h1 style="font-size:18px;margin:0 0 10px">${title}</h1>
         <p style="color:#b3a9cc;margin:0 0 20px">${message}</p>
         <a href="/admin" style="color:#c4a6ff">Kembali ke Admin Panel</a>
       </div>
     </body>`,
  );

/* ── state OAuth ditandatangani supaya callback tidak bisa dipalsukan ── */
function stateSecret() {
  return process.env.ADMIN_PASSWORD || process.env.ACCOUNT_CREDENTIALS_KEY || "akuninstan";
}
function signState() {
  const payload = String(Date.now());
  const sig = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
function verifyState(state) {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig) return false;
  const expect = crypto.createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Date.now() - Number(payload) < 30 * 60 * 1000;
}

/* ── akun YouTube tersimpan ── */
async function readAccount(sql) {
  await P.ensureYtTables(sql);
  const rows = await sql`
    SELECT id, channel_id AS "channelId", channel_title AS "channelTitle",
           access_token AS "accessToken", refresh_token AS "refreshToken",
           token_expires_at AS "expiresAt", last_sync AS "lastSync"
      FROM codexa_yt_accounts WHERE id = ${ACCOUNT_ID} LIMIT 1
  `;
  return rows[0] || null;
}

function publicAccount(account) {
  return {
    connected: Boolean(account && account.refreshToken),
    channelId: (account && account.channelId) || "",
    channelTitle: (account && account.channelTitle) || "",
    lastSync: (account && account.lastSync) || null,
  };
}

/** Ambil access token valid, refresh otomatis kalau kedaluwarsa. */
async function activeAccessToken(sql, account) {
  if (!account || !account.refreshToken) {
    const err = new Error("Akun YouTube belum terhubung. Hubungkan dulu di tab Akun YouTube.");
    err.status = 400;
    throw err;
  }
  const expires = account.expiresAt ? new Date(account.expiresAt).getTime() : 0;
  const token = P.decryptSecret(account.accessToken);
  if (token && expires - Date.now() > 60_000) return token;

  const refreshed = await yt.refreshAccessToken(P.decryptSecret(account.refreshToken));
  const nextExpiry = new Date(Date.now() + (Number(refreshed.expires_in) || 3500) * 1000).toISOString();
  await sql`
    UPDATE codexa_yt_accounts
       SET access_token = ${P.encryptSecret(refreshed.access_token)}, token_expires_at = ${nextExpiry}, last_sync = NOW()
     WHERE id = ${ACCOUNT_ID}
  `;
  return refreshed.access_token;
}

module.exports = async function handler(request, response) {
  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const resource = url.searchParams.get("resource") || (url.pathname.includes("/youtube/callback") ? "callback" : "overview");
  const method = request.method || "GET";

  /* ── Callback OAuth: dibuka di browser, bukan fetch ── */
  if (resource === "callback") {
    if (!isAdmin(request)) return html(response, 401, "Sesi admin tidak valid", "Masuk ke admin panel dulu lalu ulangi proses hubungkan akun.");
    const error = url.searchParams.get("error");
    if (error) return html(response, 400, "Gagal menghubungkan", `Google menolak izin: ${error}`);
    if (!verifyState(url.searchParams.get("state"))) {
      return html(response, 400, "Permintaan tidak sah", "State OAuth tidak cocok atau sudah kedaluwarsa. Ulangi dari admin panel.");
    }
    const code = url.searchParams.get("code");
    if (!code) return html(response, 400, "Kode tidak ditemukan", "Google tidak mengirim kode otorisasi.");
    try {
      const sql = db();
      await P.ensureYtTables(sql);
      const token = await yt.exchangeCode(code);
      const channel = await yt.myChannel(token.access_token);
      const expiresAt = new Date(Date.now() + (Number(token.expires_in) || 3500) * 1000).toISOString();
      const existing = await readAccount(sql);
      const refreshToken = token.refresh_token
        ? P.encryptSecret(token.refresh_token)
        : (existing && existing.refreshToken) || "";
      await sql`
        INSERT INTO codexa_yt_accounts (id, channel_id, channel_title, access_token, refresh_token, token_expires_at, last_sync)
        VALUES (${ACCOUNT_ID}, ${channel.channelId}, ${channel.channelTitle},
                ${P.encryptSecret(token.access_token)}, ${refreshToken}, ${expiresAt}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          channel_id = EXCLUDED.channel_id, channel_title = EXCLUDED.channel_title,
          access_token = EXCLUDED.access_token,
          refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), codexa_yt_accounts.refresh_token),
          token_expires_at = EXCLUDED.token_expires_at, last_sync = NOW()
      `;
      await P.logActivity(sql, { status: "account_connected", account: channel.channelTitle, detail: "OAuth YouTube berhasil" });
      return html(response, 200, "Akun YouTube terhubung", `Channel: ${channel.channelTitle || channel.channelId || "-"}`);
    } catch (err) {
      console.error("YouTube OAuth callback:", err && err.message);
      return html(response, 500, "Gagal menghubungkan", (err && err.message) || "Terjadi kesalahan tak terduga.");
    }
  }

  if (!isAdmin(request)) return response.status(401).json({ error: "Sesi admin tidak valid" });

  let sql;
  try {
    sql = db();
    await P.ensureYtTables(sql);
  } catch (error) {
    return response.status(500).json({ error: `Database belum siap: ${error && error.message}` });
  }

  const body = () => {
    try { return bodyOf(request) || {}; } catch (_) { return {}; }
  };
  const fail = (error) => {
    const status = error && error.status && error.status >= 400 ? error.status : 500;
    console.error("YouTube promo:", error && error.message);
    return response.status(status).json({ error: (error && error.message) || "Terjadi kesalahan" });
  };

  try {
    /* ══ OVERVIEW ══ */
    if (resource === "overview" && method === "GET") {
      const [stats, settings, account] = await Promise.all([
        P.promotionStats(sql),
        P.readSettings(sql),
        readAccount(sql),
      ]);
      return response.status(200).json({
        stats,
        settings,
        account: publicAccount(account),
        categories: P.CATEGORIES.map(({ key, label }) => ({ key, label })),
        config: { apiKey: Boolean(yt.apiKey()), oauth: yt.oauthConfigured() },
      });
    }

    /* ══ PENCARIAN VIDEO ══ */
    if (resource === "search" && method === "POST") {
      const input = body();
      const keyword = P.trim(input.keyword, 120);
      if (!keyword) return response.status(400).json({ error: "Kata kunci pencarian wajib diisi" });

      const settings = await P.readSettings(sql);
      const category = P.CATEGORIES.some((c) => c.key === input.category) ? input.category : P.detectCategory(keyword);
      const order = ["relevance", "date", "viewCount"].includes(input.order) ? input.order : "relevance";
      const minViews = Math.max(0, Number(input.minViews) || 0);
      const publishedAfter = input.publishedAfter ? new Date(input.publishedAfter).toISOString() : "";

      const raw = await yt.searchVideos({ keyword, order, publishedAfter, maxResults: P.clampInt(input.maxResults, 5, 25, 12) });
      const blacklist = await P.readBlacklist(sql);
      const isBlocked = P.blacklistFilter(blacklist);
      const processed = await P.processedVideoIds(sql, raw.map((v) => v.videoId));

      const videos = raw
        .filter((v) => Number(v.views) >= minViews)
        .map((v) => ({
          ...v,
          keyword,
          category,
          relevance: P.relevanceScore({ ...v, keyword, category }),
          blocked: isBlocked(v),
          processed: processed.has(v.videoId),
        }))
        .filter((v) => !v.blocked)
        .sort((a, b) => b.relevance - a.relevance);

      for (const v of videos) {
        await sql`
          INSERT INTO codexa_yt_videos (video_id, channel_id, channel_title, title, description, thumbnail, published_at, views, keyword, category, relevance, status, updated_at)
          VALUES (${v.videoId}, ${v.channelId}, ${v.channelTitle}, ${P.trim(v.title, 300)}, ${P.trim(v.description, 1500)},
                  ${v.thumbnail}, ${v.publishedAt}, ${Math.round(Number(v.views) || 0)}, ${keyword}, ${category}, ${v.relevance}, 'found', NOW())
          ON CONFLICT (video_id) DO UPDATE SET
            views = EXCLUDED.views, relevance = EXCLUDED.relevance, keyword = EXCLUDED.keyword,
            category = EXCLUDED.category, updated_at = NOW()
        `;
      }
      await sql`
        INSERT INTO codexa_yt_keywords (keyword, category, uses, last_used)
        VALUES (${keyword}, ${category}, 1, NOW())
        ON CONFLICT (keyword, category) DO UPDATE SET uses = codexa_yt_keywords.uses + 1, last_used = NOW()
      `;
      await P.logActivity(sql, { keyword, status: "search", detail: `${videos.length} video ditemukan` });

      return response.status(200).json({
        videos,
        keyword,
        category,
        minRelevance: settings.minRelevance,
        blockedCount: raw.length - videos.length,
      });
    }

    /* ══ BUAT DRAFT ══ */
    if (resource === "draft" && method === "POST") {
      const input = body();
      const videoId = P.trim(input.videoId, 40);
      if (!videoId) return response.status(400).json({ error: "Video tidak dikenali" });

      const settings = await P.readSettings(sql);
      const blocked = await P.guardLimits(sql, settings);
      if (blocked) return response.status(429).json({ error: blocked });

      const [video] = await sql`
        SELECT video_id AS "videoId", title, description, channel_id AS "channelId", channel_title AS "channelTitle",
               keyword, category, relevance
          FROM codexa_yt_videos WHERE video_id = ${videoId} LIMIT 1
      `;
      if (!video) return response.status(404).json({ error: "Video belum tersimpan. Jalankan pencarian lagi." });
      if (video.relevance < settings.minRelevance) {
        return response.status(400).json({ error: `Relevansi ${video.relevance}% di bawah minimum ${settings.minRelevance}%.` });
      }
      if (settings.duplicateProtection) {
        const [dup] = await sql`
          SELECT 1 AS ok FROM codexa_yt_drafts WHERE video_id = ${videoId} AND status <> 'rejected' LIMIT 1
        `;
        if (dup) return response.status(409).json({ error: "Video ini sudah pernah diproses (proteksi duplikat aktif)." });
      }

      const result = await P.generateDraft(sql, {
        video,
        keyword: video.keyword,
        category: video.category,
        profile: settings.profile,
      });
      const id = P.newId("ytd");
      await sql`
        INSERT INTO codexa_yt_drafts (id, video_id, keyword, category, comment, status, source)
        VALUES (${id}, ${videoId}, ${video.keyword}, ${video.category}, ${result.comment},
                ${settings.requireApproval ? "pending" : "approved"}, ${result.source})
      `;
      await sql`UPDATE codexa_yt_videos SET status = 'drafted', updated_at = NOW() WHERE video_id = ${videoId}`;
      await P.logActivity(sql, {
        videoId, videoTitle: video.title, channelTitle: video.channelTitle, keyword: video.keyword,
        relevance: video.relevance, draft: result.comment, status: "draft_created", admin: "admin",
        detail: result.warning || `Sumber: ${result.source}`,
      });
      return response.status(201).json({ id, comment: result.comment, warning: result.warning, source: result.source });
    }

    /* ══ DAFTAR DRAFT ══ */
    if (resource === "drafts" && method === "GET") {
      const status = url.searchParams.get("status") || "pending";
      const rows = status === "all"
        ? await sql`
            SELECT d.id, d.video_id AS "videoId", d.comment, d.status, d.source, d.error, d.keyword, d.category,
                   d.created_at AS "createdAt", v.title, v.channel_title AS "channelTitle", v.thumbnail, v.relevance, v.views
              FROM codexa_yt_drafts d LEFT JOIN codexa_yt_videos v ON v.video_id = d.video_id
             ORDER BY d.created_at DESC LIMIT 100`
        : await sql`
            SELECT d.id, d.video_id AS "videoId", d.comment, d.status, d.source, d.error, d.keyword, d.category,
                   d.created_at AS "createdAt", v.title, v.channel_title AS "channelTitle", v.thumbnail, v.relevance, v.views
              FROM codexa_yt_drafts d LEFT JOIN codexa_yt_videos v ON v.video_id = d.video_id
             WHERE d.status = ${status}
             ORDER BY d.created_at DESC LIMIT 100`;
      return response.status(200).json({ drafts: rows });
    }

    /* ══ EDIT / APPROVE / REJECT DRAFT ══ */
    if (resource === "draft" && (method === "PATCH" || method === "PUT")) {
      const input = body();
      const id = P.trim(input.id, 60);
      const action = P.trim(input.action, 20) || "edit";
      if (!id) return response.status(400).json({ error: "Draft tidak dikenali" });

      const [draft] = await sql`
        SELECT d.id, d.video_id AS "videoId", d.comment, d.status, v.title, v.channel_title AS "channelTitle", v.relevance, v.keyword
          FROM codexa_yt_drafts d LEFT JOIN codexa_yt_videos v ON v.video_id = d.video_id
         WHERE d.id = ${id} LIMIT 1
      `;
      if (!draft) return response.status(404).json({ error: "Draft tidak ditemukan" });
      if (draft.status === "sent") return response.status(409).json({ error: "Draft ini sudah dikirim ke YouTube." });

      if (action === "edit") {
        const comment = P.trim(input.comment, 400);
        if (!comment) return response.status(400).json({ error: "Isi komentar tidak boleh kosong" });
        await sql`UPDATE codexa_yt_drafts SET comment = ${comment}, source = 'manual', updated_at = NOW() WHERE id = ${id}`;
        await P.logActivity(sql, { videoId: draft.videoId, videoTitle: draft.title, draft: comment, status: "draft_edited", admin: "admin" });
        return response.status(200).json({ ok: true, comment });
      }
      if (action === "approve" || action === "reject") {
        const next = action === "approve" ? "approved" : "rejected";
        await sql`UPDATE codexa_yt_drafts SET status = ${next}, admin = 'admin', updated_at = NOW() WHERE id = ${id}`;
        await P.logActivity(sql, {
          videoId: draft.videoId, videoTitle: draft.title, channelTitle: draft.channelTitle, keyword: draft.keyword,
          relevance: draft.relevance, draft: draft.comment, status: next, admin: "admin",
        });
        return response.status(200).json({ ok: true, status: next });
      }
      return response.status(400).json({ error: "Aksi tidak dikenal" });
    }

    /* ══ KIRIM KOMENTAR ══ */
    if (resource === "send" && method === "POST") {
      const input = body();
      const id = P.trim(input.id, 60);
      if (!input.confirm) return response.status(400).json({ error: "Konfirmasi pengiriman diperlukan" });

      const settings = await P.readSettings(sql);
      if (!settings.enabled) return response.status(423).json({ error: "Promosi sedang dihentikan (STOP aktif)." });

      const [draft] = await sql`
        SELECT d.id, d.video_id AS "videoId", d.comment, d.status, d.keyword,
               v.title, v.channel_title AS "channelTitle", v.relevance
          FROM codexa_yt_drafts d LEFT JOIN codexa_yt_videos v ON v.video_id = d.video_id
         WHERE d.id = ${id} LIMIT 1
      `;
      if (!draft) return response.status(404).json({ error: "Draft tidak ditemukan" });
      if (draft.status === "sent") return response.status(409).json({ error: "Draft ini sudah dikirim." });
      if (settings.requireApproval && draft.status !== "approved") {
        return response.status(400).json({ error: "Draft harus di-approve dulu sebelum dikirim." });
      }
      const [already] = await sql`
        SELECT 1 AS ok FROM codexa_yt_promotions WHERE video_id = ${draft.videoId} AND status = 'sent' LIMIT 1
      `;
      if (already && settings.duplicateProtection) {
        return response.status(409).json({ error: "Video ini sudah pernah dikomentari." });
      }

      const account = await readAccount(sql);
      const promoId = P.newId("ytp");
      try {
        const token = await activeAccessToken(sql, account);
        const sent = await yt.postComment({ accessToken: token, videoId: draft.videoId, text: draft.comment });
        await sql`
          INSERT INTO codexa_yt_promotions (id, draft_id, video_id, account_id, channel_title, comment, comment_id, status, admin)
          VALUES (${promoId}, ${draft.id}, ${draft.videoId}, ${ACCOUNT_ID}, ${(account && account.channelTitle) || ""},
                  ${draft.comment}, ${sent.commentId}, 'sent', 'admin')
        `;
        await sql`UPDATE codexa_yt_drafts SET status = 'sent', updated_at = NOW() WHERE id = ${draft.id}`;
        await sql`UPDATE codexa_yt_videos SET status = 'promoted', updated_at = NOW() WHERE video_id = ${draft.videoId}`;
        await P.logActivity(sql, {
          videoId: draft.videoId, videoTitle: draft.title, channelTitle: draft.channelTitle, keyword: draft.keyword,
          relevance: draft.relevance, draft: draft.comment, status: "sent", admin: "admin",
          account: (account && account.channelTitle) || "", commentId: sent.commentId,
        });
        return response.status(200).json({ ok: true, commentId: sent.commentId });
      } catch (error) {
        const message = (error && error.message) || "Gagal mengirim komentar";
        await sql`
          INSERT INTO codexa_yt_promotions (id, draft_id, video_id, account_id, channel_title, comment, status, error, admin)
          VALUES (${promoId}, ${draft.id}, ${draft.videoId}, ${ACCOUNT_ID}, ${(account && account.channelTitle) || ""},
                  ${draft.comment}, 'failed', ${message.slice(0, 500)}, 'admin')
        `;
        await sql`UPDATE codexa_yt_drafts SET status = 'failed', error = ${message.slice(0, 500)}, updated_at = NOW() WHERE id = ${draft.id}`;
        await P.logActivity(sql, {
          videoId: draft.videoId, videoTitle: draft.title, channelTitle: draft.channelTitle,
          draft: draft.comment, status: "failed", admin: "admin", detail: message,
        });
        return response.status(200).json({ ok: false, error: message });
      }
    }

    /* ══ PENGATURAN ══ */
    if (resource === "settings" && method === "GET") {
      return response.status(200).json({ settings: await P.readSettings(sql) });
    }
    if (resource === "settings" && (method === "PATCH" || method === "POST")) {
      const settings = await P.writeSettings(sql, body());
      await P.logActivity(sql, { status: "settings_updated", admin: "admin" });
      return response.status(200).json({ settings });
    }

    /* ══ STOP / LANJUTKAN ══ */
    if (resource === "stop" && method === "POST") {
      const input = body();
      const enabled = input.enabled === true;
      const settings = await P.writeSettings(sql, { enabled, stoppedAt: enabled ? null : new Date().toISOString() });
      await P.logActivity(sql, { status: enabled ? "promotion_resumed" : "promotion_stopped", admin: "admin" });
      return response.status(200).json({ settings });
    }

    /* ══ BLACKLIST ══ */
    if (resource === "blacklist" && method === "GET") {
      return response.status(200).json({ blacklist: await P.readBlacklist(sql) });
    }
    if (resource === "blacklist" && method === "POST") {
      const input = body();
      const type = input.type === "keyword" ? "keyword" : "channel";
      const value = P.trim(input.value, 200);
      if (!value) return response.status(400).json({ error: "Nilai blacklist wajib diisi" });
      await sql`
        INSERT INTO codexa_yt_blacklist (type, value, note)
        VALUES (${type}, ${type === "channel" ? P.channelKeyOf(value) : value.toLowerCase()}, ${P.trim(input.note, 200) || null})
        ON CONFLICT (type, value) DO NOTHING
      `;
      return response.status(201).json({ blacklist: await P.readBlacklist(sql) });
    }
    if (resource === "blacklist" && method === "DELETE") {
      const id = Number(url.searchParams.get("id") || body().id || 0);
      if (!id) return response.status(400).json({ error: "ID blacklist tidak valid" });
      await sql`DELETE FROM codexa_yt_blacklist WHERE id = ${id}`;
      return response.status(200).json({ blacklist: await P.readBlacklist(sql) });
    }

    /* ══ RIWAYAT ══ */
    if (resource === "history" && method === "GET") {
      const logs = await sql`
        SELECT id, video_id AS "videoId", video_title AS "videoTitle", channel_title AS "channelTitle",
               keyword, relevance, draft, status, account, comment_id AS "commentId", admin, detail,
               created_at AS "createdAt"
          FROM codexa_yt_logs ORDER BY created_at DESC LIMIT 200
      `;
      const promotions = await sql`
        SELECT id, video_id AS "videoId", comment, comment_id AS "commentId", status, error, channel_title AS "channelTitle",
               admin, created_at AS "createdAt"
          FROM codexa_yt_promotions ORDER BY created_at DESC LIMIT 100
      `;
      return response.status(200).json({ logs, promotions });
    }

    /* ══ AKUN YOUTUBE ══ */
    if (resource === "connect" && method === "POST") {
      if (!yt.oauthConfigured()) {
        return response.status(400).json({
          error: "OAuth YouTube belum dikonfigurasi. Isi YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, dan YOUTUBE_OAUTH_REDIRECT_URI.",
        });
      }
      return response.status(200).json({ url: yt.authUrl(signState()) });
    }
    if (resource === "account" && method === "GET") {
      return response.status(200).json({ account: publicAccount(await readAccount(sql)), config: { apiKey: Boolean(yt.apiKey()), oauth: yt.oauthConfigured() } });
    }
    if (resource === "account" && method === "DELETE") {
      await sql`DELETE FROM codexa_yt_accounts WHERE id = ${ACCOUNT_ID}`;
      await P.logActivity(sql, { status: "account_disconnected", admin: "admin" });
      return response.status(200).json({ account: publicAccount(null) });
    }

    return response.status(404).json({ error: "Resource tidak dikenal" });
  } catch (error) {
    return fail(error);
  }
};
