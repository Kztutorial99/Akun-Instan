/** Bantuan AI sekali tanya untuk pembeli yang mengamankan akun Google. Tidak disimpan. */
const GUIDE = `PANDUAN SERAH TERIMA AKUN GOOGLE AKUNINSTAN:
1. Login memakai email & password yang diterima.
2. Ganti password di https://myaccount.google.com/signinoptions/password
3. Ganti email & nomor pemulihan menjadi milik pembeli sendiri (https://myaccount.google.com/security).
4. Keluarkan semua perangkat lain di https://myaccount.google.com/device-activity
5. Cek & cabut akses aplikasi pihak ketiga di https://myaccount.google.com/permissions
6. Aktifkan verifikasi dua langkah (https://myaccount.google.com/signinoptions/two-step-verification).
Garansi login 1x24 jam sejak pembelian. Masalah di luar panduan / garansi: hubungi admin AkunInstan lewat menu Laporan.`;

async function askGoogleHelp(question, images = [], order = null) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { status: 500, error: "Bantuan AI belum aktif" };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra", stream: true, store: false, reasoning: { effort: "low" },
      instructions: `Kamu asisten AkunInstan yang membantu pembeli mengamankan akun Google yang baru dibeli. Jawab hanya berdasarkan panduan berikut dan pengetahuan umum keamanan akun Google. Bahasa Indonesia santai, ringkas, berupa langkah bernomor (maks 6). Jangan pernah meminta password atau kode verifikasi. Jika pertanyaan di luar topik akun Google, tolak singkat. PENTING — tulis jawaban TANPA format markdown sama sekali: dilarang pakai tanda bintang (**), pagar (#), atau backtick. Tulis teks polos rapi dengan langkah bernomor. Jika akun bermasalah (diminta kode verifikasi/kode pemulihan saat login, akun ditangguhkan, atau tidak bisa login sama sekali), selalu tutup jawaban dengan baris: "Metode lain: klik tombol Minta kode login di bawah — kode pemulihan akan dikirim ke email support@akuninstan.com lalu admin meneruskannya ke kamu. Kalau masih mentok, klik Teruskan ke admin."\n\n${GUIDE}`,
      input: [{ role: "user", content: [
        { type: "input_text", text: `${order ? `DETAIL PESANAN: ID ${order.id}, produk "${order.product}", dibeli ${order.createdAt}, akun ${order.email || "-"}.\n` : ""}KENDALA PEMBELI: ${question}${images.length ? `\n(${images.length} tangkapan layar terlampir — baca pesan/error di gambar untuk mengidentifikasi masalah.)` : ""}\n\nFormat jawaban: baris pertama "Masalah: <identifikasi singkat>", lalu langkah perbaikan bernomor.` },
        ...images.map((u) => ({ type: "input_image", image_url: u })),
      ] }],
    }),
  });
  if (!res.ok) {
    if (res.status === 402) return { status: 402, error: "Bantuan AI sedang tidak tersedia. Hubungi admin." };
    if (res.status === 429) return { status: 429, error: "Terlalu banyak pertanyaan, coba lagi sebentar." };
    return { status: res.status, error: `Bantuan AI gagal (${res.status})` };
  }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = "", out = "", failed = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "response.output_text.delta") out += ev.delta || "";
        else if (ev.type === "response.refusal.delta") failed = "Pertanyaan ini tidak bisa dijawab.";
        else if (ev.type === "error" || ev.type === "response.failed") failed = "Bantuan AI gagal, coba lagi nanti.";
      } catch (_) {}
    }
  }
  if (failed || !out.trim()) return { status: 502, error: failed || "Bantuan AI tidak memberi jawaban." };
  return { status: 200, answer: out.trim() };
}
module.exports = { askGoogleHelp };
