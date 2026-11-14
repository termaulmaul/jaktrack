// 3D view: how high each line's track runs, metre by metre along the line.
//
// Source of truth is the heights build's var/static/tokyo/elev-v1.json (served at /data/tokyo/elev-v1.json): per line, ranges along
// its chain [fromM, toM, metres above ground] (negative = underground; docs/DATA.md). Until that file exists (or
// for a line it leaves out) a heuristic stands in:
//   - monorails, Yurikamome, Nippori-Toneri Liner, New Shuttle, Kanazawa Seaside Line: up on a viaduct all along;
//   - a line MT3D marks underground: below ground at its underground stations, at grade at its surface stations
//     (station.underground), ramping between the two;
//   - everything else at grade (the heights build knows the JR viaducts; the heuristic does not guess them).
// Steps between ranges become ramps (RAMP_PER_M metres of track per metre of height, at least RAMP_MIN_M), so a train
// climbing to a viaduct or diving into a tunnel tilts with the track and never jumps.
//
// export const ELEV_URL
// export function profiles(net, elev?) -> Profile[] (one per line index)
//   Profile = { id, source: 'elev' | 'heuristic', xs: Float64Array (m along chain), hs: Float64Array (m),
//               min, max, at(m) -> metres (linear between breakpoints, flat beyond the ends) }
// export function rangesOf(elev, line, i) -> [[from, to, h], ...] | null   (the file's ranges for one line, any layout)
// export function heuristicRanges(net, i) -> [[from, to, h], ...]
// export function breakpoints(ranges, length) -> { xs, hs } (ramps put in, sorted)

export const ELEV_URL = '/data/tokyo/elev-v1.json';
export const VIADUCT_M = 12;      // a monorail / guideway deck's height (m above ground) in the heuristic
export const DEPTH_M = -18;       // a subway's depth (m) in the heuristic (Oedo runs deeper; the heights build knows)
export const RAMP_PER_M = 30;     // m of track per m of height (about 3.3 %)
export const RAMP_MIN_M = 60;

/** Lines that run on a guideway or viaduct from end to end (MT3D railway ids). */
export const ELEVATED = new Set([
  'Yurikamome.Yurikamome', 'Toei.NipporiToneri', 'SaitamaTransit.NewShuttle', 'YokohamaSeaside.KanazawaSeaside',
  'TokyoMonorail.HanedaAirport', 'TamaMonorail.TamaMonorail', 'ChibaMonorail.Line1', 'ChibaMonorail.Line2',
  'ShonanMonorail.ShonanMonorail',
]);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Clean list of [from, to, h] (numbers, from < to), or null. */
function clean(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const r of list) {
    const v = Array.isArray(r) ? r : r && typeof r === 'object' ? [r.from ?? r.f ?? r[0], r.to ?? r.t ?? r[1], r.h ?? r.m ?? r[2]] : null;
    if (!v || !isNum(+v[0]) || !isNum(+v[1]) || !isNum(+v[2])) continue;
    const a = +v[0], b = +v[1];
    if (b > a) out.push([a, b, +v[2]]);
  }
  out.sort((p, q) => p[0] - q[0]);
  return out;
}

/** The file's ranges for line i (id line.id), whatever layout the heights build picks: { lines: { id: ranges } }, { lines: [ranges
 * by index] }, { lines: [{ id, ranges }] }, or { id: ranges } at the top. null = the file says nothing of this line. */
export function rangesOf(elev, line, i) {
  if (!elev || typeof elev !== 'object') return null;
  const L = elev.lines ?? elev.railways ?? null;
  const id = line?.id;
  let got;
  if (Array.isArray(L)) {
    const byId = id != null ? L.find((x) => x && !Array.isArray(x) && x.id === id) : null;
    got = byId ? (byId.ranges ?? byId.r) : (Array.isArray(L[i]) ? L[i] : (L[i]?.id === id ? (L[i].ranges ?? L[i].r) : undefined));
  } else if (L && typeof L === 'object') {
    got = L[id];
    if (got && !Array.isArray(got)) got = got.ranges ?? got.r;
  } else if (id != null && Array.isArray(elev[id])) {
    got = elev[id];
  }
  return got == null ? null : clean(got);
}

/** The heuristic's ranges for line i of the network. */
export function heuristicRanges(net, i) {
  const line = net.lines[i];
  const len = lengthOf(line);
  if (!(len > 0)) return [];
  if (ELEVATED.has(line.id)) return [[0, len, VIADUCT_M]];
  if (!line.underground) return [];
  const st = Array.isArray(line.stations) ? line.stations : [];
  const chain = Array.isArray(line.chain) ? line.chain : [];
  // each station holds its own height to halfway to its neighbours
  const pts = [];
  for (let k = 0; k < st.length; k++) {
    const m = chain[k];
    if (!isNum(m)) continue;
    const s = net.stations?.[st[k]];
    pts.push([m, s && s.underground === false ? 0 : DEPTH_M]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  if (!pts.length) return [[0, len, DEPTH_M]];
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const from = k === 0 ? 0 : (pts[k - 1][0] + pts[k][0]) / 2;
    const to = k === pts.length - 1 ? len : (pts[k][0] + pts[k + 1][0]) / 2;
    if (to <= from) continue;
    const h = pts[k][1];
    const last = out[out.length - 1];
    if (last && last[2] === h && Math.abs(last[1] - from) < 1e-6) last[1] = to;
    else out.push([from, to, h]);
  }
  return out.filter((r) => r[2] !== 0);
}

/** Breakpoints of the height along a line: the ranges as plateaus, ground (0) in the gaps, each step a ramp centred on
 * the step and never longer than the plateaus beside it allow. */
export function breakpoints(ranges, length) {
  // plateaus covering [0, length]: gaps are ground
  const plat = [];
  let at = 0;
  for (const [a0, b0, h] of ranges || []) {
    const a = Math.max(0, a0), b = Math.min(length > 0 ? length : b0, b0);
    if (b <= a) continue;
    if (a > at) plat.push([at, a, 0]);
    const start = Math.max(a, at);
    if (b > start) plat.push([start, b, h]);
    at = Math.max(at, b);
  }
  if (length > at) plat.push([at, length, 0]);
  // merge neighbours of the same height
  const P = [];
  for (const p of plat) {
    const q = P[P.length - 1];
    if (q && q[2] === p[2]) q[1] = p[1]; else P.push([...p]);
  }
  const xs = [], hs = [];
  if (!P.length) return { xs: Float64Array.of(0), hs: Float64Array.of(0) };
  for (let k = 0; k < P.length; k++) {
    const [a, b, h] = P[k];
    let x0 = a, x1 = b;
    if (k > 0) {
      const r = Math.max(RAMP_MIN_M, Math.abs(h - P[k - 1][2]) * RAMP_PER_M) / 2;
      x0 = a + Math.min(r, (b - a) / 2, (P[k - 1][1] - P[k - 1][0]) / 2);
    }
    if (k < P.length - 1) {
      const r = Math.max(RAMP_MIN_M, Math.abs(h - P[k + 1][2]) * RAMP_PER_M) / 2;
      x1 = b - Math.min(r, (b - a) / 2, (P[k + 1][1] - P[k + 1][0]) / 2);
    }
    if (x1 < x0) x1 = x0;
    xs.push(x0); hs.push(h);
    if (x1 > x0) { xs.push(x1); hs.push(h); }
  }
  return { xs: Float64Array.from(xs), hs: Float64Array.from(hs) };
}

/** Linear interpolation over breakpoints (flat beyond the ends). */
export function interp(xs, hs, m) {
  const n = xs.length;
  if (!n) return 0;
  if (!(m > xs[0])) return hs[0];
  if (m >= xs[n - 1]) return hs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= m) lo = mid; else hi = mid; }
  const d = xs[hi] - xs[lo];
  return d > 0 ? hs[lo] + (hs[hi] - hs[lo]) * (m - xs[lo]) / d : hs[hi];
}

/** A line's length in metres: line.length, else its last chain entry. */
export function lengthOf(line) {
  if (isNum(line?.length) && line.length > 0) return line.length;
  const c = Array.isArray(line?.chain) ? line.chain : [];
  return c.length ? Math.max(...c.filter(isNum)) : 0;
}

/** One Profile per line of the network: the heights build's ranges where the file has the line, else the heuristic. */
export function profiles(net, elev = null) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  return lines.map((line, i) => {
    const fromFile = rangesOf(elev, line, i);
    const ranges = fromFile ?? heuristicRanges(net, i);
    const len = lengthOf(line);
    const { xs, hs } = breakpoints(ranges, len);
    let min = 0, max = 0;
    for (const h of hs) { if (h < min) min = h; if (h > max) max = h; }
    return { id: line.id, source: fromFile ? 'elev' : 'heuristic', xs, hs, min, max, length: len, at: (m) => interp(xs, hs, m) };
  });
}
