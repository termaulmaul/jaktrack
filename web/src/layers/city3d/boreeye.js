// 3D view, Fly: where the free camera's eye is among the bores (vehicles.js, each frame drawn while flying). Small and static (the 3D view's own chunk); the free camera itself (freecam.js) loads on
// the first Fly tap.
//
// export const NEAR_M
// export function boreIndex(runs, platforms) -> index; eyeIn(index, x, y, z, exag, k, out) -> out { inside, dist, line }

import { parseShape, CELL_M } from './bores.js';

// The free camera explores the tunnels freely: no collisions; the eye passes through walls, boxes, the street. Inside a bore's section (or a station box) vehicles.js
// draws the tunnel as from inside (bores.js u_lining: the concrete lining, closed crown, lamps, platforms), outside it
// the tube (line colour, glass crown); and the distance to the nearest bore keeps the zoom where the interiors draw.
/** Segments this far around a cell are indexed with it (>= freecam.js FLY.nearM: the distance that keeps D small). */
export const NEAR_M = 90;
/** The bores' segments (bores.js boreRuns: pts x, y, h (true rail level), mx, my, s; sec) and the station boxes
 * (underground.js platformList: x, y, h, ux, uy, len, line) per CELL_M cell plus NEAR_M around it, built on first use. */
export function boreIndex(runs = [], platforms = []) {
  const shapes = runs.map((r) => (r.open || r.platform || String(r.sec).startsWith('water') ? null : parseShape(r.sec)));
  const cells = new Map();
  function cell(cx, cy) {
    const key = (cx + 4096) * 8192 + (cy + 4096);
    let c = cells.get(key);
    if (c) return c;
    const x0 = cx * CELL_M - NEAR_M, y0 = cy * CELL_M - NEAR_M, x1 = (cx + 1) * CELL_M + NEAR_M, y1 = (cy + 1) * CELL_M + NEAR_M;
    const seg = [], st = [];
    for (let ri = 0; ri < runs.length; ri++) {
      if (!shapes[ri]) continue;
      const P = runs[ri].pts, n = runs[ri].n;
      for (let v = 0; v + 1 < n; v++) {
        const o = v * 6, ax = P[o], ay = P[o + 1], bx = P[o + 6], by = P[o + 7];
        if ((ax > bx ? ax : bx) < x0 || (ax < bx ? ax : bx) > x1 || (ay > by ? ay : by) < y0 || (ay < by ? ay : by) > y1) continue;
        seg.push(ax, ay, bx, by, P[o + 2], P[o + 8], ri);
      }
    }
    for (const p of platforms || []) if (p.x > x0 - 150 && p.x < x1 + 150 && p.y > y0 - 150 && p.y < y1 + 150) st.push(p.x, p.y, p.h, p.ux, p.uy, p.len || 150, p.line ?? -1);
    c = { seg: new Float64Array(seg), st: new Float64Array(st) };
    cells.set(key, c);
    if (cells.size > 16) cells.delete(cells.keys().next().value);   // the oldest
    return c;
  }
  return { runs, shapes, cell };
}
function inSection(S, l, v) {
  if (S.kind === 'box') return l >= -S.w / 2 && l <= S.w / 2 && v >= -S.floor && v <= S.h - S.floor;
  const cz = S.r - S.invert, r2 = S.r * S.r;
  if (S.bores === 2) { const cx = S.r + S.gap / 2; return (l - cx) ** 2 + (v - cz) ** 2 <= r2 || (l + cx) ** 2 + (v - cz) ** 2 <= r2; }
  return l * l + (v - cz) ** 2 <= r2;
}
/**
 * Where the eye (x, y local m, z drawn m) is among the bores, as drawn (depth x exag, sections x k, bores.js's u_exag /
 * u_k): out.inside (in a bore's or box's section, or a station box), out.dist (m to the nearest bore's middle), out.line
 * (the line it is inside, -1). No allocation.
 */
export function eyeIn(I, x, y, z, exag = 1, k = 1, out = {}) {
  let inside = false, best = Infinity, line = -1;
  const c = I.cell(Math.floor(x / CELL_M), Math.floor(y / CELL_M));
  const S = c.seg;
  for (let i = 0; i < S.length; i += 7) {
    const ax = S[i], ay = S[i + 1], dx = S[i + 2] - ax, dy = S[i + 3] - ay, L2 = dx * dx + dy * dy;
    if (!(L2 > 1e-6)) continue;
    let t = ((x - ax) * dx + (y - ay) * dy) / L2;
    const L = Math.sqrt(L2), over = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - (ax + dx * t), ey = y - (ay + dy * t);
    const lat = (-dy * ex + dx * ey) / L;                     // left of the way +
    const vz = z - (S[i + 4] + (S[i + 5] - S[i + 4]) * t) * exag;   // over the drawn rail level
    const d = Math.sqrt(lat * lat + over * over + (vz - 3 * k) * (vz - 3 * k));
    if (d < best) best = d;
    if (inside || over > 0.5) continue;
    const sh = I.shapes[S[i + 6]];
    if (sh && inSection(sh, lat / k, vz / k)) { inside = true; line = I.runs[S[i + 6]].line; }
  }
  // station boxes (underground.js's overview boxes: 20 m wide, 8 m high from 1 m under the rail, the station's length)
  const T = c.st;
  for (let i = 0; !inside && i < T.length; i += 7) {
    const ex = x - T[i], ey = y - T[i + 1];
    const along = ex * T[i + 3] + ey * T[i + 4], lat = -ex * T[i + 4] + ey * T[i + 3], vz = z - T[i + 2] * exag;
    if (along >= -T[i + 5] / 2 && along <= T[i + 5] / 2 && lat >= -10 * k && lat <= 10 * k && vz >= -k && vz <= 7 * k) { inside = true; line = T[i + 6]; }
  }
  out.inside = inside; out.dist = best; out.line = line;
  return out;
}
