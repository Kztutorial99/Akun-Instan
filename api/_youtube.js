/**
 * Lapisan integrasi YouTube Data API v3 + OAuth 2.0.
 *
 * Env yang dipakai:
 *  - YOUTUBE_API_KEY               kunci API untuk pencarian video (read-only)
 *  - YOUTUBE_OAUTH_CLIENT_ID       OAuth client (Web application)
 *  - YOUTUBE_OAUTH_CLIENT_SECRET   OAuth client secret
 *  - YOUTUBE_OAUTH_REDIRECT_URI    alamat balik, cth https://akuninstan.com/api/youtube/callback
 *
 * Tidak pernah scraping halaman YouTube — semua lewat API resmi.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

const apiKey = () => process.env.YOUTUBE_API_KEY || "";
const clientId = () => process.env.YOUTUBE_OAUTH_CLIENT_ID || "";
const clientSecret = () => process.env.YOUTUBE_OAUTH_CLIENT_SECRET || "";
const redirectUri = () => process.env.YOUTUBE_OAUTH_REDIRECT_URI || "";

function oauthConfigured() {
  return Boolean(clientId() && clientSecret() && redirectUri());
}

/** Ubah error Google jadi pesan yang bisa dibaca admin. */
function friendlyError(status, payload) {
  const reason =
    (payload && payload.error && payload.error.errors && payload.error.errors[0] && payload.error.errors[0].reason) || "";
  const message = (payload && payload.error && (payload.error.message || payload.error_description)) || "";
  const map = {
    quotaExceeded: "Kuota YouTube API hari ini habis. Coba lagi besok atau naikkan kuota di Google Cloud.",
    dailyLimitExceeded: "Batas harian YouTube API tercapai.",
    rateLimitExceeded: "Terlalu banyak permintaan ke YouTube. Tunggu beberapa menit.",
    commentsDisabled: "Komentar pada video ini dinonaktifkan.",
    forbidden: "Akses ditolak YouTube. Cek izin akun/OAuth.",
    videoNotFound: "Video tidak ditemukan atau sudah dihapus.",
    processingFailure: "YouTube gagal memproses permintaan. Coba lagi sebentar.",
    authError: "Sesi YouTube kedaluwarsa. Hubungkan ulang akun YouTube.",
    keyInvalid: "YOUTUBE_API_KEY tidak valid.",
  };
  if (map[reason]) return map[reason];
  if (status === 401) return "Sesi YouTube kedaluwarsa. Hubungkan ulang akun YouTube.";
  if (status === 403) return message || "Akses ditolak YouTube (kuota atau izin).";
  if (status === 404) return "Video atau channel tidak ditemukan.";
  if (status === 429) return "Rate limit YouTube. Tunggu sebentar lalu coba lagi.";
  return message || `YouTube API error (HTTP ${status})`;
}

async function ytFetch(path, { params = {}, method = "GET", body = null, accessToken = "" } = {}) {
  const url = new URL(`${API_BASE}/${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });
  const headers = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  else url.searchParams.set("key", apiKey());
  if (body) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(url.toString(), { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (error) {
    const err = new Error(`Gagal menghubungi YouTube: ${error && error.message}`);
    err.status = 0;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(friendlyError(res.status, data));
    err.status = res.status;
    throw err;
  }
  return data || {};
}

/** Pencarian video + detail statistik dalam satu panggilan gabungan. */
async function searchVideos({ keyword, order = "relevance", publishedAfter = "", maxResults = 12 }) {
  if (!apiKey()) {
    const err = new Error("YOUTUBE_API_KEY belum diatur di environment variable.");
    err.status = 400;
    throw err;
  }
  const search = await ytFetch("search", {
    params: {
      part: "snippet",
      q: keyword,
      type: "video",
      order,
      maxResults: Math.min(25, Math.max(1, Number(maxResults) || 12)),
      relevanceLanguage: "id",
      regionCode: "ID",
      publishedAfter: publishedAfter || undefined,
      safeSearch: "moderate",
    },
  });

  const ids = (search.items || []).map((item) => item.id && item.id.videoId).filter(Boolean);
  if (!ids.length) return [];

  const details = await ytFetch("videos", {
    params: { part: "snippet,statistics,status", id: ids.join(",") },
  });

  return (details.items || []).map((item) => ({
    videoId: item.id,
    title: (item.snippet && item.snippet.title) || "",
    description: (item.snippet && item.snippet.description) || "",
    channelId: (item.snippet && item.snippet.channelId) || "",
    channelTitle: (item.snippet && item.snippet.channelTitle) || "",
    publishedAt: (item.snippet && item.snippet.publishedAt) || null,
    thumbnail:
      (item.snippet && item.snippet.thumbnails &&
        ((item.snippet.thumbnails.medium && item.snippet.thumbnails.medium.url) ||
          (item.snippet.thumbnails.default && item.snippet.thumbnails.default.url))) || "",
    views: Number((item.statistics && item.statistics.viewCount) || 0),
    comments: Number((item.statistics && item.statistics.commentCount) || 0),
    commentsDisabled: !(item.statistics && item.statistics.commentCount !== undefined),
  }));
}

/* ═══════════════════ OAUTH ═══════════════════ */

function authUrl(state) {
  const url = new URL(OAUTH_AUTH);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params) {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) {
    const err = new Error((data && (data.error_description || data.error)) || `OAuth gagal (HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function exchangeCode(code) {
  return tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

async function refreshAccessToken(refreshToken) {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
    grant_type: "refresh_token",
  });
}

async function myChannel(accessToken) {
  const data = await ytFetch("channels", { params: { part: "snippet", mine: "true" }, accessToken });
  const item = (data.items || [])[0];
  return item
    ? { channelId: item.id, channelTitle: (item.snippet && item.snippet.title) || "" }
    : { channelId: "", channelTitle: "" };
}

/** Kirim komentar top-level ke sebuah video. */
async function postComment({ accessToken, videoId, text }) {
  const data = await ytFetch("commentThreads", {
    method: "POST",
    params: { part: "snippet" },
    accessToken,
    body: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } },
  });
  return {
    commentId: (data.snippet && data.snippet.topLevelComment && data.snippet.topLevelComment.id) || data.id || "",
  };
}

module.exports = {
  apiKey,
  oauthConfigured,
  searchVideos,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  myChannel,
  postComment,
  friendlyError,
  SCOPE,
};
