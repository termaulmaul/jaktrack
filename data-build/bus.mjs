// Mengunduh GTFS resmi TransJakarta dan membuat var/static/tokyo/bus-v1.json: format yang dibaca
// web/src/tokyo/buses/pack.js, ditambah bagian `sim` (kalender + jadwal frekuensi) untuk simulator buses/sim.js.
// Dijalankan setelah jakarta.mjs (yang mengosongkan folder keluaran dan menulis packs.json).
// Pakai: bun data-build/bus.mjs [--fetch]   (--fetch mengunduh ulang walau salinan sudah ada di var/tmp/gtfs/)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodePath } from '../web/src/tokyo/net.js';
import { toX, toY } from '../web/src/tokyo/buses/util.js';
import { unpackBus } from '../web/src/tokyo/buses/pack.js';
import { simTrips, busesNow } from '../web/src/tokyo/buses/sim.js';

const GTFS_URL = 'https://gtfs.transjakarta.co.id/files/file_gtfs.zip';
const TMP = 'var/tmp/gtfs', OUT = 'var/static/tokyo';
const TABLES = ['calendar', 'frequencies', 'routes', 'shapes', 'stops', 'stop_times', 'trips'];
const t0 = performance.now();

if (!existsSync(`${OUT}/packs.json`)) {
  console.error(`Bus TransJakarta TIDAK dibangun: ${OUT}/packs.json belum ada. Jalankan dulu: bun data-build/jakarta.mjs`);
  process.exit(1);
}
mkdirSync(TMP, { recursive: true });
if (process.argv.includes('--fetch') || !existsSync(`${TMP}/gtfs.zip`)) {
  try {
    const res = await fetch(GTFS_URL, { headers: { 'user-agent': 'jaktrack-data-build (skrip bun; unduhan GTFS sekali per build)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(`${TMP}/gtfs.zip`, Buffer.from(await res.arrayBuffer()));
    writeFileSync(`${TMP}/last-modified.txt`, res.headers.get('last-modified') || '');
  } catch (e) {
    console.error(`Bus TransJakarta TIDAK dibangun: unduhan GTFS gagal (${e?.message || e}) dari ${GTFS_URL}.`);
    console.error(`Berkas kereta di ${OUT} tidak diubah; halaman tetap jalan tanpa bus. Coba lagi: bun data-build/bus.mjs --fetch`);
    process.exit(1);
  }
}
// shortcut: bergantung pada perintah `unzip` sistem (ada di macOS/Linux); ganti dengan pustaka zip bila perlu Windows
execFileSync('unzip', ['-oq', 'gtfs.zip', ...TABLES.map((t) => `${t}.txt`)], { cwd: TMP });
const lastModified = existsSync(`${TMP}/last-modified.txt`) ? readFileSync(`${TMP}/last-modified.txt`, 'utf8').trim() || null : null;

// shortcut: CSV tanpa tanda kutip (benar untuk feed ini per 2026-11-14); berhenti keras bila ada kutip agar tidak salah baca diam-diam
function csv(name) {
  const text = readFileSync(`${TMP}/${name}.txt`, 'utf8').replace(/^﻿/, '');
  if (text.includes('"')) throw new Error(`${name}.txt memuat tanda kutip; parser CSV sederhana ini tidak cukup`);
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map((l) => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); });
}
const hms = (s) => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
const groupBy = (rows, key) => rows.reduce((m, r) => (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r) && m, new Map());
const e5 = (v) => Math.round(Number(v) * 1e5);
/** Indeks nilai `v` di daftar `list` (ditambahkan bila belum ada); `ix` = Map kunci -> indeks. */
const intern = (ix, list, key, v) => { if (!ix.has(key)) { ix.set(key, list.length); list.push(v); } return ix.get(key); };

const stopRows = new Map(csv('stops').map((s) => [s.stop_id, s]));
const stopTimes = groupBy(csv('stop_times'), 'trip_id');
const shapeRows = groupBy(csv('shapes'), 'shape_id');
const freqs = groupBy(csv('frequencies'), 'trip_id');
const routeRows = new Map(csv('routes').map((r) => [r.route_id, r]));

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).replaceAll('-', '');   // tanggal WIB
// shortcut: masa berlaku kalender (start_date/end_date) dinilai saat build; build ulang bila feed berganti masa berlaku.
// calendar_dates tidak ada di feed ini, jadi hari libur nasional memakai jadwal hari biasanya.
const calendar = Object.fromEntries(csv('calendar')
  .filter((c) => c.start_date <= today && today <= c.end_date)
  .map((c) => [c.service_id, DAYS.map((d) => Number(c[d]))]));

const routes = [], routeIx = new Map(), heads = [], headIx = new Map(), names = [], nameIx = new Map();
const stopIds = [], stops = [], stopIx = new Map(), shapes = [], shapeIx = new Map(), geom = [];
const pats = [], trips = [], tripX = {}, skipped = [];
let farStops = 0, maxOff = 0;

for (const t of csv('trips')) {
  const st = (stopTimes.get(t.trip_id) || []).sort((a, b) => a.stop_sequence - b.stop_sequence);
  const pts = (shapeRows.get(t.shape_id) || []).sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
  const f = (freqs.get(t.trip_id) || []).map((x) => [hms(x.start_time), hms(x.end_time), Number(x.headway_secs)]);
  const route = routeRows.get(t.route_id);
  if (st.length < 2 || pts.length < 2 || !f.length || !route) { skipped.push(t.trip_id); continue; }

  const ri = intern(routeIx, routes, route.route_id, [route.route_id, route.route_short_name, route.route_long_name, null, `#${route.route_color || '888888'}`, null, 0]);
  const pi = pats.length;
  const si = intern(shapeIx, shapes, t.shape_id, null);
  if (!shapes[si]) {
    // koordinat dibulatkan seperti yang akan dibaca browser, lalu diukur di kerangka meter yang sama dengan shapes.js
    const ll = pts.map((p) => [e5(p.shape_pt_lon) / 1e5, e5(p.shape_pt_lat) / 1e5]);
    const xs = ll.map((p) => toX(p[0])), ys = ll.map((p) => toY(p[1])), cum = [0];
    for (let i = 1; i < ll.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    geom[si] = { xs, ys, cum };
    shapes[si] = [t.shape_id, ri, Number(t.direction_id) || 0, pi, encodePath(ll), Math.round(cum.at(-1))];
  }
  const { xs, ys, cum } = geom[si];

  // Jarak tiap halte sepanjang rute: titik rute yang membuat jumlah jarak halte-ke-rute terkecil dengan syarat urutan
  // halte tidak pernah mundur (program dinamis). Titik terdekat saja salah di rute pulang-pergi dan rute melingkar:
  // halte awal bisa menempel ke lintasan pulang, lalu semua halte sesudahnya menumpuk di ujung.
  const n = xs.length, along = [], stopList = [], pick = [];
  let cost = new Float64Array(n);
  for (const s of st) {
    const stop = stopRows.get(s.stop_id);
    if (!stop) throw new Error(`Halte ${s.stop_id} di trip ${t.trip_id} tidak ada di stops.txt`);
    const x = toX(Number(stop.stop_lon)), y = toY(Number(stop.stop_lat));
    const next = new Float64Array(n), arg = new Int32Array(n);   // arg[i] = titik terbaik halte sebelumnya, <= i
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (cost[i] < cost[best]) best = i;
      arg[i] = best; next[i] = cost[best] + Math.hypot(x - xs[i], y - ys[i]);
    }
    cost = next; pick.push(arg);
    stopList.push(intern(stopIx, stopIds, s.stop_id, s.stop_id));
    if (stops.length < stopIds.length * 3) stops.push(intern(nameIx, names, stop.stop_name, [stop.stop_name]), e5(stop.stop_lon), e5(stop.stop_lat));
  }
  let at = cost.indexOf(Math.min(...cost));
  for (let j = st.length - 1; j >= 0; j--) {
    along[j] = Math.round(cum[at]);
    const stop = stopRows.get(st[j].stop_id), off = Math.hypot(toX(Number(stop.stop_lon)) - xs[at], toY(Number(stop.stop_lat)) - ys[at]);
    if (off > 150) farStops++;
    maxOff = Math.max(maxOff, off);
    at = pick[j][at];
  }
  const dep = hms(st[0].arrival_time);
  pats.push([si, intern(headIx, heads, t.trip_headsign, [t.trip_headsign]), stopList, along, 0]);
  trips.push([t.trip_id, ri, t.service_id, st.map((s) => hms(s.arrival_time) - dep), f]);   // sejajar dengan pats
  tripX[t.trip_id] = pi;
}
if (!trips.length) throw new Error('GTFS tidak menghasilkan satu trip pun; periksa isi var/tmp/gtfs');

const built = new Date().toISOString();
const pack = {
  v: 1, built,
  feed: { name: 'GTFS PT Transportasi Jakarta', url: GTFS_URL, lastModified, obtained: built.slice(0, 10) },
  ops: [{ id: 'transjakarta', name: { ja: 'TransJakarta', en: 'TransJakarta' }, stopReports: true }],
  routes, heads, names, stopIds, stops, pats, shapes, tripX,
  sim: { calendar, trips },   // jadwal apa adanya dari GTFS; aturan hari layanan 03.00 diterapkan sim.js
};
const text = JSON.stringify(pack);
writeFileSync(`${OUT}/bus-v1.json`, text);
writeFileSync(`${OUT}/bus-latest.json`, JSON.stringify({ v: 1, file: 'bus-v1.json', built, bytes: { raw: text.length },
  counts: { routes: routes.length, trips: trips.length, shapes: shapes.length, stops: stopIds.length } }));
const packs = JSON.parse(readFileSync(`${OUT}/packs.json`, 'utf8'));
packs.files = [...new Set([...packs.files, 'bus-latest.json', 'bus-v1.json'])];
writeFileSync(`${OUT}/packs.json`, JSON.stringify(packs));

console.log(`${OUT}/bus-v1.json: ${routes.length} rute, ${trips.length} pola trip, ${shapes.length} bentuk, ${stopIds.length} halte, ${(text.length / 1e6).toFixed(2)} MB; dilewati ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 8).join(', ')})` : ''}`);
console.log(`Layanan aktif: ${Object.keys(calendar).join(', ')}; GTFS diperbarui ${lastModified || 'tidak diketahui'}; halte > 150 m dari bentuk rutenya: ${farStops} (terjauh ${Math.round(maxOff)} m)`);
// Jumlah bus simulasi pada jam sampel (GTFS apa adanya: banyak pola dinyatakan beroperasi 00.00-23.59, lihat README)
const sim = simTrips(unpackBus(pack)), wib = (d, h) => Date.UTC(2026, 10, d, h - 7);   // 13 Nov 2026 = Jumat, 14 = Sabtu
for (const [label, d] of [['Jumat', 13], ['Sabtu', 14]]) {
  console.log(`  Bus simulasi ${label}: ${[8, 13, 20].map((h) => `${String(h).padStart(2, '0')}.00 = ${busesNow(sim, calendar, wib(d, h)).length}`).join(', ')}`);
}
console.log(`  waktu bangun bus ${((performance.now() - t0) / 1000).toFixed(1)} dtk`);
