// Menyelaraskan lintasan rel dari berkas jadwal ke trase rel OpenStreetMap, supaya garis jalur, kereta, viaduk, dan
// terowongan berimpit dengan peta dasar. Dipakai data-build/jakarta.mjs per potongan rel antarstasiun; tanpa
// var/src/osm/rail.json lintasan sumber dipakai apa adanya.
//
// Cara: lintasan disampel tiap STEP m. Tiap titik hanya digeser MENYAMPING (tegak lurus arah lintasan) ke garis tengah
// rel OSM sejenis yang searah dalam R_SNAP m: rel terdekat, dan bila ada rel kembarannya 2-7 m di sebelahnya, tengah
// keduanya (jalur ganda digambar sebagai satu garis; dek viaduk 9 m menutup kedua rel). Pergeseran dihaluskan dengan
// median supaya garis tidak melompat di antara rel sejajar, lalu titik yang segaris dibuang (toleransi 0,5 m).
// Karena hanya menyamping, urutan dan jarak antarstasiun praktis tidak berubah. Data OSM: ODbL (lihat docs/ELEVASI.md).
import { indexWays } from './elev.mjs';

const STEP = 20, R_SNAP = 60, COS_MIN = 0.85, TWIN_MIN = 2, TWIN_MAX = 7, GAP_FILL = 200, MEDIAN = 5, SIMPLIFY = 0.5, R_MEASURE = 100, SLOPE = 0.12;

/** Buang titik yang segaris (Douglas-Peucker, tanpa rekursi). pts = [[x, y]] dalam meter. */
function simplify(pts, tol) {
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = pts[b][0] - pts[a][0], dy = pts[b][1] - pts[a][1], l = Math.hypot(dx, dy) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - pts[a][0]) * dy - (pts[i][1] - pts[a][1]) * dx) / l; if (d > fd) { fd = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** ways = elemen Overpass. Hasil: { snap(points, kind, zones?), offset(points, kind) }; points = [[lng, lat]]. */
export function snapper(ways) {
  const { xy, unxy, near } = indexWays(ways);
  // titik contoh sepanjang lintasan: [x, y, ux, uy] (arah potongannya), termasuk kedua ujung
  const sample = (points) => {
    const P = points.map(([lng, lat]) => xy(lng, lat)), cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const total = cum.at(-1), n = Math.max(1, Math.round(total / STEP)), out = [];
    for (let s = 0, v = 1; s <= n; s++) {
      const m = total * s / n;
      while (v < P.length - 1 && cum[v] < m) v++;
      const dx = P[v][0] - P[v - 1][0], dy = P[v][1] - P[v - 1][1], l = Math.hypot(dx, dy) || 1, f = (m - cum[v - 1]) / (cum[v] - cum[v - 1] || 1);
      out.push([P[v - 1][0] + dx * f, P[v - 1][1] + dy * f, dx / l, dy / l]);
    }
    return { out, total };
  };
  // rel searah di sekitar titik: [geser menyamping bertanda (m, + = kiri arah lintasan), jarak, tingkat]
  const around = (kind, [x, y, ux, uy], r) => {
    const out = [];
    for (const [x0, y0, x1, y1, lv] of near(kind, x, y)) {
      const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
      if (Math.abs(dx * ux + dy * uy) / Math.sqrt(l2) < COS_MIN) continue;
      const f = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2));
      const qx = x0 + dx * f - x, qy = y0 + dy * f - y, d = Math.hypot(qx, qy);
      if (d <= r) out.push([qx * -uy + qy * ux, d, lv]);
    }
    return out;
  };

  /**
   * Lintasan yang sudah diselaraskan. zones = [[lng, lat, radiusM]]: di dalamnya rel layang diutamakan (PREFER_UP).
   * Hasil: { points: [[lng, lat]], unmatched: meter lintasan tanpa rel OSM (dibiarkan di tempatnya) }.
   */
  function snap(points, kind, zones = []) {
    if (!(points.length > 1)) return { points, unmatched: 0 };
    const { out: S, total } = sample(points), step = total / (S.length - 1 || 1);
    const Z = zones.map(([lng, lat, r]) => [...xy(lng, lat), r]);
    const shift = S.map((p) => {
      let c = around(kind, p, R_SNAP + TWIN_MAX);
      if (Z.some(([zx, zy, r]) => Math.hypot(p[0] - zx, p[1] - zy) <= r) && c.some((x) => x[2] > 0)) c = c.filter((x) => x[2] > 0);
      let o0 = null;
      for (const [o, d] of c) if (d <= R_SNAP && (o0 === null || Math.abs(o) < Math.abs(o0))) o0 = o;
      if (o0 === null) return null;
      let mid = o0, twin = false;                      // kembaran: rel 2-7 m di sebelahnya; pilih yang tengahnya paling dekat ke lintasan
      for (const [o] of c) { const gap = Math.abs(o - o0); if (gap >= TWIN_MIN && gap <= TWIN_MAX && (!twin || Math.abs((o0 + o) / 2) < Math.abs(mid))) { mid = (o0 + o) / 2; twin = true; } }
      return mid;
    });
    // titik tanpa rel OSM: celah pendek mengikuti tetangganya (interpolasi), celah panjang tetap di tempat (0)
    let unmatched = 0;
    for (let i = 0; i < shift.length;) {
      if (shift[i] !== null) { i++; continue; }
      let e = i; while (e < shift.length && shift[e] === null) e++;
      const a = i > 0 ? shift[i - 1] : null, b = e < shift.length ? shift[e] : null, short = (e - i) * step <= GAP_FILL;
      if (!short || (a === null && b === null)) unmatched += (e - i) * step;
      for (let k = i; k < e; k++) shift[k] = !short ? 0 : a !== null && b !== null ? a + (b - a) * (k - i + 1) / (e - i + 1) : a ?? b ?? 0;
      i = e;
    }
    const h = MEDIAN >> 1, smooth = shift.map((_, i) => { const w = shift.slice(Math.max(0, i - h), i + h + 1).sort((p, q) => p - q); return w[w.length >> 1]; });
    // tanpa lompatan menyamping: paling banyak SLOPE m per meter lintasan (pindah ke rel sejajar menjadi peralihan landai)
    for (let i = 1; i < smooth.length; i++) smooth[i] = Math.max(smooth[i - 1] - SLOPE * step, Math.min(smooth[i - 1] + SLOPE * step, smooth[i]));
    for (let i = smooth.length - 2; i >= 0; i--) smooth[i] = Math.max(smooth[i + 1] - SLOPE * step, Math.min(smooth[i + 1] + SLOPE * step, smooth[i]));
    const moved = S.map(([x, y, ux, uy], i) => [x - uy * smooth[i], y + ux * smooth[i]]);
    return { points: simplify(moved, SIMPLIFY).map(([x, y]) => unxy(x, y).map((v) => Math.round(v * 1e6) / 1e6)), unmatched: Math.round(unmatched) };
  }

  /** Selisih lintasan terhadap rel OSM sejenis terdekat yang searah: { mean, max (m), unmatched (bagian 0..1 tanpa rel dalam 100 m) }. */
  function offset(points, kind) {
    const { out: S } = sample(points);
    let sum = 0, max = 0, n = 0;
    for (const p of S) {
      let best = Infinity;
      for (const [, d] of around(kind, p, R_MEASURE)) if (d < best) best = d;
      if (best === Infinity) continue;
      sum += best; n++; if (best > max) max = best;
    }
    return { mean: n ? sum / n : null, max: n ? max : null, unmatched: 1 - n / S.length };
  }
  return { snap, offset };
}
