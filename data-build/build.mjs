// Mengunduh GTFS resmi TransJakarta dan membuat web/data/jakarta.json untuk simulasi di browser.
// Pakai: node data-build/build.mjs [--fetch]   (--fetch mengunduh ulang walau salinan sudah ada)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { meters } from '../web/sim.js';

const GTFS_URL = 'https://gtfs.transjakarta.co.id/files/file_gtfs.zip';
const TMP = 'var/tmp/gtfs', OUT = 'web/data/jakarta.json';

mkdirSync(TMP, { recursive: true });
mkdirSync('web/data', { recursive: true });
let lastModified = null;
if (process.argv.includes('--fetch') || !existsSync(`${TMP}/gtfs.zip`)) {
  const res = await fetch(GTFS_URL);
  if (!res.ok) throw new Error(`Unduh GTFS gagal: HTTP ${res.status}`);
  lastModified = res.headers.get('last-modified');
  writeFileSync(`${TMP}/gtfs.zip`, Buffer.from(await res.arrayBuffer()));
  writeFileSync(`${TMP}/last-modified.txt`, lastModified || '');
  // shortcut: bergantung pada perintah `unzip` sistem (ada di macOS/Linux); ganti dengan pustaka zip bila perlu Windows
  execFileSync('unzip', ['-oq', 'gtfs.zip'], { cwd: TMP });
} else if (existsSync(`${TMP}/last-modified.txt`)) lastModified = readFileSync(`${TMP}/last-modified.txt`, 'utf8') || null;

// shortcut: CSV tanpa tanda kutip (benar untuk feed ini per 2026-11-13); berhenti keras bila ada kutip agar tidak salah baca diam-diam
function csv(name) {
  const text = readFileSync(`${TMP}/${name}.txt`, 'utf8').replace(/^﻿/, '');
  if (text.includes('"')) throw new Error(`${name}.txt memuat tanda kutip; parser CSV sederhana ini tidak cukup`);
  const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const cols = head.split(',');
  return lines.map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); });
}
const hms = s => { const [h, m, x] = s.split(':').map(Number); return h * 3600 + m * 60 + x; };
const groupBy = (rows, key) => rows.reduce((m, r) => (m.get(r[key]) ?? m.set(r[key], []).get(r[key])).push(r) && m, new Map());

const stops = new Map(csv('stops').map(s => [s.stop_id, s]));
const stopTimes = groupBy(csv('stop_times'), 'trip_id');
const shapes = groupBy(csv('shapes'), 'shape_id');
const freqs = groupBy(csv('frequencies'), 'trip_id');
const routeRows = csv('routes');
const routeIndex = new Map(routeRows.map((r, i) => [r.route_id, i]));

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
// shortcut: kalender dinilai saat build (start_date/end_date); build ulang bila feed berganti masa berlaku. calendar_dates tidak ada di feed ini.
const calendar = Object.fromEntries(csv('calendar')
  .filter(c => c.start_date <= today && today <= c.end_date)
  .map(c => [c.service_id, DAYS.map(d => Number(c[d]))]));

const skipped = [];
const trips = [];
for (const t of csv('trips')) {
  const st = (stopTimes.get(t.trip_id) || []).sort((a, b) => a.stop_sequence - b.stop_sequence);
  const pts = (shapes.get(t.shape_id) || []).sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence);
  const f = (freqs.get(t.trip_id) || []).map(x => [hms(x.start_time), hms(x.end_time), Number(x.headway_secs)]);
  if (st.length < 2 || pts.length < 2 || !f.length || !routeIndex.has(t.route_id)) { skipped.push(t.trip_id); continue; }

  const lng = pts.map(p => Number(p.shape_pt_lon)), lat = pts.map(p => Number(p.shape_pt_lat));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(lng[i - 1], lat[i - 1], lng[i], lat[i]));

  // Jarak tiap halte sepanjang rute: titik rute terdekat, dicari maju dari halte sebelumnya supaya rute yang
  // melewati jalan yang sama dua kali (pulang-pergi) tidak melompat mundur.
  let from = 0;
  const sd = st.map(s => {
    const stop = stops.get(s.stop_id);
    if (!stop) throw new Error(`Halte ${s.stop_id} di trip ${t.trip_id} tidak ada di stops.txt`);
    let best = from, bestD = Infinity;
    for (let i = from; i < pts.length; i++) {
      const d = meters(Number(stop.stop_lon), Number(stop.stop_lat), lng[i], lat[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    from = best;
    return Math.round(cum[best]);
  });

  const t0 = hms(st[0].arrival_time);
  const p = [];
  let px = 0, py = 0;
  for (let i = 0; i < pts.length; i++) {
    const x = Math.round(lng[i] * 1e5), y = Math.round(lat[i] * 1e5);
    p.push(x - px, y - py); px = x; py = y;
  }
  trips.push({ id: t.trip_id, r: routeIndex.get(t.route_id), sv: t.service_id, head: t.trip_headsign,
    p, st: st.map(s => hms(s.arrival_time) - t0), sd, f });
}

const pack = {
  v: 1,
  source: { name: 'GTFS PT Transportasi Jakarta', url: GTFS_URL, lastModified, builtAt: new Date().toISOString() },
  calendar,
  routes: routeRows.map(r => ({ id: r.route_id, short: r.route_short_name, long: r.route_long_name, kind: r.route_desc,
    color: `#${r.route_color || '888888'}` })),
  trips,
};
writeFileSync(OUT, JSON.stringify(pack));
const mb = (JSON.stringify(pack).length / 1e6).toFixed(1);
console.log(`${OUT}: ${pack.routes.length} rute, ${trips.length} trip, ${mb} MB; dilewati ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 8).join(', ')})` : ''}`);
console.log(`Layanan aktif: ${Object.keys(calendar).join(', ')}; GTFS diperbarui ${lastModified || 'tidak diketahui'}`);
