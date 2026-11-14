// Toei buses: route geometry for motion, ported unchanged in logic from trafik.live's bus map. Every Toei Bus GTFS shape in the local metric frame (util.js).
//
// Route geometry for motion: every GTFS shape in a metric frame (metres, X east / Y south, see util.js), with
// cumulative lengths and a coarse grid of segments. A bus report is matched to the nearest shape of its route that
// runs the way the bus is heading; the bus then travels along that shape between reports, so it follows the street
// around corners instead of cutting through blocks.
import { toX, toY, angDiff } from './util.js';

const CELL = 200; // m
const KEYW = 1 << 20;

export class ShapeIndex {
  constructor() {
    this.shapes = []; // {id, route, dir, n, xs, ys, cum, hs, len, flat}
    this.byRoute = new Map(); // route -> Set(shape index)
    this.byId = new Map(); // shape id -> shape index
    this.grid = new Map(); // cell key -> number[] packed (shape << 16 | seg)
  }

  get size() { return this.shapes.length; }

  /** shapes: [{id, route, flat: [lng, lat, ...]}] */
  build(list) {
    this.shapes = [];
    this.byRoute.clear();
    this.byId.clear();
    this.grid.clear();
    for (const s0 of list) {
      // keep shape i = list i (the store indexes shapes by pack position): a 1-point shape becomes 2 equal points,
      // an empty one a stub far from everything
      const s = s0.flat && s0.flat.length >= 4 ? s0 : { ...s0, flat: s0.flat && s0.flat.length >= 2 ? [...s0.flat.slice(0, 2), ...s0.flat.slice(0, 2)] : [0, 0, 0, 0] };
      const n = s.flat.length / 2;
      const xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n), hs = new Float32Array(n);
      for (let i = 0; i < n; i++) { xs[i] = toX(s.flat[i * 2]); ys[i] = toY(s.flat[i * 2 + 1]); }
      for (let i = 1; i < n; i++) {
        const dx = xs[i] - xs[i - 1], dy = ys[i] - ys[i - 1];
        cum[i] = cum[i - 1] + Math.hypot(dx, dy);
        hs[i - 1] = Math.atan2(dx, -dy);
      }
      hs[n - 1] = hs[Math.max(0, n - 2)];
      const si = this.shapes.length;
      if (si >= 32768 || n >= 65536) throw new Error(`bus shapes: index limits (${si} shapes, ${n} points)`);
      this.shapes.push({ id: s.id, route: s.route, dir: s.dir ?? 0, n, xs, ys, cum, hs, len: cum[n - 1], flat: s.flat });
      if (s.id != null) this.byId.set(s.id, si);
      let set = this.byRoute.get(s.route);
      if (!set) this.byRoute.set(s.route, (set = new Set()));
      set.add(si);
      for (let i = 0; i < n - 1; i++) {
        const x0 = Math.floor(Math.min(xs[i], xs[i + 1]) / CELL), x1 = Math.floor(Math.max(xs[i], xs[i + 1]) / CELL);
        const y0 = Math.floor(Math.min(ys[i], ys[i + 1]) / CELL), y1 = Math.floor(Math.max(ys[i], ys[i + 1]) / CELL);
        const packed = (si << 16) | i;
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
          const k = cx * KEYW + cy;
          const cell = this.grid.get(k);
          if (cell) cell.push(packed); else this.grid.set(k, [packed]);
        }
      }
    }
  }

  hasRoute(route) { return this.byRoute.has(route); }

  /**
   * Nearest point on any shape of `route` to (x, y) within `maxD` metres, preferring shapes that run along `hdg`
   * (radians, compass) when given. Returns {si, s, d} or null.
   */
  match(route, x, y, hdg, maxD = 60) {
    const set = this.byRoute.get(route);
    if (!set) return null;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = null, bestCost = Infinity;
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const cell = this.grid.get(ix * KEYW + iy);
      if (!cell) continue;
      for (let k = 0; k < cell.length; k++) {
        const si = cell[k] >>> 16;
        if (!set.has(si)) continue;
        const seg = cell[k] & 0xffff;
        const sh = this.shapes[si];
        const ax = sh.xs[seg], ay = sh.ys[seg], bx = sh.xs[seg + 1], by = sh.ys[seg + 1];
        const vx = bx - ax, vy = by - ay;
        const L2 = vx * vx + vy * vy;
        let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + vx * t, py = ay + vy * t;
        const d = Math.hypot(x - px, y - py);
        if (d > maxD) continue;
        let cost = d;
        if (hdg != null) {
          let a = Math.abs(sh.hs[seg] - hdg) % (Math.PI * 2);
          if (a > Math.PI) a = Math.PI * 2 - a;
          if (a > 1.75) cost += 45; // runs the other way (a two-way road, the shape of the other direction)
          else if (a > 0.9) cost += 12;
        }
        if (cost < bestCost) { bestCost = cost; best = { si, s: sh.cum[seg] + Math.sqrt(L2) * t, d }; }
      }
    }
    return best;
  }

  /** Nearest point on shape `si` to (x, y), searching only the stretch sMin..sMax. Returns {s, d} or null. */
  projectRange(si, x, y, sMin, sMax) {
    const sh = this.shapes[si];
    if (!sh) return null;
    let i = Math.max(0, this.segAt(sh, Math.max(0, sMin)));
    let best = null, bd = Infinity;
    for (; i < sh.n - 1; i++) {
      if (sh.cum[i] > sMax) break;
      const ax = sh.xs[i], ay = sh.ys[i], vx = sh.xs[i + 1] - ax, vy = sh.ys[i + 1] - ay;
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
      if (d < bd) { bd = d; best = { s: sh.cum[i] + Math.sqrt(L2) * t, d }; }
    }
    return best;
  }

  /**
   * Every place where shape `si` passes within `maxD` metres of (x, y): one candidate per pass {s, d, h} (h = the
   * shape's heading there), in along order. An out-and-back shape (e.g. 1-P23) passes the same street twice, so a
   * point can sit on two stretches of one shape; the caller picks by heading or by the last known along-distance.
   */
  passes(si, x, y, maxD = 60) {
    const sh = this.shapes[si];
    if (!sh) return [];
    const out = [];
    let cur = null;
    for (let i = 0; i < sh.n - 1; i++) {
      const ax = sh.xs[i], ay = sh.ys[i], vx = sh.xs[i + 1] - ax, vy = sh.ys[i + 1] - ay;
      const bx = ax + vx, by = ay + vy;
      // cheap reject: outside the segment's box grown by maxD
      if (x < (ax < bx ? ax : bx) - maxD || x > (ax > bx ? ax : bx) + maxD || y < (ay < by ? ay : by) - maxD || y > (ay > by ? ay : by) + maxD) {
        if (cur) { out.push(cur); cur = null; }
        continue;
      }
      const L2 = vx * vx + vy * vy;
      let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
      if (d > maxD) { if (cur) { out.push(cur); cur = null; } continue; }
      const c = { s: sh.cum[i] + Math.sqrt(L2) * t, d, h: sh.hs[i] };
      if (!cur || c.d < cur.d) cur = cur ? Object.assign(cur, c) : c;
    }
    if (cur) out.push(cur);
    return out;
  }

  /**
   * Along-distance of (x, y) on shape `si`: near `prevS` when given (searching back 120 m and forward `ahead` m, so a
   * bus on an out-and-back shape stays on its own stretch), else the pass that runs along heading `hdg` (radians),
   * else the first pass. Returns {s, d} or null when the shape is more than `maxD` away.
   */
  locate(si, x, y, { prevS = null, hdg = null, ahead = 1500, maxD = 120 } = {}) {
    if (prevS != null) {
      const r = this.projectRange(si, x, y, prevS - 120, prevS + ahead);
      if (r && r.d <= maxD) return r;
    }
    const ps = this.passes(si, x, y, maxD);
    if (!ps.length) return null;
    let best = ps[0], bc = Infinity;
    for (const p of ps) {
      // + 2 m per km along: at a terminal shared by the start and the end of an out-and-back shape both passes fit, and
      // a bus standing there is about to start the trip (a clear heading mismatch, 25-80 m, still wins mid-route)
      let c = p.d + p.s * 0.002;
      if (hdg != null) { const a = Math.abs(angDiff(p.h, hdg)); c += a > 1.75 ? 80 : a > 0.9 ? 25 : 0; }
      if (c < bc - 1e-6) { bc = c; best = p; }
    }
    return { s: best.s, d: best.d };
  }

  /** Distance (m) from (x, y) to the nearest shape whose index is in `set`, looking at most `maxD` away (else Infinity). */
  distTo(set, x, y, maxD = 60) {
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = Infinity;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iy = cy - r; iy <= cy + r; iy++) {
      const cell = this.grid.get(ix * KEYW + iy);
      if (!cell) continue;
      for (let k = 0; k < cell.length; k++) {
        const si = cell[k] >>> 16;
        if (!set.has(si)) continue;
        const seg = cell[k] & 0xffff;
        const sh = this.shapes[si];
        const ax = sh.xs[seg], ay = sh.ys[seg], vx = sh.xs[seg + 1] - ax, vy = sh.ys[seg + 1] - ay;
        const L2 = vx * vx + vy * vy;
        let t = L2 > 0 ? ((x - ax) * vx + (y - ay) * vy) / L2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + vx * t), y - (ay + vy * t));
        if (d < best) best = d;
      }
    }
    return best <= maxD ? best : Infinity;
  }

  /** [lng, lat] points of shape `si` from distance s0 to s1 (s0 < s1), ends interpolated. */
  slice(si, s0, s1) {
    const sh = this.shapes[si];
    if (!sh || !sh.flat) return [];
    s0 = Math.max(0, Math.min(s0, sh.len));
    s1 = Math.max(s0, Math.min(s1, sh.len));
    const f = sh.flat;
    const at = (s) => {
      const i = this.segAt(sh, s);
      const L = sh.cum[i + 1] - sh.cum[i];
      const t = L > 0 ? Math.min(1, Math.max(0, (s - sh.cum[i]) / L)) : 0;
      return [f[i * 2] + (f[i * 2 + 2] - f[i * 2]) * t, f[i * 2 + 1] + (f[i * 2 + 3] - f[i * 2 + 1]) * t];
    };
    const out = [at(s0)];
    let i = this.segAt(sh, s0) + 1;
    for (; i < sh.n && sh.cum[i] < s1; i++) out.push([f[i * 2], f[i * 2 + 1]]);
    out.push(at(s1));
    return out;
  }

  /** Index of the segment containing distance s. */
  segAt(sh, s) {
    const cum = sh.cum;
    let lo = 0, hi = sh.n - 1;
    if (s <= 0) return 0;
    if (s >= cum[hi]) return hi - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Point at distance s along shape si -> out.x, out.y (metres), out.h (heading, radians). */
  pointAt(si, s, out) {
    const sh = this.shapes[si];
    const i = this.segAt(sh, s);
    const L = sh.cum[i + 1] - sh.cum[i];
    let t = L > 0 ? (s - sh.cum[i]) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out.x = sh.xs[i] + (sh.xs[i + 1] - sh.xs[i]) * t;
    out.y = sh.ys[i] + (sh.ys[i + 1] - sh.ys[i]) * t;
    out.h = sh.hs[i];
    return out;
  }
}
