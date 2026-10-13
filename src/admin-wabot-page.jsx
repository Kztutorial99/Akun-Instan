import { useEffect, useState } from "react";
import { MessageCircle, RefreshCw, Link2, LogOut, Copy, Power } from "lucide-react";
import { jsonRequest } from "./main.jsx";

const API = "/api/admin/settings?resource=wabot";
const STATUS = {
  online: ["Online", "var(--green)"],
  pairing: ["Menunggu pairing", "var(--indigo)"],
  connecting: ["Menyambung...", "var(--muted)"],
  offline: ["Offline", "var(--faint)"],
};

export default function AdminWabotPage({ onNotice }) {
  const [data, setData] = useState(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const notice = (m, t) => onNotice && onNotice(m, t);

  const load = async () => {
    try { setData(await jsonRequest(`${API}&op=status`, { method: "GET" })); }
    catch (e) { setData((d) => ({ ...(d || {}), status: "offline", error: e.message })); }
  };
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const act = async (op, body, msg) => {
    setBusy(true);
    try { await jsonRequest(`${API}&op=${op}`, { method: "POST", body: JSON.stringify(body || {}) }); if (msg) notice(msg); await load(); }
    catch (e) { notice(e.message, "error"); }
    setBusy(false);
  };

  const st = (data && data.status) || "offline";
  const [label, color] = STATUS[st] || STATUS.offline;

  return (
    <div className="cx-wabot">
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Balas chat pembeli otomatis pakai AI</div>
          <h1>Bot WhatsApp</h1>
        </div>
        <div className="cx-admin-actions">
          <button className="cx-btn" onClick={load}><RefreshCw size={14} /> Muat ulang</button>
        </div>
      </div>

      {data && data.configured === false && (
        <div className="cx-wabot-card">
          <b>Bot belum disambungkan ke website.</b>
          <p className="cx-wabot-muted">Isi WA_BOT_URL dan WA_BOT_TOKEN di Vercel setelah bot jalan di Railway.</p>
        </div>
      )}

      <div className="cx-wabot-card">
        <div className="cx-wabot-row">
          <MessageCircle size={18} />
          <span className="cx-wabot-dot" style={{ background: color }} />
          <b>{label}</b>
          {data && data.number ? <span className="cx-wabot-muted">+{data.number}</span> : null}
          <span className="cx-wabot-muted" style={{ marginLeft: "auto" }}>{(data && data.replied) || 0} dibalas</span>
        </div>

        {st !== "online" && data && data.configured !== false && (
          <div className="cx-wabot-pair">
            <input inputMode="tel" placeholder="Nomor WA bot, contoh 08123456789" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <button className="cx-btn primary" disabled={busy || !phone} onClick={() => act("pair", { phone })}><Link2 size={14} /> Minta pairing code</button>
          </div>
        )}

        {data && data.pairingCode ? (
          <div className="cx-wabot-code">
            <span>{data.pairingCode}</span>
            <button className="cx-btn" onClick={() => { navigator.clipboard.writeText(data.pairingCode.replace(/-/g, "")); notice("Kode disalin"); }}><Copy size={14} /> Salin</button>
            <p className="cx-wabot-muted">WhatsApp → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon. Berlaku 1 menit.</p>
          </div>
        ) : null}

        {st === "online" && (
          <div className="cx-wabot-pair">
            <button className="cx-btn" disabled={busy} onClick={() => act("settings", { enabled: !data.enabled }, data.enabled ? "Balasan AI dimatikan" : "Balasan AI dinyalakan")}>
              <Power size={14} /> {data.enabled ? "Matikan balasan AI" : "Nyalakan balasan AI"}
            </button>
            <button className="cx-btn danger" disabled={busy} onClick={() => confirm("Putuskan bot dari WhatsApp?") && act("logout", {}, "Bot diputus")}><LogOut size={14} /> Putuskan</button>
          </div>
        )}
      </div>

      <div className="cx-wabot-card">
        <b>Aktivitas terbaru</b>
        <div className="cx-wabot-logs">
          {(data && data.logs && data.logs.length) ? data.logs.map((l, i) => (
            <div key={i} className={`cx-wabot-log is-${l.type}`}>
              <small>{new Date(l.at).toLocaleTimeString("id-ID")} · {l.type === "in" ? `dari ${l.from}` : l.type === "out" ? `ke ${l.to}` : l.type}</small>
              <div>{l.text}</div>
            </div>
          )) : <p className="cx-wabot-muted">Belum ada aktivitas.</p>}
        </div>
      </div>
    </div>
  );
}
