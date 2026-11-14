// Ketinggian rel per jalur (layang / permukaan / bawah tanah) dari tag OpenStreetMap, untuk tampilan 3D dan garis
// terowongan/viaduk di peta 2D. Keluaran: var/static/tokyo/elev-v1.json + elev-latest.json (format yang dibaca
// web/src/layers/city3d/elevation.js dan web/src/tokyo/network-layer.js):
//   { lines: { <idJalur>: [[dariM, sampaiM, meter], ...] }, len: { <idJalur>: panjangM } }
//   meter > 0 = di atas tanah (viaduk), < 0 = terowongan; celah = di permukaan.
// Sumber: way rel OSM dengan tag bridge / tunnel / layer (ODbL), disimpan di var/src/osm/rail.json. Berkas itu tidak
// ada = dilewati (exit 0): halaman tetap jalan dengan heuristik lama (enam stasiun MRT bawah tanah).
// Dijalankan setelah jakarta.mjs (yang mengosongkan folder keluaran dan menulis packs.json).
// Pakai: bun data-build/elev.mjs            (membaca var/src/osm/rail.json)
//        bun data-build/elev.mjs --fetch    (mengunduh dulu: SATU kueri Overpass, ±3 MB; jangan diulang-ulang)
// Catatan metode dan sumber per jalur: docs/ELEVASI.md
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { segLen, unpackNet } from '../web/src/tokyo/net.js';

const OSM_FILE = 'var/src/osm/rail.json', OUT = 'var/static/tokyo';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
// kotak yang memuat semua jalur di network-v1.json (Rangkasbitung sampai Cikampek, Jakarta Kota sampai Sukabumi)
export const QUERY = '[out:json][timeout:180];way[railway~"^(rail|subway|light_rail)$"](-6.95,106.2,-6.05,107.5);out tags geom qt;';

// Meter: OSM tidak memuat tinggi. Yang dipakai nilai bawaan kode web (VIADUCT_M 12, DEPTH_M -18 di elevation.js),
// ditambah H_LAYER per tingkat tag `layer` di atas 2 supaya viaduk yang saling melintas tidak berpotongan.
// Semuanya PERKIRAAN (lihat docs/ELEVASI.md); hanya urutan tingkatnya yang bersumber.
export const H_VIADUCT = 12, H_TUNNEL = -18, H_LAYER = 5;
const STEP = 20;            // m antar titik contoh di sepanjang jalur
const R_MATCH = 45;         // m: rel OSM sejauh ini masih dianggap rel jalur itu (lintasan sumber kita kasar, titik tiap ±80 m)
const COS_MIN = 0.85;       // rel yang berbelok lebih dari ±30° terhadap jalur = rel lain
const GAP_FILL = 200;       // m: rel tanpa tag di antara dua ruas jembatan/terowongan ikut ruas itu (rel stasiun)
const VIADUCT_SPAN = 300;   // m: jembatan KRL/KA lebih pendek dari ini = jembatan sungai/jalan, tetap di permukaan
const MIN_TUNNEL = 150;     // m: terowongan KRL/KA lebih pendek dari ini = lewat bawah jalan/bangunan, tetap di permukaan
const MIN_LEVEL_RUN = 250;  // m: perubahan `layer` lebih pendek dari ini = detail pemetaan, bukan tingkat baru
// Lintasan sumber kita melewati rel bawah Stasiun Manggarai, padahal KRL Lin Bogor memakai rel atas (jalur 10-13,
// sejak 25 September 2021; https://en.wikipedia.org/wiki/Manggarai_railway_station). Di sekitar titik ini jalur
// berawalan itu memilih rel layang OSM terdekat walau ada rel permukaan yang lebih dekat.
export const PREFER_UP = [{ prefix: 'krl.Bogor.', lng: 106.8498, lat: -6.21, r: 1200 }];
// Sisi jalan kereta per sistem: 1 = kereta berjalan di rel KANAN menurut arah jalannya, -1 = kiri. Sumber tertulis:
// Wikipedia "Double-track railway" ("In Indonesia, right-hand running for railways (including LRT and MRT systems)") dan
// "Jakarta MRT" ("Trains run on the right to match Indonesian railways"). Untuk KRL, KA antarkota, dan kedua LRT cocok
// dengan arah way OSM (railway:preferred_direction); MRT tidak bertag arah di OSM. Rinciannya di docs/REL.md.
export const HAND = { mrt: 1, lrtj: 1, jbdb: 1, krl: 1, kai: 1 };
export const KIND = { mrt: 'subway', lrtj: 'light_rail', jbdb: 'light_rail', krl: 'rail', kai: 'rail' };   // awalan id jalur -> railway=*

/** Tingkat sebuah way: -1 terowongan, 0 permukaan, n >= 1 layang (nilai tag layer, minimal 1). */
export function levelOf(tags = {}) {
  const layer = Number(tags.layer) || 0;
  if (tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage') return -1;
  if (tags.bridge && tags.bridge !== 'no') return Math.max(1, layer);
  return layer >= 1 ? layer : 0;                       // rel stasiun layang sering dipetakan tanpa bridge=yes
}
export const metres = (level) => (level < 0 ? H_TUNNEL : H_VIADUCT + H_LAYER * Math.max(0, level - 2));

/** Indeks ruas rel OSM per jenis (railway=*) dalam meter lokal. near(kind, x, y) = ruas [x0, y0, x1, y1, tingkat, arah, relUtama] di sel
 * (100 m) titik itu dan delapan sel di sekitarnya (ruas panjang bisa muncul lebih dari sekali). Rel kereta cepat dan rel langsir dibuang. */
export function indexWays(ways) {
  const LAT0 = -6.4, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KY = 110574, CELL = 100;
  const xy = (lng, lat) => [lng * KX, lat * KY];
  const grid = new Map();                              // 'kind:cx:cy' -> [[x0, y0, x1, y1, tingkat], ...]
  for (const w of ways) {
    const t = w.tags || {}, g = w.geometry || [];
    if (!KIND_SET.has(t.railway) || t.highspeed === 'yes' || ['yard', 'siding', 'spur'].includes(t.service)) continue;
    const lv = levelOf(t);
    // arah jalan way (railway:preferred_direction): 1 = searah urutan titiknya, -1 = berlawanan, 0 = dua arah / tidak ditandai
    const pd = t['railway:preferred_direction'] === 'forward' ? 1 : t['railway:preferred_direction'] === 'backward' ? -1 : 0;
    const main = t.service ? 0 : 1;                       // 0 = wesel silang / rel depo: bukan rel utama
    for (let i = 1; i < g.length; i++) {
      const [x0, y0] = xy(g[i - 1].lon, g[i - 1].lat), [x1, y1] = xy(g[i].lon, g[i].lat);
      const seg = [x0, y0, x1, y1, lv, pd, main];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / CELL));
      const seen = new Set();
      for (let k = 0; k <= n; k++) {
        const key = `${t.railway}:${Math.floor((x0 + (x1 - x0) * k / n) / CELL)}:${Math.floor((y0 + (y1 - y0) * k / n) / CELL)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(seg);
      }
    }
  }
  const near = (kind, x, y) => {
    const out = [], cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = grid.get(`${kind}:${cx + i}:${cy + j}`); if (l) out.push(...l); }
    return out;
  };
  return { xy, unxy: (x, y) => [x / KX, y / KY], near };
}

/**
 * Murni (tanpa berkas), supaya bisa diuji. net = hasil unpackNet (lines[].id/path/length); ways = elemen Overpass
 * ({ tags, geometry: [{lat, lon}] }). Hasil: { lines, len, report: [{ id, matched, runs: [[dariM, sampaiM, tingkat]], dropped: [...] }] }.
 */
export function buildElev(net, ways) {
  const { xy, near } = indexWays(ways);
  const nearest = (kind, x, y, ux, uy, up) => {        // tingkat rel terdekat yang searah, atau null; up = utamakan rel layang
    let best = null, bd = R_MATCH, bestUp = null, bu = R_MATCH;
    for (const [x0, y0, x1, y1, lv] of near(kind, x, y)) {
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
      if (Math.abs(dx * ux + dy * uy) / Math.sqrt(l2) < COS_MIN) continue;
      const f = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
      const d = Math.hypot(x - x0 - dx * f, y - y0 - dy * f);
      if (d < bd) { bd = d; best = lv; }
      if (up && lv > 0 && d < bu) { bu = d; bestUp = lv; }
    }
    return bestUp ?? best;
  };
  const lines = {}, len = {}, report = [];
  for (const line of net.lines) {
    const kind = KIND[String(line.id).split('.')[0]];
    if (!kind || !(line.path?.length > 1)) continue;
    const P = line.path.map(([lng, lat]) => xy(lng, lat));
    const ups = PREFER_UP.filter((u) => String(line.id).startsWith(u.prefix)).map((u) => [...xy(u.lng, u.lat), u.r]);
    const cum = [0];
    for (let i = 1; i < line.path.length; i++) cum.push(cum[i - 1] + segLen(line.path[i - 1], line.path[i]));
    const total = cum.at(-1), k = line.length > 0 ? line.length / total : 1;   // meter lintasan -> meter rantai jalur
    // titik contoh di tengah tiap potongan STEP
    const n = Math.max(1, Math.round(total / STEP)), step = total / n, lv = new Array(n).fill(null);
    for (let s = 0, v = 1; s < n; s++) {
      const m = (s + 0.5) * step;
      while (v < cum.length - 1 && cum[v] < m) v++;
      const f = (m - cum[v - 1]) / (cum[v] - cum[v - 1] || 1), dx = P[v][0] - P[v - 1][0], dy = P[v][1] - P[v - 1][1], l = Math.hypot(dx, dy) || 1;
      const x = P[v - 1][0] + dx * f, y = P[v - 1][1] + dy * f;
      lv[s] = nearest(kind, x, y, dx / l, dy / l, ups.some(([ux, uy, r]) => Math.hypot(x - ux, y - uy) <= r));
    }
    const matched = lv.filter((x) => x !== null).length / n;
    const runs = () => {                               // [awal, akhir (eksklusif), nilai] untuk tiap deret nilai sama
      const out = [];
      for (let s = 0; s < n; s++) { const q = out.at(-1); if (q && q[2] === lv[s]) q[1] = s + 1; else out.push([s, s + 1, lv[s]]); }
      return out;
    };
    const sign = (x) => (x == null ? 0 : Math.sign(x));
    const set = (a, b, v) => { for (let s = a; s < b; s++) lv[s] = v; };
    // 1. celah pendek (tanpa tag / tanpa rel OSM) di antara dua ruas sejenis ikut ruas sebelumnya
    for (let s = 0; s < n;) {
      if (sign(lv[s]) !== 0) { s++; continue; }
      let e = s; while (e < n && sign(lv[e]) === 0) e++;
      if (s > 0 && e < n && sign(lv[s - 1]) === sign(lv[e]) && (e - s) * step <= GAP_FILL) set(s, e, lv[s - 1]);
      s = e;
    }
    // 1b. MRT/LRT: potongan pendek tanpa tag di ujung jalur (rel stasiun ujung, mis. Pegangsaan Dua di bangunan depo) ikut ruas di sebelahnya
    if (kind !== 'rail') {
      const head = lv.findIndex((x) => sign(x) !== 0), tail = n - 1 - [...lv].reverse().findIndex((x) => sign(x) !== 0);
      if (head > 0 && head * step <= GAP_FILL) set(0, head, lv[head]);
      if (head >= 0 && tail < n - 1 && (n - 1 - tail) * step <= GAP_FILL) set(tail + 1, n, lv[tail]);
    }
    for (let s = 0; s < n; s++) if (lv[s] == null) lv[s] = 0;
    // 2. KRL/KA: jembatan dan terowongan pendek tetap di permukaan
    const dropped = [];                                // [dariM, sampaiM, tingkat] yang dibuang, untuk laporan
    if (kind === 'rail') for (let s = 0; s < n;) {
      let e = s; while (e < n && sign(lv[e]) === sign(lv[s])) e++;
      const span = (e - s) * step;
      if ((lv[s] > 0 && span < VIADUCT_SPAN) || (lv[s] < 0 && span < MIN_TUNNEL)) { dropped.push([Math.round(s * step * k), Math.round(e * step * k), lv[s]]); set(s, e, 0); }
      s = e;
    }
    // 3. tingkat yang hanya sebentar di tengah viaduk mengikuti tetangganya
    for (let pass = 0; pass < 4; pass++) {
      const R = runs();
      let changed = false;
      R.forEach(([a, b, v], i) => {
        if (!(v > 0) || (b - a) * step >= MIN_LEVEL_RUN) return;
        const p = R[i - 1], q = R[i + 1], to = p && p[2] > 0 ? p[2] : q && q[2] > 0 ? q[2] : null;
        if (to != null) { set(a, b, to); changed = true; }
      });
      if (!changed) break;
    }
    const R = runs().filter((r) => r[2] !== 0);
    lines[line.id] = R.map(([a, b, v]) => [Math.round(a * step * k), Math.round(b * step * k), metres(v)]);
    len[line.id] = line.length || Math.round(total);
    report.push({ id: line.id, matched, dropped, runs: R.map(([a, b, v]) => [Math.round(a * step * k), Math.round(b * step * k), v]) });
  }
  return { lines, len, report };
}
const KIND_SET = new Set(Object.values(KIND));

if (import.meta.main) {
  if (process.argv.includes('--fetch')) {
    console.log(`Mengunduh rel OSM dari ${OVERPASS} (satu kueri)…`);
    const r = await fetch(OVERPASS, { method: 'POST', headers: { 'User-Agent': 'jaktrack-elev-build/0.1 (peta kereta Jabodetabek; satu kueri tag bridge/tunnel rel)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(QUERY)}` });
    if (!r.ok) { console.error(`Overpass menjawab ${r.status}; coba lagi nanti (jangan diulang-ulang).`); process.exit(1); }
    mkdirSync('var/src/osm', { recursive: true });
    writeFileSync(OSM_FILE, await r.text());
  }
  if (!existsSync(OSM_FILE)) {
    console.log(`Ketinggian dilewati: tidak ada ${OSM_FILE} (jalankan sekali: bun data-build/elev.mjs --fetch). Tanpa itu 3D memakai heuristik: hanya terowongan MRT.`);
    process.exit(0);
  }
  if (!existsSync(`${OUT}/packs.json`)) {
    console.error(`Ketinggian TIDAK dibangun: ${OUT}/packs.json belum ada. Jalankan dulu: bun data-build/jakarta.mjs`);
    process.exit(1);
  }
  const osm = JSON.parse(readFileSync(OSM_FILE, 'utf8'));
  const net = unpackNet(JSON.parse(readFileSync(`${OUT}/network-v1.json`, 'utf8')));
  const { lines, len, report } = buildElev(net, osm.elements || []);
  // jumlah rel sejajar dan sisi jalan per jalur (data-build/snap.mjs tracks): kereta dua arah di relnya masing-masing
  const { snapper } = await import('./snap.mjs');
  const S = snapper(osm.elements || []), tracks = {}, hand = {}, rel = [];
  for (const l of net.lines) {
    const sys = String(l.id).split('.')[0], kind = KIND[sys];
    if (!kind || !(l.path?.length > 1)) continue;
    const t = S.tracks(l.path, kind), votes = t.hand.right + t.hand.left;
    // arah way OSM hanya dipakai sebagai pemeriksa: yang menentukan tabel HAND (bersumber tertulis)
    const osmHand = votes >= 50 ? (t.hand.right >= 0.95 * votes ? 1 : t.hand.left >= 0.95 * votes ? -1 : 0) : 0;
    tracks[l.id] = t.ranges; hand[l.id] = HAND[sys] ?? 0;
    rel.push({ id: l.id, ranges: t.ranges, votes: t.hand, osmHand, hand: hand[l.id], unknown: t.unknown });
  }
  const built = new Date().toISOString();
  const source = { name: 'OpenStreetMap', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', osmBase: osm.osm3s?.timestamp_osm_base || null, query: QUERY };
  const text = JSON.stringify({ v: 'jaktrack-elev-1', built, source, metres: { viaduct: H_VIADUCT, perLayerAbove2: H_LAYER, tunnel: H_TUNNEL, note: 'perkiraan' }, lines, len, tracks, hand });
  writeFileSync(`${OUT}/elev-v1.json`, text);
  writeFileSync(`${OUT}/elev-latest.json`, JSON.stringify({ v: 'jaktrack-elev-1', file: 'elev-v1.json', built, source }));
  const packs = JSON.parse(readFileSync(`${OUT}/packs.json`, 'utf8'));
  packs.files = [...new Set([...packs.files, 'elev-latest.json', 'elev-v1.json'])];
  writeFileSync(`${OUT}/packs.json`, JSON.stringify(packs));

  console.log(`${OUT}/elev-v1.json: ${report.length} jalur, ${(text.length / 1e3).toFixed(1)} kB; OSM per ${source.osmBase || 'tidak diketahui'}`);
  // letak tiap peralihan terhadap stasiun jalur itu, untuk docs/ELEVASI.md
  const where = (line, m) => {
    const st = line.stations.map((si, i) => [line.chain[i], net.stations[si].name.en]).sort((a, b) => a[0] - b[0]);
    const at = st.find(([c]) => Math.abs(c - m) <= 150);
    if (at) return at[1];
    const b = st.findIndex(([c]) => c > m);
    return b <= 0 ? (b === 0 ? `sebelum ${st[0][1]}` : `setelah ${st.at(-1)[1]}`) : `${st[b - 1][1]}/${st[b][1]}`;
  };
  for (const r of report) {
    const line = net.lines.find((l) => l.id === r.id);
    const km = (m) => (m / 1000).toFixed(1);
    const up = r.runs.filter((x) => x[2] > 0).reduce((s, x) => s + x[1] - x[0], 0), down = r.runs.filter((x) => x[2] < 0).reduce((s, x) => s + x[1] - x[0], 0);
    console.log(`  ${r.id.padEnd(22)} cocok ${(r.matched * 100).toFixed(0).padStart(3)}%  layang ${km(up).padStart(5)} km  bawah tanah ${km(down).padStart(4)} km  dari ${km(line.length)} km`);
    for (const [a, b, v] of r.runs) console.log(`      ${v < 0 ? 'terowongan' : `layang L${v}`.padEnd(10)} ${km(a).padStart(5)}–${km(b).padEnd(5)} km  ${metres(v)} m  ${where(line, a)} → ${where(line, b)}`);
    if (r.dropped.length) console.log(`      tetap di permukaan (pendek): ${r.dropped.map(([a, b, v]) => `${v < 0 ? 'terowongan' : 'jembatan'} ${b - a} m di km ${km(a)} (${where(line, a)})`).join('; ')}`);
    // periksa silang dengan tanda bawah tanah stasiun (jakarta.mjs)
    line.stations.forEach((si, i) => {
      const m = line.chain[i], under = r.runs.some(([a, b, v]) => v < 0 && m >= a && m <= b);
      if (under !== net.stations[si].underground) console.warn(`      PERIKSA: ${net.stations[si].name.en} ${under ? 'di terowongan menurut OSM, tetapi tidak ditandai bawah tanah' : 'ditandai bawah tanah, tetapi tidak di terowongan menurut OSM'}`);
    });
  }
  // jumlah rel per jalur (tabel per ruas antarstasiun: bun data-build/elev.mjs --rel, dipakai untuk docs/REL.md)
  console.log('Rel sejajar per jalur (km) dan sisi jalan:');
  const perRuas = process.argv.includes('--rel');
  for (const r of rel) {
    const line = net.lines.find((l) => l.id === r.id), km = {};
    for (const [a, b, n] of r.ranges) { const k = n === 0 ? 'tidak diketahui' : n === 1 ? 'tunggal' : n === 2 ? 'ganda' : '3+'; km[k] = (km[k] || 0) + (b - a) / 1000; }
    const f = (k) => (km[k] || 0).toFixed(1).padStart(5);
    console.log(`  ${r.id.padEnd(22)} tunggal ${f('tunggal')}  ganda ${f('ganda')}  3+ ${f('3+')}  tidak diketahui ${f('tidak diketahui')}  | jalan ${r.hand > 0 ? 'kanan' : r.hand < 0 ? 'kiri' : '?'}; way OSM berarah: kanan ${r.votes.right}, kiri ${r.votes.left}${r.osmHand && r.osmHand !== r.hand ? '  PERIKSA: arah way OSM berlawanan dengan tabel HAND' : ''}`);
    if (!perRuas) continue;
    const st = line.stations.map((si, i) => [line.chain[i], net.stations[si].name.en]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < st.length; i++) {
      const by = {};
      for (const [a, b, n] of r.ranges) { const o = Math.min(b, st[i][0]) - Math.max(a, st[i - 1][0]); if (o > 0) by[n] = (by[n] || 0) + o; }
      const tot = Object.values(by).reduce((x, y) => x + y, 0) || 1, top = Object.entries(by).sort((a, b) => b[1] - a[1]);
      console.log(`    | \`${r.id}\` | ${st[i - 1][1]} – ${st[i][1]} | ${((st[i][0] - st[i - 1][0]) / 1000).toFixed(1)} | ${top.map(([n, m]) => `${n} rel ${Math.round(100 * m / tot)}%`).join(', ')} |`);
    }
  }
}
