import { useCallback, useEffect, useState } from "react";
import { Bot, Check, ExternalLink, Loader2, Pause, Play, RefreshCw, Send, Sparkles, Trash2 } from "lucide-react";
import { jsonRequest } from "./main.jsx";

const api = (resource, options = {}) => jsonRequest(`/api/admin/youtube?resource=${resource}`, options);
const CHIPS = ["cara buat akun google", "cara buat akun google tanpa verifikasi nomor", "cara membuat akun gmail baru", "akun google"];
const ST = {
  queued: ["Menunggu antrian", "#b45309"], sending: ["Mengirim…", "#2563eb"], sent: ["Berhasil", "#15803d"],
  failed: ["Gagal", "#b91c1c"], skipped: ["Dilewati", "#6b7280"], rejected: ["Dihapus", "#6b7280"],
};
const compact = (n) => { const v = Number(n) || 0; return v >= 1e6 ? `${(v / 1e6).toFixed(1)}jt` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}rb` : String(v); };
const jam = (d) => { try { return new Intl.DateTimeFormat("id-ID", { timeStyle: "short", dateStyle: "short" }).format(new Date(d)); } catch (_) { return "-"; } };

export default function YtAssistant({ onNotice }) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);
  const [minViews, setMinViews] = useState(2000);
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState({});
  const [queue, setQueue] = useState(null);
  const [err, setErr] = useState("");
  const [now, setNow] = useState(Date.now());

  const loadQueue = useCallback(async () => {
    setBusy((b) => b || "queue");
    try { setQueue(await api("queue")); } catch (e) { setErr(e.message); }
    setBusy((b) => (b === "queue" ? "" : b));
  }, []);

  useEffect(() => { loadQueue(); const t = setInterval(loadQueue, 60000); return () => clearInterval(t); }, [loadQueue]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const find = async () => {
    setBusy("find"); setErr("");
    try {
      const data = await api("assistant", { method: "POST", body: JSON.stringify({ prompt, count, minViews }) });
      setResults(data.results || []);
      setPicked(Object.fromEntries((data.results || []).map((r) => [r.id, true])));
      if (!(data.results || []).length) setErr("Tidak ada video baru yang cocok. Coba kata kunci lain atau turunkan minimum views.");
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const apply = async () => {
    const items = results.filter((r) => picked[r.id]).map((r) => ({ id: r.id, comment: r.comment }));
    if (!items.length) return;
    setBusy("apply");
    try {
      const data = await api("queue", { method: "POST", body: JSON.stringify({ items }) });
      onNotice && onNotice(`${data.added} komentar masuk antrian`);
      setResults((rs) => rs.filter((r) => !picked[r.id]));
      await loadQueue();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };

  const remove = async (id) => { await api(`queue&id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null); loadQueue(); };
  const togglePause = async () => {
    await api("queue-state", { method: "POST", body: JSON.stringify({ paused: !queue.state.paused }) }).catch(() => null);
    loadQueue();
  };

  const left = queue ? Math.max(0, new Date(queue.nextAt).getTime() - now) : 0;
  const mm = String(Math.floor(left / 60000)).padStart(2, "0");
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, "0");
  const c = (queue && queue.counts) || {};

  return (
    <div className="cx-yta">
      <div className="cx-panel">
        <div className="cx-panel-header">
          <h3><Bot size={14} /> Asisten Promosi</h3>
          <span className="cx-panel-sub">cari video populer & relevan, buat komentar natural tanpa link</span>
        </div>
        <textarea className="cx-yta-input" rows={2} value={prompt} placeholder="Kata kunci (pisahkan dengan koma). Kosongkan = topik Akun Google default"
          onChange={(e) => setPrompt(e.target.value)} />
        <div className="cx-yta-chips">
          {CHIPS.map((k) => (
            <button key={k} type="button" onClick={() => setPrompt((p) => (p ? `${p}, ${k}` : k))}>{k}</button>
          ))}
        </div>
        <div className="cx-yta-row">
          <label>Jumlah<select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[3, 5, 8, 10].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Min views<input type="number" min="0" value={minViews} onChange={(e) => setMinViews(e.target.value)} /></label>
          <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={find} disabled={busy === "find"}>
            {busy === "find" ? <Loader2 size={11} className="cx-spin" /> : <Sparkles size={11} />} {busy === "find" ? "Mencari & menulis…" : "Cari & Buat Komentar"}
          </button>
        </div>
        {err && <div className="cx-yt-alert is-error" style={{ marginTop: 10 }}>{err}</div>}

        {results.length > 0 && (
          <>
            <div className="cx-yta-list">
              {results.map((r) => (
                <div key={r.id} className={`cx-yta-item${picked[r.id] ? " on" : ""}`}>
                  <input type="checkbox" checked={!!picked[r.id]} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.checked })} />
                  {r.thumbnail && <img src={r.thumbnail} alt="" loading="lazy" />}
                  <div className="cx-yta-body">
                    <a href={`https://www.youtube.com/watch?v=${r.videoId}`} target="_blank" rel="noopener noreferrer" className="cx-yta-title">
                      {r.title} <ExternalLink size={10} />
                    </a>
                    <span className="cx-yta-meta">{r.channelTitle} · {compact(r.views)} views · relevansi {r.relevance}%</span>
                    <textarea rows={2} value={r.comment}
                      onChange={(e) => setResults((rs) => rs.map((x) => (x.id === r.id ? { ...x, comment: e.target.value } : x)))} />
                  </div>
                </div>
              ))}
            </div>
            <button className="cx-btn cx-btn-primary cx-btn-sm" style={{ marginTop: 10 }} onClick={apply} disabled={busy === "apply"}>
              {busy === "apply" ? <Loader2 size={11} className="cx-spin" /> : <Check size={11} />} Apply ke Antrian ({results.filter((r) => picked[r.id]).length})
            </button>
          </>
        )}
      </div>

      <div className="cx-panel" style={{ marginTop: 14 }}>
        <div className="cx-panel-header">
          <h3><Send size={14} /> Antrian Kirim</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {queue && (
              <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={togglePause}>
                {queue.state.paused ? <><Play size={11} /> Lanjutkan</> : <><Pause size={11} /> Jeda</>}
              </button>
            )}
            <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={loadQueue} aria-label="Refresh">
              <RefreshCw size={11} className={busy === "queue" ? "cx-spin" : ""} />
            </button>
          </div>
        </div>
        <div className="cx-yta-stats">
          <div><b>{c.queued || 0}</b><span>Antri</span></div>
          <div><b style={{ color: "#15803d" }}>{c.sent || 0}</b><span>Berhasil</span></div>
          <div><b style={{ color: "#b91c1c" }}>{c.failed || 0}</b><span>Gagal</span></div>
          <div><b>{queue && queue.state.paused ? "—" : c.queued ? `${mm}:${ss}` : "—"}</b><span>Kirim berikutnya</span></div>
        </div>
        {queue && queue.state.paused && (
          <div className="cx-yt-alert is-stop">Antrian dijeda{queue.state.reason ? `: ${queue.state.reason}` : ""}</div>
        )}
        <p className="cx-yta-note">Otomatis kirim 1 komentar tiap {(queue && queue.gapMinutes) || 15} menit, 1 komentar per video, video yang sudah dikomentari tidak dipakai lagi.</p>
        <div className="cx-yta-queue">
          {queue && !queue.items.length && <p className="cx-yt-empty">Antrian kosong.</p>}
          {queue && queue.items.map((it) => {
            const [label, color] = ST[it.status] || [it.status, "#6b7280"];
            return (
              <div key={it.id} className="cx-yta-q">
                {it.thumbnail && <img src={it.thumbnail} alt="" loading="lazy" />}
                <div className="cx-yta-body">
                  <span className="cx-yta-title">{it.title || it.videoId}</span>
                  <span className="cx-yta-meta">“{it.comment}”</span>
                  {it.error && <span className="cx-yta-meta" style={{ color: "#b91c1c" }}>{it.error}</span>}
                </div>
                <div className="cx-yta-side">
                  <span className="cx-yta-badge" style={{ color, borderColor: color }}>{label}</span>
                  <small>{jam(it.sentAt || it.queuedAt)}</small>
                  {it.status === "queued" && <button onClick={() => remove(it.id)} aria-label="Hapus"><Trash2 size={11} /></button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
