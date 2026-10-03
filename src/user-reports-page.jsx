import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, MessageSquareText, ChevronDown, Paperclip } from "lucide-react";
import { MediaGrid } from "./media-attach.jsx";
import ManualReportForm from "./manual-report-form.jsx";
import { canCreateReport, displayTicket } from "./report-state.mjs";

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

export default function UserReportsPage({ guest, onLogin }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");
  const [openId, setOpenId] = useState("");
  const requestId = useRef(0);
  const [sendingComplete, setSendingComplete] = useState(false);
  const load = useCallback(() => {
    const id = ++requestId.current;
    setErr(""); setLoading(true);
    const started = Date.now();
    fetch("/api/assistant?resource=reports", { credentials: "same-origin" })
      .then(async (r) => { const p = await r.json().catch(() => ({})); if (!r.ok) throw new Error(p.error || "Gagal memuat"); return p; })
      .then((p) => { if (id === requestId.current) { setData(p); setSendingComplete(false); } }).catch((e) => { if (id === requestId.current) setErr(e.message); })
      .finally(() => setTimeout(() => setLoading(false), Math.max(0, 600 - (Date.now() - started))));
  }, []);
  useEffect(() => {
    if (guest) return;
    load();
    const interval = setInterval(load, 30000);
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", refresh); ++requestId.current; };
  }, [guest, load]);

  if (guest) return (
    <main className="cx-container cx-ur">
      <div className="cx-ur-empty"><FileText size={20} /><p>Masuk dulu untuk melihat laporanmu.</p>
        <button className="cx-btn cx-btn-primary" onClick={onLogin}>Masuk</button></div>
    </main>
  );

  const list = (data && data.reports) || [];
  const shown = list.filter((r) => filter === "all" || (filter === "active" ? ["open", "in_progress"].includes(r.status) : ["resolved", "closed"].includes(r.status)));
  const q = data && data.quota;
  const activeReport = list.find((r) => ["open", "in_progress"].includes(r.status));
  const canSend = canCreateReport(data) && !sendingComplete;
  const activeTicket = q?.ticket || activeReport?.ticket;

  return (
    <main className="cx-container cx-ur">
      <div className="cx-ur-head">
        <div><h1>Laporan Saya</h1><p>Status laporan & balasan admin.</p></div>
        <button className={`cx-icon-btn${loading ? " is-spinning" : ""}`} onClick={load} disabled={loading} aria-label="Muat ulang"><RefreshCw size={14} /></button>
      </div>
      {activeTicket && (
        <div className="cx-ur-quota warn" role="status">
          Laporan <b>#{displayTicket(activeTicket)}</b> sedang di proses, mohon menunggu balasan dari tim kami.
        </div>
      )}
      {sendingComplete && <div className="cx-ur-quota" role="status">Laporan terkirim. Memperbarui status laporan...</div>}
      {canSend && !err && <ManualReportForm onSubmitted={() => { setSendingComplete(true); setFilter("active"); load(); }} />}
      <section className="cx-ur-history">
      <h2>Status Laporan</h2>
      <div className="cx-ur-filters">
        {[["all", "Semua"], ["active", "Aktif"], ["done", "Selesai"]].map(([k, l]) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {err && <div className="cx-ai-error">{err}</div>}
      {!data && !err && <div className="cx-ur-empty"><RefreshCw size={16} className="cx-spin" /><p>Memuat...</p></div>}
      {data && !shown.length && (
        <div className="cx-ur-empty"><FileText size={20} /><p>Belum ada laporan.</p>
          </div>
      )}
      <div className="cx-ur-list">
        {shown.map((r) => {
          const [label, cls] = STATUS[r.status] || [r.status, "open"];
          const open = openId === r.ticket;
          const files = Array.isArray(r.attachments) ? r.attachments : [];
          return (
            <article key={r.ticket} className={`cx-ur-card${open ? " open" : ""}`}>
              <button type="button" className="cx-ur-row" onClick={() => setOpenId(open ? "" : r.ticket)} aria-expanded={open}>
                <div className="cx-ur-top">
                  <b>#{displayTicket(r.ticket)}</b><span className={`cx-ur-st ${cls}`}>{label}</span>
                  {files.length > 0 && <span className="cx-ur-clip"><Paperclip size={10} />{files.length}</span>}
                  {r.adminNote && <span className="cx-ur-clip ok"><MessageSquareText size={10} /></span>}
                  <small>{when(r.createdAt)}</small>
                </div>
                <p className="cx-ur-sum">{r.summary}</p>
                <ChevronDown size={14} className="cx-ur-chev" />
              </button>
              {open && (
                <div className="cx-ur-more">
                  {r.detail && <p className="cx-ur-detail">{r.detail}</p>}
                  {files.length > 0 && <MediaGrid items={files} className="cx-ur-media" />}
                </div>
              )}
              {r.adminNote && (
                <div className="cx-ur-reply"><MessageSquareText size={12} /><div><b>Balasan admin</b><p>{r.adminNote}</p></div></div>
              )}
            </article>
          );
        })}
      </div>
      </section>
    </main>
  );
}
