// Toei buses: the bus layer, a MapLibre custom WebGL layer ported from trafik.live's bus map: one instanced draw for every bus chip (dot when far, a rounded chip with a heading pointer
// and the route code when close), short mitered trail ribbons (WebGL2) and a soft halo under the picked bus.
// Positions are offsets from a fixed origin in central Tokyo (util.js ORIGIN), so chips don't shiver at street zoom.
// Tokyo changes: layer id 'tokyo-buses' (drawn UNDER the trains: page.js adds it before 'tokyo-trains'), a little
// smaller and calmer than Jakarta's (buses are the second layer here), chips from z13.2.
//
import { MPU, clamp, lerp, smooth } from './util.js';
import { ORIGIN, TRAIL_K, TRAIL_DT, TRAIL_TEX_W } from './store.js';

const TRAIL_SEGS = 16; // ring rows a trail spans at full detail (x TRAIL_DT = ~24 s)

const CHIP_VS = `
precision highp float;
attribute vec2 a_corner;
attribute vec4 a_dyn;
attribute vec4 a_info;
attribute vec4 a_col;
attribute vec4 a_tcol;
uniform mat4 u_matrix;
uniform vec2 u_view;
uniform vec4 u_size;   // dot radius, chip radius, pointer length, chip mix
uniform vec4 u_misc;   // label mix, focus mix, pass, atlas columns
uniform vec2 u_cell;   // atlas cell (css px)
varying vec2 v_p;
varying vec4 v_col;
varying vec3 v_tcol;
varying vec4 v_box;    // half width, half height, pointer on, label on
varying vec4 v_ptr;    // dir, apex distance, base distance
varying vec4 v_lbl;    // cell origin (css px), label width, pointer half width
varying float v_chip;
float bit(float f, float b) { return mod(floor(f / b + 0.001), 2.0); }
float edgeDist(vec2 d, float hw, float hh) {
  float a = max(hw - hh, 0.0);
  float ady = abs(d.y);
  if (ady > 1e-4) { float t = hh / ady; if (abs(d.x) * t <= a) return t; }
  vec2 c = vec2(d.x >= 0.0 ? a : -a, 0.0);
  float b = dot(d, c);
  return b + sqrt(max(b * b - dot(c, c) + hh * hh, 0.0));
}
void main() {
  float flags = a_info.w;
  float stale = bit(flags, 1.0), idle = bit(flags, 2.0), dim = bit(flags, 8.0);
  float sel = bit(flags, 16.0), hasH = bit(flags, 32.0), hasL = bit(flags, 64.0);
  float pres = a_dyn.w;
  float focus = u_misc.y;
  float pass = sel > 0.5 ? 2.0 : (dim > 0.5 && focus > 0.001 ? 0.0 : 1.0);
  vec4 c0 = u_matrix * vec4(a_dyn.xy, 0.0, 1.0);
  if (pres < 0.003 || abs(pass - u_misc.z) > 0.5 || c0.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 hv = vec2(sin(a_dyn.z), -cos(a_dyn.z)) * 2.0e-7;
  vec4 c1 = u_matrix * vec4(a_dyn.xy + hv, 0.0, 1.0);
  vec2 d = (c1.xy / c1.w - c0.xy / c0.w) * vec2(0.5, -0.5) * u_view;
  float dl = length(d);
  d = dl > 1e-6 ? d / dl : vec2(0.0, -1.0);
  float chip = u_size.w;
  float kind = floor(a_col.w * 255.0 + 0.5);
  float kscale = abs(kind - 2.0) < 0.5 ? mix(0.8, 0.9, chip) : 1.0;
  float dimS = mix(mix(1.0, 1.14, focus), mix(1.0, 0.8, focus), dim);
  float popS = 0.55 + 0.45 * pres;
  float idleS = mix(1.0, 0.7, idle);
  float hh = mix(u_size.x, u_size.y, chip) * kscale * dimS * popS * idleS;
  float lab = u_misc.x * hasL * (1.0 - idle);
  float lw = a_info.z;
  float hw = mix(hh, max(hh, lw * 0.5 + 5.0), lab);
  float ptrOn = chip * hasH * (1.0 - idle);
  float ptrLen = u_size.z * dimS * popS;
  float e = edgeDist(d, hw, hh);
  v_ptr = vec4(d, e + ptrLen * ptrOn, e - 1.5);
  vec2 ext = vec2(hw, hh) + ptrLen * ptrOn + 4.5 + hh * 2.1 * (1.0 - chip);
  v_p = a_corner * ext;
  gl_Position = c0 + vec4(a_corner * ext * 2.0 / u_view * vec2(1.0, -1.0) * c0.w, 0.0, 0.0);
  vec3 col = mix(a_col.rgb, vec3(0.63, 0.62, 0.68), idle);
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(lum), 0.45 * stale);
  v_col = vec4(col, pres * mix(1.0, 0.42, stale) * mix(1.0, mix(1.0, 0.15, focus), dim));
  v_tcol = a_tcol.rgb;
  v_box = vec4(hw, hh, ptrOn, lab);
  float idx = max(a_info.y, 0.0);
  float row = floor(idx / u_misc.w + 0.001);
  float colI = idx - row * u_misc.w;
  v_lbl = vec4(colI * u_cell.x, row * u_cell.y, lw, min(hh * 0.68, 5.4));
  v_chip = chip;
}`;

const CHIP_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_atlas;
uniform vec2 u_atlasSize;  // atlas px
uniform vec3 u_atlasP;     // atlas px per css px, sdf edge softness, text pad (css px)
uniform vec2 u_cellF;      // atlas cell (css px); the vertex stage has its own u_cell
uniform float u_aa;
varying vec2 v_p;
varying vec4 v_col;
varying vec3 v_tcol;
varying vec4 v_box;
varying vec4 v_ptr;
varying vec4 v_lbl;
varying float v_chip;
float sdRoundBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + vec2(r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
void main() {
  vec2 p = v_p;
  float hw = v_box.x, hh = v_box.y, ptrOn = v_box.z, lab = v_box.w;
  float d = sdRoundBox(p, vec2(hw, hh), hh);
  if (ptrOn > 0.01) {
    vec2 dir = v_ptr.xy;
    vec2 pr = vec2(-dir.y, dir.x);
    float pw = v_lbl.w * ptrOn;
    vec2 apex = dir * v_ptr.z;
    vec2 bc = dir * v_ptr.w;
    d = smin(d, sdTri(p, bc + pr * pw, apex, bc - pr * pw), 1.6);
  }
  float aa = u_aa;
  float cov = smoothstep(aa, -aa, d);
  float ow = mix(1.25, 1.6, v_chip);
  float fill = smoothstep(aa, -aa, d + ow);
  vec3 c = mix(vec3(1.0), v_col.rgb, fill);
  if (lab > 0.01) {
    vec2 tp = vec2(p.x + v_lbl.z * 0.5, p.y + u_cellF.y * 0.5);
    if (tp.x > -u_atlasP.z && tp.x < v_lbl.z + u_atlasP.z && tp.y > 0.0 && tp.y < u_cellF.y) {
      vec2 uv = (v_lbl.xy + vec2(u_atlasP.z, 0.0) + tp) * u_atlasP.x / u_atlasSize;
      float sd = texture2D(u_atlas, uv).a;
      float ta = smoothstep(0.5 - u_atlasP.y, 0.5 + u_atlasP.y, sd) * lab * fill;
      c = mix(c, v_tcol, ta);
    }
  }
  float ds = sdRoundBox(p - vec2(0.0, mix(0.3, 1.4, v_chip)), vec2(hw, hh), hh);
  float sh = mix(0.2, 0.26, v_chip) * (1.0 - smoothstep(-1.2, mix(2.0, 3.4, v_chip), ds));
  float glow = (1.0 - v_chip) * 0.16 * pow(1.0 - smoothstep(0.0, hh * 1.6, d), 1.5);
  vec4 body = vec4(c, 1.0) * cov;
  vec4 under = vec4(v_col.rgb * glow, glow);
  under += vec4(vec3(0.063, 0.094, 0.157) * sh, sh) * (1.0 - under.a);
  gl_FragColor = (body + under * (1.0 - body.a)) * v_col.a;
}`;

// Trails (WebGL2): the per-second positions of every bus live in an RGBA32F ring texture ([slot, row] -> x, y, t).
// Each frame draws only the buses on screen that moved lately: instance = (bus, segment k), so the work is
// visible buses x ring rows, not the whole fleet. Segment k joins sample k (older) to sample k-1 (newer); sample -1 is
// the bus right now. Joints are mitered with the same inputs on both sides, so ribbons have no overlaps or gaps.
const TRAIL_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 a_corner;   // x: 0 = older end, 1 = newer end; y: -1 / +1 side
in vec4 a_bus;      // slot, x, y (mercator - origin), presence
in vec4 a_bus2;     // trail start (s), flags
in vec4 a_col;      // route colour
uniform sampler2D u_trail;
uniform mat4 u_matrix;
uniform vec2 u_view;
uniform float u_now;
uniform vec4 u_tr;    // length (s), head width (px), opacity, focus mix
uniform ivec3 u_ring; // rows, newest row, texture rows per ring row
uniform ivec2 u_seg;  // segments per bus, ring rows per segment (2 = every other sample, below street zoom)
out float v_side;
out float v_a;
out vec3 v_col;
out float v_w;
const float MAXSEG = 1.2e-5; // ~480 m in mercator units: longer steps are snaps, not trails
float bit(float f, float b) { return mod(floor(f / b + 0.001), 2.0); }
vec3 pt(int j) {
  if (j < 0) return vec3(a_bus.yz, u_now);
  int K = u_ring.x;
  int r = (u_ring.y - j + 2 * K) % K;
  int slot = int(a_bus.x + 0.5);
  return texelFetch(u_trail, ivec2(slot % ${TRAIL_TEX_W}, r * u_ring.z + slot / ${TRAIL_TEX_W}), 0).xyz;
}
bool ok(vec3 p, float ts) { return p.z >= ts && p.z > -1.0e5 && (u_now - p.z) <= u_tr.x; }
vec3 scr(vec2 m) { vec4 c = u_matrix * vec4(m, 0.0, 1.0); return vec3(c.xy / c.w * 0.5 * u_view, c.w); }
void main() {
  int N = u_seg.x, S = u_seg.y;
  int k = gl_InstanceID % N;
  float maxSeg = MAXSEG * float(S);
  float ts = a_bus2.x;
  vec3 p1 = pt((k + 1) * S - 1), p2 = pt(k * S - 1);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  v_a = 0.0; v_side = 0.0; v_w = 1.0; v_col = vec3(0.0);
  if (a_bus.w < 0.01 || !ok(p1, ts) || !ok(p2, ts) || length(p2.xy - p1.xy) > maxSeg) return;
  vec3 S1 = scr(p1.xy), S2 = scr(p2.xy);
  if (S1.z <= 0.0 || S2.z <= 0.0) return;
  vec2 sd = S2.xy - S1.xy;
  float sl = length(sd);
  if (sl < 0.05) return;
  sd /= sl;
  bool atEnd = a_corner.x > 0.5;
  vec2 P = atEnd ? S2.xy : S1.xy;
  float t = atEnd ? p2.z : p1.z;
  vec2 dir = sd;
  if (!atEnd) {
    if (k + 1 < N) {
      vec3 p0 = pt((k + 2) * S - 1);
      if (ok(p0, ts) && length(p1.xy - p0.xy) < maxSeg) {
        vec3 S0 = scr(p0.xy);
        vec2 di = S1.xy - S0.xy;
        float li = length(di);
        if (li > 0.05 && S0.z > 0.0) dir = normalize(di / li + sd);
      }
    }
  } else if (k >= 1) {
    vec3 p3 = pt((k - 1) * S - 1);
    if (ok(p3, ts) && length(p3.xy - p2.xy) < maxSeg) {
      vec3 S3 = scr(p3.xy);
      vec2 dn = S3.xy - S2.xy;
      float ln = length(dn);
      if (ln > 0.05 && S3.z > 0.0) dir = normalize(sd + dn / ln);
    }
  }
  vec2 nrm = vec2(-sd.y, sd.x);
  vec2 mit = vec2(-dir.y, dir.x);
  float ml = 1.0 / max(dot(mit, nrm), 0.5);
  float age = clamp((u_now - t) / u_tr.x, 0.0, 1.0);
  float w = u_tr.y * mix(1.0, 0.45, age);
  float hwid = w * 0.5 + 1.0;
  gl_Position = vec4((P + mit * ml * hwid * a_corner.y) / (0.5 * u_view), 0.0, 1.0);
  float flags = a_bus2.y;
  float dim = bit(flags, 8.0), stale = bit(flags, 1.0), idle = bit(flags, 2.0);
  v_a = pow(1.0 - age, 1.35) * u_tr.z * a_bus.w * mix(1.0, mix(1.0, 0.1, u_tr.w), dim) * (1.0 - idle) * (1.0 - 0.6 * stale);
  v_col = a_col.rgb;
  v_side = a_corner.y * hwid;
  v_w = w * 0.5;
}`;

const TRAIL_FS = `#version 300 es
precision mediump float;
uniform float u_aa;
uniform float u_core;  // half width of the light core (px)
in float v_side;
in float v_a;
in vec3 v_col;
in float v_w;
out vec4 o;
void main() {
  float x = abs(v_side);
  float glow = pow(max(1.0 - x / v_w, 0.0), 1.7) * 0.6;
  float core = 1.0 - smoothstep(u_core - u_aa, u_core + u_aa, x);
  float ag = v_a * glow;
  float ac = v_a * core * 0.9;
  vec3 cc = mix(v_col, vec3(1.0), 0.5);
  o = vec4(cc * ac, ac) + vec4(v_col * ag, ag) * (1.0 - ac);
}`;

const HALO_VS = `
precision highp float;
attribute vec2 a_corner;
uniform mat4 u_matrix;
uniform vec2 u_view;
uniform vec2 u_pos;
uniform float u_rv;
varying vec2 v_p;
void main() {
  vec4 c0 = u_matrix * vec4(u_pos, 0.0, 1.0);
  vec2 ext = vec2(u_rv * 3.6);
  v_p = a_corner * ext;
  gl_Position = c0 + vec4(a_corner * ext * 2.0 / u_view * vec2(1.0, -1.0) * c0.w, 0.0, 0.0);
}`;

const HALO_FS = `
precision mediump float;
uniform vec3 u_col;
uniform float u_r;
varying vec2 v_p;
void main() {
  // calm: a soft, still disc in the route colour under the selected bus (its pin marks it)
  float d = length(v_p);
  float a = 0.17 * (1.0 - smoothstep(u_r * 1.35, u_r * 1.85, d));
  gl_FragColor = vec4(u_col * a, a);
}`;

function compile(gl, vs, fs, attribs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`tokyo bus layer shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`bus layer link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u, n: attribs.length };
}

const ramp = (z, stops) => {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (z <= stops[i][0]) {
      const [z0, v0] = stops[i - 1], [z1, v1] = stops[i];
      return lerp(v0, v1, (z - z0) / (z1 - z0));
    }
  }
  return stops[stops.length - 1][1];
};

/** Chip sizes at zoom z (css px): dot radius, chip half-height, heading pointer length, dot -> chip mix. */
export function chipSizes(z) {
  return {
    dotR: ramp(z, [[9, 1.9], [11, 2.6], [13, 3.6]]),
    chipR: ramp(z, [[13.2, 5.2], [14, 6.4], [15, 8.2], [16.5, 9.2], [18, 10.2]]),
    ptrLen: ramp(z, [[13.2, 4], [15, 5.2], [18, 6]]),
    chipMix: smooth(clamp((z - 13.2) / 0.9, 0, 1)),
  };
}

export class BusLayer {
  constructor(store, atlas, hooks = {}) {
    this.id = 'tokyo-buses';
    this.type = 'custom';
    this.renderingMode = '2d';
    this.store = store;
    this.atlas = atlas;
    this.hooks = hooks; // {beforeFrame(now), afterFrame(now, stats)}
    this.focusMix = 0;
    this.selPin = false; // the selected bus has a DOM pin (set by index.js)
    this.lastT = 0;
    this.frames = [];
    this.fps = 0;
    this.cpuMs = 0;
    this.lost = false;
  }

  /** Half-height (css px) of a bus chip at zoom z: where a pin over the selected bus puts its pointer's tip. */
  selHalfHeight(z) {
    const k = chipSizes(z);
    return lerp(k.dotR, k.chipR, k.chipMix);
  }

  onAdd(map, gl) {
    this.map = map;
    this.gl = gl;
    try { this._init(gl); } catch (err) { this.lost = true; console.error('[tokyo buses]', err.message); }
    this._lost = () => { this.lost = true; };
    this._restored = () => { this.lost = false; this._init(this.gl); };
    map.on('webglcontextlost', this._lost);
    map.on('webglcontextrestored', this._restored);
  }

  _init(gl) {
    this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (this.gl2) {
      this.divisor = (l, d) => gl.vertexAttribDivisor(l, d);
      this.drawInst = (mode, first, count, n) => gl.drawArraysInstanced(mode, first, count, n);
      this.bindVao = (v) => gl.bindVertexArray(v);
    } else {
      const ext = gl.getExtension('ANGLE_instanced_arrays');
      if (!ext) throw new Error('bus layer: no instancing');
      const vao = gl.getExtension('OES_vertex_array_object');
      this.divisor = (l, d) => ext.vertexAttribDivisorANGLE(l, d);
      this.drawInst = (mode, first, count, n) => ext.drawArraysInstancedANGLE(mode, first, count, n);
      this.bindVao = (v) => { if (vao) vao.bindVertexArrayOES(v); };
    }
    this.chip = compile(gl, CHIP_VS, CHIP_FS, ['a_corner', 'a_dyn', 'a_info', 'a_col', 'a_tcol']);
    this.trailP = this.gl2 ? compile(gl, TRAIL_VS, TRAIL_FS, ['a_corner', 'a_bus', 'a_bus2', 'a_col']) : null;
    this.halo = compile(gl, HALO_VS, HALO_FS, ['a_corner']);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.seg = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seg);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.bufDyn = gl.createBuffer();
    this.bufInfo = gl.createBuffer();
    this.bufCol = gl.createBuffer();
    this.bufVis = gl.createBuffer();
    this.bufVisCol = gl.createBuffer();
    this.trailTex = this.gl2 ? gl.createTexture() : null;
    this.visCap = 0;
    this.tex = gl.createTexture();
    this.texVersion = -1;
    this.texH = 0;
    this.allocCap = 0;
    this.store.dirty.realloc = true;
  }

  onRemove(map, gl) {
    map.off('webglcontextlost', this._lost);
    map.off('webglcontextrestored', this._restored);
    for (const b of [this.quad, this.seg, this.bufDyn, this.bufInfo, this.bufCol, this.bufVis, this.bufVisCol]) gl.deleteBuffer(b);
    gl.deleteTexture(this.tex);
    if (this.trailTex) gl.deleteTexture(this.trailTex);
    for (const p of [this.chip, this.trailP, this.halo]) if (p) gl.deleteProgram(p.p);
  }

  _upload(gl) {
    const s = this.store;
    const cap = s.cap;
    if (s.dirty.realloc || this.allocCap !== cap) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDyn); gl.bufferData(gl.ARRAY_BUFFER, s.dyn.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufInfo); gl.bufferData(gl.ARRAY_BUFFER, s.info, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol); gl.bufferData(gl.ARRAY_BUFFER, s.col, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVis); gl.bufferData(gl.ARRAY_BUFFER, s.visList.byteLength, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVisCol); gl.bufferData(gl.ARRAY_BUFFER, s.visCol.byteLength, gl.DYNAMIC_DRAW);
      if (this.trailTex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TRAIL_TEX_W, TRAIL_K * (cap / TRAIL_TEX_W), 0, gl.RGBA, gl.FLOAT, s.trail);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      this.allocCap = cap;
      s.dirty.realloc = false; s.dirty.info = false; s.dirty.col = false; s.dirty.rows.clear();
      s.dirty.dyn = true; // the new buffers are empty: fill them this frame even when the per-bus pass rested
    }
    const n = s.maxSlot;
    if (s.dirty.dyn) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufDyn);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.dyn.subarray(0, Math.max(4, n * 4)));
    }
    if (s.dirty.info) { gl.bindBuffer(gl.ARRAY_BUFFER, this.bufInfo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.info.subarray(0, Math.max(4, n * 4))); s.dirty.info = false; }
    if (s.dirty.col) { gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.col.subarray(0, Math.max(8, n * 8))); s.dirty.col = false; }
    if (s.dirty.rows.size) {
      if (this.trailTex) {
        const B = cap / TRAIL_TEX_W;
        const used = Math.max(1, Math.ceil(n / TRAIL_TEX_W)); // texture rows of this ring row that hold buses
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        for (const r of s.dirty.rows) {
          const off = r * cap * 4;
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r * B, TRAIL_TEX_W, used, gl.RGBA, gl.FLOAT, s.trail.subarray(off, off + used * TRAIL_TEX_W * 4));
        }
      }
      s.dirty.rows.clear();
    }
    if (s.visN && s.dirty.dyn) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVis); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.visList.subarray(0, s.visN * 8));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufVisCol); gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.visCol.subarray(0, s.visN * 4));
    }
    s.dirty.dyn = false;
    const a = this.atlas;
    if (a.version !== this.texVersion && a.height > 0) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, a.width, a.height, 0, gl.ALPHA, gl.UNSIGNED_BYTE, a.data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.texVersion = a.version;
      this.texH = a.height;
    }
  }

  _attr(gl, loc, buf, size, type, norm, stride, offset, div) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, type, norm, stride, offset);
    this.divisor(loc, div);
  }

  _reset(gl, n) {
    for (let i = 0; i < n; i++) { this.divisor(i, 0); gl.disableVertexAttribArray(i); }
  }

  /** Mercator (0..1) -> clip matrix with the origin folded in (float64 maths, float32 out). */
  _matrix(m) {
    const ox = ORIGIN[0], oy = ORIGIN[1];
    const r = this._m || (this._m = new Float32Array(16));
    for (let i = 0; i < 12; i++) r[i] = m[i];
    r[12] = m[0] * ox + m[4] * oy + m[12];
    r[13] = m[1] * ox + m[5] * oy + m[13];
    r[14] = m[2] * ox + m[6] * oy + m[14];
    r[15] = m[3] * ox + m[7] * oy + m[15];
    return r;
  }

  render(gl, args) {
    if (this.lost) return;
    const map = this.map;
    const t0 = performance.now();
    const now = this.hooks.now ? this.hooks.now() : t0;
    const dt = this.lastT ? clamp(now - this.lastT, 0, 100) : 16;
    this.lastT = now;
    const z = map.getZoom();
    const cvs = map.getCanvas();
    const W = cvs.clientWidth || cvs.width, H = cvs.clientHeight || cvs.height;
    const dpr = cvs.width / Math.max(1, W);
    // view in metres, padded
    const b = map.getBounds();
    const pxPerM = (512 * 2 ** z) / MPU;
    const toXm = (lng) => ((lng + 180) / 360) * MPU;
    const toYm = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * MPU; };
    const raw = [toXm(b.getWest()), toYm(b.getNorth()), toXm(b.getEast()), toYm(b.getSouth())];
    const s = this.store;
    if (s.due(now, raw, pxPerM, z >= 13.2)) {
      // cull with a wide margin (a third of the view): a pan stays inside it for a while, so the per-bus pass can rest
      const padM = Math.max(80 / pxPerM + 60, Math.max(raw[2] - raw[0], raw[3] - raw[1]) * 0.33);
      s.update(now, clamp(now - (s.lastUpdate || now - 16), 0, 250), [raw[0] - padM, raw[1] - padM, raw[2] + padM, raw[3] + padM], pxPerM);
    }
    const targetFocus = s.focus ? 1 : 0;
    this.focusMix += (targetFocus - this.focusMix) * (1 - Math.exp(-dt / 120));
    if (Math.abs(targetFocus - this.focusMix) < 0.002) this.focusMix = targetFocus;

    this._upload(gl);
    const M = this._matrix(args.defaultProjectionData.mainMatrix);
    this.bindVao(null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const n = s.maxSlot;
    const aa = 0.6 / dpr;
    const tNow = s.tNow(now);

    // trails: short and quiet: from street-ish zoom only, the newest ~24 s, every other sample
    // below z15 (half the instances where a trail is a few pixels long)
    const trailOp = smooth(clamp((z - 13.2) / 0.8, 0, 1)) * 0.62;
    let trailDraws = 0;
    if (this.trailP && s.visN && trailOp > 0.01) {
      const P = this.trailP;
      const segS = z < 15 ? 2 : 1;
      const segN = Math.min(Math.floor((TRAIL_K - 1) / segS) - 1, Math.round(TRAIL_SEGS / segS));
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.u_matrix, false, M);
      gl.uniform2f(P.u.u_view, W, H);
      gl.uniform1f(P.u.u_now, tNow);
      gl.uniform4f(P.u.u_tr, (segN * segS * TRAIL_DT) / 1000, ramp(z, [[13, 4], [14, 6], [16, 10], [18, 15]]), trailOp, this.focusMix);
      gl.uniform1f(P.u.u_core, ramp(z, [[13, 0.5], [14, 0.7], [16, 1], [18, 1.4]]));
      gl.uniform1f(P.u.u_aa, aa);
      gl.uniform3i(P.u.u_ring, TRAIL_K, s.row, s.cap / TRAIL_TEX_W);
      gl.uniform2i(P.u.u_seg, segN, segS);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.trailTex);
      gl.uniform1i(P.u.u_trail, 0);
      this._attr(gl, 0, this.seg, 2, gl.FLOAT, false, 0, 0, 0);
      this._attr(gl, 1, this.bufVis, 4, gl.FLOAT, false, 32, 0, segN);
      this._attr(gl, 2, this.bufVis, 4, gl.FLOAT, false, 32, 16, segN);
      this._attr(gl, 3, this.bufVisCol, 4, gl.UNSIGNED_BYTE, true, 4, 0, segN);
      this.drawInst(gl.TRIANGLE_STRIP, 0, 4, s.visN * segN);
      trailDraws = s.visN * segN;
      this._reset(gl, 4);
    }

    // chips
    const { dotR, chipR, ptrLen, chipMix } = chipSizes(z);
    const labelMix = smooth(clamp((z - 14.55) / 0.6, 0, 1));
    const C = this.chip;
    if (n) {
      gl.useProgram(C.p);
      gl.uniformMatrix4fv(C.u.u_matrix, false, M);
      gl.uniform2f(C.u.u_view, W, H);
      gl.uniform4f(C.u.u_size, dotR, chipR, ptrLen, chipMix);
      gl.uniform2f(C.u.u_cell, this.atlas.cellW, this.atlas.cellH);
      gl.uniform2f(C.u.u_cellF, this.atlas.cellW, this.atlas.cellH);
      gl.uniform2f(C.u.u_atlasSize, this.atlas.width, Math.max(1, this.texH));
      gl.uniform3f(C.u.u_atlasP, this.atlas.S, ((0.55 / dpr) * this.atlas.S) / (2 * this.atlas.R * this.atlas.S) + 0.02, this.atlas.pad);
      gl.uniform1f(C.u.u_aa, aa);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.uniform1i(C.u.u_atlas, 0);
      this._attr(gl, 0, this.quad, 2, gl.FLOAT, false, 0, 0, 0);
      const bindInst = (slot) => {
        this._attr(gl, 1, this.bufDyn, 4, gl.FLOAT, false, 16, slot * 16, 1);
        this._attr(gl, 2, this.bufInfo, 4, gl.FLOAT, false, 16, slot * 16, 1);
        this._attr(gl, 3, this.bufCol, 4, gl.UNSIGNED_BYTE, true, 8, slot * 8, 1);
        this._attr(gl, 4, this.bufCol, 4, gl.UNSIGNED_BYTE, true, 8, slot * 8 + 4, 1);
      };
      bindInst(0);
      if (this.focusMix > 0.001) {
        gl.uniform4f(C.u.u_misc, labelMix, this.focusMix, 0, this.atlas.cols);
        this.drawInst(gl.TRIANGLE_STRIP, 0, 4, n);
      }
      gl.uniform4f(C.u.u_misc, labelMix, this.focusMix, 1, this.atlas.cols);
      this.drawInst(gl.TRIANGLE_STRIP, 0, 4, n);
      // the selected bus: halo, then its chip on top of everything
      const sel = s.selId && s.get(s.selId);
      if (sel && sel.slot >= 0 && sel.vis) {
        this._reset(gl, 5);
        const H_ = this.halo;
        gl.useProgram(H_.p);
        gl.uniformMatrix4fv(H_.u.u_matrix, false, M);
        gl.uniform2f(H_.u.u_view, W, H);
        const o = sel.slot * 4;
        gl.uniform2f(H_.u.u_pos, s.dyn[o], s.dyn[o + 1]);
        const hr = Math.max(chipR * 0.9, dotR * 1.6);
        gl.uniform1f(H_.u.u_r, hr);
        gl.uniform1f(H_.u.u_rv, hr);
        const co = sel.slot * 8;
        gl.uniform3f(H_.u.u_col, s.col[co] / 255, s.col[co + 1] / 255, s.col[co + 2] / 255);
        this._attr(gl, 0, this.quad, 2, gl.FLOAT, false, 0, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.useProgram(C.p);
        this._attr(gl, 0, this.quad, 2, gl.FLOAT, false, 0, 0, 0);
        bindInst(sel.slot);
        // with its pin up, the pin's label carries the route code: the chip under it shows only the heading
        gl.uniform4f(C.u.u_misc, this.selPin ? 0 : Math.max(labelMix, smooth(clamp((z - 13.2) / 0.6, 0, 1))), this.focusMix, 2, this.atlas.cols);
        this.drawInst(gl.TRIANGLE_STRIP, 0, 4, 1);
      }
      this._reset(gl, 5);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // stats + next frame
    const t1 = performance.now();
    this.cpuMs = this.cpuMs * 0.9 + (t1 - t0) * 0.1;
    this.frames.push(t1);
    while (this.frames.length && this.frames[0] < t1 - 1000) this.frames.shift();
    this.fps = this.frames.length;
    this.trailDraws = trailDraws;
    if (this.hooks.afterFrame) this.hooks.afterFrame(now);
  }
}

/** Shader sources (for debugging in the dev harness). */
BusLayer.SRC = { CHIP_VS, CHIP_FS, TRAIL_VS, TRAIL_FS, HALO_VS, HALO_FS };
BusLayer.compile = compile;
