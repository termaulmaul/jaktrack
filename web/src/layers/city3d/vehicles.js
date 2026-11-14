// 3D view: the trains in 3D, on their track's height, and the underground view.
//
// One small WebGL2 custom layer ('tk3d-trains', renderingMode '3d': it shares MapLibre's depth buffer with the
// buildings and viaducts, so a train behind a building is hidden by it). No three.js and no models: each car is a calm
// box in its line's colour (Mini Tokyo 3D's look; glass and the underframe stay dark,
// the roof lighter), one instanced draw for every car.
//   - Where: each train's place along its line (metres along the chain and which way it heads, from the position
//     provider index.js hands in) gives every car's centre, heading and height: elevation.js's profile under that car,
//     the car pitched by the profile's slope (a train climbing a ramp tilts with it). Japan keeps left: a train runs
//     LEFT_M left of its line's centre, as the 2D trainsets do.
//   - Size: true length (so a train is as long as its platform), but never thinner on screen than MIN_W_PX (the width
//     and height grow up to K_MAX times at city zoom, the height a little less: a long low train, not a wall). Below
//     index.js's Z_3D the 2D trainsets draw instead (at that zoom a viaduct's height is a pixel).
//   - Surface view: trains at grade and on viaducts solid; trains underground drawn faint at their depth (as Mini Tokyo
//     3D does), so a subway train is there but reads as "below".
//   - Underground view (setMode({ underground: true })): a light veil over everything drawn before this layer (the
//     basemap, the network, the city: index.js also hides its buildings and decks), then the underground stretches of
//     every line as crisp ribbons at their depth, and the underground trains solid on them; surface trains faint.
//   - Labels: labels.js puts each visible train's label above its middle car (decluttered) on a 2D canvas over the map.
//   - the underground view draws depth UG_EXAG times deeper (the heights build's depths are 8-28 m, a
//     few px on a phone; x3 separates the levels, order and ratios stay the heights build's); the ribbons go deepest first (painter's
//     order, no depth fight: a shallower line's white casing passes over a deeper line, as at Otemachi), each underground
//     platform gets a thin shaft up to the street (where its name is), and a train with a fresh LIVE report (model.js frame
//     live 1 = live.js's model.measured) wears a rim in the live green (trains.js LIVE_RING, the Live pill's dot) with a
//     white gap, in both 3D views; estimated / timetable trains stay plain.
//
// export const TRAINS3D_ID
// export function createTrains3d(opts) -> { layer, setMode({ on, underground }), setSelected(id), pick(x, y), stats(),
//   destroy() }
//   opts: { net, profiles, source(nowMs) -> [{ id, line, s, dir, cars?, label?, run? }], labels?: Labels,
//           now?: () => ms, reduced?: bool }
//   s = metres along the line's chain, the train's middle; dir = 1 heading up the chain, -1 down.

import { trackOf, pointAt, toLocal, OX, OY, S } from './track.js';
import { createUndergroundGL, lineDepths, levelOf, UG_EXAG as UG_EXAG_3D, UG_MIN_Z, PLAT_L, SLAB } from './underground.js';
import { createBoresGL, trackOffset } from './bores.js';
import { trackFor, trackPoint } from './real.js';
// r3d-b: real-looking cars; the boxes stay for the faint ghosts and as the fallback
import { createTrainsetGL, carSpec, carPitch, lodFor, pxPerMetre, nightFactor, eyeOf, FLAG as TSF } from './trainset.js';
import { boreIndex, eyeIn } from './boreeye.js';   // the free camera's eye among the bores

export const TRAINS3D_ID = 'tk3d-trains';
// LEFT_M 0: data Jakarta hanya punya garis tengah rel (tanpa jalur ganda), jadi kereta digambar tepat di atas garis rutenya.
// Dengan 1,9 m (nilai asal) garis rute yang dipilih tampak sebagai bayangan di samping kereta. Kereta berpapasan jadi bertumpuk sesaat.
export const CAR_L = 19.5, CAR_GAP = 0.8, CAR_W = 2.95, CAR_H = 3.7, LIFT = 0.4, LEFT_M = 0;
export const MIN_W_PX = 7, K_MAX = 8, HEIGHT_GAIN = 0.6;
export const UNDER_M = -2;                 // a car this far below ground is underground
export const OVER_M = 1, OVER_LIFT = 0.45;  // track this far up gets its line's colour along the deck top, a little above it
const FAINT_SURFACE = 0.32, FAINT_UNDER = 0.3, VEIL = [0.962, 0.966, 0.973, 0.72];
const FAINT_SURFACE_UG = 0.05;            // surface trains in the underground view: a whisper of grey (they were 0.16: noise)
const GHOST = [0.667, 0.667, 0.69];   // faint trains: the rest network's neutral grey (network-layer.js REST)
/** The underground view draws depth this many times deeper than the heights build's metres (levels 3-10 m apart read as 1-6 px
 * otherwise); the surface view and every height above ground stay true. */
export const UG_EXAG = UG_EXAG_3D;   // round 2 (real 3D tubes): underground.js owns it (x5)
/** A live train's rim (css px each side): the live green outside, a white gap inside (the 2D ring's look). */
export const RIM_PX = 1.9, RIM_GAP_PX = 1.0;
const LIVE_GREEN = [0x1E / 255, 0x9E / 255, 0x4A / 255];   // trains.js LIVE_RING '#1E9E4A' (app.css --income)
const SHAFT = [0.62, 0.63, 0.67];        // the platform shafts: a quiet grey
const F = 16;                              // floats per car instance
const CAP0 = 4096;
const FRAME_MS = 33;                       // ask for a frame at most this often while trains move (reduced: 1000)
const LOOK_M = 32;                         // (c): the Cab looks at the train's own track this far ahead of its nose

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 i_pos;
layout(location=3) in vec3 i_dir;
layout(location=4) in vec3 i_size;
layout(location=5) in vec4 i_col;
layout(location=6) in vec3 i_flag;   // flags (1 front cab, 2 rear cab, 4 picked), band 0xRRGGBB (-1 none), band height
uniform mat4 u_m;
uniform vec3 u_grow;   // metres added to every car's size (a live train's rim: the box grown around the car)
out vec3 v_col; out float v_a; out vec3 v_p; out vec3 v_n; flat out vec3 v_flag;
void main() {
  vec3 p = a_pos * (i_size + u_grow);
  p.z -= u_grow.z * 0.5;
  float c = i_dir.x, s = i_dir.y;
  vec3 w = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z + p.x * i_dir.z);
  gl_Position = u_m * vec4(i_pos + w, 1.0);
  v_n = vec3(c * a_nrm.x - s * a_nrm.y, s * a_nrm.x + c * a_nrm.y, a_nrm.z);
  v_p = a_pos; v_col = i_col.rgb; v_a = i_col.a; v_flag = i_flag;
}`;
const FS = `#version 300 es
precision highp float;
in vec3 v_col; in float v_a; in vec3 v_p; in vec3 v_n; flat in vec3 v_flag;
uniform vec3 u_light;
uniform float u_full;   // 1 = the underground view's subway trains: their line's full colour, roof too, softly shaded
uniform vec4 u_rim;     // a > 0: draw the grown box flat in this colour (a live train's rim)
out vec4 o;
const vec3 GLASS = vec3(0.20, 0.23, 0.27);
const vec3 UNDER = vec3(0.32, 0.34, 0.37);
void main() {
  if (u_rim.a > 0.0) { o = vec4(u_rim.rgb, 1.0); return; }
  vec3 n = normalize(v_n);
  vec3 col = v_col;
  float f = mod(v_flag.x, 8.0);
  vec3 band = v_flag.y < 0.0 ? v_col : vec3(floor(v_flag.y / 65536.0), mod(floor(v_flag.y / 256.0), 256.0), mod(v_flag.y, 256.0)) / 255.0;
  bool front = mod(f, 2.0) >= 1.0, rear = mod(floor(f / 2.0), 2.0) >= 1.0, sel = f >= 4.0;
  if (v_p.z < 0.12) col = UNDER;                                            // underframe
  else if (abs(v_p.y) > 0.499 && v_p.z > 0.3 && v_p.z < 0.3 + v_flag.z) col = band;   // the type's stripe along the side
  else if (abs(v_p.y) > 0.499 && v_p.z > 0.5 && v_p.z < 0.8 && abs(v_p.x) < 0.45 && fract(v_p.x * 5.0 + 0.5) < 0.8) col = mix(GLASS, v_col, 0.15);  // side windows
  else if (v_p.x > 0.499 && front && v_p.z > 0.48 && v_p.z < 0.84 && abs(v_p.y) < 0.42) col = GLASS;  // cab windscreen
  else if (v_p.x < -0.499 && rear && v_p.z > 0.48 && v_p.z < 0.84 && abs(v_p.y) < 0.42) col = GLASS;
  else if (v_p.z > 0.999) col = mix(v_col, vec3(0.93, 0.94, 0.95), sel ? 0.7 : 0.55 * (1.0 - u_full));  // roof
  float lit = max(dot(n, u_light), 0.0);
  float shade = mix(0.62 + 0.42 * lit, 0.86 + 0.16 * lit, u_full);
  o = vec4(col * shade * v_a, v_a);
}`;
// screen-space ribbons for the underground stretches (width in device px)
const RVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_p;
layout(location=1) in vec3 a_q;
layout(location=2) in vec2 a_se;
layout(location=3) in vec4 a_col;
uniform mat4 u_m; uniform vec2 u_vp; uniform float u_w;
uniform float u_zl;     // metres added to z (the ride-along's lift)
uniform float u_wref;   // > 0: perspective width: u_w at the clip w of the map's centre, wider nearer, thinner
                        // further (x0.55 .. x1.8), so the tilted underground reads as depth; 0 = constant px
out vec4 v_col;
void main() {
  vec4 cp = u_m * vec4(a_p + vec3(0.0, 0.0, u_zl), 1.0), cq = u_m * vec4(a_q + vec3(0.0, 0.0, u_zl), 1.0);
  vec2 sp = cp.xy / max(cp.w, 1e-6) * u_vp * 0.5, sq = cq.xy / max(cq.w, 1e-6) * u_vp * 0.5;
  vec2 d = sq - sp; float l = length(d); d = l > 1e-6 ? d / l * a_se.y : vec2(1.0, 0.0);
  float k = u_wref > 0.0 ? clamp(u_wref / max(cp.w, 1e-6), 0.55, 1.8) : 1.0;
  vec2 nrm = vec2(-d.y, d.x) * a_se.x * u_w * k;
  gl_Position = cp + vec4(nrm / (u_vp * 0.5) * cp.w, 0.0, 0.0);
  v_col = a_col;
}`;
// a_col.a carries the line's index: at rest (u_grey 1) every line is the network's calm grey (network-layer.js REST
// #AAAAB0) but the picked one (u_pick), which wears its colour; the underground view (u_grey 0) shows every colour
const RFS = `#version 300 es
precision highp float;
in vec4 v_col; uniform float u_white; uniform float u_grey; uniform float u_pick; out vec4 o;
void main() {
  float picked = abs(v_col.a - u_pick) < 0.5 ? 1.0 : 0.0;
  vec3 c = mix(vec3(0.667, 0.667, 0.69), v_col.rgb, max(picked, 1.0 - u_grey));
  o = vec4(mix(c, vec3(1.0), u_white), 1.0);
}`;
// the underground view's stations: a white dot with a grey ring at each underground platform's depth
const PVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_p;
uniform mat4 u_m; uniform float u_size;
void main() { gl_Position = u_m * vec4(a_p, 1.0); gl_PointSize = u_size; }`;
const PFS = `#version 300 es
precision highp float;
out vec4 o;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float a = 1.0 - smoothstep(0.86, 1.0, r);
  vec3 c = r > 0.62 ? vec3(0.42, 0.42, 0.44) : vec3(1.0);
  o = vec4(c * a, a);
}`;
const QVS = `#version 300 es
layout(location=0) in vec2 a_xy; void main() { gl_Position = vec4(a_xy, 0.0, 1.0); }`;
const QFS = `#version 300 es
precision highp float; uniform vec4 u_c; out vec4 o; void main() { o = vec4(u_c.rgb * u_c.a, u_c.a); }`;

const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return [0.55, 0.57, 0.6];
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};

const RGB = new Map();
const rgbCached = (hex) => { let v = RGB.get(hex); if (!v) { v = rgb(hex); if (RGB.size > 512) RGB.clear(); RGB.set(hex, v); } return v; };
const packed = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? parseInt(m[1], 16) : -1; };

/** The unit box: x along the car (-0.5..0.5, front +x), y across (-0.5..0.5, left +y), z up (0..1). 36 vertices,
 * position + normal. */
function boxVerts() {
  const v = [];
  const face = (n, a, b, c, d) => { for (const p of [a, b, c, a, c, d]) v.push(...p, ...n); };
  const X = 0.5, Y = 0.5;
  face([0, 0, 1], [-X, -Y, 1], [X, -Y, 1], [X, Y, 1], [-X, Y, 1]);
  face([0, 0, -1], [-X, Y, 0], [X, Y, 0], [X, -Y, 0], [-X, -Y, 0]);
  face([1, 0, 0], [X, -Y, 0], [X, Y, 0], [X, Y, 1], [X, -Y, 1]);
  face([-1, 0, 0], [-X, Y, 0], [-X, -Y, 0], [-X, -Y, 1], [-X, Y, 1]);
  face([0, 1, 0], [X, Y, 0], [-X, Y, 0], [-X, Y, 1], [X, Y, 1]);
  face([0, -1, 0], [-X, -Y, 0], [X, -Y, 0], [X, -Y, 1], [-X, -Y, 1]);
  return new Float32Array(v);
}

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`city3d shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`city3d link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** Ribbon vertices (p, q, side/end, colour; 12 floats per vertex, 6 vertices per piece) for every underground stretch
 * of the network (which 'under': at its depth) or every elevated one ('over': OVER_LIFT above its deck, so the line's
 * colour runs along the top of the viaduct under its trains). */
export function ribbonData(net, profiles, which = 'under', exag = 1, sink = null) {
  const over = which === 'over';
  const out = [];
  const put = (A, B, r, g, b, i) => {
    const base = out.length;
    const vert = (P, Q, side, end) => out.push(P[0], P[1], P[2], Q[0], Q[1], Q[2], side, end, r, g, b, i);
    vert(A, B, 1, 1); vert(A, B, -1, 1); vert(B, A, -1, -1);
    vert(A, B, 1, 1); vert(B, A, -1, -1); vert(B, A, 1, -1);
    if (sink) sink(base, (A[2] + B[2]) / 2 / (exag || 1));
  };
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  for (let i = 0; i < lines.length; i++) {
    const pr = profiles[i];
    if (!pr || !(over ? pr.max >= OVER_M : pr.min < UNDER_M)) continue;
    const t = trackOf(lines[i]);
    const [r, g, b] = rgb(lines[i].color);
    const k = t.k || 1;
    for (let v = 0; v + 1 < t.n; v++) {
      const ha = pr.at(t.cum[v] / k), hb = pr.at(t.cum[v + 1] / k);
      if (over ? !(ha >= OVER_M || hb >= OVER_M) : !(ha < UNDER_M || hb < UNDER_M)) continue;
      // long segments: split so the depth follows the profile's ramps
      const len = t.cum[v + 1] - t.cum[v];
      const parts = Math.max(1, Math.min(20, Math.ceil(len / 80)));
      for (let j = 0; j < parts; j++) {
        const f0 = j / parts, f1 = (j + 1) / parts;
        const x0 = t.x[v] + (t.x[v + 1] - t.x[v]) * f0, y0 = t.y[v] + (t.y[v + 1] - t.y[v]) * f0;
        const x1 = t.x[v] + (t.x[v + 1] - t.x[v]) * f1, y1 = t.y[v] + (t.y[v + 1] - t.y[v]) * f1;
        const z0 = pr.at((t.cum[v] + len * f0) / k), z1 = pr.at((t.cum[v] + len * f1) / k);
        const A = over ? [x0, y0, Math.max(0, z0) + OVER_LIFT] : [x0, y0, Math.min(0, z0) * exag];
        const B = over ? [x1, y1, Math.max(0, z1) + OVER_LIFT] : [x1, y1, Math.min(0, z1) * exag];
        put(A, B, r, g, b, i);
      }
    }
  }
  return new Float32Array(out);
}

/** The underground ribbons (ribbonData 'under', depth x exag) in painter's order: deepest first, so each shallower
 * level's white casing passes over the deeper ones (no depth fight where two lines cross at one depth: the later line
 * index just draws on top). bins = [{ first, count }] in vertices, one per whole metre of (true) depth, deepest first:
 * the casing and the colour of one level go before the next level's. */
export function ribbonBins(net, profiles, exag = UG_EXAG) {
  const quads = [];
  const raw = ribbonData(net, profiles, 'under', exag, (base, d) => quads.push([Math.round(d), base]));
  quads.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const data = new Float32Array(raw.length);
  const bins = [];
  let o = 0;
  for (const [d, base] of quads) {
    data.set(raw.subarray(base, base + 72), o);
    const b = bins[bins.length - 1];
    if (b && b.d === d) b.count += 6;
    else bins.push({ d, first: o / 12, count: 6 });
    o += 72;
  }
  return { data, bins };
}

/** The underground platforms: [x, y, depth] per station of a line whose profile there is below UNDER_M (depth x exag,
 * plus 0.5 m: the dot sits on its ribbon). */
export function stationDepths(net, profiles, exag = 1) {
  const out = [];
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  for (let i = 0; i < lines.length; i++) {
    const pr = profiles[i], line = lines[i];
    if (!pr || !(pr.min < UNDER_M) || !Array.isArray(line.stations)) continue;
    const t = trackOf(line);
    const P = [0, 0, 1, 0];
    for (let k = 0; k < line.stations.length; k++) {
      const m = line.chain?.[k];
      if (!Number.isFinite(m)) continue;
      const h = pr.at(m);
      if (!(h < UNDER_M)) continue;
      pointAt(t, m * (t.k || 1), P);
      out.push(P[0], P[1], h * exag + 0.5);
    }
  }
  return new Float32Array(out);
}

/** A thin vertical shaft from every underground platform (stationDepths' points) up to the street, as ribbon vertices
 * (the ribbon program; colour SHAFT): with the view tilted it shows how deep each level runs under its station name. */
export function shaftData(points) {
  const out = [];
  const [r, g, b] = SHAFT;
  for (let i = 0; i + 2 < points.length; i += 3) {
    const A = [points[i], points[i + 1], points[i + 2]], B = [points[i], points[i + 1], 0];
    const vert = (P, Q, side, end) => out.push(P[0], P[1], P[2], Q[0], Q[1], Q[2], side, end, r, g, b, -1);
    vert(A, B, 1, 1); vert(A, B, -1, 1); vert(B, A, -1, -1);
    vert(A, B, 1, 1); vert(B, A, -1, -1); vert(B, A, 1, -1);
  }
  return new Float32Array(out);
}

export function createTrains3d(opts) {
  const net = opts.net, profiles = opts.profiles || [];
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const colours = lines.map((l) => rgb(l.color));
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const labels = opts.labels || null;
  let source = typeof opts.source === 'function' ? opts.source : () => [];
  let mode = { on: false, underground: false, trains: true };
  let selected = null, pickedLine = null;
  let reduced = !!opts.reduced;
  let gl = null, prog = null, rprog = null, qprog = null;
  let vao = null, ibuf = null, qvao = null, qbuf = null, ovao = null, obuf = null, ocount = 0;
  let vbuf = null, ug = null, bores = null, hubs = [], fvao = null, fbuf = null, fcount = 0, ts = null;
  // per solid car instance: its train's list index and its place in the train (for trainset's carSpec)
  let carC = new Int16Array(CAP0), carN = new Int16Array(CAP0);
  const EYE = [0, 0, 0];   // the camera in local metres, this frame (trainset's view vector + the inside-car guard)
  // the underground's scale (UG_EXAG, or 1 = true scale: real proportions, no px floors) and the ride-along: the ridden
  // train's id; its line is lifted to the ground plane (u_lift) so MapLibre's camera can ride just behind and above it
  let ride = null, rideState = null, allLast = [];
  // while the free camera flies { idx (bore index), inside, dist, line } (eyeIn, each frame drawn)
  let fly = null;
  const GAUGE = { z: 0, exag: 1 }, FLYT = [];
  const laneUG = [];   // per line: the underground track offset (m, keep left), from its section shape
  // per line: the heights build's nominal depth + a tie offset (lines at one depth never share a level), for the trains and the tubes
  const depths = lineDepths(net, profiles);
  const UGU = { M32: null, light: null, pl: PLAT_L, cx: 0, cy: 0, zoom: 15, mpp: 1, exag: UG_EXAG_3D, k: 1, lift: 0, view: [0, 0, 0, 0], fog: SLAB };
  /** True rail level (tie included) -> drawn z in the underground view. */
  const ugZ = (h, tie) => (h < 0 ? (h - tie * Math.min(1, -h / 6)) * UGU.exag : h);
  let data = new Float32Array(CAP0 * F), gpuBytes = 0;
  let nOpaque = 0, nFaint = 0, nLive = 0, mppNow = 1;
  let map = null, timer = 0, dead = false, reason = '';
  const M64 = new Float64Array(16), M32 = new Float32Array(16);
  const cars = [];        // per instance in the last frame: index into `trains`
  let trains = [];        // the last frame's trains in view (with .anchor for labels)
  const inView = [];
  const st = { frames: 0, trains: 0, cars: 0, underground: 0, faint: 0, ms: 0, ribbons: 0 };
  const P = [0, 0, 1, 0];
  // the ride's Behind eye: this many metres behind the ridden train's tail, on its own track (index.js sets it)
  let rideGap = 8;
  const RT = [0, 0, 0, 0], QR = [0, 0, 1, 0];
  /** A point of the ridden train's OWN way at chain m (as its cars are placed: the real OSM track where it has one, keep
   * left otherwise) -> out [x, y, drawn rail level]. */
  function rideTrackAt(tr, line, pr, t, k, dir, inUg, kw, left, m, out) {
    out[3] = 0;   // 1 = on the real (OSM) track
    pointAt(t, m, P);
    let ux = P[2] * dir, uy = P[3] * dir;
    const lf = inUg ? (opts.real?.lines ? trackOffset(line.id, depths.nominal[tr.line] || -15, opts.real.section(tr.line, m / k)) : (laneUG[tr.line] ?? 1.9)) * kw : left;
    let x = P[0] - uy * lf, y = P[1] + ux * lf;
    const trk = inUg ? opts.tracks?.[tr.line] : null;
    if (trk) {
      const tk = trackFor(trk, m / k, dir);
      if (tk && trackPoint(tk, m / k, QR)) { ux = QR[2] * dir; uy = QR[3] * dir; const lo = tk.twin ? 0 : lf; x = QR[0] - uy * lo; y = QR[1] + ux * lo; out[3] = 1; }
    }
    let h = pr ? pr.at(m / k) : 0;
    if (mode.underground) h = Math.min(0, ugZ(h, depths.tie[tr.line]));
    out[0] = x; out[1] = y; out[2] = h;
    return out;
  }
  // light (toward the sun): azimuth 210 deg (from the south-south-west), 38 deg from the zenith, as the map's own
  const LIGHT = (() => { const a = 210 * Math.PI / 180, p = 38 * Math.PI / 180; return [Math.sin(a) * Math.sin(p), Math.cos(a) * Math.sin(p), Math.cos(p)]; })();

  function setMatrix(m) {
    for (let r = 0; r < 4; r++) {
      M64[r] = m[r] / S;
      M64[4 + r] = -m[4 + r] / S;
      M64[8 + r] = m[8 + r] / S;
      M64[12 + r] = m[r] * OX + m[4 + r] * OY + m[12 + r];
    }
    for (let i = 0; i < 16; i++) M32[i] = M64[i];
  }

  function ensure(n) {
    if (data.length >= n * F) return;
    let c = data.length / F;
    while (c < n) c *= 2;
    const d = new Float32Array(c * F);
    d.set(data);
    data = d;
  }

  /** Write every car of every train in view into `data`: solid ones first, faint ones after. view = local [x0, y0, x1,
   * y1] (the map's bounds and a margin): a train whose middle is outside is left out (its label too). */
  const VIEW = [0, 0, 0, 0], A = [0, 0], B = [0, 0];
  const RULER = [], TAGS = [], Q = [0, 0, 1, 0];
  function viewBox() {
    if (fly) {
      // getBounds means little for an eye among the tunnels (level or upward views): a box around the eye
      // (this frame's matrix), reaching further ahead; under the street <= 2.2 km (bores.js interiors: <= 3 x 3 cells)
      eyeOf(M64, EYE);
      const z = EYE[2], R = z < 0 ? Math.min(1100, 700 + 1.5 * -z) : Math.min(5500, 1000 + 2.5 * z);
      const br = map.getBearing() * Math.PI / 180, ax = EYE[0] + Math.sin(br) * R * 0.5, ay = EYE[1] + Math.cos(br) * R * 0.5;
      VIEW[0] = ax - R; VIEW[1] = ay - R; VIEW[2] = ax + R; VIEW[3] = ay + R;
      return;
    }
    const b = map.getBounds();
    toLocal(b.getWest(), b.getSouth(), A);
    toLocal(b.getEast(), b.getNorth(), B);
    const pad = 600;
    VIEW[0] = Math.min(A[0], B[0]) - pad; VIEW[1] = Math.min(A[1], B[1]) - pad;
    VIEW[2] = Math.max(A[0], B[0]) + pad; VIEW[3] = Math.max(A[1], B[1]) + pad;
  }
  function fill(z, lat) {
    const all = mode.trains || mode.underground ? source(now()) || [] : [];
    allLast = all;
    viewBox();
    const list = inView;
    list.length = 0;
    for (const tr of all) {
      const line = lines[tr.line];
      if (!line) continue;
      const t = trackOf(line);
      pointAt(t, (Number(tr.s) || 0) * (t.k || 1), P);
      if (P[0] < VIEW[0] || P[0] > VIEW[2] || P[1] < VIEW[1] || P[1] > VIEW[3]) continue;
      list.push(tr);
    }
    st.running = all.length;
    trains = list;
    const mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * 2 ** z);
    mppNow = mpp;
    const trueScale = mode.underground && mode.exag === 1;
    const kw = trueScale ? 1 : Math.min(K_MAX, Math.max(1, MIN_W_PX * mpp / CAR_W));
    const kh = 1 + (kw - 1) * HEIGHT_GAIN;
    const W = CAR_W * kw, H = CAR_H * kh, lift = LIFT * kh, left = LEFT_M * Math.max(1, kw * 0.9);
    let total = 0;
    for (const tr of list) total += Math.max(1, Math.min(16, tr.cars || lines[tr.line]?.cars || 10));
    ensure(total);
    cars.length = total;
    // three passes so the solid cars come first, the LIVE ones first of all (their rims draw from instance 0);
    // underground cars are faint in the surface view, surface ones in the underground view
    let o = 0, n0 = 0, nu = 0, nl = 0, liveTrains = 0;
    const under = mode.underground;
    // the underground view's depth: drawnZ (x UG_EXAG + the line's tie offset); trains low enough to ride in their tube
    const tieOf = depths.tie;
    const Hu = under ? CAR_H * Math.min(kh, 1.25) : H;
    for (let pass = 0; pass < 3; pass++) {
      for (let ti = 0; ti < list.length; ti++) {
        const tr = list[ti];
        const line = lines[tr.line];
        if (!line) continue;
        const pr = profiles[tr.line];
        const t = trackOf(line);
        const k = t.k || 1;
        const n = Math.max(1, Math.min(16, tr.cars || line.cars || 10));
        const dir = tr.dir < 0 ? -1 : 1;
        const pitch = ts ? carPitch(line.id) : CAR_L + CAR_GAP;   // trainset: the line's real car spacing
        const mid = (Number(tr.s) || 0) * k;
        const hMid = pr ? pr.at(mid / k) : 0;
        // elev-v2.1: a subway line out in the open between two portals (Marunouchi over the Kanda River) stays solid;
        // lines with only rural mountain tunnels are not the underground view's (their trains stay ghosts there)
        const R2 = opts.real?.lines ? opts.real : null;
        const isUnder = (hMid < UNDER_M || !!R2?.inOpen(tr.line, mid / k)) && (!R2 || R2.shown(tr.line));
        // (d): the ridden train is always a solid, real train (out in the open too: a ghost box there was the
        // "flat grey world"); "open" = not under the street (above ground, or an open-air deck between two portals)
        const ridden = ride != null && (tr.id === ride || tr.run?.key === ride);
        const faint = under ? !isUnder && !ridden : isUnder;
        tr.open = !(hMid < UNDER_M) || !!R2?.inOpen(tr.line, mid / k);
        const live = !faint && !!tr.live;
        if (pass !== (faint ? 2 : live ? 0 : 1)) continue;
        if (pass < 2) n0 += n;
        if (pass === 0) { nl += n; liveTrains++; }
        if (isUnder) nu++;
        const alpha = faint ? (under ? FAINT_SURFACE_UG : FAINT_UNDER) : 1;
        // { body: '#hex', band: '#hex' | null } from trains.js's look, else the line's colour; the underground view's
        // subway trains always wear their line's full colour (the 2D trainsets mute them; this view is about them)
        const look = under && !faint ? null : tr.look || null;
        const sel = selected != null && (tr.id === selected || tr.run?.key === selected) ? 4 : 0;
        // a faint train is a neutral grey ghost (the network's rest grey), never its line colour faded: official line
        // colours are shown exact or not at all; the picked train keeps its colour, solid
        const ghost = faint && !sel;
        const [r, g, b] = ghost ? GHOST : look?.body ? rgbCached(look.body) : colours[tr.line] || [0.55, 0.57, 0.6];
        const band = !ghost && look?.band && look.band !== look.body ? packed(look.band) : -1;
        const bandH = band >= 0 ? 0.1 + 0.12 * Math.min(1, Math.max(0, look.weight ?? 0.5)) : 0;
        const alphaCar = faint && sel ? 1 : alpha;
        let ax = 0, ay = 0, az = 0;
        for (let c = 0; c < n; c++) {
          const m = mid + dir * ((n * pitch) / 2 - (c + 0.5) * pitch);
          pointAt(t, m, P);
          let ux = P[2] * dir, uy = P[3] * dir;              // the way the train heads
          // keep left; underground in the underground view: on its track in its bore / box (twin bores: the bore's middle)
          const lf = under && isUnder ? (opts.real?.lines ? trackOffset(line.id, depths.nominal[tr.line] || -15, opts.real.section(tr.line, mid / k)) : (laneUG[tr.line] ?? (laneUG[tr.line] = trackOffset(line.id, depths.nominal[tr.line] || -15)))) * kw : left;
          let x = P[0] - uy * lf, y = P[1] + ux * lf;
          // r3b: on the REAL track where the line has it: its own twin track, else the shared way
          const trk = under && isUnder ? opts.tracks?.[tr.line] : null;
          let onT = false;
          if (trk) {
            const tk = trackFor(trk, m / k, dir);
            if (tk && trackPoint(tk, m / k, Q)) {
              ux = Q[2] * dir; uy = Q[3] * dir;
              const lo = tk.twin ? 0 : lf;   // a shared way: the track offset its section gives (twin bores, box tracks)
              x = Q[0] - uy * lo; y = Q[1] + ux * lo;
              onT = true;
            }
          }
          let h0 = pr ? pr.at((m - dir * pitch / 2) / k) : 0, h1 = pr ? pr.at((m + dir * pitch / 2) / k) : 0;
          if (under) { h0 = Math.min(0, ugZ(h0, tieOf[tr.line])); h1 = Math.min(0, ugZ(h1, tieOf[tr.line])); }
          const h = (h0 + h1) / 2;
          const i = o * F;
          const inTube = under && isUnder, hc = inTube ? Hu : H, lc = inTube ? 0.25 : lift;
          data[i] = x; data[i + 1] = y; data[i + 2] = h + lc;
          data[i + 3] = ux; data[i + 4] = uy; data[i + 5] = (h1 - h0) / pitch;
          data[i + 6] = Math.min(CAR_L, pitch - 0.5); data[i + 7] = W; data[i + 8] = hc;
          data[i + 9] = r; data[i + 10] = g; data[i + 11] = b; data[i + 12] = alphaCar;
          data[i + 13] = (c === 0 ? 1 : 0) + (c === n - 1 ? 2 : 0) + sel;
          data[i + 14] = band; data[i + 15] = bandH;
          cars[o] = ti;
          if (o >= carC.length) { const a = new Int16Array(carC.length * 2), b2 = new Int16Array(carC.length * 2); a.set(carC); b2.set(carN); carC = a; carN = b2; }
          carC[o] = c; carN[o] = n;
          o++;
          if (c === (n >> 1)) { ax = x; ay = y; az = h + lc + hc; tr.hx = ux; tr.hy = uy; tr.hz = h; }
          if (c === 0) tr.hz0 = h; if (c === n - 1) tr.hzN = h;   // the head / last car's rail level (the ride lift)
          if (c === 0) { tr.fx = x + ux * (pitch - 0.5) / 2; tr.fy = y + uy * (pitch - 0.5) / 2; tr.fhx = ux; tr.fhy = uy; tr.ot0 = onT; }   // the front window
          if (c === n - 1) { tr.rx = x - ux * (pitch - 0.5) / 2; tr.ry = y - uy * (pitch - 0.5) / 2; tr.rhx = ux; tr.rhy = uy; tr.otN = onT; }   // the last car's end
          tr.pitch = pitch;
        }
        if (ridden) {
          // (c): points on the train's OWN track (the real OSM track where it has one, as its cars): LOOK_M past
          // its nose (the Cab looks at it, so the view follows a curve instead of the head car's tangent into the wall)
          // and rideGap behind its tail (the Behind eye sits ON the track there: along the middle car's heading it drifted
          // ~2 m sideways on a 300 m curve, into the bore's wall)
          // Where the real track stops short of the point (a station's tracks, a gap in its coverage) but the train's end
          // car is on it, the point goes straight on from that end along its heading: the line's own geometry + keep-left
          // offset is metres to one side there (QA 4 Nov: the Behind eye in a wall at Iidabashi, the Cab outside its bore)
          const half = (n * pitch) / 2, inUg = under && isUnder;
          rideTrackAt(tr, line, pr, t, k, dir, inUg, kw, left, mid + dir * (half + LOOK_M), RT);
          if (!RT[3] && tr.ot0 && Number.isFinite(tr.fx)) { RT[0] = tr.fx + tr.fhx * LOOK_M; RT[1] = tr.fy + tr.fhy * LOOK_M; }
          tr.lx = RT[0]; tr.ly = RT[1]; tr.lz = RT[2];
          rideTrackAt(tr, line, pr, t, k, dir, inUg, kw, left, mid + dir * (half + 3), RT);
          tr.fz = RT[2];   // the rail under the Cab eye (3 m past the nose)
          rideTrackAt(tr, line, pr, t, k, dir, inUg, kw, left, mid - dir * (half + rideGap), RT);
          if (!RT[3] && tr.otN && Number.isFinite(tr.rx)) { RT[0] = tr.rx - tr.rhx * rideGap; RT[1] = tr.ry - tr.rhy * rideGap; }
          tr.bx = RT[0]; tr.by = RT[1]; tr.bz = RT[2];
          tr.chain = mid; tr.chainDir = dir;   // the train's place on its line (index.js: a jump = a live correction)
        }
        const an = tr.anchor || (tr.anchor = [0, 0, 0]);
        an[0] = ax; an[1] = ay; an[2] = az;
        tr.faint = faint;
        tr.under = isUnder;
        tr.liveShown = live;
      }
    }
    nOpaque = n0;
    nFaint = o - n0;
    nLive = nl;
    if (under) {
      // bores and station boxes in real metres, floored in px with the trains (kw): a bore always holds its train
      UGU.mpp = mpp; UGU.zoom = z; UGU.k = kw;
      // the ride: lift everything by the ridden train's depth (it rides at the ground plane, under MapLibre's camera)
      let lift = 0;
      rideState = null;
      if (ride != null) {
        for (const tr of list) {
          if (tr.id !== ride && tr.run?.key !== ride) continue;
          // lift by the car the camera hangs on (Cab: the head car, Behind: the last car; the eye of THIS frame's
          // matrix says which end it is nearer), not the middle car: on a 3-4 % grade the ends of a 200 m train sit 3-4 m
          // above / below its middle, which put the Cab eye under the head car's rails (Hanzomon at Nagatacho: a view
          // from under the tunnel) and the Behind eye too low or high over the last car
          eyeOf(M64, EYE);
          const dF = Number.isFinite(tr.fx) ? (EYE[0] - tr.fx) ** 2 + (EYE[1] - tr.fy) ** 2 : Infinity;
          const dR = Number.isFinite(tr.rx) ? (EYE[0] - tr.rx) ** 2 + (EYE[1] - tr.ry) ** 2 : Infinity;
          const dM = (EYE[0] - tr.anchor[0]) ** 2 + (EYE[1] - tr.anchor[1]) ** 2;
          let hz = dF < dR && dF < dM ? tr.hz0 : dR < dM ? tr.hzN : tr.hz;
          // the rail level UNDER THE EYE (its point on the train's own way: the eye's distance along the train's heading
          // from its middle car), not under the car it hangs on: the Behind eye rides ~16 m behind the last car's middle,
          // the Cab eye ~11 m ahead of the head car's; on the Oedo's 3-4 % grades that is ~0.5 m, which put the overhead bar
          // under the Behind eye (a dark wedge down the view) and the Cab eye too low or high
          const prE = profiles[tr.line], lnE = lines[tr.line];
          if (prE && lnE && Number.isFinite(tr.hx) && tr.anchor) {
            const tkE = trackOf(lnE), kE = tkE.k || 1, dE = tr.dir < 0 ? -1 : 1;
            const nE = Math.max(1, Math.min(16, tr.cars || lnE.cars || 10)), pE = tr.pitch || CAR_L + CAR_GAP;
            const mA = (Number(tr.s) || 0) * kE + dE * ((nE * pE) / 2 - ((nE >> 1) + 0.5) * pE);   // the middle car (anchor)
            const along = (EYE[0] - tr.anchor[0]) * tr.hx + (EYE[1] - tr.anchor[1]) * tr.hy;
            const hE = Math.min(0, ugZ(prE.at((mA + dE * along) / kE), tieOf[tr.line]));
            if (Number.isFinite(hE)) hz = hE;
          }
          lift = -(Number.isFinite(hz) ? hz : tr.hz || 0);
          st.rideEnd = dF < dR && dF < dM ? 'front' : dR < dM ? 'rear' : 'mid';
          const nc = Math.max(1, Math.min(16, tr.cars || lines[tr.line]?.cars || 10));
          rideState = { id: tr.id, key: tr.run?.key || tr.id, x: tr.anchor[0], y: tr.anchor[1], hx: tr.hx, hy: tr.hy, line: tr.line, under: tr.under,
            len: nc * (tr.pitch || CAR_L + CAR_GAP), height: Hu, fx: tr.fx, fy: tr.fy, fhx: tr.fhx, fhy: tr.fhy, rx: tr.rx, ry: tr.ry,
            lx: tr.lx, ly: tr.ly, lz: Number.isFinite(tr.lz) ? tr.lz + lift : 0, open: !!tr.open,   // look-ahead point, in the open
            bx: tr.bx, by: tr.by, bz: Number.isFinite(tr.bz) ? tr.bz + lift : 0, rz: Number.isFinite(tr.hzN) ? tr.hzN + lift : 0,   // Behind eye point, last car's rail
            fz: Number.isFinite(tr.fz) ? tr.fz + lift : 0, m: tr.chain, dir: tr.chainDir,   // the Cab eye's rail; chain m, direction
            lift };   // the ride's lift (Fly from a ride puts its eye back in the world drawn without it)
          break;
        }
      }
      if (lift) {
        for (let q = 0; q < o; q++) data[q * F + 2] += lift;
        for (const tr of list) if (tr.anchor) tr.anchor[2] += lift;
      }
      UGU.lift = lift;
    }
    st.trains = list.length; st.cars = o; st.underground = nu; st.faint = nFaint; st.live = liveTrains;
    // r3d-b: every SOLID car (instances 0 .. nOpaque) as a real car (trainset.js), LOD by its size on screen; the ridden
    // train always LOD0. Its origin = the car's centre on the rail top (our box sits LIFT / 0.25 m above it).
    if (ts) {
      ts.begin();
      const cssH = map?.getCanvas?.().clientHeight || 800;
      // this frame's eye (local metres, from the matrix MapLibre renders with): a ridden car the eye is inside
      // is not drawn (the Cab eye sits 3 m ahead of the nose from LAST frame's train: a slow frame or a fast playback
      // moves the train past it, and the first Cab frame showed our own car from inside); the shader's view vector too
      eyeOf(M64, EYE);
      let l0 = 0, skipped = 0;
      for (let q = 0; q < nOpaque; q++) {
        const i = q * F, tr = list[cars[q]];
        if (!tr) continue;
        const line = lines[tr.line];
        const spec = carSpec(line.id, tr.run?.type ?? -1, carC[q], carN[q]);
        if (ride != null && (tr.id === ride || tr.run?.key === ride)) {
          const dx = EYE[0] - data[i], dy = EYE[1] - data[i + 1], ux = data[i + 3], uy = data[i + 4];
          const lx = dx * ux + dy * uy, ly = -dx * uy + dy * ux, lz = EYE[2] - (data[i + 2] - (under && tr.under ? 0.25 : 0));
          if (Math.abs(lx) < spec.pitch / 2 + 0.6 && Math.abs(ly) < spec.width / 2 + 0.4 && lz > -0.5 && lz < spec.height + 1.2) { skipped++; continue; }
        }
        const inTube = under && tr.under;
        const zr = data[i + 2] - (inTube ? 0.25 : LIFT * (1 + (Math.min(K_MAX, Math.max(1, MIN_W_PX * mpp / CAR_W)) - 1) * HEIGHT_GAIN));
        const X = data[i], Y = data[i + 1];
        const cw = M64[3] * X + M64[7] * Y + M64[11] * zr + M64[15];
        let lod = lodFor(pxPerMetre(cw, cssH, mpp));
        if (ride != null && (tr.id === ride || tr.run?.key === ride)) lod = 0;
        if (!lod) l0++;
        const sy = data[i + 7] / CAR_W, sz = Math.max(1, data[i + 8] / CAR_H);
        const fl = (data[i + 13] >= 4 ? TSF.PICKED : 0) | (q < nLive ? TSF.LIVE : 0);
        const [r0, g0, b0] = colours[tr.line] || [0.55, 0.57, 0.6];
        ts.push(spec, lod, X, Y, zr, data[i + 3], data[i + 4], data[i + 5], sy, sz, r0, g0, b0, 1, fl, data[i + 14]);
      }
      st.lod0 = l0; st.eyeSkip = skipped;
    }
  }

  function init(g) {
    gl = g;
    if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) { reason = 'webgl2'; return; }
    prog = compile(gl, VS, FS);
    rprog = compile(gl, RVS, RFS);
    qprog = compile(gl, QVS, QFS);
    // cars
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = vbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, boxVerts(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    ibuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    gpuBytes = data.byteLength;
    bindInstances(0);
    for (let a = 2; a <= 6; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribDivisor(a, 1); }
    // ribbons: the underground stretches (underground view) and the elevated ones (surface view)
    const ribbonVao = (rd) => {
      const v = gl.createVertexArray();
      gl.bindVertexArray(v);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, rd.byteLength ? rd : new Float32Array(12), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 48, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 48, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 48, 24);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 48, 32);
      return [v, b];
    };
    const od = ribbonData(net, profiles, 'over');
    ocount = od.length / 12;
    st.rails = ocount / 6;
    [ovao, obuf] = ribbonVao(od);
    // footprints: every underground stretch traced on the street slab (0 m) in its colour, pale: the tube below shows
    // how deep it runs by how far it sits from its own trace (parallax)
    const fd = ribbonData(net, profiles, 'under', 0);
    fcount = fd.length / 12;
    [fvao, fbuf] = ribbonVao(fd);
    try { ts = createTrainsetGL(gl); } catch (e) { ts = null; console.warn('[city3d] trainset', e); }   // null = the boxes
    // the underground in real 3D (underground.js): tunnels, platforms, shafts, the street slab; built once
    try { ug = createUndergroundGL(gl, { net, profiles, depths, tubes: false }); const us = ug.stats(); st.platforms = us.platforms; st.ugBytes = us.bytes; } catch (e) { ug = null; console.warn('[city3d] underground', e); }
    // round 3: the bores (real shapes, per area cell, pooled)
    try { bores = ug ? createBoresGL(gl, { net, profiles, depths, real: opts.real || null, tracks: opts.tracks || null, platforms: opts.platforms || null }) : null; } catch (e) { bores = null; console.warn('[city3d] bores', e); }
    // hub platforms (a station complex with 3+ underground platforms) carry a depth tag: "B2 · −11 m" (the heights build metres)
    if (ug) {
      const per = new Map();
      for (const p of ug.platforms) if (p.group >= 0) per.set(p.group, (per.get(p.group) || 0) + 1);
      hubs = ug.platforms.filter((p) => p.group >= 0 && per.get(p.group) >= 3).map((p) => {
        const line = lines[p.line];
        // "≈": the depth is an estimate (the heights build: one typical depth a line); a sourced depth drops it
        const sv = opts.real?.station?.(p.station) || null;
        const depth = sv && Number.isFinite(sv.depthM) ? sv.depthM : p.depth;
        const est = !sv || sv.conf !== 'sourced';
        const lvl = sv?.level && /^B\d+$/.test(sv.level) ? sv.level : `B${levelOf(depth)}`;
        return { p, code: line?.code ? String(line.code).slice(0, 3) : '', color: line?.color || null, text: `${lvl} · ${est ? '≈' : ''}−${Math.round(-depth)} m`, id: `d${p.line}:${p.station}` };
      });
    }
    // the veil
    qvao = gl.createVertexArray();
    gl.bindVertexArray(qvao);
    qbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qbuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  /** Point the instance attributes at instance `first` (draws of the faint range start there). */
  function bindInstances(first) {
    const B = F * 4, off = first * B;
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, B, off);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, B, off + 12);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, B, off + 24);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, B, off + 36);
    gl.vertexAttribPointer(6, 3, gl.FLOAT, false, B, off + 52);
  }

  function schedule(ms = reduced ? 1000 : FRAME_MS) {
    if (dead || !mode.on || !map || timer) return;
    timer = setTimeout(() => { timer = 0; if (!dead && mode.on) map.triggerRepaint(); }, ms);
  }

  const layer = {
    id: TRAINS3D_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(m, g) { map = m; try { init(g); } catch (e) { reason = 'shader'; console.warn('[city3d] trains', e); } },
    onRemove() {
      if (!gl || reason) return;
      for (const b of [vbuf, ibuf, qbuf, obuf, fbuf]) if (b) gl.deleteBuffer(b);
      for (const v of [vao, qvao, ovao, fvao]) if (v) gl.deleteVertexArray(v);
      for (const p of [prog, rprog, qprog]) if (p) gl.deleteProgram(p.p);
      ug?.destroy(); ug = null; bores?.destroy(); bores = null; ts?.destroy?.(); ts = null;
      gl = null;
    },
    render(g, args) {
      if (!mode.on || reason || !gl || dead) { labels?.clear(); return; }
      const t0 = performance.now();
      const m = args?.defaultProjectionData?.mainMatrix;
      if (!m) return;
      setMatrix(m);
      // the underground view (from UG_MIN_Z; further out index.js shows a "Zoom in" note and the 2D map)
      const ugOn = mode.underground && !!ug && map.getZoom() >= UG_MIN_Z;
      if (mode.underground && !ugOn) { labels?.clear(); st.cars = 0; st.frames++; return; }
      const c = map.getCenter();
      fill(map.getZoom(), c.lat);
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      if (ugOn) {
        // the veil over everything drawn so far (the basemap fades), then the underground on a clean depth buffer:
        // tunnel floors + walls (opaque) now, the trains, then the glass roofs, platforms, shafts and the street slab
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(qprog.p);
        // riding: the street map goes (an even light ground: the ridden line sits at MapLibre's ground plane, so the
        // basemap would cut through it), else the veil
        // (d): out in the open (above ground, an open-air deck) the street shows through a light veil around it
        if (ride != null && rideState) gl.uniform4f(qprog.u.u_c, VEIL[0], VEIL[1], VEIL[2], rideState.open ? 0.3 : 1);
        else gl.uniform4f(qprog.u.u_c, ...VEIL);
        gl.bindVertexArray(qvao);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const cc = map.getCenter();
        toLocal(cc.lng, cc.lat, A);
        UGU.M32 = M32; UGU.light = LIGHT; UGU.cx = A[0]; UGU.cy = A[1]; UGU.zoom = map.getZoom();
        UGU.view[0] = VIEW[0]; UGU.view[1] = VIEW[1]; UGU.view[2] = VIEW[2]; UGU.view[3] = VIEW[3];
        // the free eye inside a bore / station box sees the tunnel from inside (the ride's look), outside the tube
        if (fly && bores) { if (!fly.idx) fly.idx = boreIndex(bores.runs, ug.platforms); eyeIn(fly.idx, EYE[0], EYE[1], EYE[2], UGU.exag, UGU.k, fly); }
        UGU.lining = (ride != null && !!rideState) || !!fly?.inside;   // r3d: riding = inside a real tunnel (concrete, lights, track)
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        bores?.draw(UGU, 'opaque');
      }
      else if (ocount && map.getZoom() >= 13) {
        // the elevated lines' colour along their deck tops (depth-tested: buildings in front hide them)
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.useProgram(rprog.p);
        gl.uniformMatrix4fv(rprog.u.u_m, false, M32);
        gl.uniform2f(rprog.u.u_vp, W, H);
        const dpr = W / Math.max(1, map.getCanvas().clientWidth || W);
        gl.bindVertexArray(ovao);
        gl.uniform1f(rprog.u.u_wref, 0);
        gl.uniform1f(rprog.u.u_zl, 0);
        gl.uniform1f(rprog.u.u_grey, 1); gl.uniform1f(rprog.u.u_pick, pickedLine ?? -9);
        gl.uniform1f(rprog.u.u_w, 1.3 * dpr); gl.uniform1f(rprog.u.u_white, 0);
        gl.drawArrays(gl.TRIANGLES, 0, ocount);
        gl.depthMask(true);
      }
      if (st.cars) {
        gl.useProgram(prog.p);
        gl.uniformMatrix4fv(prog.u.u_m, false, M32);
        gl.uniform3f(prog.u.u_light, LIGHT[0], LIGHT[1], LIGHT[2]);
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        const bytes = st.cars * F * 4;
        if (bytes > 0) {
          // grow the GPU buffer with the CPU one
          if (gpuBytes < data.byteLength) { gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW); gpuBytes = data.byteLength; }
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, st.cars * F);
        }
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.uniform3f(prog.u.u_grow, 0, 0, 0);
        gl.uniform4f(prog.u.u_rim, 0, 0, 0, 0);
        if (nLive && !ts) {
          // the live trains' rims (their cars come first): the car box grown RIM_PX each side in the live green, then a
          // white gap, then the car over both; no depth written, so only the cars themselves hide what is behind
          const out = 2 * (RIM_PX + RIM_GAP_PX) * mppNow, gap = 2 * RIM_GAP_PX * mppNow;   // css px -> m
          gl.depthMask(false);
          bindInstances(0);
          gl.uniform3f(prog.u.u_grow, out, out, out);
          gl.uniform4f(prog.u.u_rim, LIVE_GREEN[0], LIVE_GREEN[1], LIVE_GREEN[2], 1);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, nLive);
          gl.uniform3f(prog.u.u_grow, gap, gap, gap);
          gl.uniform4f(prog.u.u_rim, 1, 1, 1, 1);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, nLive);
          gl.uniform3f(prog.u.u_grow, 0, 0, 0);
          gl.uniform4f(prog.u.u_rim, 0, 0, 0, 0);
        }
        if (nOpaque && !ts) {
          gl.depthMask(true);
          gl.uniform1f(prog.u.u_full, 0);   // round 2: trains in their tubes keep the light roof + dark windows (they read as trains)
          bindInstances(0);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, nOpaque);
        }
        if (nOpaque && ts) {
          // r3d-b: the real cars (trainset.js): live rims first (no depth writes), then the cars
          if (nLive) {
            gl.depthMask(false);
            // trainset's grow is per side (the box program's u_grow was the whole size): RIM_PX + RIM_GAP_PX each side
            ts.drawRims(M32, { light: LIGHT, eye: EYE }, { color: LIVE_GREEN, grow: (RIM_PX + RIM_GAP_PX) * mppNow });
            ts.drawRims(M32, { light: LIGHT, eye: EYE }, { color: [1, 1, 1], grow: RIM_GAP_PX * mppNow });
          }
          gl.depthMask(true);
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
          ts.draw(M32, { light: LIGHT, night: nightFactor(now()), eye: EYE });
          // back to the box program for the faint ghosts
          gl.useProgram(prog.p);
          gl.uniformMatrix4fv(prog.u.u_m, false, M32);
          gl.uniform3f(prog.u.u_light, LIGHT[0], LIGHT[1], LIGHT[2]);
          gl.uniform3f(prog.u.u_grow, 0, 0, 0);
          gl.uniform4f(prog.u.u_rim, 0, 0, 0, 0);
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, ibuf);
        }
        if (nFaint) {
          gl.uniform1f(prog.u.u_full, 0);
          gl.depthMask(false);
          bindInstances(nOpaque);
          gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, nFaint);
          gl.depthMask(true);
        }
      }
      if (ugOn) {
        gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
        bores?.draw(UGU, 'glass');
        // inside a tunnel no street (its closed crown); under the street the street is a ceiling: the slab
        // and the footprints depth-tested (a tube in front hides them), a little stronger
        UGU.street = !(ride != null && rideState) && !fly?.inside;
        UGU.ceiling = !!fly && EYE[2] < 0;
        ug.drawTop(UGU);
        if (fcount && map.getZoom() >= 13.5 && UGU.street) {
          // the footprints on the slab, over it (it is the street's own trace), thin and pale
          if (UGU.ceiling) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
          gl.useProgram(rprog.p);
          gl.uniformMatrix4fv(rprog.u.u_m, false, M32);
          gl.uniform2f(rprog.u.u_vp, W, H);
          gl.uniform1f(rprog.u.u_wref, 0);
          gl.uniform1f(rprog.u.u_zl, UGU.lift);
          gl.uniform1f(rprog.u.u_grey, 0); gl.uniform1f(rprog.u.u_pick, -9);
          gl.uniform1f(rprog.u.u_w, (UGU.ceiling ? 2.2 : 1.1) * (W / Math.max(1, map.getCanvas().clientWidth || W)));
          gl.uniform1f(rprog.u.u_white, UGU.ceiling ? 0.2 : 0.55);
          gl.bindVertexArray(fvao);
          gl.drawArrays(gl.TRIANGLES, 0, fcount);
        }
      }
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      st.frames++;
      st.ms = Math.round((performance.now() - t0) * 100) / 100;
      let extras = null;
      if (ugOn && labels) {
        // the depth scale (the map's centre at 0 .. -40 m) and the hub platforms' depth tags, in NDC for labels.js
        const ndc = (X, Y, Z, out) => {
          const cw = M64[3] * X + M64[7] * Y + M64[11] * Z + M64[15];
          if (cw <= 0) return false;
          out.nx = (M64[0] * X + M64[4] * Y + M64[8] * Z + M64[12]) / cw; out.ny = (M64[1] * X + M64[5] * Y + M64[9] * Z + M64[13]) / cw;
          return out.nx > -1.05 && out.nx < 1.05 && out.ny > -1.05 && out.ny < 1.05;
        };
        RULER.length = 0;
        if (ride == null && !fly) for (const d of [0, 10, 20, 30, 40]) { const r = { d, nx: 0, ny: 0 }; if (ndc(UGU.cx, UGU.cy, ugZ(-d, 0), r)) RULER.push(r); }
        TAGS.length = 0;
        if (map.getZoom() >= 14.6 && !fly?.inside) {
          for (const hb of hubs) {
            const p = hb.p;
            if (p.x < VIEW[0] || p.x > VIEW[2] || p.y < VIEW[1] || p.y > VIEW[3]) continue;
            const o = { id: hb.id, nx: 0, ny: 0, text: hb.text, code: hb.code, color: hb.color };
            if (ndc(p.x, p.y, (p.h < 0 ? p.h * UGU.exag : p.h) + 8 * UGU.k + UGU.lift, o)) TAGS.push(o);
          }
          // nearest the camera first (bigger on screen)
          TAGS.sort((a, b) => a.ny - b.ny);
        }
        if (fly) { GAUGE.z = EYE[2]; GAUGE.exag = UGU.exag; }   // the eye's depth (labels.js's gauge) instead of the ruler
        extras = { ruler: RULER, tags: TAGS, gauge: fly ? GAUGE : null };
      }
      // inside a tunnel only its own line's trains are named (the others are behind its walls)
      let named = trains;
      if (fly?.inside) { FLYT.length = 0; for (const t of trains) if (t.line === fly.line) FLYT.push(t); named = FLYT; }
      if (labels) labels.draw(named, M64, map, mode, selected, extras);
      // moving trains want frames; with none on screen, a look once a second (a train may come into view); at city zoom
      // (2D trainsets, which ask for their own frames) none
      if (st.cars) schedule();
      else if (mode.trains || mode.underground) schedule(1000);
    },
  };

  return {
    layer,
    setMode(next = {}) {
      mode = { ...mode, ...next };
      if (!mode.on) labels?.clear();
      map?.triggerRepaint();
    },
    setSource(fn) { if (typeof fn === 'function') source = fn; map?.triggerRepaint(); },
    setSelected(id) { selected = id ?? null; map?.triggerRepaint(); },
    /** The underground's depth scale: UG_EXAG (default) or 1 (true scale: real proportions, no px floors). */
    setExag(e) { UGU.exag = e === 1 ? 1 : UG_EXAG_3D; mode = { ...mode, exag: UGU.exag }; map?.triggerRepaint(); },
    /** Ride along a train (run id or key; null = stop). */
    setRide(id) { ride = id ?? null; if (ride == null) { rideState = null; UGU.lift = 0; } map?.triggerRepaint(); },
    /** The ride's Behind eye: metres behind the ridden train's tail, on its own track (rideState().bx, by). */
    setRideGap(m) { if (Number.isFinite(m) && m > 0) rideGap = m; },
    /** The ridden train as of the last frame: { id, key, x, y (local m), hx, hy (heading), line } | null. */
    rideState: () => rideState,
    /** the free camera on / off (a view box around its eye, the eye among the bores, the depth gauge). */
    setFly(on) { fly = on ? (fly || { idx: null, inside: false, dist: Infinity, line: -1 }) : null; map?.triggerRepaint(); },
    /** { inside, dist (m to the nearest bore), line } as of the last frame drawn; null when not flying. */
    flyInfo: () => fly,
    /** The underground trains in view as of the last frame (for "Ride a train"): [{ id, key, x, y, live }]. */
    undergroundTrains: () => trains.filter((t) => t.under && !t.faint).map((t) => ({ id: t.id, key: t.run?.key || t.id, x: t.anchor?.[0], y: t.anchor?.[1], live: !!t.liveShown })),
    /** The line whose deck-top rails wear its colour (index, or null: every line calm grey). */
    setLine(i) { pickedLine = Number.isInteger(i) ? i : null; map?.triggerRepaint(); },
    setReduced(on) { reduced = !!on; },
    /** The train under a screen point (css px, map canvas), from the last frame: { id, run, line } or null. */
    pick(x, y, radius = 22) {
      if (!mode.on || !st.cars) return null;
      const el = map?.getCanvas();
      const Wc = el?.clientWidth || 1, Hc = el?.clientHeight || 1;
      let best = null, bd = radius * radius;
      for (let o = 0; o < st.cars; o++) {
        const i = o * F;
        if (data[i + 12] < 0.5) continue;   // faint cars are not tappable
        const X = data[i], Y = data[i + 1], Z = data[i + 2] + data[i + 8] / 2;
        const cw = M64[3] * X + M64[7] * Y + M64[11] * Z + M64[15];
        if (cw <= 0) continue;
        const cx = (M64[0] * X + M64[4] * Y + M64[8] * Z + M64[12]) / cw, cy = (M64[1] * X + M64[5] * Y + M64[9] * Z + M64[13]) / cw;
        const sx = (cx + 1) / 2 * Wc, sy = (1 - cy) / 2 * Hc;
        const d = (sx - x) ** 2 + (sy - y) ** 2;
        if (d < bd) { bd = d; best = trains[cars[o]]; }
      }
      return best ? { id: best.id, run: best.run ?? null, line: best.line } : null;
    },
    stats: () => ({ ...st, reason, mode: { ...mode }, bores: bores?.stats() || null, ride: ride != null }),
    /** Where a running train is now (any train the source gives, in view or not): { x, y, hx, hy, line } | null. */
    locate(id) {
      const all = allLast.length ? allLast : (source(now()) || []);
      for (const tr of all) {
        if (tr.id !== id && tr.run?.key !== id) continue;
        const line = lines[tr.line];
        if (!line) return null;
        const t = trackOf(line), Q = [0, 0, 1, 0];
        pointAt(t, (Number(tr.s) || 0) * (t.k || 1), Q);
        const d = tr.dir < 0 ? -1 : 1;
        return { x: Q[0], y: Q[1], hx: Q[2] * d, hy: Q[3] * d, line: tr.line };
      }
      return null;
    },
    reason: () => reason,
    destroy() {
      dead = true;
      clearTimeout(timer);
      labels?.clear();
    },
  };
}
