import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, ShieldAlert, Save, Ban, Check, History, Users, Sparkles, X, RotateCcw, Pencil, Settings2, Trash2, TrendingUp } from "lucide-react";
import { jsonRequest } from "./main.jsx";
import { CoinIcon, FlameIcon } from "./checkin.jsx";
import "./checkin.css";

const fmt = (n) => Number(n || 0).toLocaleString("id-ID");
const API = "/api/admin/users?action=checkin";
const initial = (s) => String(s || "?").trim().charAt(0).toUpperCase();

export default function AdminCheckinPage({ onNotice }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState(null);
  const notice = (m, t = "success") => {
    const id = Date.now();
    setToast({ id, m, t });
    setTimeout(() => setToast((x) => (x && x.id === id ? null : x)), 3200);
  };
  const load = async () => {
    setLoading(true);
    try { const res = await jsonRequest(API, { method: "GET" }); setData(res); setSettings(res.settings); }
    catch (e) { notice(e.message || "Gagal memuat", "error"); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const post = (body) => jsonRequest(API, { method: "POST", body: JSON.stringify(body) });
  const act = async (body, msg, close) => {
    setBusy(true);
    try { await post(body); notice(msg); if (close) setEdit(null); await load(); }
    catch (e) { notice(e.message, "error"); }
    setBusy(false);
  };

  const saveSettings = async () => {
    setSaving(true);
    try { await post({ op: "settings", settings }); notice("Pengaturan check-in disimpan"); load(); }
    catch (e) { notice(e.message, "error"); }
    setSaving(false);
  };

  // Sinkronkan data user di modal edit setelah reload.
  useEffect(() => {
    if (!edit || !data) return;
    const u = data.users.find((x) => x.id === edit.user.id);
    if (u && u !== edit.user) setEdit((e) => e && { ...e, user: u });
  }, [data]);

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

  const openLedger = async (u, withAi) => {
    setModal({ user: u, ledger: null, ai: withAi ? { loading: true } : null });
    try {
      const l = await post({ op: "ledger", userId: u.id });
      setModal((m) => m && { ...m, ledger: l.ledger });
      if (withAi) {
        try { const a = await post({ op: "analyze", userId: u.id }); setModal((m) => m && { ...m, ai: a }); }
        catch (e) { setModal((m) => m && { ...m, ai: { error: e.message || "Analisis AI gagal" } }); }
      }
    } catch (e) { notice(e.message, "error"); setModal(null); }
  };

  const openEdit = (u) => setEdit({ user: u, points: String(u.points), amount: "100", streak: String(u.streak), note: "" });

  const confirmDo = (msg, body, ok) => { if (window.confirm(msg)) act(body, ok); };

  const kpis = data ? [
    { icon: <Users size={18} />, tone: "violet", v: data.stats.todayCount, l: "Check-in hari ini" },
    { icon: <CoinIcon size={18} />, tone: "gold", v: data.stats.todayPoints, l: "Poin dibagikan hari ini" },
    { icon: <FlameIcon size={18} />, tone: "orange", v: data.stats.activeStreaks, l: "Streak aktif" },
    { icon: <TrendingUp size={18} />, tone: "blue", v: data.stats.circulating, l: "Poin beredar" },
    { icon: <Check size={18} />, tone: "green", v: data.stats.spent, l: "Poin ditukar" },
  ] : [];

  return (
    <div className="ci-admin cia">
      {toast && (
        <div className={`cia-toast ${toast.t === "error" ? "is-error" : "is-ok"}`} role="status" onClick={() => setToast(null)}>
          <span className="cia-toast-ic">{toast.t === "error" ? "!" : "\u2713"}</span>
          <span>{toast.t === "error" ? "Gagal: " : "Berhasil: "}{toast.m}</span>
        </div>
      )}
      <header className="cia-hero">
        <div className="cia-hero-text">
          <span className="cia-eyebrow"><Sparkles size={11} /> Program loyalitas</span>
          <h1>Check-in Point</h1>
          <p>{data ? `Data per ${data.today} WIB · ${fmt(data.users.length)} user` : "Memuat data..."}</p>
        </div>
        <div className="cia-hero-actions">
          <button className="cia-icon-btn" onClick={() => setShowSettings((v) => !v)} title="Pengaturan"><Settings2 size={16} /></button>
          <button className="cia-icon-btn" onClick={load} disabled={loading} title="Muat ulang"><RefreshCw size={16} className={loading ? "cx-spin" : ""} /></button>
        </div>
      </header>

      {data && (
        <div className="cia-kpis">
          {kpis.map((k, i) => (
            <div key={i} className={`cia-kpi tone-${k.tone}`}>
              <span className="cia-kpi-icon">{k.icon}</span>
              <strong>{fmt(k.v)}</strong>
              <small>{k.l}</small>
            </div>
          ))}
        </div>
      )}

      {settings && showSettings && (
        <section className="cia-card">
          <div className="cia-card-head"><h3><Settings2 size={14} /> Hadiah & aturan</h3></div>
          <div className="cia-rewards">
            {settings.rewards.map((r, i) => (
              <label key={i} className={i === 6 ? "is-big" : ""}><span>Hari {i + 1}</span>
                <input type="number" min="0" value={r} onChange={(e) => setSettings((s) => ({ ...s, rewards: s.rewards.map((x, j) => (j === i ? e.target.value : x)) }))} />
              </label>
            ))}
          </div>
          <div className="cia-settings-grid">
            <label className="cia-field"><span>Nilai 1 poin (Rp)</span>
              <input type="number" min="0.01" step="0.01" value={settings.pointValue} onChange={(e) => setSettings((s) => ({ ...s, pointValue: e.target.value }))} />
            </label>
            <label className="cia-field"><span>Maks akun per jaringan / 24 jam</span>
              <input type="number" min="1" value={settings.ipDailyLimit} onChange={(e) => setSettings((s) => ({ ...s, ipDailyLimit: e.target.value }))} />
            </label>
            <label className="cia-switch"><input type="checkbox" checked={settings.enabled} onChange={(e) => setSettings((s) => ({ ...s, enabled: e.target.checked }))} /><i /> Check-in aktif</label>
            <label className="cia-switch"><input type="checkbox" checked={settings.redeemEnabled} onChange={(e) => setSettings((s) => ({ ...s, redeemEnabled: e.target.checked }))} /><i /> Tukar poin aktif</label>
          </div>
          <button className="cia-btn primary block" onClick={saveSettings} disabled={saving}><Save size={14} /> {saving ? "Menyimpan..." : "Simpan pengaturan"}</button>
        </section>
      )}

      {data && data.suspicious.length > 0 && (
        <section className="cia-card cia-alert">
          <div className="cia-card-head"><h3><ShieldAlert size={14} /> Deteksi multi-akun (7 hari)</h3></div>
          {data.suspicious.map((s) => (
            <div key={s.ipHash} className="cia-alert-row"><span className="cia-tag warn">{s.accounts} akun · 1 jaringan</span><small>{(s.emails || []).join(", ")}</small></div>
          ))}
        </section>
      )}

      <section className="cia-card">
        <div className="cia-card-head"><h3><Users size={14} /> Progres user</h3><span className="cia-count">{fmt(users.length)}</span></div>
        <div className="cia-search"><Search size={14} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama atau email" /></div>
        <div className="cia-chips">
          {[["all", "Semua"], ["today", "Hari ini"], ["streak", "Streak aktif"], ["points", "Punya poin"], ["blocked", "Diblokir"]].map(([k, l]) => (
            <button key={k} className={`cia-chip${filter === k ? " is-on" : ""}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="cia-users">
          {users.slice(0, 200).map((u) => (
            <article key={u.id} className={`cia-user${u.blocked ? " is-blocked" : ""}`}>
              <div className="cia-user-top">
                <span className="cia-avatar">{initial(u.name || u.email)}</span>
                <div className="cia-user-id"><strong>{u.name || "-"}</strong><small>{u.email}</small></div>
                {u.blocked && <span className="cia-tag danger">Diblokir</span>}
              </div>
              <div className="cia-user-stats">
                <div><CoinIcon size={14} /><b>{fmt(u.points)}</b><small>poin</small></div>
                <div><FlameIcon size={14} /><b>{u.streak}</b><small>streak · top {u.bestStreak}</small></div>
                <div><Check size={13} /><b>{fmt(u.totalCheckins)}x</b><small>{u.lastDay || "belum"}</small></div>
              </div>
              <div className="cia-progress"><span style={{ width: `${u.streak ? ((((u.streak - 1) % 7) + 1) / 7) * 100 : 0}%` }} /></div>
              <div className="cia-user-actions">
                <button className="cia-btn primary" onClick={() => openEdit(u)}><Pencil size={13} /> Kelola</button>
                <button className="cia-btn ghost" title="Riwayat" onClick={() => openLedger(u)}><History size={14} /></button>
                <button className="cia-btn ghost" title="Analisis AI" onClick={() => openLedger(u, true)}><Sparkles size={14} /></button>
                <button className={`cia-btn ${u.blocked ? "ghost" : "danger"}`} title={u.blocked ? "Buka blokir" : "Blokir"}
                  onClick={() => act({ op: "block", userId: u.id, blocked: !u.blocked }, u.blocked ? "Blokir dibuka" : "User diblokir dari check-in")}>
                  {u.blocked ? <Check size={14} /> : <Ban size={14} />}
                </button>
              </div>
            </article>
          ))}
          {!users.length && <div className="cia-empty">{loading ? "Memuat..." : "Tidak ada data"}</div>}
        </div>
      </section>

      {data && (
        <section className="cia-card">
          <div className="cia-card-head"><h3><History size={14} /> Check-in terbaru</h3></div>
          <div className="cia-feed">
            {data.recent.map((r, i) => (
              <div key={i} className="cia-feed-row">
                <span className="cia-avatar sm">{initial(r.name || r.email)}</span>
                <div className="cia-user-id"><strong>{r.name}</strong><small>Hari ke-{r.streak} · {new Date(r.createdAt).toLocaleString("id-ID")}</small></div>
                <span className="cia-plus">+{fmt(r.reward)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {edit && (
        <div className="cia-modal" onClick={() => setEdit(null)}>
          <div className="cia-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cia-sheet-head">
              <span className="cia-avatar">{initial(edit.user.name || edit.user.email)}</span>
              <div className="cia-user-id"><strong>{edit.user.name}</strong><small>{edit.user.email}</small></div>
              <button className="cia-icon-btn" onClick={() => setEdit(null)}><X size={16} /></button>
            </div>
            <div className="cia-sheet-now">
              <div><small>Poin sekarang</small><b>{fmt(edit.user.points)}</b></div>
              <div><small>Streak</small><b>{edit.user.streak} hari</b></div>
            </div>

            <div className="cia-group">
              <h4><CoinIcon size={14} /> Ubah poin</h4>
              <label className="cia-field"><span>Atur poin jadi</span>
                <div className="cia-inline">
                  <input type="number" min="0" value={edit.points} onChange={(e) => setEdit({ ...edit, points: e.target.value })} />
                  <button className="cia-btn primary" disabled={busy} onClick={() => act({ op: "setPoints", userId: edit.user.id, points: edit.points, note: edit.note }, "Poin diatur")}>Simpan</button>
                </div>
              </label>
              <label className="cia-field"><span>Tambah / kurangi</span>
                <div className="cia-inline">
                  <input type="number" min="1" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} />
                  <button className="cia-btn success" disabled={busy} onClick={() => act({ op: "adjust", userId: edit.user.id, delta: Math.abs(parseInt(edit.amount, 10) || 0), note: edit.note || "Bonus dari admin" }, "Poin ditambah")}>+</button>
                  <button className="cia-btn danger" disabled={busy} onClick={() => act({ op: "adjust", userId: edit.user.id, delta: -Math.abs(parseInt(edit.amount, 10) || 0), note: edit.note || "Koreksi admin" }, "Poin dikurangi")}>−</button>
                </div>
              </label>
              <div className="cia-quick">
                {[100, 500, 1000, 5000].map((n) => (
                  <button key={n} className="cia-chip" disabled={busy} onClick={() => act({ op: "adjust", userId: edit.user.id, delta: n, note: edit.note || "Bonus dari admin" }, `+${fmt(n)} poin`)}>+{fmt(n)}</button>
                ))}
              </div>
              <label className="cia-field"><span>Catatan (opsional)</span>
                <input type="text" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Mis. hadiah event" />
              </label>
            </div>

            <div className="cia-group">
              <h4><FlameIcon size={14} /> Streak check-in</h4>
              <label className="cia-field"><span>Atur streak (user langsung bisa klaim hari berikutnya)</span>
                <div className="cia-inline">
                  <input type="number" min="0" value={edit.streak} onChange={(e) => setEdit({ ...edit, streak: e.target.value })} />
                  <button className="cia-btn primary" disabled={busy} onClick={() => act({ op: "streak", userId: edit.user.id, streak: parseInt(edit.streak, 10) || 0 }, "Streak diperbarui")}>Simpan</button>
                </div>
              </label>
            </div>

            <div className="cia-group danger-zone">
              <h4><Trash2 size={14} /> Reset</h4>
              <div className="cia-reset-grid">
                <button className="cia-btn outline-danger" disabled={busy} onClick={() => confirmDo("Reset poin user ini jadi 0?", { op: "setPoints", userId: edit.user.id, points: 0, note: "Poin direset admin" }, "Poin direset")}><RotateCcw size={13} /> Reset poin</button>
                <button className="cia-btn outline-danger" disabled={busy} onClick={() => confirmDo("Reset progres check-in (streak & waktu tunggu)?", { op: "resetCheckin", userId: edit.user.id }, "Progres check-in direset")}><RotateCcw size={13} /> Reset check-in</button>
                <button className="cia-btn danger" disabled={busy} onClick={() => confirmDo("Reset SEMUA: poin, streak, dan rekor user ini?", { op: "resetAll", userId: edit.user.id }, "Semua data poin direset")}><Trash2 size={13} /> Reset semua</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="cia-modal" onClick={() => setModal(null)}>
          <div className="cia-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cia-sheet-head">
              <span className="cia-avatar">{initial(modal.user.name || modal.user.email)}</span>
              <div className="cia-user-id"><strong>{modal.ai ? "Analisis AI" : "Riwayat poin"}</strong><small>{modal.user.email}</small></div>
              <button className="cia-icon-btn" onClick={() => setModal(null)}><X size={16} /></button>
            </div>
            {modal.ai && (
              <div className="ci-ai-box">
                {modal.ai.loading ? <p><Sparkles size={12} className="cx-spin" /> AI sedang menilai riwayat check-in & poin...</p>
                  : modal.ai.error ? <p style={{ color: "#fda4af" }}>{modal.ai.error}</p>
                  : (
                    <>
                      <div className="ci-ai-head">
                        <span className="ci-ai-score">{modal.ai.analysis.score}/100</span>
                        <span className={`ci-ai-risk ${modal.ai.analysis.risk}`}>Risiko {({ low: "rendah", medium: "sedang", high: "tinggi" })[modal.ai.analysis.risk]}</span>
                        <small style={{ color: "var(--muted)" }}>{modal.ai.stats.checkins} check-in · {modal.ai.stats.activities} aktivitas</small>
                      </div>
                      <p>{modal.ai.analysis.summary}</p>
                      <ul>{modal.ai.analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                      <p><strong>Saran:</strong> {modal.ai.analysis.recommendation}</p>
                    </>
                  )}
              </div>
            )}
            {!modal.ledger ? <div className="cia-empty">Memuat...</div> : !modal.ledger.length ? <div className="cia-empty">Belum ada riwayat</div> : (
              <div className="cia-feed">
                {modal.ledger.map((l, i) => (
                  <div key={i} className="cia-feed-row">
                    <div className="cia-user-id"><strong>{l.note || l.reason}</strong><small>{l.reason} · {new Date(l.createdAt).toLocaleString("id-ID")}</small></div>
                    <span className={l.delta >= 0 ? "cia-plus" : "cia-minus"}>{l.delta >= 0 ? "+" : ""}{fmt(l.delta)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
