import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Play, X } from "lucide-react";

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_MEDIA_FILES = 4;

export const isVideo = (m) => String((m && m.type) || "").startsWith("video/");
export const fmtSize = (n) => {
  const b = Number(n) || 0;
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1024))} KB`;
};

/** Upload satu file langsung ke Vercel Blob (tidak lewat batas 4.5MB function). */
export async function uploadMedia(file, apiUrl, onProgress, abortSignal) {
  const { upload } = await import("@vercel/blob/client");
  const sep = apiUrl.includes("?") ? "&" : "?";
  const clean = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-60) || "file";
  // Tanpa onUploadProgress: progres memaksa upload streaming (fetch duplex) yang
  // macet di banyak browser Android dan terus di-retry tanpa henti.
  const ctrl = new AbortController();
  const timeoutMs = 30000 + Math.ceil(file.size / (256 * 1024)) * 1000;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (abortSignal) abortSignal.addEventListener("abort", onAbort);
  if (onProgress) onProgress(1);
  try {
    const blob = await upload(`assistant/${Date.now()}-${clean}`, file, {
      access: "public",
      handleUploadUrl: `${apiUrl}${sep}resource=upload`,
      contentType: file.type,
      multipart: file.size >= 8 * 1024 * 1024,
      abortSignal: ctrl.signal,
    });
    if (onProgress) onProgress(100);
    return { url: blob.url, type: file.type, name: file.name.slice(0, 120), size: file.size };
  } catch (e) {
    if (timedOut) throw new Error("Upload terlalu lama, cek koneksi lalu coba lagi");
    throw e;
  } finally {
    clearTimeout(timer);
    if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
  }
}

/** Grid lampiran rapi + lightbox untuk lihat ukuran penuh. */
export function MediaGrid({ items, className = "" }) {
  const [view, setView] = useState(null);
  const list = (items || []).filter((m) => m && (m.url || m.preview));
  useEffect(() => {
    if (!view) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setView(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);
  if (!list.length) return null;
  return (
    <>
      <div className={`cx-media-grid n${Math.min(list.length, 4)} ${className}`}>
        {list.map((m, i) => (
          <button type="button" key={i} className="cx-media-tile" onClick={() => setView(m)} aria-label="Lihat lampiran">
            {isVideo(m)
              ? <><video src={m.url || m.preview} muted playsInline preload="metadata" /><span className="cx-media-play"><Play size={14} /></span></>
              : <img src={m.url || m.preview} alt={m.name || "lampiran"} loading="lazy" />}
          </button>
        ))}
      </div>
      {view && createPortal(
        <div className="cx-media-lightbox" onClick={() => setView(null)}>
          <button type="button" className="cx-media-close" onClick={() => setView(null)} aria-label="Tutup"><X size={16} /></button>
          <div className="cx-media-stage" onClick={(e) => e.stopPropagation()}>
            {isVideo(view)
              ? <video src={view.url || view.preview} controls autoPlay playsInline />
              : <img src={view.url || view.preview} alt={view.name || "lampiran"} />}
            {view.name && <small>{view.name}{view.size ? ` · ${fmtSize(view.size)}` : ""}</small>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
