/**
 * Visitor Traffic — pencatatan kunjungan website + ringkasan untuk admin panel.
 *
 * Tabel: codexa_visits (satu baris per page view).
 * IP tidak disimpan mentah, hanya hash (privasi).
 */

const crypto = require("crypto");
const { once } = require("./_schema");

const ensureVisitTables = once(async function ensureVisitTablesUncached(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_visits (
      id TEXT PRIMARY KEY,
      visitor_id TEXT NOT NULL DEFAULT '',
      session_id TEXT NOT NULL DEFAULT '',
      path TEXT NOT NULL DEFAULT '/',
      referrer TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'direct',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT 'desktop',
      browser TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      screen TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      ip_hash TEXT NOT NULL DEFAULT '',
      user_email TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS codexa_visits_created_idx ON codexa_visits (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS codexa_visits_visitor_idx ON codexa_visits (visitor_id)`;
});

const clean = (value, max = 240) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);

function clientIp(request) {
  const header = request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "";
  return String(header).split(",")[0].trim();
}

function hashIp(ip) {
  if (!ip) return "";
  const salt = process.env.ADMIN_PASSWORD || "akuninstan";
  return crypto.createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

/* Parsing user-agent sederhana: cukup untuk statistik, tanpa dependensi luar. */
function parseAgent(ua) {
  const s = String(ua || "");
  const lower = s.toLowerCase();
  let device = "desktop";
  if (/ipad|tablet|playbook|silk/.test(lower)) device = "tablet";
  else if (/mobi|android|iphone|ipod|windows phone/.test(lower)) device = "mobile";
  if (/bot|crawler|spider|crawling|headlesschrome|lighthouse/.test(lower)) device = "bot";

  let browser = "Lainnya";
  if (/edg\//.test(lower)) browser = "Edge";
  else if (/opr\/|opera/.test(lower)) browser = "Opera";
  else if (/samsungbrowser/.test(lower)) browser = "Samsung Internet";
  else if (/firefox|fxios/.test(lower)) browser = "Firefox";
  else if (/chrome|crios/.test(lower)) browser = "Chrome";
  else if (/safari/.test(lower)) browser = "Safari";

  let os = "Lainnya";
  if (/windows/.test(lower)) os = "Windows";
  else if (/android/.test(lower)) os = "Android";
  else if (/iphone|ipad|ipod|ios/.test(lower)) os = "iOS";
  else if (/mac os x|macintosh/.test(lower)) os = "macOS";
  else if (/linux/.test(lower)) os = "Linux";

  return { device, browser, os };
}

/* Asal trafik dikelompokkan supaya mudah dibaca admin. */
function sourceOf(referrer) {
  const ref = String(referrer || "").toLowerCase();
  if (!ref) return "direct";
  if (/google\./.test(ref)) return "Google";
  if (/bing\.|duckduckgo|yahoo\./.test(ref)) return "Mesin pencari";
  if (/facebook|fb\.com|instagram|threads/.test(ref)) return "Meta";
  if (/tiktok/.test(ref)) return "TikTok";
  if (/youtube|youtu\.be/.test(ref)) return "YouTube";
  if (/t\.me|telegram/.test(ref)) return "Telegram";
  if (/wa\.me|whatsapp/.test(ref)) return "WhatsApp";
  if (/x\.com|twitter/.test(ref)) return "X / Twitter";
  if (/akuninstan/.test(ref)) return "Internal";
  try { return new URL(ref).hostname.replace(/^www\./, "") || "Lainnya"; } catch { return "Lainnya"; }
}

async function recordVisit(sql, request, body) {
  await ensureVisitTables(sql);
  const ua = clean(request.headers["user-agent"] || "", 400);
  const agent = parseAgent(ua);
  if (agent.device === "bot") return { ok: true, skipped: "bot" };

  const referrer = clean(body.referrer || request.headers.referer || "", 300);
  const row = {
    id: crypto.randomUUID(),
    visitorId: clean(body.visitorId, 64),
    sessionId: clean(body.sessionId, 64),
    path: clean(body.path || "/", 300) || "/",
    referrer,
    source: sourceOf(referrer),
    country: clean(request.headers["x-vercel-ip-country"] || "", 8),
    city: decodeURIComponent(clean(request.headers["x-vercel-ip-city"] || "", 80)),
    region: clean(request.headers["x-vercel-ip-country-region"] || "", 16),
    language: clean(body.language || String(request.headers["accept-language"] || "").split(",")[0], 16),
    screen: clean(body.screen, 20),
    email: clean(body.email, 160).toLowerCase(),
  };

  await sql`
    INSERT INTO codexa_visits (
      id, visitor_id, session_id, path, referrer, source, country, city, region,
      device, browser, os, language, screen, user_agent, ip_hash, user_email
    ) VALUES (
      ${row.id}, ${row.visitorId}, ${row.sessionId}, ${row.path}, ${row.referrer}, ${row.source},
      ${row.country}, ${row.city}, ${row.region}, ${agent.device}, ${agent.browser}, ${agent.os},
      ${row.language}, ${row.screen}, ${ua}, ${hashIp(clientIp(request))}, ${row.email}
    )
  `;
  return { ok: true };
}

async function visitStats(sql, options = {}) {
  await ensureVisitTables(sql);
  const days = Math.min(90, Math.max(1, Math.round(Number(options.days) || 7)));
  const since = `${days} days`;

  const [totals] = await sql`
    SELECT
      COUNT(*)::int AS "viewsRange",
      COUNT(DISTINCT visitor_id)::int AS "visitorsRange",
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS "views24h",
      COUNT(DISTINCT visitor_id) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS "visitors24h",
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 minutes')::int AS "live"
    FROM codexa_visits
    WHERE created_at >= NOW() - ${since}::interval
  `;
  const [allTime] = await sql`SELECT COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS visitors FROM codexa_visits`;

  const series = await sql`
    SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
           COUNT(*)::int AS views,
           COUNT(DISTINCT visitor_id)::int AS visitors
    FROM codexa_visits
    WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY 1
  `;
  const pages = await sql`
    SELECT path AS label, COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS visitors
    FROM codexa_visits WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY views DESC LIMIT 12
  `;
  const sources = await sql`
    SELECT source AS label, COUNT(*)::int AS views
    FROM codexa_visits WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY views DESC LIMIT 10
  `;
  const devices = await sql`
    SELECT device AS label, COUNT(*)::int AS views
    FROM codexa_visits WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY views DESC
  `;
  const browsers = await sql`
    SELECT browser AS label, COUNT(*)::int AS views
    FROM codexa_visits WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY views DESC LIMIT 8
  `;
  const countries = await sql`
    SELECT COALESCE(NULLIF(country, ''), '—') AS label, COUNT(*)::int AS views
    FROM codexa_visits WHERE created_at >= NOW() - ${since}::interval
    GROUP BY 1 ORDER BY views DESC LIMIT 10
  `;
  const recent = await sql`
    SELECT id, visitor_id AS "visitorId", path, source, referrer, country, city, device,
           browser, os, screen, language, user_email AS "email", created_at AS "createdAt"
    FROM codexa_visits ORDER BY created_at DESC LIMIT 60
  `;

  return {
    days,
    totals: {
      viewsRange: (totals && totals.viewsRange) || 0,
      visitorsRange: (totals && totals.visitorsRange) || 0,
      views24h: (totals && totals.views24h) || 0,
      visitors24h: (totals && totals.visitors24h) || 0,
      live: (totals && totals.live) || 0,
      viewsAll: (allTime && allTime.views) || 0,
      visitorsAll: (allTime && allTime.visitors) || 0,
    },
    series, pages, sources, devices, browsers, countries, recent,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { ensureVisitTables, recordVisit, visitStats };
