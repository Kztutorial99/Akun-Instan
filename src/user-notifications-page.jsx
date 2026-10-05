import { useEffect, useState } from "react";
import { Bell, BellRing, CheckCheck, Megaphone, MessageSquareText, Package, RefreshCw, ShieldAlert, Trash2, Wallet, Gift } from "lucide-react";
import { jsonRequest } from "./main.jsx";

const KIND = {
  admin_msg: ["Pesan Admin", MessageSquareText, "msg"],
  admin_info: ["Info", Megaphone, "info"],
  admin_promo: ["Promo", Gift, "promo"],
  admin_warn: ["Penting", ShieldAlert, "warn"],
  stock_available: ["Stok", Package, "info"],
};
const kindOf = (t = "") => KIND[t] || (t.includes("topup") ? ["Top Up", Wallet, "ok"] : t.includes("order") ? ["Pesanan", Package, "ok"] : ["Info", Bell, "info"]);
const ago = (iso) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!(d >= 0)) return "-";
  if (d < 60) return "baru saja";
  if (d < 3600) return `${Math.floor(d / 60)} mnt`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam`;
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
};

export default function UserNotificationsPage({ guest, onLogin, navigate }) {
  const [items, setItems] = useState(null);
  const [unread, setUnread] = useState(0);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true); setErr("");
    const t = Date.now();
    try {
      const p = await jsonRequest("/api/notifications?all=1");
      setItems(p.notifications || []); setUnread(Number(p.unread) || 0);
    } catch (e) { setErr(e.message || "Gagal memuat"); setItems((x) => x || []); }
    setTimeout(() => setLoading(false), Math.max(0, 600 - (Date.now() - t)));
  };
  useEffect(() => {
    if (guest) return;
    setUnread(0);
    window.dispatchEvent(new Event("codexa:notify"));
    jsonRequest("/api/notifications", { method: "PATCH", body: JSON.stringify({}) })
      .then(() => load())
      .catch(() => load());
  }, [guest]);

  const markAll = async () => {
    try { await jsonRequest("/api/notifications", { method: "PATCH", body: JSON.stringify({}) }); } catch (_) {}
    setItems((l) => (l || []).map((n) => ({ ...n, read: true }))); setUnread(0);
    window.dispatchEvent(new Event("codexa:notify"));
  };
  const openItem = async (n) => {
    setOpenId(openId === n.id ? "" : n.id);
    if (!n.read) {
      try { await jsonRequest("/api/notifications", { method: "PATCH", body: JSON.stringify({ id: n.id }) }); } catch (_) {}
      setItems((l) => l.map((x) => (x.id === n.id ? { ...x, read: true } : x))); setUnread((u) => Math.max(0, u - 1));
      window.dispatchEvent(new Event("codexa:notify"));
    }
  };
  const remove = async (n) => {
    try { await jsonRequest("/api/notifications", { method: "DELETE", body: JSON.stringify({ id: n.id }) }); } catch (_) {}
    setItems((l) => l.filter((x) => x.id !== n.id));
    window.dispatchEvent(new Event("codexa:notify"));
  };

  if (guest) return (
    <main className="cx-container cx-nf">
      <div className="cx-ur-empty"><Bell size={20} /><p>Masuk dulu untuk melihat notifikasi.</p>
        <button className="cx-btn cx-btn-primary" onClick={onLogin}>Masuk</button></div>
    </main>
  );

  const list = (items || []).filter((n) => tab === "all" || (tab === "unread" ? !n.read : String(n.type).startsWith("admin_")));

  return (
    <main className="cx-container cx-nf">
      <div className="cx-nf-hero">
        <div className="cx-nf-hero-ic"><BellRing size={18} /></div>
        <div className="cx-nf-hero-tx">
          <h1>Notifikasi</h1>
          <p>{unread > 0 ? <><b>{unread}</b> belum dibaca</> : "Semua sudah dibaca"}</p>
        </div>
        <button className={`cx-icon-btn${loading ? " is-spinning" : ""}`} onClick={load} disabled={loading} aria-label="Muat ulang"><RefreshCw size={14} /></button>
      </div>

      <div className="cx-nf-bar">
        <div className="cx-ur-filters">
          {[["all", "Semua"], ["unread", "Belum dibaca"], ["admin", "Dari Admin"]].map(([k, l]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {unread > 0 && <button className="cx-nf-mark" onClick={markAll}><CheckCheck size={12} /> Tandai dibaca</button>}
      </div>

      {err && <div className="cx-ai-error">{err}</div>}
      {items === null && <div className="cx-ur-empty"><RefreshCw size={16} className="cx-spin" /><p>Memuat...</p></div>}
      {items && !list.length && <div className="cx-ur-empty"><Bell size={20} /><p>Belum ada notifikasi.</p></div>}

      <div className="cx-nf-list">
        {list.map((n) => {
          const [label, Icon, tone] = kindOf(n.type);
          const open = openId === n.id;
          return (
            <article key={n.id} className={`cx-nf-item tone-${tone}${n.read ? "" : " unread"}${open ? " open" : ""}`}>
              <button type="button" className="cx-nf-main" onClick={() => openItem(n)}>
                <span className="cx-nf-ic"><Icon size={14} /></span>
                <span className="cx-nf-tx">
                  <span className="cx-nf-meta"><em>{label}</em><small>{ago(n.createdAt)}</small></span>
                  <b>{n.title}</b>
                  {n.body && <span className={`cx-nf-body${open ? " full" : ""}`}>{n.body}</span>}
                </span>
                {!n.read && <i className="cx-nf-dot" />}
              </button>
              {open && (
                <div className="cx-nf-acts">
                  {n.link && navigate && <button onClick={() => navigate(n.link)}>Buka</button>}
                  <button className="del" onClick={() => remove(n)}><Trash2 size={11} /> Hapus</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}
