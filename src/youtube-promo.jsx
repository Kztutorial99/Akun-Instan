import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban, Check, ExternalLink, Eye, History, Link2, Loader2, Play, RefreshCw, Search, Send,
  Settings as SettingsIcon, Sparkles, Trash2, X, MonitorPlay,
} from "lucide-react";
import { jsonRequest } from "./main.jsx";

const API = "/api/admin/youtube";
const api = (resource, options = {}) => jsonRequest(`${API}?resource=${resource}`, options);

const TABS = [
  { key: "promo",     label: "YouTube Promotion", icon: Play },
  { key: "account",   label: "Akun YouTube",      icon: Link2 },
  { key: "settings",  label: "Pengaturan Promosi", icon: SettingsIcon },
  { key: "blacklist", label: "Blacklist",          icon: Ban },
  { key: "history",   label: "Riwayat Promosi",    icon: History },
];

const STATUS_LABEL = {
  pending: "Menunggu review",
  approved: "Disetujui",
  rejected: "Ditolak",
  sent: "Terkirim",
  failed: "Gagal",
};

const compact = (n) => {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}jt`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}rb`;
  return String(value);
};

const ageOf = (date) => {
  if (!date) return "-";
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days < 1) return "hari ini";
  if (days < 30) return `${days} hari lalu`;
  if (days < 365) return `${Math.floor(days / 30)} bulan lalu`;
  return `${Math.floor(days / 365)} tahun lalu`;
};

const waktu = (date) => {
  if (!date) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
  } catch (_) {
    return String(date);
  }
};

function YoutubePromo({ onNotice }) {
  const [tab, setTab]             = useState("promo");
  const [overview, setOverview]   = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState("");
  const [busy, setBusy]           = useState("");

  const [form, setForm]           = useState({ keyword: "", category: "gmail", order: "relevance", publishedAfter: "", minViews: 0 });
  const [videos, setVideos]       = useState([]);
  const [searched, setSearched]   = useState(false);

  const [drafts, setDrafts]       = useState([]);
  const [draftFilter, setDraftFilter] = useState("pending");
  const [editing, setEditing]     = useState({});

  const [settingsForm, setSettingsForm] = useState(null);
  const [blacklist, setBlacklist] = useState([]);
  const [blForm, setBlForm]       = useState({ type: "channel", value: "", note: "" });
  const [history, setHistory]     = useState({ logs: [], promotions: [] });

  const settings = overview && overview.settings;
  const stats = (overview && overview.stats) || {};
  const account = (overview && overview.account) || {};
  const config = (overview && overview.config) || {};
  const categories = useMemo(() => (overview && overview.categories) || [], [overview]);

  const notify = (message) => (onNotice ? onNotice(message) : undefined);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("overview", { method: "GET" });
      setOverview(data);
      setSettingsForm(data.settings);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrafts = useCallback(async (status) => {
    try {
      const data = await api(`drafts&status=${status || draftFilter}`, { method: "GET" });
      setDrafts(data.drafts || []);
    } catch (e) { setError(e.message); }
  }, [draftFilter]);

  const loadBlacklist = useCallback(async () => {
    try { setBlacklist((await api("blacklist", { method: "GET" })).blacklist || []); }
    catch (e) { setError(e.message); }
  }, []);

  const loadHistory = useCallback(async () => {
    try { setHistory(await api("history", { method: "GET" })); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { loadOverview(); loadDrafts("pending"); }, [loadOverview, loadDrafts]);
  useEffect(() => { if (tab === "blacklist") loadBlacklist(); if (tab === "history") loadHistory(); }, [tab, loadBlacklist, loadHistory]);

  const run = async (key, fn) => {
    setBusy(key);
    setError("");
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(""); }
  };

  /* ── Aksi ── */
  const search = () => run("search", async () => {
    if (!form.keyword.trim()) { setError("Isi kata kunci dulu."); return; }
    const data = await api("search", { method: "POST", body: JSON.stringify(form) });
    setVideos(data.videos || []);
    setSearched(true);
    notify(`${(data.videos || []).length} video ditemukan${data.blockedCount ? ` · ${data.blockedCount} disaring blacklist` : ""}`);
    loadOverview();
  });

  const makeDraft = (video) => run(`draft-${video.videoId}`, async () => {
    const data = await api("draft", { method: "POST", body: JSON.stringify({ videoId: video.videoId }) });
    notify(data.warning || "Draft komentar dibuat, cek daftar review di bawah.");
    setVideos((list) => list.map((v) => (v.videoId === video.videoId ? { ...v, processed: true } : v)));
    setDraftFilter("pending");
    await loadDrafts("pending");
    loadOverview();
  });

  const patchDraft = (id, payload, message) => run(`draft-${id}`, async () => {
    await api("draft", { method: "PATCH", body: JSON.stringify({ id, ...payload }) });
    notify(message);
    setEditing((prev) => ({ ...prev, [id]: undefined }));
    await loadDrafts();
    loadOverview();
  });

  const sendDraft = (draft) => run(`send-${draft.id}`, async () => {
    if (!window.confirm(`Kirim komentar ini ke YouTube?\n\n"${draft.comment}"`)) return;
    const data = await api("send", { method: "POST", body: JSON.stringify({ id: draft.id, confirm: true }) });
    if (data.ok) notify("Komentar berhasil dikirim ke YouTube.");
    else setError(data.error || "Gagal mengirim komentar");
    await loadDrafts();
    loadOverview();
  });

  const toggleStop = () => run("stop", async () => {
    const next = !(settings && settings.enabled);
    const data = await api("stop", { method: "POST", body: JSON.stringify({ enabled: next }) });
    setOverview((prev) => (prev ? { ...prev, settings: data.settings } : prev));
    setSettingsForm(data.settings);
    notify(next ? "Promosi diaktifkan kembali." : "Promosi dihentikan (STOP).");
  });

  const saveSettings = () => run("settings", async () => {
    const data = await api("settings", { method: "PATCH", body: JSON.stringify(settingsForm) });
    setOverview((prev) => (prev ? { ...prev, settings: data.settings } : prev));
    setSettingsForm(data.settings);
    notify("Pengaturan promosi disimpan.");
  });

  const connect = () => run("connect", async () => {
    const data = await api("connect", { method: "POST", body: "{}" });
    window.open(data.url, "_blank", "noopener");
    notify("Selesaikan izin di tab baru, lalu tekan Refresh.");
  });

  const disconnect = () => run("disconnect", async () => {
    if (!window.confirm("Putuskan akun YouTube?")) return;
    await api("account", { method: "DELETE" });
    notify("Akun YouTube diputuskan.");
    loadOverview();
  });

  const addBlacklist = () => run("bl-add", async () => {
    if (!blForm.value.trim()) { setError("Isi channel atau keyword dulu."); return; }
    const data = await api("blacklist", { method: "POST", body: JSON.stringify(blForm) });
    setBlacklist(data.blacklist || []);
    setBlForm({ type: blForm.type, value: "", note: "" });
    notify("Blacklist ditambahkan.");
  });

  const removeBlacklist = (id) => run(`bl-${id}`, async () => {
    const data = await api(`blacklist&id=${id}`, { method: "DELETE" });
    setBlacklist(data.blacklist || []);
    notify("Blacklist dihapus.");
  });

  const statCards = [
    { label: "Video ditemukan", value: stats.found || 0 },
    { label: "Menunggu review", value: stats.pending || 0 },
    { label: "Disetujui", value: stats.approved || 0 },
    { label: "Ditolak", value: stats.rejected || 0 },
    { label: "Berhasil dikirim", value: stats.sent || 0 },
    { label: "Gagal dikirim", value: stats.failed || 0 },
  ];

  return (
    <>
      <div className="cx-admin-top">
        <div>
          <div className="cx-admin-date">Promosi manual dengan persetujuan admin</div>
          <h1>YouTube Promotion</h1>
        </div>
        <div className="cx-admin-actions">
          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={loadOverview} disabled={loading}>
            <RefreshCw size={11} className={loading ? "cx-spin" : ""} /> Refresh
          </button>
          <button
            className="cx-btn cx-btn-sm"
            onClick={toggleStop}
            disabled={busy === "stop" || !settings}
            style={{
              background: settings && settings.enabled ? "rgba(201,121,128,.14)" : "rgba(126,201,150,.14)",
              border: `1px solid ${settings && settings.enabled ? "rgba(201,121,128,.4)" : "rgba(126,201,150,.4)"}`,
              color: settings && settings.enabled ? "var(--red)" : "var(--green, #7ec996)",
            }}
          >
            {settings && settings.enabled ? "🛑 STOP PROMOTION" : "▶ Lanjutkan Promosi"}
          </button>
        </div>
      </div>

      {(!config.apiKey || !config.oauth) && (
        <div className="cx-yt-alert">
          Konfigurasi belum lengkap:{" "}
          {!config.apiKey && <code>YOUTUBE_API_KEY</code>}
          {!config.apiKey && !config.oauth && " · "}
          {!config.oauth && <code>YOUTUBE_OAUTH_CLIENT_ID / SECRET / REDIRECT_URI</code>}
          {" "}— isi di environment variable Vercel supaya pencarian dan pengiriman komentar aktif.
        </div>
      )}
      {settings && !settings.enabled && (
        <div className="cx-yt-alert is-stop">Promosi dihentikan. Draft baru dan pengiriman komentar dikunci sampai diaktifkan lagi.</div>
      )}
      {error && <div className="cx-yt-alert is-error">{error}</div>}

      <div className="cx-yt-tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`cx-yt-tab${tab === key ? " active" : ""}`} onClick={() => setTab(key)}>
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* ══ TAB: PROMOTION ══ */}
      {tab === "promo" && (
        <>
          <div className="cx-stat-grid">
            {statCards.map(({ label, value }) => (
              <div key={label} className="cx-stat-card">
                <span className="cx-stat-label">{label}</span>
                <strong className="cx-stat-value">{value}</strong>
              </div>
            ))}
          </div>

          <div className="cx-panel" style={{ marginTop: 18 }}>
            <div className="cx-panel-header">
              <h3>Cari Video YouTube</h3>
              <span className="cx-panel-sub">pakai YouTube Data API resmi, bukan scraping</span>
            </div>
            <div className="cx-yt-form">
              <label>
                <span>Kata kunci</span>
                <input value={form.keyword} placeholder="cara buat email bisnis"
                  onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") search(); }} />
              </label>
              <label>
                <span>Kategori</span>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label>
                <span>Urutkan</span>
                <select value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })}>
                  <option value="relevance">Relevansi</option>
                  <option value="date">Upload terbaru</option>
                  <option value="viewCount">Views terbanyak</option>
                </select>
              </label>
              <label>
                <span>Diunggah setelah</span>
                <input type="date" value={form.publishedAfter} onChange={(e) => setForm({ ...form, publishedAfter: e.target.value })} />
              </label>
              <label>
                <span>Minimum views</span>
                <input type="number" min="0" value={form.minViews} onChange={(e) => setForm({ ...form, minViews: e.target.value })} />
              </label>
              <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={search} disabled={busy === "search"}>
                {busy === "search" ? <Loader2 size={11} className="cx-spin" /> : <Search size={11} />} Cari Video
              </button>
            </div>
          </div>

          {searched && (
            <div className="cx-yt-videos">
              {!videos.length && <p className="cx-yt-empty">Tidak ada video yang lolos filter. Coba kata kunci atau filter lain.</p>}
              {videos.map((v) => {
                const low = settings && v.relevance < settings.minRelevance;
                return (
                  <article key={v.videoId} className="cx-yt-card">
                    {v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}
                    <div className="cx-yt-card-body">
                      <h4>{v.title}</h4>
                      <span className="cx-yt-channel">{v.channelTitle}</span>
                      <div className="cx-yt-meta">
                        <span>{compact(v.views)} views</span>
                        <span>{ageOf(v.publishedAt)}</span>
                        <span className={`cx-yt-score${low ? " low" : ""}`}>Relevansi {v.relevance}%</span>
                        {v.processed && <span className="cx-yt-badge">✓ Sudah diproses</span>}
                      </div>
                      <div className="cx-yt-actions">
                        <a className="cx-btn cx-btn-secondary cx-btn-sm" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink size={11} /> Lihat
                        </a>
                        <button className="cx-btn cx-btn-primary cx-btn-sm"
                          onClick={() => makeDraft(v)}
                          disabled={busy === `draft-${v.videoId}` || v.processed || low || !(settings && settings.enabled)}>
                          {busy === `draft-${v.videoId}` ? <Loader2 size={11} className="cx-spin" /> : <Sparkles size={11} />} Buat Draft
                        </button>
                      </div>
                      {low && <p className="cx-yt-note">Relevansi di bawah minimum {settings.minRelevance}%.</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="cx-panel" style={{ marginTop: 18 }}>
            <div className="cx-panel-header">
              <h3>Review Draft Komentar</h3>
              <span className="cx-panel-sub">semua komentar butuh persetujuan admin sebelum dikirim</span>
            </div>
            <div className="cx-yt-filter">
              {["pending", "approved", "rejected", "sent", "failed", "all"].map((s) => (
                <button key={s} className={`cx-yt-chip${draftFilter === s ? " active" : ""}`}
                  onClick={() => { setDraftFilter(s); loadDrafts(s); }}>
                  {s === "all" ? "Semua" : STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="cx-yt-drafts">
              {!drafts.length && <p className="cx-yt-empty">Belum ada draft pada status ini.</p>}
              {drafts.map((d) => {
                const draftEdit = editing[d.id];
                return (
                  <div key={d.id} className="cx-yt-draft">
                    <div className="cx-yt-draft-head">
                      <div>
                        <strong>{d.title || d.videoId}</strong>
                        <span>{d.channelTitle} · relevansi {d.relevance || 0}% · {waktu(d.createdAt)}</span>
                      </div>
                      <span className={`cx-yt-status is-${d.status}`}>{STATUS_LABEL[d.status] || d.status}</span>
                    </div>
                    {draftEdit === undefined ? (
                      <p className="cx-yt-comment">{d.comment}</p>
                    ) : (
                      <textarea className="cx-yt-textarea" rows={3} value={draftEdit}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [d.id]: e.target.value }))} />
                    )}
                    {d.error && <p className="cx-yt-note is-error">{d.error}</p>}
                    <div className="cx-yt-actions">
                      <a className="cx-btn cx-btn-secondary cx-btn-sm" href={`https://www.youtube.com/watch?v=${d.videoId}`} target="_blank" rel="noopener noreferrer">
                        <Eye size={11} /> Buka Video
                      </a>
                      {draftEdit === undefined ? (
                        <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => setEditing((p) => ({ ...p, [d.id]: d.comment }))} disabled={d.status === "sent"}>
                          Edit
                        </button>
                      ) : (
                        <>
                          <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => patchDraft(d.id, { action: "edit", comment: draftEdit }, "Draft diperbarui.")}>
                            <Check size={11} /> Simpan
                          </button>
                          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => setEditing((p) => ({ ...p, [d.id]: undefined }))}>
                            <X size={11} /> Batal
                          </button>
                        </>
                      )}
                      {d.status === "pending" && (
                        <>
                          <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => patchDraft(d.id, { action: "approve" }, "Draft disetujui.")}>
                            <Check size={11} /> Approve
                          </button>
                          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => patchDraft(d.id, { action: "reject" }, "Draft ditolak.")}>
                            <X size={11} /> Reject
                          </button>
                        </>
                      )}
                      {(d.status === "approved" || d.status === "failed") && (
                        <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => sendDraft(d)}
                          disabled={busy === `send-${d.id}` || !account.connected || !(settings && settings.enabled)}>
                          {busy === `send-${d.id}` ? <Loader2 size={11} className="cx-spin" /> : <Send size={11} />} Kirim ke YouTube
                        </button>
                      )}
                    </div>
                    {(d.status === "approved" && !account.connected) && (
                      <p className="cx-yt-note">Hubungkan akun YouTube dulu sebelum mengirim komentar.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ══ TAB: AKUN ══ */}
      {tab === "account" && (
        <div className="cx-panel" style={{ marginTop: 18 }}>
          <div className="cx-panel-header">
            <h3>Akun YouTube</h3>
            <span className="cx-panel-sub">token disimpan terenkripsi, tidak pernah plain text</span>
          </div>
          <div className="cx-yt-account">
            <div className="cx-yt-account-row">
              <MonitorPlay size={18} color={account.connected ? "#ff4d4d" : "var(--faint)"} />
              <div>
                <strong>{account.connected ? "Connected" : "Not Connected"}</strong>
                <span>{account.connected ? `${account.channelTitle || "-"} · ${account.channelId || "-"}` : "Belum ada akun yang dihubungkan"}</span>
                <span>Terakhir sinkron: {waktu(account.lastSync)}</span>
              </div>
            </div>
            <div className="cx-yt-actions">
              <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={connect} disabled={busy === "connect" || !config.oauth}>
                <Link2 size={11} /> {account.connected ? "Hubungkan Ulang" : "Connect YouTube"}
              </button>
              {account.connected && (
                <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={disconnect} disabled={busy === "disconnect"}>
                  <Trash2 size={11} /> Putuskan
                </button>
              )}
            </div>
            {!config.oauth && (
              <p className="cx-yt-note">
                Isi dulu <code>YOUTUBE_OAUTH_CLIENT_ID</code>, <code>YOUTUBE_OAUTH_CLIENT_SECRET</code>, dan{" "}
                <code>YOUTUBE_OAUTH_REDIRECT_URI</code> (https://akuninstan.com/api/youtube/callback) di environment variable.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: PENGATURAN ══ */}
      {tab === "settings" && settingsForm && (
        <div className="cx-panel" style={{ marginTop: 18 }}>
          <div className="cx-panel-header">
            <h3>Pengaturan Promosi</h3>
            <span className="cx-panel-sub">tersimpan di database, langsung dipakai tanpa redeploy</span>
          </div>
          <div className="cx-yt-form is-settings">
            <label><span>Batas draft per hari</span>
              <input type="number" min="1" max="200" value={settingsForm.dailyLimit}
                onChange={(e) => setSettingsForm({ ...settingsForm, dailyLimit: Number(e.target.value) })} /></label>
            <label><span>Minimum relevansi (%)</span>
              <input type="number" min="0" max="100" value={settingsForm.minRelevance}
                onChange={(e) => setSettingsForm({ ...settingsForm, minRelevance: Number(e.target.value) })} /></label>
            <label><span>Cooldown antar draft (menit)</span>
              <input type="number" min="0" max="1440" value={settingsForm.cooldownMinutes}
                onChange={(e) => setSettingsForm({ ...settingsForm, cooldownMinutes: Number(e.target.value) })} /></label>
            <label className="cx-yt-check">
              <input type="checkbox" checked={settingsForm.requireApproval}
                onChange={(e) => setSettingsForm({ ...settingsForm, requireApproval: e.target.checked })} />
              <span>Wajib approval admin sebelum kirim</span>
            </label>
            <label className="cx-yt-check">
              <input type="checkbox" checked={settingsForm.allowAiDraft}
                onChange={(e) => setSettingsForm({ ...settingsForm, allowAiDraft: e.target.checked })} />
              <span>Izinkan draft dibuat AI</span>
            </label>
            <label className="cx-yt-check">
              <input type="checkbox" checked={settingsForm.duplicateProtection}
                onChange={(e) => setSettingsForm({ ...settingsForm, duplicateProtection: e.target.checked })} />
              <span>Proteksi duplikat video</span>
            </label>
            <label><span>Nama brand</span>
              <input value={settingsForm.profile.brand}
                onChange={(e) => setSettingsForm({ ...settingsForm, profile: { ...settingsForm.profile, brand: e.target.value } })} /></label>
            <label><span>Website</span>
              <input value={settingsForm.profile.website}
                onChange={(e) => setSettingsForm({ ...settingsForm, profile: { ...settingsForm.profile, website: e.target.value } })} /></label>
            <label className="is-wide"><span>Deskripsi brand</span>
              <input value={settingsForm.profile.description}
                onChange={(e) => setSettingsForm({ ...settingsForm, profile: { ...settingsForm.profile, description: e.target.value } })} /></label>
            <label className="is-wide"><span>Ajakan (CTA)</span>
              <input value={settingsForm.profile.cta}
                onChange={(e) => setSettingsForm({ ...settingsForm, profile: { ...settingsForm.profile, cta: e.target.value } })} /></label>
            <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={saveSettings} disabled={busy === "settings"}>
              {busy === "settings" ? <Loader2 size={11} className="cx-spin" /> : <Check size={11} />} Simpan Pengaturan
            </button>
          </div>
        </div>
      )}

      {/* ══ TAB: BLACKLIST ══ */}
      {tab === "blacklist" && (
        <div className="cx-panel" style={{ marginTop: 18 }}>
          <div className="cx-panel-header">
            <h3>Blacklist</h3>
            <span className="cx-panel-sub">channel atau kata kunci yang tidak boleh dipromosikan</span>
          </div>
          <div className="cx-yt-form">
            <label><span>Tipe</span>
              <select value={blForm.type} onChange={(e) => setBlForm({ ...blForm, type: e.target.value })}>
                <option value="channel">Channel ID / URL</option>
                <option value="keyword">Kata kunci</option>
              </select></label>
            <label><span>Nilai</span>
              <input value={blForm.value} placeholder={blForm.type === "channel" ? "UCxxxx atau youtube.com/@channel" : "gameplay"}
                onChange={(e) => setBlForm({ ...blForm, value: e.target.value })} /></label>
            <label><span>Catatan</span>
              <input value={blForm.note} onChange={(e) => setBlForm({ ...blForm, note: e.target.value })} /></label>
            <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={addBlacklist} disabled={busy === "bl-add"}>Tambah</button>
          </div>
          <div className="cx-yt-list">
            {!blacklist.length && <p className="cx-yt-empty">Blacklist masih kosong.</p>}
            {blacklist.map((b) => (
              <div key={b.id} className="cx-yt-list-row">
                <span className="cx-yt-chip active">{b.type === "channel" ? "Channel" : "Keyword"}</span>
                <strong>{b.value}</strong>
                <span>{b.note || ""}</span>
                <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => removeBlacklist(b.id)} disabled={busy === `bl-${b.id}`}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ TAB: RIWAYAT ══ */}
      {tab === "history" && (
        <div className="cx-panel" style={{ marginTop: 18 }}>
          <div className="cx-panel-header">
            <h3>Riwayat Promosi</h3>
            <span className="cx-panel-sub">seluruh aktivitas pencarian, draft, approval, dan pengiriman</span>
          </div>
          <div className="cx-yt-list">
            {!history.logs.length && <p className="cx-yt-empty">Belum ada aktivitas.</p>}
            {history.logs.map((log) => (
              <div key={log.id} className="cx-yt-log">
                <div className="cx-yt-log-head">
                  <span className={`cx-yt-status is-${log.status}`}>{STATUS_LABEL[log.status] || log.status}</span>
                  <span>{waktu(log.createdAt)}</span>
                </div>
                {log.videoTitle && <strong>{log.videoTitle}</strong>}
                <span className="cx-yt-log-meta">
                  {[log.channelTitle, log.keyword && `kata kunci: ${log.keyword}`, log.relevance != null && `relevansi ${log.relevance}%`,
                    log.account && `akun: ${log.account}`, log.commentId && `comment: ${log.commentId}`, log.admin && `oleh ${log.admin}`]
                    .filter(Boolean).join(" · ")}
                </span>
                {log.draft && <p className="cx-yt-comment">{log.draft}</p>}
                {log.detail && <p className="cx-yt-note">{log.detail}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default YoutubePromo;
