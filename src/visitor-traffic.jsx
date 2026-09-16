import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Globe2, Laptop, Loader2, MonitorSmartphone, RefreshCw, Users, Eye,
} from "lucide-react";
import { jsonRequest } from "./main.jsx";

const RANGES = [
  { key: 1,  label: "24 jam" },
  { key: 7,  label: "7 hari" },
  { key: 30, label: "30 hari" },
  { key: 90, label: "90 hari" },
];

const DEVICE_LABEL = { mobile: "Mobile", desktop: "Desktop", tablet: "Tablet", bot: "Bot" };

const compact = (n) => {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}jt`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}rb`;
  return String(v);
};

const timeAgo = (iso) => {
  const t = new Date(iso).getTime();
  if (!t) return "-";
  const diff = Math.max(0, Date.now() - t) / 1000;
  if (diff < 60) return "baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return `${Math.floor(diff / 86400)} hari lalu`;
};

const dayLabel = (day) => {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

function Bars({ series }) {
  const max = Math.max(1, ...series.map((s) => Number(s.views) || 0));
  if (!series.length) return <div className="cx-vt-empty">Belum ada data kunjungan pada rentang ini.</div>;
  return (
    <div className="cx-vt-chart">
      {series.map((s) => (
        <div key={s.day} className="cx-vt-bar-col" title={`${dayLabel(s.day)} · ${s.views} view · ${s.visitors} pengunjung`}>
          <div className="cx-vt-bar-track">
            <div className="cx-vt-bar" style={{ height: `${Math.max(4, ((Number(s.views) || 0) / max) * 100)}%` }} />
          </div>
          <span className="cx-vt-bar-label">{dayLabel(s.day)}</span>
        </div>
      ))}
    </div>
  );
}

function RankList({ title, icon: Icon, rows, total, format }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.views) || 0));
  return (
    <section className="cx-vt-panel">
      <header className="cx-vt-panel-head"><Icon size={12} /> <span>{title}</span></header>
      {rows.length === 0 ? (
        <div className="cx-vt-empty">Belum ada data.</div>
      ) : rows.map((row) => {
        const views = Number(row.views) || 0;
        const pct = total ? Math.round((views / total) * 100) : 0;
        return (
          <div key={row.label} className="cx-vt-rank">
            <div className="cx-vt-rank-fill" style={{ width: `${Math.max(3, (views / max) * 100)}%` }} />
            <span className="cx-vt-rank-label">{format ? format(row.label) : row.label}</span>
            <span className="cx-vt-rank-value">{compact(views)}<em>{pct}%</em></span>
          </div>
        );
      })}
    </section>
  );
}

export default function VisitorTraffic({ onNotice }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (range, quiet) => {
    if (!quiet) setLoading(true);
    try {
      const payload = await jsonRequest(`/api/admin/settings?resource=visits&days=${range}`, { method: "GET" });
      setData(payload);
      setError("");
    } catch (e) {
      setError(e.message || "Data kunjungan gagal dimuat");
      if (onNotice && !quiet) onNotice(e.message || "Data kunjungan gagal dimuat", "error");
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => { load(days); }, [days, load]);
  useEffect(() => {
    const timer = setInterval(() => load(days, true), 60000);
    return () => clearInterval(timer);
  }, [days, load]);

  const totals = (data && data.totals) || {};
  const rangeViews = Number(totals.viewsRange) || 0;
  const cards = useMemo(() => ([
    { label: "Pengunjung online", value: totals.live || 0, hint: "30 menit terakhir", icon: Activity, live: true },
    { label: "Pengunjung 24 jam", value: totals.visitors24h || 0, hint: `${compact(totals.views24h || 0)} halaman dibuka`, icon: Users },
    { label: `Pengunjung ${days} hari`, value: totals.visitorsRange || 0, hint: `${compact(rangeViews)} halaman dibuka`, icon: BarChart3 },
    { label: "Total sepanjang waktu", value: totals.visitorsAll || 0, hint: `${compact(totals.viewsAll || 0)} halaman dibuka`, icon: Eye },
  ]), [totals, days, rangeViews]);

  return (
    <div className="cx-vt">
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Statistik kunjungan akuninstan.com</div>
          <h1>Visitor Traffic</h1>
        </div>
        <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => load(days)} disabled={loading}>
          {loading ? <Loader2 size={11} className="cx-spin" /> : <RefreshCw size={11} />} Muat ulang
        </button>
      </div>

      <div className="cx-vt-ranges">
        {RANGES.map((r) => (
          <button key={r.key} className={`cx-vt-range ${days === r.key ? "active" : ""}`} onClick={() => setDays(r.key)}>
            {r.label}
          </button>
        ))}
      </div>

      {error ? <div className="cx-vt-alert">{error}</div> : null}

      <div className="cx-vt-cards">
        {cards.map(({ label, value, hint, icon: Icon, live }) => (
          <div key={label} className="cx-vt-card">
            <span className="cx-vt-card-top"><Icon size={12} /> {label}{live && value > 0 ? <i className="cx-vt-dot" /> : null}</span>
            <strong>{compact(value)}</strong>
            <small>{hint}</small>
          </div>
        ))}
      </div>

      <section className="cx-vt-panel">
        <header className="cx-vt-panel-head"><BarChart3 size={12} /> <span>Kunjungan per hari</span></header>
        <Bars series={(data && data.series) || []} />
      </section>

      <div className="cx-vt-grid">
        <RankList title="Halaman paling dibuka" icon={Eye} rows={(data && data.pages) || []} total={rangeViews} />
        <RankList title="Asal pengunjung" icon={Globe2} rows={(data && data.sources) || []} total={rangeViews}
          format={(l) => (l === "direct" ? "Langsung / ketik URL" : l)} />
        <RankList title="Perangkat" icon={MonitorSmartphone} rows={(data && data.devices) || []} total={rangeViews}
          format={(l) => DEVICE_LABEL[l] || l} />
        <RankList title="Browser" icon={Laptop} rows={(data && data.browsers) || []} total={rangeViews} />
        <RankList title="Negara" icon={Globe2} rows={(data && data.countries) || []} total={rangeViews} />
      </div>

      <section className="cx-vt-panel">
        <header className="cx-vt-panel-head"><Users size={12} /> <span>Kunjungan terbaru</span></header>
        {!data || !data.recent || data.recent.length === 0 ? (
          <div className="cx-vt-empty">Belum ada kunjungan tercatat.</div>
        ) : (
          <div className="cx-vt-list">
            {data.recent.map((v) => (
              <article key={v.id} className="cx-vt-item">
                <div className="cx-vt-item-head">
                  <span className="cx-vt-path">{v.path}</span>
                  <span className="cx-vt-time">{timeAgo(v.createdAt)}</span>
                </div>
                <div className="cx-vt-meta">
                  <span>{DEVICE_LABEL[v.device] || v.device}</span>
                  <span>{v.browser || "-"}</span>
                  <span>{v.os || "-"}</span>
                  <span>{[v.city, v.country].filter(Boolean).join(", ") || "Lokasi tidak diketahui"}</span>
                  <span>{v.source === "direct" ? "Langsung" : v.source}</span>
                  {v.email ? <span className="cx-vt-user">{v.email}</span> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="cx-vt-note">
        Data dikumpulkan anonim: alamat IP hanya disimpan dalam bentuk hash, kunjungan ke halaman admin dan bot tidak dihitung.
      </p>
    </div>
  );
}
