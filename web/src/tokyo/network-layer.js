// The Tokyo rail network as MapLibre layers, drawn the way trafik.live's train page draws its lines
// in the calm look of web/src/map/network.js: colour only on data.
// - At rest every line is a thin grey line (kereta's #8B8B93 at 70 %, drawn opaque so shared corridors never stack
//   into darker blotches). Its tunnels (the heights build's elev-v1.json: rail level below the street; without it, line.underground)
//   are dashed in the same calm grey and width, switching where the tunnel starts (where trains.js turns trains
//   to their below-ground look); its viaducts (>= 6 m up) get a light deck with a soft edge from z14, so raised lines
//   read as raised. No line colour at rest: ODPT's licence wants official line colours unmodified wherever a line's
//   colour is shown, so a line's colour appears only when it is picked, exactly as published. Lines that share a
//   corridor sit side by side:
//   each piece of a line carries its lane (the network build's line.lanes, Mini Tokyo 3D's track offsets) and MapLibre's
//   line-offset moves it lane * lanePx(zoom) css px to the right of the path's direction.
// - A picked line (a line, or the line of a picked train): its EXACT colour with a white casing along its whole length
//   (tunnels dashed in the same exact colour), its stations as white dots ringed in that colour with their names; every
//   other line steps back.
// - Stations: white dots with a grey ring. Below zoom Z_SPLIT an interchange complex (net.groups) is ONE bigger dot
//   with ONE name; from Z_SPLIT each station sits on its own line (on its lane) and each distinct name of the complex
//   is written once. Which names show first is a ranking (the big terminals, then the Yamanote ring, then interchanges
//   by how many lines meet, then the rest), so the opening view reads the key Yamanote stations.
// - Nothing overlaps a label: station dots are symbols that enter MapLibre's collision index before any label (an
//   invisible copy on top of the stack), so station names, and the basemap's names after them, keep clear of every
//   dot and of each other.
//
// Layer stack, bottom to top: lines (rest, picked) -> dots -> [trains: add them before the returned labelsBefore] ->
// the basemap's names (moved up here: nothing covers a label) -> station names -> picked line names -> the selection
// ring -> collision blockers (invisible).
//
//   import { addNetwork } from './network-layer.js';
//   const net = addNetwork(map, unpackNet(json), { lang: 'en', onStation: (i, info) => ..., onLine: (i) => ... });
//   net.highlightLine('JR-East.Yamanote');  net.highlightStation(i);  net.clear();  net.setLang('ja');
import { BASE_LABEL_LAYERS, FONT, labelLang } from './style.js';
import { laneAt, measure, pointAt } from './net.js';
import { heuristicRanges } from '../layers/city3d/elevation.js';

/** css px between the centres of neighbouring lanes, by zoom (linear in between). trains.js shifts trains the same. */
export const LANE_PX = [[8, 0.9], [10, 1.4], [12, 2.1], [14, 3.0], [16, 4.1], [18, 5.4], [20, 6.6]];
/** css px between neighbouring lanes at zoom z (sign as MapLibre line-offset: + = right of the path's direction). */
export function lanePx(z) {
  const S = LANE_PX;
  if (z <= S[0][0]) return S[0][1];
  for (let i = 1; i < S.length; i++) if (z <= S[i][0]) {
    const [z0, p0] = S[i - 1], [z1, p1] = S[i];
    return p0 + (p1 - p0) * (z - z0) / (z1 - z0);
  }
  return S[S.length - 1][1];
}
/** The px offset of a lane at zoom z. */
export const laneOffsetPx = (lane, z) => lane * lanePx(z);

/** Below this zoom an interchange complex is one dot and one name; from it each station is drawn on its own line. */
export const Z_SPLIT = 14;
/** Add the trains layer before this id so station names stay on top of trains (map.addLayer(layer, NET_LABELS_BEFORE)). */
export const NET_LABELS_BEFORE = 'tk-slabel';

const EMPTY = { type: 'FeatureCollection', features: [] };
const GROUND = [0xF2, 0xF2, 0xF3];   // style.js MAP_CALM.land: what the lines sit on
const REST = { line: '#AAAAB0', ug: '#BDBDC4', ring: '#8E8E96', ringUg: '#B4B4BB', ringHub: '#6B6B72', name: '#55555D',
  nameHub: '#2F2F35', nameQuiet: '#6E6E76', halo: '#FFFFFF', ink: '#171717' };
const DISC_PX = 16;          // the dot image's diameter at icon-size 1 (css px)
const DOT_LANES = 2.5;       // a station dot is 2.5 lanes wide
const HUB_LANES = 3.4;       // an interchange complex's dot (below Z_SPLIT)
const PICK_LANES = 3.0;      // a picked line's station dots
const ICON_LANE = DISC_PX / DOT_LANES;   // icon-offset units per lane for a station dot (icon-offset scales with icon-size)
const PICK_LANE = DISC_PX / PICK_LANES;
/** A station's lane as a map-frame vector in lanes [east, south] (icon-offset frame with icon-rotation-alignment 'map'):
 * `lane` lanes to the right of the path's direction `bearing` (degrees clockwise from north). */
const laneVec = (lane, bearing) => { const b = (bearing * Math.PI) / 180; return [lane * Math.cos(b), lane * Math.sin(b)]; };
const BLK = 0.55;     // collision blocker size against the dot (the disc image is the dot plus its SDF margin)
const PART_M = 120;  // members of one station building (MT3D part) closer than this are drawn as one disc

// The big terminals (always named) and the next tier (named from city zoom), by English station name (any case).
const HUBS_A = new Set(['Tokyo', 'Shinjuku', 'Shibuya', 'Ikebukuro', 'Ueno', 'Shinagawa', 'Akihabara'].map((n) => n.toLowerCase()));
const HUBS_B = new Set(['Shimbashi', 'Yokohama', 'Omiya', 'Kita-Senju', 'Otemachi', 'Nippori', 'Ebisu', 'Hamamatsucho',
  'Kawasaki', 'Tachikawa', 'Chiba', 'Funabashi', 'Musashi-Kosugi', 'Iidabashi', 'Yotsuya', 'Ginza', 'Nihombashi',
  'Oshiage', 'Asakusa', 'Shin-Kiba', 'Kichijoji', 'Machida', 'Hachioji', 'Akabane', 'Kinshicho', 'Nakano',
  'Shin-Yokohama', 'Kashiwa', 'Matsudo', 'Nishi-Funabashi', 'Tsudanuma', 'Maihama', 'Toyosu', 'Harajuku', 'Omote-sando',
  'Roppongi', 'Kamakura', 'Fujisawa', 'Ofuna', 'Tokorozawa', 'Kawagoe', 'Urawa', 'Haneda Airport Terminal 1 and 2',
  'Haneda Airport Terminal 3', 'Narita Airport Terminal 1', 'Meiji-jingumae'].map((n) => n.toLowerCase()));
const YAMANOTE = 'JR-East.Yamanote';
/** MT3D writes a station's second name in brackets ('Meiji-jingumae<Harajuku>', 'Oshiage(SKYTREE)'): on the map
 * 'Meiji-jingumae (Harajuku)'; JA keeps its own 〈〉. `base` = the name without it (to tell names of a complex apart). */
const display = (t) => String(t || '').replace(/\s*[<(]([^>)]*)[>)]\s*$/, ' ($1)').trim();
const base = (t) => String(t || '').replace(/\s*[<(〈（][^>)〉）]*[>)〉）]\s*$/, '').trim().toLowerCase();
const RING_CENTRE = [106.8229, -6.2003];   // the Yamanote ring: its stations' names go outside it

// Label anchor orders, by the side the name should go first (text-variable-anchor-offset: anchor + offset in ems).
const OFF = { e: ['left', [0.75, 0]], w: ['right', [-0.75, 0]], n: ['bottom', [0, -0.65]], s: ['top', [0, 0.65]],
  ne: ['bottom-left', [0.5, -0.4]], nw: ['bottom-right', [-0.5, -0.4]], se: ['top-left', [0.5, 0.4]], sw: ['top-right', [-0.5, 0.4]] };
const ORDER = { e: 'e ne se n s w nw sw', w: 'w nw sw n s e ne se', n: 'n ne nw e w s se sw', s: 's se sw e w n ne nw',
  ne: 'ne e n se nw w s sw', nw: 'nw w n sw ne e s se', se: 'se e s ne sw w n nw', sw: 'sw w s nw se e n ne' };
/** Anchors in `side`'s order; `far` scales the offsets (complex names from Z_SPLIT sit among several discs, one of them
 * a station building's big disc, so they keep further out). */
const anchorsFor = (side, far = 1) => ['literal', ORDER[side].split(' ').flatMap((k) => [OFF[k][0], OFF[k][1].map((v) => Math.round(v * far * 100) / 100)])];
const SIDES = Object.keys(ORDER);

const lin = (stops) => ['interpolate', ['linear'], ['zoom'], ...stops];
const exp = (stops) => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
/** An [x, y] property for icon-offset. queryRenderedFeatures reads features back from the tile's PBF copy, where
 * vt-pbf writes array properties as JSON strings, and MapLibre then warned "Expected value to be of type
 * array<number, 2>, but found string" once per layer: a string = no offset there. */
const vec2 = (key) => ['case', ['==', ['typeof', ['get', key]], 'string'], ['literal', [0, 0]], ['get', key]];
/** line-offset for features carrying their lane in `ln`. */
const LANE_OFFSET = ['interpolate', ['linear'], ['zoom'], ...LANE_PX.flatMap(([z, px]) => [z, ['*', ['get', 'ln'], px]])];
/** icon-size giving a dot `lanes` lanes wide at every zoom (so icon-offset = lane * DISC_PX / lanes stays exact);
 * `scaled` = times the feature's own `dsc` (a station building's disc covering several lanes). */
const dotSize = (lanes, scaled = false) => ['interpolate', ['linear'], ['zoom'],
  ...LANE_PX.flatMap(([z, px]) => [z, scaled ? ['*', ['get', 'dsc'], (px * lanes) / DISC_PX] : (px * lanes) / DISC_PX])];
const REST_W = exp([8, 0.7, 10, 1.0, 12, 1.5, 14, 2.1, 16, 2.9, 18, 3.9]);
/** the heights build height (m) from which a stretch is drawn as a viaduct. */
export const VIADUCT_M = 6;
const VIA_ON = lin([13.5, 0, 14, 1]);
const PICK_W = exp([8, 1.6, 10, 2.2, 12, 3.0, 14, 4.0, 16, 5.4, 18, 7.4]);
const CASE_W = exp([8, 3.2, 10, 4.2, 12, 5.4, 14, 7.0, 16, 9.2, 18, 12.4]);

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [0x6B, 0x6B, 0x70];
};
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** `color` at alpha `a` over the map's ground, as an opaque colour. */
export const over = (color, a) => toHex(hex(color).map((v, i) => v * a + GROUND[i] * (1 - a)));

/** The parts of [0, length] a line is drawn on: everything minus its hidden ranges ([m0, m1, m2, m3, ...] pairs). */
function shownRanges(line) {
  const len = line.length || 0;
  const h = Array.isArray(line.hidden) ? line.hidden : [];
  const out = [];
  let at = 0;
  for (let i = 0; i + 1 < h.length; i += 2) {
    const a = Math.max(0, h[i]), b = Math.min(len, h[i + 1]);
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < len) out.push([at, len]);
  return out;
}
const hiddenAt = (line, m) => {
  const h = Array.isArray(line.hidden) ? line.hidden : [];
  for (let i = 0; i + 1 < h.length; i += 2) if (m > h[i] + 1 && m < h[i + 1] - 1) return true;
  return false;
};

/** [m0, m1, lane] pieces of constant lane over [a, b]; a changing lane is cut into short steps. */
function lanePieces(line, a, b) {
  const L = Array.isArray(line.lanes) && line.lanes.length >= 4 ? line.lanes : null;
  if (!L) return [[a, b, line.offset || 0]];
  const cuts = new Set([a, b]);
  for (let i = 0; i < L.length; i += 2) if (L[i] > a && L[i] < b) cuts.add(L[i]);
  const ms = [...cuts].sort((x, y) => x - y);
  const out = [];
  for (let i = 1; i < ms.length; i++) {
    const m0 = ms[i - 1], m1 = ms[i];
    if (m1 - m0 < 0.5) continue;
    const v0 = laneAt(line, m0 + 0.01), v1 = laneAt(line, m1 - 0.01);
    const steps = Math.abs(v1 - v0) < 0.02 ? 1 : Math.min(10, Math.max(2, Math.ceil(Math.abs(v1 - v0) / 0.2)));
    for (let k = 0; k < steps; k++) {
      const s0 = m0 + (m1 - m0) * k / steps, s1 = m0 + (m1 - m0) * (k + 1) / steps;
      out.push([s0, s1, Math.round(laneAt(line, (s0 + s1) / 2) * 100) / 100]);
    }
  }
  // merge neighbours with the same lane
  const merged = [];
  for (const p of out) {
    const q = merged[merged.length - 1];
    if (q && q[2] === p[2] && Math.abs(q[1] - p[0]) < 0.01) q[1] = p[1]; else merged.push(p.slice());
  }
  return merged;
}

/** The path between m0 and m1 metres (cum = cumulative metres at each vertex). */
function slicePath(path, cum, m0, m1) {
  const n = path.length;
  if (n < 2 || m1 <= m0) return null;
  const at = (m) => {
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
    const span = cum[hi] - cum[lo], t = span > 0 ? Math.max(0, Math.min(1, (m - cum[lo]) / span)) : 0;
    return { i: lo, p: [path[lo][0] + (path[hi][0] - path[lo][0]) * t, path[lo][1] + (path[hi][1] - path[lo][1]) * t] };
  };
  const A = at(m0), B = at(m1);
  const out = [A.p];
  for (let i = A.i + 1; i <= B.i; i++) out.push(path[i]);
  out.push(B.p);
  return out.length >= 2 ? out : null;
}

/**
 * the heights build's elev-v1.json ranges of one line, on our chain: { tun: [[a, b], ...] (rail below the street), via: [[a, b], ...]
 * (>= VIADUCT_M up) }, or null when the heights build does not cover the line. Same reading as trains.js setElevation (any metres < 0
 * = tunnel, neighbours <= 1 m apart joined, the heights build's length rescaled to ours), so the dashes start where trains.js gives a
 * train its below-ground look.
 */
export function elevRanges(elev, line) {
  const R = elev && elev.lines ? elev.lines[line.id] : null;
  if (!Array.isArray(R)) return null;
  const len = elev.len?.[line.id], k = len > 0 && line.length > 0 ? line.length / len : 1;
  const tun = [], via = [];
  for (const r of R) {
    const h = r?.[2];
    if (!(h < 0) && !(h >= VIADUCT_M)) continue;
    const out = h < 0 ? tun : via;
    const a = Math.max(0, r[0] * k), b = Math.min(line.length || Infinity, r[1] * k);
    if (!(b > a)) continue;
    const n = out.length;
    if (n && a - out[n - 1][1] <= 1) out[n - 1][1] = Math.max(out[n - 1][1], b); else out.push([a, b]);
  }
  return { tun, via };
}

/** Cut [m0, m1, lane] pieces where the class changes: cls 1 = tunnel, 2 = viaduct, 0 = at grade or embankment. */
function classPieces(pieces, ranges, whole) {
  if (!ranges) return pieces.map(([a, b, ln]) => [a, b, ln, whole]);
  const out = [];
  const marks = [];
  for (const [a, b] of ranges.tun) marks.push(a, b);
  for (const [a, b] of ranges.via) marks.push(a, b);
  const inside = (list, m) => { for (const [a, b] of list) { if (m < a) return false; if (m < b) return true; } return false; };
  for (const [m0, m1, ln] of pieces) {
    const cuts = [m0, ...marks.filter((m) => m > m0 + 0.5 && m < m1 - 0.5), m1].sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i];
      if (b - a < 0.5) continue;
      const mid = (a + b) / 2;
      const cls = inside(ranges.tun, mid) ? 1 : inside(ranges.via, mid) ? 2 : 0;
      const q = out[out.length - 1];
      if (q && q[3] === cls && q[2] === ln && Math.abs(q[1] - a) < 0.01) q[1] = b; else out.push([a, b, ln, cls]);
    }
  }
  return out;
}

/** Disc image for the dots: a signed distance field (MapLibre SDF icon), so one image takes any fill and ring colour. */
function discImage() {
  const size = DISC_PX * 2, r = DISC_PX / 2, c = size / 2;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) - r;   // < 0 inside
    const v = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / 8 + 0.25))));
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255; data[o + 3] = v;
  }
  return { width: size, height: size, data };
}

/**
 * Draws `net` (the in-memory shape: lines, stations, groups; net.js unpackNet output or the model.js fixture model)
 * on `map` (style loaded). Options: lang 'en' | 'ja' | 'id'; onStation(stationIndex, {group, name, lngLat});
 * onLine(lineIndex); rest 'neutral' (grey, default) | 'color' (lines at grade in their exact colour); before = a layer id
 * to put the whole network under (default: on top; keep it on top so station names win over basemap names);
 * linesBefore = a layer id for the line layers only (e.g. 'bld-3d', so 3D buildings stand over the tracks);
 * elev = the heights build's elev-v1.json (parsed), or later via setElevation(json); deferData = true: the lines, dots and names
 * get their GeoJSON one source per task after this returns (the page's first load: no single long task); a function:
 * it is called with flush() and starts it when the caller wants (the page: after the first trains are drawn).
 */
export function addNetwork(map, net, opts = {}) {
  const lines = net.lines || [], stations = net.stations || [], groups = net.groups || [];
  let lang = labelLang(opts.lang);
  // 'color' ('tint' accepted): lines at grade in their exact official colour (a comparison view; default 'neutral')
  let rest = opts.rest === 'tint' || opts.rest === 'color' ? 'color' : 'neutral';
  const layerIds = [], sourceIds = [];
  const before = opts.before && map.getLayer(opts.before) ? opts.before : undefined;
  // lines may go lower than the rest (e.g. under the 3D buildings: linesBefore: 'bld-3d'); dots and names stay on top
  const linesBefore = opts.linesBefore && map.getLayer(opts.linesBefore) ? opts.linesBefore : before;

  // ------------------------------------------------------------ geometry: line pieces
  const cums = lines.map((l) => (l.path && l.path.length > 1 ? measure(l.path) : null));
  let elev = opts.elev || null;
  let piecesOf = [];
  let lineFeatures = [];
  function buildLines() {
    piecesOf = lines.map((l, i) => {
      const out = [];
      const cum = cums[i];
      if (!cum) return out;
      if (!l.length) l.length = cum[cum.length - 1];
      // without the heights file a line marked underground is dashed only around its underground stations (the same
      // estimate the 3D view uses), not from end to end: MRT Jakarta is elevated from Lebak Bulus to ASEAN
      const ranges = elevRanges(elev, l) || (l.underground ? { tun: heuristicRanges(net, i).map(([a, b]) => [a, b]), via: [] } : null);
      const lanes = [];
      for (const [a, b] of shownRanges(l)) lanes.push(...lanePieces(l, a, b));
      for (const [m0, m1, ln, cls] of classPieces(lanes, ranges, l.underground ? 1 : 0)) {
        const coords = slicePath(l.path, cum, m0, m1);
        if (coords) out.push({ coords, ln, cls, m0, m1 });
      }
      return out;
    });
    lineFeatures = [];
    // Two lines in one tunnel on the same lane (Sobu Rapid + Yokosuka under Tokyo) would lay their dashes over each other
    // out of step and read as a solid line: at rest such a stretch is dashed once (150 m steps, first line wins).
    // (a stretch counts as drawn when three points along it lie on one already drawn, running the same way or the
    // opposite way on the same side: a crossing tunnel never matches)
    const seen = new Map();   // ~10 m grid cell -> [[lane, bearing], ...] of tunnel stretches already drawn
    // the cell as one number (x * 1e7 + y, exact in a double), not a 'x:y' string: the same cells, no
    // string per lookup (this loop was ~40 % of the network's build, most of it garbage collection)
    const cellKey = (lng, lat) => Math.round(lng * 1e4) * 1e7 + Math.round(lat * 1e4);
    const taken = (q, ln) => {
      if (!q) return false;
      const x = Math.round(q[0] * 1e4), y = Math.round(q[1] * 1e4);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const v = seen.get((x + dx) * 1e7 + (y + dy));
        if (v && v.some(([l2, b2]) => { const c = Math.cos(((q[2] - b2) * Math.PI) / 180); return Math.abs(c) > 0.94 && Math.abs(l2 * Math.sign(c) - ln) < 0.3; })) return true;
      }
      return false;
    };
    lines.forEach((l, i) => {
      const rt = l.color || REST.line;   // rest: 'color' draws the official colour unmodified (ODPT), never a tint
      const feat = (coords, ln, cls) => lineFeatures.push({ type: 'Feature', properties: { i, ln, ug: cls === 1 ? 1 : 0, via: cls === 2 ? 1 : 0, rt },
        geometry: { type: 'LineString', coordinates: coords } });
      for (const p of piecesOf[i]) {
        if (p.cls !== 1) { feat(p.coords, p.ln, p.cls); continue; }
        const n = Math.max(1, Math.ceil((p.m1 - p.m0) / 150));
        for (let k = 0; k < n; k++) {
          const a = p.m0 + (p.m1 - p.m0) * k / n, b = p.m0 + (p.m1 - p.m0) * (k + 1) / n;
          const d = (b - a) * 0.15;
          if (taken(pointAt(l, a + d), p.ln) && taken(pointAt(l, (a + b) / 2), p.ln) && taken(pointAt(l, b - d), p.ln)) continue;
          const coords = slicePath(l.path, cums[i], a, b);
          if (!coords) continue;
          feat(coords, p.ln, 1);
          for (let m = a; m <= b; m += 25) {
            const q = pointAt(l, m);
            if (!q) continue;
            const key = cellKey(q[0], q[1]);
            if (!seen.has(key)) seen.set(key, []);
            seen.get(key).push([p.ln, q[2]]);
          }
        }
      }
    });
  }
  buildLines();

  // ------------------------------------------------------------ stations: where each sits, and how important it is
  const posInLine = new Map();   // station index -> metres along its line
  lines.forEach((l) => (l.stations || []).forEach((s, k) => { if (!posInLine.has(s) && l.chain) posInLine.set(s, l.chain[k]); }));
  const nameOf = (s) => ({ en: display(s.name?.en || s.id), ja: s.name?.ja || s.name?.en || s.id });
  const groupOf = (si) => { const g = stations[si]?.group; return g != null && g >= 0 && groups[g] && groups[g].length > 1 ? g : -1; };
  const place = (si) => {   // [lng, lat, bearing, lane] on the drawn line, or the station's own point
    const s = stations[si], l = lines[s.line];
    const m = posInLine.get(si);
    if (l && l.path && l.path.length > 1 && m != null) {
      if (!l.cum && cums[s.line]) l.cum = cums[s.line];
      const p = pointAt(l, m);
      if (p) return { lng: p[0], lat: p[1], bearing: p[2], lane: laneAt(l, m), hidden: hiddenAt(l, m) };
    }
    if (s.lng == null || s.lat == null) return null;
    return { lng: s.lng, lat: s.lat, bearing: 0, lane: 0, hidden: false };
  };
  const places = stations.map((s, i) => place(i));
  const sideOf = (lng, lat, ring) => {
    const k = Math.cos((lat * Math.PI) / 180);
    const dx = (lng - (ring ? RING_CENTRE[0] : lng + 1)) * k, dy = lat - (ring ? RING_CENTRE[1] : lat);
    if (!ring) return 'e';
    const a = (Math.atan2(dy, dx) * 180) / Math.PI;   // 0 = east, 90 = north
    return a > -22.5 && a <= 22.5 ? 'e' : a > 22.5 && a <= 67.5 ? 'ne' : a > 67.5 && a <= 112.5 ? 'n' : a > 112.5 && a <= 157.5 ? 'nw'
      : a > 157.5 || a <= -157.5 ? 'w' : a > -157.5 && a <= -112.5 ? 'sw' : a > -112.5 && a <= -67.5 ? 's' : 'se';
  };
  // rank: 0 = big terminal, 1 = next tier, 2 = Yamanote ring, 3 = interchange (4+ lines), 4 = interchange, 5 = station
  const rankOf = (names, lineSet, isRing) => (names.some((n) => HUBS_A.has(base(n))) ? 0 : names.some((n) => HUBS_B.has(base(n))) ? 1
    : isRing ? 2 : lineSet.size >= 4 ? 3 : lineSet.size >= 2 ? 4 : 5);
  // min zoom of the dot / the name per rank (filters run per integer tile zoom)
  const DOT_MZ = [0, 9, 10, 10, 11, 12];
  const NAME_MZ = [0, 10, 10, 11, 12, 13];
  const SIZE = [13.5, 12.5, 12, 11.5, 11.5, 11];

  const stFeatures = [];      // every station dot (members draw from Z_SPLIT, singles always)
  const grpFeatures = [];     // one dot per complex (below Z_SPLIT)
  const nameFeatures = [];    // names: complexes below Z_SPLIT, each distinct name of a complex from Z_SPLIT, singles
  const groupInfo = new Map();   // g -> {main, lngLat, rank}
  // sk = placement order: rank first, then the complexes where more lines meet
  const props = (rank, side, n, extra, lineCount = 1) => ({ rank, sk: rank * 100 - Math.min(lineCount, 40), mz: NAME_MZ[rank], dz: DOT_MZ[rank], sz: SIZE[rank], side,
    en: n.en || n.ja || '', ja: n.ja || n.en || '', ...extra });

  groups.forEach((members, g) => {
    if (!members || members.length < 2) return;
    const live = members.filter((si) => places[si] && stations[si]);
    if (!live.length) return;
    const lineSet = new Set(live.map((si) => stations[si].line));
    const isRing = live.some((si) => lines[stations[si].line]?.id === YAMANOTE);
    // names in this complex (by base name), the Yamanote station's first, then the most common (ties: the complex's
    // own order, JR first in MT3D)
    const byName = new Map();
    for (const si of live) { const k = base(stations[si].name?.en || stations[si].name?.ja); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(si); }
    const ringFirst = (sis) => (sis.some((si) => lines[stations[si].line]?.id === YAMANOTE) ? 1 : 0);
    const names = [...byName.entries()].sort((a, b) => ringFirst(b[1]) - ringFirst(a[1]) || b[1].length - a[1].length);
    const rank = rankOf(names.map(([k]) => k), lineSet, isRing);
    let lng = 0, lat = 0;
    for (const si of live) { lng += places[si].lng; lat += places[si].lat; }
    lng /= live.length; lat /= live.length;
    const main = names[0][1][0];
    groupInfo.set(g, { main, lngLat: [lng, lat], rank });
    const side = sideOf(lng, lat, isRing);
    grpFeatures.push({ type: 'Feature', properties: { g, s: main, rank, dz: DOT_MZ[rank], n: lineSet.size }, geometry: { type: 'Point', coordinates: [lng, lat] } });
    nameFeatures.push({ type: 'Feature', properties: props(rank, side, nameOf(stations[main]), { s: main, g, zr: 1 }, lineSet.size), geometry: { type: 'Point', coordinates: [lng, lat] } });
    for (const [, sis] of names) {
      let x = 0, y = 0;
      for (const si of sis) { x += places[si].lng; y += places[si].lat; }
      x /= sis.length; y /= sis.length;
      const r2 = sis === names[0][1] ? rank : Math.max(3, Math.min(rank + 2, 4));   // the complex's own name first
      nameFeatures.push({ type: 'Feature', properties: props(r2, sideOf(x, y, isRing), nameOf(stations[sis[0]]), { s: sis[0], g, zr: 2 }, new Set(sis.map((si) => stations[si].line)).size), geometry: { type: 'Point', coordinates: [x, y] } });
    }
  });
  // Station dots. icon-offset puts each dot on its lane (map frame, so no icon rotation); members of one station building
  // (same complex and MT3D part, all within PART_M metres) share one disc big enough to cover their lanes.
  const dot = (si, g, rank, ug, lngLat, vec, dsc) => ({ type: 'Feature',
    properties: { s: si, g, m: g >= 0 ? 1 : 0, rank, dz: DOT_MZ[rank], ug, dsc, io: [vec[0] * ICON_LANE / dsc, vec[1] * ICON_LANE / dsc],
      ib: [vec[0] * ICON_LANE / dsc / BLK, vec[1] * ICON_LANE / dsc / BLK] },
    geometry: { type: 'Point', coordinates: lngLat } });
  const parts = new Map();   // 'g:part' -> [si]
  stations.forEach((s, si) => {
    const p = places[si];
    if (!p || p.hidden) return;
    const g = groupOf(si);
    const l = lines[s.line];
    const isRing = l?.id === YAMANOTE;
    const ug = s.underground ? 1 : 0;
    const rank = g >= 0 ? groupInfo.get(g)?.rank ?? 4 : rankOf([nameOf(s).en], new Set([s.line]), isRing);
    if (g >= 0) { const k = `${g}:${s.part ?? si}`; if (!parts.has(k)) parts.set(k, []); parts.get(k).push(si); }
    else stFeatures.push(dot(si, g, rank, ug, [p.lng, p.lat], laneVec(p.lane, p.bearing), 1));
    if (g < 0) nameFeatures.push({ type: 'Feature', properties: props(rank, sideOf(p.lng, p.lat, isRing), nameOf(s), { s: si, g: -1, zr: 0 }), geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
  });
  const metres = (a, b) => Math.hypot((a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180), a.lat - b.lat) * 111320;
  for (const sis of parts.values()) {
    const g = groupOf(sis[0]);
    const rank = groupInfo.get(g)?.rank ?? 4;
    const ug = sis.every((si) => stations[si].underground) ? 1 : 0;
    const P0 = places[sis[0]];
    if (sis.length > 1 && sis.every((si) => metres(places[si], P0) < PART_M)) {
      let lng = 0, lat = 0, vx = 0, vy = 0;
      const vs = sis.map((si) => laneVec(places[si].lane, places[si].bearing));
      sis.forEach((si, k) => { lng += places[si].lng; lat += places[si].lat; vx += vs[k][0]; vy += vs[k][1]; });
      const n = sis.length; lng /= n; lat /= n; vx /= n; vy /= n;
      const spread = Math.max(...vs.map((v) => Math.hypot(v[0] - vx, v[1] - vy)));
      const dsc = Math.min(4, (2 * spread + DOT_LANES) / DOT_LANES);
      stFeatures.push(dot(sis[0], g, rank, ug, [lng, lat], [vx, vy], Math.round(dsc * 100) / 100));
    } else for (const si of sis) stFeatures.push(dot(si, g, rank, stations[si].underground ? 1 : 0, [places[si].lng, places[si].lat], laneVec(places[si].lane, places[si].bearing), 1));
  }

  // ------------------------------------------------------------ sources and layers
  // the light loading, opts.deferData: the big sources go in empty and get their data one per task right after (MapLibre
  // copies a GeoJSON object for its worker on the main thread: the whole network in one go was a ~0.6 s task at 4x
  // CPU, in the same task as the first trains). A later setData of the same source (setElevation) replaces a pending one.
  const pending = new Map();
  const source = (id, data, extra = {}) => {
    sourceIds.push(id);
    const later = opts.deferData && data !== EMPTY && data.features?.length;
    map.addSource(id, { type: 'geojson', data: later ? EMPTY : data, ...extra });
    if (later) pending.set(id, data);
  };
  const setSource = (id, data) => { pending.delete(id); map.getSource(id)?.setData(data); };
  const flush = () => {
    const next = pending.entries().next();
    if (next.done) return;
    const [id, data] = next.value;
    pending.delete(id);
    try { map.getSource(id)?.setData(data); } catch (e) { console.warn('[network] source data', e); }
    if (pending.size) setTimeout(flush, 0);
  };
  const layer = (def) => { layerIds.push(def.id); map.addLayer(def, def.type === 'line' ? linesBefore : before); };
  if (!map.hasImage('tk-disc')) map.addImage('tk-disc', discImage(), { sdf: true, pixelRatio: 1 });

  source('tk-lines', { type: 'FeatureCollection', features: lineFeatures }, { tolerance: 0.4, buffer: 64 });
  source('tk-pick', EMPTY, { tolerance: 0.3, buffer: 64 });
  source('tk-st', { type: 'FeatureCollection', features: stFeatures }, { buffer: 16 });
  source('tk-grp', { type: 'FeatureCollection', features: grpFeatures }, { buffer: 16 });
  source('tk-names', { type: 'FeatureCollection', features: nameFeatures }, { buffer: 64 });
  source('tk-pick-st', EMPTY, { buffer: 64 });
  source('tk-sel', EMPTY);

  const restColor = () => (rest === 'color' ? ['get', 'rt'] : REST.line);
  const lineLayout = { 'line-cap': 'round', 'line-join': 'round' };
  // at rest, bottom to top: tunnels (faint calm-grey dashes, under everything), viaduct decks (a light band with a soft
  // edge from z14, under the lines on them), the lines at grade and up
  layer({ id: 'tk-rest-ug', type: 'line', source: 'tk-lines', filter: ['==', ['get', 'ug'], 1], layout: { 'line-cap': 'butt', 'line-join': 'round' },
    // jaktrack: the line's own grey and width, dashed: a tunnel reads as the same line going under, not as a line that ends
    paint: { 'line-color': REST.line, 'line-width': REST_W, 'line-offset': LANE_OFFSET, 'line-dasharray': [2.4, 1.6] } });
  layer({ id: 'tk-via-edge', type: 'line', source: 'tk-lines', minzoom: 13.5, filter: ['==', ['get', 'via'], 1], layout: lineLayout,
    paint: { 'line-color': '#B9B9C0', 'line-width': exp([13.5, 4.6, 16, 6.6, 18, 8.8]), 'line-offset': LANE_OFFSET, 'line-opacity': VIA_ON } });
  layer({ id: 'tk-via-deck', type: 'line', source: 'tk-lines', minzoom: 13.5, filter: ['==', ['get', 'via'], 1], layout: lineLayout,
    paint: { 'line-color': '#FFFFFF', 'line-width': exp([13.5, 3.4, 16, 5.0, 18, 6.8]), 'line-offset': LANE_OFFSET, 'line-opacity': VIA_ON } });
  layer({ id: 'tk-rest', type: 'line', source: 'tk-lines', filter: ['==', ['get', 'ug'], 0], layout: lineLayout,
    paint: { 'line-color': restColor(), 'line-width': REST_W, 'line-offset': LANE_OFFSET } });
  // the picked line: white casing, its colour (underground stretches a little lighter)
  layer({ id: 'tk-pick-case', type: 'line', source: 'tk-pick', layout: lineLayout,
    paint: { 'line-color': '#FFFFFF', 'line-width': CASE_W, 'line-offset': LANE_OFFSET } });
  layer({ id: 'tk-pick', type: 'line', source: 'tk-pick', filter: ['==', ['get', 'ug'], 0], layout: lineLayout,
    paint: { 'line-color': ['get', 'c'], 'line-width': PICK_W, 'line-offset': LANE_OFFSET } });
  layer({ id: 'tk-pick-ug', type: 'line', source: 'tk-pick', filter: ['==', ['get', 'ug'], 1], layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': PICK_W, 'line-offset': LANE_OFFSET, 'line-dasharray': [1.6, 0.9] } });

  // dots (drawn under the trains; their collision copies sit on top of the stack, see tk-blk)
  const dotPaint = (ring, width) => ({ 'icon-color': '#FFFFFF', 'icon-halo-color': ring, 'icon-halo-width': width, 'icon-halo-blur': 0 });
  const dotLayout = (lanes, extra = {}) => ({
    'icon-image': 'tk-disc', 'icon-size': dotSize(lanes), 'icon-allow-overlap': true, 'icon-ignore-placement': true,
    'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', 'icon-padding': 0, ...extra,
  });
  layer({ id: 'tk-gdot', type: 'symbol', source: 'tk-grp', maxzoom: Z_SPLIT, filter: ['>=', ['zoom'], ['get', 'dz']],
    layout: dotLayout(HUB_LANES, { 'symbol-sort-key': ['get', 'rank'] }),
    paint: dotPaint(REST.ringHub, lin([9, 1, 12, 1.4, 13.5, 1.7])) });
  layer({ id: 'tk-sdot', type: 'symbol', source: 'tk-st', filter: ['all', ['==', ['get', 'm'], 0], ['>=', ['zoom'], ['get', 'dz']]],
    layout: dotLayout(DOT_LANES, { 'icon-size': dotSize(DOT_LANES, true), 'icon-offset': vec2('io') }),
    paint: dotPaint(['case', ['==', ['get', 'ug'], 1], REST.ringUg, REST.ring], lin([10, 0.9, 13, 1.2, 16, 1.6, 18, 2])) });
  layer({ id: 'tk-mdot', type: 'symbol', source: 'tk-st', minzoom: Z_SPLIT, filter: ['==', ['get', 'm'], 1],
    layout: dotLayout(DOT_LANES, { 'icon-size': dotSize(DOT_LANES, true), 'icon-offset': vec2('io'), 'symbol-sort-key': ['-', 0, ['get', 'dsc']] }),
    paint: dotPaint(REST.ringHub, lin([14, 1.3, 16, 1.7, 18, 2.1])) });
  layer({ id: 'tk-pick-dot', type: 'symbol', source: 'tk-pick-st',
    layout: dotLayout(PICK_LANES, { 'icon-offset': vec2('io') }),
    paint: dotPaint(['get', 'c'], lin([9, 1.2, 12, 1.6, 15, 2.2, 18, 2.8])) });

  // names (station names over trains): singles, complexes below Z_SPLIT, complex names from Z_SPLIT
  const textField = () => (lang === 'ja' ? ['get', 'ja']
    // baris kedua (nama dalam aksara lain) hanya bila berbeda: data Jakarta punya satu nama, dan nama ganda terbaca seperti bayangan
    : ['step', ['zoom'], ['get', 'en'], 16, ['case', ['==', ['get', 'en'], ['get', 'ja']], ['get', 'en'],
      ['format', ['get', 'en'], {}, '\n', {}, ['get', 'ja'], { 'font-scale': 0.8, 'text-color': REST.nameQuiet }]]]);
  // kana and kanji (drawn by the browser) read smaller than Latin at the same size: JA one px up
  const textSize = () => ['interpolate', ['linear'], ['zoom'], 10, ['+', ['get', 'sz'], lang === 'ja' ? 1 : 0], 16, ['+', ['get', 'sz'], lang === 'ja' ? 2.5 : 1.5]];
  const nameLayout = (filter, far = 1) => ({
    'text-field': textField(), 'text-font': FONT, 'text-size': textSize(),
    'text-variable-anchor-offset': ['match', ['get', 'side'], ...SIDES.flatMap((k) => [k, anchorsFor(k, far)]), anchorsFor('e', far)],
    'text-justify': 'auto', 'text-max-width': 9, 'text-padding': 2, 'symbol-sort-key': ['get', 'sk'],
    'text-allow-overlap': false, 'text-ignore-placement': false, 'text-optional': false, ...filter,
  });
  const namePaint = {
    'text-color': ['match', ['get', 'rank'], 0, REST.nameHub, 5, REST.nameQuiet, REST.name],
    'text-halo-color': REST.halo, 'text-halo-width': 1.8, 'text-halo-blur': 0.2,
  };
  const zoomOk = ['>=', ['zoom'], ['get', 'mz']];
  layer({ id: 'tk-slabel', type: 'symbol', source: 'tk-names', filter: ['all', ['==', ['get', 'zr'], 0], zoomOk], layout: nameLayout({}), paint: namePaint });
  layer({ id: 'tk-glabel', type: 'symbol', source: 'tk-names', maxzoom: Z_SPLIT, filter: ['all', ['==', ['get', 'zr'], 1], zoomOk], layout: nameLayout({}), paint: namePaint });
  layer({ id: 'tk-nlabel', type: 'symbol', source: 'tk-names', minzoom: Z_SPLIT, filter: ['==', ['get', 'zr'], 2], layout: nameLayout({}, 1.8), paint: namePaint });
  // the picked line's names: every stop that fits, in order along the line
  layer({ id: 'tk-pick-label', type: 'symbol', source: 'tk-pick-st',
    layout: nameLayout({}),
    paint: { ...namePaint, 'text-color': '#2F2F35' } });
  // the selected station: a ring like kereta's picked ring
  layer({ id: 'tk-sel', type: 'circle', source: 'tk-sel',
    paint: { 'circle-radius': lin([10, 9, 14, 12, 18, 16]), 'circle-opacity': 0, 'circle-stroke-width': 2, 'circle-stroke-color': REST.ink, 'circle-pitch-alignment': 'map' } });
  // collision blockers: invisible copies of the dots, placed before every label so no name covers a dot
  const blk = (id, src, lanes, extra, filter) => layer({ id, type: 'symbol', source: src, ...extra, ...(filter ? { filter } : {}),
    layout: { 'icon-image': 'tk-disc', 'icon-size': dotSize(lanes, src === 'tk-st'), 'icon-allow-overlap': true, 'icon-ignore-placement': false, 'icon-padding': 0,
      'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map', ...(src === 'tk-grp' ? {} : { 'icon-offset': vec2('ib') }) },
    paint: { 'icon-opacity': 0 } });
  // (the disc image is twice the dot with its SDF margin, so half the lanes = a box exactly the visible dot)
  blk('tk-blk-g', 'tk-grp', HUB_LANES * BLK, { maxzoom: Z_SPLIT }, ['>=', ['zoom'], ['get', 'dz']]);
  blk('tk-blk-s', 'tk-st', DOT_LANES * BLK, {}, ['any', ['all', ['==', ['get', 'm'], 0], ['>=', ['zoom'], ['get', 'dz']]], ['all', ['==', ['get', 'm'], 1], ['>=', ['zoom'], Z_SPLIT]]]);
  blk('tk-blk-p', 'tk-pick-st', PICK_LANES * BLK, {});

  // the basemap's place, road and water names over the rail network and the trains (no name under a line: "Tokorozawa",
  // "GOTANDA" sat under lines and trainsets), right under the station names, which keep their placement priority (MapLibre
  // places top-down; the dot blockers on top still keep every name off the dots). labelsBefore = the lowest of them, so
  // the page puts the trains (and 3D) under the names. Not when the caller placed the network itself (opts.before).
  let labelsBefore = NET_LABELS_BEFORE;
  if (!before && opts.liftBaseLabels !== false) {
    const base = BASE_LABEL_LAYERS.filter((id) => map.getLayer(id));
    try { for (const id of base) map.moveLayer(id, NET_LABELS_BEFORE); if (base.length) labelsBefore = base[0]; } catch { labelsBefore = NET_LABELS_BEFORE; }
  }

  const REST_LABELS = ['tk-slabel', 'tk-glabel', 'tk-nlabel'];
  const REST_DOTS = ['tk-gdot', 'tk-sdot', 'tk-mdot', 'tk-blk-g', 'tk-blk-s'];   // hidden while a line is picked
  const LINE_HIT = ['tk-pick', 'tk-pick-ug', 'tk-rest', 'tk-rest-ug'];
  const REST_LINES = ['tk-rest', 'tk-rest-ug', 'tk-via-edge', 'tk-via-deck'];
  const STATION_HIT = ['tk-pick-dot', 'tk-pick-label', 'tk-mdot', 'tk-sdot', 'tk-gdot', 'tk-nlabel', 'tk-glabel', 'tk-slabel'];

  // ------------------------------------------------------------ picking
  let picked = null;   // {line, stops}
  let shown = true;    // setVisible
  const lineIndex = (id) => (typeof id === 'number' ? (lines[id] ? id : -1) : lines.findIndex((l) => l.id === id));
  const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };

  /**
   * Show one line (index or id; null clears): its colour with a white casing, its stations ringed in its colour with
   * names, the rest of the network stepped back. `stops` (station indexes) = only those are ringed and named (a train's
   * stops). Returns the drawn bbox [w, s, e, n] (for fitBounds), or null.
   */
  function highlightLine(id, { stops } = {}) {
    const i = id == null ? -1 : lineIndex(id);
    if (i < 0) { clear(); return null; }
    const l = lines[i];
    const c = l.color || REST.ink;
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    const feats = piecesOf[i].map((p) => {
      for (const [x, y] of p.coords) { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
      return { type: 'Feature', properties: { ln: p.ln, c, ug: p.cls === 1 ? 1 : 0, via: p.cls === 2 ? 1 : 0 }, geometry: { type: 'LineString', coordinates: p.coords } };   // via: city3d takes the viaduct stretches off the ground while it shows
    });
    map.getSource('tk-pick')?.setData({ type: 'FeatureCollection', features: feats });
    const want = Array.isArray(stops) && stops.length ? stops : (l.stations || []);
    const seen = new Set();
    const sf = [];
    want.forEach((si, k) => {
      if (seen.has(si) || !stations[si]) return;
      seen.add(si);
      // a stop on another line (through service): draw it where that line puts it
      const p = places[si];
      if (!p || (p.hidden && stations[si].line === i)) return;
      const g = groupOf(si);
      const n = nameOf(stations[si]);
      const ends = k === 0 || k === want.length - 1;
      const rank = ends ? 0 : g >= 0 ? 1 + Math.min(3, groupInfo.get(g)?.rank ?? 3) : 5;
      const v = laneVec(p.lane, p.bearing);
      sf.push({ type: 'Feature', properties: { s: si, g, c, io: [v[0] * PICK_LANE, v[1] * PICK_LANE], ib: [v[0] * PICK_LANE / BLK, v[1] * PICK_LANE / BLK], rank, sk: rank * 100 + k * 0.01, mz: 0, sz: ends ? 13 : 12,
        side: sideOf(p.lng, p.lat, l.id === YAMANOTE), en: n.en || n.ja, ja: n.ja || n.en }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
    });
    map.getSource('tk-pick-st')?.setData({ type: 'FeatureCollection', features: sf });
    picked = { line: i, stops: want };
    // the rest steps back: lines faded, their stations and names off (the picked line's names then always find room)
    for (const id2 of REST_LINES) map.setPaintProperty(id2, 'line-opacity', id2.startsWith('tk-via') ? 0 : 0.4);
    for (const id2 of [...REST_DOTS, ...REST_LABELS]) vis(id2, false);
    return Number.isFinite(bb[0]) ? bb : null;
  }

  /** A ring around a station (index; null removes it): kereta's picked-station ring. */
  function highlightStation(si) {
    const s = si == null ? null : stations[si];
    let pt = null;
    if (s) {
      const g = groupOf(si);
      const p = places[si];
      pt = map.getZoom() < Z_SPLIT && g >= 0 ? groupInfo.get(g)?.lngLat : p ? [p.lng, p.lat] : null;
    }
    map.getSource('tk-sel')?.setData(pt ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt } }] } : EMPTY);
  }

  /** Back to the network at rest (no picked line, no ring). */
  function clear() {
    picked = null;
    map.getSource('tk-pick')?.setData(EMPTY);
    map.getSource('tk-pick-st')?.setData(EMPTY);
    map.getSource('tk-sel')?.setData(EMPTY);
    for (const id2 of REST_LINES) map.setPaintProperty(id2, 'line-opacity', id2.startsWith('tk-via') ? VIA_ON : 1);
    if (shown) for (const id2 of [...REST_DOTS, ...REST_LABELS]) vis(id2, true);
  }

  /** the heights build's elev-v1.json (parsed; null = whole lines by line.underground): tunnels dashed, viaducts decked. */
  function setElevation(json) {
    elev = json || null;
    buildLines();
    setSource('tk-lines', { type: 'FeatureCollection', features: lineFeatures });
    if (picked) highlightLine(picked.line, { stops: picked.stops });
  }

  function setLang(next) {
    lang = labelLang(next);
    for (const id2 of [...REST_LABELS, 'tk-pick-label']) if (map.getLayer(id2)) { map.setLayoutProperty(id2, 'text-field', textField()); map.setLayoutProperty(id2, 'text-size', textSize()); }
  }

  function setRest(mode) {
    rest = mode === 'tint' || mode === 'color' ? 'color' : 'neutral';
    map.setPaintProperty('tk-rest', 'line-color', restColor());
  }

  function setVisible(on) {
    shown = !!on;
    for (const id2 of layerIds) vis(id2, shown);
    if (shown && picked) for (const id2 of [...REST_DOTS, ...REST_LABELS]) vis(id2, false);
  }

  /** What is under a screen point: {type: 'station', index, group} | {type: 'line', index} | null. */
  function hit(pt, radius = 12) {
    const box = [[pt.x - radius, pt.y - radius], [pt.x + radius, pt.y + radius]];
    const layers = STATION_HIT.filter((id2) => map.getLayer(id2) && map.getLayoutProperty(id2, 'visibility') !== 'none');
    let best = null, bd = Infinity;
    for (const f of map.queryRenderedFeatures(box, { layers })) {
      const si = f.properties?.s;
      if (si == null || !stations[si]) continue;
      const g = f.properties.g ?? -1;
      const ll = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
      const q = ll ? map.project(ll) : pt;
      const isText = /label/.test(f.layer?.id || '');
      const d = isText ? radius * 0.5 : Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { bd = d; best = { type: 'station', index: si, group: g >= 0 ? g : -1 }; }
    }
    if (best) return best;
    const lb = [[pt.x - 6, pt.y - 6], [pt.x + 6, pt.y + 6]];
    const lf = map.queryRenderedFeatures(lb, { layers: LINE_HIT.filter((id2) => map.getLayer(id2)) });
    if (picked && lf.some((f) => f.layer.id === 'tk-pick' || f.layer.id === 'tk-pick-ug')) return { type: 'line', index: picked.line };
    const f = lf.find((x) => x.properties && x.properties.i != null);
    return f ? { type: 'line', index: f.properties.i } : null;
  }

  const onClick = (e) => {
    if (!opts.onStation && !opts.onLine) return;
    const h = hit(e.point);
    if (!h) return;
    if (h.type === 'station' && opts.onStation) {
      const s = stations[h.index];
      opts.onStation(h.index, { group: h.group, name: s.name, lngLat: [s.lng, s.lat] });
    } else if (h.type === 'line' && opts.onLine) opts.onLine(h.index);
  };
  let hoverRaf = 0;
  const onMove = (e) => {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; map.getCanvas().style.cursor = hit(e.point, 8) ? 'pointer' : ''; });
  };
  map.on('click', onClick);
  if (opts.onStation || opts.onLine) map.on('mousemove', onMove);
  // deferData: the lines first, then the dots and the names; a function = the caller says when (it gets flush)
  if (pending.size) { if (typeof opts.deferData === 'function') opts.deferData(flush); else setTimeout(flush, 0); }

  function destroy() {
    pending.clear();
    map.off('click', onClick);
    map.off('mousemove', onMove);
    cancelAnimationFrame(hoverRaf);
    for (const id2 of [...layerIds].reverse()) if (map.getLayer(id2)) map.removeLayer(id2);
    for (const id2 of sourceIds) if (map.getSource(id2)) map.removeSource(id2);
  }

  return {
    highlightLine, highlightStation, clear, setLang, setRest, setVisible, setElevation, hit, destroy, lanePx,
    labelsBefore, layers: layerIds.slice(),
    /** The point a station is drawn at ([lng, lat], the complex's dot below Z_SPLIT). */
    stationPoint(si, zoom = map.getZoom()) {
      const g = groupOf(si);
      if (zoom < Z_SPLIT && g >= 0) return groupInfo.get(g)?.lngLat || null;
      const p = places[si];
      return p ? [p.lng, p.lat] : null;
    },
    get picked() { return picked ? picked.line : null; },
  };
}
