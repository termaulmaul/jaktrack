/*! Network data from Mini Tokyo 3D, (c) 2019-2026 Akihiko Kusanagi, MIT License: see /LICENSES.txt */
// the app network pack decoder.
// Reads var/static/tokyo/network-v1.json (served at /data/tokyo/network-v1.json) into the in-memory shape of
// docs/ARCHITECTURE.md "Data shapes". Network data derived from Mini Tokyo 3D, (c) Akihiko Kusanagi, MIT.
//
//   import { unpackNet } from './net.js';
//   const net = unpackNet(await (await fetch('/data/tokyo/network-v1.json')).json());
//   net.lines[i].path  -> [[lng, lat], ...]   net.lines[i].chain -> metres along path per station
//
// Distances: segLen() below is THE metric used to build `chain` and `length`; measure a path with measure() /
// pointAt() from this file so positions line up with the pack to the metre.

const D2R = Math.PI / 180;
export const EARTH_R = 6371008.8; // mean Earth radius, metres

// Polyline codec, precision 1e5 (same encoder as trafik.live's KRL bundle).
export function encodePath(points) {
  let last = [0, 0], out = '';
  for (const p of points) for (let i = 0; i < 2; i++) {
    const n = Math.round(p[i] * 1e5), d = n - last[i]; last[i] = n;
    let v = d < 0 ? ~(d << 1) : d << 1;
    while (v >= 32) { out += String.fromCharCode((v & 31) + 95); v >>>= 5; }
    out += String.fromCharCode(v + 63);
  }
  return out;
}

export function decodePath(str) {
  const out = [];
  let i = 0, lng = 0, lat = 0;
  const next = () => {
    let v = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << shift; shift += 5; } while (b >= 32);
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  };
  while (i < str.length) {
    lng += next(); lat += next();
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

// Metres between two [lng, lat] points (equirectangular at the mean latitude; < 0.01 % off for track segments).
export function segLen(a, b) {
  const k = Math.cos((a[1] + b[1]) * D2R / 2);
  const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy) * D2R * EARTH_R;
}

// Cumulative metres at each vertex of a path.
export function measure(path) {
  const cum = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + segLen(path[i - 1], path[i]);
  return cum;
}

// Position at `m` metres along line.path: [lng, lat, bearingDeg]. Caches the cumulative metres on the line.
export function pointAt(line, m) {
  const path = line.path, cum = line.cum || (line.cum = measure(path));
  const n = path.length;
  if (n === 0) return null;
  if (n === 1) return [path[0][0], path[0][1], 0];
  if (m <= 0) m = 0;
  if (m >= cum[n - 1]) m = cum[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
  const a = path[lo], b = path[hi], span = cum[hi] - cum[lo], t = span > 0 ? (m - cum[lo]) / span : 0;
  const k = Math.cos((a[1] + b[1]) * D2R / 2);
  const bearing = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / D2R + 360) % 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, bearing];
}

// Drawing lane at `m` metres along a line (piecewise linear over line.lanes = [m0, lane0, m1, lane1, ...]).
// Lane units follow Mini Tokyo 3D: 1 lane = one track spacing; positive = right of the path's direction
// (same sign as MapLibre `line-offset`). Lines without lane data return line.offset.
export function laneAt(line, m) {
  const L = line.lanes;
  if (!L || L.length < 2) return line.offset || 0;
  if (m <= L[0]) return L[1];
  const n = L.length;
  if (m >= L[n - 2]) return L[n - 1];
  let lo = 0, hi = n / 2 - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid * 2] <= m) lo = mid; else hi = mid; }
  const m0 = L[lo * 2], m1 = L[hi * 2], v0 = L[lo * 2 + 1], v1 = L[hi * 2 + 1];
  return m1 > m0 ? v0 + (v1 - v0) * (m - m0) / (m1 - m0) : v1;
}

const title = (en, ja) => ({ en, ja });

// json = parsed network-v1.json. Returns { lines, stations, groups, types, dirs, ops, meta } (the data shapes (docs/ARCHITECTURE.md),
// plus the extra fields listed in: line.lanes/ascending/descending/hidden/codes/cum,
// station.alt/part/uname/m/pos).
export function unpackNet(json) {
  if (!json || json.v !== 1 || json.kind !== 'tokyo-network') throw new Error('unpackNet: not a tokyo-network v1 pack');
  const F = json.fields;
  const col = (name, key) => {
    const i = F[name].indexOf(key);
    if (i < 0) throw new Error(`unpackNet: ${name}.${key} missing`);
    return i;
  };
  const ops = json.ops.map((r) => ({ id: r[0], title: title(r[1], r[2]), short: title(r[3] || r[1], r[4] || r[2]) }));
  const types = json.types.map((r) => ({ id: r[0], title: title(r[1], r[2]), color: r[3], rank: r[4] }));
  const dirs = json.dirs.map((r) => ({ id: r[0], title: title(r[1], r[2]) }));
  const L = Object.fromEntries(F.lines.map((k) => [k, col('lines', k)]));
  const lines = json.lines.map((r) => {
    const line = {
      id: r[L.id], title: title(r[L.en], r[L.ja]), color: r[L.color], code: r[L.code], op: r[L.op], cars: r[L.cars],
      underground: r[L.underground] === 1, loop: r[L.loop] === 1, stations: r[L.stations], path: decodePath(r[L.path]),
      chain: r[L.chain], length: r[L.length], offset: r[L.offset],
      lanes: r[L.lanes], ascending: r[L.ascending], descending: r[L.descending],
    };
    if (L.hidden !== undefined && r[L.hidden]) line.hidden = r[L.hidden];
    if (L.codes !== undefined && r[L.codes]) line.codes = r[L.codes]; // all station-number prefixes (multi-prefix lines)
    return line;
  });
  const S = Object.fromEntries(F.stations.map((k) => [k, col('stations', k)]));
  const stations = json.stations.map((r) => ({
    id: r[S.id], line: r[S.line], name: title(r[S.en], r[S.ja]),
    lng: r[S.lng] === null ? null : r[S.lng] / 1e5, lat: r[S.lat] === null ? null : r[S.lat] / 1e5,
    group: r[S.group], underground: r[S.underground] === 1, code: r[S.code],
    alt: r[S.alt], part: r[S.part], uname: r[S.uen] ? title(r[S.uen], r[S.uja]) : null,
  }));
  // On-path position of each station (where trains stop and markers sit; MT3D's station coordinates are sometimes
  // a station building away from the platforms): station.m = chain metres on its line, station.pos = [lng, lat].
  for (const line of lines) {
    line.stations.forEach((si, k) => {
      const s = stations[si];
      if (s.m !== undefined) return; // Yamanote lists Osaki twice: keep the first (chain 0)
      s.m = line.chain[k];
      const p = pointAt(line, s.m);
      s.pos = p ? [p[0], p[1]] : null;
    });
  }
  for (const s of stations) if (s.m === undefined) { s.m = null; s.pos = null; }
  // `operators` = same array as `ops` (model.js's fixture and some lanes use that name).
  return { lines, stations, groups: json.groups, types, dirs, ops, operators: ops, meta: json.meta };
}

// Optional extra-language names (network-v1-names.json, loaded lazily e.g. by search): adds ko / zh-Hans / zh-Hant
// keys to line.title, station.name and station.uname (when MT3D has them). Returns net.
export function mergeNames(net, names) {
  if (!names || names.kind !== 'tokyo-network-names') return net;
  const langs = names.langs;
  const put = (obj, row) => {
    if (!obj || !row) return;
    langs.forEach((lang, i) => { if (row[i]) obj[lang] = row[i]; else if (row[i] === 0 && i > 0 && row[i - 1]) obj[lang] = obj[langs[i - 1]]; });
  };
  names.lines.forEach((row, i) => put(net.lines[i] && net.lines[i].title, row));
  names.stations.forEach((row, i) => put(net.stations[i] && net.stations[i].name, row));
  (names.unames || []).forEach(([i, row]) => put(net.stations[i] && net.stations[i].uname, row));
  return net;
}
