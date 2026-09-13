import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import {
  ArrowRight, ArrowUpRight, ArrowDownRight, BadgeCheck, Bell, Check,
  CircleHelp, Command, Copy, CreditCard, Eye, EyeOff, ChevronDown,
  FileText, Home, LayoutDashboard, LockKeyhole, LogIn, LogOut, Menu,
  MoreHorizontal, Package, PanelLeft, Pencil, Plus, RefreshCw, QrCode, Download,
  Search, Settings, ShieldCheck, ShoppingBag, Trash2, X,
  User, UserPlus, Wallet, Mail, Phone, Clock, Sparkles, Send, Zap, KeyRound,
  Star,
} from "lucide-react";
import "./styles.css";
import { applySeo, applyProductSchema, applyProductSeo } from "./seo.js";
import { CategoryPage, CATEGORY_PAGES, CATEGORY_SLUGS } from "./category-pages.jsx";
import { signInWithGoogle, consumeGoogleRedirect, signOutGoogle } from "./google-signin.js";
import { useTurnstile, Captcha } from "./turnstile.jsx";

/* ─── helpers ─── */
export const formatPrice = (v) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(v) || 0);
export const formatDate = (v) => v ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(v)) : "-";
export const CUSTOM_EMAIL_FEE = 10000;
export const CUSTOM_EMAIL_STATUS_LABEL = { pending: "Menunggu", processing: "Diproses", done: "Selesai", rejected: "Ditolak" };
const CUSTOM_EMAIL_MAX = 3;
export const CUSTOM_GENDER_LABEL = { male: "Laki-laki", female: "Perempuan", other: "Lainnya" };
// Data pemilik akun wajib lengkap sebelum nama boleh ditambahkan.
const isCustomProfileComplete = (p) => Boolean(
  p && /^[A-Za-z'.\- ]{2,40}$/.test(String(p.firstName || "").trim())
  && /^[A-Za-z'.\- ]{2,40}$/.test(String(p.lastName || "").trim())
  && /^\d{4}-\d{2}-\d{2}$/.test(String(p.birthDate || ""))
  && ["male", "female", "other"].includes(String(p.gender || ""))
);
export const formatBirthDate = (value) => {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

export const customEmailsOf = (order) => {
  if (Array.isArray(order && order.customEmails) && order.customEmails.length) return order.customEmails;
  if (order && order.customEmail) return [{ id: order.id, requested: order.customEmail, status: order.customEmailStatus || "pending" }];
  return [];
};
/* Sistem harga aged: bonus otomatis sesuai umur akun (sinkron dgn api/_aged.js).
   Tingkatan di bawah hanya nilai default; admin bisa mengubahnya dari panel
   (menu "Harga Aged") dan hasilnya dikirim lewat /api/admin/settings. */
export const AGED_TIERS = [
  { maxDays: 7, bonus: 0, label: "Fresh (0-7 hari)" },
  { maxDays: 30, bonus: 2000, label: "Aged 8-30 hari" },
  { maxDays: 90, bonus: 5000, label: "Aged 1-3 bulan" },
  { maxDays: 180, bonus: 10000, label: "Aged 3-6 bulan" },
  { maxDays: 365, bonus: 18000, label: "Aged 6-12 bulan" },
];
export const AGED_DEFAULTS = { enabled: true, tiers: AGED_TIERS, yearBonus: 30000, extraPerYear: 10000 };
export const agedInfoOf = (value, config) => {
  const cfg = config && Array.isArray(config.tiers) && config.tiers.length ? config : AGED_DEFAULTS;
  if (!value) return { days: null, bonus: 0, label: "" };
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return { days: null, bonus: 0, label: "" };
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (cfg.enabled === false) return { days, bonus: 0, label: "Harga tetap" };
  const tiers = [...cfg.tiers].sort((a, b) => a.maxDays - b.maxDays);
  for (const tier of tiers) if (days <= tier.maxDays) return { days, bonus: Number(tier.bonus) || 0, label: tier.label };
  const last = tiers[tiers.length - 1];
  const extraYears = Math.max(0, Math.floor((days - last.maxDays) / 365));
  const yearBonus = Number(cfg.yearBonus) || 0;
  const extraPerYear = Number(cfg.extraPerYear) || 0;
  return { days, bonus: yearBonus + extraYears * extraPerYear, label: `Aged ${1 + extraYears} tahun+` };
};
/* Penanda umur produk (Fresh / Aged) untuk badge katalog + filter.
   Sumber utama: agedDays per akun dari /api/data. Kalau umur belum diisi
   admin, jatuh ke tebakan dari judul/deskripsi supaya badge tetap muncul. */
const agedLabelFromDays = (days) => {
  if (days <= 30) return `Aged ${days} hari`;
  if (days < 365) return `Aged ${Math.max(1, Math.round(days / 30))} bulan`;
  const years = Math.floor(days / 365);
  return `Aged ${years} tahun+`;
};
export const productAgeInfo = (product) => {
  const accounts = Array.isArray(product && product.accounts) ? product.accounts : [];
  const days = accounts
    .map((a) => Number(a && a.agedDays))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (days.length) {
    const oldest = Math.max(...days);
    if (oldest <= 7) return { kind: "fresh", label: "Fresh", days: oldest };
    return { kind: "aged", label: agedLabelFromDays(oldest), days: oldest };
  }
  const text = `${(product && product.title) || ""} ${(product && product.description) || ""}`.toLowerCase();
  if (text.includes("aged")) return { kind: "aged", label: "Aged", days: null };
  if (text.includes("fresh") || text.includes("no-pva") || text.includes("no pva")) {
    return { kind: "fresh", label: "Fresh", days: null };
  }
  return { kind: "", label: "", days: null };
};
export const CATALOG_SORTS = [
  { key: "default", label: "Paling baru" },
  { key: "price-asc", label: "Harga termurah" },
  { key: "price-desc", label: "Harga termahal" },
  { key: "stock-desc", label: "Stok terbanyak" },
  { key: "name-asc", label: "Nama A-Z" },
];
export const CATALOG_AGES = [
  { key: "all", label: "Semua" },
  { key: "fresh", label: "Fresh" },
  { key: "aged", label: "Aged" },
];
export const LOGIN_TYPES = ["Google", "Facebook", "Email/password", "Apple", "Microsoft", "Lainnya"];
/* Template produk siap pakai: admin cukup ganti harga, email & password. */
export const PRODUCT_TEMPLATES = [
  {
    key: "google",
    label: "Google / Gmail",
    icon: "Google",
    data: {
      title: "Akun Google (Gmail) Fresh — Siap Pakai",
      loginType: "Google",
      price: "6000",
      description: [
        "Tentang Produk:",
        "Akun Google / Gmail fresh (baru dibuat, belum pernah dipakai) dan siap langsung login. Jumlah akun yang kamu terima sesuai jumlah yang kamu beli.",
        "",
        "Spesifikasi:",
        "- Status: Fresh / New — belum terpakai di layanan apa pun",
        "- Tipe: No-PVA (belum terhubung ke nomor HP), jadi kamu bebas memasang nomor sendiri",
        "- Format kiriman: email + password untuk setiap akun",
        "- Recovery mail: kosong / bisa kamu isi sendiri",
        "- Region: campuran (random) kecuali disebutkan lain di judul produk",
        "",
        "Yang Didapat:",
        "- Akses penuh ke Play Store, YouTube, Drive, Docs, Gmail, dan login pihak ketiga",
        "- Panduan pengamanan akun langkah demi langkah",
        "- Bantuan admin lewat menu Bantuan / Asisten",
        "",
        "Catatan penting:",
        "- Wajib ganti password segera setelah pembelian.",
        "- Login pertama disarankan lewat browser di HP/PC yang biasa kamu pakai.",
        "- Jangan login lebih dari 2 perangkat sekaligus di 24 jam pertama.",
        "- Karena No-PVA, akun bisa diminta verifikasi nomor bila dipakai kasar/spam.",
        "- Garansi login 1x24 jam sejak pembelian.",
      ].join("\n"),

      deliveryDetails: [
        "CARA MENGAMANKAN AKUN (lakukan segera setelah beli):",
        "1. Buka myaccount.google.com lalu login dengan email & password di atas.",
        "2. Keamanan > Sandi: ganti password jadi milikmu sendiri (min. 10 karakter, kombinasi huruf, angka, simbol).",
        "3. Keamanan > Verifikasi 2 Langkah: aktifkan dengan nomor HP / Google Authenticator milikmu.",
        "4. Keamanan > Email & nomor pemulihan: ganti ke email dan nomor HP kamu.",
        "5. Keamanan > Perangkat kamu: klik 'Keluar' pada semua perangkat yang tidak kamu kenal.",
        "6. Keamanan > Aplikasi pihak ketiga: cabut akses aplikasi yang tidak kamu pakai.",
        "",
        "CATATAN:",
        "- Jangan bagikan password ke siapa pun, termasuk yang mengaku admin.",
        "- Simpan password di tempat aman (password manager / catatan terkunci).",
        "- Kalau ada kendala login, hubungi admin lewat menu Bantuan / Assisten maksimal 1x24 jam.",
      ].join("\n"),
      status: "available",
    },
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: "Facebook",
    data: {
      title: "Akun Facebook Aktif — Siap Pakai",
      loginType: "Facebook",
      description: [
        "Tentang Produk:",
        "Akun Facebook aktif dan siap pakai. Jumlah akun yang kamu terima sesuai jumlah yang kamu beli.",
        "",
        "Spesifikasi:",
        "- Status: aktif, sudah melewati masa pembuatan (bukan akun baru mentah)",
        "- Tipe: No-PVA (belum terikat nomor HP), nomor bisa kamu pasang sendiri",
        "- Format kiriman: email/nomor + password untuk setiap akun",
        "- Region: campuran (random) kecuali disebutkan lain di judul produk",
        "",
        "Yang Didapat:",
        "- Akses marketplace, grup, halaman, dan login pihak ketiga",
        "- Panduan pengamanan akun langkah demi langkah",
        "",
        "Catatan penting:",
        "- Wajib ganti password setelah pembelian.",
        "- Hindari login dari banyak perangkat sekaligus di hari pertama.",
        "- Jangan ganti nama/foto profil dalam 24 jam pertama.",
        "- Garansi login 1x24 jam sejak pembelian.",
      ].join("\n"),

      deliveryDetails: [
        "CARA MENGAMANKAN AKUN:",
        "1. Login di facebook.com, buka Pengaturan & Privasi > Pusat Akun.",
        "2. Ganti password jadi milikmu sendiri.",
        "3. Aktifkan Autentikasi Dua Faktor (2FA) dengan nomor HP / aplikasi authenticator.",
        "4. Ganti email & nomor pemulihan ke milikmu.",
        "5. Cek 'Tempat Kamu Login' dan keluarkan perangkat asing.",
        "",
        "CATATAN: jangan langsung ganti nama/foto profil dalam 24 jam pertama agar akun tidak dicurigai sistem.",
      ].join("\n"),
      status: "available",
    },
  },
  {
    key: "email",
    label: "Email / Password umum",
    icon: "Email/password",
    data: {
      title: "Akun Premium — Login Email & Password",
      loginType: "Email/password",
      description: [
        "Tentang Produk:",
        "Akun premium siap pakai dengan login email & password. Jumlah akun yang kamu terima sesuai jumlah yang kamu beli.",
        "",
        "Spesifikasi:",
        "- Status: aktif dan siap login",
        "- Format kiriman: email + password untuk setiap akun",
        "- Masa aktif: sesuai keterangan pada judul produk",
        "",
        "Yang Didapat:",
        "- Akses penuh ke fitur layanan sesuai paket pada judul produk",
        "- Panduan pengamanan akun langkah demi langkah",
        "",
        "Catatan penting:",
        "- Jangan ganti email utama akun.",
        "- Ganti password sendiri setelah login pertama.",
        "- Garansi login 1x24 jam sejak pembelian.",
      ].join("\n"),

      deliveryDetails: [
        "CARA MENGAMANKAN AKUN:",
        "1. Login memakai email & password di atas.",
        "2. Ganti password pada menu Pengaturan / Profil.",
        "3. Aktifkan verifikasi 2 langkah bila layanan menyediakannya.",
        "4. Keluarkan perangkat lain dari daftar sesi aktif.",
        "",
        "CATATAN: simpan kredensial dengan aman dan jangan dibagikan ke orang lain.",
      ].join("\n"),
      status: "available",
    },
  },
];

export const emptyListing = { title: "", description: "", loginType: "Google", price: "", status: "available", agedPricing: true, accounts: [{ email: "", password: "", price: "", createdAt: "" }], deliveryDetails: "" };
const accountPriceOf = (account, product) => {
  const n = Number(account && account.price);
  if (Number.isFinite(n) && n > 0) return n;
  return Number(product && product.price) || 0;
};
const sumSelected = (product, selected) =>
  (product.accounts || [])
    .filter((a) => selected.includes(a.index))
    .reduce((total, a) => total + accountPriceOf(a, product), 0);
export const ACCENT_COLORS = ["#e36d78", "#7bc48b", "#6c83da", "#a983de", "#67b6a1", "#dba66a"];

/* ─── provider icons (icons8) ─── */
const PROVIDER_ICONS = {
  "google": "https://img.icons8.com/color/48/google-logo.png",
  "facebook": "https://img.icons8.com/color/48/facebook-new.png",
  "email/password": "https://img.icons8.com/color/48/new-post.png",
  "apple": "https://img.icons8.com/ios-filled/50/mac-os.png",
  "microsoft": "https://img.icons8.com/color/48/microsoft.png",
  "lainnya": "https://img.icons8.com/color/48/key-security.png",
};
const providerIconUrl = (t) =>
  PROVIDER_ICONS[String(t || "").trim().toLowerCase()] || PROVIDER_ICONS["lainnya"];

export function ProviderIcon({ type, size = 16, className = "" }) {
  return (
    <img
      src={providerIconUrl(type)}
      alt={type || "Provider"}
      title={type || "Provider"}
      width={size}
      height={size}
      loading="lazy"
      className={`cx-provider-icon ${className}`.trim()}
      style={{ width: size, height: size }}
    />
  );
}

export async function jsonRequest(url, opts = {}) {
  const r = await fetch(url, { credentials: "same-origin", ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const p = await r.json().catch(() => ({}));
  if (!r.ok) {
    const error = new Error(p.error || "Permintaan gagal diproses");
    error.code = p.code || "";
    error.retryAfter = Number(p.retryAfter) || 0;
    error.status = r.status;
    throw error;
  }
  return p;
}

/* ─── small UI atoms ─── */
function IconBtn({ children, label, onClick, style }) {
  return <button aria-label={label} onClick={onClick} className="cx-icon-btn" style={style}>{children}</button>;
}
export function Field({ label, children, hint, error }) {
  return (
    <div className="cx-field">
      <label>{label}</label>
      {children}
      {error && <small className="cx-field-error">{error}</small>}
      {!error && hint && <small>{hint}</small>}
    </div>
  );
}
export function InputWrap({ icon: Icon, children }) {
  return <div className="cx-input-wrap">{Icon && <Icon size={13} />}{children}</div>;
}

/* ─── Spinner kecil untuk state loading tombol ─── */
export function Spinner({ size = 12 }) {
  return <RefreshCw size={size} className="cx-spin" aria-hidden="true" />;
}

/* ─── Tombol dengan loading state bawaan ───
   Selama busy: tombol otomatis disabled + spinner, jadi tidak ada aksi yang
   terlihat "diam" dan user tidak menekan berkali-kali. */
export function ActionBtn({ busy, disabled, children, busyLabel, className = "cx-btn cx-btn-secondary cx-btn-sm", ...rest }) {
  return (
    <button {...rest} className={className} disabled={busy || disabled} aria-busy={busy ? "true" : undefined}>
      {busy ? <><Spinner /> {busyLabel || "Memproses..."}</> : children}
    </button>
  );
}

/* ─── Modal konfirmasi (pengganti window.confirm) ───
   Dipakai untuk semua aksi penting: hapus, setujui, tolak, bersihkan riwayat. */
export function useConfirmDialog() {
  const [req, setReq] = useState(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef(null);

  const confirm = (options) =>
    new Promise((resolve) => {
      resolver.current = resolve;
      setReq({
        title: "Konfirmasi tindakan",
        description: "",
        confirmText: "Konfirmasi",
        cancelText: "Batal",
        danger: false,
        ...options,
      });
    });

  const settle = (value) => {
    setReq(null); setBusy(false);
    if (resolver.current) { const r = resolver.current; resolver.current = null; r(value); }
  };

  useEffect(() => {
    if (!req) return undefined;
    const onKey = (e) => { if (e.key === "Escape") settle(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req]);

  const element = req ? (
    <div className="cx-modal-backdrop cx-confirm-backdrop" onClick={() => !busy && settle(false)}>
      <div className={`cx-modal cx-confirm-modal${req.danger ? " is-danger" : ""}`} role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="cx-confirm-icon">{req.danger ? <Trash2 size={18} /> : <ShieldCheck size={18} />}</div>
        <h3>{req.title}</h3>
        {req.description && <p>{req.description}</p>}
        {req.detail && <div className="cx-confirm-detail">{req.detail}</div>}
        <div className="cx-confirm-buttons">
          <button className="cx-btn cx-btn-ghost" onClick={() => settle(false)} disabled={busy}>{req.cancelText}</button>
          <button
            className={`cx-btn ${req.danger ? "cx-btn-danger" : "cx-btn-primary"}`}
            onClick={() => { setBusy(true); settle(true); }}
            disabled={busy}
            autoFocus
          >
            {busy ? <><Spinner /> Memproses...</> : req.confirmText}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, element];
}

/* ─── Penanda aksi yang sedang berjalan (per-baris/per-tombol) ─── */
export function usePendingActions() {
  const [pending, setPending] = useState({});
  const isPending = (key) => Boolean(pending[key]);
  const run = async (key, fn) => {
    if (pending[key]) return undefined;
    setPending((p) => ({ ...p, [key]: true }));
    try { return await fn(); }
    finally { setPending((p) => { const next = { ...p }; delete next[key]; return next; }); }
  };
  return [isPending, run];
}

/* ─── Teks panjang: tampil 3 baris dulu, sisanya lewat "Lihat selengkapnya" ─── */
export function ExpandableText({ text: value, lines = 3, className = "", limit = 140 }) {
  const [open, setOpen] = useState(false);
  const raw = String(value == null ? "" : value);
  if (!raw.trim()) return null;
  const needsToggle = raw.length > limit || raw.split("\n").length > lines;
  return (
    <div className={`cx-expandable ${className}`.trim()}>
      <p className={open || !needsToggle ? "" : `cx-clamp cx-clamp-${lines}`}>{raw}</p>
      {needsToggle && (
        <button type="button" className="cx-expand-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Sembunyikan" : "Lihat selengkapnya"} <ChevronDown size={11} style={open ? { transform: "rotate(180deg)" } : undefined} />
        </button>
      )}
    </div>
  );
}



/* ─── Catatan pengiriman / Cara mengamankan akun ───
   Teks panjang satu paragraf dari admin dipecah jadi grup berjudul + langkah
   bernomor supaya rapi dan mudah dibaca, terutama di mobile. */
function parseDeliveryNote(raw) {
  const text = String(raw == null ? "" : raw).replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const flat = text.split(/\n+/).join(" ").replace(/\s+/g, " ");
  const marked = flat
    .replace(/\s(?=[A-Z][A-Z\s&\/]{3,}(?:\([^)]*\))?\s*:)/g, "\n@@")
    .replace(/^(?=[A-Z][A-Z\s&\/]{3,}(?:\([^)]*\))?\s*:)/, "@@")
    .replace(/\s(?=\d{1,2}[.)]\s)/g, "\n")
    .replace(/\s(?=[-\u2022]\s)/g, "\n");
  const groups = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { title: "", steps: [] }; groups.push(cur); } return cur; };
  for (const line of marked.split("\n").map((v) => v.trim()).filter(Boolean)) {
    if (line.startsWith("@@")) {
      const body = line.slice(2).trim();
      const m = body.match(/^([^:]{2,70}):\s*(.*)$/);
      cur = { title: (m ? m[1] : body).trim(), steps: [] };
      groups.push(cur);
      if (m && m[2].trim()) cur.steps.push(m[2].trim());
      continue;
    }
    const num = line.match(/^\d{1,2}[.)]\s*(.+)$/);
    const dash = line.match(/^[-\u2022]\s*(.+)$/);
    ensure().steps.push(String(num ? num[1] : dash ? dash[1] : line).trim());
  }
  return groups.filter((g) => g.title || g.steps.length);
}
function prettyTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/(^|\s|\()([a-z0-9])/g, (m, a, b) => a + b.toUpperCase());
}
function DeliveryNote({ text, className = "" }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => parseDeliveryNote(text), [text]);
  if (!groups.length) return null;
  const total = groups.reduce((a, g) => a + g.steps.length, 0);
  const needsToggle = total > 3;
  const shown = open || !needsToggle;
  return (
    <div className={`cx-delivery ${className}`.trim()}>
      {groups.map((g, gi) => {
        const steps = shown ? g.steps : (gi === 0 ? g.steps.slice(0, 3) : []);
        if (!steps.length && !shown && gi > 0) return null;
        return (
          <section className="cx-delivery-sec" key={`${g.title}-${gi}`}>
            {g.title && <h4 className="cx-delivery-title"><ShieldCheck size={11} /> {prettyTitle(g.title)}</h4>}
            {steps.length > 0 && (
              <ol className="cx-delivery-list">
                {steps.map((step, i) => (
                  <li key={i}><span className="cx-delivery-num">{i + 1}</span><span>{step}</span></li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
      {needsToggle && (
        <button type="button" className="cx-expand-btn" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? "Sembunyikan" : "Selengkapnya"} <ChevronDown size={11} style={open ? { transform: "rotate(180deg)" } : undefined} />
        </button>
      )}
    </div>
  );
}

/* ─── Verifikasi ketersediaan nama custom email ───
   Tidak ada pengecekan manual: user klik tombol, server yang memanggil Apify. */
const CE_STATE_LABEL = {
  checking: "Mengecek...",
  available: "Tersedia",
  unknown: "Belum pasti",
  taken: "Tidak tersedia",
  invalid: "Format salah",
  error: "Gagal cek",
};
function CustomEmailChecker({ draft, setDraft, check, onVerify, onAdd, canAdd, quotaLeft, inputId, addLabel }) {
  const state = check.state || "idle";
  const busy = state === "checking";
  const canVerify = !busy && draft.trim().length >= 3 && state !== "invalid";
  const retry = state === "error" || state === "unknown";
  return (
    <div className="cx-ce-verify">
      <div className={`cx-input-wrap cx-custom-email-input is-${state}`}>
        <Mail size={13} />
        <input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="namaku99 atau namaku99@gmail.com"
          maxLength={80}
          autoComplete="off"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (canAdd) onAdd(); else if (canVerify) onVerify(); } }}
        />
        {state === "available" && <Check size={13} color="var(--green)" />}
        {(state === "taken" || state === "invalid") && <X size={13} color="var(--red)" />}
      </div>

      <button
        type="button"
        className="cx-btn cx-btn-secondary cx-btn-sm cx-btn-full cx-ce-verify-btn"
        disabled={!canVerify}
        onClick={onVerify}
      >
        {busy
          ? <><Spinner size={12} /> Mengecek ketersediaan...</>
          : <><ShieldCheck size={12} /> {retry ? "Coba lagi" : "Cek ketersediaan"}</>}
      </button>

      {state !== "idle" && state !== "ready" && state !== "checking" && (
        <div className={`cx-ce-status is-${state}`}>
          <span className="cx-ce-status-badge">
            {state === "available" && <Check size={11} />}
            {(state === "taken" || state === "invalid") && <X size={11} />}
            {state === "unknown" && <CircleHelp size={11} />}
            {state === "error" && <RefreshCw size={11} />}
            {busy && <Spinner size={11} />}
            {CE_STATE_LABEL[state] || state}
          </span>
          <p>{check.message}</p>
        </div>
      )}
      {(state === "idle" || state === "ready") && (
        <small className="cx-custom-email-msg is-ready">
          {check.message || `+${formatPrice(CUSTOM_EMAIL_FEE)} per nama · sisa ${quotaLeft} slot.`}
        </small>
      )}
      {Array.isArray(check.signals) && check.signals.length > 0 && (state === "available" || state === "taken" || state === "unknown") && (
        <ul className="cx-ce-signals">
          {check.signals.map((sig, i) => <li key={i}><Check size={10} /><span>{sig}</span></li>)}
        </ul>
      )}

      <button className="cx-btn cx-btn-primary cx-btn-sm cx-btn-full" disabled={!canAdd} onClick={onAdd}>
        <Plus size={12} /> {addLabel || "Tambah ke keranjang"}
      </button>
    </div>
  );
}

/* ─── Deskripsi produk terstruktur ───
   Mengubah deskripsi panjang jadi section rapi (Tentang Produk, Yang Didapat,
   Informasi Penting, Keamanan Akun, Catatan) + bullet konsisten, dengan
   tombol Selengkapnya/Sembunyikan supaya card tidak kepanjangan di mobile. */
const DESC_KNOWN_HEADINGS = [
  "tentang produk", "tentang", "deskripsi", "yang didapat", "yang kamu dapat",
  "isi paket", "fitur", "spesifikasi", "spesifikasi produk", "detail produk",
  "informasi penting", "info penting", "penting",
  "keamanan akun", "keamanan", "garansi", "catatan", "catatan penting", "syarat", "ketentuan",
];
const DESC_HEADING_ICON = {
  "tentang produk": Package, "tentang": Package, "deskripsi": Package,
  "yang didapat": Check, "yang kamu dapat": Check, "isi paket": Check, "fitur": Check,
  "spesifikasi": FileText, "spesifikasi produk": FileText, "detail produk": FileText,
  "informasi penting": CircleHelp, "info penting": CircleHelp, "penting": CircleHelp,
  "keamanan akun": ShieldCheck, "keamanan": ShieldCheck, "garansi": ShieldCheck,
  "catatan": FileText, "catatan penting": FileText, "syarat": FileText, "ketentuan": FileText,
};
function parseProductDescription(raw) {
  const text = String(raw == null ? "" : raw).replace(/\r\n/g, "\n");
  if (!text.trim()) return [];
  // Deskripsi satu paragraf panjang tanpa baris baru → pecah per kalimat pendek.
  const lines = text.includes("\n")
    ? text.split("\n")
    : text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const sections = [];
  let cur = null;
  const ensure = () => { if (!cur) { cur = { title: "", blocks: [] }; sections.push(cur); } return cur; };
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const bullet = t.match(/^([-*\u2022\u2713\u2714\u2705\u25cf\u25aa\u2013\u2014]|\d+[.)])\s+(.+)$/);
    if (bullet) { ensure().blocks.push({ type: "li", text: bullet[2].trim() }); continue; }
    const clean = t.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*/u, "").trim();
    const bare = clean.replace(/[:：]\s*$/, "").trim();
    const known = DESC_KNOWN_HEADINGS.includes(bare.toLowerCase());
    const looksHeading = known
      || /^#{1,6}\s/.test(t)
      || (/^\*\*.+\*\*[:：]?$/.test(t))
      || (/[:：]$/.test(clean) && bare.length > 0 && bare.length <= 42 && bare.split(" ").length <= 5);
    if (looksHeading) { cur = { title: bare, blocks: [] }; sections.push(cur); continue; }
    ensure().blocks.push({ type: "p", text: clean });
  }
  return sections.filter((sec) => sec.title || sec.blocks.length);
}
export function ProductDescription({ text, compact = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const raw = String(text == null ? "" : text).trim();
  const sections = useMemo(() => parseProductDescription(raw), [raw]);
  if (!sections.length) return null;
  const blockCount = sections.reduce((a, sec) => a + sec.blocks.length + (sec.title ? 1 : 0), 0);
  const needsToggle = raw.length > (compact ? 110 : 200) || blockCount > (compact ? 3 : 5);
  const plain = sections.length === 1 && !sections[0].title;
  return (
    <div className={`cx-desc${compact ? " is-compact" : ""}${open || !needsToggle ? " is-open" : " is-collapsed"} ${className}`.trim()}>
      <div className="cx-desc-body">
        {sections.map((sec, si) => {
          const Icon = DESC_HEADING_ICON[(sec.title || "").toLowerCase()] || FileText;
          const items = sec.blocks.filter((b) => b.type === "li");
          const paras = sec.blocks.filter((b) => b.type === "p");
          return (
            <section className="cx-desc-sec" key={`${sec.title}-${si}`}>
              {sec.title && (
                <h4 className="cx-desc-title"><Icon size={11} /> {sec.title}</h4>
              )}
              {paras.map((b, i) => <p className="cx-desc-p" key={`p${i}`}>{b.text}</p>)}
              {items.length > 0 && (
                <ul className="cx-desc-list">
                  {items.map((b, i) => (
                    <li key={`l${i}`}><Check size={11} /><span>{b.text}</span></li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {needsToggle && (
        <button type="button" className="cx-expand-btn" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
          {open ? "Sembunyikan" : "Selengkapnya"} <ChevronDown size={11} style={open ? { transform: "rotate(180deg)" } : undefined} />
        </button>
      )}
    </div>
  );
}

/* ─── Skeleton baris untuk state loading daftar ─── */
export function RowSkeleton({ rows = 4 }) {
  return (
    <div className="cx-skeleton-list">
      {Array.from({ length: rows }).map((_, i) => <span key={i} className="cx-skeleton" />)}
    </div>
  );
}

/* ─── Splash saat sesi sedang diperiksa ─── */
export function SessionSplash({ title = "Menyiapkan Akun Instan", subtitle = "Memeriksa sesi kamu, sebentar ya..." }) {
  return (
    <div className="cx-splash" role="status" aria-live="polite" aria-busy="true">
      <div className="cx-splash-aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="cx-splash-grid" aria-hidden="true" />
      <div className="cx-splash-card">
        <div className="cx-splash-mark">
          <span className="cx-splash-orbit cx-splash-orbit-a" aria-hidden="true"><i /></span>
          <span className="cx-splash-orbit cx-splash-orbit-b" aria-hidden="true"><i /></span>
          <span className="cx-splash-ring" aria-hidden="true" />
          <span className="cx-splash-pulse" aria-hidden="true" />
          <span className="cx-splash-core"><img src="/brand-logo.webp" alt="Akun Instan" width="84" height="84" decoding="async" /></span>
        </div>
        <div className="cx-splash-copy">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <div className="cx-splash-bar" aria-hidden="true" />
        <div className="cx-splash-steps" aria-hidden="true">
          <span>Koneksi</span>
          <span>Sesi</span>
          <span>Beranda</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   PUBLIC LANDING ("/") — halaman informasi untuk pengunjung
   yang belum login. Tanpa bottom nav, saldo, profil, top up,
   atau elemen internal aplikasi.
════════════════════════════════════════════════════ */
const LANDING_FAQ = [
  ["Apa itu Akun Instan?", "Akun Instan adalah marketplace digital untuk akun siap pakai, Custom Email, dan berbagai akun digital lainnya. Pilih produk, lakukan pembayaran, lalu akses detail pesanan langsung dari akunmu."],
  ["Bagaimana cara membeli akun?", "Pilih produk pada katalog, lakukan checkout, selesaikan pembayaran, lalu detail akun akan terbuka otomatis di menu Pesanan."],
  ["Metode pembayaran apa yang tersedia?", "Pembayaran dapat dilakukan melalui QRIS, e-wallet (DANA, OVO, GoPay, ShopeePay), atau transfer bank melalui saldo Akun Instan."],
  ["Kapan akun saya dikirim?", "Setelah pembayaran terverifikasi, detail login langsung tersedia di akun Anda tanpa perlu menunggu konfirmasi admin."],
  ["Bisa pesan Gmail dengan nama sendiri?", "Ya. Gunakan menu Custom Email untuk memesan nama Gmail atau username sesuai keinginan Anda, lalu tim kami akan membuatkan akunnya."],
  ["Bagaimana kalau akun bermasalah?", "Ajukan klaim melalui halaman Bantuan sesuai dengan ketentuan Kebijakan Refund."],
];

/* Header publik untuk pengunjung yang belum login — tanpa saldo,
   pesanan, keranjang, atau elemen internal aplikasi. */
const PUBLIC_NAV = [
  ["store", "Beranda"],
  ["katalog", "Katalog"],
  ["custom-email", "Custom Email"],
  ["help", "Bantuan"],
  ["faq", "FAQ"],
  ["cara-beli", "Cara Beli"],
];

function PublicTopbar({ navigate, onLogin, onRegister, activePage }) {
  return (
    <>
      <header className="cx-land-top">
        <div className="cx-container cx-land-top-inner">
          <button className="cx-brand" onClick={() => navigate("store")} aria-label="Beranda Akun Instan">
            <img className="cx-brand-wordmark" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="158" height="24" decoding="async" />
          </button>
          <nav className="cx-land-top-nav" aria-label="Navigasi publik">
            {PUBLIC_NAV.map(([slug, label]) => (
              <button key={slug} className={activePage === slug ? "is-active" : ""} onClick={() => navigate(slug)}>{label}</button>
            ))}
          </nav>
          <div className="cx-land-top-auth">
            <button className="cx-btn cx-btn-ghost" onClick={onLogin}><LogIn size={13} /> Masuk</button>
            <button className="cx-btn cx-btn-primary" onClick={onRegister}><UserPlus size={13} /> Daftar</button>
          </div>
        </div>
      </header>
      {/* Navigasi publik versi mobile: pill yang bisa digeser */}
      <nav className="cx-pub-subnav" aria-label="Navigasi publik mobile">
        <div className="cx-pub-subnav-track">
          {PUBLIC_NAV.map(([slug, label]) => (
            <button key={slug} className={activePage === slug ? "is-active" : ""} onClick={() => navigate(slug)}>{label}</button>
          ))}
        </div>
      </nav>
    </>
  );
}

const HOME_BANNERS = [
  { src: "/banners/banner-akun-digital.webp?v=2", alt: "Akun Instan — akun digital siap pakai" },
  { src: "/banners/banner-custom-gmail.webp?v=2", alt: "Custom Gmail sesuai nama pilihanmu" },
  { src: "/banners/banner-promo-katalog.webp?v=2", alt: "Promo katalog akun dengan stok realtime" },
];

function HomeBannerCarousel() {
  const slides = [HOME_BANNERS[HOME_BANNERS.length - 1], ...HOME_BANNERS, HOME_BANNERS[0]];
  const [position, setPosition] = useState(1);
  const [animated, setAnimated] = useState(true);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef(null);
  const activeSlide = (position - 1 + HOME_BANNERS.length) % HOME_BANNERS.length;

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setAnimated(true);
      setPosition((current) => current + 1);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const move = (direction) => {
    setAnimated(true);
    setPosition((current) => current + direction);
  };

  const handleTransitionEnd = () => {
    if (position === 0) {
      setAnimated(false);
      setPosition(HOME_BANNERS.length);
    } else if (position === HOME_BANNERS.length + 1) {
      setAnimated(false);
      setPosition(1);
    }
  };

  const handlePointerUp = (event) => {
    if (pointerStart.current === null) return;
    const distance = event.clientX - pointerStart.current;
    pointerStart.current = null;
    if (Math.abs(distance) < 40) return;
    move(distance < 0 ? 1 : -1);
  };

  return (
    <section
      className="cx-banner-carousel"
      aria-label="Banner promosi Akun Instan"
      aria-roledescription="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onPointerDown={(event) => { pointerStart.current = event.clientX; }}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStart.current = null; }}
    >
      <div className="cx-banner-viewport">
        <div
          className={`cx-banner-track${animated ? " is-animated" : ""}`}
          style={{ transform: `translate3d(-${position * 100}%, 0, 0)` }}
          onTransitionEnd={handleTransitionEnd}
        >
          {slides.map((banner, index) => (
            <div className="cx-banner-slide" key={`${banner.src}-${index}`} aria-hidden={index !== position}>
              <img
                src={banner.src}
                alt={index === position ? banner.alt : ""}
                width="1983"
                height="793"
                draggable="false"
                decoding="async"
                fetchPriority={index === 1 ? "high" : "auto"}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="cx-banner-dots" aria-label="Pilih banner">
        {HOME_BANNERS.map((banner, index) => (
          <button
            key={banner.src}
            type="button"
            className={index === activeSlide ? "is-active" : ""}
            aria-label={`Tampilkan banner ${index + 1}`}
            aria-current={index === activeSlide ? "true" : undefined}
            onClick={() => {
              setAnimated(true);
              setPosition(index + 1);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function PublicLanding({ navigate, onLogin, onRegister, totalAccounts, loading }) {
  return (
    <div className="cx-app cx-land">
      <PublicTopbar navigate={navigate} onLogin={onLogin} onRegister={onRegister} activePage="store" />

      <main>
        <section className="cx-hero cx-hero-modern">
          <div className="cx-hero-glow" aria-hidden="true" />
          <div className="cx-container cx-hero-inner">
            <div className="cx-hero-badge">
              <span className="cx-hero-pulse" />
              Stok tersedia · {loading ? "memuat" : `${totalAccounts} akun`}
            </div>
            <div className="cx-kicker">AKUN INSTAN</div>
            <h1>Akun digital.<br /><em>Siap pakai.</em></h1>
            <p className="cx-hero-sub">Pilih akun dari katalog nyata, bayar, dan detail login dikirim otomatis setelah pembayaran berhasil.</p>
            <div className="cx-hero-actions">
              <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
                Lihat Katalog <ArrowRight size={13} />
              </button>
              <button className="cx-btn cx-btn-ghost" onClick={() => navigate("help")}>
                Cara Beli
              </button>
            </div>
          </div>
        </section>
        <HomeBannerCarousel />
        <h1 className="cx-seo-only">Akun Instan — akun digital siap pakai dan Custom Gmail</h1>
        <p className="cx-seo-only">Jual beli akun Gmail fresh (no-PVA), custom Gmail sesuai nama, akun Google, dan akun digital lainnya dengan harga murah dan proses instan.</p>

        <section className="cx-container cx-land-section" aria-labelledby="layanan">
          <h2 id="layanan" className="cx-land-h2">Layanan Akun Instan</h2>
          <div className="cx-land-grid">
            <article className="cx-land-card">
              <span className="cx-land-icon"><Package size={16} /></span>
              <h3>Katalog Akun</h3>
              <p>Semua akun tampil real-time, lengkap dengan tipe login dan harga transparan.</p>
            </article>
            <article className="cx-land-card">
              <span className="cx-land-icon"><Mail size={16} /></span>
              <h3>Custom Email</h3>
              <p>Pesan Gmail atau username sesuai nama kamu, dibuatkan langsung oleh tim Akun Instan.</p>
            </article>
            <article className="cx-land-card">
              <span className="cx-land-icon"><CreditCard size={16} /></span>
              <h3>Cara Pembelian</h3>
              <p>Pilih produk, checkout, lalu bayar — akun langsung dikirim otomatis.</p>
            </article>
            <article className="cx-land-card">
              <span className="cx-land-icon"><ShieldCheck size={16} /></span>
              <h3>Aman &amp; Otomatis</h3>
              <p>Pembayaran diverifikasi sistem dan detail login baru terbuka setelah pembayaran berhasil.</p>
            </article>
          </div>
        </section>

        <section className="cx-container cx-land-section" aria-labelledby="cara-beli">
          <h2 id="cara-beli" className="cx-land-h2">Empat langkah pembelian</h2>
          <ol className="cx-land-steps">
            <li><strong>Pilih produk</strong><span>Telusuri katalog, pilih akun yang kamu butuhkan.</span></li>
            <li><strong>Checkout</strong><span>Masuk atau daftar, lalu konfirmasi pesanan.</span></li>
            <li><strong>Pembayaran</strong><span>Bayar via QRIS, e-wallet, atau transfer bank.</span></li>
            <li><strong>Akun dikirim</strong><span>Detail akun terbuka otomatis setelah pembayaran.</span></li>
          </ol>
        </section>

        <section className="cx-container cx-land-section" aria-labelledby="faq">
          <h2 id="faq" className="cx-land-h2">FAQ &amp; Bantuan</h2>
          <div className="cx-land-faq">
            {LANDING_FAQ.map(([q, a]) => (
              <details key={q} className="cx-land-faq-item">
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
          <button className="cx-btn cx-btn-secondary cx-land-faq-cta" onClick={() => navigate("help")}>
            <CircleHelp size={13} /> Lihat semua bantuan
          </button>
        </section>

      </main>

      <footer className="cx-footer">
        <div className="cx-container cx-footer-inner">
          <div className="cx-footer-top">
            <div className="cx-footer-brand">
              <img className="cx-brand-wordmark cx-brand-wordmark-footer" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="132" height="20" loading="lazy" decoding="async" />
              <p>Marketplace akun digital &amp; Custom Email.</p>
            </div>
            <nav className="cx-footer-col" aria-label="Navigasi">
              <strong>Navigasi</strong>
              <button onClick={() => navigate("katalog")}>Katalog</button>
              <button onClick={() => navigate("custom-email")}>Custom Email</button>
              <button onClick={() => navigate("help")}>Bantuan</button>
            </nav>
            <nav className="cx-footer-col" aria-label="Informasi">
              <strong>Informasi</strong>
              <button onClick={() => navigate("terms")}>Syarat &amp; Ketentuan</button>
              <button onClick={() => navigate("privacy")}>Kebijakan Privasi</button>
              <button onClick={() => navigate("refund")}>Kebijakan Refund</button>
            </nav>
          </div>
          <p className="cx-footer-copy">© {new Date().getFullYear()} Akun Instan. Seluruh transaksi tunduk pada Syarat &amp; Ketentuan.</p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   APP ROOT
════════════════════════════════════════════════════ */
const PAGE_PATHS = ["admin", "katalog", "orders", "help", "faq", "cara-beli", "account", "topup", "custom-email", "terms", "privacy", "refund", "disclaimer", ...CATEGORY_SLUGS];
// Halaman publik: bisa dibuka tanpa login dan boleh di-crawl Google.
export const PUBLIC_PAGES = ["store", "katalog", "custom-email", "help", "faq", "cara-beli", "terms", "privacy", "refund", "disclaimer", ...CATEGORY_SLUGS];
const PAGE_LABELS = {
  store: "Beranda", katalog: "Katalog", "custom-email": "Custom Email", help: "Bantuan",
  faq: "FAQ", "cara-beli": "Cara Beli", orders: "Pesanan", account: "Akun", topup: "Top Up",
  terms: "Syarat & Ketentuan", privacy: "Kebijakan Privasi", refund: "Kebijakan Refund",
  disclaimer: "Disclaimer", admin: "Admin Panel",
  ...Object.fromEntries(CATEGORY_SLUGS.map((s) => [s, CATEGORY_PAGES[s].label])),
};
/* ─── Halaman detail produk: setiap listing punya URL pendek & rapi ───
   Contoh: /produk/akun/google, /produk/akun/facebook, /produk/akun/tiktok */
export const PRODUCT_PATH_PREFIX = "produk/akun";
export const slugifyText = (value) =>
  String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "akun";

/* Nama platform utama dikenali dari judul/tipe login agar URL tetap singkat. */
const BRAND_SLUGS = [
  [/mobile\s*legend|\bmlbb\b|\bml\b/, "mobile-legends"],
  [/free\s*fire|\bff\b/, "free-fire"],
  [/gmail|google/, "google"],
  [/facebook|\bfb\b/, "facebook"],
  [/instagram|\big\b/, "instagram"],
  [/tiktok/, "tiktok"],
  [/twitter|\bx\b/, "twitter"],
  [/telegram/, "telegram"],
  [/whats\s*app|\bwa\b/, "whatsapp"],
  [/discord/, "discord"],
  [/netflix/, "netflix"],
  [/spotify/, "spotify"],
  [/canva/, "canva"],
  [/chat\s*gpt|openai/, "chatgpt"],
  [/steam/, "steam"],
  [/roblox/, "roblox"],
  [/pubg/, "pubg"],
  [/genshin/, "genshin"],
  [/valorant/, "valorant"],
  [/youtube/, "youtube"],
  [/twitch/, "twitch"],
  [/linkedin/, "linkedin"],
  [/shopee/, "shopee"],
  [/yahoo/, "yahoo"],
  [/outlook|hotmail|microsoft/, "outlook"],
  [/apple|icloud/, "apple"],
];
export const productBaseSlug = (p) => {
  const hay = `${(p && p.title) || ""} ${(p && p.loginType) || ""}`.toLowerCase();
  for (const [re, slug] of BRAND_SLUGS) if (re.test(hay)) return slug;
  const words = slugifyText(p && p.title).split("-").filter(Boolean).slice(0, 2).join("-");
  return words || "akun";
};
/* Kalau ada beberapa listing pada platform yang sama, urutan kedua dst
   diberi angka: /produk/akun/google, /produk/akun/google-2, dst. */
const productSlugMap = (list) => {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const seen = {};
  const map = new Map();
  items.forEach((p) => {
    const base = productBaseSlug(p);
    seen[base] = (seen[base] || 0) + 1;
    map.set(p, seen[base] > 1 ? `${base}-${seen[base]}` : base);
  });
  return map;
};
export const productPagePath = (p, list) => {
  const slug = (list && productSlugMap(list).get(p)) || productBaseSlug(p);
  return `${PRODUCT_PATH_PREFIX}/${slug}`;
};
export const isProductPage = (page) => String(page || "").startsWith(`${PRODUCT_PATH_PREFIX}/`);
export const findProductByPage = (list, page) => {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  const slug = String(page || "").slice(PRODUCT_PATH_PREFIX.length + 1);
  const map = productSlugMap(items);
  return (
    items.find((p) => map.get(p) === slug) ||
    // URL lama (judul panjang + kode id) tetap bisa dibuka.
    items.find((p) => {
      const tail = String(p.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toLowerCase();
      return tail && slug.endsWith(tail);
    }) ||
    items.find((p) => slugifyText(p.title) === slug.replace(/-[a-z0-9]{1,6}$/, "")) ||
    items.find((p) => productBaseSlug(p) === slug.replace(/-\d+$/, "")) ||
    null
  );
};

const pageFromPath = (pathname) => {
  const slug = String(pathname || "/").replace(/^\/+|\/+$/g, "");
  if (isProductPage(slug) && slug.length > PRODUCT_PATH_PREFIX.length + 1) return slug;
  return PAGE_PATHS.includes(slug) ? slug : "store";
};
const isPublicPage = (page) => PUBLIC_PAGES.includes(page) || isProductPage(page);
// /login dan /register punya URL sendiri agar bisa dibagikan & dikenali crawler.
const authScreenFromPath = (pathname) => {
  const slug = String(pathname || "/").replace(/^\/+|\/+$/g, "");
  if (slug === "login" || slug === "register") return slug;
  if (slug === "email-verifikasi") return "verify";
  if (slug === "status-verifikasi") return "verifystatus";
  if (slug === "lupa-password") return "forgot";
  if (slug === "reset-password") return "reset";
  return "welcome";
};

const RESEND_COOLDOWN_SEC = 60;
/* Timer kirim ulang: deadline disimpan di sessionStorage supaya refresh
   halaman tidak mereset jeda 60 detik. */
function useSendCooldown(storageKey) {
  const readLeft = () => {
    try {
      const until = Number(window.sessionStorage.getItem(storageKey)) || 0;
      return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    } catch (_) { return 0; }
  };
  const [left, setLeft] = useState(readLeft);
  useEffect(() => {
    if (left <= 0) return;
    const id = window.setInterval(() => setLeft(readLeft()), 1000);
    return () => window.clearInterval(id);
  }, [left, storageKey]);
  const start = (seconds = RESEND_COOLDOWN_SEC) => {
    const secs = Math.max(1, Math.round(Number(seconds) || RESEND_COOLDOWN_SEC));
    try { window.sessionStorage.setItem(storageKey, String(Date.now() + secs * 1000)); } catch (_) {}
    setLeft(secs);
  };
  return [left, start];
}

const VERIFY_PENDING_KEY = "codexa:pending-verification";
const readVerifyPending = () => {
  try {
    const raw = window.sessionStorage.getItem(VERIFY_PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.email ? parsed : null;
  } catch (_) { return null; }
};

function App() {
  const [activePage, setActivePage] = useState(() => pageFromPath(window.location.pathname));
  const [search, setSearch]   = useState("");
  // Filter katalog: urutan harga/stok/nama, umur akun (Fresh/Aged), platform.
  const [sortBy, setSortBy]   = useState("default");
  const [ageFilter, setAgeFilter] = useState("all");
  const [platFilter, setPlatFilter] = useState("all");
  const [notice, setNotice]   = useState("");
  // Isi keranjang disimpan di perangkat agar tidak hilang saat halaman di-refresh.
  const [cart, setCart]       = useState(() => {
    try {
      const raw = window.localStorage.getItem("codexa:cart");
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("codexa:cart", JSON.stringify(cart)); } catch (_) {}
  }, [cart]);
  const [cartOpen, setCartOpen] = useState(false);

  // FAB assisten disembunyikan saat drawer keranjang terbuka (mobile)
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("cx-drawer-open", cartOpen);
    return () => document.body.classList.remove("cx-drawer-open");
  }, [cartOpen]);
  const [aiOpen, setAiOpen] = useState(false);
  const [buyItem, setBuyItem]   = useState(null);
  const [buySel, setBuySel]     = useState([]);
  const [data, setData]         = useState({ products: [], loading: true, error: "" });
  const [auth, setAuth]         = useState({ user: null, loading: true });
  const [authScreen, setAuthScreen] = useState(() => authScreenFromPath(window.location.pathname)); // welcome | login | register | verify
  /* Data pendaftaran sementara (email + password) supaya halaman
     /email-verifikasi bisa memeriksa status dan langsung membuat sesi. */
  const [verifyPending, setVerifyPending] = useState(() => readVerifyPending());
  const saveVerifyPending = (payload) => {
    setVerifyPending(payload);
    try { window.sessionStorage.setItem(VERIFY_PENDING_KEY, JSON.stringify(payload)); } catch (_) {}
  };
  const clearVerifyPending = () => {
    setVerifyPending(null);
    try { window.sessionStorage.removeItem(VERIFY_PENDING_KEY); } catch (_) {}
  };
  // Halaman terakhir sebelum masuk ke layar Masuk/Daftar, dipakai tombol "Kembali".
  const [authReturn, setAuthReturn] = useState(null);
  // Animasi transisi singkat setelah login sukses sebelum masuk beranda.
  const [welcomeSplash, setWelcomeSplash] = useState(false);
  useEffect(() => {
    if (!welcomeSplash) return;
    const t = window.setTimeout(() => setWelcomeSplash(false), 1100);
    return () => window.clearTimeout(t);
  }, [welcomeSplash]);
  // Animasi singkat setiap pindah menu (bukan hanya beranda).
  const [pageSplash, setPageSplash] = useState(null);
  useEffect(() => {
    if (!pageSplash) return;
    const t = window.setTimeout(() => setPageSplash(null), 520);
    return () => window.clearTimeout(t);
  }, [pageSplash]);
  const goAuthScreen = (screen) => {
    if (screen === "login" || screen === "register") {
      setAuthReturn((prev) => (authScreen === "welcome" ? (activePage || pageFromPath(window.location.pathname)) : prev));
    }
    setAuthScreen(screen);
    if (typeof window !== "undefined") {
      const AUTH_PATHS = { welcome: "/", verify: "/email-verifikasi", verifystatus: "/status-verifikasi", forgot: "/lupa-password", reset: "/reset-password" };
      const path = AUTH_PATHS[screen] || `/${screen}`;
      window.history.pushState({}, "", path);
    }
  };
  const [menuOpen, setMenuOpen] = useState(false);
  /* Email yang dibawa dari halaman Lupa password ke form Daftar. */
  const [authPrefillEmail, setAuthPrefillEmail] = useState("");
  const [checkout, setCheckout] = useState({ loading: false, error: "", order: null });
  const [customEmails, setCustomEmails] = useState([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailCheck, setEmailCheck] = useState({ state: "idle", message: "", signals: [] });
  const EMPTY_EMAIL_PROFILE = { firstName: "", lastName: "", birthDate: "", gender: "" };
  const [emailProfile, setEmailProfile] = useState(EMPTY_EMAIL_PROFILE);
  const [customProfiles, setCustomProfiles] = useState({});
  const [customStatus, setCustomStatus] = useState({ max: CUSTOM_EMAIL_MAX, open: [], canOrder: true, loading: true });
  const noticeTimer = useRef(null);

  /* Custom email: hanya validasi format di sisi klien. Ketersediaan nama
     diverifikasi server (actor Apify) saat user menekan tombol Verifikasi. */
  useEffect(() => {
    const value = emailDraft.trim();
    if (!value) { setEmailCheck({ state: "idle", message: "", signals: [] }); return; }
    if (value.length < 3) { setEmailCheck({ state: "invalid", message: "Minimal 3 karakter", signals: [] }); return; }
    if (!/^[a-zA-Z0-9._%+-]+(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/.test(value)) {
      setEmailCheck({ state: "invalid", message: "Hanya huruf, angka, titik, - dan _ (boleh diakhiri @gmail.com)", signals: [] });
      return;
    }
    setEmailCheck({ state: "ready", message: "Klik Cek ketersediaan untuk verifikasi otomatis.", signals: [] });
  }, [emailDraft]);

  /* Verifikasi ketersediaan lewat backend (/api/orders?resource=check-email),
     yang memanggil actor Apify + cache. Token Apify tetap di server.
     verifySeq: hasil request lama diabaikan kalau user sudah mengubah nama,
     supaya status "Tersedia" tidak pernah menempel di nama yang berbeda. */
  const verifySeq = useRef(0);
  const verifyCustomEmail = async () => {
    const value = emailDraft.trim();
    if (!value || emailCheck.state === "checking") return;
    const seq = ++verifySeq.current;
    const isStale = () => verifySeq.current !== seq;
    setEmailCheck({ state: "checking", message: "Mengecek ketersediaan ke Google...", signals: [] });
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`/api/orders?resource=check-email&value=${encodeURIComponent(value)}`, {
        credentials: "same-origin",
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (isStale()) return;
      if (!res.ok) throw new Error(payload.error || `Gagal mengecek (${res.status})`);
      const signals = Array.isArray(payload.signals) ? payload.signals : [];
      const normalized = payload.normalized || value;
      if (payload.state === "invalid") {
        setEmailCheck({ state: "invalid", message: payload.reason || "Nama tidak valid", signals });
      } else if (payload.available && payload.state === "unknown") {
        setEmailCheck({ state: "unknown", message: payload.reason || "Belum bisa dipastikan", signals, normalized });
      } else if (payload.available) {
        setEmailCheck({ state: "available", message: payload.reason || "Nama masih tersedia", signals, normalized });
      } else {
        setEmailCheck({ state: "taken", message: payload.reason || "Nama sudah dipakai, coba nama lain", signals });
      }
    } catch (error) {
      if (isStale()) return;
      const aborted = error && error.name === "AbortError";
      setEmailCheck({
        state: "error",
        message: aborted
          ? "Pengecekan kelamaan (timeout). Coba lagi sebentar."
          : `Gagal menghubungi layanan pengecekan: ${error.message || "koneksi bermasalah"}`,
        signals: [],
      });
    } finally {
      window.clearTimeout(timer);
    }
  };




  const loadCustomStatus = () =>
    fetch("/api/orders?resource=custom-status", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!p) { setCustomStatus((x) => ({ ...x, loading: false })); return; }
        setCustomStatus({
          max: p.max || CUSTOM_EMAIL_MAX,
          open: Array.isArray(p.open) ? p.open : [],
          canOrder: p.canOrder !== false,
          loading: false,
        });
      })
      .catch(() => setCustomStatus((x) => ({ ...x, loading: false })));

  const loadSession = () =>
    fetch("/api/auth", { credentials: "same-origin" })
      .then((r) => r.json())
      .then(async (p) => {
        if (p.user) {
          setAuth({ user: p.user, loading: false });
          loadCustomStatus();
          return;
        }
        /* Baru kembali dari halaman login Google (mode redirect)? Tukar token ke sesi. */
        const idToken = await consumeGoogleRedirect();
        if (idToken) {
          try {
            const res = await jsonRequest("/api/auth", {
              method: "POST", body: JSON.stringify({ action: "google", idToken }),
            });
            setAuth({ user: res.user, loading: false });
            loadCustomStatus();
            return;
          } catch (_) {}
        }
        setAuth({ user: null, loading: false });
      })
      .catch(() => setAuth({ user: null, loading: false }));

  const logout = async () => {
    try { await jsonRequest("/api/auth", { method: "DELETE" }); } catch (_) {}
    signOutGoogle();
    setAuth({ user: null, loading: false });
    setAuthScreen("welcome");
    setMenuOpen(false);
    setCart([]);
    setCustomEmails([]);
    setEmailDraft("");
    setEmailCheck({ state: "idle", message: "", signals: [] });
  };

  const loadCatalog = () => {
    setData((x) => ({ ...x, loading: true, error: "" }));
    fetch("/api/data")
      .then(async (r) => { const p = await r.json(); if (!r.ok) throw new Error(p.error || "Data tidak tersedia"); return p; })
      .then((p) => setData({ products: p.products || [], loading: false, error: "" }))
      .catch((e) => setData((x) => ({ ...x, loading: false, error: e.message })));
  };

  useEffect(() => {
    const pop = () => {
      const next = pageFromPath(window.location.pathname);
      setPageSplash((prev) => prev || next);
      setActivePage(next);
      setAuthScreen(authScreenFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", pop);
    loadSession();
    loadCatalog();
    return () => window.removeEventListener("popstate", pop);
  }, []);

  const platformOptions = useMemo(() => {
    const seen = [];
    for (const p of data.products) if (p.loginType && !seen.includes(p.loginType)) seen.push(p.loginType);
    return seen;
  }, [data.products]);

  const products = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = data.products.map((p) => ({ ...p, ageInfo: productAgeInfo(p) }));
    if (q) {
      list = list.filter((p) =>
        `${p.title} ${p.description} ${p.loginType} ${p.ageInfo.kind} ${p.ageInfo.label}`.toLowerCase().includes(q),
      );
    }
    if (ageFilter !== "all") list = list.filter((p) => p.ageInfo.kind === ageFilter);
    if (platFilter !== "all") list = list.filter((p) => p.loginType === platFilter);
    const priceOf = (p) => Number(p.price) || 0;
    const stockOf = (p) => Number(p.stock) || (Array.isArray(p.accounts) ? p.accounts.length : 0);
    if (sortBy === "price-asc") list = [...list].sort((a, b) => priceOf(a) - priceOf(b));
    else if (sortBy === "price-desc") list = [...list].sort((a, b) => priceOf(b) - priceOf(a));
    else if (sortBy === "stock-desc") list = [...list].sort((a, b) => stockOf(b) - stockOf(a));
    else if (sortBy === "name-asc") list = [...list].sort((a, b) => String(a.title).localeCompare(String(b.title), "id"));
    return list;
  }, [data.products, search, sortBy, ageFilter, platFilter]);

  // Pindah halaman selalu mulai dari paling atas (window + container scroll).
  const scrollTop = () => {
    if (typeof window === "undefined") return;
    window.scrollTo(0, 0);
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  };
  // SEO: judul/meta/canonical mengikuti halaman aktif (SPA).
  const activeProduct = useMemo(
    () => (isProductPage(activePage) ? findProductByPage(data.products, activePage) : null),
    [activePage, data.products],
  );
  useEffect(() => {
    const guestScreen = !auth.user && !auth.loading && authScreen !== "welcome" ? authScreen : null;
    if (!guestScreen && isProductPage(activePage)) { applyProductSeo(activeProduct, activePage); return; }
    applySeo(guestScreen || activePage);
  }, [activePage, activeProduct, authScreen, auth.user, auth.loading]);
  useEffect(() => { applyProductSchema(data.products); }, [data.products]);

  useEffect(() => {
    scrollTop();
    const t = window.setTimeout(scrollTop, 60);
    return () => window.clearTimeout(t);
  }, [activePage]);

  const totalAccounts = useMemo(
    () => data.products.reduce((a, p) => a + (Number(p.stock) || (Array.isArray(p.accounts) ? p.accounts.length : 0)), 0),
    [data.products],
  );

  const navigate = (page) => {
    // Untuk tamu, simpan menu publik yang sedang dibuka sebelum mengarahkan
    // menu terkunci ke Login. Tombol "Kembali" lalu pulang ke menu asal,
    // bukan selalu ke halaman utama.
    if (!auth.user && !isPublicPage(page) && page !== "admin") {
      setAuthReturn(isPublicPage(activePage) ? activePage : "store");
      setAuthScreen("login");
      window.history.pushState({}, "", "/login");
      setCartOpen(false);
      setBuyItem(null);
      setMenuOpen(false);
      setCheckout({ loading: false, error: "", order: null });
      scrollTop();
      return;
    }
    window.history.pushState({}, "", page === "store" ? "/" : `/${page}`);
    if (page !== activePage) setPageSplash(page);
    setActivePage(page);
    // Pindah menu harus menutup semua panel yang sedang terbuka.
    setCartOpen(false);
    setBuyItem(null);
    setMenuOpen(false);
    // Modal "Pembayaran berhasil" juga harus ikut tertutup saat pindah menu.
    setCheckout({ loading: false, error: "", order: null });
    scrollTop();
  };
  // Timer lama dibersihkan dulu supaya notice baru tidak ikut terhapus.
  const showNotice = (msg) => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(msg);
    noticeTimer.current = window.setTimeout(() => { setNotice(""); noticeTimer.current = null; }, 2800);
  };
  useEffect(() => () => { if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);
  const requireLogin = () => {
    if (auth.user) return false;
    showNotice("Masuk dulu untuk melanjutkan pembelian");
    goAuthScreen("login");
    return true;
  };
  /* Simpan rating bintang + ulasan pembeli, lalu perbarui state lokal
     supaya tampilan langsung berubah tanpa memuat ulang katalog. */
  const rateProduct = async (product, rating, comment = "") => {
    if (!product || !product.id) return;
    if (!auth.user) {
      showNotice("Masuk dulu untuk memberi ulasan");
      goAuthScreen("login");
      return;
    }
    const text = String(comment || "").trim().slice(0, 600);
    try {
      const res = await jsonRequest("/api/data", {
        method: "POST",
        body: JSON.stringify({ listingId: product.id, rating, comment: text }),
      });
      setData((x) => ({
        ...x,
        products: x.products.map((p) =>
          p.id === product.id
            ? {
                ...p,
                myRating: res.myRating,
                myComment: res.myComment || p.myComment || "",
                ratingAvg: res.ratingAvg,
                ratingCount: res.ratingCount,
                reviews: Array.isArray(res.reviews) ? res.reviews : p.reviews,
              }
            : p,
        ),
      }));
      showNotice(text ? "Ulasanmu tersimpan" : `Rating ${rating} bintang tersimpan`);
    } catch (error) {
      showNotice(error.message || "Ulasan gagal disimpan");
    }
  };
  const addToCart  = (product, selected) => {
    if (requireLogin()) return;
    const picks = (product.accounts || []).filter((a) => selected.includes(a.index));
    const total = sumSelected(product, selected);
    setCart((c) => {
      // Gabungkan ke entri lama supaya satu listing tidak dobel di keranjang.
      const existing = c.find((item) => item.id === product.id);
      const entry = (list) => ({ ...product, selectedAccounts: list, qty: list.length || 1, price: sumSelected(product, list.map((a) => a.index)) || Number(product.price) || 0 });
      if (!existing) return [...c, entry(picks)];
      const seen = new Set((existing.selectedAccounts || []).map((a) => a.index));
      const mergedPicks = [...(existing.selectedAccounts || []), ...picks.filter((a) => !seen.has(a.index))]
        .sort((a, b) => a.index - b.index);
      return c.map((item) => (item.id === product.id ? entry(mergedPicks) : item));
    });
    showNotice(`${product.title} (${picks.length || 1} akun) ditambahkan`);
    setBuyItem(null);
  };
  const removeFromCart = (i) => setCart((c) => c.filter((_, idx) => idx !== i));

  /* ── checkout: bayar pakai saldo, akun langsung dikirim ── */
  const itemsTotal = cart.reduce((a, c) => a + (Number(c.price) || 0), 0);
  const customFee = customEmails.length * CUSTOM_EMAIL_FEE;
  const cartTotal = itemsTotal + customFee;
  const userBalance = Number(auth.user && auth.user.balance) || 0;
  const insufficientBalance = cartTotal > 0 && cartTotal > userBalance;
  const shortfall = Math.max(0, cartTotal - userBalance);
  const customQuotaLeft = Math.max(0, (customStatus.max || CUSTOM_EMAIL_MAX) - customEmails.length);
  const customBlocked = !customStatus.canOrder;
  const emailProfileReady = isCustomProfileComplete(emailProfile);
  const canAddCustom = (emailCheck.state === "available" || emailCheck.state === "unknown")
    && emailProfileReady && !customBlocked && customQuotaLeft > 0;

  const addCustomEmail = () => {
    if (requireLogin()) return;
    const value = String(emailCheck.normalized || emailDraft).trim().toLowerCase();
    if (!value) return;
    if (emailCheck.state !== "available" && emailCheck.state !== "unknown") {
      showNotice("Verifikasi ketersediaan nama dulu");
      return;
    }
    if (customBlocked) { showNotice("Selesaikan dulu permintaan custom email sebelumnya"); return; }
    if (customEmails.length >= (customStatus.max || CUSTOM_EMAIL_MAX)) {
      showNotice(`Maksimal ${customStatus.max || CUSTOM_EMAIL_MAX} custom email dalam 1 tugas`);
      return;
    }
    if (customEmails.some((v) => v.toLowerCase() === value)) { showNotice("Nama itu sudah ada di daftar"); return; }
    if (!isCustomProfileComplete(emailProfile)) {
      showNotice("Lengkapi nama depan, nama belakang, tanggal lahir & jenis kelamin");
      return;
    }
    const profile = {
      firstName: emailProfile.firstName.trim(),
      lastName: emailProfile.lastName.trim(),
      birthDate: emailProfile.birthDate,
      gender: emailProfile.gender,
    };
    setCustomEmails((list) => [...list, value]);
    setCustomProfiles((map) => ({ ...map, [value]: profile }));
    setEmailDraft("");
    setEmailProfile(EMPTY_EMAIL_PROFILE);
    setEmailCheck({ state: "idle", message: "", signals: [] });
    showNotice("Custom email masuk keranjang");
  };
  const removeCustomEmail = (value) => {
    setCustomEmails((list) => list.filter((v) => v !== value));
    setCustomProfiles((map) => {
      const next = { ...map };
      delete next[value];
      return next;
    });
  };
  /* Hapus satu akun tertentu dari keranjang lewat tombol X. */
  const removeCartAccount = (i, accIndex) => {
    setCart((c) => c.map((item, idx) => {
      if (idx !== i) return item;
      const list = (item.selectedAccounts || []).filter((a) => a.index !== accIndex);
      if (!list.length) return null;
      return { ...item, selectedAccounts: list, qty: list.length, price: sumSelected(item, list.map((a) => a.index)) || 0 };
    }).filter(Boolean));
    showNotice("1 akun dihapus dari keranjang");
  };
  const doCheckout = async () => {
    if (checkout.loading) return;
    if (requireLogin()) return;
    const wantCustom = customEmails.length;
    const items = cart.map((item) => ({
      id: item.id,
      accounts: (item.selectedAccounts || []).map((a) => a.index),
    })).filter((item) => item.accounts.length);
    // Custom email boleh dibeli sendirian tanpa akun di keranjang.
    if (!items.length && !wantCustom) {
      setCheckout({ loading: false, error: "Keranjang masih kosong", order: null });
      return;
    }
    // Validasi saldo di klien; server tetap memvalidasi ulang secara atomik.
    const balanceNow = Number(auth.user && auth.user.balance) || 0;
    if (cartTotal > balanceNow) {
      setCheckout({
        loading: false,
        order: null,
        error: `Saldo tidak cukup. Kurang ${formatPrice(cartTotal - balanceNow)}. Top up dulu atau kurangi pembelian.`,
      });
      return;
    }
    setCheckout({ loading: true, error: "", order: null });
    try {
      const result = await jsonRequest("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          items,
          customEmails,
          customProfiles: customEmails.map((value) => ({ email: value, ...(customProfiles[value] || {}) })),
        }),
      });
      setCart([]);
      setCustomEmails([]);
      setCustomProfiles({});
      setEmailDraft("");
      setEmailProfile(EMPTY_EMAIL_PROFILE);
      setEmailCheck({ state: "idle", message: "", signals: [] });
      setCartOpen(false);
      setCheckout({ loading: false, error: "", order: result.order });
      loadSession();
      loadCatalog();
      loadCustomStatus();
      window.dispatchEvent(new Event("codexa:notify"));
      showNotice(wantCustom && !items.length
        ? "Permintaan custom email berhasil dibayar"
        : "Pembayaran berhasil, detail akun sudah terbuka");
    } catch (error) {
      setCheckout({ loading: false, error: error.message, order: null });
    }
  };



  /* ── admin page ── */
  if (activePage === "admin") {
    return (
      <Suspense fallback={<SessionSplash title="Menyiapkan panel admin" subtitle="Memuat data admin, sebentar ya..." />}>
        <AdminPage onBack={() => navigate("store")} onNotice={showNotice} />
      </Suspense>
    );
  }

  /* ── auth gate: tampilkan splash sampai sesi diketahui (cegah kedip
     halaman internal saat refresh, baik tamu maupun user login) ── */
  if (auth.loading) return <SessionSplash />;
  /* Link dari email hanya menampilkan info status; user melanjutkan di tab
     sebelumnya lewat tombol "Saya sudah verifikasi". */
  if (authScreen === "verifystatus") {
    return <VerifyStatusPage onBackToLogin={() => goAuthScreen(auth.user ? "welcome" : "login")} loggedIn={Boolean(auth.user)} />;
  }
  if (welcomeSplash) {
    return <SessionSplash title="Berhasil masuk" subtitle="Mengarahkan kamu ke beranda..." />;
  }
  if (pageSplash) {
    return <SessionSplash title={`Membuka ${PAGE_LABELS[pageSplash] || "halaman"}`} subtitle="Sebentar ya, halaman sedang disiapkan..." />;
  }
  if (!auth.user && !auth.loading) {
    // Layar Masuk/Daftar hanya muncul saat diminta (klik tombol yang butuh login).
    if (authScreen === "forgot") {
      return (
        <ForgotPasswordPage
          onBackToLogin={() => goAuthScreen("login")}
          onRegister={(mail) => { setAuthPrefillEmail(mail || ""); goAuthScreen("register"); }}
        />
      );
    }
    if (authScreen === "reset") {
      return (
        <ResetPasswordPage
          onAuthenticated={(user) => {
            setAuth({ user, loading: false });
            setAuthScreen("welcome");
            setAuthReturn(null);
            navigate("store");
            setWelcomeSplash(true);
          }}
          onBackToLogin={() => goAuthScreen("login")}
        />
      );
    }
    if (authScreen === "verify") {
      return (
        <VerifyEmailPage
          pending={verifyPending}
          onAuthenticated={(user) => {
            clearVerifyPending();
            setAuth({ user, loading: false });
            setAuthScreen("welcome");
            setAuthReturn(null);
            navigate("store");
            setWelcomeSplash(true);
          }}
          onBackToLogin={() => {
            clearVerifyPending();
            goAuthScreen("login");
          }}
        />
      );
    }
    if (authScreen === "login" || authScreen === "register" || !isPublicPage(activePage)) {
      return (
        <AuthPage
          initialMode={authScreen === "register" ? "register" : "login"}
          initialEmail={authPrefillEmail}
          onForgotPassword={() => goAuthScreen("forgot")}
          onAuthenticated={(user) => {
            setAuth({ user, loading: false });
            setAuthScreen("welcome");
            setAuthReturn(null);
            navigate("store");
            setWelcomeSplash(true);
          }}
          onVerificationSent={({ email, password, message }) => {
            saveVerifyPending({ email, password, message });
            goAuthScreen("verify");
          }}
          onBackToWelcome={() => {
            // Kembali ke halaman sebelumnya (bukan selalu beranda).
            const target = isPublicPage(authReturn) ? authReturn : "store";
            setAuthScreen("welcome");
            setAuthReturn(null);
            navigate(target);
          }}
        />
      );
    }
    // Root "/" untuk tamu = landing publik (SEO), bukan dashboard.
    if (activePage === "store") {
      return (
        <PublicLanding
          navigate={navigate}
          onLogin={() => goAuthScreen("login")}
          onRegister={() => goAuthScreen("register")}
          totalAccounts={totalAccounts}
          loading={data.loading}
        />
      );
    }
    // Halaman publik SEO (katalog, custom-email, help, legal) tetap dirender apa adanya.
  }

  // Tamu (belum login) memakai kerangka publik: header publik, tanpa bottom
  // nav / saldo / pesanan. Halaman setelah login hanya untuk user yang masuk.
  const guest = !auth.user;
  const shellClass = guest ? "cx-app cx-land" : "cx-app";

  const topbar = guest ? (
    <PublicTopbar
      navigate={navigate}
      activePage={activePage}
      onLogin={() => goAuthScreen("login")}
      onRegister={() => goAuthScreen("register")}
    />
  ) : (
    <StoreTopbar
      activePage={activePage} navigate={navigate} cart={cart}
      onCartOpen={() => setCartOpen(true)}
      user={auth.user} menuOpen={menuOpen} setMenuOpen={setMenuOpen} onLogout={logout}
      onLogin={() => goAuthScreen("login")}
    />
  );

  const tabbar = guest ? null : (
    <MobileTabBar activePage={activePage} navigate={navigate} cart={cart} cartOpen={cartOpen} onCartOpen={() => setCartOpen(true)} />
  );

  /* Overlay global: dirender di SEMUA halaman supaya keranjang, modal beli,
     asisten, dan toast tetap bisa dibuka dari menu mana pun. */
  const overlays = (
    <>
      {/* Buy modal */}
      {buyItem && (
        <div className="cx-modal-backdrop" onClick={() => setBuyItem(null)}>
          <div className="cx-modal cx-buy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cx-buy-visual" style={{ background: `${ACCENT_COLORS[products.indexOf(buyItem) % ACCENT_COLORS.length]}11` }}>
              <div className="cx-buy-visual-mono">DIGITAL ACCOUNT · {buyItem.loginType}</div>
              <div className="cx-buy-symbol">
                <ProviderIcon type={buyItem.loginType} size={64} />
              </div>
              <div className="cx-buy-visual-mono">{buyItem.stock} STOK TERSEDIA</div>
            </div>
            <div className="cx-buy-body">
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button className="cx-icon-btn" onClick={() => setBuyItem(null)}><X size={14} /></button>
              </div>
              <p style={{ color: "var(--faint)", fontSize: 10, fontFamily: "ui-monospace,monospace", letterSpacing: ".1em", textTransform: "uppercase", margin: "4px 0 6px", display: "flex", alignItems: "center", gap: 6 }}>
                <ProviderIcon type={buyItem.loginType} size={14} />
                {buyItem.loginType}
              </p>
              <h2 style={{ margin: "0 0 8px", font: "600 20px Inter", letterSpacing: "-.03em" }}>{buyItem.title}</h2>
              <ProductDescription
                className="cx-desc-modal"
                text={buyItem.description || "Akun digital siap digunakan. Detail dikirim setelah pembayaran."}
              />
              <ul className="cx-feature-list">
                <li><Check size={13} /><span>Login type: <strong style={{ color: "var(--ink2)" }}>{buyItem.loginType}</strong></span></li>
                <li><Check size={13} /><span>Stok tersisa: <strong style={{ color: "var(--ink2)" }}>{buyItem.stock}</strong></span></li>
                <li><Check size={13} /><span>Detail akun dikirim otomatis setelah verifikasi</span></li>
                <li><Check size={13} /><span>Garansi penggantian jika akun bermasalah</span></li>
              </ul>
              {Array.isArray(buyItem.accounts) && buyItem.accounts.length > 0 && (
                <AccountPicker
                  product={buyItem}
                  accounts={buyItem.accounts}
                  selected={buySel}
                  pageSize={5}
                  size="lg"
                  onToggle={(idx) => setBuySel((prev) => prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx])}
                />
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                <label style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600 }}>Jumlah akun dipilih: {buySel.length}</label>
                <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setBuySel((buyItem.accounts || []).map((a) => a.index))}>Pilih semua</button>
                <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setBuySel([])}>Kosongkan</button>
              </div>
              <div className="cx-buy-foot">
                <div className="cx-buy-price">
                  <small>Total harga</small>
                  <strong>{formatPrice(sumSelected(buyItem, buySel))}</strong>
                </div>
                <button className="cx-btn cx-btn-primary" disabled={buySel.length === 0} onClick={() => addToCart(buyItem, buySel)}>
                  <ShoppingBag size={13} /> Tambah ke keranjang
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cart drawer */}
      {cartOpen && (
        <div className="cx-drawer-backdrop" onClick={() => setCartOpen(false)}>
          <div className="cx-cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cx-drawer-header">
              <div>
                <h2>Keranjang</h2>
                <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 11 }}>{cart.length + customEmails.length} item</p>
              </div>
              <button className="cx-icon-btn" onClick={() => setCartOpen(false)}><X size={14} /></button>
            </div>
            <div className="cx-cart-body">
              {cart.length === 0 && !customEmails.length && (
                <div className="cx-empty" style={{ paddingTop: 18 }}><Package size={24} /><h3>Keranjang kosong</h3><p>Tambahkan akun dari katalog atau pesan custom email.</p></div>
              )}
              <>
                  {cart.map((item, i) => (
                    <div key={i} className="cx-cart-item">
                      <div className="cx-cart-thumb cx-cart-thumb-icon">
                        <ProviderIcon type={item.loginType} size={20} />
                      </div>
                      <div className="cx-cart-item-copy">
                        <strong>{item.title}</strong>
                        <small>{item.qty ? `${item.qty} akun · ` : ""}{formatPrice(item.price)}</small>
                        {(item.selectedAccounts || []).length > 0 && (
                          <div className="cx-cart-picks">
                            {item.selectedAccounts.map((a) => (
                              <span className="cx-cart-pick" key={a.index}>
                                <code>{a.maskedEmail || `Akun #${a.index}`}</code>
                                <button
                                  className="cx-cart-pick-x"
                                  aria-label={`Hapus akun #${a.index}`}
                                  onClick={() => removeCartAccount(i, a.index)}
                                ><X size={11} /></button>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button className="cx-icon-btn" aria-label="Hapus semua akun listing ini" onClick={() => removeFromCart(i)}><X size={12} /></button>
                    </div>
                  ))}
                  {customEmails.map((value) => (
                    <div key={value} className="cx-cart-item">
                      <div className="cx-cart-thumb cx-cart-thumb-icon"><Mail size={20} /></div>
                      <div className="cx-cart-item-copy">
                        <strong>Custom Email</strong>
                        <small>{value} · {formatPrice(CUSTOM_EMAIL_FEE)}</small>
                      </div>
                      <button className="cx-icon-btn" onClick={() => removeCustomEmail(value)} aria-label="Hapus custom email"><X size={12} /></button>
                    </div>
                  ))}

                  {customEmails.length > 0 && (
                    <p className="cx-cart-ce-note">
                      <Mail size={11} /> Nama custom email ditambahkan dari menu <strong>Custom Email</strong>.
                    </p>
                  )}
                  <button
                    type="button"
                    className="cx-btn cx-btn-secondary cx-btn-sm cx-btn-full cx-cart-ce-link"
                    onClick={() => { setCartOpen(false); navigate("custom-email"); }}
                  >
                    <Mail size={12} /> Pesan custom email <ArrowRight size={12} />
                  </button>
              </>
            </div>
            {(cart.length > 0 || customFee > 0) && (

              <div className="cx-cart-summary">
                {cart.length > 0 && (
                  <div><span>Subtotal ({cart.reduce((a, c) => a + (Number(c.qty) || 1), 0)} akun)</span><strong>{formatPrice(itemsTotal)}</strong></div>
                )}
                {customFee > 0 && (
                  <div><span>Custom email ({customEmails.length}x)</span><strong>{formatPrice(customFee)}</strong></div>
                )}
                <div><span>Total</span><strong>{formatPrice(cartTotal)}</strong></div>
                <div><span>Saldo kamu</span><strong>{formatPrice(auth.user ? auth.user.balance : 0)}</strong></div>
                {!insufficientBalance && (
                  <p className="cx-checkout-note"><ShieldCheck size={11} /> Saldo dipotong otomatis, detail akun langsung terbuka</p>
                )}
                {insufficientBalance && (
                  <div className="cx-balance-warn">
                    <div className="cx-balance-warn-head">
                      <CircleHelp size={13} />
                      <strong>Saldo kamu tidak cukup</strong>
                    </div>
                    <p>
                      Total belanja {formatPrice(cartTotal)}, saldo tersedia {formatPrice(userBalance)}.
                      Kurang <strong>{formatPrice(shortfall)}</strong>.
                    </p>
                    <div className="cx-balance-warn-actions">
                      <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => { setCartOpen(false); navigate("topup"); }}>
                        <CreditCard size={12} /> Top up {formatPrice(shortfall)}
                      </button>
                    </div>
                  </div>
                )}
                {checkout.error && <p className="cx-field-error" style={{ margin: "0 0 8px" }}>{checkout.error}</p>}
                <button
                  className="cx-btn cx-btn-primary cx-btn-full"
                  disabled={checkout.loading || insufficientBalance}
                  onClick={doCheckout}
                >
                  {checkout.loading
                    ? <><Spinner size={13} /> Memproses pembayaran...</>
                    : insufficientBalance
                      ? <><Wallet size={13} /> Saldo kurang {formatPrice(shortfall)}</>
                      : <>Bayar {formatPrice(cartTotal)} <ArrowRight size={13} /></>}
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      <AssistantWidget
        open={aiOpen}
        onOpenChange={setAiOpen}
        guest={guest}
        onLogin={() => goAuthScreen("login")}
        onRegister={() => goAuthScreen("register")}
      />

      {checkout.order && (
        <div className="cx-modal-backdrop" onClick={() => setCheckout({ loading: false, error: "", order: null })}>
          <div className="cx-modal cx-success-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cx-success-head">
              <span className="cx-success-icon"><Check size={16} /></span>
              <div className="cx-success-title">
                <h2>Pembayaran berhasil</h2>
                <p>Detail login sudah terbuka di bawah.</p>
              </div>
              <button className="cx-icon-btn" aria-label="Tutup" onClick={() => setCheckout({ loading: false, error: "", order: null })}><X size={14} /></button>
            </div>
            <div className="cx-success-body">
              <div className="cx-success-meta">
                <div><span>Total dibayar</span><strong>{formatPrice(checkout.order.total)}</strong></div>
                <div><span>Jumlah akun</span><strong>{checkout.order.itemCount} akun</strong></div>
              </div>
              <OrderItems items={checkout.order.items} orderId={checkout.order.id} onNotice={showNotice} />
            </div>
            <div className="cx-success-foot">
              <button className="cx-btn cx-btn-primary cx-btn-full" onClick={() => { setCheckout({ loading: false, error: "", order: null }); navigate("orders"); }}>
                <Package size={13} /> Lihat pesanan saya
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="cx-toast"><Check size={14} />{notice}</div>}
    </>
  );

  if (activePage === "terms" || activePage === "privacy" || activePage === "refund" || activePage === "disclaimer") return (
    <div className={shellClass}>
      {topbar}
      <LegalPage kind={activePage} onBack={() => navigate("store")} navigate={navigate} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "account") return (
    <div className={shellClass}>
      {topbar}
      <ProfilePage user={auth.user} onBack={() => navigate("store")} onTopup={() => navigate("topup")} onSaved={(u) => setAuth({ user: u, loading: false })} onNotice={showNotice} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "topup") return (
    <div className={shellClass}>
      {topbar}
      <TopUpPage user={auth.user} onBack={() => navigate("store")} onNotice={showNotice} onRefresh={loadSession} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  /* ── simple pages ── */
  if (activePage === "orders") return (
    <div className={shellClass}>
      {topbar}
      <OrdersPage onBack={() => navigate("store")} onNotice={showNotice} navigate={navigate} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "custom-email") return (
    <div className={shellClass}>
      {topbar}
      <CustomEmailPage
        draft={emailDraft}
        setDraft={setEmailDraft}
        check={emailCheck}
        onVerify={verifyCustomEmail}
        list={customEmails}
        status={customStatus}
        quotaLeft={customQuotaLeft}
        canAdd={canAddCustom}
        blocked={customBlocked}
        onAdd={addCustomEmail}
        onRemove={removeCustomEmail}
        profile={emailProfile}
        setProfile={setEmailProfile}
        profiles={customProfiles}
        onBack={() => navigate("store")}
        onCheckout={() => { navigate("store"); setCartOpen(true); }}
      />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "help") return (
    <div className={shellClass}>
      {topbar}
      <HelpPage navigate={navigate} onAskAssistant={() => setAiOpen(true)} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "faq") return (
    <div className={shellClass}>
      {topbar}
      <FaqPage navigate={navigate} onAskAssistant={() => setAiOpen(true)} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (CATEGORY_SLUGS.includes(activePage)) return (
    <div className={shellClass}>
      {topbar}
      <CategoryPage
        slug={activePage}
        navigate={navigate}
        onOpenCatalog={(query) => { setSearch(query || ""); navigate("katalog"); }}
      />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "cara-beli") return (
    <div className={shellClass}>
      {topbar}
      <CaraBeliPage navigate={navigate} />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (isProductPage(activePage)) return (
    <div className={shellClass}>
      {topbar}
      <ProductPage
        product={activeProduct}
        loading={data.loading}
        navigate={navigate}
        onAdd={addToCart}
        canRate={!!auth.user}
        onRate={rateProduct}
      />
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  if (activePage === "katalog") return (
    <div className={`${shellClass} cx-catv2`}>
      {topbar}
            <main className="cx-container cx-cat-main" id="catalog" style={{ paddingTop: 20, paddingBottom: 64 }}>
        <div className="cx-section-header cx-section-header-stack cx-cat-header">
          <div>
            <h1>Katalog</h1>
            <p className="cx-section-sub">{data.loading ? "Memuat katalog..." : "Akun siap pakai · Stok realtime"}</p>
          </div>
          <div className="cx-search">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari akun, fresh, aged..." />
          </div>
        </div>

        {/* Filter katalog: urutan harga/stok/nama + umur akun + platform */}
        <div className="cx-filterbar">
          <div className="cx-filter-chips" role="group" aria-label="Filter umur akun">
            {CATALOG_AGES.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`cx-filter-chip${ageFilter === a.key ? " is-active" : ""}`}
                onClick={() => setAgeFilter(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="cx-filter-selects">
            <label className="cx-filter-select">
              <span className="cx-filter-label">Urutkan</span>
              <select aria-label="Urutkan produk" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {CATALOG_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="cx-filter-select">
              <span className="cx-filter-label">Platform</span>
              <select aria-label="Filter platform" value={platFilter} onChange={(e) => setPlatFilter(e.target.value)}>
                <option value="all">Semua platform</option>
                {platformOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            {(ageFilter !== "all" || platFilter !== "all" || sortBy !== "default" || search) && (
              <button
                type="button"
                className="cx-filter-reset"
                onClick={() => { setAgeFilter("all"); setPlatFilter("all"); setSortBy("default"); setSearch(""); }}
              >
                Reset filter
              </button>
            )}
          </div>
        </div>




        {data.loading && (
          <div className="cx-grid">
            {[1,2,3,4,5,6].map((i) => (
              <div key={i} style={{ border: "1px solid var(--b1)", borderRadius: 4, overflow: "hidden" }}>
                <div className="cx-skeleton" style={{ height: 110 }} />
                <div style={{ padding: 14 }}>
                  <div className="cx-skeleton" style={{ height: 10, width: "60%", marginBottom: 8 }} />
                  <div className="cx-skeleton" style={{ height: 13, marginBottom: 6 }} />
                  <div className="cx-skeleton" style={{ height: 11, width: "80%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {data.error && (
          <div className="cx-empty">
            <CircleHelp size={28} />
            <h3>Data belum bisa dimuat</h3>
            <p>{data.error}</p>
            <button className="cx-btn cx-btn-secondary" onClick={loadCatalog}><RefreshCw size={13} /> Coba lagi</button>
          </div>
        )}

        {!data.loading && !data.error && products.length === 0 && (
          <div className="cx-empty">
            <Package size={28} />
            <h3>Belum ada akun tersedia</h3>
            <p>{search ? "Tidak ada produk yang cocok dengan pencarian." : "Belum ada listing nyata di database. Panel tidak menampilkan akun contoh."}</p>
          </div>
        )}

        {!data.loading && products.length > 0 && (
          <div className="cx-grid">
            {products.map((p, i) => (
              <ProductCard
                key={p.id || i}
                product={p}
                colorIdx={i}
                onOpen={() => navigate(productPagePath(p, data.products))}
                onBuy={(sel) => { setBuyItem(p); setBuySel(Array.isArray(sel) ? sel : []); }}
              />
            ))}
          </div>
        )}
      </main>
      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}
    </div>
  );

  /* ── store page ── */
  return (
    <div className={shellClass}>
      {topbar}

      {/* Hero */}
      <section className="cx-hero cx-hero-modern">
        <div className="cx-hero-glow" aria-hidden="true" />
        <div className="cx-container cx-hero-inner">
          <div className="cx-hero-badge"><span className="cx-hero-pulse" /> Stok tersedia · {data.loading ? "memuat" : `${totalAccounts} akun`}</div>
          <div className="cx-kicker">AKUN INSTAN</div>
          <h1>Akun digital.<br /><em>Siap pakai.</em></h1>
            <p className="cx-seo-only">Jual beli akun Gmail fresh (no-PVA), custom Gmail sesuai nama, akun Google, dan akun digital lainnya dengan harga murah dan proses instan.</p>
          <p className="cx-hero-sub">Pilih akun dari katalog nyata, bayar, dan detail login dikirim otomatis setelah pembayaran berhasil.</p>
          <div className="cx-hero-actions">
            <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
              Lihat Katalog <ArrowRight size={13} />
            </button>
            <button className="cx-btn cx-btn-ghost" onClick={() => navigate("help")}>
              Cara Beli
            </button>
          </div>
        </div>

        {/* Custom email spotlight */}
        <div className="cx-container cx-ce-promo-wrap">
          <div className="cx-ce-promo">
            <div className="cx-ce-promo-copy">
              <span className="cx-ce-promo-badge"><Sparkles size={11} /> Paling dicari</span>
              <h2>Mau email dengan nama kamu sendiri?</h2>
              <p>Pesan nama Gmail/username custom — maksimal {CUSTOM_EMAIL_MAX} nama per tugas, {formatPrice(CUSTOM_EMAIL_FEE)} per nama. Admin yang buatkan akunnya, password langsung dikirim ke menu Pesanan.</p>
              <ul className="cx-ce-promo-points">
                <li><Check size={12} /> Nama sesuai permintaan kamu</li>
                <li><Check size={12} /> Password & catatan aman dari admin</li>
                <li><Check size={12} /> Progres bisa dipantau realtime</li>
              </ul>
              <button className="cx-btn cx-btn-primary" onClick={() => navigate("custom-email")}>
                <Mail size={13} /> Pesan Custom Email <ArrowRight size={13} />
              </button>
            </div>
            <div className="cx-ce-promo-visual" aria-hidden="true">
              <div className="cx-ce-promo-card">
                <span className="cx-ce-promo-card-icon"><Mail size={16} /></span>
                <strong>namakamu99@gmail.com</strong>
                <small>Siap dibuat · {formatPrice(CUSTOM_EMAIL_FEE)}</small>
              </div>
              <div className="cx-ce-promo-card is-alt">
                <span className="cx-ce-promo-card-icon"><LockKeyhole size={16} /></span>
                <strong>Password aman</strong>
                <small>Dikirim setelah akun jadi</small>
              </div>
            </div>
          </div>
        </div>

        {/* Benefits bar */}
        <div className="cx-container" style={{ marginTop: 22 }}>
          <div className="cx-benefits">
            {[
              [BadgeCheck, "Live Inventory", "Stok real-time dari database"],
              [ShieldCheck, "Credentials Protected", "Detail akun aman sampai setelah bayar"],
              [Package, "Instant Delivery", "Akun dikirim otomatis setelah verifikasi"],
            ].map(([Icon, title, desc]) => (
              <div key={title} className="cx-benefit">
                <Icon size={14} />
                <div><strong>{title}</strong>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>


      <StoreFooter navigate={navigate} guest={guest} />
      {tabbar}
      {overlays}

    </div>
  );
}

/* ═══════════════════════════════════════════════════

   ORDER RESULT / PESANAN SAYA
════════════════════════════════════════════════════ */
/* Hasil custom email untuk pembeli: nama yang dipesan, status, password akun
   Google yang dibuat admin, dan catatan tambahan. */
/* Ambil password asli dari server hanya saat pembeli menekan tampilkan/salin. */
function useSecret(fetcher, initial) {
  const [value, setValue] = useState(initial || "");
  const [loading, setLoading] = useState(false);
  const reveal = async () => {
    if (value) return value;
    setLoading(true);
    try {
      const data = await fetcher();
      const password = (data && data.password) || "";
      setValue(password);
      return password;
    } finally {
      setLoading(false);
    }
  };
  return { value, loading, reveal };
}

function CustomEmailResult({ req, onNotice }) {
  const [open, setOpen] = useState(false);
  const status = req.status || "pending";
  const hasPassword = req.hasPassword || !!req.password;
  const masked = req.maskedPassword || "•".repeat(10);
  const note = req.note || "";
  const secret = useSecret(
    () => jsonRequest("/api/orders?resource=secret", { method: "POST", body: JSON.stringify({ customId: req.id }) }),
    req.password || "",
  );
  const copy = (value, label) => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(() => onNotice(`${label} disalin`)).catch(() => {});
  };
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    try { await secret.reveal(); setOpen(true); }
    catch (e) { onNotice(e.message || "Gagal memuat password"); }
  };
  const doCopy = async () => {
    try { const v = await secret.reveal(); if (v) copy(v, "Password"); }
    catch (e) { onNotice(e.message || "Gagal memuat password"); }
  };
  return (
    <div className="cx-ce-result">
      <div className="cx-custom-email-tag">
        <Mail size={11} /> <strong>{req.requested}</strong>
        <span className={`cx-status cx-cemail-${status}`}>{CUSTOM_EMAIL_STATUS_LABEL[status]}</span>
      </div>
      {hasPassword && (
        <div className="cx-ce-result-row">
          <span className="cx-ce-result-label"><LockKeyhole size={11} /> Password</span>
          <code className="cx-mono">{open && secret.value ? secret.value : masked}</code>
          <div className="cx-ce-result-actions">
            <button className="cx-row-btn" onClick={toggle} disabled={secret.loading} aria-label="Lihat password">
              {open ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button className="cx-row-btn" onClick={doCopy} disabled={secret.loading} aria-label="Salin password">
              <Copy size={12} />
            </button>
          </div>
        </div>
      )}
      {req.profile && req.profile.firstName && (
        <p className="cx-ce-result-note"><User size={11} /> {req.profile.firstName} {req.profile.lastName} · {formatBirthDate(req.profile.birthDate)} · {CUSTOM_GENDER_LABEL[req.profile.gender] || "-"}</p>
      )}
      {note && (
        <p className="cx-ce-result-note"><FileText size={11} /> {note}</p>
      )}
    </div>
  );
}

function OrderAccountRow({ account, orderId, itemIndex, accountIndex, onNotice }) {
  const [open, setOpen] = useState(false);
  const masked = account.maskedPassword || "•".repeat(Math.min(12, String(account.password || "").length) || 8);
  const secret = useSecret(
    () => jsonRequest("/api/orders?resource=secret", {
      method: "POST",
      body: JSON.stringify({ orderId, itemIndex, accountIndex }),
    }),
    account.password || "",
  );
  const copy = (value, label) => {
    if (navigator.clipboard) navigator.clipboard.writeText(value).then(() => onNotice(`${label} disalin`)).catch(() => {});
  };
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    try { await secret.reveal(); setOpen(true); }
    catch (e) { onNotice(e.message || "Gagal memuat password"); }
  };
  const doCopy = async () => {
    try { const v = await secret.reveal(); if (v) copy(v, "Password"); }
    catch (e) { onNotice(e.message || "Gagal memuat password"); }
  };
  return (
    <div className="cx-order-cred">
      <div className="cx-order-cred-row">
        <span className="cx-order-cred-label">Email</span>
        <code>{account.email}</code>
        <button className="cx-icon-btn" aria-label="Salin email" onClick={() => copy(account.email, "Email")}><Copy size={12} /></button>
      </div>
      <div className="cx-order-cred-row">
        <span className="cx-order-cred-label">Password</span>
        <code>{open && secret.value ? secret.value : masked}</code>
        <button className="cx-icon-btn" aria-label="Tampilkan password" onClick={toggle} disabled={secret.loading}>
          {open ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
        <button className="cx-icon-btn" aria-label="Salin password" onClick={doCopy} disabled={secret.loading}><Copy size={12} /></button>
      </div>
    </div>
  );
}

function OrderItems({ items, onNotice, orderId }) {
  if (!Array.isArray(items) || !items.length) {
    return <p style={{ color: "var(--muted)", fontSize: 12 }}>Detail akun tidak tersedia.</p>;
  }
  return (
    <div className="cx-order-items">
      {items.map((item, i) => (
        <div key={`${item.listingId}-${i}`} className="cx-order-item">
          <div className="cx-order-item-head">
            <ProviderIcon type={item.loginType} size={16} />
            <strong>{item.title}</strong>
          </div>
          {(item.accounts || []).map((account, k) => (
            <OrderAccountRow
              key={`${i}-${k}`}
              account={account}
              orderId={orderId}
              itemIndex={i}
              accountIndex={k}
              onNotice={onNotice}
            />
          ))}
          {item.deliveryDetails && <DeliveryNote className="cx-order-note" text={item.deliveryDetails} />}
        </div>
      ))}
    </div>
  );
}

function OrdersPage({ onBack, onNotice, navigate }) {
  const [state, setState] = useState({ orders: [], loading: true, error: "" });
  const [confirm, confirmDialog] = useConfirmDialog();
  const [isPending, runAction] = usePendingActions();
  const load = () => {
    setState((x) => ({ ...x, loading: true }));
    jsonRequest("/api/orders")
      .then((p) => setState({ orders: p.orders || [], loading: false, error: "" }))
      .catch((e) => setState({ orders: [], loading: false, error: e.message }));
  };
  useEffect(() => { load(); }, []);

  const deleteOrder = async (id) => {
    const ok = await confirm({
      title: "Hapus pesanan ini?",
      description: "Pesanan hilang dari riwayat dan detail akunnya tidak bisa dibuka lagi. Pastikan kamu sudah menyimpan email & password-nya.",
      confirmText: "Ya, hapus",
      danger: true,
    });
    if (!ok) return;
    await runAction(`order-${id}`, async () => {
      try {
        await jsonRequest("/api/orders", { method: "DELETE", body: JSON.stringify({ id }) });
        setState((x) => ({ ...x, orders: x.orders.filter((o) => o.id !== id) }));
        onNotice("Pesanan dihapus dari riwayat");
      } catch (e) { onNotice(e.message); }
    });
  };

  return (
    <div className="cx-orders-page cx-container">
      <header className="cx-orders-hero">
        <span className="cx-orders-kicker">Riwayat pembelian</span>
        <h1>Pesanan Saya</h1>
        <p>Semua akun yang sudah kamu bayar tersimpan aman di sini.</p>
        {!state.loading && !state.error && state.orders.length > 0 && (
          <div className="cx-orders-stats">
            <div><small>Total pesanan</small><strong>{state.orders.length}</strong></div>
            <div><small>Akun dibeli</small><strong>{state.orders.reduce((a, o) => a + (Number(o.itemCount) || 0), 0)}</strong></div>
            <div><small>Total belanja</small><strong>{formatPrice(state.orders.reduce((a, o) => a + (Number(o.total) || 0), 0))}</strong></div>
          </div>
        )}
      </header>
      {state.loading && (
        <div className="cx-orders-skeleton">
          <span /><span /><span />
        </div>
      )}
      {state.error && <p className="cx-field-error">{state.error}</p>}
      {!state.loading && !state.error && state.orders.length === 0 && (
        <div className="cx-empty"><Package size={24} /><h3>Belum ada pesanan</h3><p>Beli akun dari katalog untuk mulai.</p>
          <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>Lihat katalog</button>
        </div>
      )}
      {state.orders.map((order) => (
        <article key={order.id} className="cx-order-card">
          <div className="cx-order-card-head">
            <div className="cx-order-card-id">
              <span className="cx-order-icon"><Package size={16} /></span>
              <div>
                <strong>{formatPrice(order.total)}</strong>
                <small>{order.itemCount} akun · {formatDate(order.createdAt)}</small>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`cx-order-status${order.status === "paid" ? " is-paid" : ""}`}>
                <BadgeCheck size={12} /> {order.status === "paid" ? "Lunas" : order.status}
              </span>
              <button className="cx-row-btn danger" onClick={() => deleteOrder(order.id)} aria-label="Hapus pesanan" disabled={isPending(`order-${order.id}`)}>
                {isPending(`order-${order.id}`) ? <Spinner /> : <Trash2 size={12} />}
              </button>
            </div>
          </div>
          {customEmailsOf(order).map((req) => (
            <CustomEmailResult key={req.id} req={req} onNotice={onNotice} />
          ))}
          <OrderItems items={order.items} orderId={order.id} onNotice={onNotice} />

        </article>
      ))}
      {confirmDialog}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   STORE TOPBAR
════════════════════════════════════════════════════ */

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "baru saja";
  if (min < 60) return `${min} menit lalu`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} jam lalu`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} hari lalu`;
  return new Date(then).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

const NOTIF_TONE = {
  admin: { icon: Bell, color: "var(--indigo2)" },
  topup_pending: { icon: Clock, color: "var(--amber)" },
  topup_approved: { icon: BadgeCheck, color: "var(--green)" },
  topup_rejected: { icon: X, color: "var(--red)" },
  order_paid: { icon: ShoppingBag, color: "#818cf8" },
};

/* Lonceng notifikasi: dorongan real-time dari server (SSE), tanpa jeda tetap. */
function NotificationBell({ navigate, activePage }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [pressed, setPressed] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const p = await jsonRequest("/api/notifications");
      setItems(p.notifications || []);
      setUnread(Number(p.unread) || 0);
    } catch (_) { /* diam saja, lonceng tidak boleh merusak halaman */ }
    setLoading(false);
  };

  useEffect(() => {
    let busy = false;
    let failures = 0;
    let stream = null;
    let reconnect = null;
    let closed = false;
    const sync = async () => {
      if (busy) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      busy = true;
      try {
        const p = await jsonRequest("/api/notifications");
        setItems(p.notifications || []);
        setUnread(Number(p.unread) || 0);
        failures = 0;
      } catch (_) { failures = Math.min(failures + 1, 5); }
      busy = false;
    };

    /* Dorongan real-time: server yang memberi tahu begitu ada perubahan,
       jadi tidak ada jeda tetap sama sekali (biasanya < 0,3 detik). */
    const connect = () => {
      if (closed || typeof window === "undefined" || !("EventSource" in window)) return;
      try { if (stream) stream.close(); } catch (_) {}
      stream = new EventSource("/api/stream", { withCredentials: true });
      stream.addEventListener("sync", (e) => {
        let payload = null;
        try { payload = JSON.parse(e.data || "{}"); } catch (_) {}
        if (payload && typeof payload.unread === "number") setUnread(payload.unread);
        sync();
      });
      const retry = () => {
        if (closed) return;
        try { if (stream) stream.close(); } catch (_) {}
        window.clearTimeout(reconnect);
        reconnect = window.setTimeout(connect, 1000);
      };
      stream.addEventListener("bye", retry);
      stream.onerror = retry;
    };

    load();
    connect();

    /* Jaring pengaman kalau saluran dorong terputus (jaringan seluler jelek):
       cek berkala pelan supaya hemat baterai dan kuota. */
    const timer = window.setInterval(() => {
      const live = stream && stream.readyState === 1;
      if (live && !failures) return;
      sync();
    }, 5000);
    const onFocus = () => {
      failures = 0;
      sync();
      if (!stream || stream.readyState === 2) connect();
    };
    window.appSync = onFocus;
    window.addEventListener("focus", onFocus);
    window.addEventListener("visibilitychange", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("codexa:notify", onFocus);
    return () => {
      closed = true;
      window.clearInterval(timer);
      window.clearTimeout(reconnect);
      try { if (stream) stream.close(); } catch (_) {}
      if (window.appSync === onFocus) delete window.appSync;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("visibilitychange", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("codexa:notify", onFocus);
    };
  }, []);

  // Panel notifikasi ikut tertutup begitu user pindah menu.
  useEffect(() => { setOpen(false); }, [activePage]);

  // Esc juga menutup panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => { const next = !open; setOpen(next); if (next) load(); };

  const markAll = async () => {
    try { await jsonRequest("/api/notifications", { method: "PATCH", body: JSON.stringify({}) }); } catch (_) {}
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const openItem = async (n) => {
    // Feedback sentuhan: item yang ditekan langsung ditandai aktif.
    setPressed(n.id);
    if (!n.read) {
      try { await jsonRequest("/api/notifications", { method: "PATCH", body: JSON.stringify({ id: n.id }) }); } catch (_) {}
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    }
    // Isi pesan dibuka penuh dulu lewat overlay, bukan langsung pindah halaman.
    setOpen(false);
    setDetail(n);
    window.setTimeout(() => setPressed(""), 260);
  };

  const clearAll = async () => {
    try { await jsonRequest("/api/notifications", { method: "DELETE", body: JSON.stringify({}) }); } catch (_) {}
    setItems([]); setUnread(0);
  };

  return (
    <div className="cx-notif">
      <button className="cx-notif-trigger" onClick={toggle} aria-label="Notifikasi">
        <Bell size={14} />
        {unread > 0 && <b>{unread > 9 ? "9+" : unread}</b>}
      </button>
      {open && (
        <>
          <div className="cx-account-overlay" onClick={() => setOpen(false)} />
          <div className="cx-notif-dropdown">
            <div className="cx-notif-head">
              <strong>Notifikasi</strong>
              <div className="cx-notif-head-actions">
                {unread > 0 && <button onClick={markAll}>Tandai dibaca</button>}
                {items.length > 0 && <button onClick={clearAll}>Hapus</button>}
              </div>
            </div>
            <div className="cx-notif-list">
              {loading && !items.length && <div className="cx-notif-empty">Memuat...</div>}
              {!loading && !items.length && (
                <div className="cx-notif-empty">Belum ada notifikasi. Aktivitas top up & pembelian akan muncul di sini.</div>
              )}
              {items.map((n) => {
                const tone = NOTIF_TONE[n.type] || { icon: Bell, color: "var(--muted)" };
                const ToneIcon = tone.icon;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`cx-notif-item${n.read ? "" : " is-unread"}${pressed === n.id ? " is-pressed" : ""}`}
                    onPointerDown={() => setPressed(n.id)}
                    onPointerUp={() => window.setTimeout(() => setPressed((v) => (v === n.id ? "" : v)), 160)}
                    onPointerLeave={() => setPressed((v) => (v === n.id ? "" : v))}
                    onClick={() => openItem(n)}
                  >
                    <span className="cx-notif-icon" style={{ color: tone.color }}><ToneIcon size={14} /></span>
                    <span className="cx-notif-copy">
                      <strong>{n.title}</strong>
                      <small>{n.body}</small>
                      <em>{timeAgo(n.createdAt)}</em>
                    </span>
                    {!n.read && <span className="cx-notif-dot" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      {detail && (
        <div className="cx-modal-backdrop" onClick={() => setDetail(null)}>
          <div className="cx-modal cx-notif-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cx-modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {(() => {
                  const tone = NOTIF_TONE[detail.type] || { icon: Bell, color: "var(--muted)" };
                  const ToneIcon = tone.icon;
                  return <span className="cx-notif-icon" style={{ color: tone.color }}><ToneIcon size={16} /></span>;
                })()}
                <h3 style={{ margin: 0, minWidth: 0 }}>{detail.title}</h3>
              </div>
              <button className="cx-icon-btn" onClick={() => setDetail(null)} aria-label="Tutup"><X size={14} /></button>
            </div>
            <div className="cx-notif-modal-body">
              <p>{detail.body}</p>
              <span className="cx-notif-modal-time"><Clock size={11} /> {timeAgo(detail.createdAt)}</span>
            </div>
            <div className="cx-modal-footer">
              {detail.link && (
                <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => { const link = detail.link; setDetail(null); navigate(link); }}>
                  Buka halaman <ArrowRight size={12} />
                </button>
              )}
              <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setDetail(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StoreTopbar({ activePage, navigate, cart, onCartOpen, user, menuOpen, setMenuOpen, onLogout, onLogin }) {
  const accountRef = useRef(null);
  // Klik/tap di mana pun di luar kartu profil harus menutup menunya.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (e) => { if (accountRef.current && !accountRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey); };
  }, [menuOpen, setMenuOpen]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [drawerOpen]);
  const goto = (page) => { setDrawerOpen(false); navigate(page); };
  const DRAWER_MENU = [
    ["store", "Beranda", LayoutDashboard],
    ["katalog", "Katalog Produk", ShoppingBag],
    ["custom-email", "Custom Email", Mail],
    ["orders", "Pesanan Saya", Package],
    ["topup", "Top Up Saldo", CreditCard],
    ["help", "Bantuan", CircleHelp],
  ];

  return (
    <header className="cx-topbar">
      <div className="cx-container cx-topbar-inner">
        <button className="cx-burger" onClick={() => setDrawerOpen(true)} aria-label="Buka menu">
          <Menu size={18} />
        </button>
        <button className="cx-brand" onClick={() => navigate("store")}>
          <img className="cx-brand-wordmark" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="158" height="24" decoding="async" />
        </button>
        <nav className="cx-nav">
          {[["store","Store"],["katalog","Katalog"],["orders","Pesanan"],["help","Bantuan"]].map(([page, label]) => (
            <button key={page} className={activePage === page ? "active" : ""} onClick={() => navigate(page)}>{label}</button>
          ))}
          <button
            className={`cx-custom-email-nav${activePage === "custom-email" ? " active" : ""}`}
            title="Cek dan buat request email/username custom"
            onClick={() => navigate("custom-email")}
          >
            Custom Email
          </button>
        </nav>
        <div className="cx-topbar-actions">
          <NotificationBell navigate={navigate} activePage={activePage} />
          <button className="cx-cart-btn" onClick={onCartOpen}>
            <ShoppingBag size={13} />
            {cart.length > 0 && <b>{cart.length}</b>}
            <span className="cx-cart-label">Keranjang</span>
          </button>
          <div className="cx-account-menu" ref={accountRef}>
            <button
              className="cx-account-trigger"
              onClick={() => (user ? setMenuOpen(!menuOpen) : onLogin && onLogin())}
              aria-label={user ? "Akun saya" : "Masuk ke Akun Instan"}
            >
              <UserAvatar user={user} />
              <div className="cx-account-trigger-copy">
                <strong>{user ? user.name : "Masuk"}</strong>
                <small>{user ? formatPrice(user.balance) : "Daftar gratis"}</small>
              </div>
              <ChevronDown size={12} />
            </button>
            {menuOpen && user && (
              <>
                <div className="cx-account-overlay" onClick={() => setMenuOpen(false)} />
                <div className="cx-account-dropdown">
                  <div className="cx-account-head">
                    <UserAvatar user={user} className="cx-avatar-lg" />
                    <div>
                      <strong>
                        {user && user.name}
                        <span className={`cx-role-tag${user && user.role === "admin" ? "" : " is-user"}`}>
                          {user && user.role === "admin" ? "Admin" : "User"}
                        </span>
                      </strong>
                      <small>{user && user.email}</small>
                    </div>
                  </div>
                  <div className="cx-account-balance">
                    <span><Wallet size={12} /> Saldo</span>
                    <strong>{formatPrice(user ? user.balance : 0)}</strong>
                  </div>
                  <button className="cx-account-item" onClick={() => { setMenuOpen(false); navigate("account"); }}>
                    <User size={13} /> Profil saya
                  </button>
                  <button className="cx-account-item" onClick={() => { setMenuOpen(false); navigate("topup"); }}>
                    <CreditCard size={13} /> Top up saldo
                  </button>
                  <button className="cx-account-item" onClick={() => { setMenuOpen(false); navigate("orders"); }}>
                    <Package size={13} /> Pesanan saya
                  </button>
                  <button className="cx-account-item cx-account-item-danger" onClick={onLogout}>
                    <LogOut size={13} /> Keluar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {drawerOpen && createPortal(
        <div className="cx-drawer-root">
          <div className="cx-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="cx-drawer" role="dialog" aria-label="Menu layanan">
            <div className="cx-drawer-head">
              <img className="cx-drawer-wordmark" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="132" height="20" decoding="async" />
              <button className="cx-icon-btn" onClick={() => setDrawerOpen(false)} aria-label="Tutup menu"><X size={14} /></button>
            </div>

            <div className="cx-drawer-balance">
              <span><Wallet size={12} /> Saldo kamu</span>
              <strong>{formatPrice(user ? user.balance : 0)}</strong>
              <div className="cx-drawer-balance-actions">
                <button onClick={() => goto("topup")}>Top Up</button>
                <button className="ghost" onClick={() => goto("orders")}>Riwayat</button>
              </div>
            </div>

            <p className="cx-drawer-label">Semua Layanan</p>
            <nav className="cx-drawer-nav">
              {DRAWER_MENU.map(([page, label, Icon]) => (
                <button
                  key={page}
                  className={activePage === page ? "active" : ""}
                  onClick={() => goto(page)}
                >
                  <Icon size={15} /> <span>{label}</span>
                  <ArrowRight size={12} className="cx-drawer-arrow" />
                </button>
              ))}
            </nav>

            <p className="cx-drawer-label">Akses Cepat</p>
            <nav className="cx-drawer-nav">
              <button onClick={() => goto("account")}><User size={15} /> <span>Profil Saya</span><ArrowRight size={12} className="cx-drawer-arrow" /></button>
              <button onClick={() => { setDrawerOpen(false); onCartOpen(); }}>
                <ShoppingBag size={15} /> <span>Keranjang{cart.length ? ` (${cart.length})` : ""}</span>
                <ArrowRight size={12} className="cx-drawer-arrow" />
              </button>
              {user && user.role === "admin" && (
                <button onClick={() => goto("admin")}><ShieldCheck size={15} /> <span>Panel Admin</span><ArrowRight size={12} className="cx-drawer-arrow" /></button>
              )}
            </nav>

            <div className="cx-drawer-user">
              <UserAvatar user={user} className="cx-avatar-lg" />
              <div className="cx-drawer-user-copy">
                <strong>{user ? user.name : "Akun"}</strong>
                <small>{user ? user.email : "-"}</small>
              </div>
              <button className="cx-icon-btn" onClick={onLogout} aria-label="Keluar"><LogOut size={13} /></button>
            </div>
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
}

function CustomEmailPage({ draft, setDraft, check, onVerify, list, status, quotaLeft, canAdd, blocked, onAdd, onRemove, profile, setProfile, profiles, onBack, onCheckout }) {
  const max = status.max || CUSTOM_EMAIL_MAX;
  // Slot penuh atau tugas lama belum selesai → input & tombol dikunci.
  const locked = blocked || quotaLeft === 0;
  const total = list.length * CUSTOM_EMAIL_FEE;
  const pct = Math.min(100, Math.round((list.length / max) * 100));
  const profileReady = isCustomProfileComplete(profile);
  const maxBirth = `${new Date().getFullYear() - 10}-12-31`;
  const steps = [
    { icon: Pencil, label: "Masukkan nama" },
    { icon: User, label: "Isi data pemilik akun" },
    { icon: ShieldCheck, label: "Cek ketersediaan" },
    { icon: Plus, label: "Tambahkan" },
    { icon: Wallet, label: "Bayar" },
    { icon: Zap, label: "Proses pembuatan" },
  ];
  const notes = [
    "Nama dicek otomatis ke pendaftaran Google.",
    `Maksimal ${max} nama dalam satu transaksi.`,
    "Proses pembuatan dimulai setelah pembayaran berhasil.",
    "Password & info akun dikirim lewat menu Pesanan.",
  ];
  return (
    <main className="cx-page cx-custom-page">
      <div className="cx-container cx-cev2 cx-cev3">

        {/* 1 ── HEADER PRODUK */}
        <header className="cx-cev2-hero">
          <div className="cx-cev2-hero-top">
            <span className="cx-cev2-hero-icon"><Mail size={18} /></span>
            <div className="cx-cev2-hero-copy">
              <div className="cx-cev2-hero-kicker"><Sparkles size={10} /> Layanan Premium</div>
              <h1>Custom Email</h1>
              <p>Pesan nama Gmail/username pilihanmu, dibuatkan tim Akun Instan.</p>
            </div>
          </div>
          <div className="cx-cev2-hero-meta">
            <div className="cx-cev2-price-tag">
              <b>{formatPrice(CUSTOM_EMAIL_FEE)}</b><small>/ nama</small>
            </div>
            <div className="cx-cev2-hero-limit"><ShieldCheck size={11} /> Maks {max} nama / transaksi</div>
          </div>
          <div className="cx-cev2-progress">
            <div className="cx-cev2-progress-head">
              <span>{list.length}/{max} nama ditambahkan</span>
              <b>{pct}%</b>
            </div>
            <div className="cx-cev2-bar"><i style={{ width: `${pct}%` }} /></div>
          </div>
        </header>

        {blocked && (
          <div className="cx-cev2-alert">
            <ShieldCheck size={14} />
            <div>
              <strong>Tugas sebelumnya belum selesai</strong>
              <p>Selesaikan dulu {status.open.length} permintaan ini sebelum pesan custom email baru.</p>
              <ul className="cx-cev2-open-list">
                {status.open.map((r) => (
                  <li key={r.id}>
                    <span>{r.requested}</span>
                    <em className={`cx-status cx-cemail-${r.status || "pending"}`}>{CUSTOM_EMAIL_STATUS_LABEL[r.status || "pending"]}</em>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 1 ── DATA PEMILIK AKUN (seperti form daftar Gmail) */}
        {!locked && (
          <section className="cx-cev2-card">
            <div className="cx-cev2-card-head">
              <h2><span className="cx-cev3-step">1</span> Data Pemilik Akun</h2>
              <span className={`cx-cev2-slot${profileReady ? " is-ok" : ""}`}>{profileReady ? "Lengkap" : "Wajib"}</span>
            </div>
            <div className="cx-cev2-card-body">
              <p className="cx-cev2-hint">Dipakai persis seperti form pendaftaran Gmail baru.</p>
              <div className="cx-cev2-grid2">
                <label className="cx-cev2-field">
                  <span>Nama depan</span>
                  <input
                    value={profile.firstName}
                    onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                    placeholder="Contoh: Andi"
                    maxLength={40}
                    autoComplete="off"
                  />
                </label>
                <label className="cx-cev2-field">
                  <span>Nama belakang</span>
                  <input
                    value={profile.lastName}
                    onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                    placeholder="Contoh: Saputra"
                    maxLength={40}
                    autoComplete="off"
                  />
                </label>
              </div>
              <label className="cx-cev2-field">
                <span>Tanggal lahir</span>
                <input
                  type="date"
                  value={profile.birthDate}
                  min="1920-01-01"
                  max={maxBirth}
                  onChange={(e) => setProfile((p) => ({ ...p, birthDate: e.target.value }))}
                />
              </label>
              <div className="cx-cev2-field">
                <span>Jenis kelamin</span>
                <div className="cx-cev2-gender">
                  {["male", "female", "other"].map((g) => (
                    <button
                      key={g}
                      type="button"
                      className={`cx-cev2-chip${profile.gender === g ? " is-active" : ""}`}
                      onClick={() => setProfile((p) => ({ ...p, gender: g }))}
                    >
                      {CUSTOM_GENDER_LABEL[g]}
                    </button>
                  ))}
                </div>
              </div>
              {!profileReady && (
                <small className="cx-cev2-warn"><CircleHelp size={11} /> Isi semua data di atas supaya nama bisa ditambahkan.</small>
              )}
            </div>
          </section>
        )}

        {/* 2 ── TAMBAH NAMA EMAIL */}
        {locked ? (
          <section className="cx-cev2-card cx-cev2-locked">
            <span className="cx-cev2-locked-icon"><LockKeyhole size={16} /></span>
            <div>
              <strong>{blocked ? "Pesanan baru terkunci" : `Slot penuh (${max}/${max})`}</strong>
              <p>{blocked
                ? "Selesaikan dulu permintaan custom email sebelumnya."
                : `Batas ${max} nama per transaksi sudah tercapai. Lanjut ke pembayaran.`}</p>
            </div>
          </section>
        ) : (
          <section className="cx-cev2-card">
            <div className="cx-cev2-card-head">
              <h2><span className="cx-cev3-step">2</span> Tambah Nama Email</h2>
              <span className="cx-cev2-slot">Sisa {quotaLeft} slot</span>
            </div>
            <div className="cx-cev2-card-body">
              <CustomEmailChecker
                draft={draft}
                setDraft={setDraft}
                check={check}
                onVerify={onVerify}
                onAdd={onAdd}
                canAdd={canAdd}
                quotaLeft={quotaLeft}
                addLabel={`Tambahkan nama · ${formatPrice(CUSTOM_EMAIL_FEE)}`}
              />
              <ul className="cx-cev2-rules">
                <li><Check size={10} /> 3–30 karakter, huruf kecil & angka.</li>
                <li><Check size={10} /> Boleh titik (.), tanpa spasi & simbol lain.</li>
                <li><Check size={10} /> Boleh tulis polos atau lengkap @gmail.com.</li>
              </ul>
            </div>
          </section>
        )}

        {/* 4 ── NAMA YANG DIPILIH */}
        <section className="cx-cev2-card">
          <div className="cx-cev2-card-head">
            <h2><span className="cx-cev3-step">3</span> Nama yang Dipilih</h2>
            <span className="cx-cev2-counter">{list.length}/{max}</span>
          </div>
          <div className="cx-cev2-card-body">
            {list.length === 0 ? (
              <div className="cx-cev2-empty is-compact">
                <span className="cx-cev2-empty-ic"><Mail size={13} /></span>
                <p>Belum ada nama dipilih — cek ketersediaan di Step 2, lalu tambahkan.</p>
              </div>
            ) : (
              <ul className="cx-cev2-items">
                {list.map((v, i) => (
                  <li key={v} className="cx-cev2-item">
                    <span className="cx-cev2-item-no">{i + 1}</span>
                    <div className="cx-cev2-item-main">
                      <strong>{v}</strong>
                      <em><Check size={9} /> Tersedia</em>
                      {profiles[v] && (
                        <span className="cx-cev2-item-prof">
                          {profiles[v].firstName} {profiles[v].lastName} · {formatBirthDate(profiles[v].birthDate)} · {CUSTOM_GENDER_LABEL[profiles[v].gender] || "-"}
                        </span>
                      )}
                    </div>
                    <div className="cx-cev2-item-act">
                      <button type="button" onClick={() => { setProfile(profiles[v] || { firstName: "", lastName: "", birthDate: "", gender: "" }); onRemove(v); setDraft(v); }} aria-label={`Ubah ${v}`}><Pencil size={12} /></button>
                      <button type="button" className="is-del" onClick={() => onRemove(v)} aria-label={`Hapus ${v}`}><Trash2 size={12} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 5 ── RINGKASAN PESANAN */}
        <section className="cx-cev2-card cx-cev2-summary">
          <div className="cx-cev2-card-head">
            <h2><span className="cx-cev3-step">4</span> Ringkasan Pesanan</h2>
          </div>
          <div className="cx-cev2-card-body">
            <div className="cx-cev2-sum-row"><span>Jumlah nama</span><b>{list.length} nama</b></div>
            <div className="cx-cev2-sum-row"><span>Harga per nama</span><b>{formatPrice(CUSTOM_EMAIL_FEE)}</b></div>
            <div className="cx-cev2-sum-row"><span>Status</span>
              <b className={list.length ? "is-ok" : "is-idle"}>{list.length ? "Siap dibayar" : "Belum ada nama"}</b>
            </div>
            <div className="cx-cev2-sum-total">
              <div>
                <small>{list.length} nama × {formatPrice(CUSTOM_EMAIL_FEE)}</small>
                <span>Total pembayaran</span>
              </div>
              <strong>{formatPrice(total)}</strong>
            </div>
            {/* 6 ── CTA UTAMA */}
            <button className="cx-btn cx-btn-primary cx-btn-full cx-cev2-cta" disabled={!list.length} onClick={onCheckout}>
              Lanjut ke Pembayaran <ArrowRight size={13} />
            </button>
            <button className="cx-cev2-back" type="button" onClick={onBack}>Kembali ke Beranda</button>
          </div>
        </section>

        {/* 7 ── CARA KERJA */}
        <section className="cx-cev2-card">
          <div className="cx-cev2-card-head"><h2><Zap size={13} /> Cara Kerja</h2></div>
          <ol className="cx-cev2-steps">
            {steps.map((s, i) => (
              <li key={s.label}>
                <span className="cx-cev2-step-ic"><s.icon size={12} /></span>
                <span className="cx-cev2-step-tx"><b>{i + 1}.</b> {s.label}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* 8 ── INFORMASI PENTING */}
        <section className="cx-cev2-card">
          <div className="cx-cev2-card-head"><h2><CircleHelp size={13} /> Informasi Penting</h2></div>
          <ul className="cx-cev2-notes">
            {notes.map((n) => <li key={n}><BadgeCheck size={11} /><span>{n}</span></li>)}
          </ul>
        </section>

      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════
   MOBILE TAB BAR (bottom nav)
════════════════════════════════════════════════════ */
function MobileTabBar({ activePage, navigate, cart, onCartOpen, cartOpen }) {
  const items = [
    { key: "store",   label: "Beranda", Icon: Home },
    { key: "katalog", label: "Katalog", Icon: Package },
    { key: "custom-email", label: "Email", Icon: Mail },
    { key: "account", label: "Profil",  Icon: User },
  ];
  const isTopupActive = activePage === "topup";
  return (
    <nav className="cx-tabbar" aria-label="Navigasi utama">
      {items.slice(0, 2).map(({ key, label, Icon }) => {
        const active = activePage === key && !cartOpen;
        return (
          <button
            key={key}
            className={`cx-tabbar-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            <span className="cx-tabbar-icon">
              <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
            </span>
            {label}
          </button>
        );
      })}

      <button
        className={`cx-tabbar-center${isTopupActive ? " is-active" : ""}`}
        aria-current={isTopupActive ? "page" : undefined}
        onClick={() => navigate("topup")}
        aria-label="Top Up"
      >
        <span className="cx-tabbar-center-btn">
          <Plus size={22} strokeWidth={2.6} />
        </span>
        <span className="cx-tabbar-center-label">Top Up</span>
      </button>

      {items.slice(2).map(({ key, label, Icon }) => {
        const active = activePage === key && !cartOpen;
        return (
          <button
            key={key}
            className={`cx-tabbar-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(key)}
          >
            <span className="cx-tabbar-icon">
              <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/* ═══════════════════════════════════════════════════
   STORE FOOTER
════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════
   HELP PAGE
════════════════════════════════════════════════════ */
const HELP_STEPS = [
  { title: "Isi saldo", body: "Buka menu Top Up, pilih nominal, lalu unggah bukti transfer. Saldo masuk setelah admin verifikasi." },
  { title: "Pilih akun", body: "Di halaman Toko, buka produk lalu centang akun yang mau dibeli. Harga total muncul otomatis." },
  { title: "Bayar pakai saldo", body: "Klik Beli sekarang. Saldo langsung terpotong sesuai total akun yang dipilih." },
  { title: "Ambil detail akun", body: "Email dan password akun tampil di menu Pesanan, bisa disalin kapan saja." },
];

const HELP_FAQ = [
  { q: "Berapa lama top up diproses?", a: "Umumnya di bawah 1x24 jam pada jam kerja. Status top up dapat dipantau di menu Top Up." },
  { q: "Akun yang saya beli bermasalah, bagaimana?", a: "Hubungi Assisten Akun Instan untuk melaporkan kendala. Laporan akan tersimpan dan dibalas oleh admin melalui notifikasi." },
  { q: "Bisa refund saldo?", a: "Saldo yang sudah masuk digunakan untuk pembelian akun. Untuk kasus akun yang gagal dipakai, admin akan mengganti akun atau mengembalikan saldo sesuai ketentuan." },
  { q: "Di mana melihat detail akun saya?", a: "Menu Pesanan menyimpan semua riwayat pembelian beserta kredensial akunnya." },
  { q: "Kenapa notifikasi tidak muncul?", a: "Tarik ulang halaman atau buka ikon lonceng notifikasi di kanan atas. Pesan dari admin akan masuk ke sana." },
];

function HelpPage({ navigate, onAskAssistant }) {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <main className="cx-help">
      <div className="cx-container">
        

        <section className="cx-help-hero">
          <span className="cx-help-badge"><CircleHelp size={12} /> Pusat Bantuan</span>
          <h1>Ada yang bisa kami bantu?</h1>
          <p>Panduan singkat memakai Akun Instan, mulai dari isi saldo sampai mengambil detail akun.</p>
          <div className="cx-help-cta">
            <button className="cx-btn cx-btn-primary" onClick={onAskAssistant}>
              <Sparkles size={13} /> Tanya Assisten
            </button>
            <button className="cx-btn cx-btn-ghost" onClick={() => navigate("orders")}>
              <Package size={13} /> Cek pesanan
            </button>
          </div>
        </section>

        <section className="cx-help-quick">
          {[
            { icon: Wallet, label: "Top Up saldo", desc: "Isi saldo & pantau status", page: "topup" },
            { icon: ShoppingBag, label: "Belanja akun", desc: "Lihat katalog & stok", page: "katalog" },
            { icon: Package, label: "Pesanan saya", desc: "Detail akun yang dibeli", page: "orders" },
            { icon: User, label: "Akun saya", desc: "Profil & keamanan", page: "account" },
            { icon: CircleHelp, label: "FAQ", desc: "Pertanyaan umum", page: "faq" },
            { icon: ShoppingBag, label: "Cara beli", desc: "Panduan langkah demi langkah", page: "cara-beli" },
          ].map((item) => (
            <button key={item.page} className="cx-help-quick-card" onClick={() => navigate(item.page)}>
              <span className="cx-help-quick-icon"><item.icon size={15} /></span>
              <span className="cx-help-quick-text">
                <strong>{item.label}</strong>
                <small>{item.desc}</small>
              </span>
              <ArrowUpRight size={14} className="cx-help-quick-arrow" />
            </button>
          ))}
        </section>

        <section className="cx-help-section">
          <h2>Cara belanja di Akun Instan</h2>
          <ol className="cx-help-steps">
            {HELP_STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="cx-help-step-no">{i + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="cx-help-section">
          <h2>Pertanyaan umum</h2>
          <div className="cx-help-faq">
            {HELP_FAQ.map((item, i) => {
              const open = openFaq === i;
              return (
                <div className={`cx-help-faq-item${open ? " is-open" : ""}`} key={item.q}>
                  <button onClick={() => setOpenFaq(open ? -1 : i)} aria-expanded={open}>
                    <span>{item.q}</span>
                    <ChevronDown size={15} />
                  </button>
                  {open && <p>{item.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="cx-help-contact">
          <div>
            <strong>Masih belum terjawab?</strong>
            <p>Kirim keluhanmu lewat Assisten Akun Instan. Laporan langsung masuk ke admin dan balasannya dikirim sebagai notifikasi.</p>
          </div>
          <button className="cx-btn cx-btn-primary" onClick={onAskAssistant}>
            <Send size={13} /> Kirim laporan
          </button>
        </section>
      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════
   HALAMAN FAQ (SEO: /faq)
════════════════════════════════════════════════════ */
const FAQ_PAGE_ITEMS = [
  /* Penjelasan "Apa itu Akun Instan?" sudah dijelaskan pada blok di atas,
     jadi tidak diulang lagi di daftar pertanyaan ini. */
  { q: "Apa saja yang bisa dibeli di Akun Instan?", a: "Tersedia tiga kategori layanan: (1) akun Google/Gmail siap pakai dari katalog dengan stok real-time, (2) layanan Custom Email Gmail sesuai nama yang Anda tentukan sendiri, serta (3) akun digital lain seperti akun game dan akun social media yang katalognya terus ditambah." },
  { q: "Apakah Akun Instan aman dan terpercaya?", a: "Setiap akun bergaransi login dan detail akun hanya dapat dilihat oleh pemilik pesanan. Password disimpan dalam bentuk tersamar di halaman dan baru akan ditampilkan saat Anda menekan tombol tampilkan atau salin. Jika akun gagal dipakai, admin akan mengganti akun atau mengembalikan saldo sesuai Kebijakan Refund." },
  { q: "Bagaimana cara membeli akun di Akun Instan?", a: "Isi saldo melalui menu Top Up, pilih akun di katalog, klik Beli Sekarang, lalu detail login langsung terbuka di menu Pesanan. Panduan lengkap tersedia di halaman Cara Beli." },
  { q: "Metode pembayaran apa yang tersedia?", a: "Pembayaran dapat dilakukan melalui QRIS, e-wallet (DANA, OVO, GoPay, ShopeePay), atau transfer bank melalui saldo Akun Instan." },
  { q: "Berapa lama top up diproses?", a: "Umumnya di bawah 1x24 jam pada jam kerja. Status top up dapat dipantau di menu Top Up." },
  { q: "Kapan akun saya dikirim?", a: "Setelah pembayaran terverifikasi, detail login langsung tersedia di akun Anda tanpa perlu menunggu konfirmasi admin." },
  { q: "Apakah akun yang dijual bergaransi?", a: "Ya, setiap akun bergaransi login. Sebaiknya segera ganti password setelah menerima detail akun. Jika akun gagal dipakai, admin akan mengganti akun atau mengembalikan saldo sesuai Kebijakan Refund." },
  { q: "Bisa pesan Gmail dengan nama sendiri?", a: "Ya. Gunakan menu Custom Email untuk memesan nama Gmail atau username sesuai keinginan Anda, lalu tim kami akan membuatkan akunnya." },
  { q: "Di mana melihat detail akun saya?", a: "Menu Pesanan menyimpan semua riwayat pembelian beserta kredensial akunnya dan dapat disalin kapan saja." },
  { q: "Bisa refund saldo?", a: "Saldo yang sudah masuk digunakan untuk pembelian akun. Untuk kasus akun yang gagal dipakai, admin akan mengganti akun atau mengembalikan saldo sesuai ketentuan." },
  { q: "Kenapa notifikasi tidak muncul?", a: "Tarik ulang halaman atau buka ikon lonceng notifikasi di kanan atas. Pesan dari admin akan masuk ke sana." },
  { q: "Akun yang saya beli bermasalah, bagaimana?", a: "Hubungi Assisten Akun Instan untuk melaporkan kendala. Laporan akan tersimpan dan dibalas oleh admin melalui notifikasi." },
];

function FaqPage({ navigate, onAskAssistant }) {
  const [openFaq, setOpenFaq] = useState(0);
  return (
    <main className="cx-help">
      <div className="cx-container">
        <section className="cx-help-hero">
          <span className="cx-help-badge"><CircleHelp size={12} /> FAQ</span>
          <h1>Pertanyaan yang sering ditanyakan</h1>
          <p>Jawaban lengkap seputar pembelian akun, pembayaran, garansi, dan custom email di Akun Instan.</p>
          <div className="cx-help-cta">
            <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
              <ShoppingBag size={13} /> Lihat katalog
            </button>
            <button className="cx-btn cx-btn-ghost" onClick={() => navigate("cara-beli")}>
              <CircleHelp size={13} /> Cara beli
            </button>
          </div>
        </section>

        <section className="cx-help-section cx-faq-about">
          <h2>Apa itu Akun Instan?</h2>
          <p>
            Akun Instan adalah marketplace digital untuk akun siap pakai, Custom Email, dan berbagai
            akun digital lainnya. Pilih produk, lakukan pembayaran, lalu akses detail pesanan langsung
            dari akunmu.
          </p>
          <div className="cx-faq-about-grid">
            <div className="cx-faq-about-card">
              <div className="cx-faq-about-icon"><Package size={14} /></div>
              <div className="cx-faq-about-text">
                <strong>Akun siap pakai</strong>
                <span>Stok real-time dengan harga transparan.</span>
              </div>
            </div>
            <div className="cx-faq-about-card">
              <div className="cx-faq-about-icon"><Mail size={14} /></div>
              <div className="cx-faq-about-text">
                <strong>Custom Email</strong>
                <span>Pesan Gmail dengan nama atau username pilihanmu.</span>
              </div>
            </div>
            <div className="cx-faq-about-card">
              <div className="cx-faq-about-icon"><ShieldCheck size={14} /></div>
              <div className="cx-faq-about-text">
                <strong>Instan &amp; bergaransi</strong>
                <span>Akun dikirim otomatis dan dilengkapi garansi login.</span>
              </div>
            </div>
            <div className="cx-faq-about-card">
              <div className="cx-faq-about-icon"><CreditCard size={14} /></div>
              <div className="cx-faq-about-text">
                <strong>Pembayaran lokal</strong>
                <span>QRIS, e-wallet, dan transfer bank.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="cx-help-section">
          <h2>Semua pertanyaan</h2>
          <div className="cx-help-faq">
            {FAQ_PAGE_ITEMS.map((item, i) => {
              const open = openFaq === i;
              return (
                <div className={`cx-help-faq-item${open ? " is-open" : ""}`} key={item.q}>
                  <button onClick={() => setOpenFaq(open ? -1 : i)} aria-expanded={open}>
                    <span>{item.q}</span>
                    <ChevronDown size={15} />
                  </button>
                  {open && <p>{item.a}</p>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="cx-help-contact">
          <div>
            <strong>Pertanyaanmu belum terjawab?</strong>
            <p>Kirim pertanyaan lewat Assisten Akun Instan. Pesan langsung masuk ke admin dan dibalas lewat notifikasi.</p>
          </div>
          <button className="cx-btn cx-btn-primary" onClick={onAskAssistant}>
            <Send size={13} /> Tanya admin
          </button>
        </section>
      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════
   HALAMAN CARA BELI (SEO: /cara-beli)
════════════════════════════════════════════════════ */
function CaraBeliPage({ navigate }) {
  return (
    <main className="cx-help">
      <div className="cx-container">
        <section className="cx-help-hero">
          <span className="cx-help-badge"><ShoppingBag size={12} /> Panduan</span>
          <h1>Cara beli akun di Akun Instan</h1>
          <p>Empat langkah mudah dari isi saldo sampai detail akun ada di tanganmu. Semua serba instan.</p>
          <div className="cx-help-cta">
            <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
              <ShoppingBag size={13} /> Mulai belanja
            </button>
            <button className="cx-btn cx-btn-ghost" onClick={() => navigate("faq")}>
              <CircleHelp size={13} /> Baca FAQ
            </button>
          </div>
        </section>

        <section className="cx-help-section">
          <h2>Langkah pembelian</h2>
          <ol className="cx-help-steps">
            {HELP_STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="cx-help-step-no">{i + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="cx-help-section">
          <h2>Metode pembayaran</h2>
          <ol className="cx-help-steps">
            {[
              { title: "QRIS", body: "Scan satu kode QR dari aplikasi apa pun: m-banking, DANA, OVO, GoPay, ShopeePay, dan lainnya." },
              { title: "E-Wallet", body: "Transfer langsung ke dompet digital resmi Akun Instan, lalu unggah bukti pembayaran." },
              { title: "Transfer bank", body: "Tersedia BCA, BNI, BRI, Mandiri, dan SeaBank. Saldo masuk setelah admin verifikasi bukti transfer." },
            ].map((step, i) => (
              <li key={step.title}>
                <span className="cx-help-step-no">{i + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="cx-help-section">
          <h2>Tips penting setelah membeli</h2>
          <ol className="cx-help-steps">
            {[
              { title: "Ganti password segera", body: "Setelah menerima detail login di menu Pesanan, langsung ganti password akun agar keamanan sepenuhnya di tanganmu." },
              { title: "Simpan kredensial baik-baik", body: "Detail akun tersimpan permanen di menu Pesanan, tapi sebaiknya catat juga di tempat aman milikmu." },
              { title: "Ada masalah? Lapor", body: "Gunakan Assisten Akun Instan untuk melapor. Laporan dibalas admin dan akun bermasalah diganti sesuai garansi." },
            ].map((step, i) => (
              <li key={step.title}>
                <span className="cx-help-step-no">{i + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="cx-help-contact">
          <div>
            <strong>Siap mulai belanja?</strong>
            <p>Stok akun diperbarui real-time dari database. Pilih akunmu sekarang sebelum kehabisan.</p>
          </div>
          <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
            <ArrowRight size={13} /> Buka katalog
          </button>
        </section>
      </div>
    </main>
  );
}

/* ═══════════════════════════════════════════════════
   HALAMAN LEGAL (Syarat, Privasi, Refund)
════════════════════════════════════════════════════ */
const LEGAL_CONTENT = {
  terms: {
    kicker: "Dokumen resmi",
    title: "Syarat & Ketentuan",
    intro: "Dengan mendaftar dan bertransaksi di Akun Instan, kamu dianggap sudah membaca dan menyetujui ketentuan di bawah ini.",
    sections: [
      { h: "1. Ketentuan akun pembeli", p: [
        "Satu orang hanya boleh memakai satu akun Akun Instan. Data yang didaftarkan wajib benar dan aktif, terutama email dan nomor WhatsApp.",
        "Keamanan password akun Akun Instan sepenuhnya tanggung jawab pemilik akun. Segala aktivitas yang terjadi setelah login dianggap dilakukan oleh pemilik akun.",
        "Akun Instan berhak menangguhkan atau memblokir akun yang terindikasi melakukan penipuan, chargeback, spam pembelian, atau menyalahgunakan sistem saldo.",
      ] },
      { h: "2. Saldo dan pembayaran", p: [
        "Seluruh pembelian di Akun Instan memakai saldo. Saldo diisi lewat menu Top Up dan baru masuk setelah admin memverifikasi bukti pembayaran.",
        "Permintaan top up diproses pada jam operasional. Nominal yang masuk mengikuti jumlah yang benar-benar diterima admin.",
        "Saldo yang sudah masuk tidak dapat dicairkan kembali menjadi uang tunai dan hanya bisa dipakai untuk transaksi di Akun Instan.",
      ] },
      { h: "3. Produk akun digital", p: [
        "Produk yang dijual adalah akun digital dengan stok terbatas. Stok yang ditampilkan adalah stok nyata dari database, bukan contoh.",
        "Detail login (email dan password) hanya terbuka setelah pembayaran berhasil dan dapat dilihat kapan saja di halaman Pesanan.",
        "Pembeli wajib segera mengganti password akun yang dibeli setelah menerima detail login.",
      ] },
      { h: "4. Larangan", p: [
        "Dilarang menjual ulang akun dengan klaim garansi atas nama Akun Instan tanpa izin tertulis.",
        "Dilarang memakai akun yang dibeli untuk aktivitas ilegal, penipuan, atau tindakan yang melanggar ketentuan penyedia layanan asal.",
      ] },
      { h: "5. Perubahan ketentuan", p: [
        "Akun Instan dapat memperbarui syarat dan ketentuan ini sewaktu-waktu. Versi terbaru yang tayang di halaman ini adalah versi yang berlaku.",
      ] },
    ],
  },
  privacy: {
    kicker: "Dokumen resmi",
    title: "Kebijakan Privasi",
    intro: "Kami hanya mengumpulkan data yang benar-benar dibutuhkan untuk menjalankan transaksi dan menjaga keamanan akun kamu.",
    sections: [
      { h: "1. Data yang kami kumpulkan", p: [
        "Data akun: nama, email, dan nomor WhatsApp (opsional) yang kamu isi saat mendaftar.",
        "Data transaksi: riwayat top up, riwayat pesanan, nominal, metode pembayaran, dan catatan yang kamu kirim ke admin.",
        "Data teknis dasar yang diperlukan agar sesi login tetap aman.",
      ] },
      { h: "2. Cara kami memakai data", p: [
        "Memproses pembelian, verifikasi top up, dan pengiriman detail akun.",
        "Mengirim notifikasi terkait status pesanan dan saldo di dalam aplikasi.",
        "Mendeteksi penyalahgunaan, penipuan, dan aktivitas mencurigakan.",
      ] },
      { h: "3. Keamanan data", p: [
        "Password akun Akun Instan disimpan dalam bentuk hash, bukan teks biasa.",
        "Kredensial akun yang dijual disimpan dalam bentuk terenkripsi dan hanya terbuka untuk pembeli sah setelah pembayaran.",
        "Akses admin dilindungi sesi terpisah dan tidak dibagikan ke pihak ketiga.",
      ] },
      { h: "4. Berbagi data", p: [
        "Kami tidak menjual maupun menyewakan data pribadi kamu ke pihak mana pun.",
        "Data hanya dibagikan bila diwajibkan oleh hukum yang berlaku.",
      ] },
      { h: "5. Hak kamu", p: [
        "Kamu bisa meminta perubahan atau penghapusan data akun kapan saja lewat menu Bantuan atau kontak admin.",
        "Penghapusan akun akan menghapus riwayat top up dan pesanan yang terkait secara permanen.",
      ] },
    ],
  },
  refund: {
    kicker: "Dokumen resmi",
    title: "Kebijakan Refund",
    intro: "Kami ingin transaksi berjalan adil untuk semua pihak. Berikut aturan pengembalian dana yang berlaku.",
    sections: [
      { h: "1. Refund yang disetujui", p: [
        "Akun yang dibeli tidak bisa dipakai sama sekali sejak awal (salah kredensial) dan dilaporkan maksimal 1x24 jam setelah pembelian.",
        "Terjadi kesalahan sistem sehingga saldo terpotong tetapi detail akun tidak diterima.",
      ] },
      { h: "2. Refund yang ditolak", p: [
        "Password akun sudah diganti oleh pembeli lalu terjadi masalah setelahnya.",
        "Pembeli salah membeli produk karena tidak membaca deskripsi.",
        "Laporan dikirim lewat dari batas waktu klaim.",
      ] },
      { h: "3. Bentuk pengembalian", p: [
        "Refund yang disetujui dikembalikan dalam bentuk saldo Akun Instan, bukan uang tunai.",
        "Proses peninjauan maksimal 2x24 jam sejak laporan lengkap diterima admin.",
      ] },
    ],
  },
  disclaimer: {
    kicker: "Dokumen resmi",
    title: "Disclaimer",
    intro: "Batasan tanggung jawab Akun Instan atas produk digital dan layanan yang dijual di platform ini.",
    sections: [
      { h: "1. Status platform", p: [
        "Akun Instan adalah toko digital independen yang menjual akun dan lisensi layanan pihak ketiga. Kami tidak berafiliasi, tidak disponsori, dan tidak mewakili merek mana pun yang produknya tercantum di katalog.",
        "Seluruh nama merek, logo, dan tanda dagang adalah milik pemiliknya masing-masing dan hanya dipakai sebagai keterangan produk.",
      ] },
      { h: "2. Ketersediaan layanan", p: [
        "Stok, harga, dan masa aktif produk dapat berubah sewaktu-waktu mengikuti kebijakan penyedia layanan aslinya.",
        "Kami berusaha menjaga situs tetap online, namun tidak menjamin layanan bebas gangguan, pemeliharaan, atau kendala pada penyedia pihak ketiga.",
      ] },
      { h: "3. Tanggung jawab pengguna", p: [
        "Pembeli bertanggung jawab menjaga kerahasiaan detail akun yang diterima dan tidak membagikannya ke pihak lain.",
        "Penyalahgunaan akun, pelanggaran ketentuan penyedia layanan, atau perubahan kredensial oleh pembeli berada di luar tanggung jawab Akun Instan.",
      ] },
      { h: "4. Batasan ganti rugi", p: [
        "Tanggung jawab maksimum Akun Instan atas satu transaksi terbatas pada nilai saldo yang dibayarkan untuk transaksi tersebut.",
        "Kami tidak bertanggung jawab atas kerugian tidak langsung seperti kehilangan data, kehilangan pendapatan, atau gangguan pekerjaan.",
      ] },
      { h: "5. Konten informasi", p: [
        "Deskripsi produk, panduan, dan jawaban asisten di situs ini bersifat informatif dan dapat berubah tanpa pemberitahuan.",
        "Untuk keputusan penting, konfirmasikan terlebih dahulu ke admin lewat halaman Bantuan.",
      ] },
    ],
  },
};

function LegalPage({ kind, onBack, navigate }) {
  const doc = LEGAL_CONTENT[kind] || LEGAL_CONTENT.terms;
  useEffect(() => { window.scrollTo({ top: 0, behavior: "smooth" }); }, [kind]);
  return (
    <div className="cx-legal-page cx-container">
      <header className="cx-legal-hero">
        <span className="cx-orders-kicker">{doc.kicker}</span>
        <h1>{doc.title}</h1>
        <p>{doc.intro}</p>
        <small>Terakhir diperbarui: {formatDate(new Date())}</small>
      </header>
      <div className="cx-legal-tabs">
        {[["terms", "Syarat & Ketentuan"], ["privacy", "Kebijakan Privasi"], ["refund", "Kebijakan Refund"], ["disclaimer", "Disclaimer"]].map(([id, label]) => (
          <button key={id} className={kind === id ? "active" : ""} onClick={() => navigate(id)}>{label}</button>
        ))}
      </div>
      <article className="cx-legal-body">
        {doc.sections.map((sec) => (
          <section key={sec.h}>
            <h2>{sec.h}</h2>
            {sec.p.map((line, i) => <p key={i}>{line}</p>)}
          </section>
        ))}
        <div className="cx-legal-contact">
          <FileText size={14} />
          <div>
            <strong>Ada yang belum jelas?</strong>
            <p>Hubungi admin lewat halaman Bantuan, kami balas di jam operasional.</p>
          </div>
          <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => navigate("help")}>Buka Bantuan</button>
        </div>
      </article>
    </div>
  );
}

function StoreFooter({ navigate, guest }) {
  return (
    <footer className="cx-footer">
      <div className="cx-container cx-footer-inner">
        <div className="cx-footer-top">
          <div className="cx-footer-brand">
            <button className="cx-brand" onClick={() => navigate("store")} style={{ fontSize: 13 }}>
              <img className="cx-brand-wordmark cx-brand-wordmark-footer" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="132" height="20" loading="lazy" decoding="async" />
            </button>
            <p>Marketplace akun digital &amp; Custom Email.</p>
          </div>
          <nav className="cx-footer-col" aria-label="Navigasi">
            <strong>Navigasi</strong>
            <button onClick={() => navigate("katalog")}>Katalog</button>
            <button onClick={() => navigate("custom-email")}>Custom Email</button>
            <button onClick={() => navigate("help")}>Bantuan</button>
          </nav>
          <nav className="cx-footer-col" aria-label="Informasi">
            <strong>Informasi</strong>
            <button onClick={() => navigate("terms")}>Syarat &amp; Ketentuan</button>
            <button onClick={() => navigate("privacy")}>Kebijakan Privasi</button>
            <button onClick={() => navigate("refund")}>Kebijakan Refund</button>
          </nav>
        </div>
        <p className="cx-footer-copy">© {new Date().getFullYear()} Akun Instan. Seluruh transaksi tunduk pada Syarat &amp; Ketentuan.</p>
      </div>
    </footer>
  );
}

/* ═══════════════════════════════════════════════════
   PRODUCT CARD
════════════════════════════════════════════════════ */
/* Daftar akun dengan Load More supaya tidak memanjang ke bawah di mobile. */
function AccountPicker({ product, accounts, selected, onToggle, pageSize = 3, size, variant }) {
  const [shown, setShown] = useState(pageSize);
  const visible = accounts.slice(0, shown);
  const rest = accounts.length - visible.length;
  return (
    <div className={`cx-cred-preview${size === "lg" ? " cx-cred-preview-lg" : ""}${variant === "v2" ? " cx-pc-picker" : ""}`}>
      <div className="cx-cred-head">Ceklis akun yang mau dibeli ({selected.length}/{accounts.length})</div>
      <div className="cx-cred-list">
        {visible.map((account) => {
          const checked = selected.includes(account.index);
          return (
            <label className={`cx-cred-item cx-cred-pick${checked ? " is-picked" : ""}`} key={account.index}>
              <input type="checkbox" className="cx-cred-check" checked={checked} onChange={() => onToggle(account.index)} />
              <span className="cx-cred-tick" aria-hidden="true"><Check size={11} /></span>
              <span className="cx-cred-no">#{account.index}</span>
              <div className="cx-cred-pair">
                <div className="cx-cred-row"><span>Email</span><code>{account.maskedEmail || "\u2014"}</code></div>
                <div className="cx-cred-row"><span>Password</span><code>{account.maskedPassword || "\u2014"}</code></div>
              </div>
              <span className="cx-cred-price">
                {account.agedLabel ? <small className="cx-aged-tag">{account.agedLabel}</small> : null}
                {formatPrice(accountPriceOf(account, product))}
              </span>
            </label>
          );
        })}
      </div>
      {rest > 0 && (
        <button type="button" className="cx-cred-more" onClick={() => setShown((n) => n + pageSize)}>
          Load more ({rest} akun lagi)
        </button>
      )}
      {rest === 0 && accounts.length > pageSize && (
        <button type="button" className="cx-cred-more is-less" onClick={() => setShown(pageSize)}>
          Tampilkan lebih sedikit
        </button>
      )}
    </div>
  );
}

/* ─── Popup detail produk/akun ───
   Membuka info lengkap produk dalam modal premium, menggantikan
   expand inline "Lihat detail akun" agar card lebih ringkas dan
   pengalaman membaca detail lebih fokus di mobile maupun desktop. */
function ProductDetailModal({ product, color, open, onClose }) {
  const accounts = Array.isArray(product.accounts) ? product.accounts : [];
  const stock = Number(product.stock) || accounts.length;
  const prices = accounts.map((a) => accountPriceOf(a, product)).filter((p) => p > 0);
  const minPrice = prices.length ? Math.min(...prices) : Number(product.price) || 0;
  const maxPrice = prices.length ? Math.max(...prices) : Number(product.price) || 0;
  const hasRange = minPrice !== maxPrice && maxPrice > 0;
  const sections = useMemo(() => parseProductDescription(product.description || ""), [product.description]);
  void sections;


  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="cx-pd-backdrop" onClick={onClose} role="presentation">
      <div
        className="cx-pd-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-pd-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cx-pd-glow" aria-hidden="true" style={{ background: `radial-gradient(circle at 70% 0%, ${color}22, transparent 55%)` }} />
        <button className="cx-pd-close" aria-label="Tutup" onClick={onClose}><X size={18} /></button>

        <div className="cx-pd-body">
          <div className="cx-pd-head">
            <span className="cx-pd-plat" style={{ color }}>
              <ProviderIcon type={product.loginType} size={18} />
              {product.loginType}
            </span>
            <span className={`cx-pd-stock${stock > 0 ? "" : " is-out"}`}>
              {stock > 0 ? `${stock} tersedia` : "Stok habis"}
            </span>
          </div>

          <h2 id="cx-pd-title" className="cx-pd-title">{product.title}</h2>




          <div className="cx-pd-desc">
            <ProductDescription text={product.description} compact={false} />
          </div>

          {product.deliveryDetails && (
            <div className="cx-pd-delivery">
              <h4><ShieldCheck size={14} /> Panduan &amp; keamanan</h4>
              <DeliveryNote text={product.deliveryDetails} />
            </div>
          )}

          <div className="cx-pd-summary">
            <div className="cx-pd-summary-row">
              <span>Jumlah akun</span>
              <strong>{accounts.length || stock} akun</strong>
            </div>
            <div className="cx-pd-summary-row">
              <span>Kisaran harga</span>
              <strong style={{ color }}>
                {minPrice > 0
                  ? (hasRange ? `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}` : formatPrice(minPrice))
                  : "Pilih akun untuk melihat harga"}
              </strong>
            </div>
          </div>
        </div>

        <div className="cx-pd-foot">
          <button className="cx-btn cx-btn-ghost" onClick={onClose}>Tutup</button>
          <button className="cx-btn cx-btn-primary" onClick={onClose}>
            Pilih akun <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ─── Rating bintang & jumlah terjual ───
   Data terjual berasal dari counter pembelian nyata (codexa_listing_sales),
   rating dari penilaian pembeli (codexa_listing_reviews). */
const ratingOf = (product) => Number(product && product.ratingAvg) || 0;
const ratingCountOf = (product) => Number(product && product.ratingCount) || 0;
const soldOf = (product) => Number(product && product.soldCount) || 0;

function StarRow({ value, size = 13 }) {
  return (
    <span className="cx-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= Math.round(value) ? "is-on" : ""} />
      ))}
    </span>
  );
}

/* Baris statistik ringkas untuk card & header halaman produk. */
function ProductStats({ product, size = 12 }) {
  const avg = ratingOf(product);
  const count = ratingCountOf(product);
  const sold = soldOf(product);
  return (
    <div className="cx-pstats" aria-label={`Rating ${avg || 0} dari 5, terjual ${sold}`}>
      {count > 0 ? (
        <span className="cx-pstats-rating">
          <Star size={size} className="is-on" />
          <strong>{avg.toFixed(1)}</strong>
          <small>({count})</small>
        </span>
      ) : (
        <span className="cx-pstats-rating is-empty">
          <Star size={size} />
          <strong>Baru</strong>
        </span>
      )}
      <span className="cx-pstats-sep">·</span>
      <span className="cx-pstats-sold">Terjual {sold}</span>
    </div>
  );
}

/* Tanggal ulasan singkat: 12 Sep 2026 */
const reviewDate = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

/* Widget rating bintang + ulasan produk (halaman produk). */
function ProductRating({ product, canRate, onRate }) {
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const mine = Number(product.myRating) || 0;
  const myComment = product.myComment || "";
  const [draftStars, setDraftStars] = useState(mine);
  const [draft, setDraft] = useState(myComment);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setDraftStars(mine); setDraft(myComment); setShowAll(false); }, [product.id, mine, myComment]);

  const avg = ratingOf(product);
  const count = ratingCountOf(product);
  const sold = soldOf(product);
  const reviews = Array.isArray(product.reviews) ? product.reviews : [];
  const visible = showAll ? reviews : reviews.slice(0, 3);
  const active = hover || draftStars;
  const MAX = 600;

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try { await onRate(product, draftStars, draft.trim()); } finally { setBusy(false); }
  };

  return (
    <section className="cx-prodpage-card cx-rating-card">
      <h2>Ulasan &amp; penilaian</h2>
      <div className="cx-rating-summary">
        <div className="cx-rating-score">
          <strong>{count ? avg.toFixed(1) : "–"}</strong>
          <StarRow value={avg} size={14} />
          <small>{count ? `${count} penilaian` : "Belum ada penilaian"}</small>
        </div>
        <div className="cx-rating-sold">
          <strong>{sold}</strong>
          <small>akun terjual</small>
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="cx-reviews">
          {visible.map((review) => (
            <article key={review.id} className="cx-review">
              <div className="cx-review-top">
                <span className="cx-review-avatar" aria-hidden="true">{(review.author || "?").charAt(0).toUpperCase()}</span>
                <span className="cx-review-who">
                  <strong>{review.author}</strong>
                  <small>{reviewDate(review.createdAt)}</small>
                </span>
                <StarRow value={review.rating} size={11} />
              </div>
              <p className="cx-review-text">{review.comment}</p>
            </article>
          ))}
          {reviews.length > 3 && (
            <button type="button" className="cx-review-more" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Tampilkan lebih sedikit" : `Lihat semua ${reviews.length} ulasan`}
            </button>
          )}
        </div>
      )}
      {reviews.length === 0 && (
        <p className="cx-review-empty">Belum ada ulasan. Jadi yang pertama berbagi pengalamanmu.</p>
      )}

      <form className="cx-rating-pick" onSubmit={submit}>
        <span className="cx-rating-pick-label">{mine ? "Ubah ulasanmu" : "Tulis ulasan produk ini"}</span>
        <div className="cx-rating-stars" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`cx-rating-star${n <= active ? " is-on" : ""}`}
              aria-label={`Beri ${n} bintang`}
              disabled={busy}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onClick={() => setDraftStars(n)}
            >
              <Star size={22} />
            </button>
          ))}
        </div>
        <textarea
          className="cx-review-input"
          rows={3}
          maxLength={MAX}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX))}
          placeholder={canRate ? "Ceritakan pengalamanmu memakai akun ini…" : "Masuk dulu untuk menulis ulasan"}
        />
        <div className="cx-review-actions">
          <small className="cx-review-count">{draft.length}/{MAX}</small>
          <button type="submit" className="cx-review-submit" disabled={busy || draftStars < 1}>
            {busy ? "Mengirim…" : mine ? "Simpan ulasan" : "Kirim ulasan"}
          </button>
        </div>
        {!canRate && <small className="cx-rating-note">Masuk dulu untuk memberi bintang dan ulasan.</small>}
        {canRate && draftStars < 1 && <small className="cx-rating-note">Pilih bintang dulu sebelum mengirim.</small>}
      </form>
    </section>
  );
}

function ProductCard({ product, colorIdx, onBuy, onOpen }) {
  void onBuy;
  const color = ACCENT_COLORS[colorIdx % ACCENT_COLORS.length];
  const accounts = Array.isArray(product.accounts) ? product.accounts : [];
  const stock = Number(product.stock) || accounts.length;
  const age = product.ageInfo || productAgeInfo(product);
  const prices = accounts.map((a) => accountPriceOf(a, product)).filter((v) => v > 0);
  const minPrice = prices.length ? Math.min(...prices) : Number(product.price) || 0;
  const maxPrice = prices.length ? Math.max(...prices) : minPrice;
  const hasRange = maxPrice > minPrice;
  const avg = ratingOf(product);
  const count = ratingCountOf(product);
  return (
    <article className="cx-pc cx-pc-v3">
      <div className="cx-pc-head">
        <span className="cx-pc-plat" style={{ color }}>
          <ProviderIcon type={product.loginType} size={14} />
          {product.loginType}
        </span>
        {age.kind && <span className={`cx-age-badge is-${age.kind}`}>{age.label}</span>}
      </div>

      <h3 className="cx-pc-title">
        {onOpen ? (
          <button type="button" className="cx-pc-title-link" onClick={onOpen}>{product.title}</button>
        ) : product.title}
      </h3>

      <p className="cx-pc-cond">{age.label ? `${age.label} — Siap pakai` : "Siap pakai"}</p>

      <div className="cx-pc-meta">
        <span className="cx-pc-rate">
          <Star size={12} className={count > 0 ? "is-on" : ""} />
          {count > 0 ? <><strong>{avg.toFixed(1)}</strong> <small>· {count} ulasan</small></> : <small>Belum ada ulasan</small>}
        </span>
        <span className="cx-pc-sep">·</span>
        <span className={`cx-pc-stockline${stock > 0 ? "" : " is-out"}`}>
          {stock > 0 ? `${stock} stok tersedia` : "Stok habis"}
        </span>
      </div>

      <div className="cx-pc-foot">
        <div className="cx-pc-price">
          <span className="cx-pc-amount">
            {minPrice > 0 ? (hasRange ? `${formatPrice(minPrice)}+` : formatPrice(minPrice)) : "Harga di detail"}
          </span>
          {soldOf(product) > 0 && <small>Terjual {soldOf(product)}</small>}
        </div>
        <button
          type="button"
          className="cx-pc-cta is-ready"
          onClick={() => onOpen && onOpen()}
          aria-label={`Lihat ${product.title}`}
        >
          <span>Pilih akun</span>
          <ArrowRight size={15} />
        </button>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════
   HALAMAN PRODUK (URL sendiri per listing)
════════════════════════════════════════════════════ */
function ProductPage({ product, loading, navigate, onAdd, canRate, onRate }) {
  const [selected, setSelected] = useState([]);
  useEffect(() => { setSelected([]); }, [product && product.id]);

  if (loading && !product) {
    return (
      <main className="cx-container cx-prodpage">
        <div className="cx-skeleton" style={{ height: 16, width: "40%", marginBottom: 14 }} />
        <div className="cx-skeleton" style={{ height: 26, width: "70%", marginBottom: 10 }} />
        <div className="cx-skeleton" style={{ height: 120 }} />
      </main>
    );
  }

  if (!product) {
    return (
      <main className="cx-container cx-prodpage">
        <div className="cx-empty">
          <Package size={28} />
          <h3>Produk tidak ditemukan</h3>
          <p>Listing ini mungkin sudah terjual atau dihapus dari katalog.</p>
          <button className="cx-btn cx-btn-primary" onClick={() => navigate("katalog")}>
            <ShoppingBag size={13} /> Lihat katalog
          </button>
        </div>
      </main>
    );
  }

  const accounts = Array.isArray(product.accounts) ? product.accounts : [];
  const stock = Number(product.stock) || accounts.length;
  const total = sumSelected(product, selected);
  const toggle = (index) =>
    setSelected((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));

  return (
    <main className="cx-container cx-prodpage">
      <nav className="cx-prodpage-crumbs" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate("store")}>Beranda</button>
        <span>/</span>
        <button type="button" onClick={() => navigate("katalog")}>Katalog</button>
        <span>/</span>
        <strong>{product.title}</strong>
      </nav>

      <header className="cx-prodpage-head">
        <span className="cx-prodpage-plat">
          <ProviderIcon type={product.loginType} size={16} />
          {product.loginType}
          {productAgeInfo(product).kind && (
            <span className={`cx-age-badge is-${productAgeInfo(product).kind}`}>{productAgeInfo(product).label}</span>
          )}
        </span>
        <h1>{product.title}</h1>
        <ProductStats product={product} size={13} />
      </header>



      <section className="cx-prodpage-card">
        <h2>Tentang produk</h2>
        <ProductDescription text={product.description || "Akun digital siap digunakan. Detail login dikirim otomatis setelah pembayaran."} compact />
      </section>

      <section className="cx-prodpage-card">
        <h2>Spesifikasi</h2>
        <dl className="cx-spec">
          <div className="cx-spec-row"><dt>Login</dt><dd>{product.loginType}</dd></div>
          <div className="cx-spec-row"><dt>Status</dt><dd>{productAgeInfo(product).label || "Siap pakai"}</dd></div>
          <div className="cx-spec-row"><dt>Stok</dt><dd>{stock > 0 ? `${stock} tersedia` : "Kosong"}</dd></div>
          <div className="cx-spec-row"><dt>Pengiriman</dt><dd>Otomatis setelah bayar</dd></div>
          <div className="cx-spec-row"><dt>Garansi</dt><dd>Sesuai ketentuan</dd></div>
        </dl>
      </section>

      {accounts.length > 0 && (
        <section className="cx-prodpage-card">
          <h2>Pilih akun</h2>
          <AccountPicker product={product} accounts={accounts} selected={selected} onToggle={toggle} pageSize={5} size="lg" />
          <div className="cx-prodpage-actions">
            <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setSelected(accounts.map((a) => a.index))}>Pilih semua</button>
            <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setSelected([])}>Kosongkan</button>
          </div>
        </section>
      )}

      <div className="cx-prodpage-buy is-sticky">
        <div className="cx-prodpage-total">
          <small>{selected.length ? `${selected.length} akun dipilih` : "Belum ada akun dipilih"}</small>
          <strong>{formatPrice(total)}</strong>
        </div>
        <button className="cx-btn cx-btn-primary" disabled={selected.length === 0} onClick={() => onAdd(product, selected)}>
          <ShoppingBag size={14} /> Tambah ke keranjang
        </button>
      </div>

      {onRate && <ProductRating product={product} canRate={canRate} onRate={onRate} />}

      <section className="cx-prodpage-card cx-prodpage-more">
        <h2>Kategori lain</h2>
        <div className="cx-prodpage-links">
          {CATEGORY_SLUGS.map((slug) => (
            <button key={slug} type="button" onClick={() => navigate(slug)}>
              {CATEGORY_PAGES[slug].label} <ArrowRight size={13} />
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}

/* ═══════════════════════════════════════════════════
   ADMIN PAGE  —  LinearPro sidebar layout
════════════════════════════════════════════════════ */
const AdminPage = lazy(() => import("./admin-page.jsx"));

/* ═══════════════════════════════════════════════════
   WELCOME / LANDING PAGE (entry point untuk guest)
════════════════════════════════════════════════════ */
function WelcomePage({ onLogin, onRegister }) {
  return (
    <div className="cx-welcome">
      <div className="cx-welcome-glow" aria-hidden="true" />
      <div className="cx-welcome-grid" aria-hidden="true" />

      <main className="cx-welcome-content">
        <header className="cx-welcome-brand cx-rise cx-rise-1">
          <img src="/brand-logo.webp" alt="Logo Akun Instan" className="cx-welcome-logo" width="56" height="56" decoding="async" />
          <img src="/akun-instan-wordmark.webp" alt="Akun Instan" className="cx-welcome-wordmark" width="150" height="28" decoding="async" />
        </header>

        <section className="cx-welcome-hero cx-rise cx-rise-2">
          <h1>
            Beli Akun Google, Gmail &amp; Akun Digital di <span>Akun Instan</span>
          </h1>
          <p className="cx-welcome-sub">
            Akun Instan adalah tempat beli akun Google/Gmail siap pakai, pesan custom email sesuai
            nama sendiri, serta akun game dan social media. Isi saldo lewat QRIS, e-wallet, atau
            transfer bank, lalu akun dikirim otomatis setelah pembayaran.
          </p>
        </section>

        <div className="cx-welcome-visual cx-rise cx-rise-3" aria-hidden="true">
          <div className="cx-welcome-card cx-welcome-card-front">
            <div className="cx-welcome-card-chip" />
            <div className="cx-welcome-card-lines">
              <span /><span /><span />
            </div>
            <div className="cx-welcome-card-brand"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></div>
          </div>
          <div className="cx-welcome-card cx-welcome-card-back" />
          <div className="cx-welcome-orb cx-welcome-orb-a" />
          <div className="cx-welcome-orb cx-welcome-orb-b" />
        </div>

        <div className="cx-welcome-actions cx-rise cx-rise-4">
          <button type="button" className="cx-welcome-btn cx-welcome-btn-primary" onClick={onLogin} aria-label="Masuk ke akun Akun Instan">
            <LogIn size={15} /> Masuk ke Akun
          </button>
          <button type="button" className="cx-welcome-btn cx-welcome-btn-secondary" onClick={onRegister} aria-label="Daftar akun baru di Akun Instan">
            <UserPlus size={15} /> Daftar Sekarang
          </button>
        </div>

        <p className="cx-welcome-trust cx-rise cx-rise-4">
          <ShieldCheck size={11} /> Aman <span className="cx-welcome-dot" /> <Zap size={11} /> Cepat <span className="cx-welcome-dot" /> <Sparkles size={11} /> Praktis
        </p>

        <section className="cx-welcome-info cx-rise cx-rise-4" aria-labelledby="cx-welcome-info-title">
          <h2 id="cx-welcome-info-title">Layanan Akun Instan</h2>
          <ul className="cx-welcome-info-list">
            <li>
              <h3>Akun Google &amp; Gmail siap pakai</h3>
              <p>Akun fresh dengan data login lengkap, dikirim otomatis ke halaman pesanan setelah pembayaran berhasil.</p>
            </li>
            <li>
              <h3>Custom email sesuai nama</h3>
              <p>Cek ketersediaan nama yang kamu mau, lalu tim Akun Instan membuatkan alamat Gmail-nya.</p>
            </li>
            <li>
              <h3>Akun game &amp; social media</h3>
              <p>Katalog akun digital lain dengan stok dan harga yang terlihat langsung sebelum membeli.</p>
            </li>
            <li>
              <h3>Saldo &amp; pembayaran fleksibel</h3>
              <p>Top up saldo lewat QRIS, DANA, OVO, GoPay, ShopeePay, atau transfer bank untuk semua pembelian.</p>
            </li>
          </ul>
        </section>

        <nav className="cx-welcome-links" aria-label="Halaman informasi Akun Instan">
          <a href="/help">Bantuan</a>
          <a href="/terms">Syarat &amp; Ketentuan</a>
          <a href="/privacy">Kebijakan Privasi</a>
          <a href="/refund">Refund</a>
          <a href="/disclaimer">Disclaimer</a>
        </nav>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   AUTH PAGE (daftar / masuk)
════════════════════════════════════════════════════ */
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 .5 24 .5 14.6.5 6.4 5.9 2.5 13.8l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.9 7.2l7.6 5.9c4.4-4.1 7.1-10.2 7.1-17.6z"/>
      <path fill="#FBBC05" d="M10.3 28.1a14.6 14.6 0 0 1 0-8.2l-7.8-6.1a23.9 23.9 0 0 0 0 20.4l7.8-6.1z"/>
      <path fill="#34A853" d="M24 47.5c6.5 0 11.9-2.1 15.9-5.9l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.4 0-11.8-4.1-13.7-9.9l-7.8 6.1C6.4 42.1 14.6 47.5 24 47.5z"/>
    </svg>
  );
}

/* Halaman /email-verifikasi: user diarahkan ke sini setelah daftar. */
function VerifyEmailPage({ pending, onAuthenticated, onBackToLogin }) {
  const email = (pending && pending.email) || "";
  const password = (pending && pending.password) || "";
  const linkState = new URLSearchParams(window.location.search).get("verification");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, startCooldown] = useSendCooldown("codexa:resend-verify-until");
  const [error, setError] = useState(linkState === "invalid" ? "Link verifikasi tidak valid atau sudah kedaluwarsa. Kirim ulang link baru." : "");
  const [message, setMessage] = useState(pending && pending.message ? pending.message : "");

  const check = async ({ silent } = {}) => {
    if (!email || !password) {
      if (!silent) setError("Sesi pendaftaran sudah berakhir. Silakan masuk memakai email dan password kamu.");
      return false;
    }
    if (!silent) { setBusy(true); setError(""); setMessage(""); }
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "verify-status", email, password }),
      });
      if (res.verified && res.user) { onAuthenticated(res.user); return true; }
      if (!silent) setError("Kami belum menerima konfirmasi. Buka email kamu lalu klik tombol Verifikasi akun di dalamnya.");
      return false;
    } catch (err) {
      if (!silent) setError(err.message || "Gagal memeriksa status verifikasi");
      return false;
    } finally {
      if (!silent) setBusy(false);
    }
  };

  /* Tanpa deteksi otomatis: status hanya dicek saat user menekan tombol. */


  const resend = async () => {
    if (!email || !password) { setError("Sesi pendaftaran sudah berakhir. Silakan masuk untuk mengirim link baru."); return; }
    if (cooldown > 0) return;
    setResending(true); setError(""); setMessage("");
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "resend-verification", email, password }),
      });
      setMessage(res.message || "Link verifikasi baru sudah dikirim.");
      startCooldown(res.retryAfter);
    } catch (err) {
      setError(err.message || "Gagal mengirim ulang link");
      if (err.retryAfter) startCooldown(err.retryAfter);
    }
    finally { setResending(false); }
  };

  const [stepsOpen, setStepsOpen] = useState(false);

  return (
    <div className="cx-auth-shell cx-verify-shell">
      <div className="cx-auth-glow cx-auth-glow-a" aria-hidden="true" />
      <div className="cx-auth-glow cx-auth-glow-b" aria-hidden="true" />

      <div className="cx-verify-card">
        <div className="cx-verify-top">
          <div className="cx-verify-icon" aria-hidden="true"><Mail size={20} /></div>
          <div className="cx-verify-brand"><span className="cx-verify-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></span> Akun Instan</div>
        </div>
        <h1>Verifikasi email kamu</h1>
        <p className="cx-verify-lead">
          Kami sudah mengirim link verifikasi ke email kamu. Buka email lalu klik
          <strong> Verifikasi akun</strong> untuk mengaktifkan akun.
        </p>
        {email && <div className="cx-verify-email"><Mail size={12} /> <span>{email}</span></div>}

        <button
          type="button"
          className="cx-verify-help"
          aria-expanded={stepsOpen}
          onClick={() => setStepsOpen((v) => !v)}
        >
          <span><CircleHelp size={13} /> Cara verifikasi</span>
          <ChevronDown size={13} style={stepsOpen ? { transform: "rotate(180deg)" } : undefined} />
        </button>
        {stepsOpen && (
          <ol className="cx-verify-steps">
            <li><span>1</span> Buka aplikasi email kamu (cek juga folder Spam/Promosi).</li>
            <li><span>2</span> Klik tombol Verifikasi akun di email dari Akun Instan.</li>
            <li><span>3</span> Halaman ini otomatis mendeteksi dan membawa kamu ke beranda.</li>
          </ol>
        )}

        {message && <p className="cx-form-success"><BadgeCheck size={13} /> {message}</p>}
        {error && <p className="cx-form-error">{error}</p>}

        <div className="cx-verify-actions">
          <button type="button" className="cx-btn cx-btn-primary cx-btn-full" disabled={busy} onClick={() => check()}>
            {busy ? <><RefreshCw size={13} /> Memeriksa...</> : <><ShieldCheck size={13} /> Saya sudah verifikasi email</>}
          </button>
          <button
            type="button"
            className="cx-btn cx-btn-secondary cx-btn-full"
            disabled={resending || cooldown > 0}
            onClick={resend}
          >
            {resending
              ? <><RefreshCw size={13} /> Mengirim...</>
              : cooldown > 0
                ? <><Clock size={13} /> Kirim ulang dalam {cooldown}s</>
                : <><Send size={13} /> Kirim ulang link</>}
          </button>
          {cooldown > 0 && (
            <p className="cx-verify-cooldown">Demi keamanan: kirim ulang tiap 60&nbsp;detik, maks. 5×&nbsp;per jam.</p>
          )}
        </div>

        <p className="cx-verify-foot">
          Link berlaku 24 jam dan sekali pakai.{" "}
          <button type="button" onClick={onBackToLogin}>Masuk dengan akun lain</button>
        </p>
      </div>
    </div>
  );
}

/* Halaman /status-verifikasi: dibuka dari link di email. Hanya menampilkan
   status; user melanjutkan di tab tempat dia mendaftar. */
function VerifyStatusPage({ onBackToLogin, loggedIn }) {
  const ok = new URLSearchParams(window.location.search).get("verification") === "success";
  return (
    <div className="cx-auth-shell cx-verify-shell">
      <div className="cx-auth-glow cx-auth-glow-a" aria-hidden="true" />
      <div className="cx-auth-glow cx-auth-glow-b" aria-hidden="true" />

      <div className="cx-verify-card cx-verify-status">
        <div className="cx-verify-top">
          <div className={`cx-verify-icon ${ok ? "is-ok" : "is-bad"}`} aria-hidden="true">
            {ok ? <BadgeCheck size={22} /> : <X size={22} />}
          </div>
          <div className="cx-verify-brand"><span className="cx-verify-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></span> Akun Instan</div>
        </div>
        <h1>{ok ? "Email berhasil diverifikasi" : "Link verifikasi tidak berlaku"}</h1>
        <p className="cx-verify-lead">
          {ok
            ? "Akun kamu sudah aktif. Kembali ke halaman tempat kamu mendaftar, lalu tekan tombol Saya sudah verifikasi email untuk lanjut."
            : "Link ini sudah kedaluwarsa atau pernah dipakai. Kembali ke halaman verifikasi dan kirim ulang link baru."}
        </p>
        <div className={`cx-verify-badge ${ok ? "is-ok" : "is-bad"}`}>
          {ok ? <><ShieldCheck size={13} /> Status: Terverifikasi</> : <><Clock size={13} /> Status: Belum terverifikasi</>}
        </div>
        <p className="cx-verify-foot">
          Halaman ini boleh ditutup.{" "}
          <button type="button" onClick={onBackToLogin}>{loggedIn ? "Buka beranda" : "Buka halaman masuk"}</button>
        </p>
      </div>
    </div>
  );
}

/* Halaman /lupa-password: kirim link reset password ke email user. */
function ForgotPasswordPage({ onBackToLogin, onRegister }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notRegistered, setNotRegistered] = useState(false);
  const [message, setMessage] = useState("");
  const [cooldown, startCooldown] = useSendCooldown("codexa:reset-link-until");
  const captcha = useTurnstile();

  const submit = async (e) => {
    e.preventDefault();
    if (cooldown > 0 || busy) return;
    if (!captcha.token) { setError("Selesaikan verifikasi keamanan dulu."); return; }
    setBusy(true); setError(""); setMessage(""); setNotRegistered(false);
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "forgot-password", email: email.trim(), captchaToken: captcha.token }),
      });
      setMessage(res.message || "Link reset password sudah dikirim. Cek inbox atau folder spam.");
      startCooldown(res.retryAfter);
      captcha.reset();
    } catch (err) {
      captcha.reset();
      setError(err.message || "Gagal mengirim link reset password");
      setNotRegistered(err.code === "EMAIL_NOT_REGISTERED");
      if (err.retryAfter) startCooldown(err.retryAfter);
    }
    finally { setBusy(false); }
  };

  return (
    <div className="cx-auth-shell cx-verify-shell">
      <div className="cx-auth-glow cx-auth-glow-a" aria-hidden="true" />
      <div className="cx-auth-glow cx-auth-glow-b" aria-hidden="true" />

      <div className="cx-verify-card">
        <div className="cx-verify-top">
          <div className="cx-verify-icon" aria-hidden="true"><KeyRound size={20} /></div>
          <div className="cx-verify-brand"><span className="cx-verify-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></span> Akun Instan</div>
        </div>
        <h1>Lupa password?</h1>
        <p className="cx-verify-lead">
          Masukkan email akun kamu. Kami kirim link untuk membuat password baru.
        </p>

        <form onSubmit={submit} className="cx-auth-form cx-verify-form">
          <Field label="Email akun">
            <InputWrap icon={Mail}>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nama@email.com" required />
            </InputWrap>
          </Field>
          {message && <p className="cx-form-success"><BadgeCheck size={13} /> {message}</p>}
          {error && <p className="cx-form-error">{error}</p>}
          {notRegistered && onRegister && (
            <button type="button" className="cx-verify-inline" onClick={() => onRegister(email.trim())}>
              <UserPlus size={13} /> Daftar akun baru dengan email ini
            </button>
          )}
          <Captcha state={captcha} />
          <button type="submit" className="cx-btn cx-btn-primary cx-btn-full" disabled={busy || cooldown > 0 || !captcha.token}>
            {busy
              ? <><RefreshCw size={13} /> Mengirim...</>
              : cooldown > 0
                ? <><Clock size={13} /> Kirim ulang dalam {cooldown}s</>
                : <><Send size={13} /> Kirim link reset password</>}
          </button>
          {cooldown > 0 && (
            <p className="cx-verify-cooldown">Demi keamanan: kirim ulang tiap 60&nbsp;detik, maks. 5×&nbsp;per jam.</p>
          )}
        </form>

        <p className="cx-verify-foot">
          Link berlaku 1 jam dan sekali pakai.{" "}
          <button type="button" onClick={onBackToLogin}>Kembali ke halaman masuk</button>
        </p>
      </div>
    </div>
  );
}

/* Halaman /reset-password?token=...: buat password baru lalu langsung masuk. */
function ResetPasswordPage({ onAuthenticated, onBackToLogin }) {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const [form, setForm] = useState({ password: "", confirm: "" });
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(token ? "" : "Link reset tidak lengkap. Minta link baru dari halaman Lupa password.");

  const submit = async (e) => {
    e.preventDefault();
    if (form.password.length < 6) { setError("Password minimal 6 karakter"); return; }
    if (form.password !== form.confirm) { setError("Konfirmasi password belum sama"); return; }
    setBusy(true); setError("");
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "reset-password", token, password: form.password }),
      });
      onAuthenticated(res.user);
    } catch (err) { setError(err.message || "Gagal menyimpan password baru"); }
    finally { setBusy(false); }
  };

  return (
    <div className="cx-auth-shell cx-verify-shell">
      <div className="cx-auth-glow cx-auth-glow-a" aria-hidden="true" />
      <div className="cx-auth-glow cx-auth-glow-b" aria-hidden="true" />

      <div className="cx-verify-card">
        <div className="cx-verify-top">
          <div className="cx-verify-icon" aria-hidden="true"><LockKeyhole size={20} /></div>
          <div className="cx-verify-brand"><span className="cx-verify-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></span> Akun Instan</div>
        </div>
        <h1>Buat password baru</h1>
        <p className="cx-verify-lead">Password baru langsung aktif dan kamu otomatis masuk ke akun.</p>

        <form onSubmit={submit} className="cx-auth-form cx-verify-form">
          <Field label="Password baru" hint="Minimal 6 karakter.">
            <InputWrap icon={LockKeyhole}>
              <input
                type={showPass ? "text" : "password"}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="••••••"
                required
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} style={{ color: "var(--muted)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </InputWrap>
          </Field>
          <Field label="Ulangi password baru">
            <InputWrap icon={ShieldCheck}>
              <input
                type={showPass ? "text" : "password"}
                value={form.confirm}
                onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
                placeholder="••••••"
                required
              />
            </InputWrap>
          </Field>
          {error && <p className="cx-form-error">{error}</p>}
          <button type="submit" className="cx-btn cx-btn-primary cx-btn-full" disabled={busy || !token}>
            {busy ? <><RefreshCw size={13} /> Menyimpan...</> : <><ShieldCheck size={13} /> Simpan & masuk</>}
          </button>
        </form>

        <p className="cx-verify-foot">
          <button type="button" onClick={onBackToLogin}>Kembali ke halaman masuk</button>
        </p>
      </div>
    </div>
  );
}

function AuthPage({ initialMode = "login", initialEmail = "", onAuthenticated, onBackToWelcome, onVerificationSent, onForgotPassword }) {
  const [mode, setMode]         = useState(initialMode);
  const [form, setForm]         = useState({ name: "", email: initialEmail, phone: "", password: "" });
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState("");
  const [message, setMessage]   = useState(() => {
    const state = new URLSearchParams(window.location.search).get("verification");
    if (state === "success") return "Email berhasil diverifikasi. Silakan masuk ke akun kamu.";
    if (state === "invalid") return "Link verifikasi tidak valid atau sudah kedaluwarsa. Masuk untuk mengirim link baru.";
    if (state === "error") return "Verifikasi belum berhasil. Silakan coba lagi.";
    return "";
  });
  const [canResend, setCanResend] = useState(false);
  const [busy, setBusy]         = useState(false);
  const [googleAccount, setGoogleAccount] = useState("");
  const [emailCheck, setEmailCheck] = useState("idle"); /* idle | checking | google | email */
  const captcha = useTurnstile();
  useEffect(() => { setMode(initialMode); }, [initialMode]);

  /* Cek otomatis: begitu email valid diketik, sistem memeriksa dulu apakah
     akun terdaftar dan lewat provider apa, sebelum user mengisi password. */
  useEffect(() => {
    const value = (form.email || "").trim().toLowerCase();
    if (mode !== "login" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setGoogleAccount(""); setEmailCheck("idle"); return undefined;
    }
    let alive = true;
    setError("");
    setEmailCheck("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await jsonRequest("/api/auth", {
          method: "POST", body: JSON.stringify({ action: "check-email", email: value }),
        });
        if (!alive) return;
        if (res && res.provider === "google") { setGoogleAccount(value); setEmailCheck("google"); }
        else if (res && res.exists) { setGoogleAccount(""); setEmailCheck("email"); }
        else { setGoogleAccount(""); setEmailCheck("notfound"); }
      } catch (_) { if (alive) { setGoogleAccount(""); setEmailCheck("idle"); } }
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [form.email, mode]);
  const switchMode = (m) => {
    setMode(m);
    setError("");
    if (typeof window !== "undefined") window.history.pushState({}, "", `/${m}`);
  };
  /* Email dari halaman Lupa password langsung terisi di form Daftar. */
  useEffect(() => {
    if (initialEmail) setForm((f) => (f.email ? f : { ...f, email: initialEmail }));
  }, [initialEmail]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const googleSignIn = async () => {
    setError(""); setBusy(true);
    try {
      const accessToken = await signInWithGoogle();
      if (!accessToken) return;
      const res = await jsonRequest("/api/auth", {
        method: "POST", body: JSON.stringify({ action: "google", accessToken }),
      });
      onAuthenticated(res.user);
    } catch (err) {
      if (!err.silent) setError(err.message || "Login Google gagal");
    } finally { setBusy(false); }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (mode === "register" && !captcha.token) { setError("Selesaikan verifikasi keamanan dulu."); return; }
    if (mode === "login" && emailCheck === "notfound") {
      setError("Akun belum terdaftar di sistem kami. Silakan daftar dulu.");
      return;
    }
    setError(""); setMessage(""); setCanResend(false); setBusy(true);
    try {
      const payload = mode === "register"
        ? { action: "register", name: form.name, email: form.email, phone: form.phone, password: form.password, captchaToken: captcha.token }
        : { action: "login", email: form.email, password: form.password };
      const res = await jsonRequest("/api/auth", { method: "POST", body: JSON.stringify(payload) });
      if (res.verificationRequired) {
        if (onVerificationSent) {
          try {
            window.sessionStorage.setItem(
              "codexa:resend-verify-until",
              String(Date.now() + (Number(res.retryAfter) || 60) * 1000),
            );
          } catch (_) {}
          onVerificationSent({ email: form.email, password: form.password, message: res.message });
        } else {
          setMode("login");
          setMessage(res.message);
        }
      } else {
        onAuthenticated(res.user);
      }
    } catch (err) {
      /* Untuk keamanan, kegagalan kredensial saat masuk selalu memakai pesan
         netral: email belum terdaftar tidak dibocorkan ke penyerang. */
      if (mode === "register") captcha.reset();
      if (err.code === "ACCOUNT_NOT_FOUND") {
        setEmailCheck("notfound");
        setError("Akun belum terdaftar di sistem kami. Silakan daftar dulu.");
        setBusy(false);
        return;
      }
      const invalidLogin = mode === "login" && err.status === 401 && !err.code;
      /* Akun Google tidak punya password: jangan tampilkan "Email atau password
         salah", cukup info arahkan ke tombol Google di atas. */
      if (invalidLogin && googleAccount) setError("");
      else setError(invalidLogin ? "Email atau password salah" : err.message);
      setCanResend(err.code === "EMAIL_NOT_VERIFIED");
    }
    finally { setBusy(false); }
  };

  const resendVerification = async () => {
    setError(""); setMessage(""); setBusy(true);
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "resend-verification", email: form.email, password: form.password }),
      });
      setMessage(res.message);
      setCanResend(false);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="cx-auth-shell">
      <div className="cx-auth-glow cx-auth-glow-a" aria-hidden="true" />
      <div className="cx-auth-glow cx-auth-glow-b" aria-hidden="true" />

      <div className="cx-auth-layout">
        <aside className="cx-auth-aside" aria-hidden="true">
          <div className="cx-auth-aside-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></div>
          <h2>Akun Instan</h2>
          <p>Akun Google, Gmail &amp; akun digital siap pakai. Proses cepat, saldo aman, dibantu admin.</p>
          <ul className="cx-auth-points">
            <li><ShieldCheck size={14} /> Garansi login &amp; bantuan admin</li>
            <li><Zap size={14} /> Pesanan diproses cepat</li>
            <li><LockKeyhole size={14} /> Data akun kamu tetap privat</li>
          </ul>
        </aside>

        <div className="cx-auth-card">
          {onBackToWelcome && (
            <button type="button" className="cx-auth-back" onClick={onBackToWelcome}>
              <ArrowRight size={13} style={{ transform: "rotate(180deg)" }} /> Kembali
            </button>
          )}
          <div className="cx-auth-head">
            <div className="cx-auth-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></div>
            <div>
              <h1>{mode === "register" ? "Daftar Akun Instan" : "Masuk ke Akun Instan"}</h1>
              <p>{mode === "register" ? "Buat akun untuk mulai belanja dan isi saldo." : "Masuk dulu untuk mengakses katalog dan saldo kamu."}</p>
            </div>
          </div>

          <div className="cx-auth-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => switchMode("login")}>Masuk</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => switchMode("register")}>Daftar</button>
          </div>

          <button type="button" className="cx-google-btn" onClick={googleSignIn} disabled={busy}>
            <GoogleGlyph />
            <span>{mode === "register" ? "Daftar dengan Google" : "Lanjut dengan Google"}</span>
          </button>
          <div className="cx-auth-or"><span>atau pakai email</span></div>

          <form onSubmit={submit} className="cx-auth-form">
            {mode === "register" && (
              <>
                <Field label="Nama lengkap">
                  <InputWrap icon={User}>
                    <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Nama kamu" required />
                  </InputWrap>
                </Field>
                <Field label="Nomor WhatsApp" hint="Opsional, dipakai admin untuk konfirmasi top up.">
                  <InputWrap icon={Phone}>
                    <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="08xxxxxxxxxx" />
                  </InputWrap>
                </Field>
              </>
            )}
            <Field label="Email">
              <InputWrap icon={Mail}>
                <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="nama@email.com" required />
              </InputWrap>
            {mode === "login" && emailCheck === "checking" && (
                <p className="cx-email-check is-checking"><RefreshCw size={11} className="cx-spin" /> Memeriksa email...</p>
              )}
              {mode === "login" && emailCheck === "email" && (
                <p className="cx-email-check is-ok"><BadgeCheck size={11} /> Email terdaftar, silakan isi password</p>
              )}
              {mode === "login" && emailCheck === "notfound" && (
                <p className="cx-email-check is-warn"><ShieldCheck size={11} /> Email belum terdaftar</p>
              )}
            </Field>
            {(mode === "register" || emailCheck === "email") && (
              <Field label="Password" hint={mode === "register" ? "Minimal 6 karakter." : ""}>
                <InputWrap icon={LockKeyhole}>
                  <input type={showPass ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="••••••" required />
                  <button type="button" onClick={() => setShowPass((v) => !v)} style={{ color: "var(--muted)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                    {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </InputWrap>
              </Field>
            )}
            {mode === "login" && onForgotPassword && emailCheck !== "notfound" && (
              <button type="button" className="cx-auth-forgot" onClick={onForgotPassword}>
                Lupa password?
              </button>
            )}
            {mode === "login" && emailCheck === "notfound" && (
              <button
                type="button"
                className="cx-btn cx-btn-primary cx-btn-full cx-signup-cta"
                onClick={() => { setError(""); setMessage(""); switchMode("register"); }}
              >
                Daftar sekarang <ArrowRight size={13} />
              </button>
            )}
            {mode === "login" && googleAccount && (
              <div className="cx-google-hint">
                <p><BadgeCheck size={13} /> Akun ini login lewat Google, tidak punya password.</p>
              </div>
            )}
            {message && <p className="cx-form-success"><BadgeCheck size={14} /> {message}</p>}
            {error && <p className="cx-form-error">{error}</p>}
            {mode === "register" && <Captcha state={captcha} />}
            {canResend && (
              <button type="button" className="cx-btn cx-btn-secondary cx-btn-full" disabled={busy} onClick={resendVerification}>
                <Mail size={13} /> Kirim ulang link verifikasi
              </button>
            )}
            {!(mode === "login" && (emailCheck === "notfound" || emailCheck === "google")) && (
            <button type="submit" className="cx-btn cx-btn-primary cx-btn-full cx-auth-submit" disabled={busy || (mode === "register" && !captcha.token)}>
              {busy ? <><RefreshCw size={13} /> Memproses...</> : <><LogIn size={13} /> {mode === "register" ? "Daftar sekarang" : "Masuk"}</>}
            </button>
            )}
          </form>

          {mode === "register" && (
            <p className="cx-auth-switch">
              Sudah punya akun?{" "}
              <button type="button" onClick={() => switchMode("login")}>
                Masuk di sini
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════
   PROFIL & TOP UP (halaman terpisah)
════════════════════════════════════════════════════ */
const QRIS_APPS = [
  { id: "DANA",      short: "DANA",  icon: "/wallets/dana.png",      color: "#118EEA", tint: "rgba(17,142,234,.14)" },
  { id: "GoPay",     short: "gopay", icon: "/wallets/gopay.png",     color: "#00AED6", tint: "rgba(0,174,214,.14)" },
  { id: "OVO",       short: "OVO",   icon: "/wallets/ovo.png",       color: "#4C3494", tint: "rgba(76,52,148,.16)" },
  { id: "SeaBank",   short: "SeaBank", icon: "/wallets/seabank.png", color: "#E85D04", tint: "rgba(232,93,4,.14)" },
  { id: "ShopeePay", short: "SPay",  icon: "/wallets/shopeepay.png", color: "#EE4D2D", tint: "rgba(238,77,45,.14)" },
  { id: "LinkAja",   short: "Link",  icon: "/wallets/linkaja.png",   color: "#E22B2B", tint: "rgba(226,43,43,.14)" },
  { id: "BCA",       short: "BCA",   icon: "/wallets/bca.png",       color: "#0066AE", tint: "rgba(0,102,174,.14)" },
  { id: "BRI",       short: "BRI",   icon: "/wallets/bri.png",       color: "#00529C", tint: "rgba(0,82,156,.14)" },
  { id: "BNI",       short: "BNI",   icon: "/wallets/bni.png",       color: "#00695C", tint: "rgba(0,105,92,.14)" },
  { id: "Mandiri",   short: "Livin", icon: "/wallets/mandiri.png",   color: "#003D79", tint: "rgba(0,61,121,.14)" },
];
const appMeta = (id) => QRIS_APPS.find((a) => a.id === id) || QRIS_APPS[QRIS_APPS.length - 1];

function AppLogo({ app, size = 34 }) {
  const m = appMeta(app);
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [m.icon]);
  const showImg = m.icon && !broken;
  return (
    <span className="cx-applogo" style={{ width: size * 1.55, height: size, background: m.tint, color: m.color, borderColor: m.color }}>
      {showImg
        ? <img
            src={m.icon}
            alt={m.id}
            className="cx-applogo-img"
            decoding="async"
            onError={() => setBroken(true)}
          />
        : m.short}
    </span>
  );
}

const IconWhatsApp = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
    <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.13h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.36c0-4.54 3.7-8.23 8.25-8.23a8.23 8.23 0 0 1 8.24 8.24c0 4.54-3.7 8.21-8.24 8.21z"/>
  </svg>
);
const IconTelegram = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#229ED9" aria-hidden="true">
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.64 6.8-1.6 7.56c-.12.54-.44.67-.89.42l-2.46-1.81-1.19 1.14c-.13.13-.24.24-.5.24l.18-2.53 4.6-4.16c.2-.18-.04-.28-.31-.1l-5.69 3.58-2.45-.77c-.53-.17-.54-.53.11-.79l9.58-3.69c.44-.16.83.1.62.91z"/>
  </svg>
);

const QRIS_IMAGE   = "/qris-kztutorial.png";
const QRIS_NAME    = "KZ.TUTORIAL";
const QRIS_NMID    = "ID1026476486182";
const WA_NUMBER    = "62895325844493";
const TG_USERNAME  = "Kztutorial";
const TOPUP_MIN = 10000;
/* Fallback lokal — sumber kebenaran tetap dari server (GET /api/topup → bonusTiers). */
const TOPUP_PRESETS = [
  { amount: 10000, bonus: 0 },
  { amount: 25000, bonus: 2000 },
  { amount: 50000, bonus: 4000 },
  { amount: 100000, bonus: 8000 },
  { amount: 250000, bonus: 20000 },
  { amount: 500000, bonus: 45000 },
];
/* Bonus saldo mengikuti nominal terbesar yang tercapai (juga untuk nominal custom). */
const topupBonus = (value, tiers) => {
  const list = Array.isArray(tiers) && tiers.length ? tiers : TOPUP_PRESETS;
  const v = Math.round(Number(value) || 0);
  let bonus = 0;
  for (const t of list) if (v >= (Number(t.amount) || 0)) bonus = Number(t.bonus) || 0;
  return bonus;
};


const topupStatusBadge = (status) =>
  status === "approved" ? <span className="cx-topup-badge ok"><BadgeCheck size={11} /> Disetujui</span>
  : status === "rejected" ? <span className="cx-topup-badge bad"><X size={11} /> Ditolak</span>
  : <span className="cx-topup-badge wait"><Clock size={11} /> Menunggu</span>;

function useTopupData(user) {
  const [state, setState] = useState({ balance: user.balance, topups: [], pendingTotal: 0, bonusTiers: TOPUP_PRESETS, loading: true, error: "" });
  const load = () => {
    setState((x) => ({ ...x, loading: true, error: "" }));
    jsonRequest("/api/topup", { method: "GET" })
      .then((p) => setState({
        balance: Number(p.balance) || 0,
        topups: p.topups || [],
        pendingTotal: Number(p.pendingTotal) || 0,
        bonusTiers: Array.isArray(p.bonusTiers) && p.bonusTiers.length
          ? p.bonusTiers.map((t) => ({ amount: Number(t.amount) || 0, bonus: Number(t.bonus) || 0 }))
          : TOPUP_PRESETS,
        loading: false,
        error: "",
      }))
      .catch((e) => setState((x) => ({ ...x, loading: false, error: e.message })));
  };
  useEffect(() => { load(); }, []);
  return [state, load];
}

/* ─── Halaman Profil (tanpa form top up) ─── */
/* Kompres foto profil di browser jadi kotak 256px supaya ringan disimpan. */
function compressAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) { reject(new Error("File harus berupa gambar (JPG/PNG).")); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error("Ukuran gambar maksimal 8MB.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gambar tidak bisa dibaca."));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function initialsOf(name) {
  return String(name || "AI").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "AI";
}

/* Avatar: pakai foto profil user kalau ada, kalau tidak inisial nama. */
function UserAvatar({ user, className = "" }) {
  const cls = `cx-avatar ${className}`.trim();
  const src = user && user.avatar;
  if (src) return <span className={`${cls} has-photo`}><img src={src} alt="" /></span>;
  return <div className={cls}>{initialsOf(user && user.name)}</div>;
}

function ProfilePage({ user, onBack, onTopup, onSaved, onNotice }) {
  const [state] = useTopupData(user);
  const pendingTotal = Number(state.pendingTotal) || 0;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: user.name || "", phone: user.phone || "" });
  const [avatar, setAvatar] = useState(user.avatar || "");
  const [avatarTouched, setAvatarTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState("");
  const [resetErr, setResetErr] = useState("");
  const [resetCooldown, startResetCooldown] = useSendCooldown("codexa:reset-link-until");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwShow, setPwShow] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });

  /* Ganti password langsung dari profil, tanpa perlu link email. */
  const changePassword = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (pwBusy) return;
    setPwMsg(""); setPwErr("");
    if (pwForm.next.length < 6) { setPwErr("Password baru minimal 6 karakter"); return; }
    if (pwForm.next !== pwForm.confirm) { setPwErr("Ulangi password baru belum sama"); return; }
    setPwBusy(true);
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "change-password", currentPassword: pwForm.current, password: pwForm.next }),
      });
      setPwForm({ current: "", next: "", confirm: "" });
      setPwShow(false);
      setPwOpen(false);
      if (onNotice) onNotice(res.message || "Password berhasil diganti");
    } catch (err) {
      setPwErr(err.message || "Gagal mengganti password");
    } finally { setPwBusy(false); }
  };


  const sendReset = async () => {
    if (resetBusy || resetCooldown > 0) return;
    setResetBusy(true); setResetMsg(""); setResetErr("");
    try {
      const res = await jsonRequest("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: "forgot-password", email: user.email }),
      });
      setResetMsg(res.message || "Link reset password sudah dikirim. Cek inbox atau folder spam.");
      startResetCooldown(res.retryAfter);
    } catch (e) {
      setResetErr(e.message || "Gagal mengirim link reset password");
      if (e.retryAfter) startResetCooldown(e.retryAfter);
    } finally { setResetBusy(false); }
  };

  const startEdit = () => {
    setForm({ name: user.name || "", phone: user.phone || "" });
    setAvatar(user.avatar || "");
    setAvatarTouched(false);
    setError("");
    setEditing(true);
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    try {
      const data = await compressAvatar(file);
      setAvatar(data);
      setAvatarTouched(true);
      setError("");
    } catch (e) { setError(e.message); }
  };

  const save = async () => {
    if (form.name.trim().length < 2) { setError("Nama minimal 2 karakter"); return; }
    setBusy(true); setError("");
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim() };
      if (avatarTouched) payload.avatar = avatar || null;
      const res = await jsonRequest("/api/auth", { method: "PATCH", body: JSON.stringify(payload) });
      setEditing(false);
      if (onSaved) onSaved(res.user);
      if (onNotice) onNotice("Profil berhasil diperbarui");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="cx-container cx-account-page">

      <div className="cx-account-grid">
        <div className="cx-panel cx-profile-card">
          <div className="cx-profile-head">
            <UserAvatar user={editing ? { name: form.name, avatar } : user} className="cx-avatar-xl" />
            <div className="cx-profile-head-copy">
              <h2>{editing ? (form.name || "Nama kamu") : user.name}</h2>
              <p>Member Akun Instan sejak {formatDate(user.createdAt)}</p>
            </div>
            {!editing && (
              <button className="cx-btn cx-btn-secondary cx-btn-sm cx-profile-edit-btn" onClick={startEdit}>
                <User size={12} /> Edit profil
              </button>
            )}
          </div>

          {editing && (
            <div className="cx-profile-form">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => { pickAvatar(e.target.files && e.target.files[0]); e.target.value = ""; }}
              />
              <div className="cx-profile-photo-row">
                <button type="button" className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => fileRef.current && fileRef.current.click()}>
                  <Mail size={12} /> {avatar ? "Ganti foto" : "Unggah foto"}
                </button>
                {avatar && (
                  <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => { setAvatar(""); setAvatarTouched(true); }}>
                    <X size={12} /> Hapus foto
                  </button>
                )}
              </div>
              <label className="cx-field">
                <span>Nama tampilan</span>
                <input
                  value={form.name}
                  maxLength={80}
                  placeholder="Nama kamu"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="cx-field">
                <span>Nomor WhatsApp</span>
                <input
                  value={form.phone}
                  maxLength={25}
                  inputMode="tel"
                  placeholder="08xxxxxxxxxx"
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              {error && <p className="cx-field-error" style={{ margin: 0 }}>{error}</p>}
              <div className="cx-profile-form-actions">
                <button className="cx-btn cx-btn-primary cx-btn-sm" disabled={busy} onClick={save}>
                  {busy ? <><Spinner size={12} /> Menyimpan...</> : <><Check size={12} /> Simpan perubahan</>}
                </button>
                <button className="cx-btn cx-btn-ghost cx-btn-sm" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>
                  Batal
                </button>
              </div>
            </div>
          )}

          <ul className="cx-profile-list">
            <li><Mail size={13} /><span>Email</span><strong>{user.email}</strong></li>
            <li>
              <ProviderIcon type={user.provider === "google" ? "google" : "email/password"} size={13} />
              <span>Daftar via</span>
              <strong>{user.provider === "google" ? "Google" : "Email & password"}</strong>
            </li>
            <li><Phone size={13} /><span>WhatsApp</span><strong>{user.phone || "-"}</strong></li>
            <li><BadgeCheck size={13} /><span>ID Akun</span><strong className="cx-mono">{String(user.id).slice(0, 8)}</strong></li>
            <li><ShieldCheck size={13} /><span>Status</span><strong>Terverifikasi</strong></li>
            <li>
              <ShieldCheck size={13} /><span>Role akun</span>
              <strong>
                {user.role === "admin" ? "Admin" : "User"}
                <span className={`cx-role-tag${user.role === "admin" ? "" : " is-user"}`}>
                  {user.role === "admin" ? "Akses penuh" : "Akses standar"}
                </span>
              </strong>
            </li>
          </ul>

          {user.provider !== "google" && (
            <div className="cx-profile-security">
              <div className="cx-profile-security-head">
                <span className="cx-profile-security-icon" aria-hidden="true"><KeyRound size={14} /></span>
                <div className="cx-profile-security-copy">
                  <strong>Ganti password</strong>
                  <small>Ubah password akun langsung di sini</small>
                </div>
                <button
                  type="button"
                  className="cx-btn cx-btn-ghost cx-btn-sm cx-profile-security-toggle"
                  onClick={() => { setPwOpen((v) => !v); setPwErr(""); setPwMsg(""); }}
                  aria-expanded={pwOpen}
                >
                  {pwOpen ? "Tutup" : "Ubah"}
                </button>
              </div>

              {pwOpen && (
                <form className="cx-profile-security-form" onSubmit={changePassword}>
                  <Field label="Password saat ini">
                    <InputWrap icon={LockKeyhole}>
                      <input
                        type={pwShow ? "text" : "password"}
                        value={pwForm.current}
                        onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                        placeholder="••••••"
                        autoComplete="current-password"
                        required
                      />
                      <button type="button" className="cx-eye-btn" onClick={() => setPwShow((v) => !v)} aria-label="Tampilkan password">
                        {pwShow ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </InputWrap>
                  </Field>
                  <Field label="Password baru" hint="Minimal 6 karakter.">
                    <InputWrap icon={KeyRound}>
                      <input
                        type={pwShow ? "text" : "password"}
                        value={pwForm.next}
                        onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                        placeholder="••••••"
                        autoComplete="new-password"
                        required
                      />
                    </InputWrap>
                  </Field>
                  <Field label="Ulangi password baru">
                    <InputWrap icon={KeyRound}>
                      <input
                        type={pwShow ? "text" : "password"}
                        value={pwForm.confirm}
                        onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                        placeholder="••••••"
                        autoComplete="new-password"
                        required
                      />
                    </InputWrap>
                  </Field>
                  {pwMsg && <p className="cx-profile-security-msg is-ok"><BadgeCheck size={12} /> {pwMsg}</p>}
                  {pwErr && <p className="cx-profile-security-msg is-err">{pwErr}</p>}
                  <div className="cx-profile-security-actions">
                    <button type="submit" className="cx-btn cx-btn-primary cx-btn-sm" disabled={pwBusy}>
                      {pwBusy ? <><Spinner size={12} /> Menyimpan...</> : <><ShieldCheck size={12} /> Simpan password</>}
                    </button>
                    <button
                      type="button"
                      className="cx-btn cx-btn-ghost cx-btn-sm"
                      disabled={pwBusy || resetBusy || resetCooldown > 0}
                      onClick={sendReset}
                    >
                      {resetBusy
                        ? <><Spinner size={12} /> Mengirim...</>
                        : resetCooldown > 0
                          ? <><Clock size={12} /> Link {resetCooldown}s</>
                          : <><Send size={12} /> Lupa password</>}
                    </button>
                  </div>
                  {resetMsg && <p className="cx-profile-security-msg is-ok"><BadgeCheck size={12} /> {resetMsg}</p>}
                  {resetErr && <p className="cx-profile-security-msg is-err">{resetErr}</p>}
                </form>
              )}
            </div>
          )}


          <div className="cx-balance-card">
            <span><Wallet size={13} /> Saldo tersedia</span>
            <strong>{formatPrice(state.balance)}</strong>
            {pendingTotal > 0 && <small>{formatPrice(pendingTotal)} menunggu verifikasi</small>}
          </div>

          <button className="cx-btn cx-btn-primary cx-btn-full" style={{ marginTop: 12 }} onClick={onTopup}>
            <CreditCard size={13} /> Top up saldo
          </button>
        </div>

        <div className="cx-panel cx-profile-activity">
          <div className="cx-panel-header">
            <h3>Aktivitas Top Up Terakhir</h3>
            <span className="cx-panel-sub">ringkasan 5 permintaan terbaru</span>
          </div>
          {state.loading ? <div className="cx-topup-empty">Memuat riwayat...</div>
            : state.error ? <div className="cx-topup-empty">{state.error}</div>
            : state.topups.length === 0 ? <div className="cx-topup-empty">Belum ada permintaan top up.</div>
            : state.topups.slice(0, 5).map((t) => (
              <div key={t.id} className="cx-topup-row cx-profile-activity-row">
                <strong className="cx-act-amount">{formatPrice(t.amount)}</strong>
                <span className="cx-act-detail">{t.method}</span>
                {t.reference && <span className="cx-act-refid">ID {t.reference}</span>}
                <span className="cx-topup-date">{formatDate(t.createdAt)}</span>
                {topupStatusBadge(t.status)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Halaman Top Up (QRIS otomatis via WijayaPay) ─── */
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function TopUpPage({ user, onBack, onNotice, onRefresh }) {
  const [state, load] = useTopupData(user);
  const [amount, setAmount]     = useState("");
  const [custom, setCustom]     = useState("");
  const [busy, setBusy]         = useState(false);
  const [formError, setFormError] = useState("");
  const [step, setStep]         = useState("form");
  const [payment, setPayment]   = useState(null);
  const [payStatus, setPayStatus] = useState("pending");
  const [now, setNow]           = useState(Date.now());
  const [copied, setCopied]     = useState(false);
  const [checking, setChecking] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const amountNumber = Math.round(Number(amount) || 0);
  const pendingTotal = Number(state.pendingTotal) || 0;
  /* Nominal & bonus mengikuti server supaya saldo yang masuk selalu sama dengan tampilan. */
  const bonusTiers = Array.isArray(state.bonusTiers) && state.bonusTiers.length ? state.bonusTiers : TOPUP_PRESETS;
  const customBonus = topupBonus(custom, bonusTiers);
  const expiredAt = payment && payment.expired ? new Date(payment.expired).getTime() : 0;
  const remaining = expiredAt ? expiredAt - now : 0;

  /* Timer countdown masa berlaku QRIS. */
  useEffect(() => {
    if (step !== "pay" || !expiredAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step, expiredAt]);

  /* Kunci scroll body saat popup terbuka. */
  useEffect(() => {
    if (step === "form") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [step]);

  /* Polling status pembayaran — saldo ditambah otomatis oleh server. */
  useEffect(() => {
    if (step !== "pay" || !payment || payStatus !== "pending") return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await jsonRequest(`/api/topup?resource=status&ref=${encodeURIComponent(payment.refId)}`, { method: "GET" });
        if (stop) return;
        if (res.status === "paid") {
          setPayStatus("paid");
          setStep("done");
          onNotice("Pembayaran diterima, saldo kamu sudah bertambah");
          load(); onRefresh();
          window.dispatchEvent(new Event("codexa:notify"));
        } else if (res.status === "expired") {
          setPayStatus("expired");
        }
      } catch (_) { /* diamkan, coba lagi di siklus berikutnya */ }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => { stop = true; clearInterval(timer); };
  }, [step, payment, payStatus]);

  /* Klik nominal → langsung buka popup konfirmasi singkat. */
  const openConfirm = (value) => {
    const v = Math.round(Number(value) || 0);
    if (!Number.isFinite(v) || v < TOPUP_MIN) { setFormError(`Minimal top up ${formatPrice(TOPUP_MIN)}.`); return; }
    setFormError("");
    setAmount(String(v));
    setStep("confirm");
  };

  const createPayment = async () => {
    setBusy(true); setFormError("");
    try {
      const res = await jsonRequest("/api/topup", {
        method: "POST",
        body: JSON.stringify({ amount: amountNumber }),
      });
      setPayment(res.payment);
      setPayStatus("pending");
      setNow(Date.now());
      setStep("pay");
      load(); onRefresh();
      window.dispatchEvent(new Event("codexa:notify"));
    } catch (err) { setFormError(err.message); setStep("confirm"); }
    finally { setBusy(false); }
  };

  const resetFlow = () => {
    setPayment(null); setPayStatus("pending"); setAmount(""); setCustom("");
    setStep("form"); setFormError(""); setBusy(false);
  };

  const copyQrString = async () => {
    if (!payment || !payment.qrString) return;
    try {
      await navigator.clipboard.writeText(payment.qrString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) { /* clipboard tidak tersedia */ }
  };

  /* Simpan gambar QR ke galeri / unduhan. */
  const triggerDownload = (href, name) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const saveQr = async () => {
    if (!payment || !payment.qrImage) return;
    const name = `qris-${payment.refId || "topup"}.png`;
    const src = payment.qrImage;
    if (src.startsWith("data:")) { triggerDownload(src, name); onNotice("QR tersimpan di perangkat"); return; }
    try {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) throw new Error("gagal");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      triggerDownload(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      onNotice("QR tersimpan di perangkat");
    } catch (_) {
      /* Cadangan: unduh langsung, kalau diblokir buka di tab baru agar bisa ditahan-simpan. */
      try { triggerDownload(src, name); } catch (_e) { window.open(src, "_blank", "noopener"); }
    }
  };

  /* Buka kembali QR untuk top up yang masih menunggu pembayaran. */
  const [openingQr, setOpeningQr] = useState("");
  const openExistingQr = async (ref) => {
    if (!ref || openingQr) return;
    setOpeningQr(ref);
    try {
      const res = await jsonRequest(`/api/topup?resource=qr&ref=${encodeURIComponent(ref)}`, { method: "GET" });
      setPayment(res.payment);
      setAmount(String(res.payment.totalBayar || 0));
      setPayStatus("pending");
      setNow(Date.now());
      setStep("pay");
    } catch (err) { onNotice(err.message); load(); }
    finally { setOpeningQr(""); }
  };


  const checkStatus = async () => {
    if (!payment || checking) return;
    setChecking(true);
    try {
      const res = await jsonRequest(`/api/topup?resource=status&ref=${encodeURIComponent(payment.refId)}`, { method: "GET" });
      if (res.status === "paid") {
        setPayStatus("paid"); setStep("done");
        onNotice("Pembayaran diterima, saldo kamu sudah bertambah");
        load(); onRefresh();
      } else if (res.status === "expired") { setPayStatus("expired"); }
      else { onNotice("Pembayaran belum terdeteksi, coba lagi sebentar."); }
    } catch (e) { onNotice(e.message); }
    finally { setChecking(false); }
  };

  const pendingTopup = state.topups.find((t) => t.status === "pending");
  const payAmount = payment ? (payment.totalBayar || amountNumber) : amountNumber;

  return (
    <div className="cx-container cx-account-page cx-topup-page">

      <header className="cx-topup-hero-head">
        <h1>Top Up Saldo</h1>
        <p>Isi saldo via QRIS — diterima semua bank &amp; e-wallet di Indonesia.</p>
      </header>

      <section className="cx-balance-hero">
        <span className="cx-balance-hero-cap"><Wallet size={12} /> Saldo saat ini</span>
        <strong>{state.loading ? "..." : formatPrice(state.balance)}</strong>
        {pendingTotal > 0 && <small>{formatPrice(pendingTotal)} menunggu pembayaran</small>}
      </section>

      {pendingTopup && step === "form" && (
        <section className="cx-pending-banner">
          <span className="cx-pending-icon"><Clock size={18} /></span>
          <div>
            <strong>Deposit menunggu pembayaran</strong>
            <small>{formatPrice(pendingTopup.amount)}{pendingTopup.reference ? ` · Ref ${pendingTopup.reference}` : ""}</small>
          </div>
          <div className="cx-pending-actions">
            {pendingTopup.reference && (
              <button
                type="button"
                className="cx-btn cx-btn-primary cx-btn-sm"
                onClick={() => openExistingQr(pendingTopup.reference)}
                disabled={openingQr === pendingTopup.reference}
              >
                {openingQr === pendingTopup.reference ? <Spinner size={12} /> : <QrCode size={12} />} Lihat QR
              </button>
            )}
            <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => openConfirm(pendingTopup.amount)}>
              <CreditCard size={12} /> Top up lagi
            </button>
          </div>
        </section>
      )}


      <div className="cx-account-grid">
        <section className="cx-panel cx-topup-selection">
          <div className="cx-nominal-head">
            <div>
              <h2>Pilih Nominal</h2>
              <p>Min {formatPrice(TOPUP_MIN)} · Max {formatPrice(10000000)}</p>
            </div>
            <div className="cx-nominal-actions">
              <span className="cx-nominal-tag"><Sparkles size={11} /> QRIS instan</span>
            <button
              type="button"
              className="cx-icon-btn cx-topup-help-btn"
              aria-label="Cara top up"
              title="Cara Top Up"
              onClick={() => setShowGuide(true)}
            >
              <CircleHelp size={15} />
            </button>
            </div>
          </div>

          <div className="cx-topup-form">
            <div className="cx-nominal-grid">
              {bonusTiers.map((t) => (
                <button
                  type="button"
                  key={t.amount}
                  className="cx-nominal-tile"
                  onClick={() => openConfirm(t.amount)}
                >
                  <span className="cx-nominal-cap">Top up</span>
                  <strong>{formatPrice(t.amount)}</strong>
                  {t.bonus > 0 && <span className="cx-nominal-bonus">BONUS +{formatPrice(t.bonus)}</span>}
                  <small>Saldo diterima {formatPrice(t.amount + t.bonus)}</small>
                </button>
              ))}
            </div>
            <p className="cx-nominal-note"><Sparkles size={11} /> Bonus otomatis masuk setelah pembayaran berhasil.</p>

            <div className="nk-custom">
              <span className="cx-field-label">Atau nominal custom</span>
              <div className="nk-custom-input">
                <span className="nk-custom-rp">Rp</span>
                <input
                  type="number" min="10000" step="500" value={custom} inputMode="numeric" placeholder="10000"
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openConfirm(custom); } }}
                />
                <button type="button" className="cx-btn cx-btn-primary cx-btn-sm nk-custom-go" disabled={Math.round(Number(custom) || 0) < TOPUP_MIN} onClick={() => openConfirm(custom)}>
                  <span>Lanjutkan</span> <ArrowRight size={12} />
                </button>
              </div>
              <small className="cx-field-hint">Minimal {formatPrice(TOPUP_MIN)} · Maksimal Rp10.000.000. QRIS dibuat otomatis sesuai nominal ini.</small>
              {Math.round(Number(custom) || 0) > 0 && Math.round(Number(custom) || 0) < TOPUP_MIN && (
                <small className="cx-nominal-invalid">Nominal minimal {formatPrice(TOPUP_MIN)}.</small>
              )}
              {Math.round(Number(custom) || 0) >= TOPUP_MIN && (
                <small className="cx-nominal-bonus-hint">{customBonus > 0 ? `Bonus +${formatPrice(customBonus)} · ` : ""}saldo diterima {formatPrice(Math.round(Number(custom) || 0) + customBonus)}</small>
              )}
            </div>

            <div className="cx-pay-apps">
              <div className="cx-pay-apps-head">
                <strong>Bisa Bayar dari Aplikasi</strong>
                <small>Bank &amp; e-wallet berlogo QRIS</small>
              </div>
              <div className="cx-app-grid">
                {QRIS_APPS.map((a) => (
                  <div key={a.id} className="cx-app-tile is-static">
                    <AppLogo app={a.id} size={28} />
                    <span>{a.id.replace("QRIS ", "")}</span>
                  </div>
                ))}
              </div>
            </div>
            {formError && <p className="cx-form-error">{formError}</p>}
          </div>
        </section>

        <section className="cx-panel cx-topup-history">
          <div className="cx-panel-header">
            <h3>Riwayat Top Up</h3>
            <span className="cx-panel-sub">saldo {formatPrice(state.balance)}{pendingTotal > 0 ? ` · ${formatPrice(pendingTotal)} belum dibayar` : ""}</span>
          </div>
          {state.loading ? <div className="cx-topup-empty">Memuat riwayat...</div>
            : state.error ? <div className="cx-topup-empty">{state.error}</div>
            : state.topups.length === 0 ? <div className="cx-topup-empty">Belum ada permintaan top up.</div>
            : state.topups.map((t) => (
              <div key={t.id} className="cx-topup-row">
                <div className="cx-topup-info">
                  <strong>{formatPrice(t.amount)}</strong>
                  <small>{t.method}{t.reference ? ` · Ref ${t.reference}` : ""}</small>
                </div>
                <div className="cx-topup-side">
                  {topupStatusBadge(t.status)}
                  <span className="cx-topup-date">{formatDate(t.createdAt)}</span>
                </div>
                {t.status === "pending" && t.reference && (
                  <button
                    type="button"
                    className="cx-btn cx-btn-outline cx-btn-sm cx-topup-qr-btn"
                    onClick={() => openExistingQr(t.reference)}
                    disabled={openingQr === t.reference}
                  >
                    {openingQr === t.reference ? <Spinner size={11} /> : <QrCode size={11} />} Lihat QR
                  </button>
                )}
              </div>
            ))}
        </section>
      </div>

      {showGuide && createPortal(
        <div className="cx-modal-backdrop nk-pop-backdrop" onClick={() => setShowGuide(false)}>
          <div className="cx-modal nk-pop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nk-pop-body">
              <span className="nk-pop-icon"><CircleHelp size={44} /></span>
              <h2>Cara Top Up</h2>
              <ol className="cx-topup-guide-list">
                <li>Pilih nominal top up.</li>
                <li>Klik Buat QRIS, lalu scan dari aplikasi bank / e-wallet.</li>
                <li>Saldo bertambah otomatis, biasanya di bawah 1 menit.</li>
              </ol>
              <div className="nk-pop-actions">
                <button type="button" className="cx-btn cx-btn-primary" onClick={() => setShowGuide(false)}>Mengerti</button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Popup konfirmasi nominal / loading QRIS ── */}
      {step === "confirm" && createPortal(
        <div className="cx-modal-backdrop nk-pop-backdrop" onClick={() => !busy && resetFlow()}>
          <div className="cx-modal nk-pop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {busy ? (
              <div className="nk-pop-body nk-pop-loading">
                <h2>Membuat QRIS...</h2>
                <p>Tunggu sebentar</p>
                <Spinner size={26} />
              </div>
            ) : (
              <div className="nk-pop-body">
                <span className="nk-pop-icon"><CircleHelp size={44} /></span>
                <h2>Buat Top Up</h2>
                <strong className="nk-pop-amount">{formatPrice(amountNumber)}</strong>
                <p>QRIS akan otomatis dibuat. Bayar pakai bank atau e-wallet apapun.</p>
                {formError && <p className="cx-form-error">{formError}</p>}
                <div className="nk-pop-actions">
                  <button type="button" className="cx-btn cx-btn-ghost" onClick={resetFlow}>Batal</button>
                  <button type="button" className="cx-btn cx-btn-primary" onClick={createPayment}>
                    <QrCode size={14} /> Buat QRIS
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>, document.body)}

      {/* ── Popup scan & bayar QRIS ── */}
      {step === "pay" && payment && createPortal(
        <div className="cx-modal-backdrop nk-pop-backdrop" onClick={() => resetFlow()}>
          <div className="cx-modal nk-pay" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nk-pay-head">
              <span className="nk-pay-head-icon"><QrCode size={20} /></span>
              <div>
                <strong>Bayar QRIS</strong>
                <small>{payStatus === "expired" ? "QRIS expired — buat baru" : "Scan & bayar sekarang"}</small>
              </div>
              <button type="button" className="nk-pay-close" onClick={resetFlow} aria-label="Tutup"><X size={20} /></button>
            </div>

            <div className="nk-pay-body">
              <span className="nk-pay-cap">Total bayar</span>
              <strong className="nk-pay-amount">{formatPrice(payAmount)}</strong>

              <div className="nk-pay-qr">
                {payment.qrImage
                  ? <img src={payment.qrImage} alt="QRIS pembayaran" />
                  : <div className="cx-topup-empty">QR tidak tersedia, salin kode QRIS di bawah.</div>}
              </div>

              <span className={`nk-pay-timer${remaining <= 0 || payStatus === "expired" ? " is-out" : ""}`}>
                <Clock size={13} /> {formatCountdown(remaining)}
              </span>

              <div className="nk-pay-actions">
                <button type="button" className="cx-btn cx-btn-secondary" onClick={payment.qrImage ? saveQr : copyQrString}>
                  {payment.qrImage ? <><Download size={13} /> Simpan QR</> : (copied ? <><Check size={13} /> Tersalin</> : <><FileText size={13} /> Salin kode</>)}
                </button>
                <button type="button" className="cx-btn cx-btn-outline nk-pay-check" onClick={checkStatus} disabled={checking}>
                  {checking ? <Spinner size={13} /> : <RefreshCw size={13} />} Cek Status
                </button>
              </div>

              <details className="nk-pay-guide">
                <summary><CircleHelp size={13} /> Cara Bayar</summary>
                <ol>
                  <li>Buka aplikasi e-wallet / m-banking, pilih menu QRIS / Scan.</li>
                  <li>Scan QR di atas — nominal sudah terisi otomatis.</li>
                  <li>Selesaikan pembayaran, saldo bertambah otomatis.</li>
                </ol>
              </details>

              <p className="nk-pay-id">ID: {payment.refId}</p>
            </div>
          </div>
        </div>, document.body)}

      {/* ── Popup pembayaran berhasil ── */}
      {step === "done" && createPortal(
        <div className="cx-modal-backdrop nk-pop-backdrop" onClick={resetFlow}>
          <div className="cx-modal nk-pop" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nk-pop-body">
              <span className="nk-pop-icon is-ok"><BadgeCheck size={44} /></span>
              <h2>Pembayaran Berhasil</h2>
              <strong className="nk-pop-amount">{formatPrice(state.balance)}</strong>
              <p>Saldo terbaru kamu sudah bertambah otomatis.</p>
              <div className="nk-pop-actions">
                <button type="button" className="cx-btn cx-btn-ghost" onClick={() => { resetFlow(); onBack(); }}>Tutup</button>
                <button type="button" className="cx-btn cx-btn-primary" onClick={resetFlow}>Top up lagi</button>
              </div>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   ASSISTEN AI (Qwen) — floating widget
   Role ditentukan server dari cookie sesi:
   admin → akses penuh, user → hanya data sendiri.
════════════════════════════════════════════════════ */
const ASSISTANT_HINTS = {
  user: [
    "Cek status akun saya",
    "Saldo saya berapa sekarang?",
    "Riwayat top up terakhir saya",
    "Top up saya belum masuk, tolong bantu",
  ],
  admin: [
    "Ringkasan toko hari ini",
    "Ada top up pending? tampilkan",
    "Cari user dengan email ...",
    "Ada laporan user apa aja?",
    "Tampilkan isi database (tabel + jumlah baris)",
    "Hapus laporan yang sudah closed",
  ],
};

/* ── Markdown ringan untuk balasan Assisten ──
   Model sering menulis **tebal**, daftar, dan `kode`. Tanpa renderer, simbolnya
   ikut tampil mentah di bubble chat. Ini parser kecil tanpa dependensi. ── */
function renderInline(raw, keyPrefix) {
  const nodes = [];
  const re = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  let n = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) nodes.push(raw.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (tok.startsWith("**") || tok.startsWith("__")) nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < raw.length) nodes.push(raw.slice(last));
  return nodes.length ? nodes : [raw];
}

function parseBlocks(text) {
  const blocks = [];
  String(text || "")
    .replace(/\r/g, "")
    .replace(/```/g, "")
    .split("\n")
    .forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const last = blocks[blocks.length - 1];
      const heading = t.match(/^#{1,6}\s+(.*)$/);
      if (heading) { blocks.push({ kind: "h", text: heading[1] }); return; }
      const bullet = t.match(/^[-*•]\s+(.*)$/);
      if (bullet) {
        if (last && last.kind === "ul") last.items.push(bullet[1]);
        else blocks.push({ kind: "ul", items: [bullet[1]] });
        return;
      }
      const numbered = t.match(/^\d+[.)]\s+(.*)$/);
      if (numbered) {
        if (last && last.kind === "ol") last.items.push(numbered[1]);
        else blocks.push({ kind: "ol", items: [numbered[1]] });
        return;
      }
      // baris tabel markdown → jadikan teks biasa yang rapi
      if (/^\|.*\|$/.test(t)) {
        const cells = t.split("|").map((c) => c.trim()).filter(Boolean);
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
        blocks.push({ kind: "p", text: cells.join(" · ") });
        return;
      }
      blocks.push({ kind: "p", text: t });
    });
  return blocks;
}

function RichText({ text }) {
  const blocks = parseBlocks(text);
  if (!blocks.length) return null;
  return (
    <div className="cx-md">
      {blocks.map((b, i) => {
        if (b.kind === "h") return <p key={i} className="cx-md-h">{renderInline(b.text, `h${i}`)}</p>;
        if (b.kind === "ul") return <ul key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `u${i}-${j}`)}</li>)}</ul>;
        if (b.kind === "ol") return <ol key={i}>{b.items.map((it, j) => <li key={j}>{renderInline(it, `o${i}-${j}`)}</li>)}</ol>;
        return <p key={i}>{renderInline(b.text, `p${i}`)}</p>;
      })}
    </div>
  );
}

/** Nama tool → label pendek yang enak dibaca di progres chat. */
function toolLabel(name) {
  return String(name || "tool")
    .replace(/^admin_/, "")
    .replace(/^get_my_/, "")
    .replace(/_/g, " ");
}

export function AssistantWidget({ open: openProp, onOpenChange, hideFab = false, scope = "", guest = false, onLogin, onRegister }) {
  const apiUrl = scope === "admin" ? "/api/assistant?scope=admin" : "/api/assistant";
  const controlled = typeof openProp === "boolean";
  const [openState, setOpenState] = useState(false);
  const open = controlled ? openProp : openState;
  const setOpen = (v) => {
    const next = typeof v === "function" ? v(open) : v;
    if (controlled) { if (onOpenChange) onOpenChange(next); }
    else setOpenState(next);
  };
  const [info, setInfo] = useState({ loading: true, role: "", available: false, model: "", reason: "", error: "" });
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Progres langsung dari server saat assisten bekerja (catatan + tool berjalan).
  const [live, setLive] = useState({ notes: [], steps: [] });
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const inputRef = useRef(null);

  const loadInfo = () => {
    setInfo((s) => ({ ...s, loading: true, error: "" }));
    fetch(apiUrl, { credentials: "same-origin" })
      .then(async (r) => {
        const p = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(p.error || "Assisten tidak tersedia");
        return p;
      })
      .then((p) => setInfo({ loading: false, role: p.role, available: p.available, model: p.model || "", reason: p.reason || "", error: "" }))
      .catch((e) => setInfo({ loading: false, role: "", available: false, model: "", reason: "", error: e.message }));
  };

  useEffect(() => {
    if (!open) return;
    if (guest) { setInfo({ loading: false, role: "", available: false, model: "", reason: "guest", error: "" }); return; }
    loadInfo();
  }, [open, guest]);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);

  const isAdminMode = info.role === "admin";

  const send = async (raw) => {
    const content = String(raw == null ? draft : raw).trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    setLive({ notes: [], steps: [] });
    const pushNote = (text) => setLive((s) => ({ ...s, notes: [...s.notes, text] }));
    const startTool = (name) =>
      setLive((s) => ({ ...s, steps: [...s.steps, { name, status: "run", error: "" }] }));
    const endTool = (name, ok, err) =>
      setLive((s) => ({
        ...s,
        steps: s.steps.map((st, i) =>
          st.name === name && st.status === "run" && !s.steps.slice(i + 1).some((x) => x.name === name && x.status === "run")
            ? { ...st, status: ok ? "done" : "fail", error: err || "" }
            : st,
        ),
      }));

    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })), stream: true }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Assisten gagal menjawab");
      }
      if (!res.body || !res.body.getReader) {
        // Browser lama: fallback ke respons JSON biasa.
        const payload = await res.json().catch(() => ({}));
        setMessages([...next, { role: "assistant", content: payload.reply || "", actions: payload.actions || [] }]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = null;
      const notes = [];
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const raw = line.trim();
          if (!raw) continue;
          let ev;
          try { ev = JSON.parse(raw); } catch (_) { continue; }
          if (ev.type === "note" && ev.text) { notes.push(ev.text); pushNote(ev.text); }
          else if (ev.type === "tool_start") startTool(ev.name);
          else if (ev.type === "tool_end") endTool(ev.name, ev.ok !== false, ev.error);
          else if (ev.type === "error") throw new Error(ev.error || "Assisten gagal menjawab");
          else if (ev.type === "done") done = ev;
        }
      }
      if (!done) throw new Error("Koneksi ke Assisten terputus, coba lagi.");
      setMessages([
        ...next,
        { role: "assistant", content: done.reply || "", actions: done.actions || [], notes },
      ]);
    } catch (e) {
      setError(e.message);
      setMessages(next);
    } finally {
      setLive({ notes: [], steps: [] });
      setBusy(false);
      if (inputRef.current) inputRef.current.focus();
    }
  };

  const hints = ASSISTANT_HINTS[isAdminMode ? "admin" : "user"];

  return (
    <>
      {!hideFab && (
        <button
          className={`cx-ai-fab${open ? " open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Tutup Assisten" : "Buka Assisten"}
        >
          {open ? <X size={16} /> : <Sparkles size={16} />}
          {!open && <span className="cx-ai-fab-label">Assisten</span>}
        </button>
      )}

      {open && <div className="cx-ai-backdrop" onClick={() => setOpen(false)} />}

      {open && (
        <div className="cx-ai-panel" role="dialog" aria-label="Assisten Akun Instan">
          <div className="cx-ai-grab" />
          <div className="cx-ai-head">
            <div className="cx-ai-avatar"><Sparkles size={14} /></div>
            <div className="cx-ai-head-copy">
              <strong>Assisten Akun Instan</strong>
              <small>
                {guest ? "Masuk dulu untuk mulai ngobrol"
                  : info.loading ? "Menyiapkan..."
                  : info.error ? "Perlu masuk dulu"
                  : isAdminMode ? "Mode admin · akses penuh"
                  : "Mode user · data akun kamu"}
              </small>
            </div>
            {guest && <span className="cx-ai-badge"><LockKeyhole size={10} />Tamu</span>}
            {!guest && !info.loading && !info.error && (
              <span className={`cx-ai-badge${isAdminMode ? " admin" : ""}`}>
                {isAdminMode ? <ShieldCheck size={10} /> : <User size={10} />}
                {isAdminMode ? "Admin" : "User"}
              </span>
            )}
            <button className="cx-icon-btn" onClick={() => setOpen(false)} aria-label="Tutup"><X size={13} /></button>
          </div>

          <div className="cx-ai-body" ref={scroller}>
            {guest ? (
              <div className="cx-ai-gate">
                <div className="cx-ai-gate-icon"><LockKeyhole size={20} /></div>
                <strong>Masuk dulu untuk pakai Assisten</strong>
                <p>Assisten butuh akunmu supaya bisa cek pesanan, saldo, status akun, dan meneruskan kendala ke admin dengan aman.</p>
                <ul className="cx-ai-gate-list">
                  <li><Check size={11} /> Cek status pesanan & detail akun</li>
                  <li><Check size={11} /> Lihat saldo dan riwayat top up</li>
                  <li><Check size={11} /> Lapor kendala langsung ke admin</li>
                </ul>
                <div className="cx-ai-gate-cta">
                  <button className="cx-btn cx-btn-primary cx-btn-full" onClick={() => { setOpen(false); if (onLogin) onLogin(); }}>
                    <LogIn size={14} /> Masuk
                  </button>
                  <button className="cx-btn cx-btn-secondary cx-btn-full" onClick={() => { setOpen(false); if (onRegister) onRegister(); }}>
                    <UserPlus size={14} /> Daftar gratis
                  </button>
                </div>
                <small className="cx-ai-gate-note">Gratis, cuma butuh email aktif.</small>
              </div>
            ) : null}

            {!guest && info.loading && <div className="cx-ai-empty"><RefreshCw size={18} /><p>Menghubungkan ke Assisten...</p></div>}

            {!guest && !info.loading && info.error && (
              <div className="cx-ai-empty">
                <LockKeyhole size={18} />
                <p>{info.error}</p>
                <button className="cx-btn cx-btn-ghost" onClick={loadInfo}>Coba lagi</button>
              </div>
            )}

            {!guest && !info.loading && !info.error && !info.available && (
              <div className="cx-ai-empty">
                <LockKeyhole size={18} />
                <p>
                  {info.reason === "disabled"
                    ? "Assisten sedang dimatikan oleh admin. Coba lagi nanti."
                    : info.role === "admin"
                      ? "Assisten belum aktif. Isi API key di Admin Panel → Assisten."
                      : "Assisten belum aktif. Admin sedang menyiapkannya, coba lagi nanti."}
                </p>
                <button className="cx-btn cx-btn-ghost" onClick={loadInfo}>Coba lagi</button>
              </div>
            )}

            {!guest && !info.loading && !info.error && info.available && messages.length === 0 && (
              <div className="cx-ai-intro">
                <p>
                  {isAdminMode
                    ? "Mode admin aktif. Aku bisa baca & ubah data user, saldo, status akun, top up, dan produk."
                    : "Hai! Aku bisa cek info & status akun kamu, saldo, riwayat top up, ubah profil, dan meneruskan masalahmu ke admin."}
                </p>
                <div className="cx-ai-hints">
                  {hints.map((h) => (
                    <button key={h} onClick={() => send(h)}>{h}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`cx-ai-msg ${m.role}`}>
                {m.role === "assistant" && m.notes && m.notes.length > 0 && (
                  <div className="cx-ai-notes">
                    {m.notes.map((n, j) => <p key={j}><Check size={9} />{n}</p>)}
                  </div>
                )}
                <div className="cx-ai-bubble">
                  {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                </div>
                {m.role === "assistant" && m.actions && m.actions.length > 0 && (
                  <div className="cx-ai-actions">
                    {m.actions.map((a, j) => <span key={j}><Check size={9} />{a}</span>)}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="cx-ai-msg assistant">
                {live.notes.map((n, i) => (
                  <div className="cx-ai-bubble" key={`n${i}`}><RichText text={n} /></div>
                ))}
                {live.steps.length > 0 && (
                  <div className="cx-ai-steps">
                    {live.steps.map((st, i) => (
                      <span key={i} className={st.status}>
                        {st.status === "run" ? <RefreshCw size={9} className="cx-spin" />
                          : st.status === "done" ? <Check size={9} /> : <X size={9} />}
                        {toolLabel(st.name)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="cx-ai-bubble cx-ai-typing"><i /><i /><i /></div>
              </div>
            )}

            {error && <div className="cx-ai-error">{error}</div>}
          </div>

          {!guest && !info.loading && !info.error && info.available && (
            <div className="cx-ai-composer-wrap">
              <form
                className="cx-ai-composer"
                onSubmit={(e) => { e.preventDefault(); send(); }}
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={isAdminMode ? "Perintah untuk Assisten admin..." : "Tanya apa saja soal akunmu..."}
                  maxLength={2000}
                  disabled={busy}
                />
                <button type="submit" className="cx-ai-send" disabled={busy || !draft.trim()} aria-label="Kirim">
                  {busy ? <RefreshCw size={13} /> : <Send size={13} />}
                </button>
              </form>
            </div>
          )}

          {!guest && !info.loading && !info.error && info.available && !isAdminMode && (
            <p className="cx-ai-foot"><ShieldCheck size={9} /> Assisten hanya bisa mengakses data akunmu sendiri.</p>
          )}
        </div>
      )}
    </>
  );
}

/* ─── mount ─── */
class RootErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error("[akuninstan]", err); } catch (_) {} }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: "#e9e6f5", background: "#120a1e", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
        <div style={{ maxWidth: 380 }}>
          <h2 style={{ margin: "0 0 8px" }}>Halaman gagal dimuat</h2>
          <p style={{ margin: "0 0 18px", color: "#a99fc4", fontSize: 14 }}>Coba muat ulang. Jika masih kosong, bersihkan data lokal lalu buka lagi.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => window.location.reload()} style={{ padding: "11px 18px", borderRadius: 12, border: 0, background: "linear-gradient(135deg,#7c5cff,#a06bff)", color: "#fff", fontWeight: 600 }}>Muat ulang</button>
            <button onClick={() => { try { window.localStorage.removeItem("codexa:cart"); } catch (_) {} window.location.replace("/"); }} style={{ padding: "11px 18px", borderRadius: 12, border: "1px solid #2f2247", background: "transparent", color: "#e9e6f5", fontWeight: 600 }}>Bersihkan & buka ulang</button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(<React.StrictMode><RootErrorBoundary><App /></RootErrorBoundary></React.StrictMode>);

