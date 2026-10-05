import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, PackagePlus, Plus, RefreshCw, ShieldAlert, Tag, Trash2 } from "lucide-react";
import { jsonRequest } from "./main.jsx";

const api = (resource, options = {}) => jsonRequest(`/api/admin/settings?resource=${resource}`, options);

const STATUS = {
  ACTIVE: { label: "ACTIVE", color: "#22c55e", bg: "rgba(34,197,94,.14)" },
  SUSPENDED: { label: "SUSPENDED", color: "#ef4444", bg: "rgba(239,68,68,.14)" },
  SOLD: { label: "TERJUAL", color: "#94a3b8", bg: "rgba(148,163,184,.14)" },
};

const when = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" }) : "-");

export default function GoogleChecker({ onNotice }) {
  const [data, setData] = useState({ configured: true, accounts: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [stockFor, setStockFor] = useState(null);
  const [form, setForm] = useState({ password: "", listingId: "", price: "", newTitle: "" });
  const autoOpened = useRef(false);

  const notify = useCallback((msg) => onNotice && onNotice(msg), [onNotice]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api("gchecker")); } catch (e) { notify(e.message || "Gagal memuat"); }
    setLoading(false);
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const openStock = useCallback((a, listings) => {
    const first = (listings || data.listings || [])[0];
    setForm({ password: "", listingId: first ? first.id : "__new__", price: first ? String(first.price) : "", newTitle: "Akun Google (Gmail) Fresh \u2014 Siap Pakai" });
    setStockFor(a);
  }, [data.listings]);

  // Akun yang baru saja dihubungkan (10 menit terakhir) dan belum masuk stok → langsung tawarkan form.
  useEffect(() => {
    if (autoOpened.current || loading) return;
    const fresh = (data.accounts || []).find((a) => a.status === "ACTIVE" && !a.listingId && Date.now() - new Date(a.createdAt).getTime() < 10 * 60 * 1000);
    if (fresh) { autoOpened.current = true; openStock(fresh, data.listings); }
  }, [data, loading, openStock]);

  const saveStock = () => run("stock", async () => {
    const res = await api("gchecker-stock", { method: "POST", body: JSON.stringify({ id: stockFor.id, ...form }) });
    setData((d) => ({ ...d, accounts: res.accounts, listings: res.listings }));
    notify(`${stockFor.email} masuk ke stok produk`);
    setStockFor(null);
  });

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify(e.message || "Gagal"); }
    setBusy("");
  };

  const connect = () => run("connect", async () => {
    const { url } = await api("gchecker-connect", { method: "POST", body: JSON.stringify({}) });
    window.location.href = url;
  });
  const checkAll = (id) => run(id ? `check-${id}` : "check", async () => {
    const res = await api("gchecker-check", { method: "POST", body: JSON.stringify(id ? { id } : {}) });
    setData((d) => ({ ...d, accounts: res.accounts }));
    notify(`${res.checked} akun selesai dicek`);
  });
  const sold = (a) => {
    if (!window.confirm(`Tandai ${a.email} terjual? Akses sistem ke akun ini akan diputus.`)) return;
    run(`sold-${a.id}`, async () => {
      const res = await api("gchecker-sold", { method: "POST", body: JSON.stringify({ id: a.id }) });
      setData((d) => ({ ...d, accounts: res.accounts }));
    });
  };
  const remove = (a) => {
    if (!window.confirm(`Hapus ${a.email} dari daftar?`)) return;
    run(`del-${a.id}`, async () => {
      const res = await api("gchecker", { method: "DELETE", body: JSON.stringify({ id: a.id }) });
      setData((d) => ({ ...d, accounts: res.accounts }));
    });
  };

  const accounts = data.accounts || [];
  const count = (s) => accounts.filter((a) => a.status === s).length;
  const shown = filter === "ALL" ? accounts : accounts.filter((a) => a.status === filter);

  return (
    <>
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Cek massal status akun Google sebelum dibeli</div>
          <h1>Google Checker</h1>
        </div>
        <div className="cx-admin-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => checkAll()} disabled={!!busy || !accounts.length}>
            {busy === "check" ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Cek semua
          </button>
          <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={connect} disabled={!!busy || !data.configured}>
            <Plus size={11} /> Hubungkan Gmail
          </button>
        </div>
      </div>

      {!data.configured && (
        <div className="cx-panel" style={{ padding: 14, marginBottom: 12, color: "#f59e0b" }}>
          Client ID / Client Secret Google belum diatur di server.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2, scrollbarWidth: "none" }}>
        {[["ALL", `Semua (${accounts.length})`], ["ACTIVE", `Active (${count("ACTIVE")})`], ["SUSPENDED", `Suspended (${count("SUSPENDED")})`], ["SOLD", `Terjual (${count("SOLD")})`]].map(([k, l]) => (
          <button key={k} className={`cx-btn cx-btn-sm ${filter === k ? "cx-btn-primary" : "cx-btn-secondary"}`} onClick={() => setFilter(k)} style={{ flex: "none", borderRadius: 999 }}>{l}</button>
        ))}
      </div>

      <div className="cx-panel" style={{ padding: 0, overflow: "hidden" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}><Loader2 size={16} className="spin" /></div>
        ) : !shown.length ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--faint)", fontSize: 12 }}>Belum ada akun. Ketuk "Hubungkan Gmail" lalu login ke akun yang mau dijual.</div>
        ) : shown.map((a, i) => {
          const s = STATUS[a.status] || STATUS.ACTIVE;
          return (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderTop: i ? "1px solid var(--line, rgba(255,255,255,.08))" : "none" }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: s.color, flex: "none", boxShadow: `0 0 0 3px ${s.bg}` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.email}</div>
                <div style={{ fontSize: 10, color: "var(--faint)", display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                  <span style={{ color: s.color, fontWeight: 700 }}>{s.label}</span>
                  <span>{a.status === "SOLD" ? `Terjual ${when(a.soldAt)}` : `Dicek ${when(a.lastChecked)}`}</span>
                  {a.listingTitle && a.status !== "SOLD" && <span style={{ color: "#22c55e" }}>Di stok</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flex: "none" }}>
                {a.status !== "SOLD" && <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Cek" aria-label="Cek" onClick={() => checkAll(a.id)} disabled={!!busy}>{busy === `check-${a.id}` ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}</button>}
                {a.status === "ACTIVE" && !a.listingId && <button className="cx-btn cx-btn-primary cx-btn-sm" title="Masukkan ke stok" aria-label="Masukkan ke stok" onClick={() => openStock(a)} disabled={!!busy}><PackagePlus size={12} /></button>}
                {a.status !== "SOLD" && <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Tandai terjual" aria-label="Tandai terjual" onClick={() => sold(a)} disabled={!!busy}><Tag size={12} /></button>}
                <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Hapus" aria-label="Hapus" onClick={() => remove(a)} disabled={!!busy}><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>Semua akun dicek otomatis setiap hari pukul 09.00 WIB. Akun SUSPENDED otomatis ditarik dari stok, akun yang dibeli otomatis jadi TERJUAL.</p>

      {stockFor && (
        <div onClick={() => setStockFor(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "grid", placeItems: "center", zIndex: 100, padding: 16 }}>
          <div className="cx-panel" onClick={(e) => e.stopPropagation()} style={{ padding: 18, width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", display: "grid", gap: 10, borderRadius: 16 }}>
            <h3 style={{ margin: 0 }}>Masukkan ke stok produk</h3>
            <label style={{ fontSize: 12 }}>Email<input className="cx-input" value={stockFor.email} readOnly style={{ width: "100%" }} /></label>
            <label style={{ fontSize: 12 }}>Password (dikirim ke pembeli)<input className="cx-input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ width: "100%" }} autoFocus /></label>
            <label style={{ fontSize: 12 }}>Produk Google
              <select className="cx-input" value={form.listingId} style={{ width: "100%" }} onChange={(e) => { const l = (data.listings || []).find((x) => x.id === e.target.value); setForm({ ...form, listingId: e.target.value, price: l ? String(l.price) : form.price }); }}>
                {(data.listings || []).map((l) => <option key={l.id} value={l.id}>{l.title} (stok {l.stock})</option>)}
                <option value="__new__">+ Buat produk Google baru otomatis</option>
              </select>
            </label>
            {form.listingId === "__new__" && <label style={{ fontSize: 12 }}>Nama produk baru<input className="cx-input" value={form.newTitle} onChange={(e) => setForm({ ...form, newTitle: e.target.value })} style={{ width: "100%" }} /></label>}
            <label style={{ fontSize: 12 }}>Harga (Rp)<input className="cx-input" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, "") })} style={{ width: "100%" }} /></label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => setStockFor(null)}>Nanti</button>
              <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={saveStock} disabled={busy === "stock" || !form.password || !form.listingId || (form.listingId === "__new__" && !form.price)}>{busy === "stock" ? <Loader2 size={11} className="spin" /> : <PackagePlus size={11} />} Simpan ke stok</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
