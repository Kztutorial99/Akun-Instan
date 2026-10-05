import { useEffect, useState, useCallback } from "react";
import { jsonRequest } from "./main.jsx";
import "./checkin.css";

/* ── Ikon SVG khusus ── */
export function FlameIcon({ size = 18, lit = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="ciFlame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={lit ? "#f97316" : "#4b3d6b"} />
          <stop offset="1" stopColor={lit ? "#fde047" : "#6b5a94"} />
        </linearGradient>
      </defs>
      <path fill="url(#ciFlame)" d="M12 2c.6 3.2 3.6 4.9 4.9 7.6 1.9 3.9-.2 9.4-4.9 10.4-4.6 1-8.4-2.6-7.9-7.3.3-2.8 2-4.2 3-6 .4 1.5 1.1 2.6 2.2 3.2C9 6.9 10.4 4 12 2z" />
      <path fill={lit ? "#fff7cc" : "#8a7bb3"} opacity=".85" d="M12.3 12.2c1.6 1.4 2.4 2.9 1.9 4.6-.4 1.4-1.6 2.2-2.9 2.1-1.6-.1-2.7-1.5-2.4-3.1.2-1.1 1-1.7 1.6-2.4.2.7.6 1.1 1.2 1.3-.1-1 .1-1.8.6-2.5z" />
    </svg>
  );
}
export function CoinIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <radialGradient id="ciCoin" cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#fff3b0" /><stop offset=".55" stopColor="#fbbf24" /><stop offset="1" stopColor="#b45309" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#ciCoin)" />
      <circle cx="12" cy="12" r="7.2" fill="none" stroke="#fff6c9" strokeOpacity=".55" strokeWidth="1.2" />
      <path d="M12 7.2l1.45 2.95 3.25.47-2.35 2.3.55 3.23L12 14.6l-2.9 1.55.55-3.23-2.35-2.3 3.25-.47z" fill="#fff8d6" />
    </svg>
  );
}
function GiftIcon({ size = 22, open = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="ciGift" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c084fc" /><stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
      </defs>
      <rect x="3.5" y="10" width="17" height="11" rx="2" fill="url(#ciGift)" />
      <rect x={open ? 2.5 : 2.5} y={open ? 4.2 : 7} width="19" height="4" rx="1.4" fill="#d8b4fe" transform={open ? "rotate(-12 12 6)" : ""} />
      <rect x="10.8" y="10" width="2.4" height="11" fill="#fde047" />
      {!open && <rect x="10.8" y="7" width="2.4" height="4" fill="#fde047" />}
      <path d="M12 7c-1.5-3-5-3.2-5-1.2C7 7.3 10 7.2 12 7zm0 0c1.5-3 5-3.2 5-1.2C17 7.3 14 7.2 12 7z" fill="#fde047" transform={open ? "translate(-1 -3) rotate(-12 12 6)" : ""} />
    </svg>
  );
}
function CheckBadge({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#22c55e" />
      <path d="M7.5 12.4l3 3 6-6.4" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString("id-ID");
const rp = (n) => `Rp${fmt(n)}`;
const REASON = { checkin: "Check-in", redeem: "Tukar produk", refund: "Pengembalian", admin: "Admin" };

let checkinCache = null;
let checkinRequest = null;
let lastCheckinSync = 0;

// Versi data: naik setiap klaim, supaya respons GET lama (dimulai sebelum klaim) tidak menimpa status baru.
let checkinVersion = 0;
async function loadCheckinData() {
  if (checkinRequest) return checkinRequest;
  const v = checkinVersion;
  const req = jsonRequest(`/api/topup?resource=checkin&_=${Date.now()}`, { cache: "no-store" })
    .then((data) => {
      if (v !== checkinVersion && checkinCache) return checkinCache;
      checkinCache = data;
      return data;
    })
    .finally(() => { if (checkinRequest === req) checkinRequest = null; });
  checkinRequest = req;
  return req;
}

function shouldSyncCheckin() {
  const now = Date.now();
  if (now - lastCheckinSync < 500) return false;
  lastCheckinSync = now;
  return true;
}

export function useCheckin(enabled = true) {
  const [state, setState] = useState(() => ({ loading: enabled && !checkinCache, data: checkinCache, error: "" }));
  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const data = await loadCheckinData();
      setState({ loading: false, data, error: "" });
    } catch (e) { setState((s) => ({ ...s, loading: false, error: e.message })); }
  }, [enabled]);
  useEffect(() => {
    load();
    const sync = () => {
      if (document.visibilityState === "visible" && navigator.onLine && shouldSyncCheckin()) load();
    };
    const onVis = () => { if (document.visibilityState === "visible") sync(); };
    const onPoints = () => sync();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("online", sync);
    window.addEventListener("codexa:points", onPoints);
    window.addEventListener("codexa:page-change", sync);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("codexa:points", onPoints);
      window.removeEventListener("codexa:page-change", sync);
    };
  }, [load]);
  return [state, setState, load];
}

function Countdown({ seconds }) {
  const [left, setLeft] = useState(seconds || 0);
  useEffect(() => { setLeft(seconds || 0); }, [seconds]);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const h = String(Math.floor(left / 3600)).padStart(2, "0");
  const m = String(Math.floor((left % 3600) / 60)).padStart(2, "0");
  const s = String(left % 60).padStart(2, "0");
  return <span className="ci-countdown">{h}:{m}:{s}</span>;
}

function DayTrack({ data }) {
  const done = data.cycleDone;
  return (
    <div className="ci-track">
      <div className="ci-track-line"><span style={{ width: `${Math.min(100, (done / 7) * 100)}%` }} /></div>
      {data.settings.rewards.map((reward, i) => {
        const claimed = i < done;
        const isNext = !data.claimedToday && i === data.nextIndex;
        const big = i === 6;
        return (
          <div key={i} className={`ci-day${claimed ? " is-done" : ""}${isNext ? " is-next" : ""}${big ? " is-big" : ""}`}>
            <div className="ci-day-orb">
              {claimed ? <CheckBadge size={big ? 22 : 18} /> : big ? <GiftIcon size={22} /> : <CoinIcon size={18} />}
            </div>
            <strong>+{fmt(reward)}</strong>
            <small>Hari {i + 1}</small>
          </div>
        );
      })}
    </div>
  );
}

function ClaimButton({ data, busy, onClaim }) {
  if (data.blocked) return <button className="ci-claim is-off" disabled>Check-in dibatasi</button>;
  if (!data.settings.enabled) return <button className="ci-claim is-off" disabled>Check-in sedang libur</button>;
  if (!data.claimedToday && data.ipLimited) return <button className="ci-claim is-off" disabled>Jaringan sudah dipakai akun lain · coba jaringan lain</button>;
  if (data.claimedToday) return (
    <button className="ci-claim is-done" disabled>
      <CheckBadge size={16} /> Sudah check-in · berikutnya <Countdown seconds={data.secondsLeft} />
    </button>
  );
  return (
    <button className="ci-claim" disabled={busy} onClick={onClaim}>
      {busy ? <span className="ci-spin" /> : <GiftIcon size={18} />} Check-in sekarang · +{fmt(data.nextReward)} poin
    </button>
  );
}

function Burst({ amount }) {
  if (!amount) return null;
  return (
    <div className="ci-burst" aria-live="polite">
      {Array.from({ length: 12 }).map((_, i) => <i key={i} style={{ "--a": `${i * 30}deg` }} />)}
      <div className="ci-burst-label"><CoinIcon size={26} /> +{fmt(amount)} poin</div>
    </div>
  );
}

function useClaim(setState, onNotice) {
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState(0);
  const claim = async () => {
    if (busy) return;
    setBusy(true);
    try {
      checkinVersion++;
      checkinRequest = null;
      const data = await jsonRequest("/api/topup?resource=checkin", { method: "POST", body: "{}" });
      checkinVersion++;
      checkinRequest = null;
      checkinCache = data;
      setState({ loading: false, data, error: "" });
      setBurst(data.earned || 0);
      setTimeout(() => setBurst(0), 2200);
      window.dispatchEvent(new Event("codexa:points"));
      onNotice && onNotice(`Check-in berhasil! +${fmt(data.earned)} poin`);
    } catch (e) {
      onNotice && onNotice(e.message || "Check-in gagal", "error");
      // Selalu ambil status terbaru dari server supaya tombol & progres sesuai kenyataan.
      try {
        checkinVersion++;
        checkinRequest = null;
        const fresh = await loadCheckinData();
        setState({ loading: false, data: e.code === "IP_LIMIT" ? { ...fresh, ipLimited: true } : fresh, error: "" });
      } catch {}
      window.dispatchEvent(new Event("codexa:points"));
    } finally { setBusy(false); }
  };
  return { busy, burst, claim };
}

/* Kartu ringkas di halaman profil. */
export function CheckinProfileCard({ onOpen, onNotice }) {
  const [state, setState] = useCheckin(true);
  const { busy, burst, claim } = useClaim(setState, onNotice);
  const d = state.data;
  return (
    <div className="ci-card">
      <Burst amount={burst} />
      <div className="ci-card-head">
        <div>
          <p className="ci-eyebrow">Check-in Harian</p>
          <h3>Kumpulkan poin tiap hari</h3>
        </div>
        <button className="ci-link" onClick={onOpen}>Lihat detail →</button>
      </div>
      {!d ? <div className="ci-skel" /> : (
        <>
          <div className="ci-stats">
            <div className="ci-stat ci-stat-gold"><CoinIcon size={22} /><div><strong>{fmt(d.points)}</strong><small>Poin terkumpul · ≈ {rp(d.pointsValue)}</small></div></div>
            <div className="ci-stat"><FlameIcon size={22} lit={d.streak > 0} /><div><strong>{d.streak} hari</strong><small>Streak · terbaik {d.bestStreak}</small></div></div>
          </div>
          <DayTrack data={d} />
          <ClaimButton data={d} busy={busy} onClaim={claim} />
        </>
      )}
    </div>
  );
}

/* Halaman penuh /checkin */
export function CheckinPage({ onBack, onNotice, navigate }) {
  const [state, setState] = useCheckin(true);
  const { busy, burst, claim } = useClaim(setState, onNotice);
  const d = state.data;
  return (
    <div className="cx-container ci-page">
      <Burst amount={burst} />
      <div className="ci-hero">
        <div className="ci-hero-glow" />
        <div className="ci-hero-top">
          <button className="ci-back" onClick={onBack}>← Kembali</button>
          {d && <span className="ci-today">WIB · {d.today}</span>}
        </div>
        <p className="ci-eyebrow">Check-in Harian</p>
        <h1>Datang tiap hari, <span>panen poin</span>.</h1>
        <p className="ci-hero-sub">Jaga streak 7 hari berturut-turut untuk hadiah besar. Poin bisa langsung dipakai beli produk.</p>
        {!d ? <div className="ci-skel" /> : (
          <>
            <div className="ci-stats ci-stats-3">
              <div className="ci-stat ci-stat-gold"><CoinIcon size={26} /><div><strong>{fmt(d.points)}</strong><small>Poin · ≈ {rp(d.pointsValue)}</small></div></div>
              <div className="ci-stat"><FlameIcon size={26} lit={d.streak > 0} /><div><strong>{d.streak}</strong><small>Streak hari</small></div></div>
              <div className="ci-stat"><CheckBadge size={24} /><div><strong>{fmt(d.totalCheckins)}</strong><small>Total check-in</small></div></div>
            </div>
            <DayTrack data={d} />
            <ClaimButton data={d} busy={busy} onClaim={claim} />
          </>
        )}
      </div>

      {d && (
        <div className="ci-grid">
          <div className="ci-panel">
            <h3>Cara pakai poin</h3>
            <ol className="ci-steps">
              <li><b>1</b><span>Check-in setiap hari untuk menambah poin.</span></li>
              <li><b>2</b><span>Masukkan produk ke keranjang seperti biasa.</span></li>
              <li><b>3</b><span>Pilih <em>Bayar pakai poin</em> saat checkout. 1 poin = {rp(d.settings.pointValue)}.</span></li>
            </ol>
            <button className="cx-btn cx-btn-primary cx-btn-full" onClick={() => navigate && navigate("katalog")}>Belanja pakai poin</button>
          </div>
          <div className="ci-panel">
            <h3>Riwayat poin</h3>
            {!d.ledger.length ? <p className="ci-empty">Belum ada aktivitas. Ayo check-in pertama!</p> : (
              <ul className="ci-ledger">
                {d.ledger.map((l, i) => (
                  <li key={i}>
                    <div><strong>{REASON[l.reason] || l.reason}</strong><small>{l.note} · {new Date(l.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                    <span className={l.delta >= 0 ? "is-plus" : "is-minus"}>{l.delta >= 0 ? "+" : ""}{fmt(l.delta)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Tombol di keranjang. */
export function PointsPayButton({ total, disabled, loading, onPay }) {
  const [state] = useCheckin(true);
  const d = state.data;
  if (!d || !d.settings.redeemEnabled || !total) return null;
  const needed = Math.ceil(total / d.settings.pointValue);
  const enough = d.points >= needed && !d.blocked;
  return (
    <button className={`ci-paypoints${enough ? "" : " is-short"}`} disabled={disabled || loading || !enough} onClick={onPay}>
      <CoinIcon size={16} />
      {enough
        ? <span>Bayar pakai <b>{fmt(needed)}</b> poin</span>
        : <span>Poin kurang · {fmt(d.points)}/{fmt(needed)}</span>}
    </button>
  );
}

/* Pengingat dalam aplikasi: muncul saat check-in hari ini tersedia,
   dan otomatis muncul lagi tepat 24 jam setelah klaim terakhir. */
export function CheckinReminder({ enabled, activePage, navigate }) {
  const [{ data }, , load] = useCheckin(enabled);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => {
    try { setDismissed(localStorage.getItem("codexa:ci-reminder") || ""); } catch (_) {}
  }, []);
  useEffect(() => {
    if (!enabled || !data || !data.claimedToday) return;
    // Jadwalkan muat ulang tepat setelah jeda 24 jam selesai agar pengingat muncul lagi.
    const ms = Math.max(5, Number(data.secondsLeft) || 60) * 1000 + 3000;
    const t = setTimeout(load, Math.min(ms, 2147483000));
    return () => clearTimeout(t);
  }, [enabled, data, load]);
  if (!enabled || !data || !data.settings || !data.settings.enabled || data.blocked) return null;
  if (data.claimedToday || activePage === "checkin" || activePage === "admin" || dismissed === data.today) return null;
  const close = () => {
    setDismissed(data.today);
    try { localStorage.setItem("codexa:ci-reminder", data.today); } catch (_) {}
  };
  return (
    <div className="ci-reminder" role="status">
      <span className="ci-reminder-icon"><FlameIcon size={22} /></span>
      <div className="ci-reminder-text">
        <strong>Check-in harian tersedia!</strong>
        <small>Klaim +{fmt(data.nextReward)} poin{data.streak > 0 ? ` · jaga streak ${data.streak} hari` : ""}</small>
      </div>
      <button className="ci-reminder-go" onClick={() => { close(); navigate("checkin"); }}>Klaim</button>
      <button className="ci-reminder-x" aria-label="Tutup pengingat" onClick={close}>×</button>
    </div>
  );
}
