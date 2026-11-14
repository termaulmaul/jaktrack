// 3D view: the underground as what was DUG: real tunnels you can ride along, shaped like the real excavation.
//
//   - Bores, in real metres: shield tunnels as round bores (twin single-track bores ~6.8 m, a double-track bore ~10 m;
//     Oedo's mini-metro bores ~5.3 m) with their lining rings (1.2 m segments, drawn in the shader, fading out when a ring
//     is under a few px); cut-and-cover lines as rectangular boxes (~9.6 x 6.2 m, double track) with their joints. The
//     lower half (invert, walls) is opaque in the line's colour, softly lit (round bores shade round); the crown / roof is
//     see-through, so the trains inside show. Which shape where: the depths build's sections when elev-v2 is there, until then
//     an estimate (TYPE below: Tokyo's shallow lines were dug from the street, the deep ones bored) drawn a little lighter.
//   - Station boxes: a box per underground platform, the length of its trains, wider and taller than the bores (shield
//     stations are caverns of about that size too), see-through, tinted by the line; a see-through shaft up to the street.
//   - The street: a see-through slab at 0 m, a faint 250 m grid fading to its rim (as round 2).
//   - Depth: the heights build (elev-v1) metres x u_exag (5, or 1 = TRUE SCALE: real proportions, sizes not floored either); sizes are
//     floored in px with the trains (u_k) so a bore always holds its train; u_lift raises everything (the ride-along camera
//     rides at the ground plane, so the ridden line is lifted to it).
//   - Geometry is built per AREA (CELL_M cells), only for cells in view, pooled (LRU, POOL_MAX cells): memory follows what
//     you look at, not the whole network.
//
// export const CELL_M, POOL_MAX, RING_M, TYPE
// export function boreRuns(net, profiles, tie, opts?) -> runs: [{ line, n, pts: Float64Array(n * 6: x, y, h, mx, my, s), col, sec }]
// export function crossSection(sec) -> { verts: [[lx, lz, nx, nz, glass]], faces: [[a, b]] } (a ring of the shape)
// export function cellGeometry(runs, cx, cy) -> { data: Float32Array (VF floats a vertex), opaque: Uint32Array, glass: Uint32Array }
// export function createBoresGL(gl, { net, profiles, depths, sections? }) -> { draw(u, 'opaque' | 'glass'), stations(u), stats(), destroy() }

import { trackOf, pointAt } from './track.js';
import { carSpec } from './trainset.js';   // the overhead bar at the line's pantograph height

export const CELL_M = 1500, POOL_MAX = 36, RING_M = 1.2, JOINT_M = 15, DETAIL_Z = 18.5;
const VF = 12;   // floats a vertex: x, y, h, mx, my, lx, lz, nx, nz, s, rgb, flags (1 shield, 2 estimated, 4 glass)
export const UNDER_M = -2;

/** Section shapes (m). shield2 = twin single-track bores, shield1 = one double-track bore, mini = Oedo's small twin bores. */
export const SHAPES = {
  shield2: { kind: 'shield', bores: 2, r: 3.4, gap: 1.2, invert: 1.0 },
  shield1: { kind: 'shield', bores: 1, r: 5.0, gap: 0, invert: 1.3 },
  mini: { kind: 'shield', bores: 2, r: 2.65, gap: 1.0, invert: 0.8 },
  box: { kind: 'box', w: 9.6, h: 6.2, floor: 0.6 },
  // one OSM track: its own bore, or its half of a box
  track: { kind: 'shield', bores: 1, r: 3.4, gap: 0, invert: 1.0 },
  trackbox: { kind: 'box', w: 5.0, h: 6.2, floor: 0.6 },
  // r3c (elev-v2.1 openAir): the track in the open between two portals, on a small deck; the river / valley under it
  deck: { kind: 'box', w: 9.0, h: 1.2, floor: 1.2, open: true },
  // r3d riding: a platform (top 1.1 m over the rail, the yellow tactile strip + the line's colour along its edges in the
  // shader), with platform doors (glass panels) on the lines that have them
  platform: { kind: 'box', w: 8.0, h: 1.3, floor: 0.2, open: true, part: 6 },
  platformpsd: { kind: 'box', w: 8.0, h: 1.3, floor: 0.2, open: true, part: 6, doors: true },
  water: { kind: 'box', w: 34, h: 0.3, floor: 0, glassAll: true },
};
export const DECK_RGB = 0xC4C8CF, WATER_RGB = 0xA7C6E6, PORTAL_RGB = 0xB3B8C0;
const ESTIMATED_PLATFORMS = false;
/** Lines with platform doors at their underground stations (Tokyo Metro and Toei, 2026; Asakusa still rolling out). */
const PSD = /^(TokyoMetro\.(Namboku|Marunouchi|MarunouchiBranch|Ginza|Hibiya|Tozai|Chiyoda|Yurakucho|Hanzomon|Fukutoshin)|Toei\.(Oedo|Mita|Shinjuku|Asakusa))$/;
/** The ESTIMATE until the depths build's sections: well-known lines first, else by depth (shallow = dug from the street). */
export const TYPE = {
  'TokyoMetro.Ginza': 'box', 'TokyoMetro.Marunouchi': 'box', 'TokyoMetro.MarunouchiBranch': 'box', 'TokyoMetro.Hibiya': 'box',
  'TokyoMetro.Tozai': 'box', 'TokyoMetro.Chiyoda': 'box', 'Toei.Asakusa': 'box', 'Toei.Mita': 'box', 'Toei.Shinjuku': 'box',
  'Toei.Oedo': 'mini', 'TokyoMetro.Namboku': 'shield2', 'TokyoMetro.Hanzomon': 'shield2', 'TokyoMetro.Yurakucho': 'shield2',
  'TokyoMetro.Fukutoshin': 'shield2', 'JR-East.SobuRapid': 'shield2', 'JR-East.Yokosuka': 'shield2', 'JR-East.Keiyo': 'shield2',
  'TWR.Rinkai': 'shield1', 'MIR.TsukubaExpress': 'shield1',
};
// jaktrack, asumsi (pengetahuan umum, bukan dari data): terowongan MRT Jakarta fase 1 adalah dua tabung bor (TBM) di antara
// stasiun, dengan stasiun cut-and-cover. Ditulis eksplisit agar tidak bergantung pada tebakan kedalaman di bawah ini.
const typeOf = (id, depth) => TYPE[id] || (String(id).startsWith('mrt.') ? 'shield2' : depth > -12 ? 'box' : 'shield2');
/** The shape for a key: SHAPES[name], resized by '@size' (a bore's diameter, a box's width; elev-v2 sections). */
export function parseShape(key) {
  const [name, sz] = String(key || 'box').split('@');
  const S = { ...(SHAPES[name] || SHAPES.box) };
  const size = Number(sz);
  if (sz != null && Number.isFinite(size) && size > 0) {
    if (S.kind === 'shield') S.r = size / 2;
    else S.w = size;
  }
  return S;
}
/** Where a train runs, m left of the line's centre (keep left): in its own bore for twin bores, else its track in the
 * shared box / bore. */
export function trackOffset(id, depth = -15, key = null) {
  const S = parseShape(key || typeOf(id, depth));
  return S.kind === 'shield' && S.bores === 2 ? S.r + S.gap / 2 : 1.9;
}

const pack = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? parseInt(m[1], 16) : 0x8c8c94; };

/** A ring of the section around the rail level, in m: lateral (along the way's left normal) and vertical; each vertex
 * with its outward normal (nx lateral, nz up) and whether it belongs to the see-through crown / roof. faces = vertex pairs
 * to join with the next ring (quads). */
export function crossSection(name) {
  const S = parseShape(name);
  const verts = [], faces = [];
  if (S.kind === 'box') {
    const w = S.w / 2, f = -S.floor, h = S.h - S.floor;
    // 4 faces, 2 vertices each (flat normals): floor, right wall, roof (glass), left wall
    const quad = (a, b, n, glass) => { const i = verts.length; verts.push([a[0], a[1], n[0], n[1], glass], [b[0], b[1], n[0], n[1], glass]); faces.push([i, i + 1]); };
    const g = S.glassAll ? 1 : 0, part = S.part || 0;
    quad([-w, f], [w, f], [0, 1], g);
    quad([w, f], [w, h], [1, 0], g);
    quad([w, h], [-w, h], [0, 1], S.open ? 0 : 1);
    quad([-w, h], [-w, f], [-1, 0], g);
    if (S.doors) {
      // platform doors: glass panels 0.3 m in from both edges, 1.3 m high over the platform (part 7)
      const dl = w - 0.3, d0 = h, d1 = h + 1.3;
      quad([-dl, d0], [-dl, d1], [1, 0], 1);
      quad([dl, d1], [dl, d0], [-1, 0], 1);
      for (let k = verts.length - 4; k < verts.length; k++) verts[k][5] = 7;
    }
    for (const v of verts) if (v[5] == null) v[5] = part;
    return { verts, faces, kind: 'box', w: S.w };
  }
  const K = 10;
  for (let b = 0; b < S.bores; b++) {
    const cx = S.bores === 2 ? (b ? 1 : -1) * (S.r + S.gap / 2) : 0, cz = S.r - S.invert;
    const i0 = verts.length;
    for (let j = 0; j < K; j++) {
      const t = -Math.PI / 2 + (j + 0.5) * 2 * Math.PI / K;
      const c = Math.cos(t), s = Math.sin(t);
      verts.push([cx + S.r * c, cz + S.r * s, c, s, s > 0.25 ? 1 : 0]);
    }
    for (let j = 0; j < K; j++) faces.push([i0 + j, i0 + (j + 1) % K]);
  }
  return { verts, faces, kind: 'shield' };
}

/** Every underground run of every line along OUR line paths: points
 * with the true rail level (the heights build + the line's tie offset), the mitred normal, metres along the run. */
export function boreRuns(net, profiles, tie, { sections = null, section = null, conf = null, tracks = null, shown = null, openAir = null, platforms = null, station = null } = {}) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const runs = [];
  for (let i = 0; i < lines.length; i++) {
    const pr = profiles[i];
    if (shown && !shown(i)) continue;   // elev-v2.1: lines with only rural mountain tunnels stay out of the underground view
    if (openAir) openRuns(i, lines[i], openAir(i));
    if (pr && pr.min < UNDER_M) platformRuns(i, lines[i], pr, platforms?.[i] || null);
    if (!pr || !(pr.min < UNDER_M)) continue;
    const line = lines[i], t = trackOf(line), k = t.k || 1, ti = tie ? tie[i] : 0;
    // the real alignment where OSM has it; the gaps between its tracks stay on our line path (estimates)
    let covered = null;
    if (tracks?.[i]) {
      trackRuns(i, line, pr, ti, tracks[i]);
      covered = tracks[i].map((tk) => [tk.from - 20, tk.to + 20]);
    }
    const inTrack = (mc) => { if (!covered) return false; for (const c of covered) if (mc >= c[0] && mc <= c[1]) return true; return false; };
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        const n = run.length, pts = new Float64Array(n * 6);
        let s = 0, deep = 0;
        for (let v = 0; v < n; v++) {
          const a = run[Math.max(0, v - 1)], b = run[Math.min(n - 1, v + 1)];
          let nx = 0, ny = 0;
          if (v > 0) { const dx = run[v][0] - a[0], dy = run[v][1] - a[1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
          if (v < n - 1) { const dx = b[0] - run[v][0], dy = b[1] - run[v][1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
          const l = Math.hypot(nx, ny) || 1;
          nx /= l; ny /= l;
          let cosH = 1;
          if (v > 0 && v < n - 1) { const dx = b[0] - run[v][0], dy = b[1] - run[v][1], ll = Math.hypot(dx, dy) || 1; cosH = Math.max(0.45, nx * (-dy / ll) + ny * (dx / ll)); }
          if (v) s += Math.hypot(run[v][0] - run[v - 1][0], run[v][1] - run[v - 1][1]);
          const h = run[v][2], hh = h < 0 ? h - ti * Math.min(1, -h / 6) : h;
          pts.set([run[v][0], run[v][1], Math.min(0, hh), nx / cosH, ny / cosH, s], v * 6);
          if (h < deep) deep = h;
        }
        // real data (elev-v2) when there: the run's section shape and how sure its depths are (2 = estimated)
        const mid = run[n >> 1][3];
        const real = section ? section(i, mid) : null;
        const sec = real || sections?.(line, run) || typeOf(line.id, deep);
        let cs = 0;
        if (conf) { for (const p of run) cs += conf(i, p[3]); cs /= n; } else cs = 2;
        runs.push({ line: i, n, pts, col: pack(line.color), sec, est: true });   // our simplified line path: an estimate
      }
      run = [];
    };
    for (let v = 0; v + 1 < t.n; v++) {
      const m0 = t.cum[v], m1 = t.cum[v + 1];
      const h0 = pr.at(m0 / k), h1 = pr.at(m1 / k);
      if (!(h0 < UNDER_M || h1 < UNDER_M) || inTrack((m0 + m1) / 2 / k)) { flush(); continue; }
      const len = m1 - m0;
      const parts = Math.abs(h1 - h0) > 0.5 ? Math.max(1, Math.min(24, Math.ceil(len / 40))) : 1;
      if (section && run.length) {
        const a = section(i, run[run.length - 1][3]), b = section(i, (m0 + m1) / 2 / k);
        if (a !== b) { const last = run[run.length - 1]; flush(); run.push(last); }
      }
      if (!run.length) run.push([t.x[v], t.y[v], h0, m0 / k]);
      for (let j = 1; j <= parts; j++) {
        const f = j / parts;
        run.push([t.x[v] + (t.x[v + 1] - t.x[v]) * f, t.y[v] + (t.y[v + 1] - t.y[v]) * f, j === parts ? h1 : pr.at((m0 + len * f) / k), (m0 + len * f) / k]);
      }
    }
    flush();
  }
  return runs;

  // r3d: the platforms of the line's underground stations (riding shows them): OSM platform ways where has them,
  // else our line path over the station's length; at the station's rail level; doors on the lines that have them
  function platformRuns(i, line, pr, osm) {
    const psd = PSD.test(line.id) ? 'platformpsd' : 'platform';
    const t = trackOf(line), k = t.k || 1, Q = [0, 0, 1, 0];
    const done = new Set();
    for (const p of osm || []) {
      const mid = (p.from + p.to) / 2, h = pr.at(mid);
      if (!(h < UNDER_M) || p.n < 2) continue;
      const n = p.n, pts = new Float64Array(n * 6);
      let s = 0;
      for (let v = 0; v < n; v++) {
        const a = Math.max(0, v - 1), b = Math.min(n - 1, v + 1);
        let dx = p.x[b] - p.x[a], dy = p.y[b] - p.y[a];
        const l = Math.hypot(dx, dy) || 1;
        if (v) s += Math.hypot(p.x[v] - p.x[v - 1], p.y[v] - p.y[v - 1]);
        pts.set([p.x[v], p.y[v], h, -dy / l, dx / l, s], v * 6);
      }
      runs.push({ line: i, n, pts, col: pack(line.color), sec: psd, est: false, platform: true, open: true, station: p.station });
      done.add(p.station);
    }
    // stations without an OSM platform: none drawn (on our simplified path an estimated platform would stand where the real
    // trains run: they follow the OSM tracks); the station box of the overview still marks them
    if (ESTIMATED_PLATFORMS) for (let q = 0; q < (line.stations || []).length; q++) {
      const m = line.chain?.[q];
      const sid = net.stations?.[line.stations[q]]?.id;
      if (!Number.isFinite(m) || done.has(sid)) continue;
      const h = pr.at(m);
      if (!(h < UNDER_M)) continue;
      const half = Math.max(60, Math.min(130, (line.cars || 10) * 10 + 10)), n = 9, pts = new Float64Array(n * 6);
      let s = 0, px = 0, py = 0;
      for (let v = 0; v < n; v++) {
        pointAt(t, (m - half + 2 * half * v / (n - 1)) * k, Q);
        if (v) s += Math.hypot(Q[0] - px, Q[1] - py);
        px = Q[0]; py = Q[1];
        pts.set([Q[0], Q[1], h, -Q[3], Q[2], s], v * 6);
      }
      runs.push({ line: i, n, pts, col: pack(line.color), sec: psd, est: true, platform: true, open: true, station: sid });
    }
  }

  // elev-v2.1 openAir: the line out of its tunnel between two portals: an open deck at the track's level (= its portals'),
  // the valley / river under it (its height over the valley floor; modelled where the DEM had no data: 6 m, lighter)
  function openRuns(i, line, list) {
    if (!list) return;
    const t = trackOf(line), k = t.k || 1, Q = [0, 0, 1, 0];
    for (const o of list) {
      const len = o.to - o.from;
      if (!(len > 1)) continue;
      const n = Math.max(2, Math.min(60, Math.ceil(len / 15) + 1));
      for (const [sec, h, col] of [['deck', 0, DECK_RGB], ['water', -o.h, WATER_RGB]]) {
        const pts = new Float64Array(n * 6);
        let s = 0, px = 0, py = 0;
        for (let v = 0; v < n; v++) {
          const m = o.from + len * v / (n - 1);
          pointAt(t, m * k, Q);
          if (v) s += Math.hypot(Q[0] - px, Q[1] - py);
          px = Q[0]; py = Q[1];
          pts.set([Q[0], Q[1], h, -Q[3], Q[2], s], v * 6);
        }
        runs.push({ line: i, n, pts, col, sec, est: !!o.modelled, open: true });
      }
    }
  }

  // the real alignment (OSM tracks): a run per track stretch below UNDER_M; twin tracks get their own bore / box half
  function trackRuns(i, line, pr, ti, list) {
    for (const tk of list) {
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const n = run.length, pts = new Float64Array(n * 6);
          let s = 0;
          for (let v = 0; v < n; v++) {
            const a = run[Math.max(0, v - 1)], b = run[Math.min(n - 1, v + 1)];
            let nx = 0, ny = 0;
            if (v > 0) { const dx = run[v][0] - a[0], dy = run[v][1] - a[1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
            if (v < n - 1) { const dx = b[0] - run[v][0], dy = b[1] - run[v][1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
            const l = Math.hypot(nx, ny) || 1;
            nx /= l; ny /= l;
            let cosH = 1;
            if (v > 0 && v < n - 1) { const dx = b[0] - run[v][0], dy = b[1] - run[v][1], ll = Math.hypot(dx, dy) || 1; cosH = Math.max(0.45, nx * (-dy / ll) + ny * (dx / ll)); }
            if (v) s += Math.hypot(run[v][0] - run[v - 1][0], run[v][1] - run[v - 1][1]);
            const h = run[v][2], hh = h < 0 ? h - ti * Math.min(1, -h / 6) : h;
            pts.set([run[v][0], run[v][1], Math.min(0, hh), nx / cosH, ny / cosH, s], v * 6);
          }
          const mid = run[n >> 1][3];
          const key = section ? section(i, mid) : null;
          const base = key || typeOf(line.id, pr.min);
          const S = parseShape(base);
          const sz = base.includes('@') ? Number(base.split('@')[1]) : null;
          const sec = tk.twin && !dbl ? (S.kind === 'box' ? 'trackbox' : `track@${(sz || 2 * S.r).toFixed(1)}`) : base;
          let cs = 0;
          if (conf) { for (const p of run) cs += conf(i, p[3]); cs /= n; } else cs = 2;
          // honesty: estimated = no OSM track or no sourced / derived depth; a guessed SHAPE alone stays plain
          runs.push({ line: i, n, pts, col: pack(line.color), sec, est: cs >= 1.5, osm: true });
        }
        run = [];
      };
      // a double-track bore (elev-v2 'shield' with 1 bore) over twin OSM tracks: ONE bore between them, drawn once
      // along the left twin (off < 0) shifted right by its mean offset (our line path runs between the twins)
      const key0 = section ? section(i, (tk.from + tk.to) / 2) : null;
      const S0 = parseShape(key0 || typeOf(line.id, pr.min));
      const dbl = tk.twin && S0.kind === 'shield' && S0.bores === 1;
      if (dbl && tk.off > 0) continue;
      const shift = dbl ? -tk.off : 0, rev = tk.m[tk.n - 1] < tk.m[0];
      // a point of the track (shifted right of increasing chain by `shift` m for a shared double-track bore)
      const shifted = (v, h) => {
        if (!shift) return [tk.x[v], tk.y[v], h, tk.m[v]];
        const a = Math.max(0, v - 1), b = Math.min(tk.n - 1, v + 1);
        let dx = tk.x[b] - tk.x[a], dy = tk.y[b] - tk.y[a];
        const l = Math.hypot(dx, dy) || 1;
        dx /= l; dy /= l;
        if (rev) { dx = -dx; dy = -dy; }
        // right of the chain direction = (dy, -dx)
        return [tk.x[v] + dy * shift, tk.y[v] - dx * shift, h, tk.m[v]];
      };
      for (let v = 0; v < tk.n; v++) {
        const m = tk.m[v], h = pr.at(m);
        if (!(h < UNDER_M)) {
          // keep the portal point (the bore comes up to the street there), then end the run
          if (run.length) run.push([tk.x[v], tk.y[v], h, m]);
          flush();
          continue;
        }
        if (!run.length && v > 0) run.push(shifted(v - 1, pr.at(tk.m[v - 1])));
        run.push(shifted(v, h));
      }
      flush();
    }
  }
}

const cellKey = (cx, cy) => `${cx},${cy}`;

/** The bores of one area cell: every run segment whose middle lies in it, two section rings per segment (segments do
 * not share vertices: one cell's mesh never needs another's). opaque / glass = triangle indices. */
export function cellGeometry(runs, cx, cy) {
  const x0 = cx * CELL_M, y0 = cy * CELL_M, x1 = x0 + CELL_M, y1 = y0 + CELL_M;
  const data = [], opaque = [], glass = [], platO = [], platG = [];
  let nv = 0;
  const secs = new Map();
  for (const r of runs) {
    let cs = secs.get(r.sec);
    if (!cs) { cs = crossSection(r.sec); secs.set(r.sec, cs); }
    const shield = cs.kind === 'shield' ? 1 : 0, flags0 = shield + (r.est ? 2 : 0);
    const P = r.pts;
    for (let v = 0; v + 1 < r.n; v++) {
      const mx = (P[v * 6] + P[v * 6 + 6]) / 2, my = (P[v * 6 + 1] + P[v * 6 + 7]) / 2;
      if (mx < x0 || mx >= x1 || my < y0 || my >= y1) continue;
      const base = nv;
      for (const e of [v, v + 1]) {
        const o = e * 6;
        for (const q of cs.verts) {
          data.push(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], q[0], q[1], q[2], q[3], P[o + 5], r.col, flags0 + (q[4] ? 4 : 0) + (q[5] || 0) * 8);
          nv++;
        }
      }
      const K = cs.verts.length;
      for (const [a, b] of cs.faces) {
        const A0 = base + a, B0 = base + b, A1 = base + K + a, B1 = base + K + b;
        const gl2 = cs.verts[a][4] && cs.verts[b][4];
        const into = r.platform ? (gl2 ? platG : platO) : gl2 ? glass : opaque;
        into.push(A0, B0, B1, A0, B1, A1);
      }
    }
    // r3c portals: where a bore meets the street (a run end near 0 m), its mouth: a concrete frame around the section
    if (!r.open) {
      for (const end of [0, r.n - 1]) {
        const o = end * 6;
        if (!(P[o + 2] > -6) || P[o] < x0 || P[o] >= x1 || P[o + 1] < y0 || P[o + 1] >= y1) continue;
        const o2 = (end ? end - 1 : 1) * 6;
        let ux = P[o] - P[o2], uy = P[o + 1] - P[o2 + 1];
        const L = Math.hypot(ux, uy) || 1;
        ux /= L; uy /= L;
        let lmin = Infinity, lmax = -Infinity, zmax = -Infinity;
        for (const q of cs.verts) { if (q[0] < lmin) lmin = q[0]; if (q[0] > lmax) lmax = q[0]; if (q[1] > zmax) zmax = q[1]; }
        const T = 1.2;   // frame thickness (m)
        // three boxes in the section plane (along offsets baked into the point): left post, right post, lintel
        for (const [l0, l1, z0, z1] of [[lmin - T, lmin, -1, zmax + T], [lmax, lmax + T, -1, zmax + T], [lmin - T, lmax + T, zmax, zmax + T]]) {
          nv = frameBox(data, opaque, nv, P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], ux, uy, l0, l1, z0, z1, T, 2 * 0 + (r.est ? 2 : 0));
        }
      }
    }
  }
  // the platforms (riding only) after the rest: [opaque | glass | platform opaque | platform glass]
  return { data: new Float32Array(data), opaque: new Uint32Array(opaque), glass: new Uint32Array(glass), platO: new Uint32Array(platO), platG: new Uint32Array(platG) };
}

// ---------------------------------------------------------------- r3d: the tunnel interior (close up / riding)
/** Track gauge (m): standard 1,435 / Keio + Toei Shinjuku 1,372 / else 1,067. Third rail: Ginza, Marunouchi. */
const GAUGE = (id) => (/^(TokyoMetro\.(Ginza|Marunouchi|MarunouchiBranch)|Toei\.(Asakusa|Oedo)|Keikyu\.|Keisei\.|Hokuso\.|Shibayama\.)/.test(id) ? 1.435
  : /^(Keio\.|Toei\.Shinjuku)/.test(id) ? 1.372 : 1.067);
const THIRD_RAIL = (id) => /^TokyoMetro\.(Ginza|Marunouchi|MarunouchiBranch)/.test(id);
/** The track centres (m, lateral) inside a section. */
export function trackCentres(key) {
  const S = parseShape(key);
  if (String(key).startsWith('water')) return [];
  if (String(key).startsWith('track')) return [0];
  if (S.kind === 'shield' && S.bores === 2) return [-(S.r + S.gap / 2), S.r + S.gap / 2];
  return [-1.9, 1.9];
}
/** The interior of one area cell: per track a concrete bed with sleepers, two steel rails, the conductor (rigid
 * overhead bar, or the Ginza / Marunouchi third rail), a walkway and two cable trays on the outer wall. */
export function detailGeometry(runs, cx, cy, lines) {
  const x0 = cx * CELL_M, y0 = cy * CELL_M, x1 = x0 + CELL_M, y1 = y0 + CELL_M;
  const data = [], idx = [];
  let nv = 0;
  // a quad between two points of the run: lateral la..lb, vertical za..zb (constant along), normal (nl, nz), part
  const quad = (P, v, la, lb, za, zb, nl, nzv, rgb, part) => {
    for (const e of [v, v + 1]) {
      const o = e * 6;
      data.push(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], la, za, nl, nzv, P[o + 5], rgb, part * 8);
      data.push(P[o], P[o + 1], P[o + 2], P[o + 3], P[o + 4], lb, zb, nl, nzv, P[o + 5], rgb, part * 8);
    }
    idx.push(nv, nv + 1, nv + 3, nv, nv + 3, nv + 2);
    nv += 4;
  };
  for (const r of runs) {
    if (r.sec === 'water' || r.platform) continue;
    const id = lines[r.line]?.id || '', g = GAUGE(id) / 2, third = THIRD_RAIL(id);
    const cs = trackCentres(r.sec), S = parseShape(r.sec);
    // (a): the rigid overhead bar where the line's pantographs touch it (trainset carSpec wire: Oedo 3.60 m, 20 m
    // cars 4.44 m), just under the crown in a small bore; an earlier crown - 1.3 m put it at 3.2 m in the Oedo bore, through
    // the pantographs and under the Behind eye (a dark strip in that view)
    const crown = S.kind === 'shield' ? 2 * S.r - S.invert : (S.h || 6.2) - (S.floor || 0.6);
    const wire = third ? 0 : carSpec(id, null, 1, 8).wire;
    const top = wire > 0 ? Math.min(crown - 0.12, wire) : S.kind === 'shield' ? crown - 1.3 : crown - 1.0;   // the conductor's height
    const P = r.pts;
    for (let v = 0; v + 1 < r.n; v++) {
      const mx = (P[v * 6] + P[v * 6 + 6]) / 2, my = (P[v * 6 + 1] + P[v * 6 + 7]) / 2;
      if (mx < x0 || mx >= x1 || my < y0 || my >= y1) continue;
      for (const c of cs) {
        const side = c < 0 ? -1 : 1;
        quad(P, v, c - 1.25, c + 1.25, -0.2, -0.2, 0, 1, 0, 1);                       // concrete bed (sleepers in the shader)
        for (const rl of [c - g, c + g]) {
          quad(P, v, rl - 0.035, rl + 0.035, 0, 0, 0, 1, 0, 2);                        // rail head
          quad(P, v, rl - 0.035, rl - 0.035, -0.17, 0, -1, 0, 0, 2);                   // rail sides
          quad(P, v, rl + 0.035, rl + 0.035, -0.17, 0, 1, 0, 0, 2);
        }
        if (third) quad(P, v, c + side * (g + 0.55), c + side * (g + 0.62), 0.16, 0.16, 0, 1, 0, 5);   // third rail
        else if (!S.open) quad(P, v, c - 0.05, c + 0.05, top, top, 0, -1, 0, 5);                      // rigid overhead bar, 0.1 m
        if (r.sec === 'deck') continue;
        const wl = c + side * 1.7, wo = c + side * 2.5;
        quad(P, v, Math.min(wl, wo), Math.max(wl, wo), 0.9, 0.9, 0, 1, 0, 3);          // walkway
        quad(P, v, wl, wl, 0, 0.9, -side, 0, 0, 3);
        for (const tz of [2.0, 2.45]) quad(P, v, c + side * 2.85, c + side * 2.85, tz, tz + 0.09, -side, 0, 0, 4);   // cable trays
      }
    }
  }
  return { data: new Float32Array(data), idx: new Uint32Array(idx) };
}

/** A box of a portal frame: lateral l0..l1 (m, x u_k in the shader), vertical z0..z1 over the rail, T m along the way. */
function frameBox(data, idx, nv, x, y, h, mx, my, ux, uy, l0, l1, z0, z1, T, flags) {
  const faces = [
    // [lateral pair, vertical pair, along pair, normal (lateral, vertical)]
    [[l0, l1], [z1, z1], [0, T], [0, 1]],      // top
    [[l0, l0], [z0, z1], [0, T], [-1, 0]],     // left
    [[l1, l1], [z0, z1], [0, T], [1, 0]],      // right
    [[l0, l1], [z0, z1], [0, 0], [0, 0.98]],   // front (along normal not representable: lit as a top)
    [[l0, l1], [z0, z1], [T, T], [0, 0.98]],   // back
  ];
  for (const [la, za, aa, n] of faces) {
    const quad = la[0] === la[1] ? [[la[0], za[0], aa[0]], [la[0], za[1], aa[0]], [la[0], za[1], aa[1]], [la[0], za[0], aa[1]]]
      : za[0] === za[1] ? [[la[0], za[0], aa[0]], [la[1], za[0], aa[0]], [la[1], za[0], aa[1]], [la[0], za[0], aa[1]]]
        : [[la[0], za[0], aa[0]], [la[1], za[0], aa[0]], [la[1], za[1], aa[0]], [la[0], za[1], aa[0]]];
    for (const [lx, lz, al] of quad) data.push(x + ux * (al - T / 2), y + uy * (al - T / 2), h, mx, my, lx, lz, n[0], n[1], 0, PORTAL_RGB, flags);
    idx.push(nv, nv + 1, nv + 2, nv, nv + 2, nv + 3);
    nv += 4;
  }
  return nv;
}

// ---------------------------------------------------------------- GL
const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_c;     // x, y (local m), true rail level h (m, tie included)
layout(location=1) in vec2 a_m;     // mitred left normal (xy)
layout(location=2) in vec2 a_l;     // section offset (m): lateral, vertical from the rail
layout(location=3) in vec2 a_n;     // section normal: lateral, vertical
layout(location=4) in vec3 a_s;     // metres along the run, rgb packed, flags
uniform mat4 u_m; uniform float u_exag; uniform float u_k; uniform float u_lift;
out vec3 v_n; out vec3 v_col; out float v_s; out float v_h; out float v_lz; out float v_lx; flat out float v_flags;
void main() {
  float z = a_c.z * u_exag + a_l.y * u_k + u_lift;
  vec2 xy = a_c.xy + a_m * a_l.x * u_k;
  gl_Position = u_m * vec4(xy, z, 1.0);
  v_n = normalize(vec3(a_m * a_n.x, a_n.y));
  float c = a_s.y;
  v_col = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0;
  v_s = a_s.x; v_h = a_c.z; v_flags = a_s.z; v_lz = a_l.y; v_lx = a_l.x;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_n; in vec3 v_col; in float v_s; in float v_h; in float v_lz; in float v_lx; flat in float v_flags;
uniform vec3 u_light; uniform vec3 u_fog; uniform float u_glass; uniform float u_ringK; uniform float u_lining;
out vec4 o;
// r3d interior (u_lining 1 = riding: what a tunnel looks like from inside): grey concrete lining with its joints, small
// lights every 10 m, the track bed with sleepers, steel rails, walkway, cable trays; the line colour stays the trains'
const vec3 CONCRETE = vec3(0.66, 0.67, 0.69), BED = vec3(0.56, 0.56, 0.57), STEEL = vec3(0.30, 0.31, 0.33);
const vec3 TRAY = vec3(0.24, 0.25, 0.27), WALK = vec3(0.62, 0.63, 0.65), LAMP = vec3(1.0, 0.95, 0.82);
void main() {
  bool shield = mod(v_flags, 2.0) >= 1.0, est = mod(floor(v_flags / 2.0), 2.0) >= 1.0;
  float part = floor(v_flags / 8.0);   // 0 lining, 1 track bed, 2 rail, 3 walkway, 4 cable tray, 5 conductor
  vec3 n = normalize(v_n);
  float lit = max(dot(n, u_light), 0.0);
  vec3 base = part == 1.0 ? BED : part == 2.0 ? STEEL : part == 3.0 ? WALK : part == 4.0 || part == 5.0 ? TRAY
    : part == 6.0 ? vec3(0.83, 0.83, 0.84) : part == 7.0 ? vec3(0.80, 0.86, 0.90) : mix(v_col, CONCRETE, u_lining);
  vec3 col = base * (0.58 + 0.42 * lit);
  if (part == 6.0 && n.z > 0.5) {
    // the platform: the yellow tactile strip 0.5-0.8 m in from each edge, the line's colour along the very edge
    float e = 4.0 - abs(v_lx);
    if (e > 0.5 && e < 0.8) col = vec3(0.95, 0.80, 0.16);
    if (e < 0.14) col = v_col;
    col *= 1.06;
  }
  if (part == 7.0) { float q = fract(v_s / 3.6); if (q < 0.05 || v_lz > 2.3) col = vec3(0.45, 0.47, 0.50); }   // door frames
  if (part == 1.0) {
    // sleepers every 0.6 m across the bed (gone when under a few px)
    float q = v_s / 0.6, wq = fwidth(q);
    float sl = 1.0 - smoothstep(0.18, 0.18 + wq * 1.2, abs(fract(q) - 0.5));
    col = mix(col, vec3(0.42, 0.42, 0.43), sl * (1.0 - smoothstep(0.2, 0.5, wq)) * 0.8);
  }
  if (part == 2.0 && n.z > 0.5) col = vec3(0.78, 0.79, 0.81);   // the polished rail head
  if (part == 5.0) col = vec3(0.64, 0.66, 0.69);   // the rigid overhead bar: aluminium, lit by the tunnel lamps (unlit
                                                   // from below it read as a dark strip down the ride views)
  // lining: shield rings every ${RING_M} m, box joints every ${JOINT_M} m; gone when a ring is under ~2 px (no shimmer)
  float per = shield ? ${RING_M.toFixed(2)} : ${JOINT_M.toFixed(1)};
  float g = v_s / (per * u_ringK);
  float w = fwidth(g);                                   // ring periods per pixel
  float d = abs(fract(g + 0.5) - 0.5);                   // to the nearest ring joint, in periods
  float jl = 1.0 - smoothstep(0.05, 0.05 + w * 1.2, d);  // a joint line, anti-aliased
  float fade = 1.0 - smoothstep(0.15, 0.45, w);          // gone when a period is under ~3 px
  if (part == 0.0) col *= 1.0 - (shield ? 0.2 : 0.1) * jl * fade;
  // tunnel lights: a small warm lamp every 10 m on the wall, 3.2 m over the rail (riding only)
  float lq = v_s / 10.0, lw = fwidth(lq);
  float lamp = u_lining * (part == 0.0 ? 1.0 : 0.0) * (1.0 - smoothstep(0.012, 0.012 + lw * 1.2, abs(fract(lq) - 0.5)))
    * (1.0 - smoothstep(0.12, 0.2, abs(v_lz - 3.2))) * (1.0 - smoothstep(0.05, 0.2, lw));
  col = mix(col, LAMP, lamp);
  if (est) col = mix(col, vec3(1.0), 0.16);                       // estimated geometry: a little lighter (honesty)
  float fog = clamp(-v_h / 45.0, 0.0, 1.0) * 0.16;
  col = mix(col, u_fog, fog);
  float a = u_glass > 0.5 ? (est ? 0.13 : 0.18) : 1.0;
  if (u_lining > 0.5) a = 1.0;   // riding: inside a closed tunnel (its crown is concrete, not glass)
  if (part == 7.0) a = 0.42;     // platform doors stay glass
  o = vec4(col * a, a);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`city3d bores shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`city3d bores link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export function createBoresGL(gl, { net, profiles, depths, sections = null, real = null, tracks = null, platforms = null }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const runs = boreRuns(net, profiles, depths?.tie, { sections, section: real?.lines ? real.section : null, conf: real?.lines ? real.conf : null, tracks,
    shown: real?.lines ? real.shown : null, openAir: real?.lines ? real.openAir : null, platforms });
  const prog = compile(gl, VS, FS);
  const pool = new Map();   // key -> { vao, vb, ib, nOpaque, nGlass, bytes, used }
  const dpool = new Map();  // r3d: the interior details, built only close up (zoom >= DETAIL_Z), pooled apart
  const st = { runs: runs.length, cells: 0, built: 0, bytes: 0, tris: 0, buildMs: 0, frameCells: 0 };
  st.runsMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);
  let tick = 0;

  function cell(cx, cy) {
    const key = cellKey(cx, cy);
    let c = pool.get(key);
    if (c) { c.used = tick; return c; }
    const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
    const g = cellGeometry(runs, cx, cy);
    c = { vao: null, vb: null, ib: null, nOpaque: g.opaque.length, nGlass: g.glass.length, nPO: g.platO.length, nPG: g.platG.length,
      bytes: g.data.byteLength + (g.opaque.length + g.glass.length + g.platO.length + g.platG.length) * 4, used: tick };
    if (g.data.length) {
      c.vao = gl.createVertexArray();
      gl.bindVertexArray(c.vao);
      c.vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vb);
      gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW);
      const B = VF * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, B, 28);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, B, 36);
      const idx = new Uint32Array(g.opaque.length + g.glass.length + g.platO.length + g.platG.length);
      idx.set(g.opaque, 0); idx.set(g.glass, g.opaque.length);
      idx.set(g.platO, g.opaque.length + g.glass.length); idx.set(g.platG, g.opaque.length + g.glass.length + g.platO.length);
      c.ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    pool.set(key, c);
    st.built++; st.bytes += c.bytes; st.cells = pool.size;
    st.buildMs += Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t1);
    // pooled: past POOL_MAX cells the least recently used go (their GPU buffers freed)
    if (pool.size > POOL_MAX) {
      let oldK = null, oldU = Infinity;
      for (const [k, v] of pool) if (v.used < oldU && v.used !== tick) { oldU = v.used; oldK = k; }
      if (oldK) drop(oldK);
    }
    return c;
  }
  function detailCell(cx, cy) {
    const key = cellKey(cx, cy);
    let c = dpool.get(key);
    if (c) { c.used = tick; return c; }
    const g = detailGeometry(runs, cx, cy, net.lines || []);
    c = { vao: null, vb: null, ib: null, n: g.idx.length, bytes: g.data.byteLength + g.idx.byteLength, used: tick };
    if (g.data.length) {
      c.vao = gl.createVertexArray();
      gl.bindVertexArray(c.vao);
      c.vb = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, c.vb);
      gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.STATIC_DRAW);
      const B = VF * 4;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, B, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, B, 28);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, B, 36);
      c.ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, c.ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    dpool.set(key, c);
    st.dbytes = (st.dbytes || 0) + c.bytes; st.dcells = dpool.size;
    if (dpool.size > 12) {
      let oldK = null, oldU = Infinity;
      for (const [k, v] of dpool) if (v.used < oldU && v.used !== tick) { oldU = v.used; oldK = k; }
      if (oldK) { const d = dpool.get(oldK); if (d.vb) gl.deleteBuffer(d.vb); if (d.ib) gl.deleteBuffer(d.ib); if (d.vao) gl.deleteVertexArray(d.vao); st.dbytes -= d.bytes; dpool.delete(oldK); st.dcells = dpool.size; }
    }
    return c;
  }
  function drop(key) {
    const c = pool.get(key);
    if (!c) return;
    if (c.vb) gl.deleteBuffer(c.vb);
    if (c.ib) gl.deleteBuffer(c.ib);
    if (c.vao) gl.deleteVertexArray(c.vao);
    st.bytes -= c.bytes;
    pool.delete(key);
    st.cells = pool.size;
  }

  // u: { M32, light, exag, k, lift, view: [x0, y0, x1, y1] (local m), fog: [r, g, b] }
  function draw(u, pass) {
    if (pass === 'opaque') tick++;
    const v = u.view;
    const cx0 = Math.floor(v[0] / CELL_M), cx1 = Math.floor(v[2] / CELL_M), cy0 = Math.floor(v[1] / CELL_M), cy1 = Math.floor(v[3] / CELL_M);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 64) return;   // a view this big is below the underground's zoom anyway
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.u_m, false, u.M32);
    gl.uniform1f(prog.u.u_exag, u.exag); gl.uniform1f(prog.u.u_k, u.k); gl.uniform1f(prog.u.u_lift, u.lift || 0);
    gl.uniform3f(prog.u.u_light, u.light[0], u.light[1], u.light[2]);
    gl.uniform3f(prog.u.u_fog, u.fog[0], u.fog[1], u.fog[2]);
    gl.uniform1f(prog.u.u_glass, pass === 'glass' ? 1 : 0);
    gl.uniform1f(prog.u.u_ringK, 1);
    gl.uniform1f(prog.u.u_lining, u.lining ? 1 : 0);
    let n = 0, tris = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const c = cell(cx, cy);
        if (!c.vao) continue;
        gl.bindVertexArray(c.vao);
        if (pass === 'opaque' && c.nOpaque) { gl.drawElements(gl.TRIANGLES, c.nOpaque, gl.UNSIGNED_INT, 0); tris += c.nOpaque / 3; }
        if (pass === 'glass' && c.nGlass) { gl.drawElements(gl.TRIANGLES, c.nGlass, gl.UNSIGNED_INT, c.nOpaque * 4); tris += c.nGlass / 3; }
        // riding: the platforms (light, tactile strip, edge band) and their doors
        if (u.lining && pass === 'opaque' && c.nPO) gl.drawElements(gl.TRIANGLES, c.nPO, gl.UNSIGNED_INT, (c.nOpaque + c.nGlass) * 4);
        if (u.lining && pass === 'glass' && c.nPG) gl.drawElements(gl.TRIANGLES, c.nPG, gl.UNSIGNED_INT, (c.nOpaque + c.nGlass + c.nPO) * 4);
        n++;
      }
    }
    if (pass === 'opaque') { st.frameCells = n; st.tris = tris; }
    else st.tris += tris;
    // close up (riding, or zoomed right in): the interior details, opaque, with the lining pass
    if (pass === 'opaque' && u.zoom >= DETAIL_Z && (cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 9) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const c = detailCell(cx, cy);
          if (!c.vao || !c.n) continue;
          gl.bindVertexArray(c.vao);
          gl.drawElements(gl.TRIANGLES, c.n, gl.UNSIGNED_INT, 0);
          st.tris += c.n / 3;
        }
      }
    }
    gl.bindVertexArray(null);
  }

  return {
    runs,
    draw,
    stats: () => ({ ...st, kb: Math.round(st.bytes / 1024) }),
    destroy() {
      for (const k of [...pool.keys()]) drop(k);
      for (const d of dpool.values()) { if (d.vb) gl.deleteBuffer(d.vb); if (d.ib) gl.deleteBuffer(d.ib); if (d.vao) gl.deleteVertexArray(d.vao); }
      dpool.clear();
      gl.deleteProgram(prog.p);
    },
  };
}

/** Platform length (m) for a line's trains (its cars x 20 m + 20). */
export const stationLength = (line) => Math.max(120, Math.min(260, (line?.cars || 10) * 20 + 20));
