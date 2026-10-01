import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ClipboardList, Clock, Flame, Inbox, Loader2, MessageSquareText, RefreshCw, Search, ShieldAlert, Paperclip, Trash2, User, Wallet,
} from "lucide-react";
import { jsonRequest } from "./main.jsx";
import { MediaGrid } from "./media-attach.jsx";

const STATUS = {
  open: { label: "Baru", cls: "open" },
  in_progress: { label: "Diproses", cls: "progress" },
  resolved: { label: "Selesai", cls: "done" },
  closed: { label: "Ditutup", cls: "closed" },
};
const CAT_LABEL = { topup: "Top Up", saldo: "Saldo", akun: "Akun", produk: "Produk", refund: "Refund", lainnya: "Lainnya" };
const FILTERS = [
  { key: "active", label: "Aktif" },
  { key: "open", label: "Baru" },
  { key: "in_progress", label: "Diproses" },
  { key: "done", label: "Selesai" },
  { key: "all", label: "Semua" },
];

const rupiah = (v) => `Rp${(Number(v) || 0).toLocaleString("id-ID")}`;
const timeAgo = (iso) => {
  const t = new Date(iso).getTime();
  if (!t) return "-";
  const d = Math.max(0, Date.now() - t) / 1000;
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hari lalu`;
};

export default function ReportsPage({ onNotice }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("active");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState("");
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    jsonRequest("/api/admin/reports", { method: "GET" })
      .then(setData)
      .catch((e) => onNotice && onNotice(e.message, "error"))
      .finally(() => setLoading(false));
  }, [onNotice]);
  useEffect(() => { load(); }, [load]);

  const list = useMemo(() => {
    const rows = (data && data.reports) || [];
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "active" && !["open", "in_progress"].includes(r.status)) return false;
      if (filter === "done" && !["resolved", "closed"].includes(r.status)) return false;
      if (["open", "in_progress"].includes(filter) && r.status !== filter) return false;
      if (cat !== "all" && r.category !== cat) return false;
      if (s && !`${r.ticket} ${r.userName} ${r.userEmail} ${r.summary} ${r.detail}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data, filter, cat, q]);

  const update = async (r, patch) => {
    setBusy(r.id);
    try {
      await jsonRequest("/api/admin/reports", { method: "PATCH", body: JSON.stringify({ id: r.id, ...patch }) });
      onNotice && onNotice(`Laporan ${r.ticket} diperbarui, user sudah diberi notifikasi`);
      load();
    } catch (e) { onNotice && onNotice(e.message, "error"); }
    finally { setBusy(""); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Hapus laporan ${r.ticket}?`)) return;
    setBusy(r.id);
    try {
      await jsonRequest(`/api/admin/reports?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
      onNotice && onNotice(`Laporan ${r.ticket} dihapus`);
      load();
    } catch (e) { onNotice && onNotice(e.message, "error"); }
    finally { setBusy(""); }
  };

  const st = (data && data.stats) || {};
  const issues = (data && data.issues) || {};
  const cats = (data && data.categories) || [];
  const maxCat = Math.max(1, ...cats.map((c) => c.total));

  return (
    <div className="cx-rp">
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Laporan dari Assisten AI & masalah user</div>
          <h1>Data Laporan</h1>
        </div>
        <div className="cx-admin-actions">
          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 size={11} className="cx-spin" /> : <RefreshCw size={11} />} Refresh
          </button>
        </div>
      </div>

      <div className="cx-rp-cards">
        <Card icon={Inbox} label="Laporan baru" value={st.open} tone="amber" sub={`${st.today || 0} masuk 24 jam`} />
        <Card icon={Clock} label="Diproses" value={st.inProgress} tone="blue" sub="sedang ditangani" />
        <Card icon={Flame} label="Urgensi tinggi" value={st.urgent} tone="red" sub="belum selesai" />
        <Card icon={CheckCircle2} label="Selesai" value={st.done} tone="green" sub={`dari ${st.total || 0} total`} />
      </div>

      <div className="cx-rp-grid">
        <div className="cx-rp-panel">
          <div className="cx-rp-head"><ShieldAlert size={12} /> Info masalah user</div>
          <div className="cx-rp-issues">
            <Issue icon={Wallet} label="Top up menunggu" value={issues.pendingTopups} />
            <Issue icon={AlertTriangle} label="Top up ditolak (7 hari)" value={issues.rejectedTopups7d} />
            <Issue icon={User} label="Akun suspend / banned" value={issues.suspendedUsers} />
            <Issue icon={ShieldAlert} label="User kena limit laporan" value={issues.limitedUsers} />
          </div>
          <p className="cx-rp-hint">
            Anti-spam aktif: maks {data ? data.limit.perDay : 3} laporan / 24 jam per user, jeda {data ? data.limit.cooldownMin : 10} menit,
            dan laporan kategori sama yang masih terbuka tidak dibuat ulang.
          </p>
        </div>
        <div className="cx-rp-panel">
          <div className="cx-rp-head"><ClipboardList size={12} /> Kategori masalah</div>
          {cats.length === 0 && <div className="cx-rp-empty">Belum ada data.</div>}
          {cats.map((c) => (
            <button key={c.category} className={`cx-rp-bar${cat === c.category ? " on" : ""}`} onClick={() => setCat(cat === c.category ? "all" : c.category)}>
              <span>{CAT_LABEL[c.category] || c.category}</span>
              <i><b style={{ width: `${(c.total / maxCat) * 100}%` }} /></i>
              <em>{c.total}</em>
            </button>
          ))}
        </div>
        <div className="cx-rp-panel">
          <div className="cx-rp-head"><User size={12} /> User paling sering lapor</div>
          {(!data || data.topUsers.length === 0) && <div className="cx-rp-empty">Belum ada data.</div>}
          {data && data.topUsers.map((u) => (
            <div key={u.userId} className="cx-rp-user" onClick={() => setQ(u.email || "")}>
              <div><strong>{u.name || "-"}</strong><small>{u.email}</small></div>
              <span className={u.today >= 3 ? "lim" : ""}>{u.total}{u.today >= 3 ? " · limit" : ""}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="cx-rp-toolbar">
        <div className="cx-rp-tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
          {cat !== "all" && <button className="on" onClick={() => setCat("all")}>{CAT_LABEL[cat] || cat} ✕</button>}
        </div>
        <label className="cx-rp-search">
          <Search size={12} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari tiket, user, masalah..." />
        </label>
      </div>

      <div className="cx-rp-list">
        {!data && loading && <div className="cx-rp-empty"><Loader2 size={12} className="cx-spin" /> Memuat laporan...</div>}
        {data && list.length === 0 && <div className="cx-rp-empty big"><Inbox size={22} />Tidak ada laporan di filter ini.</div>}
        {list.map((r) => {
          const s = STATUS[r.status] || STATUS.open;
          const expanded = openId === r.id;
          return (
            <div key={r.id} className={`cx-rp-item urg-${r.urgency}${expanded ? " open" : ""}`}>
              <button className="cx-rp-item-head" onClick={() => setOpenId(expanded ? "" : r.id)}>
                <span className={`cx-rp-badge ${s.cls}`}>{s.label}</span>
                <code>{r.ticket}</code>
                <span className="cx-rp-cat">{CAT_LABEL[r.category] || r.category}</span>
                {r.urgency === "tinggi" && <span className="cx-rp-urg"><Flame size={10} /> Tinggi</span>}
                {Array.isArray(r.attachments) && r.attachments.length > 0 && <span className="cx-rp-att"><Paperclip size={10} /> {r.attachments.length}</span>}
                <span className="cx-rp-time">{timeAgo(r.createdAt)}</span>
              </button>
              <p className="cx-rp-summary">{r.summary}</p>
              <div className="cx-rp-meta">
                <User size={10} /> {r.userName || "-"} · {r.userEmail || "-"}
                {r.userReportCount > 1 && <span> · {r.userReportCount} laporan</span>}
              </div>
              {expanded && (
                <div className="cx-rp-body">
                  {r.detail && <div className="cx-rp-detail"><MessageSquareText size={11} /><span>{r.detail}</span></div>}
                  {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                    <div className="cx-rp-media">
                      <div className="cx-rp-media-head"><Paperclip size={11} /> Lampiran dari user ({r.attachments.length})</div>
                      <MediaGrid items={r.attachments} />
                    </div>
                  )}
                  <div className="cx-rp-facts">
                    <span>Saldo: <b>{rupiah(r.userBalance)}</b></span>
                    <span>Status akun: <b>{r.userStatus || "-"}</b></span>
                    <span>Telepon: <b>{r.userPhone || "-"}</b></span>
                    <span>Urgensi: <b>{r.urgency}</b></span>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Tulis balasan untuk user (muncul di notifikasi)..."
                    value={notes[r.id] != null ? notes[r.id] : r.adminNote || ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                  />
                  <div className="cx-rp-actions">
                    <button disabled={busy === r.id} onClick={() => update(r, { status: "in_progress", adminNote: notes[r.id] })}>Proses</button>
                    <button disabled={busy === r.id} className="ok" onClick={() => update(r, { status: "resolved", adminNote: notes[r.id] })}>Selesai</button>
                    <button disabled={busy === r.id} onClick={() => update(r, { status: "closed", adminNote: notes[r.id] })}>Tutup</button>
                    <button disabled={busy === r.id} className="del" onClick={() => remove(r)}><Trash2 size={11} /></button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ icon: Icon, label, value, sub, tone }) {
  return (
    <div className={`cx-rp-card ${tone}`}>
      <div className="cx-rp-card-top"><Icon size={12} />{label}</div>
      <strong>{Number(value) || 0}</strong>
      <small>{sub}</small>
    </div>
  );
}
function Issue({ icon: Icon, label, value }) {
  const n = Number(value) || 0;
  return (
    <div className={`cx-rp-issue${n ? " hot" : ""}`}>
      <Icon size={12} /><span>{label}</span><b>{n}</b>
    </div>
  );
}
