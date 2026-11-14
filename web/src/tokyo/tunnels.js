// underground track alignments from OpenStreetMap.
// Data © OpenStreetMap contributors, ODbL 1.0 (the site's credits already name OpenStreetMap).
//
// Reads var/static/tokyo/tunnels-v1.json (served at /data/tokyo/tunnels-v1.json, ~100 KB br for every line) built by
// data-build/tunnels/build.mjs (its header describes the shape).
//
//   import { loadTunnels, trackAt } from './tunnels.js';
//   const t = await loadTunnels();                        // every line (or loadTunnels(fetchFn), loadTunnels([ids]))
//   const oedo = t.lines.get('Toei.Oedo');                // Map lineId -> { tracks, portals, platforms, cov }
//   oedo.tracks[0].coords  -> [[lng, lat], ...]   exact OSM track (one physical track, or one way for both)
//   oedo.tracks[0].m       -> Float64Array        chainage of each vertex on OUR line.path (network-v1, net.js segLen
//                                                  metric = the heights build / elev-v2 profiles: depth at a vertex = profile(m))
//   oedo.tracks[0].side    -> -1 | 0 | 1           left / centre-or-unknown / right of increasing chain (Japan keeps
//                                                  left: a train heading up the chain runs on side -1)
//   trackAt(track, m) -> [lng, lat] on the real track at chainage m (put a train inside its tube: the line path can
//                        sit tens of metres off the real tunnel, e.g. Yokosuka Tokyo - Shinagawa)
import { decodePath } from './net.js';

export const TUNNELS_URL = '/data/tokyo/tunnels-v1.json';

// Integer sequence codec: deltas, zigzag, the polyline varint alphabet (one value per track vertex).
export function encodeInts(arr) {
  let last = 0, out = '';
  for (const x of arr) {
    const n = Math.round(x), d = n - last; last = n;
    let v = d < 0 ? ~(d << 1) : d << 1;
    while (v >= 32) { out += String.fromCharCode((v & 31) + 95); v >>>= 5; }
    out += String.fromCharCode(v + 63);
  }
  return out;
}

export function decodeInts(str) {
  const out = [];
  let i = 0, cur = 0;
  while (i < str.length) {
    let v = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << shift; shift += 5; } while (b >= 32);
    cur += v & 1 ? ~(v >>> 1) : v >>> 1;
    out.push(cur);
  }
  return out;
}

function decodeTrack(t) {
  const coords = decodePath(t.path);
  const m = t.m ? Float64Array.from(decodeInts(t.m)) : null;
  return {
    coords, m, osm: t.osm || [], tunnel: t.tunnel !== false,
    layer: t.layer ?? null, level: t.level ?? null, chain: t.chain || (m ? [m[0], m[m.length - 1]] : null),
    len: t.len ?? null, off: t.off ?? 0, side: t.side || 0, bore: t.bore || null, twin: !!t.twin, svc: t.svc || null,
    aux: !!t.aux,
    portalStart: !!(t.portal & 1), portalEnd: !!(t.portal & 2), name: t.name || null,
  };
}

// json = parsed tunnels-v1.json; lineIds = array of MT3D railway ids (omit = all). Returns
// { meta, lines: Map(id -> { tracks, portals: [{ lng, lat, m }], platforms: [{ station, coords, m: [fromM, toM], level,
//   layer, ref, osm }], cov: { ugM, covM } }), shared: { wayId: [lineIds] } }. Lines without OSM tunnel tracks are absent.
export function decodeTunnels(json, lineIds) {
  if (!json || json.kind !== 'tokyo-tunnels' || json.version !== 1) throw new Error('decodeTunnels: not a tokyo-tunnels v1 pack');
  const ids = lineIds && lineIds.length ? lineIds : Object.keys(json.lines);
  const lines = new Map();
  for (const id of ids) {
    const r = json.lines[id];
    if (!r) continue;
    lines.set(id, {
      tracks: r.tracks.map(decodeTrack),
      portals: (r.portals || []).map((p) => ({ lng: p[0], lat: p[1], m: p[2] ?? null })),
      platforms: (r.platforms || []).map((p) => ({
        station: p.station, coords: decodePath(p.path), level: p.level ?? null, layer: p.layer ?? null,
        ref: p.ref ?? null, m: p.m ?? null, osm: p.osm,
      })),
      cov: { ugM: r.cov?.[0] ?? 0, covM: r.cov?.[1] ?? 0 },
    });
  }
  const meta = { built: json.built, source: json.source, attribution: json.attribution, license: json.license,
    chain: json.chain, net: json.net, osm: json.osm };
  return { meta, lines, shared: json.shared || {} };
}

let cache = null; // { url, promise }
// Fetches the pack once (the whole network is ~100 KB br; phones keep it) and decodes the asked lines.
//   loadTunnels()                 every line, global fetch
//   loadTunnels(fetchFn)          every line, your fetch
//   loadTunnels(['Toei.Oedo'], { url, fetch })
export async function loadTunnels(lineIds, opts = {}) {
  if (typeof lineIds === 'function') { opts = { ...opts, fetch: lineIds }; lineIds = null; }
  const { url = TUNNELS_URL, fetch: f = globalThis.fetch } = opts;
  if (!cache || cache.url !== url) {
    const promise = f(url).then((res) => {
      if (!res.ok) throw new Error(`loadTunnels: ${res.status} for ${url}`);
      return res.json();
    });
    cache = { url, promise };
    promise.catch(() => { if (cache && cache.promise === promise) cache = null; });
  }
  return decodeTunnels(await cache.promise, lineIds);
}
export function clearTunnelsCache() { cache = null; }

// [lng, lat] on the track at chainage m (clamped to the track's chain range); null without chainage.
export function trackAt(track, m) {
  const { coords, m: M } = track;
  if (!M || !coords.length) return null;
  const n = coords.length;
  if (m <= M[0]) return coords[0].slice();
  if (m >= M[n - 1]) return coords[n - 1].slice();
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (M[mid] <= m) lo = mid; else hi = mid; }
  const span = M[hi] - M[lo], t = span > 0 ? (m - M[lo]) / span : 0;
  return [coords[lo][0] + (coords[hi][0] - coords[lo][0]) * t, coords[lo][1] + (coords[hi][1] - coords[lo][1]) * t];
}

// The tracks of a line that cover chainage m (both bores of a twin-track tunnel, plus sidings unless skipped).
export function tracksAt(line, m, { aux = false, svc = true } = {}) {
  if (!line) return [];
  return line.tracks.filter((t) => t.chain && t.chain[0] <= m && t.chain[1] >= m && (aux || !t.aux) && (svc || !t.svc));
}
