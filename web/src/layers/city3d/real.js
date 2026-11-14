// 3D view: the REAL tunnel data, when the data build made it.
//   - elev-v2.json: per MT3D line id { profile: [[m, depthM, c?],...] on OUR
//     chain metric (network-v1 line.path, as elev-v1), c 0 sourced / 1 derived / 2 estimated; stations: [{ id, depthM,
//     level?, conf }]; sections: [{ fromM, toM, type: 'shield' | 'box' | 'natm' | 'tube' | 'unknown', bores, sizeM,
//     heightM?, conf }] }. A line without it keeps elev-v1.
//   - tunnels-v1: per line, OSM tracks (one per bore where mapped) with our chain
//     metres per vertex: the bores follow the real alignment instead of our simplified line path.
// Pure functions (tests: underground.test.mjs); index.js / bores.js use them.
//
// export function patchProfiles(net, profiles, elev2) -> { profiles, conf(lineIdx, m) -> 0 | 1 | 2, section(lineIdx, m) ->
//   shape key | null, station(stationIdx) -> { depthM, conf, level } | null, lines: count }
// export function shapeKey(section) -> 'shield2' | 'shield1' | 'mini' | 'box' | 'shield2@7.0' | 'box@10.0' ...
// export function parseShape(key) -> SHAPES-like object

import { parseShape } from './bores.js';

export { parseShape };

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** A line's elev-v2 entry from the pack (lines map, or the pack keyed by line id directly). */
function entryOf(pack, id) {
  if (!pack || typeof pack !== 'object') return null;
  const L = pack.lines && typeof pack.lines === 'object' ? pack.lines : pack;
  const e = L[id];
  return e && typeof e === 'object' ? e : null;
}

/** shield + 2 bores -> 'shield2' (+ '@<diameter>' when the section gives a size); box -> 'box' ('@<width>'); NATM = one
 * mined bore ('shield1'), immersed tube = a box; unknown -> null (the estimate stays). */
export function shapeKey(sec) {
  if (!sec || typeof sec !== 'object') return null;
  const t = String(sec.type || '').toLowerCase(), size = num(sec.sizeM);
  let base = null;
  if (t === 'shield') base = (sec.bores | 0) === 1 ? 'shield1' : 'shield2';
  else if (t === 'natm') base = 'shield1';
  else if (t === 'box' || t === 'tube' || t === 'cut' || t === 'cutandcover') base = 'box';
  if (!base) return null;
  return size && size > 3 && size < 25 ? `${base}@${size.toFixed(1)}` : base;
}

/** Depth floor for drawing (m): elev-v2.1 runs station-less mountain tunnels straight between their portals, deep under
 * hills (Sotobo -113 m); the underground view clamps there and leaves lines without underground stations out. */
export const DEPTH_FLOOR = -50;
/** An open-air bridge lower than this over the valley floor is a DEM limit (no data over water, Ochanomizu 1.0 m): drawn
 * at OPEN_AIR_M, modelled. */
export const OPEN_AIR_MIN = 3, OPEN_AIR_M = 6;

/** elev-v2(.1) over elev-v1. 2.1 (rev '2.1'): profile [[m, depthM, groundM, trackTP, conf 's' | 'd' | 'm']] inside its
 * `runs` (tunnels); outside them `above` (elev-v1's above-ground ranges) or 0; `openAir` [[from, to, heightM, src]] =
 * open stretches between portals (no tube there). 2.0: profile [[m, depthM]] + stations' conf. Returns profiles whose
 * at(m) follows it (clamped at DEPTH_FLOOR), each point's confidence (0 sourced, 1 derived, 2 modelled / estimated), the
 * section shape at m, the stations' depths, open-air stretches and whether a line belongs in the underground view. */
export function patchProfiles(net, profiles, elev2) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const out = profiles.slice();
  const confs = new Array(lines.length).fill(null), secs = new Array(lines.length).fill(null), opens = new Array(lines.length).fill(null);
  const ugLine = new Array(lines.length).fill(true);
  const stByIx = new Map();
  let n = 0;
  if (!elev2) return { profiles: out, conf: () => 2, section: () => null, station: () => null, openAir: () => null, shown: () => true, lines: 0, rev: null };
  const stIndex = new Map();
  (net.stations || []).forEach((s, i) => { if (s?.id) stIndex.set(s.id, i); });
  const LC = { s: 0, d: 1, m: 2, sourced: 0, derived: 1, modelled: 2, estimated: 2 };
  for (let i = 0; i < lines.length; i++) {
    // the underground view shows lines with an underground station; long rural mountain tunnels stay out
    const line = lines[i];
    ugLine[i] = !!line.underground || (line.stations || []).some((x) => net.stations?.[x]?.underground);
    const e = entryOf(elev2, line.id);
    if (!e) continue;
    const sts = (Array.isArray(e.stations) ? e.stations : []).filter((x) => num(x?.m) != null).map((x) => [x.m, LC[x.conf] ?? 2]).sort((a, b) => a[0] - b[0]);
    const nearC = (m) => { let c = 2, d = Infinity; for (const [sm, sc] of sts) { const dd = Math.abs(sm - m); if (dd < d) { d = dd; c = sc; } } return d <= 600 ? c : 2; };
    const P = (Array.isArray(e.profile) ? e.profile : []).map((p) => {
      if (!Array.isArray(p)) return [num(p?.m), num(p?.depthM ?? p?.d), num(p?.c)];
      // 2.1: [m, depth, ground, trackTP, 's'|'d'|'m']; 2.0: [m, depth]; tests: [m, depth, c]
      const c = p.length >= 5 ? LC[p[4]] ?? 2 : p.length === 3 ? num(p[2]) : null;
      return [num(p[0]), num(p[1]), c];
    }).filter((p) => p[0] != null && p[1] != null).sort((a, b) => a[0] - b[0]);
    for (const p of P) if (p[2] == null) p[2] = nearC(p[0]);
    const runs = Array.isArray(e.runs) ? e.runs.filter((r) => Array.isArray(r) && num(r[0]) != null && num(r[1]) != null).map((r) => [r[0], r[1]]) : null;
    const above = Array.isArray(e.above) ? e.above.filter((r) => Array.isArray(r) && r.length >= 3) : null;
    const oa = Array.isArray(e.openAir) ? e.openAir.filter((r) => Array.isArray(r) && num(r[0]) != null && num(r[1]) != null).map((r) => {
      const h = num(r[2]) ?? 0, modelled = h < OPEN_AIR_MIN || r[3] === 'dem';
      return { from: r[0], to: r[1], h: h < OPEN_AIR_MIN ? OPEN_AIR_M : h, src: r[3] || null, modelled };
    }) : [];
    opens[i] = oa.length ? oa : null;
    if (P.length >= 2) {
      const v1 = profiles[i];
      const m0 = P[0][0], m1 = P[P.length - 1][0];
      let lo = 0;
      const inRun = (m) => { if (!runs) return m >= m0 && m <= m1; for (const r of runs) if (m >= r[0] && m <= r[1]) return true; return false; };
      const aboveAt = (m) => { if (above) { for (const r of above) if (m >= r[0] && m <= r[1]) return r[2]; return 0; } return v1 ? Math.max(0, v1.at(m)) : 0; };
      const at = (m) => {
        if (!inRun(m)) {
          for (const o of oa) if (m >= o.from && m <= o.to) return 0;   // open-air: the track at its portals' level (no tube)
          return runs ? aboveAt(m) : (v1 ? v1.at(m) : 0);
        }
        let a = 0, b = P.length - 1;
        if (lo < b && P[lo][0] <= m && P[lo + 1][0] >= m) { a = lo; b = lo + 1; }
        else { while (b - a > 1) { const c = (a + b) >> 1; if (P[c][0] <= m) a = c; else b = c; } lo = a; }
        const f = P[b][0] > P[a][0] ? (m - P[a][0]) / (P[b][0] - P[a][0]) : 0;
        const d = P[a][1] + (P[b][1] - P[a][1]) * f;
        return d < DEPTH_FLOOR ? DEPTH_FLOOR : d;
      };
      let min = v1 ? v1.min : 0, max = v1 ? v1.max : 0;
      for (const p of P) { const d = Math.max(DEPTH_FLOOR, p[1]); if (d < min) min = d; if (d > max) max = d; }
      out[i] = { ...(v1 || {}), at, min, max, v2: true };
      confs[i] = P;
      n++;
    }
    if (Array.isArray(e.sections) && e.sections.length) {
      secs[i] = e.sections.map((s) => ({ from: num(s.fromM) ?? -Infinity, to: num(s.toM) ?? Infinity, key: shapeKey(s), conf: s.conf || 'estimated' }))
        .filter((s) => s.key).sort((a, b) => a.from - b.from);
    }
    for (const s of Array.isArray(e.stations) ? e.stations : []) {
      const ix = stIndex.get(s?.id);
      if (ix == null || num(s.depthM) == null) continue;
      stByIx.set(ix, { depthM: s.depthM, conf: s.conf || 'estimated', level: s.level || null, groundM: num(s.groundM) });
    }
  }
  return {
    profiles: out,
    lines: n,
    rev: elev2.rev || null,
    /** 0 sourced, 1 derived, 2 modelled / estimated: the nearest elev-v2 point's, else 2 (elev-v1 is an estimate). */
    conf(i, m) {
      const P = confs[i];
      if (!P) return 2;
      let best = 2, bd = Infinity;
      let a = 0, b = P.length - 1;
      while (b - a > 1) { const c = (a + b) >> 1; if (P[c][0] <= m) a = c; else b = c; }
      for (const k of [a, b]) { const d = Math.abs(P[k][0] - m); if (d < bd) { bd = d; best = P[k][2]; } }
      return best;
    },
    /** The section shape key at m on line i (elev-v2), or null (the estimate). */
    section(i, m) {
      const L = secs[i];
      if (!L) return null;
      for (const s of L) if (m >= s.from && m <= s.to) return s.key;
      return null;
    },
    station: (ix) => stByIx.get(ix) || null,
    /** The line's open-air stretches (no tube; a deck over the gap): [{ from, to, h (m over the valley), modelled }] | null. */
    openAir: (i) => opens[i],
    /** Whether line i belongs in the underground view (an underground station; else mountain tunnels only: left out). */
    shown: (i) => ugLine[i],
    /** Whether chain m on line i is on an open-air stretch (between two portals: a subway train there stays solid). */
    inOpen(i, m) { const L = opens[i]; if (!L) return false; for (const o of L) if (m >= o.from && m <= o.to) return true; return false; },
  };
}

/** tunnels-v1 -> per line index the OSM tracks in OUR local metres:
 * { x: Float64Array, y, m (chain), off (mean lateral offset, m: < 0 = left of increasing chain), twin, from, to }. Only
 * lines whose OSM tracks cover >= minCov of their underground length (else the line path stays: an estimate). */
export function localTracks(net, decoded, toLocal, { minCov = 0.75 } = {}) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const out = new Array(lines.length).fill(null);
  if (!decoded?.lines) return out;
  const P = [0, 0];
  for (let i = 0; i < lines.length; i++) {
    const L = decoded.lines[lines[i].id];
    if (!L || !Array.isArray(L.tracks)) continue;
    const cov = L.cov?.ugM > 0 ? L.cov.covM / L.cov.ugM : 0;
    if (cov < minCov) continue;
    const tr = [];
    for (const t of L.tracks) {
      if (t.aux || t.svc || !t.m || !Array.isArray(t.coords) || t.coords.length < 2) continue;
      const n = Math.min(t.coords.length, t.m.length);
      const x = new Float64Array(n), y = new Float64Array(n), m = new Float64Array(n);
      for (let k = 0; k < n; k++) { toLocal(t.coords[k][0], t.coords[k][1], P); x[k] = P[0]; y[k] = P[1]; m[k] = t.m[k]; }
      tr.push({ x, y, m, n, off: t.off || 0, twin: !!t.twin, from: Math.min(m[0], m[n - 1]), to: Math.max(m[0], m[n - 1]), level: t.level || null });
    }
    if (tr.length) out[i] = tr;
  }
  return out;
}

/** The track a train heading `dir` (1 = up the chain) uses at chain m: a twin track on its side (keep left = negative
 * off when heading up), else any track covering m. */
export function trackFor(tracks, m, dir) {
  if (!tracks) return null;
  let best = null, bs = -Infinity;
  for (const t of tracks) {
    if (m < t.from - 5 || m > t.to + 5) continue;
    const s = t.twin ? (Math.sign(-t.off || 0) === (dir < 0 ? -1 : 1) ? 2 : 0) : 1;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

/** Position and heading on a track at chain m: out = [x, y, ux, uy] (heading = increasing chain). false if off it. */
export function trackPoint(t, m, out) {
  const { x, y, m: M, n } = t;
  const up = M[n - 1] >= M[0];
  let lo = 0, hi = n - 1;
  if (up ? m <= M[0] : m >= M[0]) { lo = 0; hi = 1; }
  else if (up ? m >= M[n - 1] : m <= M[n - 1]) { lo = n - 2; hi = n - 1; }
  else {
    while (hi - lo > 1) { const c = (lo + hi) >> 1; if ((M[c] <= m) === up) lo = c; else hi = c; }
  }
  const span = M[hi] - M[lo];
  let f = span !== 0 ? (m - M[lo]) / span : 0;
  f = f < 0 ? 0 : f > 1 ? 1 : f;
  const dx = x[hi] - x[lo], dy = y[hi] - y[lo], L = Math.hypot(dx, dy) || 1;
  out[0] = x[lo] + dx * f; out[1] = y[lo] + dy * f;
  // heading along increasing chain
  const sg = span >= 0 ? 1 : -1;
  out[2] = dx / L * sg; out[3] = dy / L * sg;
  return true;
}

/** tunnels-v1 platforms (OSM, per station: one polyline per platform edge or island) in our local metres, by line index:
 * [{ station (MT3D id), x: Float64Array, y, from, to (chain m), level }]. */
export function localPlatforms(net, decoded, toLocal) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const out = new Array(lines.length).fill(null);
  if (!decoded?.lines) return out;
  const P = [0, 0];
  for (let i = 0; i < lines.length; i++) {
    const L = decoded.lines[lines[i].id];
    if (!L || !Array.isArray(L.platforms) || !L.platforms.length) continue;
    const list = [];
    for (const p of L.platforms) {
      if (!Array.isArray(p.coords) || p.coords.length < 2 || !Array.isArray(p.m)) continue;
      const n = p.coords.length, x = new Float64Array(n), y = new Float64Array(n);
      for (let k = 0; k < n; k++) { toLocal(p.coords[k][0], p.coords[k][1], P); x[k] = P[0]; y[k] = P[1]; }
      list.push({ station: p.station, x, y, n, from: Math.min(p.m[0], p.m[1]), to: Math.max(p.m[0], p.m[1]), level: p.level || null });
    }
    if (list.length) out[i] = list;
  }
  return out;
}
