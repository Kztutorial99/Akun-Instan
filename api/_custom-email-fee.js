/* Harga Custom Email per nama — bisa diatur admin dari menu "Custom Email".
   Disimpan di codexa_settings key "custom_email"; default Rp10.000. */
const { ensureSettingsTable } = require("./_settings");

const KEY = "custom_email";
const DEFAULT_FEE = 10000;
let cache = { value: null, at: 0 };

function normalizeFee(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_FEE;
  return Math.min(10000000, Math.max(0, n));
}

async function readCustomEmailFee(sql, { fresh = false } = {}) {
  if (!fresh && cache.value !== null && Date.now() - cache.at < 20000) return cache.value;
  let fee = DEFAULT_FEE;
  try {
    await ensureSettingsTable(sql);
    const rows = await sql`SELECT value FROM codexa_settings WHERE key = ${KEY} LIMIT 1`;
    let v = rows.length ? rows[0].value : null;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = null; } }
    if (v && v.fee !== undefined) fee = normalizeFee(v.fee);
  } catch (_) { /* pakai default */ }
  cache = { value: fee, at: Date.now() };
  return fee;
}

async function writeCustomEmailFee(sql, value) {
  const fee = normalizeFee(value);
  await ensureSettingsTable(sql);
  const json = JSON.stringify({ fee });
  await sql`
    INSERT INTO codexa_settings (key, value, updated_at) VALUES (${KEY}, ${json}::jsonb, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = NOW()
  `;
  cache = { value: fee, at: Date.now() };
  return fee;
}

module.exports = { readCustomEmailFee, writeCustomEmailFee, DEFAULT_CUSTOM_EMAIL_FEE: DEFAULT_FEE };
