// builds fixtures/mini.js (Yamanote + Ginza, SaturdayHoliday) from Mini Tokyo 3D's data/*.json.
// Reads the MT3D JSON files as DATA only (never runs MT3D code). Data (c) Akihiko Kusanagi, MIT.
// Run: node web/src/tokyo/fixtures/build-mini.mjs   (writes web/src/tokyo/fixtures/mini.js)
// Indexes in the fixture are COMPACT (0..n-1 inside the slice), not the real MT3D positions.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
import { MT3D_DATA as MT3D, mt3dSource } from '../../../../data-build/paths.mjs';
const load = (f) => JSON.parse(readFileSync(join(MT3D, f), 'utf8'));

const LINE_IDS = ['JR-East.Yamanote', 'TokyoMetro.Ginza'];
const TT_FILES = { 'JR-East.Yamanote': 'jreast-yamanote.json', 'TokyoMetro.Ginza': 'tokyometro-ginza.json' };
const CAL = 'SaturdayHoliday';
const LINE_CODES = { 'JR-East.Yamanote': 'JY', 'TokyoMetro.Ginza': 'G' };
// JR East numbering (JY01 Tokyo ... JY30 Yurakucho, counted along the inner loop).
const JY = ['Tokyo', 'Kanda', 'Akihabara', 'Okachimachi', 'Ueno', 'Uguisudani', 'Nippori', 'NishiNippori', 'Tabata',
  'Komagome', 'Sugamo', 'Otsuka', 'Ikebukuro', 'Mejiro', 'Takadanobaba', 'ShinOkubo', 'Shinjuku', 'Yoyogi', 'Harajuku',
  'Shibuya', 'Ebisu', 'Meguro', 'Gotanda', 'Osaki', 'Shinagawa', 'TakanawaGateway', 'Tamachi', 'Hamamatsucho',
  'Shimbashi', 'Yurakucho'];
const OPERATORS = [
  { id: 'JR-East', title: { en: 'JR East', ja: 'JR東日本' }, color: null },
  { id: 'TokyoMetro', title: { en: 'Tokyo Metro', ja: '東京メトロ' }, color: null },
];
const RANK = (id) => /Limited|Liner|Ltd|Express(?!.*Local)/i.test(id) ? (/Limited|Liner/i.test(id) ? 4 : 2)
  : /Rapid/i.test(id) ? 1 : 0;

const railways = load('railways.json');
const stationsAll = load('stations.json');
const groupsAll = load('station-groups.json');
const typesAll = load('train-types.json');
const dirsAll = load('rail-directions.json');
const coords = load('coordinates.json').railways;

// --- geometry helpers (equirectangular metres around Tokyo; good to <0.1% at this scale) ---
const R = 6371008.8, RAD = Math.PI / 180;
function segLen(a, b) {
  const kx = Math.cos(((a[1] + b[1]) / 2) * RAD) * R * RAD, ky = R * RAD;
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky);
}
function project(p, a, b) { // -> { t, d } point p onto segment ab
  const kx = Math.cos(p[1] * RAD) * R * RAD, ky = R * RAD;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { t, d: Math.hypot(ax + dx * t, ay + dy * t) };
}
function cumul(path) {
  const c = [0];
  for (let i = 1; i < path.length; i++) c.push(c[i - 1] + segLen(path[i - 1], path[i]));
  return c;
}
function nearest(path, p, fromSeg = 0) { // best segment >= fromSeg
  let best = null;
  for (let i = Math.max(0, fromSeg); i < path.length - 1; i++) {
    const r = project(p, path[i], path[i + 1]);
    if (!best || r.d < best.d) best = { seg: i, t: r.t, d: r.d };
  }
  return best;
}
const round5 = (x) => Math.round(x * 1e5) / 1e5;

const stationIdx = new Map(); // MT3D station id -> compact index
const stations = [];
const lines = [];

for (const id of LINE_IDS) {
  const rw = railways.find((r) => r.id === id);
  const co = coords.find((r) => r.id === id);
  const loop = !!co.loop;
  // concatenate subline coords (sublines are continuous; drop the duplicated joints)
  let path = [];
  for (const sl of co.sublines) for (const c of sl.coords) {
    const p = [c[0], c[1]];
    const last = path[path.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) path.push(p);
  }
  const ids = rw.stations;
  const st = ids.map((sid) => stationsAll.find((s) => s.id === sid));
  // direction: path must run from the first listed station to the last (for a loop: via the second one)
  {
    const a = nearest(path, st[0].coord), b = nearest(path, st[loop ? 1 : st.length - 1].coord);
    if (b.seg < a.seg || (b.seg === a.seg && b.t < a.t)) path.reverse();
  }
  if (loop) {
    // MT3D's sublines overlap around the first station (the last one runs on past it): cut the ring at the first
    // station's projection on the first fifth of the path and on the last fifth, so it closes without a double-back.
    const k = Math.floor((path.length - 1) / 5);
    const head = nearest(path.slice(0, k + 1), st[0].coord);
    const tailFrom = path.length - 1 - k, tail = nearest(path, st[0].coord, tailFrom);
    const pt = (n) => { const a = path[n.seg], b = path[n.seg + 1]; return [a[0] + (b[0] - a[0]) * n.t, a[1] + (b[1] - a[1]) * n.t]; };
    const P = pt(head);
    path = [P, ...path.slice(head.seg + 1, tail.seg + 1), P.slice()];
  }
  path = path.map((p) => [round5(p[0]), round5(p[1])]);
  const cum = cumul(path);
  const length = cum[cum.length - 1];
  const chain = [];
  let fromSeg = 0;
  st.forEach((s, k) => {
    if (loop && k === st.length - 1 && s.id === st[0].id) { chain.push(Math.round(length)); return; }
    if (loop && k === 0) { chain.push(0); return; }
    const n = nearest(path, s.coord, fromSeg);
    fromSeg = n.seg;
    chain.push(Math.round(cum[n.seg] + (cum[n.seg + 1] - cum[n.seg]) * n.t));
  });
  const li = lines.length;
  const code = LINE_CODES[id];
  const stIdx = [];
  st.forEach((s, k) => {
    if (!stationIdx.has(s.id)) {
      const short = s.id.split('.').pop();
      const num = code === 'JY' ? JY.indexOf(short) + 1 : k + 1;
      stationIdx.set(s.id, stations.length);
      stations.push({
        id: s.id, line: li, name: { en: s.title.en, ja: s.title.ja }, lng: s.coord[0], lat: s.coord[1],
        group: -1, underground: (rw.altitude || 0) < 0, code: num > 0 ? code + String(num).padStart(2, '0') : null,
      });
    }
    stIdx.push(stationIdx.get(s.id));
  });
  lines.push({
    id, title: { en: rw.title.en, ja: rw.title.ja }, color: rw.color, code,
    op: OPERATORS.findIndex((o) => o.id === id.split('.')[0]), cars: rw.carComposition || 0,
    underground: (rw.altitude || 0) < 0, loop, stations: stIdx, path, chain, length: Math.round(length), offset: 0,
    ascending: rw.ascending || null, descending: rw.descending || null,
  });
}

// groups: MT3D complexes (outer arrays) flattened, keeping only fixture stations
const groups = [];
for (const complex of groupsAll) {
  const members = complex.flat().filter((sid) => stationIdx.has(sid)).map((sid) => stationIdx.get(sid));
  if (!members.length) continue;
  const g = groups.length;
  groups.push(members);
  for (const s of members) stations[s].group = g;
}

// runs
const typeIdx = new Map(), dirIdx = new Map();
const types = [], dirs = [];
const useType = (id) => {
  if (!typeIdx.has(id)) {
    const t = typesAll.find((x) => x.id === id);
    typeIdx.set(id, types.length);
    types.push({ id, title: { en: t.title.en, ja: t.title.ja }, color: null, rank: RANK(id) });
  }
  return typeIdx.get(id);
};
const useDir = (id) => {
  if (!dirIdx.has(id)) {
    const d = dirsAll.find((x) => x.id === id);
    dirIdx.set(id, dirs.length);
    dirs.push({ id, title: { en: d.title.en, ja: d.title.ja } });
  }
  return dirIdx.get(id);
};
// pre-register direction ids used by the lines' ascending/descending so indexes are stable
for (const l of lines) { useDir(l.ascending); useDir(l.descending); }
for (const l of lines) { l.ascending = dirIdx.get(l.ascending); l.descending = dirIdx.get(l.descending); }

const toSec = (hhmm, prev) => {
  if (hhmm == null) return null;
  let [h, m] = hhmm.split(':').map(Number);
  if (h < 3) h += 24; // service day turns over at 03:00 JST
  let s = h * 3600 + m * 60;
  if (prev != null && s < prev) s = prev; // an MT3D typo going backwards inside a run: clamp (as model.js)
  return s;
};

const runs = [];
for (const id of LINE_IDS) {
  const li = lines.findIndex((l) => l.id === id);
  const all = JSON.parse(readFileSync(join(MT3D, 'train-timetables', TT_FILES[id]), 'utf8'));
  for (const r of all) {
    if (!r.id.endsWith('.' + CAL)) continue;
    let prev = null;
    const stops = r.tt.map((e) => {
      const a = toSec(e.a, prev); if (a != null) prev = a;
      const d = toSec(e.d, prev); if (d != null) prev = d;
      return { s: stationIdx.get(e.s), a, d };
    });
    if (stops.some((x) => x.s == null)) throw new Error('stop not in fixture: ' + r.id);
    runs.push({
      id: r.id, key: r.t, line: li, type: useType(r.y), dir: useDir(r.d), number: r.n,
      // as the timetable build's tt.js: from / to empty where MT3D gives no origin / destination (Yamanote loop runs)
      from: (r.os || []).map((s) => stationIdx.get(s) ?? -1),
      to: (r.ds || []).map((s) => stationIdx.get(s) ?? -1),
      stops, next: r.nt || [], prev: r.pt || [], cars: null,
    });
  }
}

// --- write the module (compact stop arrays, expanded on import) ---
const runRows = runs.map((r) => [r.id, r.key, r.line, r.type, r.dir, r.number, r.from, r.to,
  r.stops.flatMap((x) => [x.s, x.a == null ? -1 : x.a / 60, x.d == null ? -1 : x.d / 60]), r.next, r.prev, r.cars]);

// data provenance for the credits
const { name: srcName, ref: srcRef, date: srcDate, obtained: srcObtained } = mt3dSource();
const meta = { source: { name: srcName, ref: srcRef, date: srcDate, obtained: srcObtained } };
const model = { calendar: 'holiday', meta, operators: OPERATORS, lines, stations, groups, types, dirs };
const out = `// GENERATED by build-mini.mjs (npm run data) - do not edit by hand.
// Fixture: JR-East.Yamanote + TokyoMetro.Ginza, MT3D SaturdayHoliday timetable (= our 'holiday' calendar).
// Data from Mini Tokyo 3D (c) Akihiko Kusanagi, MIT licence. Indexes are COMPACT to this slice.
// Shape = docs/ARCHITECTURE.md "In memory": export { model, runs }.
// Extra (non-contract) line fields: ascending / descending = dir index for travel along line.stations up / down.
export const model = ${JSON.stringify(model)};
const RUNS = ${JSON.stringify(runRows)};
export const runs = RUNS.map(([id, key, line, type, dir, number, from, to, st, next, prev, cars]) => {
  const stops = [];
  for (let i = 0; i < st.length; i += 3) {
    stops.push({ s: st[i], a: st[i + 1] < 0 ? null : st[i + 1] * 60, d: st[i + 2] < 0 ? null : st[i + 2] * 60 });
  }
  // extra fields as tt.js: cal, part, names, vehicle, first, last, until (= next run's first departure if later)
  let first = Infinity, last = -Infinity;
  for (const x of stops) for (const t of [x.a, x.d]) if (t !== null) { if (t < first) first = t; if (t > last) last = t; }
  return { id, key, line, type, dir, number, from, to, stops, next, prev, cars, cal: 'holiday', part: 0, names: null,
    vehicle: null, first, last, until: last };
});
for (const r of runs) { // until: standing at the terminal until the next run leaves
  const nx = r.next.length ? runs.find((x) => x.id === r.next[0]) : null;
  if (nx && nx.first > r.last) r.until = nx.first;
}
export default { model, runs };
`;
writeFileSync(join(HERE, 'mini.js'), out);
console.log('mini.js', (out.length / 1024).toFixed(0) + ' KB', 'lines', lines.length, 'stations', stations.length,
  'groups', groups.length, 'types', types.length, 'dirs', dirs.length, 'runs', runs.length,
  lines.map((l) => `${l.id} ${l.length} m chain ${l.chain.join(',')}`).join('\n'));
