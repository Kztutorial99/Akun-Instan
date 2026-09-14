import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, LayoutDashboard, Wallet, ArrowUpRight, ArrowDownRight, BadgeCheck, Bell, Check, CircleHelp, Command, Eye, EyeOff, ChevronDown, FileText, LockKeyhole, LogIn, LogOut, Menu, MoreHorizontal, Package, PanelLeft, Pencil, Plus, RefreshCw, Search, Settings, ShieldCheck, ShoppingBag, Trash2, X, User, Mail, Copy, Sparkles, TrendingUp, Star,
} from "lucide-react";
import {
  ACCENT_COLORS, ActionBtn, AssistantWidget, agedInfoOf, AGED_DEFAULTS, jsonRequest, CUSTOM_EMAIL_FEE, CUSTOM_EMAIL_STATUS_LABEL, CUSTOM_GENDER_LABEL, ExpandableText, Field, InputWrap, LOGIN_TYPES, PRODUCT_TEMPLATES, ProductDescription, ProviderIcon, RowSkeleton, SessionSplash, Spinner, customEmailsOf, emptyListing, formatBirthDate, formatDate, formatPrice, useConfirmDialog, usePendingActions,
} from "./main.jsx";
import "./admin-ui.css";

function AdminPage({ onBack, onNotice }) {
  const [authenticated, setAuthenticated] = useState(null);
  const [password, setPassword]           = useState("");
  const [loginError, setLoginError]       = useState("");
  const [listings, setListings]           = useState([]);
  const [loading, setLoading]             = useState(false);
  const [apiError, setApiError]           = useState("");
  const [form, setForm]                   = useState(null);
  const [saving, setSaving]               = useState(false);
  const [revealed, setRevealed]           = useState(false);
  const [search, setSearch]               = useState("");
  const [activeNav, setActiveNav]         = useState("Dashboard");
  const [navOpen, setNavOpen]             = useState(false);
  const [asstOpen, setAsstOpen]           = useState(false);
  const [topups, setTopups]               = useState([]);
  const [users, setUsers]                 = useState([]);
  const [userQuery, setUserQuery]         = useState("");
  const [userFilter, setUserFilter]       = useState("all");
  const [copiedId, setCopiedId]           = useState("");
  const [userPage, setUserPage]           = useState(1);
  const [userForm, setUserForm]           = useState(null);
  const [userDetail, setUserDetail]       = useState(null);
  const [userActivity, setUserActivity]   = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingUser, setSavingUser]       = useState(false);
  const [aiCfg, setAiCfg]                 = useState(null);
  const [aiForm, setAiForm]               = useState(null);
  const [savingAi, setSavingAi]           = useState(false);
  const [agedCfg, setAgedCfg]             = useState(AGED_DEFAULTS);
  const [agedForm, setAgedForm]           = useState(null);
  const [savingAged, setSavingAged]       = useState(false);
  const [agedError, setAgedError]         = useState("");
  const [aiNotice, setAiNotice]           = useState("");
  const [aiError, setAiError]             = useState("");
  const [testingAi, setTestingAi]         = useState(false);
  const [reviews, setReviews]             = useState([]);
  const [reviewSummary, setReviewSummary] = useState({ total: 0, user: 0, injected: 0, ratingAvg: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewFilter, setReviewFilter]   = useState("all");
  const [reviewListing, setReviewListing] = useState("all");
  const [injectForm, setInjectForm]       = useState({ listingId: "all", count: 8, minRating: 4, maxRating: 5, spreadDays: 60 });
  const [sales, setSales]                 = useState([]);
  const [soldForm, setSoldForm]           = useState({ listingId: "all", soldMode: "add", soldMin: 10, soldMax: 40 });
  const [demoForm, setDemoForm]           = useState({ count: 6, template: "mixed" });
  const [demoTemplates, setDemoTemplates] = useState([]);
  const [demoCount, setDemoCount]         = useState(0);


  const [orders, setOrders]               = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [headerMenu, setHeaderMenu]       = useState("");
  const [ceDraft, setCeDraft]             = useState({});
  const [openBuyers, setOpenBuyers]       = useState({});
  const [confirm, confirmDialog]          = useConfirmDialog();
  const [isPending, runAction]            = usePendingActions();
  const [dismissedAlerts, setDismissedAlerts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("codexa.admin.alerts.dismissed") || "[]"); }
    catch (_) { return []; }
  });
  const contentRef = useRef(null);

  const persistDismissed = (list) => {
    setDismissedAlerts(list);
    try { localStorage.setItem("codexa.admin.alerts.dismissed", JSON.stringify(list)); } catch (_) {}
  };
  const dismissAlert = (key) => { persistDismissed([...new Set([...dismissedAlerts, key])]); onNotice("Notifikasi dihapus"); };

  // Pindah menu = konten selalu mulai dari atas, tidak menggantung di tengah.
  const goNav = (label) => {
    setActiveNav(label);
    setNavOpen(false);
    if (label === "Pengguna") setUserQuery("");
    if (label === "Ulasan & Rating" || label === "Inject Data") loadReviews();
    if (label === "Inject Data") loadDemoCount();

  };

  /* ── Ulasan & rating: dibaca dari sub-resource /api/admin/products?resource=reviews ── */
  const REVIEWS_API = "/api/admin/products?resource=reviews";

  const applyReviewPayload = (p) => {
    if (Array.isArray(p.reviews)) setReviews(p.reviews);
    if (p.summary) setReviewSummary(p.summary);
    if (Array.isArray(p.sales)) setSales(p.sales);
  };

  const loadReviews = () => {
    setReviewsLoading(true);
    return jsonRequest(REVIEWS_API, { method: "GET" })
      .then(applyReviewPayload)
      .catch((e) => setApiError(e.message))
      .finally(() => setReviewsLoading(false));
  };

  const injectReviews = async () => {
    await runAction("review-inject", async () => {
      try {
        const p = await jsonRequest(REVIEWS_API, { method: "POST", body: JSON.stringify(injectForm) });
        applyReviewPayload(p);
        const extra = p.skipped ? ` · ${p.skipped} dilewati (teks kembar)` : "";
        onNotice(`${p.inserted} ulasan ditambahkan ke ${p.listings} produk${extra}`);
      } catch (e) { setApiError(e.message); }
    });
  };

  /* ── Inject produk etalase (selalu stok habis) ── */
  const DEMO_API = "/api/admin/products?resource=demo";

  const loadDemoCount = () =>
    jsonRequest(DEMO_API, { method: "GET" })
      .then((p) => {
        setDemoCount(p.demoCount || 0);
        if (Array.isArray(p.templates)) setDemoTemplates(p.templates);
      })
      .catch(() => {});

  const injectDemoProducts = async () => {
    await runAction("demo-inject", async () => {
      try {
        const p = await jsonRequest(DEMO_API, { method: "POST", body: JSON.stringify(demoForm) });
        setDemoCount(p.demoCount || 0);
        loadListings();
        onNotice(`${p.inserted} produk etalase ditambahkan ke katalog`);
      } catch (e) { setApiError(e.message); }

    });
  };

  const clearDemoProducts = async () => {
    const ok = await confirm({
      title: "Hapus semua produk etalase?",
      description: "Hanya produk hasil inject yang dihapus. Produk asli tetap aman.",
      confirmText: "Ya, hapus", danger: true,
    });
    if (!ok) return;
    await runAction("demo-clear", async () => {
      try {
        const p = await jsonRequest(DEMO_API, { method: "DELETE" });
        setDemoCount(0);
        loadListings();
        onNotice(`${p.deleted} produk etalase dihapus`);
      } catch (e) { setApiError(e.message); }
    });
  };


  /* ── Inject jumlah terjual per produk ── */
  const injectSold = async () => {
    await runAction("sold-inject", async () => {
      try {
        const p = await jsonRequest(REVIEWS_API, { method: "POST", body: JSON.stringify({ action: "sold", ...soldForm }) });
        applyReviewPayload(p);
        onNotice(`Jumlah terjual diperbarui di ${p.updated} produk`);
      } catch (e) { setApiError(e.message); }
    });
  };

  const soldOfListing = (id) => {
    const row = sales.find((s) => s.listingId === id);
    return row ? row.soldCount : 0;
  };


  const deleteReview = async (row) => {
    const ok = await confirm({
      title: "Hapus ulasan ini?",
      description: "Rating produk akan langsung dihitung ulang tanpa ulasan ini.",
      detail: `${row.author} · ${row.rating}★`,
      confirmText: "Ya, hapus", danger: true,
    });
    if (!ok) return;
    await runAction(`review-del-${row.id}`, async () => {
      try {
        const p = await jsonRequest(REVIEWS_API, { method: "DELETE", body: JSON.stringify({ id: row.id }) });
        applyReviewPayload(p);
        onNotice("Ulasan dihapus");
      } catch (e) { setApiError(e.message); }
    });
  };

  const clearInjectedReviews = async () => {
    const scopeLabel = reviewListing === "all" ? "semua produk" : "produk terpilih";
    const ok = await confirm({
      title: "Hapus semua ulasan hasil inject?",
      description: `Ulasan dari pembeli asli tetap aman. Hanya ulasan inject di ${scopeLabel} yang dihapus.`,
      confirmText: "Ya, hapus", danger: true,
    });
    if (!ok) return;
    await runAction("review-clear", async () => {
      try {
        const p = await jsonRequest(REVIEWS_API, { method: "DELETE", body: JSON.stringify({ scope: "injected", listingId: reviewListing }) });
        applyReviewPayload(p);
        onNotice(`${p.deleted} ulasan inject dihapus`);
      } catch (e) { setApiError(e.message); }
    });
  };

  const visibleReviews = reviews.filter((r) =>
    (reviewFilter === "all" || r.source === reviewFilter)
    && (reviewListing === "all" || r.listingId === reviewListing));

  const loadSettings = () =>
    jsonRequest("/api/admin/settings", { method: "GET" })
      .then((p) => {
        setAiCfg(p.assistant);
        setAiForm({
          enabled: p.assistant.enabled !== false,
          apiKey: "",
          baseUrl: p.assistant.baseUrl || "",
          modelAdmin: p.assistant.modelAdmin || "",
          modelUser: p.assistant.modelUser || "",
          maxSteps: String(p.assistant.maxSteps ?? 6),
          temperature: String(p.assistant.temperature ?? 0.3),
          extraPrompt: p.assistant.extraPrompt || "",
        });
        const aged = p.aged && Array.isArray(p.aged.tiers) && p.aged.tiers.length ? p.aged : AGED_DEFAULTS;
        setAgedCfg(aged);
        setAgedForm({
          enabled: aged.enabled !== false,
          tiers: aged.tiers.map((t) => ({ maxDays: String(t.maxDays), bonus: String(t.bonus), label: t.label || "" })),
          yearBonus: String(aged.yearBonus ?? 30000),
          extraPerYear: String(aged.extraPerYear ?? 10000),
        });
      })
      .catch((e) => setAiError(e.message));

  const updateAiForm = (key, val) => setAiForm((f) => ({ ...f, [key]: val }));

  const saveSettings = async () => {
    setSavingAi(true); setAiError(""); setAiNotice("");
    try {
      const payload = {
        enabled: aiForm.enabled,
        baseUrl: aiForm.baseUrl,
        modelAdmin: aiForm.modelAdmin,
        modelUser: aiForm.modelUser,
        maxSteps: Number(aiForm.maxSteps) || 6,
        temperature: Number(aiForm.temperature),
      };
      payload.extraPrompt = aiForm.extraPrompt;
      if (aiForm.apiKey.trim()) payload.apiKey = aiForm.apiKey.trim();
      const p = await jsonRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify(payload) });
      setAiCfg(p.assistant);
      setAiForm((f) => ({ ...f, apiKey: "" }));
      onNotice("Pengaturan Assisten disimpan");
    } catch (e) { setAiError(e.message); }
    finally { setSavingAi(false); }
  };

  const clearApiKey = async () => {
    const ok = await confirm({
      title: "Hapus API key Assisten?",
      description: "Assisten tidak bisa dipakai sampai kamu memasukkan API key baru.",
      confirmText: "Ya, hapus key", danger: true,
    });
    if (!ok) return;
    setSavingAi(true); setAiError(""); setAiNotice("");
    try {
      const p = await jsonRequest("/api/admin/settings", { method: "PATCH", body: JSON.stringify({ apiKey: "__CLEAR__" }) });
      setAiCfg(p.assistant); onNotice("API key dihapus");
    } catch (e) { setAiError(e.message); }
    finally { setSavingAi(false); }
  };

  const testAssistant = async () => {
    setTestingAi(true); setAiError(""); setAiNotice("");
    try {
      const p = await jsonRequest("/api/admin/settings", { method: "POST", body: JSON.stringify({}) });
      setAiNotice(`${p.message} (model ${p.model})`);
    } catch (e) { setAiError(e.message); }
    finally { setTestingAi(false); }
  };

  /* ── Pengaturan harga aged (bisa diubah admin, tanpa redeploy) ── */
  const updateAgedTier = (index, key, value) =>
    setAgedForm((f) => ({ ...f, tiers: f.tiers.map((t, i) => (i === index ? { ...t, [key]: value } : t)) }));
  const addAgedTier = () =>
    setAgedForm((f) => ({ ...f, tiers: [...f.tiers, { maxDays: "", bonus: "", label: "" }] }));
  const removeAgedTier = (index) =>
    setAgedForm((f) => ({ ...f, tiers: f.tiers.filter((_, i) => i !== index) }));
  const resetAgedForm = () =>
    setAgedForm({
      enabled: true,
      tiers: AGED_DEFAULTS.tiers.map((t) => ({ maxDays: String(t.maxDays), bonus: String(t.bonus), label: t.label })),
      yearBonus: String(AGED_DEFAULTS.yearBonus),
      extraPerYear: String(AGED_DEFAULTS.extraPerYear),
    });

  const saveAgedSettings = async () => {
    if (!agedForm) return;
    const tiers = agedForm.tiers
      .map((t) => ({ maxDays: Number(t.maxDays), bonus: Number(t.bonus) || 0, label: (t.label || "").trim() }))
      .filter((t) => Number.isFinite(t.maxDays) && t.maxDays > 0);
    if (!tiers.length) { setAgedError("Minimal satu tingkatan umur harus diisi"); return; }
    setSavingAged(true); setAgedError("");
    try {
      const p = await jsonRequest("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ aged: {
          enabled: agedForm.enabled,
          tiers,
          yearBonus: Number(agedForm.yearBonus) || 0,
          extraPerYear: Number(agedForm.extraPerYear) || 0,
        } }),
      });
      const aged = p.aged || AGED_DEFAULTS;
      setAgedCfg(aged);
      setAgedForm({
        enabled: aged.enabled !== false,
        tiers: aged.tiers.map((t) => ({ maxDays: String(t.maxDays), bonus: String(t.bonus), label: t.label || "" })),
        yearBonus: String(aged.yearBonus),
        extraPerYear: String(aged.extraPerYear),
      });
      loadListings();
      onNotice("Pengaturan harga aged disimpan");
    } catch (e) { setAgedError(e.message); }
    finally { setSavingAged(false); }
  };

  const setUserRole = async (id, role) => {
    try {
      await jsonRequest("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ id, action: role === "admin" ? "promote" : "demote" }),
      });
      loadUsersData();
      onNotice(role === "admin" ? "User dijadikan admin" : "Akses admin dicabut");
    } catch (e) { setApiError(e.message); }
  };

  // Kedua request jalan bersamaan supaya sinkronisasi selesai secepat
  // request paling lambat, bukan jumlah keduanya.
  const loadUsersData = () =>
    Promise.all([
      jsonRequest("/api/admin/topups", { method: "GET" })
        .then((p) => setTopups(p.topups || []))
        .catch(() => {}),
      jsonRequest("/api/admin/users", { method: "GET" })
        .then((p) => setUsers(p.users || []))
        .catch(() => {}),
    ]);

  const openUserForm = (u) => {
    setApiError("");
    setUserForm({
      id: u.id, name: u.name || "", email: u.email || "", phone: u.phone || "",
      balance: String(u.balance ?? 0), status: u.status || "active", role: u.role === "admin" ? "admin" : "user",
      note: u.note || "", password: "",
      createdAt: u.createdAt, topupTotal: u.topupTotal || 0,
    });
    // Detail memakai data asli dari database; tidak ada nilai karangan di UI.
    setUserDetail({ ...u });
    setUserActivity(null);
    setLoadingDetail(true);
    jsonRequest(`/api/admin/users?id=${encodeURIComponent(u.id)}`, { method: "GET" })
      .then((p) => { setUserDetail(p.user || u); setUserActivity(p.activity || []); })
      .catch(() => { setUserActivity([]); })
      .finally(() => setLoadingDetail(false));
  };
  const closeUserForm = () => { setUserForm(null); setUserDetail(null); setUserActivity(null); };

  const updateUserForm = (key, val) => setUserForm((f) => ({ ...f, [key]: val }));

  const saveUser = async () => {
    setSavingUser(true); setApiError("");
    try {
      await jsonRequest("/api/admin/users", { method: "PATCH", body: JSON.stringify(userForm) });
      closeUserForm(); loadUsersData(); onNotice("Data user diperbarui");
    } catch (e) { setApiError(e.message); }
    finally { setSavingUser(false); }
  };

  const setUserStatus = async (id, action) => {
    try {
      await jsonRequest("/api/admin/users", { method: "PATCH", body: JSON.stringify({ id, action }) });
      loadUsersData();
      onNotice(action === "activate" ? "Akun diaktifkan" : action === "suspend" ? "Akun ditangguhkan" : "Akun diblokir");
    } catch (e) { setApiError(e.message); }
  };

  const deleteUser = async (u) => {
    const ok = await confirm({
      title: "Hapus akun pengguna ini?",
      description: "Semua riwayat top up dan pesanan milik akun ini ikut terhapus permanen.",
      detail: `${u.name || "Tanpa nama"} · ${u.email}`,
      confirmText: "Ya, hapus akun", danger: true,
    });
    if (!ok) return;
    await runAction(`user-del-${u.id}`, async () => {
      try {
        await jsonRequest("/api/admin/users", { method: "DELETE", body: JSON.stringify({ id: u.id }) });
        await loadUsersData(); onNotice("User dihapus");
      } catch (e) { setApiError(e.message); }
    });
  };

  const reviewTopup = async (id, action, info) => {
    const approve = action === "approve";
    const ok = await confirm({
      title: approve ? "Setujui permintaan top up?" : "Tolak permintaan top up?",
      description: approve
        ? "Saldo pengguna langsung bertambah dan notifikasi terkirim ke akunnya."
        : "Pengguna akan menerima notifikasi bahwa permintaannya ditolak.",
      detail: info,
      confirmText: approve ? "Ya, setujui" : "Ya, tolak",
      danger: !approve,
    });
    if (!ok) return;
    await runAction(`topup-${id}`, async () => {
      try {
        await jsonRequest("/api/admin/topups", { method: "PATCH", body: JSON.stringify({ id, action }) });
        onNotice(approve ? "Top up disetujui, saldo user bertambah" : "Top up ditolak");
        await loadUsersData();
      } catch (e) { setApiError(e.message); }
    });
  };

  const checkAuth = () =>
    jsonRequest("/api/admin/login", { method: "GET" })
      .then((p) => { setAuthenticated(p.authenticated); if (p.authenticated) { loadListings(); loadUsersData(); loadSettings(); loadOrders(); } })
      .catch(() => setAuthenticated(false));

  useEffect(() => { checkAuth(); }, []);

  const loadListings = () => {
    setLoading(true); setApiError("");
    return jsonRequest("/api/admin/products", { method: "GET" })
      .then((p) => setListings(p.products || []))
      .catch((e) => setApiError(e.message))
      .finally(() => setLoading(false));
  };

  const loadOrders = () => {
    setOrdersLoading(true);
    return jsonRequest("/api/orders?scope=admin", { method: "GET" })
      .then((p) => setOrders(p.orders || []))
      .catch((e) => setApiError(e.message))
      .finally(() => setOrdersLoading(false));
  };

  // Satu tombol refresh untuk semua data panel supaya indikator putar akurat.
  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await Promise.all([loadListings(), loadUsersData(), loadOrders(), loadSettings()]); }
    finally { setRefreshing(false); }
  };

  const deleteAdminOrder = async (id) => {
    const ok = await confirm({
      title: "Hapus pesanan ini?",
      description: "Pesanan dihapus dari riwayat admin dan pembeli. Tindakan ini tidak bisa dibatalkan.",
      detail: `#${String(id).slice(0, 8)}`,
      confirmText: "Ya, hapus", danger: true,
    });
    if (!ok) return;
    await runAction(`aorder-${id}`, async () => {
      try {
        await jsonRequest("/api/orders?scope=admin", { method: "DELETE", body: JSON.stringify({ id }) });
        setOrders((list) => list.filter((o) => o.id !== id));
        onNotice("Pesanan dihapus");
      } catch (e) { setApiError(e.message); }
    });
  };

  /* Satu pintu untuk update permintaan custom email: status, password akun
     Google hasil pembuatan, dan catatan untuk pembeli. */
  const patchCustomEmail = async (requestId, patch, message) => {
    await runAction(`cemail-${requestId}`, async () => {
      try {
        const res = await jsonRequest("/api/orders?scope=admin&resource=custom-email", {
          method: "PATCH",
          body: JSON.stringify({ id: requestId, ...patch }),
        });
        const saved = (res && res.custom) || {};
        setOrders((list) => list.map((o) => {
          const reqs = customEmailsOf(o);
          if (!reqs.some((r) => r.id === requestId)) return o;
          const next = reqs.map((r) => (r.id === requestId
            ? { ...r, status: saved.status || r.status, password: saved.password || "", note: saved.note || "" }
            : r));
          return { ...o, customEmails: next, customEmailStatus: next[0].status };
        }));
        setCeDraft((m) => { const copy = { ...m }; delete copy[requestId]; return copy; });
        onNotice(message || "Custom email diperbarui");
      } catch (e) { setApiError(e.message); }
    });
  };

  const setCustomEmailStatus = (requestId, status) =>
    patchCustomEmail(requestId, { status }, "Status custom email diperbarui");

  const ceField = (r, field) => {
    const draft = ceDraft[r.id];
    return draft && draft[field] !== undefined ? draft[field] : (r[field] || "");
  };
  const setCeField = (id, field, value) =>
    setCeDraft((m) => ({ ...m, [id]: { ...(m[id] || {}), [field]: value } }));
  const ceDirty = (r) => {
    const draft = ceDraft[r.id];
    if (!draft) return false;
    return (draft.password !== undefined && draft.password !== (r.password || ""))
      || (draft.note !== undefined && draft.note !== (r.note || ""));
  };


  const deleteTopup = async (id) => {
    const ok = await confirm({
      title: "Hapus permintaan top up ini?",
      description: "Catatan permintaan ini hilang dari riwayat admin.",
      confirmText: "Ya, hapus", danger: true,
    });
    if (!ok) return;
    await runAction(`topup-del-${id}`, async () => {
      try {
        await jsonRequest("/api/admin/topups", { method: "DELETE", body: JSON.stringify({ id }) });
        setTopups((list) => list.filter((t) => t.id !== id));
        onNotice("Permintaan top up dihapus");
      } catch (e) { setApiError(e.message); }
    });
  };

  const clearTopupHistory = async () => {
    const done = topups.filter((t) => t.status !== "pending").length;
    const ok = await confirm({
      title: "Bersihkan riwayat top up?",
      description: "Semua permintaan yang sudah disetujui atau ditolak akan dihapus. Permintaan yang masih menunggu tetap aman.",
      detail: `${done} riwayat akan dihapus`,
      confirmText: "Ya, bersihkan", danger: true,
    });
    if (!ok) return;
    await runAction("topup-clear", async () => {
      try {
        await jsonRequest("/api/admin/topups", { method: "DELETE", body: JSON.stringify({ scope: "resolved" }) });
        setTopups((list) => list.filter((t) => t.status === "pending"));
        onNotice("Riwayat top up dibersihkan");
      } catch (e) { setApiError(e.message); }
    });
  };

  const login = async (e) => {
    e.preventDefault(); setLoginError("");
    try { await jsonRequest("/api/admin/login", { method: "POST", body: JSON.stringify({ password }) }); setAuthenticated(true); setPassword(""); loadListings(); loadUsersData(); loadSettings(); loadOrders(); }
    catch (e) { setLoginError(e.message); }
  };

  const logout = async () => { await jsonRequest("/api/admin/login", { method: "DELETE" }); setAuthenticated(false); setListings([]); };

  const openForm = (listing = null) => {
    setApiError(""); setRevealed(false);
    setForm(listing
      ? {
          ...emptyListing,
          ...listing,
          price: String(listing.price ?? ""),
          accounts: Array.isArray(listing.accounts) && listing.accounts.length
            ? listing.accounts.map((a) => ({ email: a.email || a.username || "", password: a.password || "", price: String(a.price ?? listing.price ?? ""), createdAt: (a.createdAt || "").slice(0, 10) }))
            : [{ email: "", password: "", price: String(listing.price ?? ""), createdAt: "" }],
          agedPricing: listing.agedPricing !== false,
        }
      : { ...emptyListing, accounts: [{ email: "", password: "", price: "", createdAt: "" }] });
  };

  const updateForm = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  /* Template hanya mengisi teks & tipe login; harga dan data akun tetap milik admin. */
  const applyTemplate = (tpl) => {
    setForm((f) => ({ ...f, ...tpl.data }));
    onNotice(`Template ${tpl.label} diterapkan`);
  };

  const updateAccount = (index, key, val) =>
    setForm((f) => ({ ...f, accounts: (f.accounts || []).map((a, i) => (i === index ? { ...a, [key]: val } : a)) }));
  const addAccount = () => setForm((f) => ({ ...f, accounts: [...(f.accounts || []), { email: "", password: "", price: String(f.price || ""), createdAt: "" }] }));
  const removeAccount = (index) =>
    setForm((f) => {
      const next = (f.accounts || []).filter((_, i) => i !== index);
      return { ...f, accounts: next.length ? next : [{ email: "", password: "", price: String(f.price || ""), createdAt: "" }] };
    });

  const save = async () => {
    setSaving(true); setApiError("");
    try {
      const basePrice = Number(form.price) || 0;
      const accounts = (form.accounts || [])
        .map((a) => ({ email: (a.email || "").trim(), password: (a.password || "").trim(), price: Number(a.price) > 0 ? Number(a.price) : basePrice, createdAt: (a.createdAt || "").slice(0, 10) }))
        .filter((a) => a.email || a.password);
      const price = accounts.length ? Math.min(...accounts.map((a) => a.price)) : basePrice;
      const body = { ...form, accounts, price, stock: accounts.length, agedPricing: form.agedPricing !== false };
      if (form.id) await jsonRequest("/api/admin/products", { method: "PATCH", body: JSON.stringify(body) });
      else await jsonRequest("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
      setForm(null); loadListings(); onNotice(form.id ? "Produk diperbarui" : "Produk ditambahkan");
    } catch (e) { setApiError(e.message); }
    finally { setSaving(false); }
  };

  const deleteListing = async (listing) => {
    const id = typeof listing === "string" ? listing : listing.id;
    const ok = await confirm({
      title: "Hapus produk ini?",
      description: "Listing beserta seluruh akun yang belum terjual di dalamnya akan dihapus permanen.",
      detail: typeof listing === "string" ? `#${String(id).slice(0, 8)}` : `${listing.title} · stok ${listing.stock} akun`,
      confirmText: "Ya, hapus produk", danger: true,
    });
    if (!ok) return;
    await runAction(`prod-${id}`, async () => {
      try {
        await jsonRequest("/api/admin/products", { method: "DELETE", body: JSON.stringify({ id }) });
        await loadListings(); onNotice("Produk dihapus");
      } catch (e) { setApiError(e.message); }
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? listings.filter((l) => `${l.title} ${l.loginType}`.toLowerCase().includes(q)) : listings;
  }, [listings, search]);

  const copyUserId = (id) => {
    const value = String(id || "");
    if (!value) return;
    const done = () => { setCopiedId(value); setTimeout(() => setCopiedId((c) => (c === value ? "" : c)), 1600); };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(done).catch(() => {});
      else done();
    } catch { /* ignore */ }
  };

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    let list = users;
    if (userFilter === "active") list = list.filter((u) => u.status === "active");
    else if (userFilter === "inactive") list = list.filter((u) => u.status !== "active");
    else if (userFilter === "admin") list = list.filter((u) => u.role === "admin");
    else if (userFilter === "verified") list = list.filter((u) => u.provider === "google" || u.emailVerified);
    if (!q) return list;
    return list.filter((u) => `${u.name || ""} ${u.email || ""} ${u.phone || ""} ${u.id || ""}`.toLowerCase().includes(q));
  }, [users, userQuery, userFilter]);


  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => `${o.buyer.name} ${o.buyer.email} ${o.id} ${(o.items || []).map((i) => i.title).join(" ")}`.toLowerCase().includes(q));
  }, [orders, search]);

  const pendingTopups = topups.filter((t) => t.status === "pending").length;

  /* Notifikasi admin. Kunci dibuat ikut jumlah kejadian ("topup:2"), supaya
     setelah dihapus notifikasi tetap muncul lagi begitu ada kejadian baru —
     sebelumnya kunci tetap ("topup") membuat panel selamanya kosong. */
  const adminAlerts = useMemo(() => {
    const list = [];
    if (pendingTopups) list.push({ key: `topup:${pendingTopups}`, nav: "Top Up", title: `${pendingTopups} permintaan top up menunggu`, desc: "Butuh persetujuan admin" });
    const low = listings.filter((l) => Number(l.stock) <= 3 && l.status !== "sold");
    if (low.length) list.push({ key: `stock:${low.length}`, nav: "Produk", title: `${low.length} produk stok menipis`, desc: low.slice(0, 3).map((l) => l.title).join(", ") });
    const openCustom = orders.flatMap((o) => customEmailsOf(o)).filter((r) => (r.status || "pending") === "pending" || r.status === "processing");
    if (openCustom.length) list.push({ key: `cemail:${openCustom.length}`, nav: "Custom Email", title: `${openCustom.length} custom email belum selesai`, desc: openCustom.slice(0, 3).map((r) => r.requested).join(", ") });
    const blocked = users.filter((u) => u.status !== "active");
    if (blocked.length) list.push({ key: `user:${blocked.length}`, nav: "Pengguna", title: `${blocked.length} akun tidak aktif`, desc: "Tinjau status pengguna" });
    if (orders.length) list.push({ key: `order:${orders.length}`, nav: "Pesanan", title: `${orders.length} pesanan tercatat`, desc: "Lihat detail pembeli" });
    return list.filter((a) => !dismissedAlerts.includes(a.key));
  }, [pendingTopups, listings, users, orders, dismissedAlerts]);

  /* Pesanan dikelompokkan per akun pembeli: satu kartu = satu akun,
     transaksinya ditumpuk di dalam kartu itu. */
  const groupedOrders = useMemo(() => {
    const map = new Map();
    filteredOrders.forEach((o) => {
      const key = o.buyer.id || o.buyer.email;
      const group = map.get(key) || { buyer: o.buyer, orders: [], total: 0, accounts: 0 };
      group.orders.push(o);
      group.total += Number(o.total) || 0;
      group.accounts += Number(o.itemCount) || 0;
      map.set(key, group);
    });
    return [...map.values()].sort((a, b) => new Date(b.orders[0].createdAt || 0) - new Date(a.orders[0].createdAt || 0));
  }, [filteredOrders]);

  const recentActivity = useMemo(() => {
    const feed = [
      ...orders.slice(0, 5).map((o) => ({
        key: `o-${o.id}`, Icon: ShoppingBag, at: o.createdAt,
        title: `${o.buyer.name} membeli ${o.itemCount} akun`,
        desc: `${formatPrice(o.total)} · ${(o.items || []).map((i) => i.title).join(", ") || "-"}`,
      })),
      ...topups.slice(0, 5).map((t) => ({
        key: `t-${t.id}`, Icon: Wallet, at: t.createdAt,
        title: `Top up ${formatPrice(t.amount)} · ${t.userName}`,
        desc: t.status === "pending" ? "Menunggu review" : t.status === "approved" ? "Disetujui" : "Ditolak",
      })),
      ...listings.slice(0, 5).map((l) => ({
        key: `l-${l.id}`, Icon: Package, at: l.createdAt,
        title: l.title, desc: `${l.loginType} · stok ${l.stock}`,
      })),
    ];
    return feed
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 8)
      .map((a) => ({ ...a, time: formatDate(a.at) }));
  }, [orders, topups, listings]);

  const USERS_PER_PAGE = 8;
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / USERS_PER_PAGE));
  const safeUserPage = Math.min(userPage, userPageCount);
  const pagedUsers = filteredUsers.slice((safeUserPage - 1) * USERS_PER_PAGE, safeUserPage * USERS_PER_PAGE);
  // Reset halaman hanya saat pencarian berubah; refresh data setelah aksi admin
  // tidak boleh menendang admin kembali ke halaman 1.
  useEffect(() => { setUserPage(1); }, [userQuery, userFilter]);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTo({ top: 0, behavior: "smooth" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeNav]);

  /* stats */
  const totalProducts = listings.length;
  const totalSold     = listings.filter((l) => l.status === "sold").length;
  const revenue       = listings.filter((l) => l.status === "sold").reduce((a, l) => a + (Number(l.price) || 0), 0);
  const lowStock      = listings.filter((l) => Number(l.stock) <= 3 && l.status !== "sold").length;

  /* login screen */
  if (authenticated === null) return (
    <SessionSplash title="Menyiapkan Admin Panel" subtitle="Memeriksa sesi admin, sebentar ya..." />
  );

  if (!authenticated) return (
    <div className="cx-login-wrap">
      <div className="cx-login-box">
        <div className="cx-login-mark"><img src="/brand-logo.webp" alt="Akun Instan" loading="eager" decoding="async" /></div>
        <h1>Akun Instan Admin</h1>
        <p>Masuk untuk mengelola produk dan pesanan.</p>
        <form onSubmit={login}>
          <Field label="Password Admin">
            <InputWrap icon={LockKeyhole}>
              <input type={revealed ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan password..." autoFocus />
              <button type="button" onClick={() => setRevealed((v) => !v)} style={{ color: "var(--muted)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </InputWrap>
          </Field>
          {loginError && <p className="cx-form-error">{loginError}</p>}
          <button type="submit" className="cx-btn cx-btn-primary cx-btn-full" style={{ marginTop: 6 }}>
            <LogIn size={13} /> Masuk
          </button>
        </form>
      </div>
    </div>
  );

  const NAV_ITEMS = [
    { label: "Dashboard",   shortcut: "⌘D", icon: LayoutDashboard },
    { label: "Produk",      shortcut: "⌘P", icon: Package,        dot: true },
    { label: "Pesanan",     shortcut: "⌘O", icon: ShoppingBag,    dot: orders.length > 0 },
    { label: "Pengguna",    shortcut: "⌘U", icon: User,           dot: users.some((u) => u.status !== "active") },
    { label: "Top Up",      shortcut: "⌘T", icon: Wallet,         dot: topups.some((t) => t.status === "pending") },
    { label: "Custom Email",shortcut: "⌘E", icon: Mail,           dot: orders.some((o) => customEmailsOf(o).length) },
    { label: "Harga Aged",  shortcut: "⌘G", icon: TrendingUp,     dot: agedCfg && agedCfg.enabled === false },
    { label: "Assisten",    shortcut: "⌘I", icon: Sparkles,       dot: !(aiCfg && aiCfg.enabled && aiCfg.hasKey) },
    { label: "Ulasan & Rating", shortcut: "⌘R", icon: Star },
    { label: "Inject Data",  shortcut: "⌘J", icon: Plus },
    { label: "Pengaturan",  shortcut: "⌘,", icon: Settings },
  ];

  return (
    <div className={`cx-admin-shell${navOpen ? " nav-open" : ""}`}>
      {navOpen && <div className="cx-sidebar-backdrop" onClick={() => setNavOpen(false)} />}
      {/* ── Sidebar ── */}
      <aside className={`cx-sidebar${navOpen ? " open" : ""}`}>
        <div className="cx-sidebar-brand">
          <img className="cx-brand-wordmark cx-brand-wordmark-sidebar" src="/akun-instan-wordmark.webp" alt="Akun Instan" width="125" height="19" decoding="async" />
          <ChevronDown size={12} color="var(--faint)" />
          <button className="cx-sidebar-close" onClick={() => setNavOpen(false)} aria-label="Tutup menu"><X size={14} /></button>
        </div>
        <div className="cx-sidebar-section">Workspace</div>
        <nav>
          {NAV_ITEMS.map(({ label, shortcut, icon: NavIcon, dot }) => (
            <button key={label} className={`cx-sidebar-item ${activeNav === label ? "active" : ""}`} onClick={() => goNav(label)}>
              <NavIcon size={14} strokeWidth={1.7} />
              <span>{label}</span>
              {dot && <span className="cx-sidebar-dot" />}
              <span className="cx-sidebar-shortcut">{shortcut}</span>
            </button>
          ))}
        </nav>
        <div className="cx-sidebar-footer">
          <div className="cx-sidebar-user">
            <div className="cx-avatar">AR</div>
            <div className="cx-sidebar-user-info">
              <strong>Admin</strong>
              <small>Owner</small>
            </div>
            <MoreHorizontal size={13} color="var(--faint)" style={{ marginLeft: "auto" }} />
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="cx-admin-main">
        {headerMenu && <div className="cx-menu-backdrop" onClick={() => setHeaderMenu("")} />}
        {/* Header */}
        <header className="cx-admin-header">
          <button className="cx-mobile-menu-btn" onClick={() => setNavOpen(true)} aria-label="Buka menu">
            <Menu size={15} />
          </button>
          <div className="cx-breadcrumb">
            <PanelLeft size={13} color="var(--faint)" />
            <span>Workspace</span>
            <span style={{ color: "var(--b3)" }}>/</span>
            <span className="active">{activeNav}</span>
          </div>
          <div className="cx-search" style={{ maxWidth: 420, flex: 1 }}>
            <Search size={12} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari produk, pesanan..." />
            <span style={{ marginLeft: "auto", fontFamily: "ui-monospace,monospace", fontSize: 10, color: "var(--faint)", border: "1px solid var(--b3)", borderRadius: 3, padding: "1px 5px" }}>⌘K</span>
          </div>
          <div className="cx-admin-header-actions" style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className={`cx-admin-asst-btn${asstOpen ? " active" : ""}`}
              onClick={() => setAsstOpen((v) => !v)}
              aria-label="Buka Assisten"
              title="Assisten Akun Instan"
            >
              <Sparkles size={13} />
              <span>Assisten</span>
            </button>
            <div className="cx-admin-menu-wrap">
              <button className="cx-icon-btn" aria-label="Bantuan" onClick={() => setHeaderMenu((m) => (m === "help" ? "" : "help"))}><CircleHelp size={13} /></button>
              {headerMenu === "help" && (
                <div className="cx-admin-menu">
                  <div className="cx-admin-menu-title">Bantuan cepat</div>
                  <p>Kelola listing di menu <strong>Produk</strong>, cek transaksi pembeli di <strong>Pesanan</strong>.</p>
                  <p>Setujui saldo pembeli di menu <strong>Top Up</strong>.</p>
                  <p>Butuh bantuan lanjut? Buka <strong>Assisten</strong> di kanan atas.</p>
                </div>
              )}
            </div>
            <div className="cx-admin-menu-wrap">
              <button className="cx-icon-btn" aria-label="Notifikasi" onClick={() => setHeaderMenu((m) => (m === "notif" ? "" : "notif"))} style={{ position: "relative" }}>
                <Bell size={13} />
                {adminAlerts.length > 0 && <span className="cx-admin-badge">{adminAlerts.length}</span>}
              </button>
              {headerMenu === "notif" && (
                <div className="cx-admin-menu">
                  <div className="cx-admin-menu-title">
                    Notifikasi
                    {adminAlerts.length > 0 && (
                      <button
                        type="button"
                        className="cx-menu-clear"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Hapus semua notifikasi?",
                            description: "Daftar notifikasi admin dikosongkan. Notifikasi baru tetap akan muncul lagi kalau ada kejadian baru.",
                            confirmText: "Ya, hapus semua", danger: true,
                          });
                          if (!ok) return;
                          persistDismissed([...new Set([...dismissedAlerts, ...adminAlerts.map((a) => a.key)])]);
                          setHeaderMenu("");
                          onNotice("Semua notifikasi dihapus");
                        }}
                      >
                        <Trash2 size={10} /> Hapus semua
                      </button>
                    )}
                  </div>
                  {adminAlerts.length === 0
                    ? <p>Tidak ada notifikasi baru.</p>
                    : adminAlerts.map((a) => (
                      <div key={a.key} className="cx-admin-menu-row">
                        <button className="cx-admin-menu-item" onClick={() => { goNav(a.nav); setHeaderMenu(""); }}>
                          <strong>{a.title}</strong>
                          <small>{a.desc}</small>
                        </button>
                        <button className="cx-row-btn danger" aria-label="Hapus notifikasi" onClick={() => dismissAlert(a.key)}><Trash2 size={11} /></button>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="cx-admin-menu-wrap">
              <button className="cx-avatar cx-admin-avatar-btn" aria-label="Profil admin" onClick={() => setHeaderMenu((m) => (m === "profile" ? "" : "profile"))}>AR</button>
              {headerMenu === "profile" && (
                <div className="cx-admin-menu">
                  <div className="cx-admin-menu-head">
                    <div className="cx-avatar">AR</div>
                    <div><strong>Admin</strong><small>Owner · Akun Instan</small></div>
                  </div>
                  <button className="cx-admin-menu-item" onClick={() => { goNav("Pengaturan"); setHeaderMenu(""); }}><Settings size={12} /> Pengaturan</button>
                  <button className="cx-admin-menu-item" onClick={() => { onBack(); setHeaderMenu(""); }}><ShoppingBag size={12} /> Lihat store</button>
                  <button className="cx-admin-menu-item danger" onClick={() => { setHeaderMenu(""); logout(); }}><LogOut size={12} /> Keluar</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Command bar */}
        <div className="cx-cmd-bar">
          <Command size={11} />
          <span>Press <kbd>⌘K</kbd> for commands</span>
          <span style={{ marginLeft: "auto", fontFamily: "ui-monospace,monospace", color: "var(--faint)", fontSize: 10 }}>v2.4.1</span>
        </div>

        {/* Content */}
        <div className="cx-admin-content" ref={contentRef}>
          {activeNav === "Harga Aged" ? (
            <>
              <div className="cx-admin-top">
                <div>
                  <div className="cx-admin-date">Harga otomatis sesuai umur akun</div>
                  <h1>Harga Aged</h1>
                </div>
                <div className="cx-admin-actions">
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={loadSettings}><RefreshCw size={11} /> Refresh</button>
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={resetAgedForm} disabled={!agedForm}>Pakai Rekomendasi</button>
                </div>
              </div>

              <div className="cx-agedx">
                <div className="cx-agedx-stats">
                  {[
                    { label: "Status", value: agedCfg?.enabled === false ? "Nonaktif" : "Aktif", delta: agedCfg?.enabled === false ? "semua akun harga tetap" : "harga naik sesuai umur", up: agedCfg?.enabled !== false },
                    { label: "Tingkatan", value: `${(agedCfg?.tiers || []).length} tier`, delta: "dari fresh sampai aged", up: true },
                    { label: "Bonus 1 tahun+", value: formatPrice(agedCfg?.yearBonus || 0), delta: "akun umur 1 tahun ke atas", up: true },
                    { label: "Tiap tahun ekstra", value: formatPrice(agedCfg?.extraPerYear || 0), delta: "ditambah per tahun berikutnya", up: true },
                  ].map(({ label, value, delta, up }) => (
                    <div key={label} className={`cx-agedx-stat${up ? "" : " is-off"}`}>
                      <span className="cx-agedx-stat-label">{label}</span>
                      <strong className="cx-agedx-stat-value">{value}</strong>
                      <span className="cx-agedx-stat-delta">{delta}</span>
                    </div>
                  ))}
                </div>

                <section className="cx-agedx-card">
                  <header className="cx-agedx-card-head">
                    <div>
                      <h3>Tingkatan Bonus Umur</h3>
                      <span>tersimpan di database, langsung dipakai tanpa redeploy</span>
                    </div>
                  </header>
                  <div className="cx-agedx-card-body">
                    {!agedForm ? (
                      <p className="cx-agedx-muted">Memuat pengaturan...</p>
                    ) : (
                      <>
                        <p className="cx-agedx-help">
                          Isi <b>umur maksimal (hari)</b> dan <b>bonus harga</b> tiap tingkatan.
                          Harga jual satu akun = harga dasar akun + bonus tingkatan yang cocok dengan tanggal buat akun.
                        </p>

                        <div className="cx-agedx-tiers">
                          {agedForm.tiers.map((tier, index) => {
                            const prev = index > 0 ? Number(agedForm.tiers[index - 1].maxDays) || 0 : -1;
                            const from = prev + 1;
                            const to = Number(tier.maxDays) || 0;
                            const range = `${from}–${to} hari`;
                            return (
                              <div className="cx-agedx-tier" key={index}>
                                <div className="cx-agedx-tier-top">
                                  <span className="cx-agedx-badge">#{index + 1}</span>
                                  <div className="cx-agedx-tier-title">
                                    <strong>{tier.label || "Tanpa nama"}</strong>
                                    <span>{range}</span>
                                  </div>
                                  <button type="button" className="cx-agedx-del" onClick={() => removeAgedTier(index)} disabled={agedForm.tiers.length <= 1} aria-label={`Hapus tingkatan #${index + 1}`}>
                                    <X size={13} />
                                  </button>
                                </div>
                                <div className="cx-agedx-tier-grid">
                                  <label className="cx-agedx-field">
                                    <span>Umur maksimal (hari)</span>
                                    <InputWrap>
                                      <input type="number" min="1" value={tier.maxDays} onChange={(e) => updateAgedTier(index, "maxDays", e.target.value)} placeholder="hari maks." />
                                    </InputWrap>
                                  </label>
                                  <label className="cx-agedx-field">
                                    <span>Bonus harga (Rp)</span>
                                    <InputWrap>
                                      <input type="number" min="0" value={tier.bonus} onChange={(e) => updateAgedTier(index, "bonus", e.target.value)} placeholder="bonus (Rp)" />
                                    </InputWrap>
                                  </label>
                                  <label className="cx-agedx-field cx-agedx-field-full">
                                    <span>Nama tingkatan</span>
                                    <InputWrap>
                                      <input value={tier.label} onChange={(e) => updateAgedTier(index, "label", e.target.value)} placeholder="cth. Aged 1-3 bulan" />
                                    </InputWrap>
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                          <button type="button" className="cx-agedx-add" onClick={addAgedTier}>
                            <Plus size={13} /> Tambah Tingkatan
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {agedForm && (
                  <section className="cx-agedx-card">
                    <header className="cx-agedx-card-head">
                      <div>
                        <h3>Bonus Akun Tua</h3>
                        <span>berlaku setelah tingkatan terakhir terlewati</span>
                      </div>
                    </header>
                    <div className="cx-agedx-card-body">
                      <div className="cx-agedx-tier-grid">
                        <label className="cx-agedx-field">
                          <span>Bonus akun 1 tahun+</span>
                          <InputWrap><input type="number" min="0" value={agedForm.yearBonus} onChange={(e) => setAgedForm((f) => ({ ...f, yearBonus: e.target.value }))} /></InputWrap>
                          <small>Dipakai kalau umur akun melewati tingkatan terakhir</small>
                        </label>
                        <label className="cx-agedx-field">
                          <span>Tambahan tiap tahun berikutnya</span>
                          <InputWrap><input type="number" min="0" value={agedForm.extraPerYear} onChange={(e) => setAgedForm((f) => ({ ...f, extraPerYear: e.target.value }))} /></InputWrap>
                          <small>Contoh: umur 2 tahun = bonus 1 tahun + nilai ini</small>
                        </label>
                      </div>

                      <label className="cx-agedx-toggle">
                        <input type="checkbox" checked={agedForm.enabled} onChange={(e) => setAgedForm((f) => ({ ...f, enabled: e.target.checked }))} />
                        <span>
                          <b>Harga aged aktif untuk semua produk</b>
                          <small>Kalau dimatikan, semua akun pakai harga dasar</small>
                        </span>
                      </label>

                      {agedError && <p className="cx-form-error">{agedError}</p>}

                      <div className="cx-agedx-actions">
                        <button className="cx-btn cx-btn-primary cx-agedx-save" onClick={saveAgedSettings} disabled={savingAged}>
                          {savingAged ? <><RefreshCw size={13} /> Menyimpan...</> : <><Check size={13} /> Simpan Pengaturan Aged</>}
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                <section className="cx-agedx-card">
                  <header className="cx-agedx-card-head">
                    <div>
                      <h3>Contoh Hitungan</h3>
                      <span>simulasi harga dasar Rp5.000</span>
                    </div>
                  </header>
                  <div className="cx-agedx-calc">
                    {[3, 20, 60, 150, 300, 400, 800].map((days) => {
                      const date = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
                      const info = agedInfoOf(date, agedCfg);
                      return (
                        <div key={days} className="cx-agedx-calc-row">
                          <div className="cx-agedx-calc-info">
                            <strong>Umur {days} hari</strong>
                            <span>{info.label || "—"}</span>
                          </div>
                          <div className="cx-agedx-calc-price">
                            <strong>{formatPrice(5000 + info.bonus)}</strong>
                            <span>{info.bonus ? `+${formatPrice(info.bonus)}` : "tanpa bonus"}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </>
          ) : activeNav === "Assisten" ? (
            <>
              <div className="cx-admin-top">
                <div>
                  <div className="cx-admin-date">Konfigurasi AI</div>
                  <h1>Assisten</h1>
                </div>
                <div className="cx-admin-actions">
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={loadSettings}><RefreshCw size={11} /> Refresh</button>
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={testAssistant} disabled={testingAi || !aiCfg?.hasKey}>
                    <Sparkles size={11} /> {testingAi ? "Menguji..." : "Tes Koneksi"}
                  </button>
                </div>
              </div>

              <div className="cx-stat-grid">
                {[
                  { label: "Status", value: aiCfg ? (aiCfg.enabled ? (aiCfg.hasKey ? "Aktif" : "Belum ada key") : "Dimatikan") : "—", delta: aiCfg?.hasKey ? "siap dipakai" : "isi API key dulu", up: Boolean(aiCfg?.enabled && aiCfg?.hasKey) },
                  { label: "API Key", value: aiCfg?.keyPreview || "kosong", delta: aiCfg?.keySource === "panel" ? "dari admin panel" : aiCfg?.keySource === "env" ? "dari env Vercel" : "belum diatur", up: Boolean(aiCfg?.hasKey) },
                  { label: "Model Admin", value: aiCfg?.modelAdmin || "—", delta: "akses penuh", up: true },
                  { label: "Model User", value: aiCfg?.modelUser || "—", delta: "data sendiri saja", up: true },
                ].map(({ label, value, delta, up }) => (
                  <div key={label} className="cx-stat-card">
                    <span className="cx-stat-label">{label}</span>
                    <strong className="cx-stat-value" style={{ fontSize: 15, wordBreak: "break-all" }}>{value}</strong>
                    <span className="cx-stat-delta" style={{ color: up ? "var(--green)" : "var(--amber)" }}>{delta}</span>
                  </div>
                ))}
              </div>

              <div className="cx-panel">
                <div className="cx-panel-header">
                  <h3>Token API & Model</h3>
                  <span className="cx-panel-sub">
                    {aiCfg?.updatedAt ? `terakhir diubah ${formatDate(aiCfg.updatedAt)}` : "tersimpan di database, tanpa redeploy"}
                  </span>
                </div>
                <div style={{ padding: 14 }}>
                  {!aiForm ? (
                    <p style={{ color: "var(--faint)", fontSize: 11 }}>Memuat pengaturan...</p>
                  ) : (
                    <>
                      <div className="cx-form-grid">
                        <div className="cx-full-span">
                          <Field label="QWEN_API_KEY" hint={aiCfg?.hasKey ? `Tersimpan: ${aiCfg.keyPreview} (${aiCfg.keySource === "panel" ? "panel" : "env Vercel"}). Kosongkan bila tidak diubah.` : "Belum ada key. Assisten tidak bisa dipakai sampai key diisi."}>
                            <InputWrap icon={LockKeyhole}>
                              <input
                                type="text"
                                value={aiForm.apiKey}
                                onChange={(e) => updateAiForm("apiKey", e.target.value)}
                                placeholder="sk-... / API key DashScope"
                                autoComplete="off"
                              />
                            </InputWrap>
                          </Field>
                        </div>
                        <Field label="Model untuk Admin">
                          <InputWrap><input value={aiForm.modelAdmin} onChange={(e) => updateAiForm("modelAdmin", e.target.value)} placeholder="qwen3.8-max" /></InputWrap>
                        </Field>
                        <Field label="Model untuk User">
                          <InputWrap><input value={aiForm.modelUser} onChange={(e) => updateAiForm("modelUser", e.target.value)} placeholder="qwen3.7-flash" /></InputWrap>
                        </Field>
                        <div className="cx-full-span">
                          <Field label="Base URL Penyedia AI" hint="Kosongkan untuk memakai endpoint DashScope International">
                            <InputWrap><input value={aiForm.baseUrl} onChange={(e) => updateAiForm("baseUrl", e.target.value)} placeholder="https://dashscope-intl.aliyuncs.com/compatible-mode/v1" /></InputWrap>
                          </Field>
                        </div>
                        <Field label="Maks. Langkah Tool" hint="1 - 10, default 6">
                          <InputWrap><input type="number" min="1" max="10" value={aiForm.maxSteps} onChange={(e) => updateAiForm("maxSteps", e.target.value)} /></InputWrap>
                        </Field>
                        <Field label="Temperature" hint="0 = presisi, 1 = kreatif">
                          <InputWrap><input type="number" step="0.1" min="0" max="2" value={aiForm.temperature} onChange={(e) => updateAiForm("temperature", e.target.value)} /></InputWrap>
                        </Field>
                        <div className="cx-full-span">
                          <Field label="Instruksi Tambahan" hint="Ditambahkan ke system prompt Assisten (opsional)">
                            <InputWrap><textarea value={aiForm.extraPrompt} onChange={(e) => updateAiForm("extraPrompt", e.target.value)} placeholder="Contoh: Selalu tawarkan promo top up mingguan." /></InputWrap>
                          </Field>
                        </div>
                        <div className="cx-full-span">
                          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--ink2)" }}>
                            <input type="checkbox" checked={aiForm.enabled} onChange={(e) => updateAiForm("enabled", e.target.checked)} />
                            Assisten aktif untuk user & admin
                          </label>
                        </div>
                      </div>
                      {aiError && <p className="cx-form-error">{aiError}</p>}
                      {aiNotice && <p style={{ color: "var(--green)", fontSize: 11, marginTop: 8 }}>{aiNotice}</p>}
                      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                        <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={saveSettings} disabled={savingAi}>
                          {savingAi ? <><RefreshCw size={11} /> Menyimpan...</> : <><Check size={11} /> Simpan Pengaturan</>}
                        </button>
                        {aiCfg?.keySource === "panel" && (
                          <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={clearApiKey} disabled={savingAi}>
                            <Trash2 size={11} /> Hapus API Key
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="cx-panel" style={{ marginTop: 18 }}>
                <div className="cx-panel-header">
                  <h3>Hak Akses Assisten</h3>
                  <span className="cx-panel-sub">role menentukan tool yang boleh dipakai</span>
                </div>
                <div style={{ padding: 14, fontSize: 11, color: "var(--muted)", lineHeight: 1.7 }}>
                  <p><strong style={{ color: "var(--ink2)" }}>Admin</strong> — bisa membaca & mengubah data semua user, saldo, status akun, top up, dan produk.</p>
                  <p><strong style={{ color: "var(--ink2)" }}>User biasa</strong> — hanya data akunnya sendiri, dan bisa eskalasi masalah ke admin.</p>
                  <p>Atur role tiap akun di panel <strong style={{ color: "var(--ink2)" }}>Pengguna</strong> (ikon perisai) atau lewat form edit user.</p>
                </div>
              </div>
            </>
          ) : (
          <>
          <div className="cx-admin-top">
            <div>
              <div className="cx-admin-date">{new Date().toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</div>
              <h1>{activeNav === "Dashboard" ? "Ringkasan" : activeNav}</h1>
            </div>
            <div className="cx-admin-actions">
              <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={refreshAll} disabled={refreshing}>
                <RefreshCw size={11} className={refreshing ? "cx-spin" : ""} /> {refreshing ? "Memuat..." : "Refresh"}
              </button>
              {(activeNav === "Dashboard" || activeNav === "Produk") && (
                <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => openForm()}><Plus size={11} /> Tambah Produk</button>
              )}
            </div>
          </div>

          {apiError && (
            <div style={{ border: "1px solid rgba(201,121,128,.3)", background: "rgba(201,121,128,.08)", color: "var(--red)", padding: "10px 14px", borderRadius: 4, fontSize: 11, marginBottom: 18 }}>
              {apiError}
            </div>
          )}

          {/* ══ DASHBOARD ══ */}
          {activeNav === "Dashboard" && (
            <>
              <div className="cx-stat-grid">
                {[
                  { label: "Total Produk", value: totalProducts, delta: `${listings.length} listing`, up: true },
                  { label: "Terjual",      value: totalSold,     delta: "dari total listing", up: totalSold > 0 },
                  { label: "Revenue",      value: formatPrice(revenue), delta: "akumulasi terjual", up: revenue > 0 },
                  { label: "Stok Menipis", value: lowStock,      delta: "perlu restock", up: false },
                ].map(({ label, value, delta, up }) => (
                  <div key={label} className="cx-stat-card">
                    <div className="cx-stat-label">{label}</div>
                    <div className="cx-stat-value">{value}</div>
                    <div className={`cx-stat-delta ${up ? "up" : "down"}`}>
                      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                      <span style={{ marginLeft: 2 }}>{delta}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="cx-quick-grid">
                {[
                  { label: "Permintaan Top Up", nav: "Top Up", icon: Wallet, info: `${pendingTopups} menunggu` },
                  { label: "Pesanan Masuk", nav: "Pesanan", icon: ShoppingBag, info: `${orders.length} transaksi` },
                  { label: "Pengguna", nav: "Pengguna", icon: User, info: `${users.length} akun` },
                  { label: "Produk", nav: "Produk", icon: Package, info: `${listings.length} listing` },
                ].map(({ label, nav, icon: QIcon, info }) => (
                  <button key={nav} className="cx-quick-card" onClick={() => goNav(nav)}>
                    <span className="cx-quick-icon"><QIcon size={15} /></span>
                    <span className="cx-quick-copy">
                      <strong>{label}</strong>
                      <small>{info}</small>
                    </span>
                    <ArrowRight size={13} color="var(--faint)" />
                  </button>
                ))}
              </div>

              <div className="cx-panel" style={{ marginTop: 18 }}>
                <div className="cx-panel-header">
                  <h3>Aktivitas Terbaru</h3>
                  <span className="cx-panel-sub">produk & transaksi terakhir</span>
                </div>
                {recentActivity.length === 0
                  ? <div style={{ padding: "20px 14px", color: "var(--faint)", fontSize: 11 }}>Belum ada aktivitas.</div>
                  : recentActivity.map((a, i) => (
                    <div key={a.key} className="cx-activity-item">
                      <div className="cx-activity-icon" style={{ color: ACCENT_COLORS[i % ACCENT_COLORS.length] }}>
                        <a.Icon size={14} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cx-activity-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.title}</div>
                        <div className="cx-activity-desc">{a.desc}</div>
                      </div>
                      <span className="cx-activity-time">{a.time}</span>
                    </div>
                  ))
                }
              </div>
            </>
          )}

          {/* ══ PRODUK ══ */}
          {activeNav === "Produk" && (
            <div className="cx-panel cx-panel-plain">
              <div className="cx-panel-header">
                <h3>Produk</h3>
                <span className="cx-panel-sub">{filtered.length} dari {listings.length} listing</span>
                <div className="cx-panel-actions">
                  <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={() => openForm()}><Plus size={11} /> Tambah Produk</button>
                </div>
              </div>
              {loading && !listings.length
                ? <RowSkeleton rows={4} />
                : filtered.length === 0
                  ? <div className="cx-panel-empty"><Package size={20} /><p>Tidak ada produk ditemukan.</p></div>
                  : (
                    <div className="cx-product-grid">
                      {filtered.map((l) => {
                        const prices = (l.accounts || []).map((a) => Number(a.price) || Number(l.price) || 0);
                        const min = prices.length ? Math.min(...prices) : Number(l.price) || 0;
                        const max = prices.length ? Math.max(...prices) : min;
                        const stock = Number(l.stock) || 0;
                        return (
                          <article key={l.id} className="cx-admin-product-card">
                            <header>
                              <span className="cx-admin-product-icon"><ProviderIcon type={l.loginType} size={18} /></span>
                              <div className="cx-admin-product-title">
                                <strong title={l.title}>{l.title}</strong>
                                <small>{l.loginType}</small>
                              </div>
                              <span className={`cx-status ${l.status === "available" ? "cx-status-ok" : stock <= 3 ? "cx-status-low" : "cx-status-out"}`}>
                                {l.status === "available" ? "Aktif" : "Habis"}
                              </span>
                            </header>
                            <div className="cx-admin-product-meta">
                              <div>
                                <small>Harga</small>
                                <strong className="cx-mono">{min === max ? formatPrice(min) : `${formatPrice(min)} – ${formatPrice(max)}`}</strong>
                              </div>
                              <div>
                                <small>Stok</small>
                                <strong className="cx-mono" style={{ color: stock === 0 ? "var(--red)" : stock <= 3 ? "var(--amber)" : "var(--ink2)" }}>{stock} akun</strong>
                              </div>
                            </div>
                            {l.description && <ProductDescription className="cx-admin-product-desc" text={l.description} compact />}
                            <footer>
                              <button className="cx-row-btn" onClick={() => openForm(l)}><Pencil size={11} /> <span>Edit</span></button>
                              <button className="cx-row-btn danger" onClick={() => deleteListing(l)} disabled={isPending(`prod-${l.id}`)}>
                                {isPending(`prod-${l.id}`) ? <Spinner /> : <Trash2 size={11} />} <span>Hapus</span>
                              </button>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                  )
              }
            </div>
          )}

          {/* ══ PESANAN ══ */}
          {activeNav === "Pesanan" && (
            <div className="cx-panel cx-panel-plain">
              <div className="cx-panel-header">
                <h3>Pesanan Masuk</h3>
                <span className="cx-panel-sub">{groupedOrders.length} akun pembeli · {filteredOrders.length} transaksi</span>
              </div>
              {ordersLoading && !orders.length
                ? <RowSkeleton rows={3} />
                : groupedOrders.length === 0
                  ? <div className="cx-panel-empty"><ShoppingBag size={20} /><p>Belum ada pesanan masuk.</p></div>
                  : groupedOrders.map((g) => {
                    const bkey = g.buyer.id || g.buyer.email;
                    const expanded = !!openBuyers[bkey];
                    const shownOrders = expanded ? g.orders : g.orders.slice(0, 1);
                    return (
                    <div key={bkey} className="cx-order-card cx-buyer-card">
                      <div className="cx-order-card-head">
                        <div className="cx-avatar">{String(g.buyer.name || "U").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</div>
                        <div className="cx-buyer-ident">
                          <strong>{g.buyer.name}</strong>
                          <small>{g.buyer.email}{g.buyer.phone ? ` · ${g.buyer.phone}` : ""}</small>
                        </div>
                        <div className="cx-order-total">
                          <strong className="cx-mono">{formatPrice(g.total)}</strong>
                          <small>{g.orders.length} transaksi · {g.accounts} akun</small>
                        </div>
                      </div>
                      <div className="cx-order-meta">
                        <span>Saldo pembeli: {formatPrice(g.buyer.balance)}</span>
                        <span>Terakhir: {formatDate(g.orders[0].createdAt)}</span>
                      </div>
                      <div className="cx-buyer-orders">
                        {shownOrders.map((o) => (
                          <div key={o.id} className="cx-buyer-order">
                            <div className="cx-buyer-order-head">
                              <span className="cx-mono">#{String(o.id).slice(0, 8)}</span>
                              <span>{formatDate(o.createdAt)}</span>
                              <span className={`cx-status ${o.status === "paid" ? "cx-status-ok" : "cx-status-low"}`}>{o.status === "paid" ? "Lunas" : "Refund"}</span>
                              <strong className="cx-mono" style={{ marginLeft: "auto" }}>{formatPrice(o.total)}</strong>
                              <button
                                className="cx-row-btn danger"
                                onClick={() => deleteAdminOrder(o.id)}
                                aria-label="Hapus pesanan"
                                disabled={isPending(`aorder-${o.id}`)}
                              >
                                {isPending(`aorder-${o.id}`) ? <Spinner /> : <Trash2 size={11} />}
                              </button>
                            </div>
                            {customEmailsOf(o).map((r) => (
                              <div key={r.id} className="cx-custom-email-tag"><Mail size={11} /> <strong>{r.requested}</strong>
                                <span className={`cx-status cx-cemail-${r.status || "pending"}`}>{CUSTOM_EMAIL_STATUS_LABEL[r.status || "pending"]}</span>
                              </div>
                            ))}
                            <div className="cx-order-items">
                              {(o.items || []).map((it, i) => (
                                <div key={i} className="cx-order-item">
                                  <ProviderIcon type={it.loginType} size={13} />
                                  <span className="cx-order-item-title">{it.title}</span>
                                  <span className="cx-order-item-sub">{(it.accounts || []).length} akun · {(it.accounts || []).map((a) => a.email).join(", ")}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="cx-order-actions">
                        {g.orders.length > 1 && (
                          <button className="cx-row-btn" onClick={() => setOpenBuyers((m) => ({ ...m, [bkey]: !expanded }))}>
                            <ChevronDown size={11} style={{ transform: expanded ? "rotate(180deg)" : "none" }} />
                            <span>{expanded ? "Sembunyikan" : `Lihat ${g.orders.length - 1} transaksi lain`}</span>
                          </button>
                        )}
                        <button className="cx-row-btn" onClick={() => { setUserQuery(g.buyer.email); setActiveNav("Pengguna"); }}><User size={11} /> <span>Lihat akun</span></button>
                      </div>
                    </div>
                    );
                  })
              }
            </div>
          )}

          {/* ══ CUSTOM EMAIL ══ */}
          {activeNav === "Custom Email" && (() => {

            const requests = orders.flatMap((o) => customEmailsOf(o).map((r) => ({ ...r, order: o })));
            const openCount = requests.filter((r) => (r.status || "pending") !== "done" && r.status !== "rejected").length;
            return (
              <div className="cx-panel cx-panel-plain">
                <div className="cx-panel-header">
                  <h3>Permintaan Custom Email</h3>
                  <span className="cx-panel-sub">{requests.length} permintaan · {openCount} belum selesai · {formatPrice(CUSTOM_EMAIL_FEE)} / nama</span>
                </div>
                {ordersLoading && !orders.length
                  ? <RowSkeleton rows={3} />
                  : requests.length === 0
                    ? <div className="cx-panel-empty"><Mail size={20} /><p>Belum ada permintaan email khusus.</p></div>
                    : <div className="cx-ce-admin-list">
                        {requests.map((r) => (
                          <article key={r.id} className="cx-ce-admin-card">
                            <header className="cx-ce-admin-head">
                              <div className="cx-ce-admin-name">
                                <Mail size={13} />
                                <strong>{r.requested}</strong>
                              </div>
                              <span className={`cx-status cx-cemail-${r.status || "pending"}`}>
                                {CUSTOM_EMAIL_STATUS_LABEL[r.status || "pending"]}
                              </span>
                            </header>
                            <div className="cx-ce-admin-meta">
                              <span className="cx-mono">#{String(r.order.id).slice(0, 8)}</span>
                              <span>{formatDate(r.order.createdAt)}</span>
                              <span>{r.order.userName || r.order.buyerName || "Pembeli"}</span>
                              {r.order.userEmail && <span className="cx-ce-admin-email">{r.order.userEmail}</span>}
                            </div>
                            {r.profile && r.profile.firstName && (
                              <div className="cx-ce-admin-prof">
                                <span><User size={11} /> {r.profile.firstName} {r.profile.lastName}</span>
                                <span>{formatBirthDate(r.profile.birthDate)}</span>
                                <span>{CUSTOM_GENDER_LABEL[r.profile.gender] || "-"}</span>
                              </div>
                            )}
                            <div className="cx-ce-admin-actions">
                              {Object.keys(CUSTOM_EMAIL_STATUS_LABEL).map((st) => (
                                <button
                                  key={st}
                                  className={`cx-row-btn${(r.status || "pending") === st ? " is-active" : ""}`}
                                  disabled={isPending(`cemail-${r.id}`) || (r.status || "pending") === st}
                                  onClick={() => setCustomEmailStatus(r.id, st)}
                                >
                                  <span>{CUSTOM_EMAIL_STATUS_LABEL[st]}</span>
                                </button>
                              ))}
                            </div>
                            <div className="cx-ce-admin-fields">
                              <label className="cx-ce-admin-field">
                                <span><LockKeyhole size={11} /> Password akun</span>
                                <input
                                  value={ceField(r, "password")}
                                  onChange={(e) => setCeField(r.id, "password", e.target.value)}
                                  placeholder="Password login Google"
                                  maxLength={120}
                                  autoComplete="off"
                                />
                              </label>
                              <label className="cx-ce-admin-field">
                                <span><FileText size={11} /> Catatan untuk pembeli</span>
                                <textarea
                                  value={ceField(r, "note")}
                                  onChange={(e) => setCeField(r.id, "note", e.target.value)}
                                  placeholder="Contoh: email pemulihan sudah diisi, ganti password setelah login."
                                  rows={2}
                                  maxLength={600}
                                />
                              </label>
                              <button
                                className="cx-btn cx-btn-primary cx-btn-full"
                                disabled={!ceDirty(r) || isPending(`cemail-${r.id}`)}
                                onClick={() => patchCustomEmail(r.id, {
                                  password: ceField(r, "password"),
                                  note: ceField(r, "note"),
                                }, "Password & catatan disimpan")}
                              >
                                {isPending(`cemail-${r.id}`) ? <Spinner /> : <Check size={12} />}
                                <span>Simpan password &amp; catatan</span>
                              </button>
                            </div>
                            <button className="cx-row-btn cx-ce-admin-link" onClick={() => goNav("Pesanan")}>
                              <ShoppingBag size={11} /> <span>Buka di Pesanan</span>
                            </button>
                          </article>
                        ))}
                      </div>
                }
              </div>
            );
          })()}

          {/* ══ TOP UP ══ */}
          {activeNav === "Top Up" && (
            <div className="cx-panel">
              <div className="cx-panel-header">
                <h3>Permintaan Top Up</h3>
                <span className="cx-panel-sub">{pendingTopups} menunggu · {topups.length - pendingTopups} selesai</span>
                <div className="cx-panel-actions">
                  <ActionBtn
                    className="cx-btn cx-btn-ghost cx-btn-sm"
                    onClick={clearTopupHistory}
                    disabled={topups.length - pendingTopups === 0}
                    busy={isPending("topup-clear")}
                    busyLabel="Membersihkan..."
                  >
                    <Trash2 size={11} /> Bersihkan riwayat
                  </ActionBtn>
                </div>
              </div>
              {topups.length === 0
                ? <div style={{ padding: "20px 14px", color: "var(--faint)", fontSize: 11 }}>Belum ada permintaan top up.</div>
                : topups.map((t) => (
                  <div key={t.id} className="cx-topup-row">
                    <div>
                      <strong>{formatPrice(t.amount)}</strong>
                      <small>{t.userName} · {t.userEmail} · {t.method}{t.reference ? ` · ID trx: ${t.reference}` : ""}</small>
                      {t.note && <ExpandableText className="cx-topup-note" text={`Catatan: ${t.note}`} lines={2} limit={80} />}
                    </div>
                    <span className="cx-topup-date">{formatDate(t.createdAt)}</span>
                    {t.status === "pending"
                      ? <div className="cx-topup-review">
                          <ActionBtn
                            className="cx-btn cx-btn-primary cx-btn-sm"
                            onClick={() => reviewTopup(t.id, "approve", `${formatPrice(t.amount)} · ${t.userName} (${t.userEmail})`)}
                            busy={isPending(`topup-${t.id}`)}
                          >
                            <Check size={11} /> Setujui
                          </ActionBtn>
                          <ActionBtn
                            className="cx-btn cx-btn-ghost cx-btn-sm"
                            onClick={() => reviewTopup(t.id, "reject", `${formatPrice(t.amount)} · ${t.userName} (${t.userEmail})`)}
                            busy={isPending(`topup-${t.id}`)}
                          >
                            <X size={11} /> Tolak
                          </ActionBtn>
                        </div>
                      : <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className={`cx-topup-badge ${t.status === "approved" ? "ok" : "bad"}`}>
                            {t.status === "approved" ? <BadgeCheck size={11} /> : <X size={11} />}
                            {t.status === "approved" ? " Disetujui" : " Ditolak"}
                          </span>
                          <button className="cx-row-btn danger" onClick={() => deleteTopup(t.id)} aria-label="Hapus permintaan" disabled={isPending(`topup-del-${t.id}`)}>
                            {isPending(`topup-del-${t.id}`) ? <Spinner /> : <Trash2 size={11} />}
                          </button>
                        </div>}
                  </div>
                ))}
            </div>
          )}

          {/* ══ INJECT DATA ══ */}
          {activeNav === "Inject Data" && (
            <>
              <div className="cx-panel cx-review-inject">
                <div className="cx-panel-header">
                  <h3>Inject ulasan & rating</h3>
                  <span className="cx-panel-sub">
                    {reviewSummary.total} ulasan · {reviewSummary.user} dari pembeli · {reviewSummary.injected} hasil inject · rata-rata {reviewSummary.ratingAvg || 0}★
                  </span>
                  <div className="cx-panel-actions">
                    <ActionBtn className="cx-btn cx-btn-ghost cx-btn-sm" onClick={loadReviews} busy={reviewsLoading} busyLabel="Memuat...">
                      <RefreshCw size={11} /> Muat ulang
                    </ActionBtn>
                  </div>
                </div>
                <div className="cx-review-form">
                  <Field label="Produk">
                    <InputWrap>
                      <select value={injectForm.listingId} onChange={(e) => setInjectForm((f) => ({ ...f, listingId: e.target.value }))}>
                        <option value="all">Semua produk</option>
                        {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Jumlah per produk">
                    <InputWrap>
                      <input type="number" min="1" max="200" value={injectForm.count}
                        onChange={(e) => setInjectForm((f) => ({ ...f, count: e.target.value }))} />
                    </InputWrap>
                  </Field>
                  <Field label="Rating minimum">
                    <InputWrap>
                      <select value={injectForm.minRating} onChange={(e) => setInjectForm((f) => ({ ...f, minRating: Number(e.target.value) }))}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} bintang</option>)}
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Rating maksimum">
                    <InputWrap>
                      <select value={injectForm.maxRating} onChange={(e) => setInjectForm((f) => ({ ...f, maxRating: Number(e.target.value) }))}>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} bintang</option>)}
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Sebar tanggal (hari ke belakang)">
                    <InputWrap>
                      <input type="number" min="1" max="365" value={injectForm.spreadDays}
                        onChange={(e) => setInjectForm((f) => ({ ...f, spreadDays: e.target.value }))} />
                    </InputWrap>
                  </Field>
                </div>
                <div className="cx-review-form-actions">
                  <ActionBtn className="cx-btn cx-btn-primary cx-btn-sm" onClick={injectReviews} busy={isPending("review-inject")} busyLabel="Menambahkan...">
                    <Plus size={11} /> Inject ulasan
                  </ActionBtn>
                  <ActionBtn className="cx-btn cx-btn-ghost cx-btn-sm" onClick={clearInjectedReviews} busy={isPending("review-clear")} busyLabel="Menghapus..."
                    disabled={reviewSummary.injected === 0}>
                    <Trash2 size={11} /> Hapus hasil inject
                  </ActionBtn>
                  <span className="cx-review-hint">Teks ulasan dicek agar tidak pernah kembar dengan ulasan lain.</span>
                </div>
              </div>

              {/* ── Inject jumlah terjual ── */}
              <div className="cx-panel cx-review-inject">
                <div className="cx-panel-header">
                  <h3>Inject jumlah terjual</h3>
                  <span className="cx-panel-sub">
                    {soldForm.listingId === "all"
                      ? "Berlaku untuk semua produk"
                      : `Sekarang: ${soldOfListing(soldForm.listingId)} terjual`}
                  </span>
                </div>
                <div className="cx-review-form">
                  <Field label="Produk">
                    <InputWrap>
                      <select value={soldForm.listingId} onChange={(e) => setSoldForm((f) => ({ ...f, listingId: e.target.value }))}>
                        <option value="all">Semua produk</option>
                        {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Mode">
                    <InputWrap>
                      <select value={soldForm.soldMode} onChange={(e) => setSoldForm((f) => ({ ...f, soldMode: e.target.value }))}>
                        <option value="add">Tambah ke jumlah sekarang</option>
                        <option value="set">Set jadi nilai pasti</option>
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Jumlah minimum">
                    <InputWrap>
                      <input type="number" min="0" max="100000" value={soldForm.soldMin}
                        onChange={(e) => setSoldForm((f) => ({ ...f, soldMin: e.target.value }))} />
                    </InputWrap>
                  </Field>
                  <Field label="Jumlah maksimum">
                    <InputWrap>
                      <input type="number" min="0" max="100000" value={soldForm.soldMax}
                        onChange={(e) => setSoldForm((f) => ({ ...f, soldMax: e.target.value }))} />
                    </InputWrap>
                  </Field>
                </div>
                <div className="cx-review-form-actions">
                  <ActionBtn className="cx-btn cx-btn-primary cx-btn-sm" onClick={injectSold} busy={isPending("sold-inject")} busyLabel="Menyimpan...">
                    <Plus size={11} /> Terapkan jumlah terjual
                  </ActionBtn>
                  <span className="cx-review-hint">Angka diacak antara minimum dan maksimum untuk tiap produk.</span>
                </div>
              </div>

              {/* ── Inject produk etalase ── */}
              <div className="cx-panel cx-review-inject">
                <div className="cx-panel-header">
                  <h3>Inject produk etalase</h3>
                  <span className="cx-panel-sub">
                    {demoCount} produk etalase aktif · selalu tampil sebagai stok habis dan tidak bisa dibeli
                  </span>
                  <div className="cx-panel-actions">
                    <ActionBtn className="cx-btn cx-btn-ghost cx-btn-sm" onClick={loadDemoCount} busyLabel="Memuat...">
                      <RefreshCw size={11} /> Muat ulang
                    </ActionBtn>
                  </div>
                </div>
                <div className="cx-review-form">
                  <Field label="Templat produk">
                    <InputWrap>
                      <select value={demoForm.template}
                        onChange={(e) => setDemoForm((f) => ({ ...f, template: e.target.value }))}>
                        <option value="mixed">Campur semua templat</option>
                        {demoTemplates.map((t) => (
                          <option key={t.key} value={t.key}>{t.label}</option>
                        ))}
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Jumlah produk">
                    <InputWrap>
                      <input type="number" min="1" max="50" value={demoForm.count}
                        onChange={(e) => setDemoForm((f) => ({ ...f, count: e.target.value }))} />
                    </InputWrap>
                  </Field>
                </div>
                <div className="cx-review-form-actions">
                  <ActionBtn className="cx-btn cx-btn-primary cx-btn-sm" onClick={injectDemoProducts} busy={isPending("demo-inject")} busyLabel="Menambahkan...">
                    <Plus size={11} /> Inject produk etalase
                  </ActionBtn>
                  <ActionBtn className="cx-btn cx-btn-ghost cx-btn-sm" onClick={clearDemoProducts} busy={isPending("demo-clear")} busyLabel="Menghapus..."
                    disabled={demoCount === 0}>
                    <Trash2 size={11} /> Hapus produk etalase
                  </ActionBtn>
                  <span className="cx-review-hint">Nama dan harga mengikuti templat yang dipilih, diacak agar terlihat wajar.</span>
                </div>
              </div>


            </>
          )}

          {/* ══ ULASAN & RATING ══ */}
          {activeNav === "Ulasan & Rating" && (
            <>
              <div className="cx-panel">

                <div className="cx-panel-header">
                  <h3>Semua ulasan</h3>
                  <span className="cx-panel-sub">{visibleReviews.length} ulasan ditampilkan</span>
                  <div className="cx-panel-actions cx-review-filters">
                    <select value={reviewListing} onChange={(e) => setReviewListing(e.target.value)}>
                      <option value="all">Semua produk</option>
                      {listings.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
                    </select>
                    {[["all", "Semua"], ["user", "Pembeli"], ["injected", "Inject"]].map(([value, label]) => (
                      <button key={value} className={`cx-chip${reviewFilter === value ? " active" : ""}`} onClick={() => setReviewFilter(value)}>{label}</button>
                    ))}
                  </div>
                </div>
                {reviewsLoading && reviews.length === 0
                  ? <RowSkeleton rows={4} />
                  : visibleReviews.length === 0
                    ? <div style={{ padding: "20px 14px", color: "var(--faint)", fontSize: 11 }}>Belum ada ulasan.</div>
                    : visibleReviews.map((r) => (
                      <div key={r.id} className="cx-review-row">
                        <div className="cx-review-main">
                          <div className="cx-review-top">
                            <strong>{r.author}</strong>
                            <span className="cx-review-stars">{"★".repeat(r.rating)}<span className="dim">{"★".repeat(5 - r.rating)}</span></span>
                            <span className={`cx-review-tag ${r.source}`}>{r.source === "injected" ? "Inject" : "Pembeli"}</span>
                          </div>
                          <small className="cx-review-meta">{r.listingTitle} · {formatDate(r.createdAt)}</small>
                          {r.comment && <ExpandableText className="cx-review-text" text={r.comment} lines={2} limit={140} />}
                        </div>
                        <button className="cx-row-btn danger" onClick={() => deleteReview(r)} aria-label="Hapus ulasan" disabled={isPending(`review-del-${r.id}`)}>
                          {isPending(`review-del-${r.id}`) ? <Spinner /> : <Trash2 size={11} />}
                        </button>
                      </div>
                    ))}
              </div>
            </>
          )}

          {/* ══ PENGGUNA ══ */}
          {activeNav === "Pengguna" && (
          <div className="cx-panel">
            <div className="cx-panel-header">
              <h3>Pengguna</h3>
              <span className="cx-panel-sub">
                {userQuery.trim() ? `${filteredUsers.length} hasil dari ${users.length} akun` : `${users.length} akun terdaftar`}
              </span>
              <div className="cx-panel-actions">
                <div className="cx-search cx-user-search">
                  <Search size={12} />
                  <input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Cari nama, email, no. HP, atau ID akun" />
                  {userQuery.trim() && <button type="button" className="cx-search-clear" onClick={() => setUserQuery("")} aria-label="Hapus pencarian"><X size={11} /></button>}
                </div>
              </div>
            </div>
            <div className="cx-user-filters">
              {[
                { key: "all", label: "Semua" },
                { key: "active", label: "Aktif" },
                { key: "inactive", label: "Nonaktif" },
                { key: "admin", label: "Admin" },
                { key: "verified", label: "Terverifikasi" },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`cx-user-filter${userFilter === f.key ? " is-active" : ""}`}
                  onClick={() => setUserFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="cx-user-head">
              <span>USER</span><span>SALDO</span><span>TOP UP</span><span>STATUS</span><span>BERGABUNG</span><span />
            </div>
            {filteredUsers.length === 0
              ? (
                <div className="cx-panel-empty">
                  <User size={20} />
                  <p>Pengguna tidak ditemukan</p>
                  <small>Coba cari menggunakan nama, email, no. HP, atau ID akun.</small>
                  {(userQuery.trim() || userFilter !== "all") && (
                    <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => { setUserQuery(""); setUserFilter("all"); }}>Tampilkan semua akun</button>
                  )}
                </div>
              )
              : pagedUsers.map((u) => {
                const shortId = String(u.id || "").slice(0, 8);
                const statusCls = u.status === "active" ? "cx-status-ok" : u.status === "suspended" ? "cx-status-low" : "cx-status-out";
                const statusTxt = u.status === "active" ? "Aktif" : u.status === "suspended" ? "Ditangguhkan" : "Diblokir";
                return (
                <div key={u.id} className="cx-user-row">
                  <div className="cx-user-ident">
                    <div className="cx-avatar">{String(u.name || "U").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}</div>
                    <div style={{ minWidth: 0 }}>
                      <strong>
                        {u.name}
                        {u.role === "admin" && (
                          <span className="cx-role-tag"><ShieldCheck size={9} /> Admin</span>
                        )}
                      </strong>
                      <small>{u.email}{u.phone ? ` · ${u.phone}` : ""}</small>
                    </div>
                    <button type="button" className="cx-user-id" onClick={() => copyUserId(u.id)} title="Salin ID akun">
                      <span>ID AKUN</span>
                      <em className="cx-mono">{copiedId === String(u.id) ? "ID disalin" : shortId}</em>
                      <Copy size={10} />
                    </button>
                  </div>
                  <span className="cx-mono cx-user-cell" data-label="Saldo">{formatPrice(u.balance)}</span>
                  <span className="cx-mono cx-user-cell" data-label="Top up" style={{ color: "var(--muted)" }}>
                    {formatPrice(u.topupTotal)}{u.pendingCount ? ` · ${u.pendingCount} pending` : ""}
                  </span>
                  <div className="cx-user-meta">
                    <span className={`cx-chip ${u.status === "active" ? "cx-chip-ok" : u.status === "suspended" ? "cx-chip-warn" : "cx-chip-bad"}`}>
                      <i /> {statusTxt}
                    </span>
                    <span className="cx-user-date" data-label="Bergabung">{u.createdAt ? formatDate(u.createdAt) : "—"}</span>
                  </div>
                  <div className="cx-row-actions">
                    {u.status === "active"
                      ? <button className="cx-row-btn" onClick={() => setUserStatus(u.id, "suspend")} aria-label="Tangguhkan"><LockKeyhole size={11} /> <span>Tangguhkan</span></button>
                      : <button className="cx-row-btn" onClick={() => setUserStatus(u.id, "activate")} aria-label="Aktifkan"><BadgeCheck size={11} /> <span>Aktifkan</span></button>}
                    <button
                      className="cx-row-btn"
                      onClick={() => setUserRole(u.id, u.role === "admin" ? "user" : "admin")}
                      aria-label={u.role === "admin" ? "Cabut admin" : "Jadikan admin"}
                      title={u.role === "admin" ? "Cabut akses admin" : "Jadikan admin"}
                    >
                      <ShieldCheck size={11} /> <span>{u.role === "admin" ? "Cabut admin" : "Jadikan admin"}</span>
                    </button>
                    <button className="cx-row-btn" onClick={() => openUserForm(u)} aria-label="Edit user"><Pencil size={11} /> <span>Detail</span></button>
                    <button className="cx-row-btn danger" onClick={() => deleteUser(u)} aria-label="Hapus user" disabled={isPending(`user-del-${u.id}`)}>
                      {isPending(`user-del-${u.id}`) ? <Spinner /> : <Trash2 size={11} />} <span>Hapus</span>
                    </button>
                  </div>

                </div>
                );
              })}

            {filteredUsers.length > USERS_PER_PAGE && (
              <div className="cx-pager">
                <span>Halaman {safeUserPage} dari {userPageCount} · {filteredUsers.length} akun</span>
                <div className="cx-pager-btns">
                  <button className="cx-row-btn" disabled={safeUserPage <= 1} onClick={() => setUserPage(safeUserPage - 1)}>Sebelumnya</button>
                  <button className="cx-row-btn" disabled={safeUserPage >= userPageCount} onClick={() => setUserPage(safeUserPage + 1)}>Berikutnya</button>
                </div>
              </div>
            )}
          </div>
          )}

          {/* ══ PENGATURAN ══ */}
          {activeNav === "Pengaturan" && (
            <div className="cx-settings-grid">
              <div className="cx-panel">
                <div className="cx-panel-header"><h3>Sesi Admin</h3><span className="cx-panel-sub">akses panel</span></div>
                <div className="cx-setting-row">
                  <div><strong>Status sesi</strong><small>Sesi admin aktif di perangkat ini.</small></div>
                  <span className="cx-status cx-status-ok">Aktif</span>
                </div>
                <div className="cx-setting-row">
                  <div><strong>Keluar dari panel</strong><small>Akhiri sesi admin sekarang.</small></div>
                  <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={logout}><LogOut size={11} /> Keluar</button>
                </div>
              </div>
              <div className="cx-panel">
                <div className="cx-panel-header"><h3>Toko</h3><span className="cx-panel-sub">tampilan pembeli</span></div>
                <div className="cx-setting-row">
                  <div><strong>Kembali ke store</strong><small>Buka tampilan pembeli.</small></div>
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={onBack}><ArrowRight size={11} /> Store</button>
                </div>
                <div className="cx-setting-row">
                  <div><strong>Produk aktif</strong><small>Jumlah listing yang tampil di toko.</small></div>
                  <span className="cx-status cx-status-ok">{listings.length} listing</span>
                </div>
              </div>
              <div className="cx-panel">
                <div className="cx-panel-header"><h3>Data &amp; Pemeliharaan</h3><span className="cx-panel-sub">sinkronisasi data</span></div>
                <div className="cx-setting-row">
                  <div><strong>Muat ulang semua data</strong><small>Produk, pengguna, top up, dan pesanan.</small></div>
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={refreshAll} disabled={refreshing}>
                    <RefreshCw size={11} className={refreshing ? "cx-spin" : ""} /> Refresh
                  </button>
                </div>
                <div className="cx-setting-row is-danger">
                  <div><strong>Bersihkan riwayat top up</strong><small>Hapus permintaan yang sudah disetujui/ditolak.</small></div>
                  <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={clearTopupHistory} disabled={topups.length - pendingTopups === 0}>
                    <Trash2 size={11} /> Bersihkan
                  </button>
                </div>
              </div>
              <div className="cx-panel">
                <div className="cx-panel-header"><h3>Assistant AI</h3><span className="cx-panel-sub">asisten otomatis</span></div>
                <div className="cx-setting-row">
                  <div><strong>Status koneksi</strong><small>{aiCfg && aiCfg.enabled && aiCfg.hasKey ? "Terhubung dan aktif" : "Belum dikonfigurasi"}</small></div>
                  <span className={`cx-status ${aiCfg && aiCfg.enabled && aiCfg.hasKey ? "cx-status-ok" : "cx-status-low"}`}>
                    {aiCfg && aiCfg.enabled && aiCfg.hasKey ? "Aktif" : "Nonaktif"}
                  </span>
                </div>
                <div className="cx-setting-row">
                  <div><strong>Pengaturan asisten</strong><small>Atur kunci API dan perilaku asisten.</small></div>
                  <button className="cx-btn cx-btn-secondary cx-btn-sm" onClick={() => goNav("Assisten")}><Sparkles size={11} /> Atur</button>
                </div>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Status bar */}
        <div className="cx-status-bar">
          <span className="cx-status-dot" />
          Last sync: baru saja
          <span style={{ marginLeft: "auto" }}>Jakarta · UTC+7</span>
        </div>
      </main>

      {/* User modal */}
      {userForm && (
        <div className="cx-modal-backdrop cx-admin-modal-backdrop" onClick={closeUserForm}>
          <div className="cx-modal cx-user-modal" onClick={(e) => e.stopPropagation()}>

            <div className="cx-modal-header">
              <h2>Detail User</h2>
              <button className="cx-icon-btn" onClick={closeUserForm}><X size={14} /></button>
            </div>
            <div className="cx-modal-body">
              {(() => {
                const d = userDetail || {};
                const nd = <em className="cx-nd">Belum tersedia</em>;
                const provider = d.provider === "google" ? "Google" : d.provider === "email" ? "Email & password" : "";
                const statusLabel = (s) => (s === "active" ? "Aktif" : s === "suspended" ? "Ditangguhkan" : s === "banned" ? "Diblokir" : "—");
                const statusClass = (s) => (s === "active" ? "cx-status-ok" : s === "suspended" ? "cx-status-low" : "cx-status-out");
                const chipClass = (s) => (s === "active" ? "cx-chip-ok" : s === "suspended" ? "cx-chip-warn" : "cx-chip-bad");
                const initials = String(d.name || userForm.name || "U").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
                return (
                  <>
                    <div className={`cx-ud-head is-${d.status || "unknown"}`}>
                      <div className="cx-avatar cx-ud-avatar">{initials}</div>
                      <div className="cx-ud-head-main">
                        <strong>{d.name || userForm.name || "Tanpa nama"}</strong>
                        <div className="cx-ud-badges">
                          <span className={`cx-chip ${d.role === "admin" ? "cx-chip-admin" : "cx-chip-user"}`}>
                            <ShieldCheck size={9} /> {d.role === "admin" ? "Admin" : "User"}
                          </span>
                          <span className={`cx-chip ${chipClass(d.status)}`}><i /> {statusLabel(d.status)}</span>
                        </div>
                        <small><Mail size={9} /> {d.email || userForm.email}</small>
                      </div>
                      <button type="button" className="cx-user-id cx-ud-id" onClick={() => copyUserId(d.id)} title="Salin ID akun">
                        <span>ID AKUN</span>
                        <em className="cx-mono">{copiedId === String(d.id) ? "disalin" : String(d.id || "").slice(0, 8)}</em>
                        <Copy size={10} />
                      </button>
                      <div className="cx-ud-head-actions">
                        {d.status === "active"
                          ? <button className="cx-btn cx-btn-ghost cx-btn-sm cx-ud-danger-btn" onClick={() => { setUserStatus(d.id, "suspend"); setUserDetail({ ...d, status: "suspended" }); updateUserForm("status", "suspended"); }}><LockKeyhole size={11} /> Nonaktifkan</button>
                          : <button className="cx-btn cx-btn-secondary cx-btn-sm cx-ud-ok-btn" onClick={() => { setUserStatus(d.id, "activate"); setUserDetail({ ...d, status: "active" }); updateUserForm("status", "active"); }}><BadgeCheck size={11} /> Aktifkan</button>}
                      </div>
                    </div>

                    <div className="cx-ud-section">
                      <div className="cx-form-divider">IDENTITAS &amp; AKUN</div>
                      <div className="cx-ud-list">
                        <div><User size={11} /><span>Nama</span><strong>{d.name || nd}</strong></div>
                        <div><Mail size={11} /><span>Email</span><strong>{d.email || nd}</strong></div>
                        <div><Bell size={11} /><span>WhatsApp</span><strong>{d.phone || nd}</strong></div>
                        <div><FileText size={11} /><span>User ID</span><strong className="cx-mono">{d.id}</strong></div>
                        <div><LogIn size={11} /><span>Login via</span><strong>{provider || nd}</strong></div>
                        <div><Command size={11} /><span>Tanggal daftar</span><strong>{d.createdAt ? formatDate(d.createdAt) : nd}</strong></div>
                        <div><TrendingUp size={11} /><span>Login terakhir</span><strong>{nd}</strong></div>
                      </div>
                    </div>

                    <div className="cx-ud-section">
                      <div className="cx-form-divider">SALDO &amp; TRANSAKSI</div>
                      <div className="cx-form-balance">
                        <div>
                          <small>Saldo saat ini</small>
                          <strong>{formatPrice(Number(userForm.balance) || 0)}</strong>
                        </div>
                        <span>total top up<br />{formatPrice(d.topupTotal || 0)}</span>
                      </div>
                      <div className="cx-ud-stats">
                        <div><small>Jumlah top up</small><strong>{loadingDetail ? "…" : `${d.topupCount ?? 0}×`}</strong></div>
                        <div><small>Top up pending</small><strong>{d.pendingCount ?? 0}</strong></div>
                        <div><small>Total pembelian</small><strong>{d.available ? formatPrice(d.orderTotal || 0) : nd}</strong></div>
                        <div><small>Top up terakhir</small><strong>{d.lastTopupAt ? formatDate(d.lastTopupAt) : nd}</strong></div>
                      </div>
                    </div>

                    <div className="cx-ud-section">
                      <div className="cx-form-divider">STATUS &amp; AKSES</div>
                      <div className="cx-ud-list cx-ud-status-list">
                        <div><BadgeCheck size={11} /><span>Status akun</span><strong><span className={`cx-chip ${chipClass(d.status)}`}><i /> {statusLabel(d.status)}</span></strong></div>
                        <div><ShieldCheck size={11} /><span>Role</span><strong><span className={`cx-chip ${d.role === "admin" ? "cx-chip-admin" : "cx-chip-user"}`}><i /> {d.role === "admin" ? "Admin" : "User"}</span></strong></div>
                        <div><Mail size={11} /><span>Status email</span><strong>{d.provider === "google" ? <span className="cx-chip cx-chip-ok"><i /> Terverifikasi (Google)</span> : d.emailVerifiedAt ? <span className="cx-chip cx-chip-ok"><i /> Terverifikasi</span> : <span className="cx-chip cx-chip-warn"><i /> Belum terverifikasi</span>}</strong></div>
                        <div><CircleHelp size={11} /><span>Verifikasi akun</span><strong><span className="cx-chip cx-chip-none"><i /> Belum tersedia</span></strong></div>
                      </div>
                    </div>

                    <div className="cx-ud-section">
                      <div className="cx-form-divider">AKTIVITAS TERBARU</div>
                      {loadingDetail && !userActivity
                        ? <div className="cx-ud-empty"><Spinner /> Memuat aktivitas…</div>
                        : (userActivity && userActivity.length
                          ? (
                            <div className="cx-ud-activity">
                              {userActivity.map((a, i) => (
                                <div key={i}>
                                  {a.kind === "topup" ? <Wallet size={12} /> : a.kind === "order" ? <ShoppingBag size={12} /> : <LogIn size={12} />}
                                  <div>
                                    <strong>{a.label}</strong>
                                    <small>{a.status} · {formatDate(a.at)}</small>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )
                          : <div className="cx-ud-empty"><FileText size={14} /> Belum ada aktivitas tercatat.</div>)}
                    </div>
                  </>
                );
              })()}

                            <div className="cx-form-section">
                <div className="cx-form-divider">DATA AKUN</div>
                <div className="cx-form-grid">
                  <Field label="Nama">
                    <InputWrap><input value={userForm.name} onChange={(e) => updateUserForm("name", e.target.value)} /></InputWrap>
                  </Field>
                  <Field label="Email">
                    <InputWrap><input value={userForm.email} onChange={(e) => updateUserForm("email", e.target.value)} /></InputWrap>
                  </Field>
                  <div className="cx-full-span">
                    <Field label="Nomor WhatsApp">
                      <InputWrap><input value={userForm.phone} onChange={(e) => updateUserForm("phone", e.target.value)} placeholder="0812xxxx" /></InputWrap>
                    </Field>
                  </div>
                </div>
              </div>

              <div className="cx-form-section">
                <div className="cx-form-divider">SALDO &amp; TOP UP</div>
                <div className="cx-form-grid">
                  <div className="cx-full-span">
                    <Field label="Saldo (IDR)" hint="Ubah manual bila perlu koreksi">
                      <InputWrap><input type="number" value={userForm.balance} onChange={(e) => updateUserForm("balance", e.target.value)} /></InputWrap>
                    </Field>
                  </div>
                </div>
              </div>

              <div className="cx-form-section">
                <div className="cx-form-divider">STATUS &amp; ROLE</div>
                <div className="cx-form-grid">
                  <Field label="Status Akun">
                    <InputWrap>
                      <select value={userForm.status} onChange={(e) => updateUserForm("status", e.target.value)}>
                        <option value="active">Aktif</option>
                        <option value="suspended">Ditangguhkan</option>
                        <option value="banned">Diblokir</option>
                      </select>
                    </InputWrap>
                  </Field>
                  <Field label="Role" hint="Admin bisa memakai Assisten mode admin">
                    <InputWrap>
                      <select value={userForm.role} onChange={(e) => updateUserForm("role", e.target.value)}>
                        <option value="user">User biasa</option>
                        <option value="admin">Admin</option>
                      </select>
                    </InputWrap>
                  </Field>
                  <div className="cx-full-span">
                    <Field label="Catatan Admin">
                      <InputWrap><textarea value={userForm.note} onChange={(e) => updateUserForm("note", e.target.value)} placeholder="Catatan internal tentang user ini..." /></InputWrap>
                    </Field>
                  </div>
                </div>
              </div>

              <div className="cx-form-section is-secure">
                <div className="cx-form-divider">KEAMANAN <small>tindakan sensitif</small></div>
                <div className="cx-form-grid">
                  <div className="cx-full-span">
                    <Field label="Reset Password" hint="Kosongkan bila tidak diubah">
                      <InputWrap><input type="text" value={userForm.password} onChange={(e) => updateUserForm("password", e.target.value)} placeholder="min. 6 karakter" /></InputWrap>
                    </Field>
                  </div>
                </div>
              </div>
              <div className="cx-form-divider">RINGKASAN <small>bergabung {formatDate(userForm.createdAt)} · total top up {formatPrice(userForm.topupTotal)}</small></div>
              {apiError && <p className="cx-form-error">{apiError}</p>}
            </div>
            <div className="cx-modal-footer">
              <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={closeUserForm}>Batal</button>
              <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={saveUser} disabled={savingUser}>
                {savingUser ? "Menyimpan..." : "Simpan Perubahan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form modal */}
      {form && (
        <div className="cx-modal-backdrop cx-admin-modal-backdrop" onClick={() => setForm(null)}>

          <div className="cx-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cx-modal-header">
              <h2>{form.id ? "Edit Produk" : "Tambah Produk Baru"}</h2>
              <button className="cx-icon-btn" onClick={() => setForm(null)}><X size={14} /></button>
            </div>
            <div className="cx-modal-body">
              <div className="cx-tpl-bar">
                <div className="cx-tpl-bar-head">
                  <strong><Sparkles size={12} /> Template produk</strong>
                  <small>Isi otomatis judul, deskripsi, catatan & cara mengamankan akun — harga/email/password tinggal diganti.</small>
                </div>
                <div className="cx-tpl-list">
                  {PRODUCT_TEMPLATES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="cx-tpl-btn"
                      onClick={() => applyTemplate(t)}
                    >
                      <ProviderIcon type={t.icon} size={16} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="cx-form-grid">
                <div className="cx-full-span">
                  <Field label="Judul Produk">
                    <InputWrap><input value={form.title} onChange={(e) => updateForm("title", e.target.value)} placeholder="cth. Netflix Premium 1 Bulan" /></InputWrap>
                  </Field>
                </div>
                <div className="cx-full-span">
                  <Field label="Deskripsi">
                    <InputWrap><textarea value={form.description} onChange={(e) => updateForm("description", e.target.value)} placeholder="Deskripsi singkat produk..." /></InputWrap>
                  </Field>
                </div>
                <Field label="Tipe Login">
                  <InputWrap>
                    <select value={form.loginType} onChange={(e) => updateForm("loginType", e.target.value)}>
                      {LOGIN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </InputWrap>
                </Field>
                <Field label="Harga default per akun (IDR)" hint="Dipakai untuk akun yang harganya dikosongkan">
                  <InputWrap><input type="number" value={form.price} onChange={(e) => updateForm("price", e.target.value)} placeholder="35000" /></InputWrap>
                </Field>
                <Field label="Stok (otomatis dari jumlah akun)">
                  <InputWrap><input value={(form.accounts || []).filter((a) => a.email || a.password).length} readOnly /></InputWrap>
                </Field>
                <Field label="Harga aged otomatis" hint="Harga naik sendiri sesuai umur akun (tanggal buat akun)">
                  <InputWrap>
                    <select value={form.agedPricing === false ? "off" : "on"} onChange={(e) => updateForm("agedPricing", e.target.value === "on")}>
                      <option value="on">Aktif (harga + bonus umur)</option>
                      <option value="off">Nonaktif (harga tetap)</option>
                    </select>
                  </InputWrap>
                </Field>
                <Field label="Status">
                  <InputWrap>
                    <select value={form.status} onChange={(e) => updateForm("status", e.target.value)}>
                      <option value="available">Tersedia</option>
                      <option value="sold">Habis</option>
                    </select>
                  </InputWrap>
                </Field>
              </div>
              <div className="cx-form-divider">DATA AKUN <small>1 baris = 1 stok · harga dasar + tanggal buat akun (harga aged otomatis)</small></div>
              <div className="cx-account-editor">
                {(form.accounts || []).map((account, index) => (
                  <div className="cx-account-row" key={index}>
                    <span className="cx-account-no">#{index + 1}</span>
                    <InputWrap>
                      <input
                        value={account.email}
                        onChange={(e) => updateAccount(index, "email", e.target.value)}
                        placeholder="user@email.com"
                      />
                    </InputWrap>
                    <InputWrap>
                      <input
                        type={revealed ? "text" : "password"}
                        value={account.password}
                        onChange={(e) => updateAccount(index, "password", e.target.value)}
                        placeholder="••••••••"
                      />
                      <button type="button" onClick={() => setRevealed((v) => !v)} style={{ color: "var(--muted)", background: "none", border: 0, cursor: "pointer", padding: 0 }}>
                        {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </InputWrap>
                    <InputWrap>
                      <input
                        type="number"
                        value={account.price ?? ""}
                        onChange={(e) => updateAccount(index, "price", e.target.value)}
                        placeholder={String(form.price || "Harga")}
                      />
                    </InputWrap>
                    <InputWrap>
                      <input
                        type="date"
                        value={account.createdAt || ""}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => updateAccount(index, "createdAt", e.target.value)}
                        title="Tanggal akun dibuat"
                      />
                    </InputWrap>
                    <div className="cx-admin-aged">
                      {(() => {
                        const base = Number(account.price) > 0 ? Number(account.price) : Number(form.price) || 0;
                        const info = form.agedPricing === false ? { bonus: 0, label: "Harga tetap", days: null } : agedInfoOf(account.createdAt, agedCfg);
                        return (
                          <>
                            <strong>{formatPrice(base + info.bonus)}</strong>
                            <span>{info.label || "Isi tanggal buat akun"}{info.bonus ? ` · +${formatPrice(info.bonus)}` : ""}</span>
                          </>
                        );
                      })()}
                    </div>
                    <button
                      type="button"
                      className="cx-icon-btn"
                      onClick={() => removeAccount(index)}
                      disabled={(form.accounts || []).length <= 1}
                      aria-label={`Hapus akun #${index + 1}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={addAccount}>
                  <Plus size={11} /> Tambah data akun
                </button>
              </div>
              <div className="cx-form-grid" style={{ marginTop: 12 }}>
                <div className="cx-full-span">
                  <Field label="Detail Pengiriman">
                    <InputWrap><textarea value={form.deliveryDetails || ""} onChange={(e) => updateForm("deliveryDetails", e.target.value)} placeholder="Info tambahan yang dikirim ke pembeli setelah bayar..." /></InputWrap>
                  </Field>
                </div>
              </div>
              {apiError && <p style={{ color: "var(--red)", fontSize: 11, marginTop: 8 }}>{apiError}</p>}
            </div>
            <div className="cx-modal-footer">
              <button className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setForm(null)}>Batal</button>
              <button className="cx-btn cx-btn-primary cx-btn-sm" onClick={save} disabled={saving}>
                {saving ? <><RefreshCw size={11} /> Menyimpan...</> : <><Check size={11} /> {form.id ? "Simpan Perubahan" : "Tambah Produk"}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <AssistantWidget open={asstOpen} onOpenChange={setAsstOpen} hideFab scope="admin" />
      {confirmDialog}
    </div>
  );
}

export default AdminPage;
