import { useState } from "react";
import { uploadMedia, fmtSize, MAX_MEDIA_BYTES, MAX_MEDIA_FILES } from "./media-attach.jsx";

export default function ManualReportForm({ onSubmitted }) {
  const [f, setF] = useState({ category: "topup", urgency: "sedang", summary: "", detail: "" });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pick = (e) => {
    const list = Array.from(e.target.files || []).filter((x) => /^(image|video)\//.test(x.type) && x.size <= MAX_MEDIA_BYTES);
    setFiles((cur) => [...cur, ...list].slice(0, MAX_MEDIA_FILES));
    e.target.value = "";
  };
  const submit = async (e) => {
    e.preventDefault();
    if (f.summary.trim().length < 5) return setMsg({ err: true, text: "Tulis ringkasan masalah minimal 5 karakter." });
    setBusy(true); setMsg(null);
    try {
      const attachments = [];
      for (const file of files) attachments.push(await uploadMedia(file, "/api/assistant"));
      const res = await fetch("/api/assistant?resource=reports", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, summary: f.summary.trim().slice(0, 600), detail: f.detail.trim().slice(0, 1200), attachments }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Gagal mengirim laporan");
      setMsg({ text: j.activeExists ? `Kamu masih punya laporan aktif (${j.ticket}). Info ini ditambahkan ke tiket itu.` : `Laporan terkirim. Nomor tiket: ${j.ticket}` });
      setF((x) => ({ ...x, summary: "", detail: "" })); setFiles([]);
      onSubmitted?.();
    } catch (err) {
      setMsg({ err: true, text: err.message || "Gagal mengirim laporan" });
    } finally { setBusy(false); }
  };
  return (
    <section className="cx-manual-report cx-ur-compose">
      <h2>Kirim Laporan</h2>
      
      <form onSubmit={submit}>
        <div className="cx-mr-row">
          <label>Kategori
            <select value={f.category} onChange={set("category")}>
              <option value="topup">Top up</option><option value="saldo">Saldo</option><option value="akun">Akun / login</option>
              <option value="produk">Produk</option><option value="refund">Refund</option><option value="lainnya">Lainnya</option>
            </select>
          </label>
          <label>Urgensi
            <select value={f.urgency} onChange={set("urgency")}>
              <option value="rendah">Rendah</option><option value="sedang">Sedang</option><option value="tinggi">Tinggi</option>
            </select>
          </label>
        </div>
        <label>Ringkasan masalah
          <input value={f.summary} onChange={set("summary")} maxLength={600} placeholder="Contoh: Top up Rp50.000 belum masuk" />
        </label>
        <label>Detail (opsional)
          <textarea rows={3} value={f.detail} onChange={set("detail")} maxLength={1200} placeholder="Tanggal, nominal, ID transaksi, dsb." />
        </label>
        <div className="cx-mr-files">
          <label className="cx-btn cx-btn-ghost cx-btn-sm">+ Screenshot/video
            <input type="file" accept="image/*,video/*" multiple hidden onChange={pick} />
          </label>
          {files.map((x, i) => (
            <span key={i} className="cx-mr-chip">{x.name.slice(0, 18)} · {fmtSize(x.size)}
              <button type="button" aria-label="Hapus" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
        {msg && <p className={`cx-mr-msg${msg.err ? " is-err" : ""}`}>{msg.text}</p>}
        <div className="cx-mr-actions">
          <button className="cx-btn cx-btn-primary" disabled={busy}>{busy ? "Mengirim..." : "Kirim laporan"}</button>
        </div>
      </form>
    </section>
  );
}

