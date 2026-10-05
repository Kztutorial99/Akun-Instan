/* Check-in harian & poin.
   Keamanan:
   - Siklus 24 jam bergulir dari waktu klaim terakhir (jam server), jam perangkat tidak dipakai.
   - UNIQUE (user_id, day) + cek last_at → tidak bisa klaim ganda walau request bersamaan.
   - Poin diubah atomik (UPDATE ... WHERE points >= x) dan dicatat di ledger.
   - Batas klaim per IP per hari untuk menahan farming multi-akun.
   - Rate limit per user, akun diblokir admin tidak bisa klaim/menukar. */
const crypto = require("crypto");
const { once } = require("./_schema");
const { bodyOf, text, clientIp, rateLimit } = require("./_users");

const DEFAULTS = {
  enabled: true,
  rewards: [100, 150, 200, 250, 300, 400, 1000],
  pointValue: 1, // Rp per poin saat menukar ke produk
  ipDailyLimit: 1,
  securityVersion: 2,
  redeemEnabled: true,
};

const ensureCheckinTables = once(async (sql) => {
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_points (
      user_id TEXT PRIMARY KEY REFERENCES codexa_users(id) ON DELETE CASCADE,
      points BIGINT NOT NULL DEFAULT 0 CHECK (points >= 0),
      streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      last_day DATE,
      total_checkins INTEGER NOT NULL DEFAULT 0,
      total_earned BIGINT NOT NULL DEFAULT 0,
      total_spent BIGINT NOT NULL DEFAULT 0,
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_checkins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      reward INTEGER NOT NULL,
      streak INTEGER NOT NULL,
      ip_hash TEXT NOT NULL DEFAULT '',
      ua TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, day)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS codexa_point_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES codexa_users(id) ON DELETE CASCADE,
      delta BIGINT NOT NULL,
      reason TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE TABLE IF NOT EXISTS codexa_checkin_settings (id INTEGER PRIMARY KEY DEFAULT 1, data JSONB NOT NULL DEFAULT '{}'::jsonb)`;
  await Promise.all([
    sql`CREATE INDEX IF NOT EXISTS codexa_checkins_day_idx ON codexa_checkins (day, ip_hash)`,
    sql`CREATE INDEX IF NOT EXISTS codexa_point_ledger_user_idx ON codexa_point_ledger (user_id, created_at DESC)`,
  ]);
  // Siklus 24 jam bergulir: simpan waktu klaim terakhir (jam server).
  await sql`ALTER TABLE codexa_points ADD COLUMN IF NOT EXISTS last_at TIMESTAMPTZ`;
  await sql`UPDATE codexa_points p SET last_at = c.m FROM (SELECT user_id, MAX(created_at) m FROM codexa_checkins GROUP BY user_id) c
    WHERE p.user_id = c.user_id AND p.last_at IS NULL`;
  // Siklus 24 jam (bukan hari kalender): satu user boleh punya >1 baris per tanggal.
  await sql`ALTER TABLE codexa_checkins DROP CONSTRAINT IF EXISTS codexa_checkins_user_id_day_key`;
  await sql`CREATE INDEX IF NOT EXISTS codexa_checkins_user_idx ON codexa_checkins (user_id, created_at DESC)`;
});

function sanitizeSettings(raw) {
  const isLegacySecurity = !raw || Number(raw.securityVersion || 0) < 2;
  const s = { ...DEFAULTS, ...(raw || {}) };
  let rewards = Array.isArray(s.rewards) ? s.rewards : DEFAULTS.rewards;
  // Hadiah lama (terlalu kecil) otomatis naik ke hadiah baru.
  if (rewards.join(",") === "10,15,20,25,30,40,100") rewards = DEFAULTS.rewards;
  return {
    enabled: s.enabled !== false,
    redeemEnabled: s.redeemEnabled !== false,
    rewards: Array.from({ length: 7 }, (_, i) => Math.max(0, Math.min(100000, Math.floor(Number(rewards[i]) || 0)))),
    pointValue: Math.max(0.01, Math.min(1000, Number(s.pointValue) || 1)),
    // Konfigurasi lama memakai batas 3. Versi keamanan baru otomatis memakai 1 akun per jaringan per 24 jam.
    ipDailyLimit: isLegacySecurity ? 1 : Math.max(1, Math.min(50, Math.floor(Number(s.ipDailyLimit) || 1))),
    securityVersion: 2,
  };
}

async function readSettings(sql) {
  await ensureCheckinTables(sql);
  const rows = await sql`SELECT data FROM codexa_checkin_settings WHERE id = 1`;
  return sanitizeSettings(rows[0] && rows[0].data);
}

const ipHash = (ip) => crypto.createHash("sha256").update(`codexa-ci:${ip}`).digest("hex").slice(0, 32);

async function todayInfo(sql) {
  const [r] = await sql`SELECT (NOW() AT TIME ZONE 'Asia/Jakarta')::date::text AS today,
    ((NOW() AT TIME ZONE 'Asia/Jakarta')::date - 1)::text AS yesterday,
    EXTRACT(EPOCH FROM (date_trunc('day', NOW() AT TIME ZONE 'Asia/Jakarta') + INTERVAL '1 day' - (NOW() AT TIME ZONE 'Asia/Jakarta')))::int AS "secondsLeft"`;
  return r;
}

async function wallet(sql, userId) {
  const rows = await sql`
    SELECT points, streak, best_streak AS "bestStreak", last_day::text AS "lastDay",
           GREATEST(0, CEIL(EXTRACT(EPOCH FROM (last_at + INTERVAL '24 hours' - NOW()))))::int AS "waitSec",
           (last_at IS NOT NULL AND NOW() < last_at + INTERVAL '48 hours') AS alive,
           total_checkins AS "totalCheckins", total_earned AS "totalEarned", total_spent AS "totalSpent", blocked
    FROM codexa_points WHERE user_id = ${userId}`;
  const w = rows[0] || { points: 0, streak: 0, bestStreak: 0, lastDay: null, waitSec: 0, alive: false, totalCheckins: 0, totalEarned: 0, totalSpent: 0, blocked: false };
  return { ...w, points: Number(w.points) || 0, totalEarned: Number(w.totalEarned) || 0, totalSpent: Number(w.totalSpent) || 0 };
}

async function statusPayload(sql, userId) {
  const [settings, t, w] = await Promise.all([readSettings(sql), todayInfo(sql), wallet(sql, userId)]);
  const claimedToday = w.waitSec > 0;
  const alive = claimedToday || !!w.alive;
  const streak = alive ? w.streak : 0;
  // Posisi di siklus 7 hari: hari berikutnya yang akan diklaim.
  const cycleDone = streak === 0 ? 0 : ((streak - 1) % 7) + 1;
  const nextIndex = claimedToday ? cycleDone % 7 : (streak % 7);
  const history = await sql`
    SELECT day::text AS day, reward, streak FROM codexa_checkins
    WHERE user_id = ${userId} ORDER BY day DESC LIMIT 30`;
  const ledger = await sql`
    SELECT delta, reason, note, created_at AS "createdAt" FROM codexa_point_ledger
    WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 15`;
  return {
    settings: { enabled: settings.enabled, redeemEnabled: settings.redeemEnabled, rewards: settings.rewards, pointValue: settings.pointValue },
    today: t.today,
    secondsLeft: w.waitSec,
    claimedToday,
    streak,
    cycleDone: claimedToday ? cycleDone : (streak % 7),
    nextIndex,
    nextReward: settings.rewards[nextIndex],
    points: w.points,
    pointsValue: Math.floor(w.points * settings.pointValue),
    bestStreak: w.bestStreak,
    totalCheckins: w.totalCheckins,
    totalEarned: w.totalEarned,
    totalSpent: w.totalSpent,
    blocked: !!w.blocked,
    history: history.map((h) => ({ ...h, reward: Number(h.reward) })),
    ledger: ledger.map((l) => ({ ...l, delta: Number(l.delta) })),
  };
}

async function handleUserCheckin(sql, user, request, response) {
  await ensureCheckinTables(sql);
  if (request.method === "GET") return response.status(200).json(await statusPayload(sql, user.id));
  if (request.method !== "POST") return response.status(405).json({ error: "Metode tidak didukung" });

  const rl = await rateLimit(sql, { key: `checkin:${user.id}`, limit: 6, windowSec: 60 });
  if (!rl.allowed) return response.status(429).json({ error: "Terlalu sering, coba lagi sebentar", retryAfter: rl.retryAfter });

  const settings = await readSettings(sql);
  if (!settings.enabled) return response.status(403).json({ error: "Check-in sedang dinonaktifkan admin" });
  const w = await wallet(sql, user.id);
  if (w.blocked) return response.status(403).json({ error: "Check-in untuk akun ini dibatasi. Hubungi admin." });

  const t = await todayInfo(sql);
  if (w.waitSec > 0) return response.status(409).json({ error: "Check-in berikutnya tersedia 24 jam setelah klaim terakhir", code: "ALREADY", secondsLeft: w.waitSec });

  const ip = ipHash(clientIp(request));
  // Hitung akun LAIN dari jaringan yang sama dalam 24 jam terakhir (akun sendiri tidak dihitung).
  const [{ c }] = await sql`SELECT COUNT(DISTINCT user_id)::int AS c FROM codexa_checkins
    WHERE ip_hash = ${ip} AND user_id <> ${user.id} AND created_at > NOW() - INTERVAL '24 hours'`;
  if (c >= settings.ipDailyLimit) {
    return response.status(429).json({ error: "Jaringan ini sudah dipakai check-in akun lain dalam 24 jam. Coba pakai jaringan lain.", code: "IP_LIMIT" });
  }

  const streak = w.alive ? w.streak + 1 : 1;
  const reward = settings.rewards[(streak - 1) % 7];
  const ua = text(String(request.headers["user-agent"] || ""), 200);

  // Kunci atomik: hanya satu request yang lolos per siklus 24 jam (jam server).
  await sql`INSERT INTO codexa_points (user_id) VALUES (${user.id}) ON CONFLICT (user_id) DO NOTHING`;
  const [locked] = await sql`
    UPDATE codexa_points SET
      points = points + ${reward}, streak = ${streak},
      best_streak = GREATEST(best_streak, ${streak}), last_day = ${t.today}::date, last_at = NOW(),
      total_checkins = total_checkins + 1, total_earned = total_earned + ${reward}, updated_at = NOW()
    WHERE user_id = ${user.id} AND blocked = FALSE AND (last_at IS NULL OR last_at <= NOW() - INTERVAL '24 hours')
    RETURNING user_id`;
  if (!locked) return response.status(409).json({ error: "Kamu sudah check-in, tunggu 24 jam dari klaim terakhir", code: "ALREADY" });
  await sql`INSERT INTO codexa_checkins (id, user_id, day, reward, streak, ip_hash, ua)
    VALUES (${crypto.randomUUID()}, ${user.id}, ${t.today}::date, ${reward}, ${streak}, ${ip}, ${ua})`;
  await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
    VALUES (${crypto.randomUUID()}, ${user.id}, ${reward}, 'checkin', ${`Check-in hari ke-${streak}`})`;

  const payload = await statusPayload(sql, user.id);
  return response.status(200).json({ ...payload, earned: reward });
}

/* Dipakai checkout: potong poin atomik. Return jumlah poin yang dipotong atau null. */
async function spendPoints(sql, userId, rupiah, note) {
  const settings = await readSettings(sql);
  if (!settings.redeemEnabled) return { error: "Penukaran poin sedang dinonaktifkan" };
  const needed = Math.ceil(rupiah / settings.pointValue);
  const [row] = await sql`
    UPDATE codexa_points SET points = points - ${needed}, total_spent = total_spent + ${needed}, updated_at = NOW()
    WHERE user_id = ${userId} AND points >= ${needed} AND blocked = FALSE RETURNING points`;
  if (!row) return { error: `Poin tidak cukup. Butuh ${needed.toLocaleString("id-ID")} poin`, needed };
  await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
    VALUES (${crypto.randomUUID()}, ${userId}, ${-needed}, 'redeem', ${text(note, 200)})`;
  return { spent: needed, points: Number(row.points) || 0 };
}

async function refundPoints(sql, userId, amount) {
  await sql`UPDATE codexa_points SET points = points + ${amount}, total_spent = GREATEST(0, total_spent - ${amount}) WHERE user_id = ${userId}`;
  await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
    VALUES (${crypto.randomUUID()}, ${userId}, ${amount}, 'refund', 'Pengembalian poin pesanan gagal')`;
}


/* Analisis pola mencurigakan dengan AI (Lovable AI Gateway, Responses API, streaming). */
const AI_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["score", "risk", "summary", "reasons", "recommendation"],
  properties: {
    score: { type: "integer", description: "0-100, makin tinggi makin mencurigakan" },
    risk: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
  },
};

async function callGateway(payload) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { status: 500, error: "LOVABLE_API_KEY belum diatur di server" };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra", stream: true, store: false,
      reasoning: { effort: "low" },
      instructions: "Kamu analis anti-fraud untuk program check-in harian & poin sebuah toko akun digital. Nilai apakah pola user mencurigakan (multi-akun satu jaringan, farming poin, check-in jam yang terlalu teratur seperti bot, banyak user-agent, penyesuaian admin janggal, penukaran poin cepat setelah dikumpulkan). Jangan menuduh tanpa bukti; jika data sedikit, risiko rendah. Jawab dalam Bahasa Indonesia singkat dan jelas. Alasan maksimal 5 butir dan sebutkan data konkret.",
      input: [{ role: "user", content: JSON.stringify(payload) }],
      text: { format: { type: "json_schema", name: "fraud_assessment", strict: true, schema: AI_SCHEMA } },
    }),
  });
  if (!res.ok) {
    let msg = "";
    try { const j = await res.json(); msg = (j.error && (j.error.message || j.error)) || j.message || ""; } catch (_) {}
    if (res.status === 402) msg = msg || "Kredit AI habis. Tambahkan kredit untuk memakai analisis AI.";
    if (res.status === 429) msg = msg || "Terlalu banyak permintaan AI, coba lagi sebentar.";
    return { status: res.status, error: String(msg || `AI gagal (${res.status})`) };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", failed = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "response.output_text.delta") out += ev.delta || "";
        else if (ev.type === "response.refusal.delta") failed = "AI menolak menganalisis data ini.";
        else if (ev.type === "error" || ev.type === "response.failed") failed = (ev.error && ev.error.message) || (ev.response && ev.response.error && ev.response.error.message) || "AI gagal";
      } catch (_) {}
    }
  }
  if (failed) return { status: 502, error: failed };
  try { return { status: 200, result: JSON.parse(out) }; }
  catch (_) { return { status: 502, error: "Jawaban AI tidak bisa dibaca" }; }
}

async function analyzeUser(sql, userId) {
  const [user] = await sql`SELECT id, name, email, created_at AS "createdAt" FROM codexa_users WHERE id = ${userId}`;
  const w = await wallet(sql, userId);
  const checkins = await sql`SELECT day::text AS day, reward, streak, ip_hash, ua,
      to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS') AS at
    FROM codexa_checkins WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 60`;
  const ledger = await sql`SELECT delta, reason, note, to_char(created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS at
    FROM codexa_point_ledger WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 80`;
  const shared = await sql`SELECT c.ip_hash, COUNT(DISTINCT c.user_id)::int AS accounts
    FROM codexa_checkins c WHERE c.ip_hash IN (SELECT ip_hash FROM codexa_checkins WHERE user_id = ${userId} AND ip_hash <> '')
    GROUP BY c.ip_hash`;
  const ipIds = {}; let n = 0;
  const ipLabel = (h) => (ipIds[h] ||= `jaringan-${++n}`);
  const uas = [...new Set(checkins.map((c) => c.ua))];
  return {
    user: { name: user.name, accountCreated: user.createdAt },
    wallet: w,
    checkins: checkins.map((c) => ({ day: c.day, at: c.at, reward: Number(c.reward), streak: c.streak, network: ipLabel(c.ip_hash), device: `ua-${uas.indexOf(c.ua) + 1}` })),
    distinctUserAgents: uas.length,
    networksSharedWithOtherAccounts: shared.map((s) => ({ network: ipLabel(s.ip_hash), accountsOnThisNetwork: s.accounts })),
    pointActivity: ledger.map((l) => ({ ...l, delta: Number(l.delta) })),
  };
}

/* ── Admin ── */
async function handleAdminCheckin(sql, request, response) {
  await ensureCheckinTables(sql);
  if (request.method === "GET") {
    const settings = await readSettings(sql);
    const t = await todayInfo(sql);
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM codexa_checkins WHERE day = ${t.today}::date) AS "todayCount",
        (SELECT COALESCE(SUM(reward),0)::bigint FROM codexa_checkins WHERE day = ${t.today}::date) AS "todayPoints",
        (SELECT COALESCE(SUM(points),0)::bigint FROM codexa_points) AS "circulating",
        (SELECT COALESCE(SUM(total_spent),0)::bigint FROM codexa_points) AS "spent",
        (SELECT COUNT(*)::int FROM codexa_points WHERE last_at > NOW() - INTERVAL '48 hours') AS "activeStreaks"`;
    const users = await sql`
      SELECT u.id, u.name, u.email, COALESCE(p.points,0)::bigint AS points,
             CASE WHEN p.last_at > NOW() - INTERVAL '48 hours' THEN p.streak ELSE 0 END AS streak,
             COALESCE(p.best_streak,0) AS "bestStreak", p.last_day::text AS "lastDay",
             COALESCE(p.total_checkins,0) AS "totalCheckins", COALESCE(p.total_earned,0)::bigint AS "totalEarned",
             COALESCE(p.total_spent,0)::bigint AS "totalSpent", COALESCE(p.blocked,false) AS blocked
      FROM codexa_users u LEFT JOIN codexa_points p ON p.user_id = u.id
      ORDER BY COALESCE(p.points,0) DESC, u.created_at DESC LIMIT 500`;
    const suspicious = await sql`
      SELECT c.ip_hash AS "ipHash", COUNT(DISTINCT c.user_id)::int AS accounts,
             array_agg(DISTINCT u.email) AS emails
      FROM codexa_checkins c JOIN codexa_users u ON u.id = c.user_id
      WHERE c.day >= ${t.today}::date - 7 AND c.ip_hash <> ''
      GROUP BY c.ip_hash HAVING COUNT(DISTINCT c.user_id) >= 2
      ORDER BY accounts DESC LIMIT 20`;
    const recent = await sql`
      SELECT c.day::text AS day, c.reward, c.streak, c.created_at AS "createdAt", u.name, u.email
      FROM codexa_checkins c JOIN codexa_users u ON u.id = c.user_id
      ORDER BY c.created_at DESC LIMIT 40`;
    const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) && k !== "lastDay" && k !== "day" ? Number(v) : v]));
    return response.status(200).json({
      settings, today: t.today, stats: num(stats),
      users: users.map((u) => ({ ...u, points: Number(u.points), totalEarned: Number(u.totalEarned), totalSpent: Number(u.totalSpent) })),
      suspicious, recent,
    });
  }
  if (request.method === "POST") {
    const body = bodyOf(request);
    if (body.op === "settings") {
      const s = sanitizeSettings(body.settings);
      await sql`INSERT INTO codexa_checkin_settings (id, data) VALUES (1, ${JSON.stringify(s)}::jsonb)
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`;
      return response.status(200).json({ ok: true, settings: s });
    }
    const userId = text(body.userId, 80);
    if (!userId) return response.status(400).json({ error: "User wajib dipilih" });
    const exists = await sql`SELECT id FROM codexa_users WHERE id = ${userId}`;
    if (!exists.length) return response.status(404).json({ error: "User tidak ditemukan" });
    await sql`INSERT INTO codexa_points (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
    if (body.op === "adjust") {
      const delta = Math.trunc(Number(body.delta) || 0);
      if (!delta || Math.abs(delta) > 10000000) return response.status(400).json({ error: "Jumlah poin tidak valid" });
      const [row] = await sql`UPDATE codexa_points SET points = GREATEST(0, points + ${delta}),
        total_earned = total_earned + GREATEST(0, ${delta}), updated_at = NOW() WHERE user_id = ${userId} RETURNING points`;
      await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
        VALUES (${crypto.randomUUID()}, ${userId}, ${delta}, 'admin', ${text(body.note, 200) || "Penyesuaian admin"})`;
      return response.status(200).json({ ok: true, points: Number(row.points) });
    }
    if (body.op === "streak") {
      const streak = Math.max(0, Math.min(3650, Math.floor(Number(body.streak) || 0)));
      const t = await todayInfo(sql);
      await sql`UPDATE codexa_points SET streak = ${streak}, best_streak = GREATEST(best_streak, ${streak}),
        last_day = CASE WHEN ${streak} = 0 THEN NULL ELSE COALESCE(GREATEST(last_day, ${t.yesterday}::date), ${t.yesterday}::date) END,
        last_at = CASE WHEN ${streak} = 0 THEN NULL ELSE LEAST(COALESCE(last_at, NOW() - INTERVAL '24 hours'), NOW() - INTERVAL '24 hours') END,
        updated_at = NOW() WHERE user_id = ${userId}`;
      return response.status(200).json({ ok: true });
    }
    if (body.op === "setPoints") {
      const target = Math.max(0, Math.min(1000000000, Math.floor(Number(body.points) || 0)));
      const [cur] = await sql`SELECT points FROM codexa_points WHERE user_id = ${userId}`;
      const delta = target - Number(cur.points || 0);
      await sql`UPDATE codexa_points SET points = ${target}, total_earned = total_earned + GREATEST(0, ${delta}), updated_at = NOW() WHERE user_id = ${userId}`;
      if (delta) await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
        VALUES (${crypto.randomUUID()}, ${userId}, ${delta}, 'admin', ${text(body.note, 200) || (target === 0 ? "Poin direset admin" : `Poin diatur admin ke ${target}`)})`;
      return response.status(200).json({ ok: true, points: target });
    }
    if (body.op === "resetCheckin") {
      await sql`UPDATE codexa_points SET streak = 0, last_day = NULL, last_at = NULL, updated_at = NOW() WHERE user_id = ${userId}`;
      return response.status(200).json({ ok: true });
    }
    if (body.op === "resetAll") {
      const [cur] = await sql`SELECT points FROM codexa_points WHERE user_id = ${userId}`;
      await sql`UPDATE codexa_points SET points = 0, streak = 0, best_streak = 0, last_day = NULL, last_at = NULL, updated_at = NOW() WHERE user_id = ${userId}`;
      if (Number(cur.points)) await sql`INSERT INTO codexa_point_ledger (id, user_id, delta, reason, note)
        VALUES (${crypto.randomUUID()}, ${userId}, ${-Number(cur.points)}, 'admin', 'Reset total oleh admin')`;
      return response.status(200).json({ ok: true });
    }
    if (body.op === "block") {
      await sql`UPDATE codexa_points SET blocked = ${!!body.blocked}, updated_at = NOW() WHERE user_id = ${userId}`;
      return response.status(200).json({ ok: true });
    }
    if (body.op === "analyze") {
      const rl = await rateLimit(sql, { key: "checkin-ai", limit: 20, windowSec: 60 });
      if (!rl.allowed) return response.status(429).json({ error: "Terlalu sering, coba lagi sebentar" });
      const data = await analyzeUser(sql, userId);
      const r = await callGateway(data);
      if (r.error) return response.status(r.status).json({ error: r.error });
      return response.status(200).json({ analysis: r.result, stats: { checkins: data.checkins.length, activities: data.pointActivity.length } });
    }
    if (body.op === "ledger") {
      const ledger = await sql`SELECT delta, reason, note, created_at AS "createdAt" FROM codexa_point_ledger
        WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50`;
      return response.status(200).json({ ledger: ledger.map((l) => ({ ...l, delta: Number(l.delta) })) });
    }
    return response.status(400).json({ error: "Aksi tidak dikenal" });
  }
  return response.status(405).json({ error: "Metode tidak didukung" });
}

module.exports = { callGateway, handleUserCheckin, handleAdminCheckin, spendPoints, refundPoints, readSettings };
