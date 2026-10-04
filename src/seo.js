/* ═══════════════════════════════════════════════════
   SEO — meta tag dinamis per halaman (SPA)
   Dipakai oleh App: useEffect(() => applySeo(activePage), [activePage])
════════════════════════════════════════════════════ */
export const SITE_URL = "https://akuninstan.com";
export const SITE_NAME = "Akun Instan";

const PAGE_SEO = {
  store: {
    path: "/",
    title: "Akun Instan - Marketplace Akun Digital",
    description:
      "Jual beli akun Gmail fresh/no-PVA, custom Gmail sesuai nama, dan akun digital lainnya. Proses instan, harga murah, stok real-time, garansi login.",
    keywords:
      "jual akun gmail, beli akun gmail, jual gmail fresh, gmail fresh, custom gmail, jual akun google, beli akun google, jual email, akun digital murah",
  },
  katalog: {
    path: "/katalog",
    title: "Katalog Akun Digital — Google, Gmail, Game & Social Media | Akun Instan",
    description:
      "Lihat katalog lengkap akun digital Akun Instan: akun Google/Gmail siap pakai, akun game, dan akun social media. Stok real-time, harga transparan.",
    keywords:
      "katalog akun digital, jual akun gmail, jual akun game, jual akun social media, harga akun google",
  },
  "custom-email": {
    path: "/custom-email",
    title: "Custom Email Gmail Sesuai Nama Sendiri — Cek Ketersediaan | Akun Instan",
    description:
      "Pesan akun Gmail dengan nama pilihanmu sendiri. Cek ketersediaan nama otomatis, pembuatan dibantu tim Akun Instan, aktif dan siap dipakai.",
    keywords:
      "custom email gmail, buat akun gmail sesuai nama, jasa buat akun google, pesan gmail custom",
  },
  topup: {
    path: "/topup",
    title: "Top Up Saldo Akun Instan — QRIS, E-Wallet & Transfer Bank",
    description:
      "Isi saldo Akun Instan lewat QRIS, e-wallet (DANA, OVO, GoPay, ShopeePay) atau transfer bank. Saldo langsung bisa dipakai untuk membeli akun digital.",
    keywords: "top up saldo akun instan, bayar qris, e-wallet, transfer bank",
    noindex: true,
  },
  help: {
    path: "/help",
    title: "Bantuan & FAQ Akun Instan — Cara Beli Akun Digital",
    description:
      "Panduan lengkap cara membeli akun Google/Gmail dan akun digital lain di Akun Instan, metode pembayaran, garansi, dan cara klaim bantuan.",
    keywords: "cara beli akun gmail, faq akun instan, bantuan akun digital",
  },
  faq: {
    path: "/faq",
    title: "FAQ — Pertanyaan Seputar Beli Akun Google & Gmail | Akun Instan",
    description:
      "Kumpulan jawaban lengkap seputar pembelian akun Google/Gmail, pembayaran QRIS & e-wallet, garansi, refund, dan custom email di Akun Instan.",
    keywords: "faq akun instan, pertanyaan beli akun gmail, garansi akun google, refund akun digital",
  },
  "cara-beli": {
    path: "/cara-beli",
    title: "Cara Beli Akun Google & Gmail di Akun Instan — Panduan Lengkap",
    description:
      "Panduan langkah demi langkah membeli akun Google/Gmail di Akun Instan: isi saldo, pilih akun, bayar pakai saldo, dan ambil detail login secara instan.",
    keywords: "cara beli akun google, cara beli akun gmail, tutorial beli akun digital",
  },
  "produk/gmail-fresh": {
    path: "/produk/gmail-fresh",
    title: "Jual Akun Gmail Fresh No-PVA Murah — Harga Mulai Rp5.000 | Akun Instan",
    description:
      "Jual akun Gmail fresh (no-PVA) baru, belum terikat nomor, dikirim instan. Jumlah akun sesuai jumlah yang dibeli, harga makin murah untuk pembelian banyak.",
    keywords: "jual akun gmail fresh, gmail fresh murah, akun gmail no pva, beli gmail baru, jual email gmail",
  },
  "produk/custom-gmail": {
    path: "/produk/custom-gmail",
    title: "Custom Gmail Sesuai Nama Sendiri — Cek Nama & Pesan | Akun Instan",
    description:
      "Pesan akun Gmail custom dengan nama atau username pilihanmu. Cek ketersediaan nama otomatis, akun dibuat manual oleh tim Akun Instan dan siap dipakai.",
    keywords: "custom gmail, jual custom gmail, buat gmail sesuai nama, jasa buat akun gmail, gmail nama sendiri",
  },
  "produk/gmail-aged": {
    path: "/produk/gmail-aged",
    title: "Jual Akun Gmail Aged (Akun Lama) — Harga Sesuai Umur Akun | Akun Instan",
    description:
      "Jual akun Gmail aged/tua dengan umur transparan dan harga otomatis mengikuti usia akun. Stok real-time, detail login dikirim instan, garansi login.",
    keywords: "jual gmail aged, akun gmail lama, gmail tua, beli gmail aged, akun gmail berumur",
  },
  "produk/akun-game": {
    path: "/produk/akun-game",
    title: "Jual Akun Game Murah & Aman — Kirim Instan | Akun Instan",
    description:
      "Jual akun game siap pakai dengan stok real-time, harga transparan, dan detail login dikirim instan setelah pembayaran. Garansi login sesuai kebijakan refund.",
    keywords: "jual akun game, beli akun game murah, akun game siap pakai, jual akun game aman",
  },
  "produk/akun-social-media": {
    path: "/produk/akun-social-media",
    title: "Jual Akun Social Media Siap Pakai — Harga Murah | Akun Instan",
    description:
      "Jual akun social media siap pakai untuk promosi dan pengelolaan konten. Keterangan akun jelas, pengiriman instan, harga transparan, garansi login.",
    keywords: "jual akun social media, beli akun sosmed, akun instagram tiktok, jual akun sosmed murah",
  },
  terms: { path: "/terms", title: "Syarat & Ketentuan | Akun Instan", description: "Syarat dan ketentuan penggunaan layanan Akun Instan." },
  privacy: { path: "/privacy", title: "Kebijakan Privasi | Akun Instan", description: "Kebijakan privasi dan perlindungan data pengguna Akun Instan." },
  refund: { path: "/refund", title: "Kebijakan Refund | Akun Instan", description: "Ketentuan pengembalian dana dan garansi produk akun digital Akun Instan." },
  disclaimer: { path: "/disclaimer", title: "Disclaimer | Akun Instan", description: "Disclaimer layanan Akun Instan." },
  orders: { path: "/orders", title: "Pesanan Saya | Akun Instan", description: "Riwayat pesanan akun digital kamu di Akun Instan.", noindex: true },
  notifications: { path: "/notifications", title: "Notifikasi | Akun Instan", description: "Semua notifikasi akun Akun Instan kamu.", noindex: true },
  reports: { path: "/reports", title: "Laporan Saya | Akun Instan", description: "Status laporan dan balasan admin untuk akun Akun Instan kamu.", noindex: true },
  account: { path: "/account", title: "Akun Saya | Akun Instan", description: "Kelola profil dan saldo akun Akun Instan kamu.", noindex: true },
  admin: { path: "/admin", title: "Admin | Akun Instan", description: "Panel admin Akun Instan.", noindex: true },
  login: { path: "/login", title: "Masuk ke Akun Instan", description: "Masuk ke akun Akun Instan untuk mengakses katalog, saldo, dan riwayat pesanan kamu.", noindex: true },
  verify: { path: "/email-verifikasi", title: "Verifikasi Email — Akun Instan", description: "Konfirmasi alamat email kamu untuk mengaktifkan akun Akun Instan.", noindex: true },
  verifystatus: { path: "/status-verifikasi", title: "Status Verifikasi Email — Akun Instan", description: "Status verifikasi alamat email akun Akun Instan kamu.", noindex: true },
  forgot: { path: "/lupa-password", title: "Lupa Password — Akun Instan", description: "Reset password akun Akun Instan lewat link yang dikirim ke email kamu.", noindex: true },
  reset: { path: "/reset-password", title: "Buat Password Baru — Akun Instan", description: "Buat password baru untuk akun Akun Instan kamu.", noindex: true },
  register: { path: "/register", title: "Daftar Akun Instan", description: "Buat akun Akun Instan untuk membeli akun digital dan mengisi saldo.", noindex: true },
};

const setMeta = (attr, key, content) => {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const setLink = (rel, href) => {
  if (typeof document === "undefined") return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const setJsonLd = (id, data) => {
  if (typeof document === "undefined") return;
  let el = document.getElementById(id);
  if (!data) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
};

export function applySeo(page) {
  const seo = PAGE_SEO[page] || PAGE_SEO.store;
  const url = `${SITE_URL}${seo.path}`;
  const image = `${SITE_URL}/icon-512.png`;

  document.title = seo.title;
  setMeta("name", "description", seo.description);
  if (seo.keywords) setMeta("name", "keywords", seo.keywords);
  setMeta("name", "robots", seo.noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large");
  setLink("canonical", url);

  setMeta("property", "og:type", page === "store" ? "website" : "article");
  setMeta("property", "og:site_name", SITE_NAME);
  setMeta("property", "og:title", seo.title);
  setMeta("property", "og:description", seo.description);
  setMeta("property", "og:url", url);
  setMeta("property", "og:image", image);
  setMeta("property", "og:locale", "id_ID");
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", seo.title);
  setMeta("name", "twitter:description", seo.description);
  setMeta("name", "twitter:image", image);

  setJsonLd(
    "ld-breadcrumb",
    page === "store"
      ? null
      : {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Beranda", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: seo.title.split("—")[0].trim(), item: url },
          ],
        },
  );
}

/* Halaman produk (URL sendiri per listing) → meta + Product schema. */
export function applyProductSeo(product, page) {
  const url = `${SITE_URL}/${String(page || "").replace(/^\/+/, "")}`;
  const name = (product && product.title) || "Detail produk akun digital";
  const stock = product ? Number(product.stock) || (Array.isArray(product.accounts) ? product.accounts.length : 0) : 0;
  const rawDesc = (product && product.description) || "";
  const description = (rawDesc.replace(/\s+/g, " ").trim() ||
    `Beli ${name} di Akun Instan. Jumlah akun sesuai jumlah yang dibeli, detail login dikirim instan setelah pembayaran, garansi login.`).slice(0, 300);
  const title = `${name} — Jual Akun Digital Murah | ${SITE_NAME}`;
  const image = `${SITE_URL}/icon-512.png`;

  document.title = title;
  setMeta("name", "description", description);
  setMeta("name", "keywords", `${name}, jual ${name}, beli ${name}, akun digital murah, akun instan`);
  setMeta("name", "robots", product ? "index, follow, max-image-preview:large" : "noindex, follow");
  setLink("canonical", url);
  setMeta("property", "og:type", "product");
  setMeta("property", "og:site_name", SITE_NAME);
  setMeta("property", "og:title", title);
  setMeta("property", "og:description", description);
  setMeta("property", "og:url", url);
  setMeta("property", "og:image", image);
  setMeta("property", "og:locale", "id_ID");
  setMeta("name", "twitter:card", "summary_large_image");
  setMeta("name", "twitter:title", title);
  setMeta("name", "twitter:description", description);
  setMeta("name", "twitter:image", image);

  setJsonLd("ld-page", product ? {
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description,
    url,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: {
      "@type": "Offer",
      price: Number(product.price) || 0,
      priceCurrency: "IDR",
      url,
      availability: stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  } : null);
}

/* Katalog produk → ItemList schema, dipanggil setelah data produk siap. */
export function applyProductSchema(products) {
  const list = Array.isArray(products) ? products.filter(Boolean).slice(0, 30) : [];
  if (!list.length) { setJsonLd("ld-products", null); return; }
  setJsonLd("ld-products", {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Katalog akun digital Akun Instan",
    itemListElement: list.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Product",
        name: p.title || "Akun digital",
        description: p.description || "Akun digital siap pakai dari Akun Instan.",
        offers: {
          "@type": "Offer",
          price: Number(p.price) || 0,
          priceCurrency: "IDR",
          availability:
            (Number(p.stock) || (Array.isArray(p.accounts) ? p.accounts.length : 0)) > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          url: `${SITE_URL}/katalog`,
        },
      },
    })),
  });
}
