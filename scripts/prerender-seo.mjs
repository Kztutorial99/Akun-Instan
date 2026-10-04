// Membuat HTML statis per halaman (title, description, canonical, H1, H2 unik) agar crawler tidak melihat duplikat.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = path.join(os.tmpdir(), `seo-${Date.now()}.mjs`);
fs.writeFileSync(tmp, fs.readFileSync(path.join(root, "src/seo.js"), "utf8") + "\nexport { PAGE_SEO };\n");
const { PAGE_SEO, SITE_URL } = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
const outDir = path.join(root, "dist/_seo");
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
for (const [key, seo] of Object.entries(PAGE_SEO)) {
  if (seo.noindex || seo.path === "/") continue;
  const url = SITE_URL + seo.path;
  const t = esc(seo.title), d = esc(seo.description);
  const h1 = esc(seo.h1 || seo.title.split(/ [|—-] /)[0]);
  const h2 = esc(seo.h2 || seo.description.split(". ")[0]);
  let html = base
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${d}$2`)
    .replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${h1}</h1>`)
    .replace(/<h2 id="seo-h2">[\s\S]*?<\/h2>/, `<h2 id="seo-h2">${h2}</h2>`);
  if (seo.keywords) html = html.replace(/(<meta name="keywords" content=")[^"]*(")/, `$1${esc(seo.keywords)}$2`);
  fs.writeFileSync(path.join(outDir, `${key.replace(/\//g, "-")}.html`), html);
  n++;
}
console.log(`prerender-seo: ${n} halaman dibuat`);
