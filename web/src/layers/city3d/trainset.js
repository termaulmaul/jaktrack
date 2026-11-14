// 3D view: real-looking Tokyo commuter train cars.
//
// A plain box per car reads as a slab close up (Ride in the tunnel), so this module builds procedural cars (no external
// models, no three.js, no paid assets) that the 3D layer draws instanced:
//   - carSpec(lineId, typeId, carIndex, carsInTrain): body class (dimensions), livery, role (cab front / rear / middle /
//     middle with pantograph), the instance flip and the head / tail light flags. Cached: no allocation per call.
//   - carMesh(spec, lod): { positions, normals, mats, indices } in local metres: x along the car (front +x), y across
//     (left +y), z up; origin = the car's centre on the rail top. LOD0 (close: ~1.5-3k tris: recessed windows and
//     doors, cab nose with raked windscreen, head / tail lamps, destination displays, roof arc, AC unit, single-arm
//     pantograph, gangway bellows, couplers, under-floor boxes, bogies with wheels), LOD1 (mid: ~250-400 tris, flush
//     window band and doors drawn by the shader), LOD2 (far: the old box with a window band, ~30 tris).
//   - TRAINSET_GLSL: the material functions (tsShade), TRAINSET_VS / TRAINSET_FS: a full program built from them.
//   - createTrainsetGL(gl): GPU meshes per (geometry key, lod), shared by every line of that body class; one
//     instanced drawElements per group; begin() / push(...) / draw(M, u) / drawRims(M, u) per frame, no allocation.
//
// Materials (mats: 4 bytes a vertex: material id, u, v (0..255 over the part's own rectangle: a door leaf, a window,
// the windscreen, a lamp), aux (panes of a window, door kind, nose marker)). Livery per INSTANCE (one mesh serves
// every line of a class): style (LIVERY), body colour (metal or a full colour), the line colour (exact: the stripe,
// never tinted; lighting is kept soft on it), flags (head / tail lamps, picked, live), the type colour (shown on the
// destination display's type block, as real LED displays do).
//
// Facts used (public specifications, no images copied): Toei 12-600 (Oedo) 16.5 m long, ~2.49-2.50 m wide, ~3.14 m high,
// aluminium (Toei statistics PDF); Ginza 1000 series 16 m x 2.55 m, Marunouchi 2000 series 18 m x 2.78 m, red body
// with a white band carrying the "sine wave" (trafficnews.jp 81708). Third-rail lines (no pantographs): Ginza,
// Marunouchi (+ branch), Yokohama Blue. Other dimensions are the usual class values (20 m 4-door cars, 18 m 3-door
// cars): estimates, documented in.

export const MAT = Object.freeze({
  BODY: 0, STRIPE: 1, STRIPE2: 2, WINDOW: 3, DOOR: 4, CABFACE: 5, WINDSCREEN: 6, LAMP: 7, DEST: 8, ROOF: 9,
  ROOFUNIT: 10, PANTO: 11, UNDER: 12, BOGIE: 13, WHEEL: 14, GANGWAY: 15, COUPLER: 16, END: 17, SKIRT: 18,
});
/** Livery styles (instance attribute i_liv.x). */
export const LIVERY = Object.freeze({ STRIPE: 0, FULL: 1, WAVE: 2, DOORS: 3, BAND: 4 });
/** Instance flags (i_liv.z bits). HEAD / TAIL refer to the mesh's +x cab: its lamps white (the train's front) or red. */
export const FLAG = Object.freeze({ HEAD: 1, TAIL: 2, PICKED: 4, LIVE: 8 });
export const LODS = 3;
/** Floats per instance (createTrainsetGL's buffer): pos 3, dir 4, scale 3, colour 4, livery 4. */
export const TS_F = 18;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const byte = (v) => Math.round(clamp(v, 0, 1) * 255);

// ------------------------------------------------------------------------------------------------ classes + liveries
// body: body length (m, over the end walls); pitch: car centre to car centre in a train (over couplers); width: at
// the waist; height: roof crown above the rail top; floor: floor above the rail top; doors per side, door width and
// pitch (centre to centre); flare: how much narrower the side is at the sill (JR wide bodies); wire: pantograph head
// above the roof (raised: where a rigid overhead conductor would be), 0 = third rail (no pantograph).
const CLASSES = {
  // JR East wide-body 20 m 4-door commuter car
  jr20: { body: 19.5, pitch: 20.0, width: 2.95, height: 3.62, floor: 1.13, doors: 4, doorW: 1.3, doorPitch: 4.82, flare: 0.075, gauge: 1.067, wheelR: 0.43, bogie: 6.9, wheelbase: 2.1, ac: [2.6, 1.9, 0.36], wire: 0.82, rise: 0.38 },
  // Tokyo Metro / Toei / private 20 m 4-door car (straight sides)
  m20: { body: 19.5, pitch: 20.0, width: 2.83, height: 3.64, floor: 1.14, doors: 4, doorW: 1.3, doorPitch: 4.82, flare: 0.02, gauge: 1.067, wheelR: 0.43, bogie: 6.9, wheelbase: 2.1, ac: [2.6, 1.85, 0.34], wire: 0.8, rise: 0.38 },
  // 18 m 3-door car (Marunouchi 2000, Toei Asakusa 5500, Keikyu, Keisei, Yokohama Blue)
  m18: { body: 17.5, pitch: 18.0, width: 2.78, height: 3.5, floor: 1.14, doors: 3, doorW: 1.3, doorPitch: 5.9, flare: 0.02, gauge: 1.435, wheelR: 0.43, bogie: 6.0, wheelbase: 2.1, ac: [2.4, 1.8, 0.32], wire: 0.8, rise: 0.36 },
  // Ginza 1000 series: 16 m x 2.55 m, 3 doors, third rail
  g16: { body: 15.5, pitch: 16.0, width: 2.55, height: 3.465, floor: 1.1, doors: 3, doorW: 1.3, doorPitch: 5.0, flare: 0, gauge: 1.435, wheelR: 0.41, bogie: 5.15, wheelbase: 1.9, ac: [2.1, 1.6, 0.3], wire: 0, rise: 0.36 },
  // Oedo 12-600 (linear-motor mini subway): 16.5 m, ~2.5 m wide, ~3.14 m overall (the AC unit's top), low floor
  e16: { body: 16.0, pitch: 16.5, width: 2.496, height: 2.98, floor: 0.85, doors: 3, doorW: 1.3, doorPitch: 5.2, flare: 0, gauge: 1.435, wheelR: 0.34, bogie: 5.35, wheelbase: 1.9, ac: [2.1, 1.5, 0.2], wire: 0.62, rise: 0.28, doorH: 1.8, winBot: 0.75, winTop: 1.68 },
  // rubber-tyred AGT / monorail cars (Yurikamome, Nippori-Toneri, monorails): a small car, no pantograph
  agt: { body: 8.4, pitch: 9.0, width: 2.47, height: 3.3, floor: 1.05, doors: 2, doorW: 1.1, doorPitch: 4.1, flare: 0, gauge: 1.067, wheelR: 0.34, bogie: 2.6, wheelbase: 0, ac: [1.7, 1.4, 0.3], wire: 0, rise: 0.34 },
  // trams (Tokyo Sakura Tram, Setagaya, Enoden): a short car, cab at both ends
  tram: { body: 12.5, pitch: 13.0, width: 2.44, height: 3.4, floor: 0.82, doors: 2, doorW: 1.0, doorPitch: 6.4, flare: 0, gauge: 1.372, wheelR: 0.33, bogie: 3.9, wheelbase: 1.6, ac: [1.8, 1.4, 0.28], wire: 0.75, rise: 0.34 },
};

/** Per line: [id or 'Prefix.*', class, livery style, body colour ('line' = the line's own colour, '#hex', null = metal)].
 * Small and factual; the line-colour stripe on a metal body is the default for every line not listed. */
const LINE_TABLE = [
  ['TokyoMetro.Ginza', 'g16', LIVERY.FULL, '#FFC81E'],          // 1000 series: lemon-yellow body (hex approx.)
  ['TokyoMetro.Marunouchi', 'm18', LIVERY.WAVE, 'line'],        // 2000 series: red body, white band + sine wave
  ['TokyoMetro.MarunouchiBranch', 'm18', LIVERY.WAVE, 'line'],
  ['Toei.Oedo', 'e16', LIVERY.STRIPE, null],                    // 12-600: aluminium, line-colour stripe
  ['YokohamaMunicipal.Green', 'e16', LIVERY.STRIPE, null],      // linear-motor mini subway too
  ['YokohamaMunicipal.Blue', 'm18', LIVERY.STRIPE, null],
  ['JR-East.Yamanote', 'jr20', LIVERY.DOORS, null],             // E235: doors wrapped in the line colour
  ['JR-East.*', 'jr20', LIVERY.STRIPE, null],
  ['JR-Central.*', 'jr20', LIVERY.STRIPE, null],
  ['Keikyu.*', 'm18', LIVERY.BAND, '#E3101C'],                  // Keikyu red body + white band (hex approx.)
  ['Toei.Asakusa', 'm18', LIVERY.STRIPE, null],
  ['Keisei.*', 'm18', LIVERY.STRIPE, null],
  ['Hokuso.*', 'm18', LIVERY.STRIPE, null],
  ['Shibayama.*', 'm18', LIVERY.STRIPE, null],
  ['Sotetsu.*', 'm20', LIVERY.FULL, 'line'],                    // YOKOHAMA NAVYBLUE body (= the line colour)
  ['Toei.NipporiToneri', 'agt', LIVERY.STRIPE, null],
  ['Yurikamome.*', 'agt', LIVERY.STRIPE, null],
  ['SaitamaTransit.*', 'agt', LIVERY.STRIPE, null],
  ['YokohamaSeaside.*', 'agt', LIVERY.STRIPE, null],
  ['Yamaman.*', 'agt', LIVERY.STRIPE, null],
  ['TokyoMonorail.*', 'agt', LIVERY.STRIPE, null],
  ['TamaMonorail.*', 'agt', LIVERY.STRIPE, null],
  ['ChibaMonorail.*', 'agt', LIVERY.STRIPE, null],
  ['ShonanMonorail.*', 'agt', LIVERY.STRIPE, null],
  ['Toei.Arakawa', 'tram', LIVERY.STRIPE, null],
  ['Tokyu.Setagaya', 'tram', LIVERY.STRIPE, null],
  ['Enoden.*', 'tram', LIVERY.STRIPE, null],
  ['UtsunomiyaLightRail.*', 'tram', LIVERY.STRIPE, null],
];
/** Lines on a third rail (no pantographs; collector shoes on the bogies). */
const THIRD_RAIL = new Set(['TokyoMetro.Ginza', 'TokyoMetro.Marunouchi', 'TokyoMetro.MarunouchiBranch', 'YokohamaMunicipal.Blue']);

const packHex = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? parseInt(m[1], 16) : -1; };

/** The table row for a line id: [class, style, body] (exact id first, then 'Operator.*'). */
export function lineLook(lineId) {
  const id = String(lineId || '');
  let hit = null;
  for (const row of LINE_TABLE) { if (row[0] === id) { hit = row; break; } }
  if (!hit) { const op = id.split('.')[0]; for (const row of LINE_TABLE) if (row[0] === `${op}.*`) { hit = row; break; } }
  const cls = hit ? hit[1] : 'm20';
  return { cls, style: hit ? hit[2] : LIVERY.STRIPE, body: hit ? hit[3] : null, third: THIRD_RAIL.has(id) || cls === 'agt' };
}

/** Derived heights of a class (all in metres above the rail top). */
function derive(name) {
  const k = CLASSES[name] || CLASSES.m20;
  const c = { ...k, cls: name };
  c.L = k.body; c.W = k.width; c.H = k.height;
  c.sill = k.floor - 0.13;
  c.doorH = k.doorH ?? Math.min(1.85, k.height - k.floor - 0.55);
  c.doorTop = k.floor + c.doorH;
  c.winBot = k.floor + (k.winBot ?? 0.78);
  c.winTop = k.floor + (k.winTop ?? Math.min(1.72, c.doorH - 0.12));
  c.cant = k.height - k.rise;
  c.stripe0 = c.winBot - 0.21; c.stripe1 = c.winBot - 0.06;
  c.top = c.doorTop + 0.19 < c.cant ? [c.doorTop + 0.07, c.doorTop + 0.15] : null;
  c.noseLen = 0.85;
  c.cornerR = Math.min(0.32, c.W * 0.11);
  c.gapHalf = Math.max(0.12, (k.pitch - k.body) / 2);
  c.tumble = 0.03;
  return c;
}
const DERIVED = new Map();
const classOf = (name) => { let c = DERIVED.get(name); if (!c) { c = derive(name); DERIVED.set(name, c); } return c; };

/** The body's half width at height z (sill .. crown): flared lower side, slight tumblehome, elliptic roof. */
export function halfWidthAt(c, z) {
  const W2 = c.W / 2;
  if (z <= c.winBot) { const t = clamp((z - c.sill) / Math.max(0.01, c.winBot - c.sill), 0, 1); return W2 - c.flare * (1 - t) ** 1.6; }
  if (z <= c.cant) { const t = clamp((z - c.winBot) / Math.max(0.01, c.cant - c.winBot), 0, 1); return W2 - c.tumble * t * t; }
  const yC = W2 - c.tumble;
  const t = clamp((z - c.cant) / c.rise, 0, 1);
  return yC * Math.sqrt(Math.max(0, 1 - t * t));
}

// --------------------------------------------------------------------------------------------------------- carSpec
const SPECS = new Map();   // lineId -> { lead, trail, mid, midp, solo }
function makeSpec(lineId, role, panto) {
  const look = lineLook(lineId);
  const c = classOf(look.cls);
  const cab = role === 'lead' || role === 'trail' ? 'front' : role === 'solo' ? 'both' : 'none';
  const hasPanto = !look.third && c.wire > 0 && (panto || cab === 'both');
  const key = `${look.cls}|${cab}|${hasPanto ? 'p' : '-'}|${look.third ? 't' : '-'}`;
  return Object.freeze({
    key, line: String(lineId || ''), cls: look.cls, role, cab, panto: hasPanto, third: look.third,
    body: c.L, pitch: c.pitch, width: c.W, height: c.H, floor: c.floor, doors: c.doors,
    /** Top of the roof units (air conditioners) above the rail top (m): the car's highest solid part. */
    roof: c.H + (c.ac ? c.ac[2] : 0),
    /** Pantograph head / overhead conductor height above the rail top (m); 0 = third rail. */
    wire: hasPanto || (!look.third && c.wire > 0) ? c.H + c.wire : 0,
    style: look.style, bodyColor: look.body === 'line' ? 'line' : look.body ? packHex(look.body) : -1,
    flip: role === 'trail' ? -1 : 1,
    flags: role === 'trail' ? FLAG.TAIL : role === 'lead' || role === 'solo' ? FLAG.HEAD : 0,
  });
}
/** The spec of car `carIndex` (0 = the train's front car, in its direction of travel) of a train of `carsInTrain`
 * on line `lineId` (MT3D id). typeId is accepted for later (limited-express stock); today the line decides. Cached per
 * line: no allocation in the frame loop. */
export function carSpec(lineId, typeId, carIndex, carsInTrain) {
  const id = String(lineId || '');
  let s = SPECS.get(id);
  if (!s) {
    s = { lead: makeSpec(id, 'lead'), trail: makeSpec(id, 'trail'), mid: makeSpec(id, 'mid', false), midp: makeSpec(id, 'mid', true), solo: makeSpec(id, 'solo') };
    if (SPECS.size > 400) SPECS.clear();
    SPECS.set(id, s);
  }
  const n = Math.max(1, carsInTrain | 0), c = clamp(carIndex | 0, 0, n - 1);
  if (n === 1) return s.solo;
  if (c === 0) return s.lead;
  if (c === n - 1) return s.trail;
  return c % 3 === 1 ? s.midp : s.mid;
}
/** Car centre to car centre (m) for a line (the train is cars x pitch long). */
export const carPitch = (lineId) => classOf(lineLook(lineId).cls).pitch;

// ------------------------------------------------------------------------------------------------------- geometry
const UV0 = [0, 0, 0, 0, 0, 0, 0, 0];
function builder(c) {
  const P = [], N = [], A = [], I = [];
  let nv = 0;
  const zc = (c.sill + c.H) / 2;
  const vert = (p, n, id, u, v, aux) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); A.push(id, byte(u), byte(v), aux); return nv++; };
  /** Outward flat normal (Newell), oriented away from the car's axis unless given. */
  function normalOf(q, ref) {
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < q.length; k++) {
      const a = q[k], b = q[(k + 1) % q.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-10) return null;
    nx /= l; ny /= l; nz /= l;
    if (ref) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of q) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= q.length; cy /= q.length; cz /= q.length;
      const ax = clamp(cx, -c.L / 2 + 1.2, c.L / 2 - 1.2);
      if ((cx - ax) * nx + cy * ny + (cz - zc) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    }
    return [nx, ny, nz];
  }
  const b = {
    c,
    get nv() { return nv; },
    /** quad a b c d with uv corners [u0,v0, u1,v1, u2,v2, u3,v3]; nrm = [x,y,z] | 'auto' (outward from the axis). */
    quad(a, bb, cc, d, id, uv = UV0, aux = 0, nrm = 'auto') {
      const n = Array.isArray(nrm) ? nrm : normalOf([a, bb, cc, d], true);
      if (!n) return;
      const i0 = vert(a, n, id, uv[0], uv[1], aux), i1 = vert(bb, n, id, uv[2], uv[3], aux);
      const i2 = vert(cc, n, id, uv[4], uv[5], aux), i3 = vert(d, n, id, uv[6], uv[7], aux);
      I.push(i0, i1, i2, i0, i2, i3);
    },
    /** quad with a normal per corner (smooth: the roof arc). */
    quadN(a, bb, cc, d, na, nb, nc, nd, id, uv = UV0, aux = 0) {
      const i0 = vert(a, na, id, uv[0], uv[1], aux), i1 = vert(bb, nb, id, uv[2], uv[3], aux);
      const i2 = vert(cc, nc, id, uv[4], uv[5], aux), i3 = vert(d, nd, id, uv[6], uv[7], aux);
      I.push(i0, i1, i2, i0, i2, i3);
    },
    /** a fan polygon (convex or star-shaped from its first point = the centre) with one normal. */
    fan(centre, ring, id, nrm, aux = 0) {
      const i0 = vert(centre, nrm, id, 0.5, 0.5, aux);
      const first = nv;
      for (const p of ring) vert(p, nrm, id, 0.5, 0.5, aux);
      for (let k = 0; k + 1 < ring.length; k++) I.push(i0, first + k, first + k + 1);
    },
    /** axis-aligned box; faces: bit mask (1 +x, 2 -x, 4 +y, 8 -y, 16 +z, 32 -z); uv over each face. */
    box(x0, x1, y0, y1, z0, z1, id, aux = 0, faces = 63) {
      const F = (ok, q, n) => { if (ok) b.quad(q[0], q[1], q[2], q[3], id, [0, 0, 1, 0, 1, 1, 0, 1], aux, n); };
      F(faces & 1, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
      F(faces & 2, [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0]);
      F(faces & 4, [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0]);
      F(faces & 8, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
      F(faces & 16, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
      F(faces & 32, [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], [0, 0, -1]);
    },
    /** a beam (box) from p to q, half sizes hw (across, horizontal) and hh (the third axis). */
    beam(p, q, hw, hh, id, aux = 0) {
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const e = [d[0] / l, d[1] / l, d[2] / l];
      // s: horizontal, perpendicular to the beam (falls back to +y for a vertical beam)
      let s = [-e[1], e[0], 0];
      const sl = Math.hypot(s[0], s[1]);
      s = sl > 1e-6 ? [s[0] / sl, s[1] / sl, 0] : [0, 1, 0];
      const t = [e[1] * s[2] - e[2] * s[1], e[2] * s[0] - e[0] * s[2], e[0] * s[1] - e[1] * s[0]];
      const C = (P0, a, bb) => [P0[0] + s[0] * a + t[0] * bb, P0[1] + s[1] * a + t[1] * bb, P0[2] + s[2] * a + t[2] * bb];
      const p00 = C(p, -hw, -hh), p10 = C(p, hw, -hh), p11 = C(p, hw, hh), p01 = C(p, -hw, hh);
      const q00 = C(q, -hw, -hh), q10 = C(q, hw, -hh), q11 = C(q, hw, hh), q01 = C(q, -hw, hh);
      const neg = (v) => [-v[0], -v[1], -v[2]];
      b.quad(p10, q10, q11, p11, id, UV0, aux, s); b.quad(q00, p00, p01, q01, id, UV0, aux, neg(s));
      b.quad(p01, p11, q11, q01, id, UV0, aux, t); b.quad(q00, q10, p10, p00, id, UV0, aux, neg(t));
      b.quad(q10, q00, q01, q11, id, UV0, aux, e); b.quad(p00, p10, p11, p01, id, UV0, aux, neg(e));
    },
    /** a wheel: cylinder along y at (x, yc, z), radius r, half width hw, n segments (tread + both faces). */
    wheel(x, yc, z, r, hw, n, id) {
      const pts = [];
      for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; pts.push([Math.cos(a), Math.sin(a)]); }
      for (let k = 0; k < n; k++) {
        const [c0, s0] = pts[k], [c1, s1] = pts[k + 1];
        const n0 = [c0, 0, s0], n1 = [c1, 0, s1];
        b.quadN([x + r * c0, yc - hw, z + r * s0], [x + r * c1, yc - hw, z + r * s1], [x + r * c1, yc + hw, z + r * s1], [x + r * c0, yc + hw, z + r * s0], n0, n1, n1, n0, id, UV0, 1);
      }
      const ring = (yy) => pts.map(([co, si]) => [x + r * co, yy, z + r * si]);
      b.fan([x, yc + hw, z], ring(yc + hw), id, [0, 1, 0]);
      b.fan([x, yc - hw, z], ring(yc - hw), id, [0, -1, 0]);
    },
    /** extrude a convex section [[y, z]...] (counter-clockwise) along x from x0 to x1; caps at both ends. */
    prism(x0, x1, sec, id, aux = 0, caps = true) {
      const n = sec.length;
      let ymin = Infinity, ymax = -Infinity;
      for (const [y] of sec) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
      const V = (x, y) => [(x - x0) / (x1 - x0), (y - ymin) / Math.max(1e-6, ymax - ymin)];
      for (let k = 0; k < n; k++) {
        const [ya, za] = sec[k], [yb, zb] = sec[(k + 1) % n];
        const ny = zb - za, nz = -(yb - ya), l = Math.hypot(ny, nz) || 1;
        const ua = V(x0, ya), ub = V(x1, ya), uc = V(x1, yb), ud = V(x0, yb);
        b.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], id, [ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]], aux, [0, ny / l, nz / l]);
      }
      if (caps) {
        let cy = 0, cz = 0;
        for (const [y, z] of sec) { cy += y; cz += z; }
        cy /= n; cz /= n;
        b.fan([x1, cy, cz], [...sec, sec[0]].map(([y, z]) => [x1, y, z]), id, [1, 0, 0], aux);
        b.fan([x0, cy, cz], [...sec, sec[0]].map(([y, z]) => [x0, y, z]), id, [-1, 0, 0], aux);
      }
    },
    done() {
      const positions = new Float32Array(P), normals = new Float32Array(N), mats = new Uint8Array(A);
      const indices = nv > 65535 ? new Uint32Array(I) : new Uint16Array(I);
      return { positions, normals, mats, indices, verts: nv, tris: I.length / 3, bytes: positions.byteLength + normals.byteLength + mats.byteLength + indices.byteLength };
    },
  };
  return b;
}

/** The side's regions (doors, windows, stripes) for x in [xr, xf]: [{ x0, x1, z0, z1, id, aux, d (inset m) }],
 * in priority order (doors win over windows win over stripes). */
function sideRegions(c, lod, xr, xf, cabFront, cabRear) {
  const R = [];
  const hw = c.doorW / 2, n = c.doors, dp = c.doorPitch;
  const centres = [];
  for (let k = 0; k < n; k++) centres.push((k - (n - 1) / 2) * dp);
  const inset = lod === 0;
  for (const xc of centres) {
    if (lod === 0) {
      R.push({ x0: xc - hw, x1: xc, z0: c.floor - 0.02, z1: c.doorTop, id: MAT.DOOR, aux: 0, d: 0.022 });
      R.push({ x0: xc, x1: xc + hw, z0: c.floor - 0.02, z1: c.doorTop, id: MAT.DOOR, aux: 1, d: 0.022 });
    } else R.push({ x0: xc - hw, x1: xc + hw, z0: c.floor - 0.02, z1: c.doorTop, id: MAT.DOOR, aux: 2, d: 0 });
  }
  const crew = (a, b) => R.push({ x0: a, x1: b, z0: c.floor + 0.02, z1: c.doorTop - 0.02, id: MAT.DOOR, aux: 3, d: inset ? 0.015 : 0 });
  if (cabFront) crew(xf - 0.78, xf - 0.14);
  if (cabRear) crew(xr + 0.14, xr + 0.78);
  const win = (a, b) => {
    const w = b - a;
    if (w < 0.55) return;
    R.push({ x0: a, x1: b, z0: c.winBot, z1: c.winTop, id: MAT.WINDOW, aux: Math.max(1, Math.min(3, Math.round(w / 1.45))), d: inset ? 0.035 : 0 });
  };
  for (let k = 0; k + 1 < n; k++) win(centres[k] + hw + 0.3, centres[k + 1] - hw - 0.3);
  // end sections: one window (between the outer door and the end, or the crew door behind a cab)
  const outerF = centres[n - 1] + hw, outerR = centres[0] - hw;
  if (cabFront) win(outerF + 0.3, xf - 0.78 - 0.25);
  else { const a = outerF + 0.38, b = c.L / 2 - 0.42; if (b - a > 0.6) { const m = (a + b) / 2, h = Math.min(0.5, (b - a) / 2); win(m - h, m + h); } }
  if (cabRear) win(xr + 0.78 + 0.25, outerR - 0.3);
  else { const a = -c.L / 2 + 0.42, b = outerR - 0.38; if (b - a > 0.6) { const m = (a + b) / 2, h = Math.min(0.5, (b - a) / 2); win(m - h, m + h); } }
  R.push({ x0: xr, x1: xf, z0: c.stripe0, z1: c.stripe1, id: MAT.STRIPE, aux: 0, d: 0 });
  if (c.top) R.push({ x0: xr, x1: xf, z0: c.top[0], z1: c.top[1], id: MAT.STRIPE2, aux: 0, d: 0 });
  return { R, centres };
}

/** The z levels of the side wall (sill .. cantrail) shared by the side, the nose and the end caps (no T-junctions). */
function zLevels(c, R, lod) {
  const S = new Set([c.sill, c.cant, c.winBot, c.winTop]);
  if (lod < 2) for (const r of R) { S.add(clamp(r.z0, c.sill, c.cant)); S.add(clamp(r.z1, c.sill, c.cant)); }
  const Z = [...S].sort((a, b) => a - b);
  const out = [];
  for (const z of Z) if (!out.length || z - out[out.length - 1] > 0.004) out.push(z);
  return out;
}
/** The roof arc levels above the cantrail: [{ y, z, ny, nz }] from the cantrail (k = 0) to the crown. */
function roofArc(c, segs) {
  const yC = c.W / 2 - c.tumble, out = [];
  for (let k = 0; k <= segs; k++) {
    const t = (k / segs) * Math.PI / 2;
    const y = yC * Math.cos(t), z = c.cant + c.rise * Math.sin(t);
    const gy = Math.cos(t) / yC, gz = Math.sin(t) / c.rise, l = Math.hypot(gy, gz) || 1;
    out.push({ y: k === segs ? 0 : y, z, ny: gy / l, nz: gz / l });
  }
  return out;
}

/** One body side (left: s = 1, right: s = -1) as a grid of cells from the regions; insets + reveals at LOD0. */
function emitSide(b, c, R, Z, xr, xf, s) {
  const xs = new Set([xr, xf]);
  for (const r of R) { if (r.x1 <= xr || r.x0 >= xf) continue; xs.add(clamp(r.x0, xr, xf)); xs.add(clamp(r.x1, xr, xf)); }
  const X = [];
  for (const x of [...xs].sort((p, q) => p - q)) if (!X.length || x - X[X.length - 1] > 0.004) X.push(x);
  const nx = X.length - 1, nz = Z.length - 1;
  const cell = new Int16Array(nx * nz).fill(-1);
  for (let j = 0; j < nz; j++) {
    const zm = (Z[j] + Z[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const xm = (X[i] + X[i + 1]) / 2;
      for (let k = 0; k < R.length; k++) { const r = R[k]; if (xm > r.x0 && xm < r.x1 && zm > r.z0 && zm < r.z1) { cell[j * nx + i] = k; break; } }
    }
  }
  const dOf = (k) => (k < 0 ? 0 : R[k].d);
  const Y = (z, d) => s * (halfWidthAt(c, z) - d);
  const uvOf = (k, x, z) => { if (k < 0) return [0, 0]; const r = R[k]; return [(x - r.x0) / (r.x1 - r.x0), (z - r.z0) / (r.z1 - r.z0)]; };
  const Q = (k, pts) => { const id = k < 0 ? MAT.BODY : R[k].id, aux = k < 0 ? 0 : R[k].aux; const uv = []; for (const p of pts) uv.push(...uvOf(k, p[0], p[2])); return { id, aux, uv }; };
  for (let j = 0; j < nz; j++) {
    const z0 = Z[j], z1 = Z[j + 1];
    let i = 0;
    while (i < nx) {
      const k = cell[j * nx + i];
      let e = i + 1;
      while (e < nx && cell[j * nx + e] === k) e++;
      const d = dOf(k), x0 = X[i], x1 = X[e];
      const pts = [[x0, Y(z0, d), z0], [x1, Y(z0, d), z0], [x1, Y(z1, d), z1], [x0, Y(z1, d), z1]];
      const q = Q(k, pts);
      b.quad(pts[0], pts[1], pts[2], pts[3], q.id, q.uv, q.aux);
      if (e < nx) {
        const k2 = cell[j * nx + e], d2 = dOf(k2);
        if (Math.abs(d2 - d) > 1e-6) {
          const deep = d2 > d ? k2 : k, n = [d2 > d ? 1 : -1, 0, 0];
          const rp = [[x1, Y(z0, d), z0], [x1, Y(z0, d2), z0], [x1, Y(z1, d2), z1], [x1, Y(z1, d), z1]];
          const rq = Q(deep, rp);
          b.quad(rp[0], rp[1], rp[2], rp[3], rq.id, rq.uv, rq.aux, n);
        }
      }
      i = e;
    }
  }
  // horizontal reveals between bands (window sills face up, window / door heads face down)
  for (let j = 0; j + 1 < nz; j++) {
    const z = Z[j + 1];
    let i = 0;
    while (i < nx) {
      const ka = cell[j * nx + i], kb = cell[(j + 1) * nx + i];
      const da = dOf(ka), db = dOf(kb);
      let e = i + 1;
      while (e < nx && cell[j * nx + e] === ka && cell[(j + 1) * nx + e] === kb) e++;
      if (Math.abs(da - db) > 1e-6) {
        const deep = da > db ? ka : kb, n = [0, 0, da > db ? -1 : 1];
        const x0 = X[i], x1 = X[e];
        const rp = [[x0, Y(z, da), z], [x1, Y(z, da), z], [x1, Y(z, db), z], [x0, Y(z, db), z]];
        const rq = Q(deep, rp);
        b.quad(rp[0], rp[1], rp[2], rp[3], rq.id, rq.uv, rq.aux, n);
      }
      i = e;
    }
  }
}

/** The rake of the cab front at height z (m back from the front's foot): near vertical below the windscreen, the
 * windscreen leaning back, the forehead rounding over into the roof. */
function rakeAt(c, z) {
  if (z <= c.winBot) return 0.05 * clamp((z - c.sill) / Math.max(0.01, c.winBot - c.sill), 0, 1);
  if (z <= c.winTop) return 0.05 + 0.2 * (z - c.winBot) / Math.max(0.01, c.winTop - c.winBot);
  const t = clamp((z - c.winTop) / Math.max(0.01, c.H - c.winTop), 0, 1);
  return 0.25 + 0.4 * t * t;
}

/** The cab nose at the +x end (sx = 1) or the -x end (sx = -1): rings at every level, a side run, a rounded corner,
 * the front across; windscreen, black pillars / forehead, the stripe wrapping round, lamps, the destination display. */
function emitNose(b, c, lod, Z, arc, sx) {
  const K = lod === 0 ? 4 : 1;
  const xf = c.L / 2 - c.noseLen;
  const levels = [...Z.map((z) => ({ z, y: halfWidthAt(c, z) })), ...arc.slice(1).map((a) => ({ z: a.z, y: a.y }))];
  const yWin = halfWidthAt(c, c.winBot) - c.cornerR;
  const ring = (lv) => {
    const xF = c.L / 2 - rakeAt(c, lv.z);
    const r = Math.max(0, Math.min(c.cornerR, lv.y * 0.85, xF - xf - 0.02));
    const pts = [[xf, lv.y]];
    for (let k = 0; k <= K; k++) { const f = (k / K) * Math.PI / 2; pts.push([xF - r + r * Math.sin(f), lv.y - r + r * Math.cos(f)]); }
    pts.push([xF, 0]);
    return pts;
  };
  const rings = levels.map(ring);
  const P = (pt, z, side) => [sx * pt[0], side * pt[1], z];
  for (let l = 0; l + 1 < levels.length; l++) {
    const za = levels[l].z, zb = levels[l + 1].z, zm = (za + zb) / 2;
    const A = rings[l], B = rings[l + 1];
    for (let sgi = 0; sgi + 1 < A.length; sgi++) {
      const type = sgi === 0 ? 'side' : sgi <= K ? 'corner' : 'front';
      let id = MAT.BODY, aux = 1, uvf = null;
      if (zm > c.cant) id = MAT.ROOF;
      else if (zm > c.winTop) id = type === 'side' ? (c.top && zm > c.top[0] && zm < c.top[1] ? MAT.STRIPE2 : MAT.BODY) : MAT.CABFACE;
      else if (zm > c.winBot) {
        if (type === 'front') { id = MAT.WINDSCREEN; uvf = (p, z) => [0.5 + 0.5 * clamp(p[1] / Math.max(0.1, yWin), -1, 1), (z - c.winBot) / (c.winTop - c.winBot)]; }
        else if (type === 'corner') id = MAT.CABFACE;
        else { id = MAT.WINDOW; aux = 1; uvf = (p, z) => [clamp((p[0] - xf) / 0.5, 0, 1), (z - c.winBot) / (c.winTop - c.winBot)]; }
      } else if (zm > c.stripe0 && zm < c.stripe1) id = MAT.STRIPE;
      for (const side of [1, -1]) {
        const q = [P(A[sgi], za, side), P(A[sgi + 1], za, side), P(B[sgi + 1], zb, side), P(B[sgi], zb, side)];
        let uv = UV0;
        if (uvf) { uv = []; const src = [[A[sgi], za], [A[sgi + 1], za], [B[sgi + 1], zb], [B[sgi], zb]]; for (const [pt, z] of src) { const u = uvf([pt[0], side * pt[1]], z); uv.push(u[0], u[1]); } }
        b.quad(q[0], q[1], q[2], q[3], id, uv, aux);
      }
    }
  }
  // the nose's underside at the sill
  const bot = rings[0];
  const under = [];
  for (const pt of bot) under.push(P(pt, levels[0].z, 1));
  for (let k = bot.length - 2; k >= 0; k--) under.push(P(bot[k], levels[0].z, -1));
  b.fan([sx * (xf + c.noseLen * 0.45), 0, levels[0].z], under, MAT.UNDER, [0, 0, -1]);
  // the skirt under the front, the lamps (head inner, tail outer), the destination display on the forehead
  const xs = c.L / 2;
  const yS = halfWidthAt(c, c.sill) - c.cornerR * 0.6;
  {
    const zt = c.sill + 0.01, zb = Math.max(0.22, c.sill - 0.62);
    const yt = yS, yb = yS - 0.2, xt = xs - 0.02, xb = xs - 0.16;
    for (const side of [1, -1]) {
      b.quad([sx * xt, 0, zt], [sx * xt, side * yt, zt], [sx * xb, side * yb, zb], [sx * xb, 0, zb], MAT.SKIRT, UV0, 0);
      b.quad([sx * xt, side * yt, zt], [sx * (xt - 0.6), side * (yt + 0.06), zt], [sx * (xb - 0.5), side * (yb + 0.04), zb], [sx * xb, side * yb, zb], MAT.SKIRT, UV0, 0);
    }
    if (lod === 0) b.box(sx > 0 ? xs - 0.1 : -xs - 0.34, sx > 0 ? xs + 0.34 : -xs + 0.1, -0.12, 0.12, 0.74, 0.9, MAT.COUPLER);
  }
  const lampZ0 = c.stripe0 - 0.3, lampZ1 = c.stripe0 - 0.08;
  const yF = halfWidthAt(c, lampZ1) - c.cornerR;
  const xAt = (z) => c.L / 2 - rakeAt(c, z) + 0.035;   // decals stand 3.5 cm proud (MapLibre's depth range at ~10 m)
  for (const side of [1, -1]) {
    const yo = yF - 0.06, yi = Math.max(0.25, yF - 0.62);
    // uv: u = 0 at the outer edge, 1 at the inner one
    b.quad([sx * xAt(lampZ0), side * yo, lampZ0], [sx * xAt(lampZ0), side * yi, lampZ0], [sx * xAt(lampZ1), side * yi, lampZ1], [sx * xAt(lampZ1), side * yo, lampZ1], MAT.LAMP, [0, 0, 1, 0, 1, 1, 0, 1], 0, [sx, 0, 0]);
  }
  {
    const z0 = c.winTop + 0.035, z1 = Math.min(c.cant - 0.02, c.winTop + 0.23), w = Math.min(0.72, yWin * 0.62);
    const n = [sx * 0.94, 0, 0.34];
    b.quad([sx * xAt(z0), w, z0], [sx * xAt(z0), -w, z0], [sx * xAt(z1), -w, z1], [sx * xAt(z1), w, z1], MAT.DEST, [0, 0, 1, 0, 1, 1, 0, 1], 0, n);
  }
}

/** An end wall (gangway end) at x = sx * L / 2: the section as a fan. */
function emitEnd(b, c, Z, arc, sx) {
  const x = sx * c.L / 2;
  const left = Z.map((z) => [x, halfWidthAt(c, z), z]);
  const roofL = arc.slice(1).map((a) => [x, a.y, a.z]);
  const ringPts = [...left, ...roofL];
  const right = [...ringPts].reverse().slice(1).map((p) => [x, -p[1], p[2]]);
  const all = [...ringPts, ...right, ringPts[0]];
  b.fan([x, 0, (c.sill + c.H) / 2], all, MAT.END, [sx, 0, 0]);
  // the gangway bellows (to the middle of the gap) and its door window
  b.box(sx > 0 ? x : x - (c.gapHalf + 0.02), sx > 0 ? x + c.gapHalf + 0.02 : x, -0.55, 0.55, c.floor - 0.08, Math.min(c.cant - 0.1, c.floor + 1.95), MAT.GANGWAY);
}

/** Build one car: LOD 0 / 1 / 2 (see the top). */
export function carMesh(spec, lod = 0) {
  const c = classOf(spec?.cls || 'm20');
  const L = Math.max(0, Math.min(2, lod | 0));
  const b = builder(c);
  const cabF = spec?.cab === 'front' || spec?.cab === 'both', cabR = spec?.cab === 'both';
  if (L === 2) {
    // far: the old box with a window band (and a dark cab face where it has one); ~30 triangles
    const x0 = -c.L / 2, x1 = c.L / 2, W2 = c.W / 2;
    for (const s of [1, -1]) {
      const y = s * W2;
      b.quad([x0, y, c.sill], [x1, y, c.sill], [x1, y, c.winBot], [x0, y, c.winBot], MAT.BODY);
      b.quad([x0, y, c.winBot], [x1, y, c.winBot], [x1, y, c.winTop], [x0, y, c.winTop], MAT.WINDOW, [0, 0, 1, 0, 1, 1, 0, 1], 0);
      b.quad([x0, y, c.winTop], [x1, y, c.winTop], [x1, y, c.cant], [x0, y, c.cant], MAT.BODY);
      b.quad([x0, y, c.cant], [x1, y, c.cant], [x1, s * W2 * 0.55, c.H], [x0, s * W2 * 0.55, c.H], MAT.ROOF);
    }
    b.quad([x0, W2 * 0.55, c.H], [x1, W2 * 0.55, c.H], [x1, -W2 * 0.55, c.H], [x0, -W2 * 0.55, c.H], MAT.ROOF, UV0, 0, [0, 0, 1]);
    for (const sx of [1, -1]) {
      const x = sx * c.L / 2, cab = sx > 0 ? cabF : cabR;
      b.quad([x, W2, c.sill], [x, -W2, c.sill], [x, -W2, c.winBot], [x, W2, c.winBot], cab ? MAT.BODY : MAT.END, UV0, 1, [sx, 0, 0]);
      b.quad([x, W2, c.winBot], [x, -W2, c.winBot], [x, -W2, c.cant], [x, W2, c.cant], cab ? MAT.WINDSCREEN : MAT.END, [0, 0, 1, 0, 1, 1, 0, 1], 0, [sx, 0, 0]);
      b.quad([x, W2, c.cant], [x, -W2, c.cant], [x, -W2 * 0.55, c.H], [x, W2 * 0.55, c.H], cab ? MAT.CABFACE : MAT.END, UV0, 0, [sx, 0, 0]);
    }
    b.box(-c.L / 2 + 1.0, c.L / 2 - 1.0, -W2 + 0.3, W2 - 0.3, 0.3, c.sill, MAT.UNDER, 0, 63 - 16);
    return b.done();
  }
  const xr = cabR ? -c.L / 2 + c.noseLen : -c.L / 2, xf = cabF ? c.L / 2 - c.noseLen : c.L / 2;
  const { R, centres } = sideRegions(c, L, xr, xf, cabF, cabR);
  const Z = zLevels(c, R, L);
  const arc = roofArc(c, L === 0 ? 6 : 2);
  emitSide(b, c, R, Z, xr, xf, 1);
  emitSide(b, c, R, Z, xr, xf, -1);
  // roof: smooth arc strips from xr to xf (the noses carry it on)
  for (let k = 0; k + 1 < arc.length; k++) {
    const a = arc[k], d = arc[k + 1];
    for (const s of [1, -1]) {
      const na = [0, s * a.ny, a.nz], nd = [0, s * d.ny, d.nz];
      b.quadN([xr, s * a.y, a.z], [xf, s * a.y, a.z], [xf, s * d.y, d.z], [xr, s * d.y, d.z], na, na, nd, nd, MAT.ROOF, [0, 0, 1, 0, 1, 1, 0, 1], k === 0 ? 2 : 0);
    }
  }
  // the body's underside
  { const y = halfWidthAt(c, c.sill); b.quad([xr, y, c.sill], [xr, -y, c.sill], [xf, -y, c.sill], [xf, y, c.sill], MAT.UNDER, UV0, 0, [0, 0, -1]); }
  if (cabF) emitNose(b, c, L, Z, arc, 1); else emitEnd(b, c, Z, arc, 1);
  if (cabR) emitNose(b, c, L, Z, arc, -1); else emitEnd(b, c, Z, arc, -1);
  // roof: the AC unit (chamfered box with two fans on top), an antenna on cab cars
  {
    const [al, aw, ah] = c.ac, zt = c.H + ah - (c.cls === 'e16' ? 0.04 : 0), z0 = c.H - 0.1, ch = L === 0 ? Math.min(0.1, ah * 0.4) : 0;
    const sec = ch > 0 ? [[-aw / 2, z0], [aw / 2, z0], [aw / 2, zt - ch], [aw / 2 - ch, zt], [-aw / 2 + ch, zt], [-aw / 2, zt - ch]] : [[-aw / 2, z0], [aw / 2, z0], [aw / 2, zt], [-aw / 2, zt]];
    b.prism(-al / 2, al / 2, sec, MAT.ROOFUNIT, 0);
    if (L === 0 && c.L > 15) {
      // two small roof vents (the line ventilators)
      for (const x of [-c.L * 0.3, c.L * 0.3]) b.box(x - 0.35, x + 0.35, -0.22, 0.22, c.H - 0.05, c.H + 0.09, MAT.ROOFUNIT, 1);
    }
    if (L === 0 && cabF) b.box(xf - 1.1, xf - 0.8, 0.25, 0.4, c.H - 0.03, c.H + 0.12, MAT.PANTO, 0);
  }
  if (spec?.panto) emitPanto(b, c, L, cabF ? -(c.L / 2 - 3.0) : c.L / 2 - 3.0);
  // under-floor equipment, bogies (frames, wheels at LOD0), couplers + collector shoes (third rail)
  {
    const yU = halfWidthAt(c, c.sill) - 0.3, zU0 = Math.max(0.3, c.sill - 0.6);
    const span = c.bogie - 1.55;
    if (L === 0) {
      const parts = [[-span, -span * 0.38], [-span * 0.3, span * 0.3], [span * 0.38, span]];
      for (const [a, d] of parts) if (d - a > 0.4) b.box(a, d, -yU, yU, zU0, c.sill, MAT.UNDER, 0, 63 - 16);
    } else if (span > 0.5) b.box(-span, span, -yU, yU, zU0, c.sill, MAT.UNDER, 0, 63 - 16);
    const g2 = c.gauge / 2 + 0.035, R0 = c.wheelR;
    for (const xb of [-c.bogie, c.bogie]) {
      if (L === 0) {
        for (const s of [1, -1]) b.box(xb - 1.3, xb + 1.3, s * g2 - 0.07 + (s > 0 ? 0.11 : -0.11), s * g2 + 0.07 + (s > 0 ? 0.11 : -0.11), R0 - 0.1, R0 + 0.24, MAT.BOGIE);
        b.box(xb - 0.3, xb + 0.3, -g2 - 0.05, g2 + 0.05, R0 + 0.02, R0 + 0.3, MAT.BOGIE);
        if (c.wheelbase > 0) {
          for (const xw of [xb - c.wheelbase / 2, xb + c.wheelbase / 2]) {
            for (const s of [1, -1]) b.wheel(xw, s * g2, R0, R0, 0.065, 10, MAT.WHEEL);
            b.beam([xw, -g2, R0], [xw, g2, R0], 0.06, 0.06, MAT.BOGIE);
          }
        }
        if (spec?.third) for (const s of [1, -1]) b.box(xb - 0.35, xb + 0.35, s * (g2 + 0.34) - 0.09, s * (g2 + 0.34) + 0.09, 0.1, 0.2, MAT.BOGIE, 1);
      } else b.box(xb - 1.3, xb + 1.3, -g2 - 0.15, g2 + 0.15, 0.12, R0 + 0.3, MAT.BOGIE, 0, 63 - 16);
    }
    if (L === 0) for (const sx of [1, -1]) if (sx > 0 ? !cabF : !cabR) {
      const x = sx * c.L / 2;
      b.box(sx > 0 ? x - 0.25 : x - c.gapHalf, sx > 0 ? x + c.gapHalf : x + 0.25, -0.11, 0.11, 0.74, 0.9, MAT.COUPLER);
    }
  }
  // side destination displays: above the window behind the second door from the front, each side
  if (L === 0 && centres.length >= 2) {
    const z0 = c.winTop + 0.03, z1 = Math.min(c.doorTop + 0.02, c.winTop + 0.19);
    const xa = centres[centres.length - 2] + c.doorW / 2 + 0.35, xb = xa + 0.78;
    for (const s of [1, -1]) {
      const y0 = s * (halfWidthAt(c, z0) + 0.025), y1 = s * (halfWidthAt(c, z1) + 0.025);
      b.quad([s > 0 ? xb : xa, y0, z0], [s > 0 ? xa : xb, y0, z0], [s > 0 ? xa : xb, y1, z1], [s > 0 ? xb : xa, y1, z1], MAT.DEST, [0, 0, 1, 0, 1, 1, 0, 1], 1, [0, s, 0]);
    }
  }
  return b.done();
}

/** A single-arm pantograph, raised to c.wire above the roof, over the bogie at x0. */
function emitPanto(b, c, lod, x0) {
  const zr = c.H - 0.02, zb = c.H + 0.2, zw = c.H + c.wire;
  const dirx = Math.sign(x0) || 1;   // the knee points to the car's end
  if (lod === 0) {
    for (const xi of [x0 - 0.45, x0 + 0.45]) for (const s of [1, -1]) b.box(xi - 0.05, xi + 0.05, s * 0.42 - 0.05, s * 0.42 + 0.05, zr, zb, MAT.PANTO, 1);
    b.box(x0 - 0.6, x0 + 0.6, -0.5, 0.5, zb, zb + 0.06, MAT.PANTO, 0, 63);
    const hinge = [x0 - dirx * 0.45, 0, zb + 0.08], knee = [x0 + dirx * 0.72, 0, zb + 0.16 + (zw - zb) * 0.42], head = [x0 - dirx * 0.08, 0, zw - 0.07];
    for (const s of [1, -1]) b.beam([hinge[0], s * 0.22, hinge[2]], [knee[0], s * 0.06, knee[2]], 0.035, 0.035, MAT.PANTO);
    b.beam(knee, head, 0.03, 0.03, MAT.PANTO);
    b.beam([x0 - dirx * 0.2, 0, zb + 0.08], [knee[0] - dirx * 0.35, 0, knee[2] - 0.12], 0.02, 0.02, MAT.PANTO);
    b.box(head[0] - 0.07, head[0] + 0.07, -0.78, 0.78, zw - 0.07, zw, MAT.PANTO, 2);
    for (const s of [1, -1]) b.beam([head[0], s * 0.76, zw - 0.035], [head[0], s * 0.98, zw - 0.2], 0.025, 0.03, MAT.PANTO, 2);
  } else {
    b.box(x0 - 0.6, x0 + 0.6, -0.5, 0.5, zr, zb + 0.06, MAT.PANTO, 0, 63 - 32);
    const knee = [x0 + dirx * 0.72, 0, zb + 0.16 + (zw - zb) * 0.42];
    b.beam([x0 - dirx * 0.45, 0, zb + 0.08], knee, 0.12, 0.04, MAT.PANTO);
    b.beam(knee, [x0 - dirx * 0.08, 0, zw - 0.07], 0.04, 0.04, MAT.PANTO);
    b.box(x0 - dirx * 0.08 - 0.07, x0 - dirx * 0.08 + 0.07, -0.85, 0.85, zw - 0.07, zw, MAT.PANTO, 2, 63 - 32);
  }
}

const MESHES = new Map();
/** carMesh cached per (geometry key, lod): the same arrays for every car of that class and role. */
export function meshFor(spec, lod = 0) {
  const k = `${spec?.key || 'm20|none|-|-'}#${lod | 0}`;
  let m = MESHES.get(k);
  if (!m) { m = carMesh(spec, lod); m.mid = (classOf(spec?.cls || 'm20').sill + classOf(spec?.cls || 'm20').H) / 2; MESHES.set(k, m); }
  return m;
}

// ----------------------------------------------------------------------------------------------------------- LOD
/** LOD for a car drawn `pxPerM` css px per metre on screen (near 0 / mid 1 / far 2). */
export function lodFor(pxPerM) {
  if (!(pxPerM > 0)) return 2;
  if (pxPerM >= 9) return 0;     // a 2.8 m wide car >= ~25 px wide: doors, lamps, pantographs read
  if (pxPerM >= 1.6) return 1;   // >= ~4.5 px wide: window band + doors
  return 2;
}
/** css px per metre at a point of clip w (MapLibre: mainMatrix in its world px, mpp = metres per world px at the
 * zoom; fov = the map's vertical field of view, 36.87 deg by default). */
export function pxPerMetre(clipW, cssH, mpp, fovDeg = 36.8699) {
  if (!(clipW > 0) || !(mpp > 0)) return 0;
  return (cssH / 2) / Math.tan(fovDeg * Math.PI / 360) / clipW / mpp;
}
/** 0 by day .. 1 at night (WIB): the interior lights glow brighter after dusk. */
export function nightFactor(ms = Date.now()) {
  const h = ((ms / 3600000 + 9) % 24 + 24) % 24;
  if (h >= 18.5 || h < 4.5) return 1;
  if (h >= 16.5) return (h - 16.5) / 2;
  if (h < 6.5) return 1 - (h - 4.5) / 2;
  return 0;
}

// ---------------------------------------------------------------------------------------------------------- GLSL
/** The material functions (fragment shader). Needs in scope: nothing but its arguments. */
export const TRAINSET_GLSL = `
const vec3 TS_METAL = vec3(0.85, 0.865, 0.88);
vec3 tsRGB(float c) { return vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0; }
float tsBit(float flags, float b) { return mod(floor(flags / b + 0.001), 2.0); }
float tsBox(vec2 uv, vec2 lo, vec2 hi) { return step(lo.x, uv.x) * step(uv.x, hi.x) * step(lo.y, uv.y) * step(uv.y, hi.y); }
// warm interior light seen through glass: brighter toward the ceiling, darker seat backs low; a grazing reflection
vec3 tsGlass(vec2 uv, vec3 n, vec3 V, float night, float tint) {
  float fres = pow(1.0 - clamp(abs(dot(n, V)), 0.0, 1.0), 3.0);
  float glow = mix(0.62, 1.0, night) * tint;
  vec3 warm = vec3(1.0, 0.91, 0.76);
  float g = (0.34 + 0.5 * smoothstep(0.1, 0.92, uv.y)) * glow;
  vec3 inside = mix(vec3(0.06, 0.07, 0.09), warm * 0.92, g);
  return mix(inside, vec3(0.58, 0.62, 0.68), fres * 0.55);
}
// lit colour of one fragment of a car. id/aux/uv from the mesh, p = mesh-local position (m), n / V world normal and
// toward-eye, L toward the light, line = the line's colour, liv = (style, body 0xRRGGBB | -1 metal | -2 line colour,
// flags, type band 0xRRGGBB | -1), night 0..1
vec3 tsShade(float id, float aux, vec2 uv, vec3 p, vec3 n, vec3 V, vec3 L, vec3 line, vec4 liv, float night) {
  float style = liv.x;
  bool metal = liv.y == -1.0;
  vec3 body = metal ? TS_METAL : (liv.y <= -1.5 ? line : tsRGB(liv.y));
  float flags = liv.z;
  bool picked = tsBit(flags, 4.0) > 0.5;
  vec3 base = body; vec3 emit = vec3(0.0);
  float ks = metal ? 0.3 : 0.16, shin = 28.0, flt = 0.0;
  int m = int(id + 0.5);
  if (m == 0 || m == 17) {                                   // body, end walls
    if (metal) base *= 0.97 + 0.03 * step(0.5, fract(p.z * 3.2));  // stainless beads / panels
  } else if (m == 1) {                                        // the band under the windows
    flt = 0.65;
    if (style == 2.0) {                                       // Marunouchi: white band carrying the sine wave
      base = vec3(0.95);
      float w = 0.5 + 0.3 * sin(p.x * 1.15);
      if (abs(uv.y - w) < 0.14) base = vec3(0.72, 0.74, 0.77);
      if (aux > 0.5) base = vec3(0.95);
    } else if (style == 4.0) base = vec3(0.96);              // a white band on a full-colour body (Keikyu)
    else if (style == 1.0) base = body;                       // full colour: no stripe
    else if (style == 3.0) base = aux > 0.5 ? line : body;    // E235: the colour only round the nose
    else base = line;                                         // the line's colour, exact
  } else if (m == 2) {                                        // the thin band above the doors
    flt = 0.65;
    base = (style == 0.0) ? line : body;
  } else if (m == 3) {                                        // side windows: black frame, glass, warm interior
    float panes = max(aux, 1.0);
    float fu = fract(uv.x * panes);
    float fx = 0.045 * panes / max(1.0, panes), fy = 0.07;
    bool frame = fu < fx || fu > 1.0 - fx || uv.y < fy || uv.y > 1.0 - fy;
    base = frame ? vec3(0.09, 0.095, 0.1) : tsGlass(uv, n, V, night, 1.0);
    ks = frame ? 0.1 : 0.55; shin = 60.0; flt = frame ? 0.0 : 0.85;
  } else if (m == 4) {                                        // doors: leaf (+ line colour on E235), window, outline
    vec2 q = uv;
    if (aux > 1.5 && aux < 2.5) q.x = fract(uv.x * 2.0);      // LOD1: one region = two leaves
    vec3 leaf = style == 3.0 ? line : body;
    bool crew = aux > 2.5;
    vec2 wlo = crew ? vec2(0.2, 0.5) : vec2(0.17, 0.47), whi = crew ? vec2(0.8, 0.9) : vec2(0.83, 0.93);
    float ex = min(q.x, 1.0 - q.x) * (crew ? 0.64 : 0.65), ey = min(q.y, 1.0 - q.y) * 1.85;
    if (min(ex, ey) < 0.014) { base = vec3(0.05); ks = 0.0; }
    else if (tsBox(q, wlo, whi) > 0.5) { base = tsGlass((q - wlo) / (whi - wlo), n, V, night, 0.9); ks = 0.55; shin = 60.0; flt = 0.85; }
    else { base = leaf; if (style == 3.0) flt = 0.5; }
  } else if (m == 5) {                                        // the black cab face, glossy
    base = vec3(0.045, 0.05, 0.055); ks = 0.6; shin = 48.0;
  } else if (m == 6) {                                        // windscreen: dark glass, a dim cab, frame
    float e = min(min(uv.x, 1.0 - uv.x) * 2.4, min(uv.y, 1.0 - uv.y));
    float fres = pow(1.0 - clamp(abs(dot(n, V)), 0.0, 1.0), 3.0);
    base = mix(vec3(0.035, 0.045, 0.06), vec3(0.5, 0.54, 0.6), fres * 0.6) + vec3(0.05, 0.045, 0.035) * mix(0.6, 1.0, night);
    if (e < 0.05) base = vec3(0.03);
    ks = 0.8; shin = 80.0;
  } else if (m == 7) {                                        // lamp housing: head lamp inner, tail lamp outer
    float head = tsBit(flags, 1.0), tail = tsBit(flags, 2.0);
    if (p.x < 0.0) { float t = head; head = tail; tail = t; } // the -x cab of a two-cab car is the other end
    base = vec3(0.12, 0.125, 0.13); ks = 0.6;
    vec2 q = uv;
    if (tsBox(q, vec2(0.52, 0.18), vec2(0.95, 0.82)) > 0.5) { base = vec3(0.8, 0.8, 0.78); emit = head > 0.5 ? vec3(1.3, 1.25, 1.1) : vec3(0.0); flt = 1.0; }
    else if (tsBox(q, vec2(0.06, 0.24), vec2(0.42, 0.76)) > 0.5) { base = vec3(0.32, 0.06, 0.06); emit = tail > 0.5 ? vec3(1.15, 0.08, 0.05) : vec3(0.0); flt = 1.0; }
  } else if (m == 8) {                                        // destination display: type block + text, LED
    base = vec3(0.025); ks = 0.3; flt = 1.0;
    float side = aux > 0.5 ? 1.0 : 0.0;
    vec3 type = liv.w >= 0.0 ? tsRGB(liv.w) : vec3(0.92, 0.93, 0.95);
    if (uv.x > 0.05 && uv.x < 0.27 && uv.y > 0.18 && uv.y < 0.82) emit = type * 0.95;
    else if (uv.x > 0.33 && uv.x < 0.95 && uv.y > 0.26 && uv.y < 0.74) {
      float cx = fract((uv.x - 0.33) / 0.62 * (side > 0.5 ? 5.0 : 6.0));
      float on = step(0.12, cx) * step(cx, 0.86) * (0.75 + 0.25 * step(0.5, fract(uv.y * 3.0 + cx * 2.0)));
      emit = vec3(1.0, 0.72, 0.32) * on * 0.9;
    }
  } else if (m == 9) {                                        // roof: grey, ribbed, a darker gutter at the edge
    base = metal || style == 3.0 ? vec3(0.6, 0.62, 0.65) : vec3(0.42, 0.43, 0.45);
    base *= 0.95 + 0.05 * step(0.5, fract(p.y * 5.0));
    if (aux > 1.5 && uv.y < 0.2) base *= 0.72;
    ks = 0.12;
  } else if (m == 10) {                                       // AC unit: light grey, two fans on top, louvres
    base = vec3(0.8, 0.81, 0.82); ks = 0.2;
    if (aux < 0.5 && n.z > 0.85) {
      vec2 d0 = vec2((uv.x - 0.3) * 2.3, (uv.y - 0.5) * 1.7), d1 = vec2((uv.x - 0.7) * 2.3, (uv.y - 0.5) * 1.7);
      float r = min(length(d0), length(d1));
      if (r < 0.3) base = vec3(0.46, 0.47, 0.49) + 0.1 * step(0.5, fract(r * 22.0));
      else if (abs(uv.x - 0.5) < 0.04) base *= 0.9;
    } else if (abs(n.z) < 0.5) base *= 0.82 + 0.18 * step(0.5, fract(p.z * 26.0));
  } else if (m == 11) {                                       // pantograph: dark metal, white insulators, the head
    base = aux > 0.5 && aux < 1.5 ? vec3(0.86, 0.85, 0.82) : aux > 1.5 ? vec3(0.3, 0.31, 0.33) : vec3(0.2, 0.21, 0.23); ks = 0.45;
  } else if (m == 12) { base = vec3(0.15, 0.155, 0.165); ks = 0.05; }          // under-floor boxes
  else if (m == 13) { base = aux > 0.5 ? vec3(0.3, 0.26, 0.2) : vec3(0.1, 0.1, 0.11); ks = 0.1; }  // bogies (shoes)
  else if (m == 14) { base = aux > 0.5 ? vec3(0.5, 0.5, 0.52) : vec3(0.2, 0.2, 0.22); ks = 0.5; } // wheels: tread bright
  else if (m == 15) { base = vec3(0.065) + 0.035 * step(0.5, fract(p.x * 16.0)); ks = 0.05; }   // gangway bellows
  else if (m == 16) { base = vec3(0.14); ks = 0.3; }                                             // couplers
  else if (m == 18) { base = metal ? vec3(0.2, 0.21, 0.22) : body * 0.5; ks = 0.25; }          // cab skirt
  if (picked && (m == 9 || m == 0)) base = mix(base, vec3(1.0), 0.28);
  vec3 N = normalize(n);
  float dif = max(dot(N, L), 0.0);
  float hemi = 0.5 + 0.5 * N.z;
  float shade = 0.5 + 0.2 * hemi + 0.38 * dif;
  vec3 col = base * mix(shade, 1.0, flt * 0.6);
  vec3 H = normalize(L + V);
  col += ks * pow(max(dot(N, H), 0.0), shin);
  if (metal && (m == 0 || m == 17 || m == 4)) col += 0.1 * pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);  // brushed sheen
  return col + emit;
}
`;

export const TRAINSET_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec4 a_mat;    // id / 255, u, v, aux / 255 (UNSIGNED_BYTE, normalized)
layout(location=3) in vec3 i_pos;    // the car's centre on the rail top (local metres)
layout(location=4) in vec4 i_dir;    // heading (ux, uy), slope dz / dx, flip (+1 mesh +x ahead, -1 turned round)
layout(location=5) in vec3 i_scl;    // scale along / across / up (city-zoom px floors; 1 1 1 = true size)
layout(location=6) in vec4 i_col;    // the line's colour, alpha (< 1 faint)
layout(location=7) in vec4 i_liv;    // livery style, body colour, flags, type band
uniform mat4 u_m;
uniform float u_grow;      // > 0: the live rim pass (the car grown this many metres each way)
uniform float u_mid;       // the mesh's middle height (where the rim grows from)
uniform float u_rimOnly;   // 1: instances without the LIVE flag collapse
out vec3 v_p; out vec3 v_n; out vec3 v_w; out vec2 v_uv;
flat out float v_id; flat out float v_aux; flat out vec4 v_col; flat out vec4 v_liv;
void main() {
  vec3 p = a_pos;
  if (u_grow > 0.0) p += u_grow * vec3(sign(p.x), sign(p.y), sign(p.z - u_mid));
  vec3 q = p * i_scl;
  float f = i_dir.w < 0.0 ? -1.0 : 1.0;
  q.xy *= f;
  float c = i_dir.x, s = i_dir.y;
  vec3 w = i_pos + vec3(c * q.x - s * q.y, s * q.x + c * q.y, q.z + q.x * i_dir.z);
  gl_Position = u_m * vec4(w, 1.0);
  if (u_rimOnly > 0.5 && mod(floor(i_liv.z / 8.0 + 0.001), 2.0) < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vec3 nn = a_nrm / max(i_scl, vec3(0.001));
  nn.xy *= f;
  v_n = normalize(vec3(c * nn.x - s * nn.y, s * nn.x + c * nn.y, nn.z));
  v_p = a_pos; v_w = w; v_uv = a_mat.yz;
  v_id = floor(a_mat.x * 255.0 + 0.5); v_aux = floor(a_mat.w * 255.0 + 0.5);
  v_col = i_col; v_liv = i_liv;
}`;

export const TRAINSET_FS = `#version 300 es
precision highp float;
in vec3 v_p; in vec3 v_n; in vec3 v_w; in vec2 v_uv;
flat in float v_id; flat in float v_aux; flat in vec4 v_col; flat in vec4 v_liv;
uniform vec3 u_light;    // toward the light
uniform vec3 u_eye;      // the camera (same local metres)
uniform float u_night;   // 0 day .. 1 night (WIB)
uniform vec4 u_rim;      // a > 0: flat rim colour (the live pass)
out vec4 o;
${TRAINSET_GLSL}
void main() {
  if (u_rim.a > 0.0) { o = vec4(u_rim.rgb, 1.0); return; }
  vec3 n = normalize(v_n);
  vec3 V = normalize(u_eye - v_w);
  if (dot(n, V) < 0.0) n = -n;   // thin parts seen from behind (no culling)
  vec3 col;
  if (v_col.a < 0.99) {
    // faint (a ghost): plain, no livery
    float lit = max(dot(n, normalize(u_light)), 0.0);
    col = v_col.rgb * (0.62 + 0.38 * lit);
  } else col = tsShade(v_id, v_aux, v_uv, v_p, n, V, normalize(u_light), v_col.rgb, v_liv, u_night);
  o = vec4(min(col, vec3(1.0)) * v_col.a, v_col.a);
}`;

// ----------------------------------------------------------------------------------------------------- GL drawer
function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`trainset shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`trainset link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

/** Invert a column-major 4x4 (Float32/64) into out; returns false if singular. */
function invert4(m, out) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return false;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}
/** The camera position (local metres) of a view-projection matrix: the point that projects to w = 0. */
const INV_EYE = new Float64Array(16);
export function eyeOf(M, out = [0, 0, 0]) {
  const inv = INV_EYE;   // scratch: no allocation per frame
  if (!invert4(M, inv)) return out;
  // inv * (0, 0, 1, 0)
  const x = inv[8], y = inv[9], z = inv[10], w = inv[11];
  if (Math.abs(w) < 1e-12) return out;
  out[0] = x / w; out[1] = y / w; out[2] = z / w;
  return out;
}

/** GPU side: meshes per (spec.key, lod) uploaded once, an instance buffer per group, one instanced draw per group.
 * Per frame: begin(); push(...) for every car; draw(M, { light, night, eye? }); drawRims(M, { rim, grow }) first
 * when there are live cars (they draw no depth, the cars over them). GL state (depth, blend) stays the caller's. */
export function createTrainsetGL(gl) {
  const prog = compile(gl, TRAINSET_VS, TRAINSET_FS);
  const groups = new Map();
  const order = [];
  let gpuBytes = 0, dead = false;
  const EYE = [0, 0, 0], INV = new Float64Array(16);
  function group(spec, lod) {
    const k = `${spec.key}#${lod}`;
    let g = groups.get(k);
    if (g) return g;
    const mesh = meshFor(spec, lod);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const pb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 12, 0);
    const mb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mb); gl.bufferData(gl.ARRAY_BUFFER, mesh.mats, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 4, 0);
    const eb = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    const cap = 64;
    gl.bufferData(gl.ARRAY_BUFFER, cap * TS_F * 4, gl.DYNAMIC_DRAW);
    const B = TS_F * 4;
    const attr = (loc, size, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off); gl.vertexAttribDivisor(loc, 1); };
    attr(3, 3, 0); attr(4, 4, 12); attr(5, 3, 28); attr(6, 4, 40); attr(7, 4, 56);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    g = { k, mesh, vao, bufs: [pb, nb, mb, eb, ib], ib, gpuCap: cap, data: new Float32Array(cap * TS_F), n: 0, type: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, count: mesh.indices.length };
    gpuBytes += mesh.bytes + cap * TS_F * 4;
    groups.set(k, g);
    order.push(g);
    return g;
  }
  function upload(g) {
    gl.bindBuffer(gl.ARRAY_BUFFER, g.ib);
    if (g.gpuCap * TS_F < g.data.length) {
      gpuBytes += (g.data.length / TS_F - g.gpuCap) * TS_F * 4;
      g.gpuCap = g.data.length / TS_F;
      gl.bufferData(gl.ARRAY_BUFFER, g.data.byteLength, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.data, 0, g.n * TS_F);
    g.dirty = false;
  }
  function drawAll(M, u, rim) {
    if (dead) return 0;
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u.u_m, false, M);
    const L = u?.light || [0.3, -0.4, 0.86];
    gl.uniform3f(prog.u.u_light, L[0], L[1], L[2]);
    let eye = u?.eye;
    if (!eye) { eye = EYE; if (invert4(M, INV) && Math.abs(INV[11]) > 1e-12) { EYE[0] = INV[8] / INV[11]; EYE[1] = INV[9] / INV[11]; EYE[2] = INV[10] / INV[11]; } }
    gl.uniform3f(prog.u.u_eye, eye[0], eye[1], eye[2]);
    gl.uniform1f(prog.u.u_night, u?.night ?? 0);
    gl.uniform1f(prog.u.u_grow, rim ? rim.grow : 0);
    gl.uniform1f(prog.u.u_rimOnly, rim ? 1 : 0);
    gl.uniform4f(prog.u.u_rim, rim ? rim.color[0] : 0, rim ? rim.color[1] : 0, rim ? rim.color[2] : 0, rim ? 1 : 0);
    let drawn = 0;
    for (const g of order) {
      if (!g.n) continue;
      if (g.dirty) upload(g);
      gl.uniform1f(prog.u.u_mid, g.mesh.mid);
      gl.bindVertexArray(g.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, g.count, g.type, 0, g.n);
      drawn += g.n;
    }
    gl.bindVertexArray(null);
    return drawn;
  }
  return {
    /** Start a frame: every group empties (buffers kept). */
    begin() { for (const g of order) { g.n = 0; g.dirty = true; } },
    /** One car. spec from carSpec (its flip / flags are applied here), lod 0-2, (x, y, z) its centre on the rail
     * top, (ux, uy) the train's heading, slope dz/dx, sy / sz the across / up scale (1 = true size), rgb the line's
     * colour (0..1), alpha (< 1 = a faint ghost, drawn plain), extra flags (FLAG.PICKED | FLAG.LIVE), band = the type
     * colour 0xRRGGBB or -1. */
    push(spec, lod, x, y, z, ux, uy, slope, sy, sz, r, g, b, alpha, extra = 0, band = -1) {
      const G = group(spec, lod < 0 ? 0 : lod > 2 ? 2 : lod | 0);
      if ((G.n + 1) * TS_F > G.data.length) { const d = new Float32Array(G.data.length * 2); d.set(G.data); G.data = d; }
      const D = G.data, i = G.n * TS_F;
      D[i] = x; D[i + 1] = y; D[i + 2] = z;
      D[i + 3] = ux; D[i + 4] = uy; D[i + 5] = slope; D[i + 6] = spec.flip;
      D[i + 7] = 1; D[i + 8] = sy; D[i + 9] = sz;
      D[i + 10] = r; D[i + 11] = g; D[i + 12] = b; D[i + 13] = alpha;
      D[i + 14] = spec.style; D[i + 15] = spec.bodyColor === 'line' ? -2 : spec.bodyColor;
      D[i + 16] = spec.flags | extra; D[i + 17] = band;
      G.n++; G.dirty = true;
      return G.n;
    },
    /** Draw every car pushed this frame. u: { light: [x,y,z] toward the light, night: 0..1, eye?: [x,y,z] }. */
    draw(M, u = {}) { return drawAll(M, u, null); },
    /** The live rims: call before draw() with depth writes off; rim = { color: [r,g,b], grow: metres }. */
    drawRims(M, u = {}, rim = { color: [0x1E / 255, 0x9E / 255, 0x4A / 255], grow: 0.1 }) { return drawAll(M, u, rim); },
    stats() {
      let inst = 0, tris = 0;
      for (const g of order) { inst += g.n; tris += g.n * (g.count / 3); }
      return { groups: order.length, instances: inst, tris, gpuBytes };
    },
    destroy() {
      dead = true;
      for (const g of order) { for (const b of g.bufs) gl.deleteBuffer(b); gl.deleteVertexArray(g.vao); }
      groups.clear(); order.length = 0;
      gl.deleteProgram(prog.p);
    },
  };
}
