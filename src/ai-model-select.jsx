/* Dropdown model GRATIS OpenRouter untuk menu Admin → Assisten. */

const fmtContext = (n) => (n >= 1000000 ? `${Math.round(n / 100000) / 10}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n || ""));

export function modelLabel(m) {
  if (m.id === "openrouter/free") return "Otomatis — openrouter/free (pilih model gratis yang tersedia)";
  const tags = [m.tools ? "tools" : "tanpa tools", m.vision ? "gambar" : "", m.context ? fmtContext(m.context) : ""].filter(Boolean);
  return `${m.name} — ${m.id} (${tags.join(", ")})`;
}

export default function AiModelSelect({ value, onChange, models }) {
  const list = Array.isArray(models) ? models : [];
  const known = list.some((m) => m.id === value);
  return (
    <select value={value || "openrouter/free"} onChange={(e) => onChange(e.target.value)}>
      {!list.length && <option value="openrouter/free">openrouter/free</option>}
      {value && !known && list.length > 0 && <option value={value}>{value} (tidak ada di daftar gratis saat ini)</option>}
      {list.map((m) => (
        <option key={m.id} value={m.id}>{modelLabel(m)}</option>
      ))}
    </select>
  );
}
