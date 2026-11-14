// 3D view: the viaducts the elevated trains stand on (deck pieces and columns as two fill-extrusion layers on one
// GeoJSON source, calm grey a step darker than the buildings), built in the browser from the network and the height profiles (elevation.js), so the decks
// stand exactly where the 3D trains run, at exactly their height.
//
// Deck pieces (k 'd': b = underside, h = top, m above the ground) along each stretch at least MIN_H up, DECK_W wide
// (narrower for monorails and guideways), one piece per level stretch (up to PIECE_MAX m; ramps in PIECE_M steps);
// columns (k 'c': b 0, h = deck underside), COL_W square every COL_M where the deck is at least COL_MIN_H up.
// Two lines drawn on the same track (MT3D has e.g. Chuo Rapid and Chuo-Sobu Local side by side) share one deck: a piece
// within SAME_M of one already made, at about its height, is left out; decks of different lines stand a few cm apart in
// height so overlapping decks never shimmer.
//
// export function viaductData(net, profs, opts?) -> GeoJSON FeatureCollection (+ .stats)
// export function addViaduct(map, data, { before }), showViaduct(map, on, opacity?), removeViaduct(map)

import { trackOf, pointAt, toLngLat } from './track.js';
import { ELEVATED } from './elevation.js';

export const VIADUCT_SOURCE = 'tk3d-viaduct';
export const DECK_ID = 'tk3d-viaduct-deck';
export const COLS_ID = 'tk3d-viaduct-cols';
export const VIADUCT_IDS = [DECK_ID, COLS_ID];
// buildings #E3E5E9 .. #D0D4DA (buildings.js): the decks a step darker, the columns (in shade under the deck) darker still
export const VIADUCT_GREY = { deck: '#CBCFD6', cols: '#BEC3CB' };
export const MIN_H = 3.5, PIECE_M = 20, PIECE_MAX = 300, MERGE_DH = 0.4, COL_M = 45, COL_MIN_H = 4.5, DECK_T = 1.4, DECK_W = 9, GUIDE_W = 6, COL_W = 2.2, SAME_M = 5;
// the Greater Tokyo core the decks are built for (west, south, east, north): Yokohama to Chiba, Tachikawa to Funabashi
export const BOUNDS = [106.4, -6.75, 107.3, -5.9];
// columns (the many small features) only over the 23 wards, Kawasaki and the Tokyo Bay shore
export const COL_BOUNDS = [106.65, -6.4, 107.05, -6.05];

const inB = (b, lng, lat) => !b || (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]);

/** A grid of points already taken (x, y, h), for "is there one within r m at about this height?". */
function grid(cell) {
  const m = new Map();
  const key = (cx, cy) => cx * 73856093 ^ cy * 19349663;
  return {
    near(x, y, h, r, dh) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = m.get(key(cx + i, cy + j));
        if (!l) continue;
        for (let k = 0; k < l.length; k += 3) {
          if (Math.abs(l[k + 2] - h) <= dh && (l[k] - x) ** 2 + (l[k + 1] - y) ** 2 <= r * r) return true;
        }
      }
      return false;
    },
    add(x, y, h) {
      const k = key(Math.floor(x / cell), Math.floor(y / cell));
      const l = m.get(k);
      if (l) l.push(x, y, h); else m.set(k, [x, y, h]);
    },
  };
}

const r5 = (v) => Math.round(v * 1e6) / 1e6;

/** The decks and columns of every elevated stretch of the network, as GeoJSON (lng/lat, 6 decimals). */
export function viaductData(net, profs, opts = {}) {
  const minH = opts.minH ?? MIN_H, piece = opts.piece ?? PIECE_M, every = opts.every ?? COL_M;
  const bounds = opts.bounds === undefined ? BOUNDS : opts.bounds;
  const feats = [];
  const cols = grid(12);
  // jaktrack: opts.bands = [{ z0, z1, half(lineIdx, chainM) -> m }]: one set of decks per zoom range, as wide as the two
  // tracks and their (widened) trains need there; none = the one fixed width at every zoom
  const bands = (opts.bands?.length ? opts.bands : [{ z0: 0, z1: 99, half: null }]).map((b) => ({ ...b, grid: grid(12) }));
  const P = [0, 0, 1, 0], Q = [0, 0, 1, 0];
  let nd = 0, nc = 0, skipped = 0;
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  for (let i = 0; i < lines.length; i++) {
    const pr = profs[i];
    if (!pr || !(pr.max >= minH)) continue;
    const line = lines[i];
    const t = trackOf(line);
    if (t.n < 2) continue;
    const baseHalf = (ELEVATED.has(line.id) ? GUIDE_W : DECK_W) / 2;
    const jitter = (i % 4) * 0.06;
    const k = t.k || 1;   // profile metres are chain metres; track metres = chain * k
    // decks: pieces that grow while the height stays within MERGE_DH of where they started (a level stretch is one long
    // piece, a ramp many short ones), never longer than PIECE_MAX
    for (const band of bands) {
    const decks = band.grid;
    let m0 = -1, h0 = 0, hs = 0, ns = 0;
    const emit = (a, b) => {
      const mid = (a + b) / 2;
      const h = hs / ns;
      const half = band.half ? Math.max(baseHalf, band.half(i, mid / k)) : baseHalf;
      pointAt(t, mid, P);
      const [lng, lat] = toLngLat(P[0], P[1]);
      if (!inB(bounds, lng, lat)) return;
      if (decks.near(P[0], P[1], h, SAME_M, 2.5)) { skipped++; return; }
      decks.add(P[0], P[1], h);
      // the piece's centre line: its ends and the track's vertices between them
      const pts = [];
      pointAt(t, a, Q); pts.push([Q[0], Q[1], Q[2], Q[3]]);
      for (let v = 1; v < t.n - 1; v++) {
        const c = t.cum[v];
        if (c <= a || c >= b) continue;
        const ax = t.x[v] - t.x[v - 1], ay = t.y[v] - t.y[v - 1], bx = t.x[v + 1] - t.x[v], by = t.y[v + 1] - t.y[v];
        const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
        let ux = ax / la + bx / lb, uy = ay / la + by / lb;
        const lu = Math.hypot(ux, uy) || 1;
        ux /= lu; uy /= lu;
        pts.push([t.x[v], t.y[v], ux, uy]);
      }
      pointAt(t, b, Q); pts.push([Q[0], Q[1], Q[2], Q[3]]);
      const left = [], right = [];
      for (const [x, y, ux, uy] of pts) {
        left.push(toLngLat(x - uy * half, y + ux * half).map(r5));
        right.push(toLngLat(x + uy * half, y - ux * half).map(r5));
      }
      const ring = [...left, ...right.reverse()];
      ring.push(ring[0]);
      const top = Math.round((h + jitter) * 100) / 100;
      feats.push({ type: 'Feature', properties: { k: 'd', b: Math.max(0, Math.round((top - DECK_T) * 100) / 100), h: top, z0: band.z0, z1: band.z1 }, geometry: { type: 'Polygon', coordinates: [ring] } });
      nd++;
    };
    for (let m = 0; m < t.length; m += piece) {
      const m1 = Math.min(t.length, m + piece);
      const h = pr.at((m + m1) / 2 / k);
      const up = h >= minH;
      if (m0 >= 0 && (!up || Math.abs(h - h0) > MERGE_DH || m - m0 >= PIECE_MAX)) { emit(m0, m); m0 = -1; }
      if (up && m0 < 0) { m0 = m; h0 = h; hs = 0; ns = 0; }
      if (up) { hs += h; ns++; }
    }
    if (m0 >= 0) emit(m0, t.length);
    }
    // columns
    const cw = (ELEVATED.has(line.id) ? 1.8 : COL_W) / 2;
    for (let m = every / 2; m < t.length; m += every) {
      const h = pr.at(m / k);
      if (!(h >= COL_MIN_H)) continue;
      pointAt(t, m, P);
      const [lng, lat] = toLngLat(P[0], P[1]);
      if (!inB(bounds, lng, lat) || !inB(opts.colBounds === undefined ? COL_BOUNDS : opts.colBounds, lng, lat)) continue;
      if (cols.near(P[0], P[1], h, SAME_M + 1, 3)) continue;
      cols.add(P[0], P[1], h);
      const ux = P[2], uy = P[3];
      const corner = (a, b) => toLngLat(P[0] + ux * a - uy * b, P[1] + uy * a + ux * b).map(r5);
      const ring = [corner(-cw, -cw), corner(cw, -cw), corner(cw, cw), corner(-cw, cw)];
      ring.push(ring[0]);
      feats.push({ type: 'Feature', properties: { k: 'c', b: 0, h: Math.max(0, Math.round((h - DECK_T) * 100) / 100) }, geometry: { type: 'Polygon', coordinates: [ring] } });
      nc++;
    }
  }
  const fc = { type: 'FeatureCollection', features: feats };
  Object.defineProperty(fc, 'stats', { value: { decks: nd, columns: nc, shared: skipped }, enumerable: false });
  return fc;
}

const paint = (color) => ({
  'fill-extrusion-color': color,
  'fill-extrusion-height': ['coalesce', ['get', 'h'], 0],
  'fill-extrusion-base': ['coalesce', ['get', 'b'], 0],
  'fill-extrusion-opacity': 0.92,
  'fill-extrusion-vertical-gradient': true,
});
export const LAYERS = [
  { id: DECK_ID, type: 'fill-extrusion', source: VIADUCT_SOURCE, minzoom: 12, filter: ['all', ['==', ['get', 'k'], 'd'], ['>=', ['zoom'], ['get', 'z0']], ['<', ['zoom'], ['get', 'z1']]], paint: paint(VIADUCT_GREY.deck) },
  { id: COLS_ID, type: 'fill-extrusion', source: VIADUCT_SOURCE, minzoom: 14, filter: ['==', ['get', 'k'], 'c'], paint: paint(VIADUCT_GREY.cols) },
];

/** Add the deck and column layers before `before` (no-op if they are there). */
export function addViaduct(map, data, { before } = {}) {
  if (!map.getSource(VIADUCT_SOURCE)) map.addSource(VIADUCT_SOURCE, { type: 'geojson', data, maxzoom: 16, tolerance: 0.25, buffer: 32 });
  else map.getSource(VIADUCT_SOURCE).setData(data);
  const b = before && map.getLayer(before) ? before : undefined;
  for (const l of LAYERS) if (!map.getLayer(l.id)) map.addLayer(l, b);
  return true;
}

export function showViaduct(map, on) {
  const v = on ? 'visible' : 'none';
  for (const id of VIADUCT_IDS) {
    if (map.getLayer(id) && (map.getLayoutProperty(id, 'visibility') || 'visible') !== v) map.setLayoutProperty(id, 'visibility', v);
  }
}

export function removeViaduct(map) {
  for (const id of VIADUCT_IDS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(VIADUCT_SOURCE)) map.removeSource(VIADUCT_SOURCE);
}
