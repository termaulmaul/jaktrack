// 3D view: the underground as real 3D, so depth reads at a glance. The calm light look, colour only on data.
//
//   - Tunnels: every underground stretch of every line is a tube with a box section (floor, two walls, a glass roof), at
//     its line's depth from the heights build (elev-v1.json) drawn UG_EXAG times deeper, so a -11 m line and a -21 m line stack 50 m
//     apart on screen. Walls opaque (the line colour, shaded: lit side brighter), the roof see-through (the trains run
//     inside and show through it). Lines the heights build gives the same depth get a small tie offset (TIE_M a rank) so they never
//     share a level (Jimbocho: Mita and Shinjuku). Joins are mitred; ramps follow the profile (subdivided).
//   - Platforms: a light box per underground platform (tinted by its line), wider and taller than the tube, and a
//     see-through shaft from it up to the street slab. Hub stations get a depth tag (labels.js): "B2 · -11 m" (the heights build
//     metres, not the drawn ones).
//   - The ground: a light see-through slab at 0 m around the camera with a faint 250 m grid that fades out towards its
//     edge, over a veil that fades the basemap, so you look DOWN THROUGH the street at the levels below.
//   - Depth fog: deeper is a little paler (at most FOG_MAX at 45 m).
// Geometry is built ONCE for the whole network (static buffers, ~3 MB); per frame only uniforms change (sizes floor at
// a few px, so a tube stays visible at city zoom).
//
// export const UG_EXAG, TIE_M, UG_MIN_Z
// export function lineDepths(net, profiles) -> { nominal: Float32Array (m, < 0 or 0), tie: Float32Array (m) }
// export function drawnZ(h, tie) -> drawn metres (h < 0: (h - tie) x UG_EXAG; above ground unchanged)
// export function tunnelMesh(net, profiles, tie) -> { corners: Float32Array (CF floats each), index: Uint32Array, nBase, nTop }
// export function platformList(net, profiles, tie) -> [{ x, y, z, ux, uy, line, station, group, depth }]
// export function levelOf(depth) -> 1.. (B1, B2 ...) from the heights build metres
// export function createUndergroundGL(gl, { net, profiles }) -> { drawBase(u), drawTop(u), platforms, tie, stats(), destroy() }

import { trackOf, pointAt } from './track.js';

/** The underground view draws depth this many times deeper than the heights build's metres (levels 1-10 m apart are 1-6 px apart
 * on a phone otherwise); heights above ground stay true. */
export const UG_EXAG = 5;
/** Lines the heights build puts at the same depth (0.5 m bins) get this much (m) more depth per rank, so they never share a level. */
export const TIE_M = 1.2;
/** Below this zoom the underground draws nothing (a calm "Zoom in" note instead; index.js). */
export const UG_MIN_Z = 12.5;
export const UNDER_M = -2;
export const FOG_MAX = 0.16, FOG_M = 45;
export const TUBE_W = 8, TUBE_H = 4.6, PLAT_L = 150;
export const SLAB_R = 4200, GRID_M = 250;
export const SLAB = [0.972, 0.975, 0.981];
const CF = 9;   // floats per tunnel corner: x, y, zRail, mx, my, side (-1|1), top (0|1), rgb packed, depth (the heights build m)

const pack = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); return m ? parseInt(m[1], 16) : 0x8c8c94; };

/** Per line: its nominal underground depth (the most common 0.5 m bin along its underground vertices) and a tie
 * offset (m) for lines that share a nominal depth (rank by line index). */
export function lineDepths(net, profiles) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const nominal = new Float32Array(lines.length), tie = new Float32Array(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const pr = profiles[i];
    if (!pr || !(pr.min < UNDER_M)) continue;
    const t = trackOf(lines[i]);
    const k = t.k || 1;
    const bins = new Map();
    for (let v = 0; v < t.n; v++) {
      const h = pr.at(t.cum[v] / k);
      if (!(h < UNDER_M)) continue;
      const b = Math.round(h * 2) / 2;
      bins.set(b, (bins.get(b) || 0) + 1);
    }
    let best = 0, bn = 0;
    for (const [b, n] of bins) if (n > bn || (n === bn && b < best)) { best = b; bn = n; }
    nominal[i] = best;
  }
  const seen = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!(nominal[i] < 0)) continue;
    const r = seen.get(nominal[i]) || 0;
    tie[i] = r * TIE_M;
    seen.set(nominal[i], r + 1);
  }
  return { nominal, tie };
}

/** Drawn rail level (m) for a true height h (the heights build, m) on a line with tie offset `tie` (m): underground x UG_EXAG (the
 * tie fades in over the first 6 m below a portal, so ramps stay continuous); above ground unchanged. */
export function drawnZ(h, tie = 0) {
  if (!(h < 0)) return h;
  return (h - tie * Math.min(1, -h / 6)) * UG_EXAG;
}

/** B-level from the heights build metres: B1 to -8 m, then about 5 m a level (Marunouchi -11 B2, Tozai -15 B3, Oedo -28 B5). */
export const levelOf = (depth) => Math.max(1, Math.round((Math.abs(depth) - 1) / 5));

/** The tunnels as one indexed mesh: 4 corners per path vertex of every underground run (mitred), floor + walls first
 * (nBase indices), then the roofs (nTop). Ramps are subdivided so the tube follows the profile. */
export function tunnelMesh(net, profiles, tie) {
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const corners = [], base = [], top = [];
  let nc = 0;
  for (let i = 0; i < lines.length; i++) {
    const pr = profiles[i];
    if (!pr || !(pr.min < UNDER_M)) continue;
    const line = lines[i], t = trackOf(line), k = t.k || 1, col = pack(line.color), ti = tie ? tie[i] : 0;
    // the run's points: [x, y, h, m] with ramp subdivisions; a run = consecutive segments with an end below UNDER_M
    let run = [];
    const flush = () => {
      if (run.length >= 2) emit(run);
      run = [];
    };
    const emit = (pts) => {
      const n = pts.length, first = nc;
      for (let v = 0; v < n; v++) {
        // mitred normal at this point (unit normal of the way, averaged at a bend, 1 / cos of half the turn)
        const a = pts[Math.max(0, v - 1)], b = pts[Math.min(n - 1, v + 1)];
        let nx = 0, ny = 0;
        if (v > 0) { const dx = pts[v][0] - a[0], dy = pts[v][1] - a[1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
        if (v < n - 1) { const dx = b[0] - pts[v][0], dy = b[1] - pts[v][1], l = Math.hypot(dx, dy) || 1; nx += -dy / l; ny += dx / l; }
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        // the miter grows by 1 / cos(half turn) (capped): against the next segment's normal
        let cosH = 1;
        if (v > 0 && v < n - 1) {
          const dx = b[0] - pts[v][0], dy = b[1] - pts[v][1], ll = Math.hypot(dx, dy) || 1;
          cosH = Math.max(0.45, nx * (-dy / ll) + ny * (dx / ll));
        }
        const mx = nx / cosH, my = ny / cosH;
        const h = pts[v][2];
        const z = Math.min(0, drawnZ(h, ti));
        const dep = h;
        for (const [side, up] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
          corners.push(pts[v][0], pts[v][1], z, mx, my, side, up, col, dep);
        }
        nc += 4;
      }
      for (let v = 0; v + 1 < n; v++) {
        const a0 = first + v * 4, b0 = a0 + 4;
        // corners 0 (-1, floor), 1 (+1, floor), 2 (+1, roof), 3 (-1, roof)
        base.push(a0, a0 + 1, b0 + 1, a0, b0 + 1, b0);                 // floor
        base.push(a0 + 1, a0 + 2, b0 + 2, a0 + 1, b0 + 2, b0 + 1);     // right wall
        base.push(a0 + 3, a0, b0, a0 + 3, b0, b0 + 3);                 // left wall
        top.push(a0 + 3, a0 + 2, b0 + 2, a0 + 3, b0 + 2, b0 + 3);      // roof (glass)
      }
    };
    for (let v = 0; v + 1 < t.n; v++) {
      const m0 = t.cum[v], m1 = t.cum[v + 1];
      const h0 = pr.at(m0 / k), h1 = pr.at(m1 / k);
      if (!(h0 < UNDER_M || h1 < UNDER_M)) { flush(); continue; }
      const len = m1 - m0;
      const parts = Math.abs(h1 - h0) > 0.5 ? Math.max(1, Math.min(24, Math.ceil(len / 40))) : 1;
      if (!run.length) run.push([t.x[v], t.y[v], h0, m0]);
      for (let j = 1; j <= parts; j++) {
        const f = j / parts, m = m0 + len * f;
        run.push([t.x[v] + (t.x[v + 1] - t.x[v]) * f, t.y[v] + (t.y[v + 1] - t.y[v]) * f, j === parts ? h1 : pr.at(m / k), m]);
      }
    }
    flush();
  }
  const index = new Uint32Array(base.length + top.length);
  index.set(base, 0);
  index.set(top, base.length);
  return { corners: new Float32Array(corners), index, nBase: base.length, nTop: top.length, corner: CF };
}

/** Every underground platform: its place, its way (unit), its drawn rail level, the heights build depth, line, station, group. */
export function platformList(net, profiles, tie) {
  const out = [];
  const lines = Array.isArray(net?.lines) ? net.lines : [];
  const st = Array.isArray(net?.stations) ? net.stations : [];
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
      const s = line.stations[k];
      const ti = tie ? tie[i] : 0;
      out.push({ x: P[0], y: P[1], z: drawnZ(h, ti), h: h - ti * Math.min(1, -h / 6), ux: P[2], uy: P[3], line: i, station: s, group: st[s]?.group ?? -1, depth: h, color: line.color, len: Math.max(120, Math.min(260, (line.cars || 10) * 20 + 20)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- GL
const TVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_c;     // rail point (local m, drawn depth)
layout(location=1) in vec2 a_m;     // mitred normal (xy)
layout(location=2) in vec2 a_k;     // side (-1 | 1), roof (0 | 1)
layout(location=3) in vec2 a_cd;    // rgb packed, the heights build depth (m)
uniform mat4 u_m;
uniform vec2 u_size;                // half width, height (m, drawn)
out vec3 v_p; out vec3 v_col; out float v_dep;
void main() {
  vec3 p = vec3(a_c.xy + a_m * a_k.x * u_size.x, a_c.z - 0.3 + a_k.y * (u_size.y + 0.3));
  v_p = p;
  float c = a_cd.x;
  v_col = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0;
  v_dep = a_cd.y;
  gl_Position = u_m * vec4(p, 1.0);
}`;
const TFS = `#version 300 es
precision highp float;
in vec3 v_p; in vec3 v_col; in float v_dep;
uniform vec3 u_light; uniform vec3 u_fog; uniform float u_roof; uniform float u_flip;
out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(v_p), dFdy(v_p))) * u_flip;
  float fog = clamp(-v_dep / ${FOG_M.toFixed(1)}, 0.0, 1.0) * ${FOG_MAX.toFixed(3)};
  vec3 col;
  float a = 1.0;
  if (u_roof > 0.5) {
    // the glass roof: the line's colour, see-through (the trains inside show), a little lighter at its edges? no: flat
    col = v_col; a = 0.15;
  } else if (abs(n.z) > 0.6) {
    col = v_col * 0.74;                                   // the floor (seen through the roof): darker, so the trains read
  } else {
    float lit = abs(dot(normalize(vec3(n.xy, 0.0)), normalize(vec3(u_light.xy, 0.0))));
    col = v_col * (0.64 + 0.32 * lit);                    // walls: shaded, lit side brighter
  }
  col = mix(col, u_fog, fog);
  o = vec4(col * a, a);
}`;
// platforms and shafts: instanced unit boxes (x -0.5..0.5 along the way, y across, z 0..1)
const BVS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 i_c;     // x, y, TRUE rail level (m, tie included)
layout(location=3) in vec2 i_u;     // way (unit)
layout(location=4) in vec3 i_cd;    // rgb packed, the heights build depth, station length (m)
uniform mat4 u_m;
uniform vec3 u_size;                // platform: -, width, height (m, x u_k); shaft: side, side, -
uniform float u_shaft;              // 1: from the station box's top up to the street (u_lift)
uniform float u_exag; uniform float u_k; uniform float u_lift;
out vec3 v_col; out vec3 v_n; out float v_dep;
void main() {
  vec3 s = vec3(i_cd.z, u_size.y * u_k, u_size.z * u_k);
  float zr = i_c.z * u_exag + u_lift;
  float z0 = zr - 1.0 * u_k, h = s.z;
  if (u_shaft > 0.5) { s = vec3(u_size.x * u_k, u_size.x * u_k, 1.0); z0 = zr + (u_size.z - 1.0) * u_k; h = max(0.0, u_lift - z0); }
  vec3 p = vec3(a_pos.x * s.x, a_pos.y * s.y, z0 + a_pos.z * h);
  float c = i_u.x, sn = i_u.y;
  vec3 w = vec3(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z);
  gl_Position = u_m * vec4(i_c.xy + w.xy, w.z, 1.0);
  v_n = vec3(c * a_nrm.x - sn * a_nrm.y, sn * a_nrm.x + c * a_nrm.y, a_nrm.z);
  float cc = i_cd.x;
  v_col = vec3(floor(cc / 65536.0), mod(floor(cc / 256.0), 256.0), mod(cc, 256.0)) / 255.0;
  v_dep = i_cd.y;
}`;
const BFS = `#version 300 es
precision highp float;
in vec3 v_col; in vec3 v_n; in float v_dep;
uniform vec3 u_light; uniform vec3 u_fog; uniform float u_shaft;
out vec4 o;
void main() {
  vec3 n = normalize(v_n);
  float lit = max(dot(n, u_light), 0.0);
  vec3 col; float a;
  if (u_shaft > 0.5) { col = vec3(0.80, 0.81, 0.84) * (0.86 + 0.14 * lit); a = 0.30; }
  else {
    col = mix(vec3(1.0), v_col, 0.30) * (n.z > 0.5 ? 1.0 : 0.82 + 0.16 * lit);   // a light platform, tinted by its line
    a = n.z > 0.5 ? 0.62 : 0.78;
  }
  float fog = clamp(-v_dep / ${FOG_M.toFixed(1)}, 0.0, 1.0) * ${FOG_MAX.toFixed(3)};
  col = mix(col, u_fog, fog);
  o = vec4(col * a, a);
}`;
// the street slab: one quad at 0 m around the camera; see-through, a faint grid, fading out to its edge
const SVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_xy;    // -1..1
uniform mat4 u_m; uniform vec3 u_c; // centre x, y, half size (m)
uniform float u_lift;
out vec2 v_w; out vec2 v_q;
void main() {
  v_q = a_xy;
  v_w = u_c.xy + a_xy * u_c.z;
  gl_Position = u_m * vec4(v_w, u_lift, 1.0);
}`;
const SFS = `#version 300 es
precision highp float;
in vec2 v_w; in vec2 v_q;
uniform vec3 u_slab; uniform float u_alpha; uniform float u_grid;
out vec4 o;
void main() {
  float r = length(v_q);
  float edge = 1.0 - smoothstep(0.55, 1.0, r);           // the slab fades out towards its rim: a plane, not a wall
  vec2 g = v_w / u_grid;
  vec2 fw = max(fwidth(g), vec2(1e-5));
  vec2 gl = abs(fract(g - 0.5) - 0.5) / fw;
  float line = 1.0 - min(min(gl.x, gl.y), 1.0);
  float a = (u_alpha + line * 0.16) * edge;
  vec3 col = mix(u_slab, vec3(0.55, 0.57, 0.62), line * 0.75);
  o = vec4(col * a, a);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`city3d underground shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`city3d underground link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** The unit box (x, y -0.5..0.5, z 0..1): 36 vertices, position + normal. */
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

export function createUndergroundGL(gl, { net, profiles, depths = null, tubes = true }) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const { nominal, tie } = depths || lineDepths(net, profiles);
  // round 3: the bores (bores.js) replace these tubes; tubes: false builds none (no GPU memory for them)
  const mesh = tubes ? tunnelMesh(net, profiles, tie) : { corners: new Float32Array(0), index: new Uint32Array(0), nBase: 0, nTop: 0 };
  const platforms = platformList(net, profiles, tie);
  const tprog = compile(gl, TVS, TFS), bprog = compile(gl, BVS, BFS), sprog = compile(gl, SVS, SFS);
  const bufs = [], vaos = [];
  const buf = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); bufs.push(b); return b; };
  const vao = () => { const v = gl.createVertexArray(); gl.bindVertexArray(v); vaos.push(v); return v; };
  // tunnels
  const tvao = vao();
  buf(gl.ARRAY_BUFFER, mesh.corners.byteLength ? mesh.corners : new Float32Array(CF));
  const S = CF * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, S, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 20);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, S, 28);
  buf(gl.ELEMENT_ARRAY_BUFFER, mesh.index.byteLength ? mesh.index : new Uint32Array(3));
  // platforms (and shafts: the same instances)
  const pd = new Float32Array(platforms.length * 8);
  platforms.forEach((p, i) => { pd.set([p.x, p.y, p.h, p.ux, p.uy, pack(p.color), p.depth, p.len], i * 8); });
  const bvao = vao();
  buf(gl.ARRAY_BUFFER, boxVerts());
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  buf(gl.ARRAY_BUFFER, pd.byteLength ? pd : new Float32Array(8));
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 32, 12); gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 3, gl.FLOAT, false, 32, 20); gl.vertexAttribDivisor(4, 1);
  // slab
  const svao = vao();
  buf(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  const bytes = mesh.corners.byteLength + mesh.index.byteLength + pd.byteLength;
  const st = { corners: mesh.corners.length / CF, triangles: (mesh.nBase + mesh.nTop) / 3, platforms: platforms.length, bytes, buildMs: 0, flip: 1 };
  st.buildMs = Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0);

  // u: { M32, light: [x, y, z], hw, th (tube half width, height, m), pl, pw, ph (platform), sw (shaft side), cx, cy, zoom }
  function tubes(u, roof) {
    gl.useProgram(tprog.p);
    gl.uniformMatrix4fv(tprog.u.u_m, false, u.M32);
    gl.uniform2f(tprog.u.u_size, u.hw, u.th);
    gl.uniform3f(tprog.u.u_light, u.light[0], u.light[1], u.light[2]);
    gl.uniform3f(tprog.u.u_fog, SLAB[0], SLAB[1], SLAB[2]);
    gl.uniform1f(tprog.u.u_roof, roof ? 1 : 0);
    gl.uniform1f(tprog.u.u_flip, st.flip);
    gl.bindVertexArray(tvao);
    if (roof) gl.drawElements(gl.TRIANGLES, mesh.nTop, gl.UNSIGNED_INT, mesh.nBase * 4);
    else gl.drawElements(gl.TRIANGLES, mesh.nBase, gl.UNSIGNED_INT, 0);
  }
  function boxes(u, shaft) {
    if (!platforms.length) return;
    gl.useProgram(bprog.p);
    gl.uniformMatrix4fv(bprog.u.u_m, false, u.M32);
    gl.uniform3f(bprog.u.u_light, u.light[0], u.light[1], u.light[2]);
    gl.uniform3f(bprog.u.u_fog, SLAB[0], SLAB[1], SLAB[2]);
    gl.uniform1f(bprog.u.u_shaft, shaft ? 1 : 0);
    gl.uniform1f(bprog.u.u_exag, u.exag); gl.uniform1f(bprog.u.u_k, u.k); gl.uniform1f(bprog.u.u_lift, u.lift || 0);
    // station boxes in real metres (x u_k): 20 m wide (two tracks + an island), 8 m high from 1 m under the rail; shafts
    // 5 m square from the box's top (7 m over the rail) to the street
    if (shaft) gl.uniform3f(bprog.u.u_size, 5, 5, 8);
    else gl.uniform3f(bprog.u.u_size, 0, 20, 8);
    gl.bindVertexArray(bvao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, platforms.length);
  }
  function slab(u) {
    gl.useProgram(sprog.p);
    gl.uniformMatrix4fv(sprog.u.u_m, false, u.M32);
    const cx = Math.round(u.cx / GRID_M) * GRID_M, cy = Math.round(u.cy / GRID_M) * GRID_M;
    gl.uniform3f(sprog.u.u_c, cx, cy, u.slabR || SLAB_R);
    // from under the street, a ceiling: its underside a light concrete grey, a 50 m grid
    if (u.ceiling) gl.uniform3f(sprog.u.u_slab, 0.84, 0.85, 0.87); else gl.uniform3f(sprog.u.u_slab, SLAB[0], SLAB[1], SLAB[2]);
    gl.uniform1f(sprog.u.u_alpha, u.ceiling ? 0.5 : 0.2);
    gl.uniform1f(sprog.u.u_grid, u.ceiling ? GRID_M / 5 : GRID_M);
    gl.uniform1f(sprog.u.u_lift, u.lift || 0);
    gl.bindVertexArray(svao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return {
    platforms, tie, nominal,
    /** The opaque part: tunnel floors and walls (depth written). */
    drawBase(u) {
      if (!mesh.nBase) return;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      tubes(u, false);
    },
    /** The see-through part, after the trains: glass roofs, platforms, shafts, then the street slab over them all. */
    drawTop(u) {
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
      if (mesh.nTop) tubes(u, true);
      if (u.zoom >= 13.5 && !u.lining) { boxes(u, false); if (u.street !== false) boxes(u, true); }   // riding: real platforms instead
      // seen from under the street the slab is depth-tested (a tube in front of it hides it)
      if (u.ceiling) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
      if (u.street !== false) slab(u);
      gl.depthMask(true);
    },
    setFlip(f) { st.flip = f < 0 ? -1 : 1; },
    stats: () => ({ ...st }),
    destroy() {
      for (const b of bufs) gl.deleteBuffer(b);
      for (const v of vaos) gl.deleteVertexArray(v);
      for (const p of [tprog, bprog, sprog]) gl.deleteProgram(p.p);
      bufs.length = 0; vaos.length = 0;
    },
  };
}
