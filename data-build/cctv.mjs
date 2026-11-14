// Mengubah berkas kamera CCTV lalu lintas (disalin sendiri ke var/src/trafik/, TIDAK ada di repo) menjadi
// var/static/tokyo/cctv-v1.json: format ringkas yang dibaca web/src/tokyo/cctv.js.
// Skrip ini tidak mengunduh apa pun. Berkas sumber tidak ada = dilewati (exit 0): CCTV opsional.
// Dijalankan setelah jakarta.mjs (yang mengosongkan folder keluaran dan menulis packs.json).
// Pakai: bun data-build/cctv.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC_DIR = 'var/src/trafik', OUT = 'var/static/tokyo';
// Kotak Jabodetabek + Puncak; kamera di luar kotak ini dibuang (koordinat salah lebih buruk daripada tidak ada pin)
export const BOX = { latMin: -7.0, latMax: -5.9, lngMin: 106.3, lngMax: 107.4 };

/** URL https yang sah, atau '' (URL ini menjadi href / src di halaman: hanya https yang boleh lewat). */
const https = (u) => { try { const x = new URL(u); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; } };

/**
 * Berkas sumber -> pack. Murni (tanpa berkas), supaya bisa diuji.
 * pack = { v, built, checkedAt, sources: {kode: {name, owner, page, n}}, hosts: [origin stream HLS],
 *          cams: [{ id, src, kind, name, sub, lat, lng, views: [[label, urlHls | '', urlHalamanPemilik]] }] }
 * urlHls '' = hanya tautan: view berjenis 'frame' (YouTube, halaman embed) tidak diputar di dalam halaman.
 * Kamera `offline` di sumber dan view tanpa tautan pemilik dibuang.
 */
export function buildCctv(src, built = new Date().toISOString()) {
  const sources = {}, hosts = new Set(), cams = [], dropped = [], ids = new Set();
  for (const [k, s] of Object.entries(src.sources || {})) {
    const page = https(s?.page);
    if (s?.owner && page) sources[k] = { name: String(s.name || s.owner), owner: String(s.owner), page, n: 0 };
  }
  for (const c of src.cams || []) {
    const lat = Number(c.lat), lng = Number(c.lng);
    const views = [];
    for (const v of Array.isArray(c.views) ? c.views : []) {
      const page = https(v[2]);
      if (!page || v[3] === 'off') continue;
      const hls = v[3] == null && /\.m3u8($|\?)/.test(String(v[1])) ? https(v[1]) : '';
      views.push([String(v[0] || ''), hls, page]);
    }
    const why = !c.id || ids.has(c.id) ? 'id' : !sources[c.src] ? 'sumber' : !c.name ? 'nama'
      : !(lat >= BOX.latMin && lat <= BOX.latMax && lng >= BOX.lngMin && lng <= BOX.lngMax) ? 'koordinat' : !views.length ? 'tautan' : '';
    if (why) { dropped.push(`${c.id || '?'} (${why})`); continue; }
    ids.add(c.id);
    for (const v of views) if (v[1]) hosts.add(new URL(v[1]).origin);   // hanya host kamera yang diterima: masuk ke CSP
    sources[c.src].n++;
    cams.push({ id: String(c.id), src: c.src, kind: String(c.kind || ''), name: String(c.name), sub: String(c.sub || ''),
      lat: +lat.toFixed(5), lng: +lng.toFixed(5), views });
  }
  return { pack: { v: 1, built, checkedAt: src.checkedAt || null, sources, hosts: [...hosts].sort(), cams }, dropped };
}

if (import.meta.main) {
  const file = existsSync(SRC_DIR) ? readdirSync(SRC_DIR).filter((f) => /^asset-cctv-[A-Z0-9]+\.json$/.test(f)).sort()[0] : null;
  if (!file) {
    console.log(`CCTV dilewati: tidak ada ${SRC_DIR}/asset-cctv-*.json (lapisan CCTV opsional; halaman jalan tanpa itu).`);
    process.exit(0);
  }
  if (!existsSync(`${OUT}/packs.json`)) {
    console.error(`CCTV TIDAK dibangun: ${OUT}/packs.json belum ada. Jalankan dulu: bun data-build/jakarta.mjs`);
    process.exit(1);
  }
  const { pack, dropped } = buildCctv(JSON.parse(readFileSync(`${SRC_DIR}/${file}`, 'utf8')));
  const text = JSON.stringify(pack);
  writeFileSync(`${OUT}/cctv-v1.json`, text);
  const packs = JSON.parse(readFileSync(`${OUT}/packs.json`, 'utf8'));
  packs.files = [...new Set([...packs.files, 'cctv-v1.json'])];
  writeFileSync(`${OUT}/packs.json`, JSON.stringify(packs));
  const nViews = pack.cams.reduce((n, c) => n + c.views.length, 0), nHls = pack.cams.reduce((n, c) => n + c.views.filter((v) => v[1]).length, 0);
  console.log(`${OUT}/cctv-v1.json: ${pack.cams.length} kamera, ${nViews} sudut (${nHls} HLS, ${nViews - nHls} tautan saja), ${pack.hosts.length} host stream, ${(text.length / 1e3).toFixed(0)} kB; dibuang ${dropped.length}${dropped.length ? ` (${dropped.slice(0, 8).join(', ')})` : ''}`);
  console.log(`  per sumber: ${Object.entries(pack.sources).filter(([, s]) => s.n).map(([k, s]) => `${k} ${s.n}`).join(', ')}; diperiksa sumbernya ${pack.checkedAt || 'tidak diketahui'}`);
}
