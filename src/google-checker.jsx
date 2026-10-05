import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, RefreshCw, ShieldAlert, Tag, Trash2 } from "lucide-react";
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

  const notify = useCallback((msg) => onNotice && onNotice(msg), [onNotice]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api("gchecker")); } catch (e) { notify(e.message || "Gagal memuat"); }
    setLoading(false);
  }, [notify]);

  useEffect(() => { load(); }, [load]);

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
        <div className="cx-admin-actions">
          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => checkAll()} disabled={!!busy || !accounts.length}>
            {busy === "check" ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />} Cek semua
          </button>
          <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={connect} disabled={!!busy || !data.configured}>
            <Plus size={11} /> Hubungkan akun Gmail
          </button>
        </div>
      </div>

      {!data.configured && (
        <div className="cx-panel" style={{ padding: 14, marginBottom: 12, color: "#f59e0b" }}>
          Client ID / Client Secret Google belum diatur di server.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {[["ALL", `Semua (${accounts.length})`], ["ACTIVE", `Active (${count("ACTIVE")})`], ["SUSPENDED", `Suspended (${count("SUSPENDED")})`], ["SOLD", `Terjual (${count("SOLD")})`]].map(([k, l]) => (
          <button key={k} className={`cx-btn cx-btn-sm ${filter === k ? "cx-btn-primary" : "cx-btn-secondary"}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      <div className="cx-panel" style={{ overflowX: "auto" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}><Loader2 size={16} className="spin" /></div>
        ) : !shown.length ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--faint)" }}>Belum ada akun. Klik "Hubungkan akun Gmail" lalu login ke akun yang mau dijual.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--faint)" }}>
                <th style={{ padding: 10 }}>Email</th><th style={{ padding: 10 }}>Status</th>
                <th style={{ padding: 10 }}>Terakhir dicek</th><th style={{ padding: 10, textAlign: "right" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const s = STATUS[a.status] || STATUS.ACTIVE;
                return (
                  <tr key={a.id} style={{ borderTop: "1px solid var(--line, rgba(255,255,255,.08))" }}>
                    <td style={{ padding: 10, wordBreak: "break-all" }}>{a.email}{a.lastError && a.status !== "SOLD" ? <div style={{ color: "var(--faint)", fontSize: 10 }}>{a.lastError}</div> : null}</td>
                    <td style={{ padding: 10 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, fontWeight: 700, fontSize: 10, color: s.color, background: s.bg }}>
                        {a.status === "SUSPENDED" ? <ShieldAlert size={10} /> : <CheckCircle2 size={10} />} {s.label}
                      </span>
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>{a.status === "SOLD" ? `Terjual ${when(a.soldAt)}` : when(a.lastChecked)}</td>
                    <td style={{ padding: 10, textAlign: "right", whiteSpace: "nowrap" }}>
                      {a.status !== "SOLD" && (
                        <>
                          <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Cek" onClick={() => checkAll(a.id)} disabled={!!busy}>{busy === `check-${a.id}` ? <Loader2 size={11} className="spin" /> : <RefreshCw size={11} />}</button>{" "}
                          <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Tandai terjual" onClick={() => sold(a)} disabled={!!busy}><Tag size={11} /></button>{" "}
                        </>
                      )}
                      <button className="cx-btn cx-btn-secondary cx-btn-sm" title="Hapus" onClick={() => remove(a)} disabled={!!busy}><Trash2 size={11} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ color: "var(--faint)", fontSize: 11, marginTop: 10 }}>Semua akun dicek otomatis setiap hari pukul 09.00 WIB.</p>
    </>
  );
}
