import { useEffect, useMemo, useState } from "react";
import { Send, Users, User, Search, RefreshCw, MessageSquareText, Megaphone, Gift, ShieldAlert, Check, X, Eye } from "lucide-react";
import { jsonRequest } from "./main.jsx";

const TYPES = [
  { key: "admin_msg", label: "Pesan", icon: MessageSquareText },
  { key: "admin_info", label: "Info", icon: Megaphone },
  { key: "admin_promo", label: "Promo", icon: Gift },
  { key: "admin_warn", label: "Penting", icon: ShieldAlert },
];
const LINKS = [["", "Tanpa tombol"], ["katalog", "Katalog"], ["topup", "Top Up"], ["orders", "Pesanan"], ["reports", "Laporan"]];
const ago = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  return `${Math.floor(d / 86400)} hari lalu`;
};

export default function AdminNotifyPage({ onNotice }) {
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState("user");
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState("");
  const [type, setType] = useState("admin_msg");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    setLoading(true);
    const t = Date.now();
    try {
      const [u, h] = await Promise.allSettled([
        jsonRequest("/api/admin/users", { method: "GET" }),
        jsonRequest("/api/admin/users?action=notify", { method: "GET" }),
      ]);
      if (u.status === "fulfilled") setUsers(u.value.users || []); else throw u.reason;
      if (h.status === "fulfilled") setHistory(h.value.history || []);
    } catch (e) { onNotice && onNotice(e.message || "Gagal memuat", "error"); }
    setTimeout(() => setLoading(false), Math.max(0, 600 - (Date.now() - t)));
  };
  useEffect(() => { load(); }, []);

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => !s || `${u.name} ${u.email}`.toLowerCase().includes(s)).slice(0, 30);
  }, [users, q]);
  const pickedUsers = users.filter((u) => picked.includes(u.id));
  const toggle = (id) => setPicked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));

  const send = async () => {
    if (title.trim().length < 2) return onNotice && onNotice("Judul wajib diisi", "error");
    if (target === "user" && !picked.length) return onNotice && onNotice("Pilih minimal 1 user", "error");
    if (target === "all" && !window.confirm("Kirim ke SEMUA user aktif?")) return;
    setSending(true);
    try {
      const p = await jsonRequest("/api/admin/users?action=notify", {
        method: "POST",
        body: JSON.stringify({ target, userIds: picked, type, title, body, link }),
      });
      onNotice && onNotice(`Terkirim ke ${p.sent} user`, "success");
      setTitle(""); setBody(""); setPicked([]);
      load();
    } catch (e) { onNotice && onNotice(e.message || "Gagal mengirim", "error"); }
    setSending(false);
  };

  const T = TYPES.find((x) => x.key === type) || TYPES[0];

  return (
    <div className="cx-an">
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Kirim pesan langsung ke kotak notifikasi user</div>
          <h1>Send Chat & Notifikasi</h1>
        </div>
        <div className="cx-admin-actions">
          <button className={`cx-btn cx-btn-secondary cx-btn-sm${loading ? " is-spinning" : ""}`} onClick={load} disabled={loading}><RefreshCw size={11} /> Refresh</button>
        </div>
      </div>

      <div className="cx-an-grid">
        <section className="cx-an-card">
          <div className="cx-an-seg">
            <button className={target === "user" ? "on" : ""} onClick={() => setTarget("user")}><User size={12} /> Pilih user</button>
            <button className={target === "all" ? "on" : ""} onClick={() => setTarget("all")}><Users size={12} /> Semua user</button>
          </div>

          {target === "user" && (
            <div className="cx-an-pick">
              {pickedUsers.length > 0 && (
                <div className="cx-an-chips">
                  {pickedUsers.map((u) => (
                    <span key={u.id}>{u.name || u.email}<button onClick={() => toggle(u.id)} aria-label="Hapus"><X size={10} /></button></span>
                  ))}
                </div>
              )}
              <label className="cx-an-search"><Search size={12} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / email user..." /></label>
              <div className="cx-an-users">
                {found.map((u) => (
                  <button key={u.id} className={picked.includes(u.id) ? "on" : ""} onClick={() => toggle(u.id)}>
                    <span className="cx-an-av">{(u.name || u.email || "?").slice(0, 1).toUpperCase()}</span>
                    <span className="cx-an-ut"><b>{u.name || "-"}</b><small>{u.email}</small></span>
                    {picked.includes(u.id) && <Check size={13} />}
                  </button>
                ))}
                {!found.length && <p className="cx-an-empty">User tidak ditemukan</p>}
              </div>
            </div>
          )}
          {target === "all" && <p className="cx-an-hint"><Users size={12} /> Dikirim ke {users.filter((u) => u.status === "active").length} user aktif.</p>}

          <div className="cx-an-types">
            {TYPES.map((t) => (
              <button key={t.key} className={`t-${t.key}${type === t.key ? " on" : ""}`} onClick={() => setType(t.key)}><t.icon size={12} />{t.label}</button>
            ))}
          </div>
          <input className="cx-an-in" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Judul notifikasi" />
          <textarea className="cx-an-in" value={body} maxLength={600} rows={4} onChange={(e) => setBody(e.target.value)} placeholder="Tulis pesan untuk user..." />
          <div className="cx-an-row">
            <select className="cx-an-in" value={link} onChange={(e) => setLink(e.target.value)}>
              {LINKS.map(([k, l]) => <option key={k} value={k}>{k ? `Tombol: ${l}` : l}</option>)}
            </select>
            <small>{body.length}/600</small>
          </div>
          <button className="cx-btn cx-btn-primary cx-an-send" onClick={send} disabled={sending}>
            {sending ? <RefreshCw size={13} className="cx-spin" /> : <Send size={13} />}
            {sending ? "Mengirim..." : target === "all" ? "Kirim ke semua" : `Kirim ke ${picked.length || 0} user`}
          </button>
        </section>

        <section className="cx-an-side">
          <div className="cx-an-label"><Eye size={11} /> Pratinjau di HP user</div>
          <div className={`cx-an-preview t-${type}`}>
            <span className="cx-an-pic"><T.icon size={14} /></span>
            <div><em>{T.label} · baru saja</em><b>{title || "Judul notifikasi"}</b><p>{body || "Isi pesan akan tampil di sini."}</p></div>
          </div>

          <div className="cx-an-label" style={{ marginTop: 14 }}>Riwayat terkirim</div>
          <div className="cx-an-hist">
            {history.map((h, i) => {
              const ht = TYPES.find((x) => x.key === h.type) || TYPES[0];
              return (
                <div key={i} className={`cx-an-h t-${h.type}`}>
                  <ht.icon size={12} />
                  <div><b>{h.title}</b><small>{h.recipients > 1 ? `${h.recipients} user` : (h.toName || h.toEmail || "1 user")} · dibaca {h.readCount}/{h.recipients} · {ago(h.createdAt)}</small></div>
                </div>
              );
            })}
            {!history.length && <p className="cx-an-empty">Belum ada pesan terkirim.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
