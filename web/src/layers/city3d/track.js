// 3D view: track geometry and timetable placement for the 3D trains.
//
// Coordinates: a local frame in metres around a FIXED origin (Tokyo Station), x east, y north, z up, in Web Mercator
// units scaled to metres at the origin's latitude (so the GPU gets small float32 numbers and the camera matrix, built in
// float64 on the CPU, puts them exactly where MapLibre draws the map). Distances along a line are true metres (the
// chain of the network pack: line.chain, line.length), rescaled to this module's own measure of the path when the two differ.
//
// Placement is the fallback used when no position provider is handed in (model.js's model.position, or opts.trains): a run's
// stops (the run shape, docs/ARCHITECTURE.md) give a time at each station; between a departure and the next arrival the train eases out
// and in; it stands DWELL_S before an intermediate departure (MT3D gives departures only there).
//
// export const ORIGIN, S
// export function toLocal(lng, lat, out?) -> [x, y]
// export function toLngLat(x, y) -> [lng, lat]
// export function trackOf(line) -> Track { n, cum, x, y, length, loop, k }   (cached on the line object)
// export function pointAt(track, m, out) -> out [x, y, ux, uy] (position and unit direction of increasing m)
// export function serviceSec(ms) -> seconds since 00:00 WIB of the service day (turns over at 03:00 WIB)
// export function chainOf(run, line, track) -> Float64Array (metres along the track for each stop)
// export function placeRun(run, line, sec) -> { s, dir: 1 | -1, stand } | null

export const ORIGIN = Object.freeze({ lng: 106.8229, lat: -6.2003 });   // Tokyo Station
const C = 40075016.68557849;
const D2R = Math.PI / 180;
export const mercX = (lng) => (lng + 180) / 360;
export const mercY = (lat) => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
export const OX = mercX(ORIGIN.lng), OY = mercY(ORIGIN.lat);
export const S = C * Math.cos(ORIGIN.lat * D2R);   // local units (m at the origin) per Mercator unit

export function toLocal(lng, lat, out = [0, 0]) {
  out[0] = (mercX(lng) - OX) * S;
  out[1] = (OY - mercY(lat)) * S;
  return out;
}
export function toLngLat(x, y) {
  const mx = OX + x / S, my = OY - y / S;
  return [mx * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * my) * Math.PI)) - 90];
}

/** Great-circle-ish metres between two lng/lat points (equirectangular at their mean latitude: < 0.01 % off for the
 * short segments of a track). */
export function metres(a, b) {
  const k = Math.cos(((a[1] + b[1]) / 2) * D2R);
  const dx = (b[0] - a[0]) * 111319.49 * k, dy = (b[1] - a[1]) * 110946.26;
  return Math.hypot(dx, dy);
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** The line's track: cumulative true metres and local coordinates per path vertex. k = this measure / the chain's. */
export function trackOf(line) {
  if (line.__c3track) return line.__c3track;
  const path = Array.isArray(line.path) ? line.path : [];
  const n = path.length;
  const cum = new Float64Array(n), x = new Float64Array(n), y = new Float64Array(n);
  const p = [0, 0];
  for (let i = 0; i < n; i++) {
    toLocal(path[i][0], path[i][1], p);
    x[i] = p[0]; y[i] = p[1];
    if (i) cum[i] = cum[i - 1] + metres(path[i - 1], path[i]);
  }
  const length = n ? cum[n - 1] : 0;
  const chainLen = isNum(line.length) && line.length > 0 ? line.length : length;
  const t = { n, cum, x, y, length, loop: !!line.loop, k: chainLen > 0 ? length / chainLen : 1 };
  Object.defineProperty(line, '__c3track', { value: t, enumerable: false, configurable: true });
  return t;
}

/** Position and unit direction (of increasing m) at m metres along the track; past the ends it carries on straight
 * (loops wrap). */
export function pointAt(t, m, out = [0, 0, 1, 0]) {
  const n = t.n;
  if (n < 2) { out[0] = n ? t.x[0] : 0; out[1] = n ? t.y[0] : 0; out[2] = 1; out[3] = 0; return out; }
  if (t.loop && t.length > 0) { m %= t.length; if (m < 0) m += t.length; }
  let i;
  if (m <= 0) i = 1;
  else if (m >= t.length) i = n - 1;
  else {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t.cum[mid] <= m) lo = mid; else hi = mid; }
    i = hi;
  }
  // skip zero-length segments for the direction
  let a = i - 1, b = i;
  while (a > 0 && t.cum[b] - t.cum[a] < 1e-6) a--;
  while (b < n - 1 && t.cum[b] - t.cum[a] < 1e-6) b++;
  const seg = t.cum[b] - t.cum[a];
  const dx = t.x[b] - t.x[a], dy = t.y[b] - t.y[a];
  const dl = Math.hypot(dx, dy) || 1;
  const f = seg > 0 ? (m - t.cum[a]) / seg : 0;
  out[0] = t.x[a] + dx * f;
  out[1] = t.y[a] + dy * f;
  out[2] = dx / dl; out[3] = dy / dl;
  return out;
}

// ------------------------------------------------------------------ timetable placement (fallback)
export const DWELL_S = 25, PRE_S = 60, POST_S = 40;
const JST_MS = 7 * 3600e3;

/** Seconds since 00:00 WIB of the service day: before 03:00 WIB it is still the day before (so >= 86400). */
export function serviceSec(ms) {
  const d = new Date(ms + JST_MS);
  let s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds() + d.getUTCMilliseconds() / 1000;
  if (s < 3 * 3600) s += 86400;
  return s;
}

const ease = (f) => (f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f));

/** Metres along the track (this module's measure) for each stop of a run on its line. Loops: the first match; open
 * lines with a station listed twice: the match nearest the stop before. */
export function chainOf(run, line, t = trackOf(line)) {
  if (run.__c3chain) return run.__c3chain;
  const st = Array.isArray(line.stations) ? line.stations : [];
  const ch = Array.isArray(line.chain) ? line.chain : [];
  const stops = Array.isArray(run.stops) ? run.stops : [];
  const out = new Float64Array(stops.length).fill(NaN);
  let prev = NaN;
  for (let k = 0; k < stops.length; k++) {
    let best = NaN;
    for (let j = 0; j < st.length; j++) {
      if (st[j] !== stops[k].s || !isNum(ch[j])) continue;
      const m = ch[j] * t.k;
      if (Number.isNaN(best)) { best = m; if (t.loop || Number.isNaN(prev)) break; continue; }
      if (Math.abs(m - prev) < Math.abs(best - prev)) best = m;
    }
    out[k] = best;
    if (!Number.isNaN(best)) prev = best;
  }
  Object.defineProperty(run, '__c3chain', { value: out, enumerable: false, configurable: true });
  return out;
}

/** Arrival and departure second at each stop (filled in where the timetable gives one of the two). */
export function timesOf(run) {
  if (run.__c3times) return run.__c3times;
  const stops = Array.isArray(run.stops) ? run.stops : [];
  const n = stops.length;
  const arr = new Float64Array(n), dep = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = stops[k].a, d = stops[k].d;
    const D = isNum(d) ? d : isNum(a) ? a : NaN;
    let A = isNum(a) ? a : D;
    if (!isNum(a) && k > 0 && isNum(D) && isNum(dep[k - 1])) A = Math.max(dep[k - 1] + 0.6 * (D - dep[k - 1]), D - DWELL_S);
    arr[k] = A; dep[k] = k === n - 1 && isNum(a) ? a : D;
  }
  const t = { arr, dep, first: n ? arr[0] : NaN, last: n ? dep[n - 1] : NaN };
  Object.defineProperty(run, '__c3times', { value: t, enumerable: false, configurable: true });
  return t;
}

/** Where a run is at service second sec: metres along its line's chain (the network pack's measure), which way it heads (1 = up
 * the chain), standing or not. */
export function placeRun(run, line, sec) {
  const tm = timesOf(run);
  const n = tm.arr.length;
  if (n < 2 || !(sec >= tm.first - PRE_S && sec <= tm.last + POST_S)) return null;
  const t = trackOf(line);
  const c = chainOf(run, line, t);
  const L = t.length;
  const delta = (a, b) => {
    let d = b - a;
    if (t.loop && L > 0) { d = ((d + L / 2) % L + L) % L - L / 2; }
    return d;
  };
  // the leg it is on: the last stop departed at or before sec
  let k = 0;
  while (k < n - 1 && !(sec < tm.arr[k + 1])) k++;
  if (Number.isNaN(c[k])) return null;
  if (sec <= tm.dep[k] || k === n - 1) {
    // at the platform: heading for the next stop (or from the one before at the end)
    const j = k < n - 1 ? k + 1 : k - 1;
    const d = Number.isNaN(c[j]) ? 1 : (k < n - 1 ? delta(c[k], c[j]) : delta(c[j], c[k]));
    return { s: c[k] / t.k, dir: d >= 0 ? 1 : -1, stand: true, leg: k };
  }
  const c1 = c[k + 1];
  if (Number.isNaN(c1)) return null;
  const T = tm.arr[k + 1] - tm.dep[k];
  const f = T > 0 ? ease((sec - tm.dep[k]) / T) : 1;
  const d = delta(c[k], c1);
  let s = c[k] + d * f;
  if (t.loop && L > 0) s = ((s % L) + L) % L;
  return { s: s / t.k, dir: d >= 0 ? 1 : -1, stand: false, leg: k };
}
