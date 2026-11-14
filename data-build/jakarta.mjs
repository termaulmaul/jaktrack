// Mengubah berkas kereta trafik.live (asset-krl-*.json, disimpan lokal di var/src/trafik/) menjadi berkas yang
// dibaca halaman web: network-v1.json dan tt-v1/ di var/static/tokyo/ (nama folder mengikuti kode web asal).
// Pakai: bun data-build/jakarta.mjs
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { encodePath, segLen } from '../web/src/tokyo/net.js';
import { KIND, PREFER_UP } from './elev.mjs';
import { snapper } from './snap.mjs';

const SRC_DIR = 'var/src/trafik', OUT = 'var/static/tokyo';
const srcFile = existsSync(SRC_DIR) && readdirSync(SRC_DIR).filter(f => /^asset-krl-.*\.json$/.test(f)).sort().at(-1);
if (!srcFile) throw new Error(`Tidak ada asset-krl-*.json di ${SRC_DIR}. Simpan dulu berkas kereta dari trafik.live ke folder itu.`);
const src = JSON.parse(readFileSync(`${SRC_DIR}/${srcFile}`, 'utf8'));
if (src.v !== 2) throw new Error(`Format berkas kereta v${src.v} belum dikenal (yang didukung: v2)`);

const hash = s => createHash('sha256').update(s).digest('hex');
const SYSTEMS = { krl: { op: 'KAI Commuter', type: 'KRL', cars: 6, rank: 0 }, mrt: { op: 'MRT Jakarta', type: 'MRT', cars: 6, rank: 0 },
  jbdb: { op: 'LRT Jabodebek', type: 'LRT', cars: 6, rank: 0 }, lrtj: { op: 'LRT Jakarta', type: 'LRT', cars: 2, rank: 0 },
  kai: { op: 'KAI', type: 'KA antarkota', cars: 6, rank: 4 } };

// ---- sumber ----
const sLines = src.lines.map(([id, name, color, system, code]) => ({ id, name, color, system, code }));
const sStations = src.stations.map(([id, name, lng, lat]) => ({ id, name, lng, lat }));
const stationById = new Map(sStations.map(s => [s.id, s]));

function decode(str) {                                  // polyline 1e5; urutan sumbu dideteksi di bawah
  const out = []; let i = 0; const e = [0, 0];
  while (i < str.length) {
    for (let r = 0; r < 2; r++) { let o = 0, sh = 0, b; do { b = str.charCodeAt(i++) - 63; o |= (b & 31) << sh; sh += 5; } while (b >= 32); e[r] += o & 1 ? ~(o >> 1) : o >> 1; }
    out.push([e[0] / 1e5, e[1] / 1e5]);
  }
  return out;
}
// graf rel per jaringan ('' = perkotaan, 'kai' = antarkota): simpul = stasiun, sisi = potongan rel dua arah
const graph = new Map();
const edge = (net, a, b, points, length) => {
  if (!graph.has(net)) graph.set(net, new Map());
  const g = graph.get(net);
  if (!g.has(a)) g.set(a, new Map());
  g.get(a).set(b, { points, length });
};
for (const [a, b, enc, net = ''] of src.tracks) {
  let pts = decode(enc);
  if (Math.abs(pts[0][0]) < 90) pts = pts.map(([y, x]) => [x, y]);          // pastikan [lng, lat]
  if (!(pts[0][0] > 95 && pts[0][0] < 141 && pts[0][1] > -11 && pts[0][1] < 6)) throw new Error(`Rel ${a}-${b}: koordinat di luar Indonesia`);
  let len = 0; for (let i = 1; i < pts.length; i++) len += segLen(pts[i - 1], pts[i]);
  edge(net, a, b, pts, len); edge(net, b, a, [...pts].reverse(), len);
}
const routeCache = new Map();
function route(net, a, b) {                              // Dijkstra sederhana; grafnya kecil (±150 simpul)
  const key = `${net}:${a}/${b}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const g = graph.get(net) || new Map(), done = new Set();
  let q = [{ id: a, d: 0, nodes: [a] }], found = null;
  while (q.length) {
    q.sort((x, y) => x.d - y.d || (x.id < y.id ? -1 : 1));
    const n = q.shift();
    if (n.id === b) { found = n.nodes; break; }
    if (done.has(n.id)) continue;
    done.add(n.id);
    for (const [k, e] of g.get(n.id) || []) if (!done.has(k)) q.push({ id: k, d: n.d + e.length, nodes: [...n.nodes, k] });
  }
  routeCache.set(key, found);
  return found;
}
const netOf = system => (system === 'kai' ? 'kai' : '');
// Trase: tiap potongan rel antarstasiun digeser menyamping ke garis tengah rel OpenStreetMap (data-build/snap.mjs), supaya
// jalur, kereta, viaduk, dan terowongan berimpit dengan peta dasar. Tanpa berkas OSM, lintasan sumber dipakai apa adanya.
const OSM_FILE = 'var/src/osm/rail.json';
const osmJson = existsSync(OSM_FILE) ? JSON.parse(readFileSync(OSM_FILE, 'utf8')) : null;
const osm = osmJson ? snapper(osmJson.elements || []) : null;
const snapped = new Map();                              // potongan yang dipakai bersama beberapa jalur diselaraskan sekali
function railOf(net, a, b, kind, zones) {
  const raw = graph.get(net).get(a).get(b);
  if (!osm || !kind) return { ...raw, unmatched: 0 };
  const fwd = a < b, key = `${net}|${kind}|${zones.length}|${fwd ? a : b}|${fwd ? b : a}`;
  if (!snapped.has(key)) {
    const r = osm.snap(fwd ? raw.points : [...raw.points].reverse(), kind, zones);
    let len = 0; for (let i = 1; i < r.points.length; i++) len += segLen(r.points[i - 1], r.points[i]);
    snapped.set(key, { points: r.points, length: len, unmatched: r.unmatched });
  }
  const e = snapped.get(key);
  return fwd ? e : { ...e, points: [...e.points].reverse() };
}
const alignment = [];                                   // laporan per jalur: selisih terhadap rel OSM sebelum dan sesudah
// Stasiun bawah tanah (bukan dari berkas sumber): enam stasiun MRT Lin Utara-Selatan, Senayan sampai Bundaran HI.
// Sumber dan pemeriksaan silang dengan tag tunnel OpenStreetMap: docs/ELEVASI.md. Tanda ini dipakai untuk kotak stasiun
// dan tombol "Lihat di bawah tanah"; tinggi rel per ruas (layang / terowongan) dibangun data-build/elev.mjs, yang
// mencetak PERIKSA bila tanda di sini tidak cocok dengan terowongan menurut OSM.
const UNDERGROUND = new Set(['MRT-SNY', 'MRT-IST', 'MRT-BNH', 'MRT-STB', 'MRT-DKA', 'MRT-BHI']);

// ---- kereta: urutan simpul penuh + halte berhenti ----
const skipped = [];
const trains = [];
const seenId = new Set();
for (const [id, li, , days, pi, times, , , , extra] of src.trains) {
  const line = sLines[li], pat = src.patterns[pi].map(i => sStations[i].id);
  if (seenId.has(id)) throw new Error(`Nomor kereta ganda: ${id}`);
  seenId.add(id);
  const nodes = [pat[0]], stopAt = [0];                 // stopAt[k] = posisi halte ke-k di `nodes`
  let ok = true;
  for (let k = 1; k < pat.length && ok; k++) {
    const r = route(netOf(line.system), pat[k - 1], pat[k]);
    if (!r) { ok = false; break; }
    nodes.push(...r.slice(1)); stopAt.push(nodes.length - 1);
  }
  if (!ok || pat.length < 2) { skipped.push(id); continue; }
  let t = 0; const secs = times.map(v => (t += v * 30));
  trains.push({ id: id.replaceAll('.', '_'), li, days, nodes, stopAt, secs, name: extra?.name || null });
}

// ---- jalur: tiap jalur sumber dipecah menjadi lintasan lurus (cabang menjadi jalur sendiri) ----
const isSub = (small, big) => { outer: for (let o = 0; o + small.length <= big.length; o++) { for (let i = 0; i < small.length; i++) if (small[i] !== big[o + i]) continue outer; return o; } return -1; };
const trunks = [];                                      // { li, nodes }
sLines.forEach((line, li) => {
  const seqs = [...new Map(trains.filter(t => t.li === li).map(t => [t.nodes.join('>'), t.nodes])).values()].sort((a, b) => b.length - a.length);
  const mine = [];
  for (const s of seqs) if (!mine.some(m => isSub(s, m.nodes) >= 0 || isSub([...s].reverse(), m.nodes) >= 0)) mine.push({ li, nodes: s });
  trunks.push(...mine);
});

const stations = [], lines = [], byStationId = new Map();
const ops = [...new Set(Object.values(SYSTEMS).map(s => s.op))];
const types = [...new Set(Object.values(SYSTEMS).map(s => s.type))];
for (const train of trains) {                           // pasangkan kereta ke lintasannya
  for (let ti = 0; ti < trunks.length && train.trunk === undefined; ti++) {
    const T = trunks[ti];
    if (T.li !== train.li) continue;
    let o = isSub(train.nodes, T.nodes);
    if (o >= 0) { train.trunk = ti; train.dir = 0; train.pos = train.stopAt.map(k => o + k); continue; }
    o = isSub([...train.nodes].reverse(), T.nodes);
    if (o >= 0) { train.trunk = ti; train.dir = 1; train.pos = train.stopAt.map(k => o + train.nodes.length - 1 - k); }
  }
  if (train.trunk === undefined) throw new Error(`Kereta ${train.id} tidak cocok dengan lintasan mana pun`);
}
trunks.forEach((T, ti) => {
  const line = sLines[T.li], sys = SYSTEMS[line.system], net = netOf(line.system);
  const lineId = `${line.system}.${line.id.replaceAll(' ', '-')}.${ti}`;
  const kind = KIND[line.system], zones = PREFER_UP.filter(z => lineId.startsWith(z.prefix)).map(z => [z.lng, z.lat, z.r]);
  const path = [], rawPath = [], at = [0];              // at[i] = meter pada simpul ke-i
  let unmatched = 0;
  T.nodes.forEach((n, i) => {
    if (!i) return;
    const e = railOf(net, T.nodes[i - 1], n, kind, zones);
    path.push(...e.points.slice(path.length ? 1 : 0)); at.push(at[i - 1] + e.length); unmatched += e.unmatched;
    rawPath.push(...graph.get(net).get(T.nodes[i - 1]).get(n).points.slice(rawPath.length ? 1 : 0));
  });
  if (osm && kind) alignment.push({ id: lineId, before: osm.offset(rawPath, kind), after: osm.offset(path, kind), unmatched, points: [rawPath.length, path.length] });
  const stopped = new Set(trains.filter(t => t.trunk === ti).flatMap(t => t.pos));
  const siblings = trunks.filter(x => x.li === T.li).length;
  const name = n => stationById.get(n)?.name || n;
  const title = siblings > 1 ? `${line.name} (${name(T.nodes[0])}–${name(T.nodes.at(-1))})` : line.name;
  T.station = new Map();                                // posisi simpul -> indeks stasiun global
  const idx = [], chain = [], used = new Map();
  T.nodes.forEach((n, i) => {
    const s = stationById.get(n);
    if (!s || !stopped.has(i)) return;                  // hanya stasiun yang disinggahi kereta lintasan ini
    const rep = (used.get(n) || 0) + 1; used.set(n, rep);
    const si = stations.length;
    stations.push([`${lineId}.${n}${rep > 1 ? `-${rep}` : ''}`, lines.length, s.name, s.name, s.lng, s.lat, -1, UNDERGROUND.has(n) ? 1 : 0, null, -1, 0, 0, 0]);
    if (!byStationId.has(n)) byStationId.set(n, []);
    byStationId.get(n).push(si);
    T.station.set(i, si); idx.push(si); chain.push(Math.round(at[i]));
  });
  const length = Math.round(at.at(-1));
  // shortcut: semua jalur digambar di garis tengah (offset 0), jadi jalur yang berbagi rel bertumpuk; hitung lajur bila perlu dipisah
  lines.push([lineId, title, title, line.color, line.code || null, ops.indexOf(sys.op), sys.cars, T.nodes.some(n => UNDERGROUND.has(n)) ? 1 : 0, 0,
    idx, encodePath(path), chain, length, 0, [0, 0, length, 0], 0, 1, 0, 0]);
});
// stasiun fisik yang sama di beberapa jalur menjadi satu kelompok (pindah jalur, satu papan stasiun)
const groups = [];
for (const list of byStationId.values()) if (list.length > 1) { for (const si of list) stations[si][6] = groups.length; groups.push(list); }

// ---- tulis berkas jaringan ----
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const built = new Date().toISOString();
const network = {
  v: 1, kind: 'tokyo-network',
  meta: { source: { name: 'trafik.live asset-krl', file: srcFile, obtained: built.slice(0, 10), url: 'https://trafik.live/kereta',
    upstream: src.meta.source_url, license: src.meta.licence, attribution: src.meta.attribution, systems: src.meta.systems },
    ...(osm ? { alignment: { source: 'OpenStreetMap', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright', osmBase: osmJson.osm3s?.timestamp_osm_base || null } } : {}) },
  fields: { lines: ['id', 'en', 'ja', 'color', 'code', 'op', 'cars', 'underground', 'loop', 'stations', 'path', 'chain', 'length', 'offset', 'lanes', 'ascending', 'descending', 'hidden', 'codes'],
    stations: ['id', 'line', 'en', 'ja', 'lng', 'lat', 'group', 'underground', 'code', 'alt', 'part', 'uen', 'uja'],
    types: ['id', 'en', 'ja', 'color', 'rank'], dirs: ['id', 'en', 'ja'], ops: ['id', 'en', 'ja', 'sen', 'sja'] },
  ops: ops.map(o => [o.replaceAll(' ', '-'), o, o, o, o]),
  types: types.map(t => [t.replaceAll(' ', '-'), t, t, null, Object.values(SYSTEMS).find(s => s.type === t).rank]),
  dirs: [['Outbound', 'Outbound', 'Outbound'], ['Inbound', 'Inbound', 'Inbound']],
  lines, stations, groups,
};
const netText = JSON.stringify(network);
writeFileSync(`${OUT}/network-v1.json`, netText);
writeFileSync(`${OUT}/network-latest.json`, JSON.stringify({ v: 1, kind: 'tokyo-network', file: 'network-v1.json', hash: hash(netText).slice(0, 12), built,
  bytes: { raw: netText.length }, counts: { lines: lines.length, stations: stations.length, groups: groups.length, types: types.length, dirs: 2, ops: ops.length } }, null, 1));

// ---- jadwal: per kalender, dipotong per jam ----
const LEAD = 120, TAIL = 60, BUCKET = 3600;             // sama dengan jendela aktif di web/src/tokyo/tt.js
const CALS = { weekday: { src: 'Weekday', days: [0, 1] }, holiday: { src: 'SaturdayHoliday', days: [0, 2] } };
const pointer = { f: 1, dir: 'tt-v1', bucket: BUCKET, source: `trafik.live ${srcFile}`, cals: {} };
const allText = [];
for (const [cal, def] of Object.entries(CALS)) {
  const dir = `${OUT}/tt-v1/${cal}`;
  mkdirSync(dir, { recursive: true });
  const runs = trains.filter(t => def.days.includes(t.days)).map(t => {
    const T = trunks[t.trunk], sys = SYSTEMS[sLines[T.li].system];
    const st = t.pos.map(p => T.station.get(p));
    if (st.some(s => s === undefined)) throw new Error(`Kereta ${t.id}: halte tanpa stasiun`);
    return { t, line: stations[st[0]][1], type: types.indexOf(sys.type), st, first: t.secs[0], last: t.secs.at(-1) };
  }).sort((a, b) => a.first - b.first || a.line - b.line || (a.t.id < b.t.id ? -1 : 1));
  const entries = [];
  const h0 = Math.floor((Math.min(...runs.map(r => r.first)) - LEAD) / BUCKET), h1 = Math.floor((Math.max(...runs.map(r => r.last)) + TAIL) / BUCKET);
  for (let h = h0; h <= h1; h++) {
    const t0 = h * BUCKET, t1 = t0 + BUCKET;
    const inB = runs.filter(r => r.first - LEAD < t1 && r.last + TAIL >= t0);
    const pats = [], patOf = new Map();
    const rows = inB.map(r => {
      // tiap halte punya satu waktu di sumber: berangkat (bit 2) di semua halte kecuali terakhir yang berupa tiba (bit 1)
      const pat = r.st.map((s, k) => (s << 2) | (k === r.st.length - 1 ? 1 : 2)), pk = pat.join(',');
      if (!patOf.has(pk)) { patOf.set(pk, pats.length); pats.push(pat); }
      const row = [r.t.id, r.line, r.type, r.t.dir, patOf.get(pk), r.first / 60, r.t.secs.slice(1).map((v, k) => (v - r.t.secs[k]) / 60), [r.st[0]], [r.st.at(-1)], [], [], 0];
      if (r.t.name) row.push([[r.t.name, r.t.name]]);
      return row;
    });
    // kolom `line` berisi indeks jalur global; daftar `lines` di berkas dipakai tt.js untuk merangkai id perjalanan
    const text = JSON.stringify({ f: 1, cal, src: def.src, t0, t1, lines: lines.map(l => l[0]), p: pats, r: rows });
    const file = `${String(Math.floor(t0 / 3600)).padStart(2, '0')}00-${hash(text).slice(0, 10)}.json`;
    writeFileSync(`${dir}/${file}`, text); allText.push(text);
    entries.push({ t0, t1, file, runs: rows.length, raw: text.length });
  }
  const lineSet = [...new Set(runs.map(r => r.line))].sort((a, b) => a - b);
  writeFileSync(`${dir}/index.json`, JSON.stringify({ f: 1, cal, src: def.src, bucket: BUCKET, t0: entries[0].t0, t1: entries.at(-1).t1, runs: runs.length,
    stops: runs.reduce((n, r) => n + r.st.length, 0), first: Math.min(...runs.map(r => r.first)), last: Math.max(...runs.map(r => r.last)), lines: lineSet, buckets: entries }));
  pointer.cals[cal] = { src: def.src, runs: runs.length, lines: lineSet.length, buckets: entries.length };
}
pointer.hash = hash(allText.join('')).slice(0, 12); pointer.built = built;
writeFileSync(`${OUT}/tt-latest.json`, JSON.stringify(pointer));
writeFileSync(`${OUT}/packs.json`, JSON.stringify({ v: 1, built, files: ['network-latest.json', 'network-v1.json', 'tt-latest.json'] }));

console.log(`${srcFile} -> ${OUT}`);
console.log(`jalur ${lines.length} (dari ${sLines.length} jalur sumber), stasiun ${stations.length}, kelompok ${groups.length}, kereta ${trains.length}, dilewati ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 6).join(', ')})` : ''}`);
for (const [c, v] of Object.entries(pointer.cals)) console.log(`  ${c}: ${v.runs} perjalanan, ${v.lines} jalur, ${v.buckets} berkas jam`);
for (const l of lines) console.log(`  ${l[0].padEnd(22)} ${String(l[9].length).padStart(3)} stasiun ${(l[12] / 1000).toFixed(1).padStart(6)} km  ${l[1]}`);
if (osm) {
  const f = v => (v == null ? '   -' : v.toFixed(1).padStart(6));
  console.log(`Trase diselaraskan ke rel OpenStreetMap (${OSM_FILE}, per ${osmJson.osm3s?.timestamp_osm_base || '?'}); selisih ke rel OSM terdekat, meter:`);
  console.log(`  ${'jalur'.padEnd(22)} sebelum: rata2   maks | sesudah: rata2   maks | tanpa rel OSM (m) | titik`);
  for (const a of alignment) console.log(`  ${a.id.padEnd(22)}          ${f(a.before.mean)} ${f(a.before.max)} |          ${f(a.after.mean)} ${f(a.after.max)} | ${String(a.unmatched).padStart(8)}          | ${a.points[0]} -> ${a.points[1]}`);
} else console.log(`Trase TIDAK diselaraskan: tidak ada ${OSM_FILE} (jalankan sekali: bun data-build/elev.mjs --fetch). Lintasan sumber dipakai apa adanya.`);
