import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldAlert, Save, Ban, Check, Plus, Minus, History, Flame, Users, Sparkles } from "lucide-react";
import { jsonRequest } from "./main.jsx";
import { CoinIcon, FlameIcon } from "./checkin.jsx";
import "./checkin.css";

const fmt = (n) => Number(n || 0).toLocaleString("id-ID");
const API = "/api/admin/users?action=checkin";

export default function AdminCheckinPage({ onNotice }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await jsonRequest(API, { method: "GET" });
      setData(res);
      setSettings(res.settings);
    } catch (e) { onNotice && onNotice(e.message || "Gagal memuat", "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const post = (body) => jsonRequest(API, { method: "POST", body: JSON.stringify(body) });

  const saveSettings = async () => {
    setSaving(true);
    try { await post({ op: "settings", settings }); onNotice && onNotice("Pengaturan check-in disimpan"); load(); }
    catch (e) { onNotice && onNotice(e.message, "error"); }
    setSaving(false);
  };

  const act = async (body, msg) => {
    try { await post(body); onNotice && onNotice(msg); load(); }
    catch (e) { onNotice && onNotice(e.message, "error"); }
  };

  const users = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.users.filter((u) => {
      if (s && !`${u.name} ${u.email}`.toLowerCase().includes(s)) return false;
      if (filter === "today") return u.lastDay === data.today;
      if (filter === "streak") return u.streak > 0;
      if (filter === "blocked") return u.blocked;
      if (filter === "points") return u.points > 0;
      return true;
    });
  }, [data, q, filter]);

  const openLedger = async (u) => {
    setModal({ user: u, ledger: null });
    try { const r = await post({ op: "ledger", userId: u.id }); setModal({ user: u, ledger: r.ledger }); }
    catch (e) { onNotice && onNotice(e.message, "error"); setModal(null); }
  };

  const analyze = async (u) => {
    setModal({ user: u, ledger: null, ai: { loading: true } });
    try {
      const [l, a] = await Promise.all([post({ op: "ledger", userId: u.id }), post({ op: "analyze", userId: u.id })]);
      setModal({ user: u, ledger: l.ledger, ai: a });
    } catch (e) {
      setModal((m) => m && { ...m, ai: { error: e.message || "Analisis AI gagal" } });
      try { const l = await post({ op: "ledger", userId: u.id }); setModal((m) => m && { ...m, ledger: l.ledger }); } catch (_) {}
    }
  };

  const adjust = (u, sign) => {
    const v = window.prompt(`${sign > 0 ? "Tambah" : "Kurangi"} poin untuk ${u.email}:`, "100");
    if (!v) return;
    const n = Math.abs(parseInt(v, 10));
    if (!n) return;
    const note = window.prompt("Catatan (opsional):", sign > 0 ? "Bonus dari admin" : "Koreksi admin") || "";
    act({ op: "adjust", userId: u.id, delta: n * sign, note }, "Poin diperbarui");
  };
  const setStreak = (u) => {
    const v = window.prompt(`Atur streak ${u.email}:`, String(u.streak));
    if (v === null) return;
    act({ op: "streak", userId: u.id, streak: parseInt(v, 10) || 0 }, "Streak diperbarui");
  };

  return (
    <div className="ci-admin">
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Pantau check-in harian & poin user {data ? `· ${data.today} WIB` : ""}</div>
          <h1>Check-in Point</h1>
        </div>
        <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={12} className={loading ? "cx-spin" : ""} /> Muat ulang
        </button>
      </div>

      {data && (
        <div className="ci-admin-kpis">
          <div className="ci-admin-kpi"><Users size={20} color="#c084fc" /><div><strong>{fmt(data.stats.todayCount)}</strong><small>Check-in hari ini</small></div></div>
          <div className="ci-admin-kpi"><CoinIcon size={22} /><div><strong>{fmt(data.stats.todayPoints)}</strong><small>Poin dibagikan hari ini</small></div></div>
          <div className="ci-admin-kpi"><FlameIcon size={22} /><div><strong>{fmt(data.stats.activeStreaks)}</strong><small>Streak aktif</small></div></div>
          <div className="ci-admin-kpi"><CoinIcon size={22} /><div><strong>{fmt(data.stats.circulating)}</strong><small>Poin beredar</small></div></div>
          <div className="ci-admin-kpi"><Check size={20} color="#86efac" /><div><strong>{fmt(data.stats.spent)}</strong><small>Poin ditukar</small></div></div>
        </div>
      )}

      {settings && (
        <div className="ci-admin-box">
          <h3>Hadiah & aturan</h3>
          <div className="ci-admin-rewards">
            {settings.rewards.map((r, i) => (
              <label key={i}>Hari {i + 1}
                <input type="number" min="0" value={r} onChange={(e) => setSettings((s) => ({ ...s, rewards: s.rewards.map((x, j) => (j === i ? e.target.value : x)) }))} />
              </label>
            ))}
          </div>
          <div className="ci-admin-row">
            <label>Nilai 1 poin (Rp)
              <input type="number" min="0.01" step="0.01" value={settings.pointValue} onChange={(e) => setSettings((s) => ({ ...s, pointValue: e.target.value }))} />
            </label>
            <label>Maks check-in per jaringan/24 jam
              <input type="number" min="1" value={settings.ipDailyLimit} onChange={(e) => setSettings((s) => ({ ...s, ipDailyLimit: e.target.value }))} />
            </label>
            <label className="ci-admin-toggle"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))} /> Check-in aktif</label>
            <label className="ci-admin-toggle"><input type="checkbox" checked={settings.redeemEnabled} onChange={(e) => setSettings((s) => ({ ...s, redeemEnabled: e.target.checked }))} /> Tukar poin aktif</label>
            <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={saveSettings} disabled={saving}><Save size={12} /> {saving ? "Menyimpan..." : "Simpan"}</button>
          </div>
        </div>
      )}

      {data && data.suspicious.length > 0 && (
        <div className="ci-admin-box">
          <h3><ShieldAlert size={13} color="#fda4af" /> Deteksi multi-akun (7 hari)</h3>
          <table className="ci-admin-table"><tbody>
            {data.suspicious.map((s) => (
              <tr key={s.ipHash}><td><span className="ci-pill warn">{s.accounts} akun · 1 jaringan</span></td><td>{(s.emails || []).join(", ")}</td></tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="ci-admin-box">
        <h3>Progres user</h3>
        <div className="ci-admin-row" style={{ marginTop: 0, marginBottom: 10 }}>
          <label style={{ flex: 2 }}><span style={{ display: "flex", gap: 4, alignItems: "center" }}><Search size={10} /> Cari</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nama atau email" />
          </label>
          <div className="ci-admin-actions">
            {[["all", "Semua"], ["today", "Hari ini"], ["streak", "Streak aktif"], ["points", "Punya poin"], ["blocked", "Diblokir"]].map(([k, l]) => (
              <button key={k} className={`cx-btn cx-btn-sm ${filter === k ? "cx-btn-primary" : "cx-btn-ghost"}`} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ci-admin-scroll ci-admin-progress-scroll">
          <table className="ci-admin-table ci-admin-progress-table">
            <thead><tr><th>User</th><th>Poin</th><th>Streak</th><th>Terakhir</th><th>Total</th><th>Aksi</th></tr></thead>
            <tbody>
              {users.slice(0, 200).map((u) => (
                <tr key={u.id} className={u.blocked ? "is-blocked" : ""}>
                  <td className="ci-admin-user"><strong>{u.name}</strong><small>{u.email}</small></td>
                  <td><strong style={{ color: "#fde68a" }}>{fmt(u.points)}</strong></td>
                  <td><span className="ci-pill"><Flame size={10} /> {u.streak} <small>(best {u.bestStreak})</small></span></td>
                  <td>{u.lastDay || "-"}</td>
                  <td><small>{fmt(u.totalCheckins)}x · +{fmt(u.totalEarned)} / -{fmt(u.totalSpent)}</small></td>
                  <td>
                    <div className="ci-admin-actions">
                      <button className="cx-btn cx-btn-ghost cx-btn-sm" title="Tambah poin" onClick={() => adjust(u, 1)}><Plus size={11} /></button>
                      <button className="cx-btn cx-btn-ghost cx-btn-sm" title="Kurangi poin" onClick={() => adjust(u, -1)}><Minus size={11} /></button>
                      <button className="cx-btn cx-btn-ghost cx-btn-sm" title="Atur streak" onClick={() => setStreak(u)}><Flame size={11} /></button>
                      <button className="cx-btn cx-btn-ghost cx-btn-sm" title="Riwayat" onClick={() => openLedger(u)}><History size={11} /></button>
                      <button className="cx-btn cx-btn-ghost cx-btn-sm" title="Analisis AI pola mencurigakan" onClick={() => analyze(u)}><Sparkles size={11} color="#c084fc" /></button>
                      <button className={`cx-btn cx-btn-sm ${u.blocked ? "cx-btn-secondary" : "cx-btn-danger"}`} title={u.blocked ? "Buka blokir" : "Blokir check-in"}
                        onClick={() => act({ op: "block", userId: u.id, blocked: !u.blocked }, u.blocked ? "Blokir dibuka" : "User diblokir dari check-in")}>
                        {u.blocked ? <Check size={11} /> : <Ban size={11} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>{loading ? "Memuat..." : "Tidak ada data"}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {data && (
        <div className="ci-admin-box">
          <h3>Check-in terbaru</h3>
          <div className="ci-admin-scroll"><table className="ci-admin-table ci-admin-recent-table"><tbody>
            {data.recent.map((r, i) => (
              <tr key={i}><td className="ci-admin-user"><strong>{r.name}</strong><small>{r.email}</small></td><td>Hari ke-{r.streak}</td><td style={{ color: "#86efac" }}>+{fmt(r.reward)}</td><td><small>{new Date(r.createdAt).toLocaleString("id-ID")}</small></td></tr>
            ))}
          </tbody></table></div>
        </div>
      )}

      {modal && (
        <div className="ci-admin-modal" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{modal.ai ? "Analisis AI" : "Riwayat poin"} · {modal.user.email}</h3>
            {modal.ai && (
              <div className="ci-ai-box">
                {modal.ai.loading ? <p><Sparkles size={12} className="cx-spin" /> AI sedang menilai riwayat check-in & poin...</p>
                  : modal.ai.error ? <p style={{ color: "#fda4af" }}>{modal.ai.error}</p>
                  : (
                    <>
                      <div className="ci-ai-head">
                        <span className="ci-ai-score">{modal.ai.analysis.score}/100</span>
                        <span className={`ci-ai-risk ${modal.ai.analysis.risk}`}>Risiko {({ low: "rendah", medium: "sedang", high: "tinggi" })[modal.ai.analysis.risk]}</span>
                        <small style={{ color: "var(--muted)" }}>{modal.ai.stats.checkins} check-in · {modal.ai.stats.activities} aktivitas poin dinilai</small>
                      </div>
                      <p>{modal.ai.analysis.summary}</p>
                      <ul>{modal.ai.analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                      <p><strong>Saran:</strong> {modal.ai.analysis.recommendation}</p>
                    </>
                  )}
              </div>
            )}
            {!modal.ledger ? <p>Memuat...</p> : !modal.ledger.length ? <p style={{ color: "var(--muted)" }}>Belum ada riwayat</p> : (
              <table className="ci-admin-table"><tbody>
                {modal.ledger.map((l, i) => (
                  <tr key={i}><td>{l.reason}</td><td><small>{l.note}</small></td><td style={{ color: l.delta >= 0 ? "#86efac" : "#fda4af" }}>{l.delta >= 0 ? "+" : ""}{fmt(l.delta)}</td><td><small>{new Date(l.createdAt).toLocaleString("id-ID")}</small></td></tr>
                ))}
              </tbody></table>
            )}
            <button className="cx-btn cx-btn-secondary cx-btn-sm" style={{ marginTop: 10 }} onClick={() => setModal(null)}>Tutup</button>
          </div>
        </div>
      )}
    </div>
  );
}
