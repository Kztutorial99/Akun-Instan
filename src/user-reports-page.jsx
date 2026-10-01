import { useEffect, useState } from "react";
import { FileText, RefreshCw, MessageSquareText, Sparkles } from "lucide-react";
import { MediaGrid } from "./media-attach.jsx";

const STATUS = {
  open: ["Menunggu", "open"],
  in_progress: ["Diproses", "progress"],
  resolved: ["Selesai", "done"],
  closed: ["Ditutup", "closed"],
};
const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "-" : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export default function UserReportsPage({ guest, onLogin, onAskAssistant }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const load = () => {
    setErr("");
    fetch("/api/assistant?resource=reports", { credentials: "same-origin" })
      .then(async (r) => { const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p.error || "Gagal memuat"); return p; })
      .then(setData).catch((e) => setErr(e.message));
  };
  useEffect(() => { if (!guest) load(); }, [guest]);

  if (guest) return (
    <main className="cx-container cx-ur">
      <div className="cx-ur-empty"><FileText size={20} /><p>Masuk dulu untuk melihat laporanmu.</p>
        <button className="cx-btn cx-btn-primary" onClick={onLogin}>Masuk</button></div>
    </main>
  );

  const list = (data && data.reports) || [];
  const shown = list.filter((r) => filter === "all" || (filter === "active" ? ["open", "in_progress"].includes(r.status) : ["resolved", "closed"].includes(r.status)));
  const q = data && data.quota;

  return (
    <main className="cx-container cx-ur">
      <div className="cx-ur-head">
        <div><h1>Laporan Saya</h1><p>Status laporan yang kamu kirim lewat Assisten dan balasan admin.</p></div>
        <button className="cx-icon-btn" onClick={load} aria-label="Muat ulang"><RefreshCw size={14} /></button>
      </div>
      {q && (
        <div className={`cx-ur-quota${q.remaining === 0 || q.waitMin > 0 ? " warn" : ""}`}>
          Sisa kirim laporan: <b>{q.remaining}/{q.limit}</b> (24 jam)
          {q.waitMin > 0 && <> · bisa lagi ±{q.waitMin >= 60 ? `${Math.ceil(q.waitMin / 60)} jam` : `${q.waitMin} menit`}</>}
        </div>
      )}
      <div className="cx-ur-filters">
        {[["all", "Semua"], ["active", "Aktif"], ["done", "Selesai"]].map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {err && <div className="cx-ai-error">{err}</div>}
      {!data && !err && <div className="cx-ur-empty"><RefreshCw size={16} className="cx-spin" /><p>Memuat...</p></div>}
      {data && !shown.length && (
        <div className="cx-ur-empty"><FileText size={20} /><p>Belum ada laporan.</p>
          <button className="cx-btn cx-btn-secondary" onClick={onAskAssistant}><Sparkles size={13} /> Lapor lewat Assisten</button></div>
      )}
      <div className="cx-ur-list">
        {shown.map((r) => {
          const [label, cls] = STATUS[r.status] || [r.status, "open"];
          return (
            <article key={r.ticket} className="cx-ur-card">
              <div className="cx-ur-top">
                <b>#{r.ticket}</b><span className={`cx-ur-st ${cls}`}>{label}</span>
                <small>{when(r.createdAt)}</small>
              </div>
              <p className="cx-ur-sum">{r.summary}</p>
              {r.detail && <p className="cx-ur-detail">{r.detail}</p>}
              {Array.isArray(r.attachments) && r.attachments.length > 0 && <MediaGrid items={r.attachments} className="cx-ur-media" />}
              {r.adminNote && (
                <div className="cx-ur-reply"><MessageSquareText size={12} /><div><b>Balasan admin</b><p>{r.adminNote}</p></div></div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
