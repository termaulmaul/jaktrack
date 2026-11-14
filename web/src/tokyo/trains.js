// Tokyo's trains on the 2D map: trafik.live's WebGL trainsets moved to Greater Tokyo.
// Every frame places each running train from the timetable and the clock (model.js's createFrame in model.js, never from
// the previous frame), as a trainset in its line's colour that bends with the track: a cab with a windscreen and
// headlights at the front, tail lights at the back, doors lit while it stands at a platform, and a stripe along the
// roof for rapid and express ranks (types.js typeStyle() when it is there). Japan's railways keep LEFT, so a train sits
// left of its line in the direction it travels and two trains passing at a station sit side by side; a line drawn
// beside another (line.offset lanes) carries its trains on its own drawn lane. Trains below ground (the heights build's tunnels)
// are small opaque dashes in their line's exact colour, drawn under the trains in the open (calm by size and order,
// never by changing the official colour: ODPT guideline 4). A train with a FRESH live position (live.js 'live': its own
// report <= 150 s old; model.measured) carries a thin ring in the page's live green (#1E9E4A, the green dot of the Live
// pill) just outside its white casing at EVERY zoom, the opening view included; nothing pulses or moves. A live train
// below ground is drawn at full strength (full size, normal casing, with the trains in the open), so the live subway
// trains under central Tokyo show. Estimated and scheduled trains carry no mark.
// Labels (type and destination: "Rapid → Odawara", "快速 小田原行") show from city zoom and never overlap each other or
// the map's own labels: a CPU pass places them by priority (the picked train, the picked line, those shown last time,
// higher ranks) each time the trains are placed. Cars and labels are drawn shapes (no images are fetched), sharp at any
// zoom and pixel ratio. Frames come from MapLibre; between them we ask for one only as often as a train on screen moves
// about a pixel. Nothing is allocated per frame: typed-array instance buffers, looks and labels cached per run.
import { createFrame, destination } from './model.js';
import { laneAt } from './net.js';
import { railsOf } from './rails.js';
import { _dict as I18N } from './i18n.js';

const D2R = Math.PI / 180;
/** The GPU gets small offsets from here (float64 maths on the CPU): Tokyo Station. */
export const ORIGIN = [106.8229, -6.2003];
/** Ground metres per Web Mercator unit at Tokyo's latitude. */
export const MPU = 40075016.68557849 * Math.cos(ORIGIN[1] * D2R);
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const OX = mercX(ORIGIN[0]), OY = mercY(ORIGIN[1]);
export const lngOf = (x) => (x + OX) * 360 - 180;
export const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + OY)))) / D2R;
const TRAIL_S = 10;     // seconds of travel the streak behind a moving train shows
const CAR_PX = 9;       // a drawn car is never shorter than this: zoomed out, a long train draws fewer, longer cars
const LANES = 7;        // line.offset is used within -7..7
const FLAG = { HEAD: 1, TAIL: 2, DOORS: 4, SEL: 8, DIM: 16, TRAIL: 32, UNDER: 64, LIVE: 128 };
/** The live ring's colour: the app's live green (app.css --income; the Live pill's dot, the Live now sheet's dots). */
export const LIVE_RING = '#1E9E4A';
/** A live train's label: its delay appended from a whole minute ('' = on time). */
export const delayText = (min, lang) => (min >= 1 ? (lang === 'ja' ? ` ${min}分遅れ` : lang === 'id' ? ` · +${min} mnt` : ` · +${min} min`) : '');
const STRIDE = 12;      // floats per car: ends (4), info (4), look (4)
const TAG = 8;          // floats per label: rect x, y, w, h (css px from the top left), atlas x, y, alpha, -
const GAP = 2;          // css px kept clear around a label
const FONT_PX = 11.5;
const FONT = `600 ${FONT_PX}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Segoe UI', Roboto, 'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic UI', Meiryo, 'Helvetica Neue', Arial, sans-serif`;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const ramp = (z, stops) => {
  if (z <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) if (z <= stops[i][0]) { const [z0, a] = stops[i - 1], [z1, b] = stops[i]; return a + (b - a) * (z - z0) / (z1 - z0); }
  return stops[stops.length - 1][1];
};

/** Train geometry at zoom z in css px (a 10-car train's length, half width, corner, offset to the left-hand track,
 * px between neighbouring line lanes) and how much of each detail shows. Below z13.5 trains are slim (about a lane
 * and a half wide), so the trains of lines drawn side by side (2-3 px apart there) stay apart instead of piling into
 * blocks; from z14.5 they have krl's full width. Trains below ground are shorter and slimmer still until z14. */
export function trainSizes(z) {
  const half = ramp(z, [[9, 1.5], [11, 1.6], [12, 1.75], [13, 2.2], [13.5, 2.6], [14.5, 4.1], [15, 4.25], [16, 4.6], [17, 5], [18, 5.4]]);
  const ug = smooth((z - 13) / 1);
  return {
    len: ramp(z, [[9, 13], [11, 17], [12, 23], [13, 34], [14, 54], [15, 78], [16, 112], [17, 152], [18, 200]]),
    half,
    corner: ramp(z, [[12.8, 0], [14, 0.9], [16, 1.3], [18, 1.7]]),
    side: (half + 0.6) * smooth((z - 12.8) / 1), // left of the line once trains are long enough to tell apart
    ugLen: 0.5 + 0.5 * ug, // a train below ground: half the length and 60 % of the width of one in the open below z13
    ugHalf: 0.6 + 0.4 * ug, // (calm by size, in its exact colour), full size from z14
    ring: ramp(z, [[9, 1.5], [11, 1.6], [12.5, 1.45], [14, 1.3], [15, 1.5]]), // a live train's green ring, every zoom (LIVE-VISIBLE)
    lane: ramp(z, [[9, 1.5], [12, 3], [15, 5], [18, 8]]),
    halo: ramp(z, [[11, 0.9], [14, 1.2], [17, 1.5]]),
    cab: smooth((z - 11) / 1.2), // the windscreen marks the front from city zoom
    joint: smooth((z - 13.2) / 0.8), // where one car meets the next
    detail: smooth((z - 13.6) / 1.2), // windows
    fine: smooth((z - 14.6) / 1), // lamps, doors
    label: smooth((z - 12.2) / 0.6),
    trail: smooth((z - 11.6) / 1) * 0.42, // the streak's strongest opacity
  };
}

/** Drawn length against a 10-car train (MT3D carComposition 1..15): a 2-car tram 0.44, 6 cars 0.72, 15 cars capped
 * at 1.25 so long trains do not cover the stations either side. */
export const carScale = (cars) => clamp(0.3 + 0.07 * (cars || 10), 0.4, 1.25);

/** How many cars to draw for a train of `cars` drawn `px` long with half width `half` (px). */
export const carsDrawn = (cars, px, half) => clamp(Math.round(px / Math.max(CAR_PX, 2 * half)), 1, Math.max(1, cars || 10));

/** Signed css px of a train's centre right of its direction of travel: its line's lane there (`lane` lanes right of
 * the path's direction, as MapLibre's line-offset; the network build's line.lanes, fractional where a line changes lane), then
 * the left-hand track. `sign` = +1 along the path, -1 against. */
export const lateral = (lane, sign, lanePx, side) => clamp(+lane || 0, -LANES, LANES) * (sign < 0 ? -1 : 1) * lanePx - side;

/** Where a train's centre sits on screen: the middle of its front (fx, fy) and back (bx, by) screen points (css px, y
 * down) moved `lat` px right of travel (negative = left), into out[0], out[1]. The car shader does the same sums. */
export function lateralPoint(fx, fy, bx, by, lat, out = [0, 0]) {
  let dx = fx - bx, dy = fy - by;
  const len = Math.hypot(dx, dy);
  if (len > 1e-3) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }
  out[0] = (fx + bx) * 0.5 - dy * lat; out[1] = (fy + by) * 0.5 + dx * lat;
  return out;
}

const hex = (c, fallback = 0x8b8b93) => {
  if (typeof c !== 'string') return fallback;
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(c.trim());
  if (!m) return fallback;
  const s = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  return parseInt(s, 16);
};
const mixRGB = (a, b, t) => {
  const r = (a >> 16 & 255) + ((b >> 16 & 255) - (a >> 16 & 255)) * t, g = (a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * t, c = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(c);
};
const WARM_WHITE = 0xf6f5f0;

/** The default look until types.js gives one: the line's colour; rapid and express ranks get a light stripe along the
 * roof (wider for higher ranks, in the type's own colour when the data has one); limited expresses (rank 4) a warm
 * white body with a stripe in the line's colour. Numbers are 0xRRGGBB; weight = stripe width / half width. */
export function defaultLook(line, type) {
  const body = hex(line?.color), rank = clamp(type?.rank | 0, 0, 4);
  if (rank >= 4) return { body: WARM_WHITE, band: body, weight: 0.5 };
  if (rank >= 1) return { body, band: type?.color ? hex(type.color) : mixRGB(body, 0xffffff, 0.8), weight: [0, 0.3, 0.38, 0.46][rank] };
  return { body, band: body, weight: 0 };
}
// types.js typeStyle() may answer in a few shapes; take what it gives. Its answer decides the stripe; the body stays
// the line's colour unless it names one.
function lookFrom(s, base, line) {
  if (!s || typeof s !== 'object') return base;
  base = { body: hex(line?.color), band: hex(line?.color), weight: 0 };
  const body = s.body ?? s.fill ?? s.color ?? s.colour, band = s.band ?? s.stripe ?? s.accent;
  const weight = s.weight ?? s.bandWidth ?? s.stripeWidth;
  return {
    body: typeof body === 'string' ? hex(body, base.body) : base.body,
    band: band === null ? base.body : typeof band === 'string' ? hex(band, base.band) : base.band,
    weight: band === null ? 0 : Number.isFinite(weight) ? clamp(weight, 0, 1) : typeof band === 'string' && !base.weight ? 0.36 : base.weight,
  };
}

/** The map label of a run: type and where it goes, in EN / JA (ID uses the EN names). Locals show only where they go
 * (krl's MRT "→ Lebak Bulus"); a loop line's lap that carries on round shows its direction ("Inner Loop", "内回り",
 * ID "Lingkar dalam" from i18n's board.dir.* words). */
export function trainLabel(model, run, lang = 'en', typeWord = null) {
  const ja = lang === 'ja', line = model.lines[run.line], type = model.types?.[run.type];
  let word = typeWord ? typeWord(type, lang) : null;
  if (word == null) word = type && (type.rank | 0) > 0 ? (ja ? type.title?.ja : type.title?.en) || '' : '';
  if (line?.loop && run.next?.length && !(run.to?.length > 0 && run.to[0] !== run.stops[run.stops.length - 1]?.s)) {
    const d = model.dirs?.[run.dir], dir = d?.title;
    // ID: the board's words for the loop directions, else MT3D's EN title
    const idw = lang === 'id' && d?.id ? I18N?.id?.[`board.dir.${d.id}`] : null;
    if (dir) return `${word ? `${word} ` : ''}${idw || (ja ? dir.ja : dir.en) || dir.en || ''}`;
  }
  let s = -1;
  try { s = destination(model, run); } catch { s = run.to?.[0] ?? run.stops[run.stops.length - 1]?.s ?? -1; }
  const name = model.stations[s]?.name;
  const where = name ? (ja ? name.ja || name.en : name.en || name.ja) : '';
  if (!where) return word;
  return ja ? `${word ? `${word} ` : ''}${where}行` : `${word ? `${word} ` : ''}→ ${where}`;
}

// Trains below ground: the line colour this much towards its own grey, then this much darker (muted() below).
const MUTE_GREY = 0.4, MUTE_DARK = 0.93;
/** A line colour as trains below ground show it ('#RRGGBB' in and out): less saturated, a touch darker. style.js can
 * draw subway paths in the same colour so these trains sit on a line. */
export function muted(color) {
  const n = hex(color), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, y = 0.299 * r + 0.587 * g + 0.114 * b;
  const f = (v) => Math.round(Math.max(0, Math.min(1, (v + (y - v) * MUTE_GREY) * MUTE_DARK)) * 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`.toUpperCase();
}

const CAR_VS = `
#define MUTE_GREY ${MUTE_GREY.toFixed(3)}
#define MUTE_DARK ${MUTE_DARK.toFixed(3)}
#define LIVE_C vec3(${[30, 158, 74].map((v) => (v / 255).toFixed(4)).join(', ')})
precision highp float;
attribute vec2 a_corner;
attribute vec4 a_ends;   // front x, y, back x, y (Mercator minus origin)
attribute vec4 a_info;   // flags, alpha, streak opacity at the back and the front
attribute vec4 a_look;   // body 0xRRGGBB, stripe 0xRRGGBB, stripe width (share of the half width), lateral px
uniform mat4 u_matrix;
uniform vec2 u_view;     // css px
uniform vec4 u_geo;      // half width, -, overlap, halo
uniform float u_corner;
uniform mediump float u_pass; // 0: shadow, outline and streaks (a margin around each car), 1: the cars (no margin)
uniform vec3 u_under;    // trains below ground: width against those in the open, 1 = muted colour, 1 = subdued (thin casing)
uniform float u_ring;    // css px of a live train's ring at this zoom (0 when zoomed out)
varying vec2 v_p;
varying vec2 v_half;
varying vec2 v_shadow;
varying vec4 v_col;
varying vec4 v_flags;    // head, tail, doors, selected
varying vec2 v_r;        // front, back corner radius
varying vec3 v_trail;    // a streak segment, its opacity at the back and the front
varying vec4 v_band;     // stripe colour, stripe half width (css px)
varying float v_under;
varying vec4 v_live;     // a train with a fresh live position: its ring's colour (the live green) and width
float bit(float f, float b) { return mod(floor(f / b + 0.001), 2.0); }
vec3 rgb(float v) { float r = floor(v / 65536.0 + 0.0001); float g = floor((v - r * 65536.0) / 256.0 + 0.0001); return vec3(r, g, v - r * 65536.0 - g * 256.0) / 255.0; }
vec2 scr(vec4 c) { return c.xy / c.w * 0.5 * u_view * vec2(1.0, -1.0); }
void main() {
  vec4 f = u_matrix * vec4(a_ends.xy, 0.0, 1.0);
  vec4 b = u_matrix * vec4(a_ends.zw, 0.0, 1.0);
  if (a_info.y < 0.003 || f.w <= 0.0 || b.w <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 fs = scr(f), bs = scr(b), d = fs - bs;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(0.0, -1.0);
  vec2 nrm = vec2(-dir.y, dir.x); // right of the direction of travel (screen y points down)
  float head = bit(a_info.x, 1.0), tail = bit(a_info.x, 2.0), sel = bit(a_info.x, 8.0), dim = bit(a_info.x, 16.0), trail = bit(a_info.x, 32.0), under = bit(a_info.x, 64.0);
  if (trail > 0.5 && u_pass > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // streaks are drawn under the cars only
  float mute = under * u_under.y;
  float hw = u_geo.x * mix(1.0, 0.62, trail) * mix(1.0, u_under.x, under);
  float hl = trail > 0.5 ? len * 0.5 : max(len * 0.5 + u_geo.z, hw * 0.6);
  // only as many pixels as each pass needs: halo + shadow (+ the picked train's glow), the car itself, a streak's edge
  float margin = trail > 0.5 ? 1.0 : u_pass > 0.5 ? 1.0 : u_geo.w + mix(4.6, 9.6, sel);
  vec2 ext = vec2(hl, hw) + margin;
  v_p = a_corner * ext;
  // a_look.w: the line's lane, then the left-hand track (negative = left of travel)
  vec2 P = (fs + bs) * 0.5 + nrm * a_look.w + dir * v_p.x + nrm * v_p.y;
  gl_Position = vec4(P / (0.5 * u_view) * vec2(1.0, -1.0), 0.0, 1.0);
  v_half = vec2(hl, hw);
  v_shadow = vec2(dot(vec2(0.0, 1.2), dir), dot(vec2(0.0, 1.2), nrm));
  vec3 col = rgb(a_look.x), band = rgb(a_look.y), LUM = vec3(0.299, 0.587, 0.114);
  // below ground, 'muted' option only (u_under.y = 1; the default 'exact' keeps the line's colour unmodified)
  col = mix(col, vec3(dot(col, LUM)), MUTE_GREY * mute) * mix(1.0, MUTE_DARK, mute);
  band = mix(band, vec3(dot(band, LUM)), MUTE_GREY * mute) * mix(1.0, MUTE_DARK, mute);
  // other lines' trains while a line is picked step back in NEUTRAL grey (the rest network's look), never as a faded
  // or greyed line colour: official line colours are shown exact or not at all
  vec3 REST = vec3(0.667, 0.667, 0.69);
  col = mix(col, REST, dim);
  band = mix(band, REST, dim);
  v_col = vec4(col, a_info.y * mix(1.0, 0.4, dim));
  v_band = vec4(band, a_look.z * hw);
  v_under = under * u_under.z;
  v_live = vec4(mix(LIVE_C, REST, dim), bit(a_info.x, 128.0) * (1.0 - trail) * u_ring);
  v_flags = vec4(head, tail, bit(a_info.x, 4.0), sel);
  float c = min(u_corner, hw);
  v_r = min(vec2(mix(c, hw * 0.95, head), mix(c, hw * 0.55, tail)), vec2(hl));
  v_trail = vec3(trail, a_info.z, a_info.w);
}`;

const CAR_FS = `
precision mediump float;
uniform mediump float u_pass; // 0: shadow and outline, 1: the car
uniform vec4 u_look;     // detail, fine, aa (css px), halo
uniform vec2 u_style;    // cab, joints
varying vec2 v_p;
varying vec2 v_half;
varying vec2 v_shadow;
varying vec4 v_col;
varying vec4 v_flags;
varying vec2 v_r;
varying vec3 v_trail;
varying vec4 v_band;
varying float v_under;
varying vec4 v_live;
float box(vec2 p, vec2 b, vec2 r) {
  float rr = p.x > 0.0 ? r.x : r.y;
  vec2 q = abs(p) - b + vec2(rr);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}
float pad(vec2 p, vec2 c, vec2 h, float r) { vec2 q = abs(p - c) - h + vec2(r); return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 p = v_p, hb = v_half;
  float hl = hb.x, hw = hb.y, aa = u_look.z;
  float head = v_flags.x, tail = v_flags.y, doors = v_flags.z, sel = v_flags.w;
  float d = box(p, hb, v_r);
  vec3 line = v_col.rgb;
  if (v_trail.x > 0.5) {
    // the streak: the line's colour fading out behind the train, soft at its edges; under the trains only
    if (u_pass > 0.5) discard;
    float u = clamp((p.x + hl) / (2.0 * hl), 0.0, 1.0);
    float a = mix(v_trail.y, v_trail.z, u) * (1.0 - smoothstep(hw * 0.2, hw + aa, abs(p.y)));
    gl_FragColor = vec4(line, 1.0) * a * v_col.a;
    return;
  }
  if (u_pass < 0.5) {
    // the casing: white, thinner below ground (no shadow there: it is under the street)
    float halo = mix(u_look.w, min(u_look.w, 0.7), v_under) + 0.5 * sel;
    float a = 1.0 - smoothstep(halo - aa, halo + aa, d);
    float ds = box(p - v_shadow, hb, v_r);
    float sh = 0.16 * (1.0 - smoothstep(-0.6, 3.2, ds)) * (1.0 - v_under);
    vec4 o = vec4(mix(vec3(1.0), vec3(0.09, 0.09, 0.1), sel), 1.0) * a;
    // live: a thin solid ring in the live green just outside the casing, every zoom (no pulse, nothing moves)
    float rw = v_live.w;
    if (rw > 0.0) o += vec4(v_live.rgb, 1.0) * (1.0 - smoothstep(halo + rw - aa, halo + rw + aa, d)) * (1.0 - a);
    o += vec4(0.06, 0.08, 0.13, 1.0) * sh * (1.0 - o.a);
    float glow = sel * 0.24 * pow(1.0 - smoothstep(0.0, 9.0, d), 1.4);
    o += vec4(line, 1.0) * glow * (1.0 - o.a);
    gl_FragColor = o * v_col.a;
    return;
  }
  float cov = 1.0 - smoothstep(-aa, aa, d);
  if (cov <= 0.001) discard;
  float det = u_look.x, fine = u_look.y, cab = u_style.x;
  float ay = abs(p.y) / hw;
  // the car: its colour, a little darker towards the sides (a rounded roof)
  vec3 c = line * (1.0 - 0.14 * ay * ay);
  // the type's stripe along the roof, the whole length of the train (it reads from far out, where windows do not)
  float bw = v_band.w;
  if (bw > 0.05) c = mix(c, v_band.rgb, 1.0 - smoothstep(bw - aa, bw + aa, abs(p.y)));
  // one pale window band per car; on a cab the windscreen takes the front (narrower over a stripe)
  float front = hl - mix(hw * 0.32, hw * 1.3, head), back = -hl + mix(hw * 0.32, hw * 0.5, tail);
  float wy = bw > 0.05 ? hw * 0.16 : hw * 0.3;
  float band = pad(p, vec2((front + back) * 0.5, 0.0), vec2(max((front - back) * 0.5, 0.3), wy), wy);
  c = mix(c, mix(line, vec3(1.0), 0.55), (1.0 - smoothstep(-aa, aa, band)) * det * (bw > 0.05 ? 0.5 : 1.0));
  // where one car meets the next: a dark seam (not at the nose or the tail)
  float seamF = (1.0 - head) * (1.0 - smoothstep(0.45, 0.45 + aa * 2.0, hl - 0.35 - p.x));
  float seamB = (1.0 - tail) * (1.0 - smoothstep(0.45, 0.45 + aa * 2.0, p.x + hl - 0.35));
  c = mix(c, line * 0.42, max(seamF, seamB) * u_style.y);
  // cab: dark windscreen behind the nose, headlights at the very front; tail lights on the last car
  float ws = pad(p, vec2(hl - hw * 0.66, 0.0), vec2(hw * 0.3, hw * 0.64), hw * 0.28);
  c = mix(c, vec3(0.12, 0.13, 0.16), (1.0 - smoothstep(-aa, aa, ws)) * cab * head);
  vec2 lampF = vec2(hl - hw * 0.17, hw * 0.5), lampB = vec2(-hl + hw * 0.17, hw * 0.5);
  float lr = max(hw * 0.17, 0.75);
  vec2 q = vec2(p.x, abs(p.y));
  c = mix(c, vec3(1.0, 0.96, 0.82), (1.0 - smoothstep(lr - aa, lr + aa, length(q - lampF))) * head * fine);
  c = mix(c, vec3(1.0, 0.23, 0.19), (1.0 - smoothstep(lr - aa, lr + aa, length(q - lampB))) * tail * fine);
  // doors lit along both sides while it stands at a platform
  float cell = hl * 0.62;
  float dx = abs(p.x - cell * floor(p.x / cell + 0.5));
  float door = (1.0 - smoothstep(0.7 - aa, 0.7 + aa, dx)) * smoothstep(hw - 1.4 - aa, hw - 1.4 + aa, abs(p.y)) * step(abs(p.x), hl - hw * 0.7);
  c = mix(c, vec3(1.0, 0.86, 0.36), door * doors * fine);
  gl_FragColor = vec4(c, 1.0) * cov * v_col.a;
}`;

// Labels are placed on the CPU (screen px), so the GPU only copies each one's cell of the atlas into its rectangle.
const LABEL_VS = `
precision highp float;
attribute vec2 a_corner;
attribute vec4 a_rect;   // top left x, y and width, height (css px from the canvas' top left)
attribute vec4 a_cell;   // atlas x, y (px), alpha, -
uniform vec2 u_view;
uniform vec2 u_atlas;
uniform float u_scale;   // atlas px per css px
varying vec2 v_uv;
varying float v_a;
void main() {
  vec2 P = a_rect.xy + a_corner * a_rect.zw;
  gl_Position = vec4(P.x / u_view.x * 2.0 - 1.0, 1.0 - P.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = (a_cell.xy + a_corner * a_rect.zw * u_scale) / u_atlas;
  v_a = a_cell.z;
}`;

const LABEL_FS = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
varying float v_a;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * v_a; }`;

// Train labels drawn once each with a white halo into one canvas (shelf-packed), uploaded as grey + alpha. Emptied
// and refilled when full. Widths are measured once per text and cached (the placement pass needs them first).
class Labels {
  constructor() {
    this.S = Math.min(3, Math.max(1, Math.round(globalThis.devicePixelRatio || 1)));
    this.rowH = 18; this.W = 2048; this.H = this.rowH * this.S * 28;
    this.x = 0; this.y = 0; this.full = false; this.cells = new Map(); this.widths = new Map(); this.version = 0; this.canvas = null; this.g = null;
  }
  ctx() {
    if (this.g || typeof document === 'undefined') return this.g;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.W; this.canvas.height = this.H;
    this.g = this.canvas.getContext('2d');
    if (this.g) { this.g.font = FONT.replace(`${FONT_PX}px`, `${FONT_PX * this.S}px`); this.g.textBaseline = 'middle'; this.g.lineJoin = 'round'; }
    return this.g;
  }
  /** css px width of a label's cell (text + 4 px each side). */
  width(text) {
    let w = this.widths.get(text);
    if (w !== undefined) return w;
    const g = this.ctx();
    w = Math.ceil((g ? g.measureText(text).width / this.S : text.length * 6.6) + 8);
    if (this.widths.size > 4000) this.widths.clear();
    this.widths.set(text, w);
    return w;
  }
  /** The atlas cell of a label; dark = the picked / followed train (#1C1C21), the rest in the station names' ink
   * (#55555D, network-layer.js) so 1,500 destinations never out-shout the places. */
  get(text, dark = false) {
    const key = dark ? `\u0001${text}` : text;
    const hit = this.cells.get(key);
    if (hit || this.full) return hit || null;
    const g = this.ctx();
    if (!g) return null;
    const S = this.S, rh = this.rowH * S, w = Math.ceil(this.width(text) * S);
    if (this.x + w > this.W) { this.x = 0; this.y += rh; }
    if (this.y + rh > this.H) { this.full = true; return null; }
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 3.4 * S; g.strokeText(text, this.x + 4 * S, this.y + rh / 2 + 0.5 * S);
    g.fillStyle = dark ? '#1C1C21' : '#55555D'; g.fillText(text, this.x + 4 * S, this.y + rh / 2 + 0.5 * S);
    const cell = { x: this.x, y: this.y };
    this.x += w + 2 * S; this.cells.set(key, cell); this.version++;
    return cell;
  }
  reset() { this.cells.clear(); this.x = this.y = 0; this.full = false; this.g?.clearRect(0, 0, this.W, this.H); this.version++; }
}

function compile(gl, vs, fs, attribs) {
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Tokyo train shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Tokyo train link: ${gl.getProgramInfoLog(p)}`);
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

// A line's path in Mercator offsets on model.js's metres (model._geo: so `along` lands where the model says), else its own.
const distance = (a, b) => {
  const r = Math.PI / 180, p = a[1] * r, q = b[1] * r;
  return 12742000 * Math.asin(Math.sqrt(Math.sin((q - p) / 2) ** 2 + Math.cos(p) * Math.cos(q) * Math.sin((b[0] - a[0]) * r / 2) ** 2));
};
function mercGeo(model, li) {
  const g0 = model._geo?.[li];
  if (g0 && g0.n >= 1 && g0.cum) {
    const n = g0.n, x = new Float64Array(n), y = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = mercX(g0.lng[i]) - OX; y[i] = mercY(g0.lat[i]) - OY; }
    return { n, x, y, c: g0.cum, L: g0.length, loop: !!g0.loop };
  }
  const line = model.lines[li], P = line.path || [], n = P.length, x = new Float64Array(n), y = new Float64Array(n), c = new Float64Array(n);
  for (let i = 0; i < n; i++) { x[i] = mercX(P[i][0]) - OX; y[i] = mercY(P[i][1]) - OY; if (i) c[i] = c[i - 1] + distance(P[i - 1], P[i]); }
  let L = n ? c[n - 1] : 0;
  if (line.length > 0 && L > 0 && Math.abs(line.length / L - 1) < 0.05) { const k = line.length / L; for (let i = 1; i < n; i++) c[i] *= k; L = line.length; }
  return { n, x, y, c, L, loop: !!line.loop };
}
/** The point m metres along geometry g into out[o], out[o + 1] (Mercator offsets). Loops wrap; past either end of an
 * open line it carries on straight, so a train standing at a terminus sits centred on its station. */
export function at(g, m, out, o = 0) {
  const c = g.c, n = g.n, X = g.x, Y = g.y;
  if (n < 2) { out[o] = n ? X[0] : 0; out[o + 1] = n ? Y[0] : 0; return out; }
  if (g.loop && g.L > 0) { m %= g.L; if (m < 0) m += g.L; } else if (m <= 0 || m >= c[n - 1]) {
    const end = m > 0, i = end ? n - 1 : 0, j = end ? n - 2 : 1;
    const dx = X[i] - X[j], dy = Y[i] - Y[j], k = (end ? m - c[n - 1] : -m) / MPU / (Math.hypot(dx, dy) || 1);
    out[o] = X[i] + dx * k; out[o + 1] = Y[i] + dy * k;
    return out;
  }
  let a = 1, b = n - 1;
  while (a < b) { const mid = (a + b) >> 1; if (c[mid] < m) a = mid + 1; else b = mid; }
  const len = c[a] - c[a - 1], f = len > 0 ? (m - c[a - 1]) / len : 0;
  out[o] = X[a - 1] + (X[a] - X[a - 1]) * f; out[o + 1] = Y[a - 1] + (Y[a] - Y[a - 1]) * f;
  return out;
}

// Screen px (from the canvas' top left) of Mercator offset (x, y) under Q (the map's matrix, origin folded in), into
// S[o], S[o + 1]; false behind the camera. The same sums as the shaders' scr().
function project(Q, x, y, W, H, S, o) {
  const w = Q[3] * x + Q[7] * y + Q[15];
  if (w <= 1e-9) return false;
  S[o] = ((Q[0] * x + Q[4] * y + Q[12]) / w + 1) * 0.5 * W;
  S[o + 1] = (1 - (Q[1] * x + Q[5] * y + Q[13]) / w) * 0.5 * H;
  return true;
}

// The map's own placed labels (stations, places, roads) from MapLibre's collision grid, so a train label never covers
// one. Internal to MapLibre (pinned 5.24.0): read defensively, every box and circle in px + the grid's 100 px padding.
function mapBoxes(map, out) {
  out.length = 0;
  try {
    const ci = map?.style?.placement?.collisionIndex;
    // (bboxes = [x1, y1, x2, y2, ...] boxes; circles = [x, y, r, ...] of line-placed labels, read when an array)
    if (ci?.grid && Array.isArray(ci.grid.bboxes)) out.push(ci.grid);
    if (ci?.ignoredGrid && Array.isArray(ci.ignoredGrid.bboxes)) out.push(ci.ignoredGrid);
  } catch { out.length = 0; }
  return out;
}
const PAD = 100;

const LOOK = Symbol('tokyo.trains.look'), SHOWN = Symbol('tokyo.trains.shown');

/**
 * The trains layer for `map.addLayer`, plus what layer.js needs. model = model.js's createModel() result.
 * opts: now() ms clock; reduced (prefers-reduced-motion MediaQueryList-like); frames (false in tests: no timers);
 * lang 'en' | 'ja' | 'id'; typeStyle(type, line, run) and typeLabel(type, lang) from types.js; label(run, lang) to
 * override the text; lanePx(z) from style.js; avoidMapLabels (default true).
 */
export function createTrains(model, opts = {}) {
  const { now = Date.now, reduced = { matches: false }, frames = true } = opts;
  let lang = opts.lang || 'en', typeStyle = opts.typeStyle || null, typeLabel = opts.typeLabel || null, lanePx = opts.lanePx || null;
  const labelOf = opts.label || ((run, l) => trainLabel(model, run, l, typeLabel));
  const avoidMap = opts.avoidMapLabels !== false;
  const labels = new Labels();
  const frame = createFrame(model);
  const geos = [];
  const geoOf = (li) => geos[li] || (geos[li] = mercGeo(model, li));
  let lookV = 1;
  const lookOf = (run) => {
    let L = run[LOOK];
    if (L && L.v === lookV) return L;
    const line = model.lines[run.line], type = model.types?.[run.type], base = defaultLook(line, type);
    let s = base;
    if (typeStyle) { try { s = lookFrom(typeStyle(type, line, run), base, line); } catch { s = base; } }
    const cars = clamp((run.cars || line?.cars || 10) | 0, 1, 15);
    L = { v: lookV, body: s.body, band: s.band, weight: s.weight, cars, scale: carScale(cars), rank: clamp(type?.rank | 0, 0, 4),
      lanes: !!(line?.lanes?.length >= 2), offset: +line?.offset || 0, base: null, text: null, dm: 0, lang: '' };
    run[LOOK] = L;
    return L;
  };
  // a run's label in the current language, with its delay from a whole minute when it is measured live
  const textOf = (run, L, dm = 0) => {
    if (L.lang !== lang || L.base == null) { let t = ''; try { t = labelOf(run, lang) || ''; } catch { t = ''; } L.base = t; L.lang = lang; L.text = null; }
    if (L.text == null || L.dm !== dm) { L.text = L.base && dm ? L.base + delayText(dm, lang) : L.base; L.dm = dm; }
    return L.text;
  };
  // the drawing lane at m metres along a line (the network build's line.lanes; loops wrap), else line.offset
  const laneOf = (L, line, g, m) => {
    if (!L.lanes) return L.offset;
    if (g.loop && g.L > 0) { m %= g.L; if (m < 0) m += g.L; }
    return laneAt(line, m);
  };
  const stationUnder = (run, i, line) => {
    const st = model.stations[run.stops[i]?.s];
    return st && typeof st.underground === 'boolean' ? st.underground : !!line?.underground;
  };

  // instance buffers (grow, never shrink), the drawn car centres for taps, label candidates
  const cars = { data: new Float32Array(STRIDE * 4096), n: 0 }, tags = { data: new Float32Array(TAG * 256), n: 0 };
  const grow = (buf, need) => { if (buf.data.length < need) { const d = new Float32Array(Math.max(need, buf.data.length * 2)); d.set(buf.data); buf.data = d; } };
  let hitXY = new Float64Array(2 * 4096), hitRun = [], hitN = 0;
  let cand = { i: new Int32Array(1024), key: new Uint8Array(1024), u: new Uint8Array(1024), dm: new Uint16Array(1024), fs: new Float64Array(4 * 1024), lat: new Float32Array(1024), n: 0 };
  const growCand = (need) => {
    if (cand.i.length >= need) return;
    const m = Math.max(need, cand.i.length * 2), c = { i: new Int32Array(m), key: new Uint8Array(m), u: new Uint8Array(m), dm: new Uint16Array(m), fs: new Float64Array(4 * m), lat: new Float32Array(m), n: cand.n };
    c.i.set(cand.i); c.key.set(cand.key); c.u.set(cand.u); c.dm.set(cand.dm); c.fs.set(cand.fs); c.lat.set(cand.lat); cand = c;
  };
  const grids = [];
  // where labels may go: the canvas minus the page's bars and sheet (setInsets), else minus MapLibre's padding
  let insets = null;
  const ins = { top: 2, right: 2, bottom: 2, left: 2 };
  const insetsNow = (W, H) => {
    let p = null;
    try { p = typeof insets === 'function' ? insets(W, H) : insets || map?.getPadding?.() || null; } catch { p = null; }
    ins.top = 2 + Math.max(0, +p?.top || 0); ins.right = 2 + Math.max(0, +p?.right || 0);
    ins.bottom = 2 + Math.max(0, +p?.bottom || 0); ins.left = 2 + Math.max(0, +p?.left || 0);
  };
  const order = { idx: new Int32Array(1024), count: new Int32Array(40) };
  const boxes = { data: new Float32Array(4 * 512), n: 0 };
  let tagRect = new Float32Array(4 * 256), tagRun = []; // shown labels' rects, for taps
  const pt = new Float64Array(6), S = new Float64Array(4);
  const Q = new Float64Array(16), lastM = new Float64Array(16);
  const placed = { ms: 0, every: 0, count: 0, z: -1, W: 0, H: 0, dirty: true };
  let vis = new Uint8Array(2048), split = 0, liveIn = 0, liveOn = true, hidden = false; // liveOn: mark measured trains (ring + delay)
  let avoid = new Float32Array(64), avoidN = 0; // boxes (css px on the canvas) labels keep out of: the page's bars and sheet // per frame train: 0 out of view, 1 below ground, 2 above; cars below ground come first
  let rails = null;   // jaktrack: the tracks side by side along each line and the running side (rails.js); null = no data
  let elev = null;    // per line index: Float64Array [from, to, ...] of its tunnels (m along the line), [] = none; null = no the heights build data
  // trains below ground: 'exact' (DEFAULT: small, opaque, the line's exact colour: ODPT guideline 4 wants official
  // line colours unmodified), 'full' (the underground view: full size), 'muted' (an option nobody uses: muted colour)
  let muted = false, smallUg = true;
  let focus = { line: -1, run: null, key: null }, show = null, map = null, timer = 0, arranged = 0;
  const stats = { frames: 0, placements: 0, cars: 0, trains: 0, below: 0, running: 0, labels: 0, candidates: 0, fps: 0, cpuMs: 0, arrangeMs: 0, arrangeLast: 0, frameLast: 0 };
  const times = new Float64Array(128); let timesN = 0, timesI = 0;
  const clock = () => { const ms = now(); return reduced.matches ? Math.floor(ms / 1000) * 1000 : ms; };
  // trainSizes() for the zoom being drawn, made once per zoom (not per frame)
  let sizesZ = NaN, sizesK = null;
  const sizes = (z) => (z === sizesZ ? sizesK : (sizesZ = z, sizesK = trainSizes(z)));

  /** Place every train at ms for view (zoom z, matrix Q, W x H css px). */
  function arrange(ms, z, W, H) {
    const t0 = performance.now(), k = sizes(z), pxPerM = 512 * 2 ** z / MPU, lane = lanePx ? lanePx(z) : k.lane;
    const n = frame.update(ms), liveF = frame.live;
    stats.running = n;
    if (labels.full || labels.cells.size > 600) labels.reset();
    cars.n = 0; tags.n = 0; hitN = 0; cand.n = 0; split = 0;
    const pad = 60 + k.len * 1.3;
    let fastest = 0, selected = -1, trainsIn = 0, refocus = false, below = 0;
    liveIn = 0;
    const id = ++arranged;
    if (vis.length < n) vis = new Uint8Array(Math.max(n, vis.length * 2));
    // which trains are in view, and whether each runs below ground (its middle): 0 out of view, 1 below, 2 above
    for (let i = 0; i < n; i++) {
      vis[i] = 0;
      const run = frame.runs[i];
      if (show && !show(run)) continue;
      const li = frame.line[i], g = geoOf(li);
      at(g, frame.along[i], pt, 0);
      if (!project(Q, pt[0], pt[1], W, H, S, 0) || S[0] < -pad || S[0] > W + pad || S[1] < -pad || S[1] > H + pad) continue;
      trainsIn++;
      if (run === focus.run || (focus.key && run.key === focus.key && !focus.run)) { selected = i; continue; }
      if (frame.speed[i] > fastest) fastest = frame.speed[i];
      // a live train below ground is drawn at full strength, with the trains in the open
      vis[i] = liveOn && liveF && liveF[i] === 1 ? 2 : underAt(i, run, li, g, frame.along[i]) ? 1 : 2;
    }
    // trains below ground first (small, under everything), then the trains in the open (and the live ones) over them
    for (let i = 0; i < n; i++) if (vis[i] === 1) { write(i, frame.runs[i], geoOf(frame.line[i]), k, pxPerM, lane, false, true); below++; }
    split = cars.n;
    for (let i = 0; i < n; i++) if (vis[i] === 2) write(i, frame.runs[i], geoOf(frame.line[i]), k, pxPerM, lane, false, false);
    // a picked train that ran on as its next run (through-running, the next lap): keep it picked
    if (selected < 0 && focus.run && focus.run.next?.length) {
      const nx = model.runById?.get(focus.run.next[0]);
      for (let i = 0; nx && i < n; i++) if (frame.runs[i] === nx) { focus.run = nx; refocus = true; break; }
    }
    // the picked train last, so it is drawn over any other
    if (selected >= 0) {
      const run = frame.runs[selected], li = frame.line[selected], g = geoOf(li);
      fastest = Math.max(fastest, frame.speed[selected]);
      write(selected, run, g, k, pxPerM, lane, true, underAt(selected, run, li, g, frame.along[selected]));
    }
    if (k.label > 0.01) declutter(k, W, H, id);
    stats.trains = trainsIn; stats.below = below; stats.live = liveIn; stats.cars = cars.n; stats.labels = tags.n; stats.candidates = cand.n;
    // next placement: about when the fastest train on screen has moved a pixel
    const px = fastest * pxPerM;
    const fps = reduced.matches ? 1 : px < 0.5 ? 1 : px < 2 ? 4 : px < 6 ? 12 : px < 18 ? 24 : px < 45 ? 40 : 60;
    placed.ms = ms; placed.every = 1000 / fps - 4; placed.count++; placed.z = z; placed.W = W; placed.H = H; placed.dirty = refocus;
    stats.placements = placed.count;
    stats.arrangeLast = performance.now() - t0;
    stats.arrangeMs = stats.arrangeMs * 0.9 + stats.arrangeLast * 0.1;
  }

  // Below ground at m metres along line li? the heights build's tunnels (elev-v1.json: rail level below the street) where we have
  // them for the line, so a train turns muted car by car at the portal; else the stations it is between / stands at.
  function underAt(i, run, li, g, m) {
    const U = elev ? elev[li] : null;
    if (U) {
      if (!U.length) return false;
      if (g.loop && g.L > 0) { m %= g.L; if (m < 0) m += g.L; }
      let lo = 0, hi = (U.length >> 1) - 1, f = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (U[2 * mid] <= m) { f = mid; lo = mid + 1; } else hi = mid - 1; }
      return f >= 0 && m < U[2 * f + 1];
    }
    const line = model.lines[run.line], state = frame.state[i], stop = frame.stop[i];
    return state === 0 ? stationUnder(run, stop - 1, line) && stationUnder(run, stop, line) : stationUnder(run, stop, line);
  }

  // One train: a streak behind it while it moves, then its cars front to back; its label becomes a candidate.
  // ug = it runs below ground (its middle): muted, and smaller when zoomed out, unless the underground look is 'full'.
  function write(i, run, g, k, pxPerM, lane, sel, ug) {
    const L = lookOf(run), li = run.line, line = model.lines[li], sgn = frame.sign[i] < 0 ? -1 : 1, s = frame.along[i], alpha = frame.alpha[i];
    const dim = focus.line >= 0 && run.line !== focus.line;
    const live = liveOn && frame.live ? frame.live[i] === 1 : false;
    if (live) { liveIn++; ug = false; }   // live below ground: full strength, never the quiet subway look
    // jaktrack: beside its line only where there are two tracks, on the side trains keep (the heights pack's tracks and
    // hand: right in Indonesia); on single track the train sits on its line. No data for the line: left, as before.
    const two = rails?.has(li) ? Math.min(1, rails.half(li, s) / 1.5) * (rails.hand(li) > 0 ? -1 : 1) : 1;
    const small = ug && smallUg, side = (small ? k.side * k.ugHalf : k.side) * two;
    const Lpx = k.len * L.scale * (small ? k.ugLen : 1), Lm = Lpx / pxPerM, nT = carsDrawn(L.cars, Lpx, k.half), carM = Lm / nT;
    const lat = lateral(laneOf(L, line, g, s), sgn, lane, side);
    const base = (dim ? FLAG.DIM : 0) | (live ? FLAG.LIVE : 0);
    // per car below ground or not (a train at a portal turns car by car); trains without the heights build data go as a whole; a
    // live train is never flagged below ground
    const perCar = !live && !!(elev && elev[li]);
    grow(cars, (cars.n + nT + 3) * STRIDE);
    let f = cars.data;
    // the streak: where the tail was over the last TRAIL_S seconds at this speed, never longer than the train
    const lt = Math.min(frame.speed[i] * TRAIL_S, Lm * 0.9), tailS = s - sgn * Lm / 2;
    if (k.trail > 0.01 && lt * pxPerM > 3) for (let j = 0; j < 3; j++) {
      const mm = tailS - sgn * lt * (j + 0.5) / 3;
      at(g, tailS - sgn * lt * j / 3, pt, 0); at(g, tailS - sgn * lt * (j + 1) / 3, pt, 2);
      const o = cars.n++ * STRIDE;
      f[o] = pt[0]; f[o + 1] = pt[1]; f[o + 2] = pt[2]; f[o + 3] = pt[3];
      f[o + 4] = FLAG.TRAIL | base | ((perCar ? underAt(i, run, li, g, mm) : ug) ? FLAG.UNDER : 0); f[o + 5] = alpha;
      f[o + 6] = k.trail * ((2 - j) / 3) ** 1.5; f[o + 7] = k.trail * ((3 - j) / 3) ** 1.5;
      f[o + 8] = L.body; f[o + 9] = L.body; f[o + 10] = 0; f[o + 11] = L.lanes ? lateral(laneOf(L, line, g, mm), sgn, lane, side) : lat;
    }
    if (hitXY.length < 2 * (hitN + nT)) { const d = new Float64Array(Math.max(2 * (hitN + nT), hitXY.length * 2)); d.set(hitXY); hitXY = d; }
    for (let c = 0; c < nT; c++) {
      const front = s + sgn * (Lm / 2 - c * carM), mid = front - sgn * carM / 2;
      at(g, front, pt, 0); at(g, front - sgn * carM, pt, 2);
      const o = cars.n++ * STRIDE;
      f[o] = pt[0]; f[o + 1] = pt[1]; f[o + 2] = pt[2]; f[o + 3] = pt[3];
      f[o + 4] = (c === 0 ? FLAG.HEAD : 0) | (c === nT - 1 ? FLAG.TAIL : 0) | (frame.doors[i] ? FLAG.DOORS : 0) | (sel ? FLAG.SEL : 0) | base
        | ((perCar ? underAt(i, run, li, g, mid) : ug) ? FLAG.UNDER : 0);
      f[o + 5] = alpha; f[o + 6] = 0; f[o + 7] = 0;
      f[o + 8] = L.body; f[o + 9] = L.band; f[o + 10] = L.weight; f[o + 11] = L.lanes ? lateral(laneOf(L, line, g, mid), sgn, lane, side) : lat;
      hitXY[2 * hitN] = (pt[0] + pt[2]) / 2; hitXY[2 * hitN + 1] = (pt[1] + pt[3]) / 2; hitRun[hitN++] = run;
    }
    // its label, if it is to be placed: the whole train's ends and lateral offset (placed after every train is in)
    if (k.label > 0.01 && alpha > 0.05) {
      growCand(cand.n + 1);
      const c = cand.n++;
      at(g, s + sgn * Lm / 2, cand.fs, 4 * c); at(g, s - sgn * Lm / 2, cand.fs, 4 * c + 2);
      // "+3 min" only from a reported delay FIGURE: a lag live.js read from where the train was reported (Toei trams;
      // model.derived) places the train but claims no minutes
      cand.i[c] = i; cand.lat[c] = lat; cand.u[c] = ug ? 1 : 0; cand.dm[c] = live && frame.delay[i] >= 60 && !model.derived?.has?.(run) ? Math.min(999, Math.floor(frame.delay[i] / 60)) : 0;
      // priority: picked train, picked line, shown last time, trains in the open before those below ground, rank
      cand.key[c] = sel ? 0 : 1 + (focus.line >= 0 && run.line === focus.line ? 0 : 16) + (run[SHOWN] === arranged - 1 ? 0 : 8) + (ug ? 5 : 0) + (4 - L.rank);
    }
  }

  // Labels by priority, each where the shader would have put it (left of the train, outside its track), skipped when
  // it would touch a label already placed or one of the map's own. Placed labels are drawn from the atlas.
  function declutter(k, W, H, id) {
    const N = cand.n;
    if (!N) return;
    if (order.idx.length < N) order.idx = new Int32Array(Math.max(N, order.idx.length * 2));
    const cnt = order.count; cnt.fill(0);
    for (let c = 0; c < N; c++) cnt[cand.key[c] + 1]++;
    for (let b = 1; b < cnt.length; b++) cnt[b] += cnt[b - 1];
    for (let c = 0; c < N; c++) order.idx[cnt[cand.key[c]]++] = c;
    mapBoxes(avoidMap ? map : null, grids);
    insetsNow(W, H);
    boxes.n = 0;
    const lh = labels.rowH;
    for (let r = 0; r < N; r++) {
      const c = order.idx[r], i = cand.i[c], run = frame.runs[i], L = run[LOOK];
      const text = textOf(run, L, cand.dm[c]);
      if (!text) continue;
      const fs = cand.fs, o = 4 * c;
      if (!project(Q, fs[o], fs[o + 1], W, H, S, 0) || !project(Q, fs[o + 2], fs[o + 3], W, H, S, 2)) continue;
      let dx = S[0] - S[2], dy = S[1] - S[3];
      const len = Math.hypot(dx, dy);
      if (len > 1e-3) { dx /= len; dy /= len; } else { dx = 0; dy = -1; }
      const nx = -dy, ny = dx; // right of travel (screen y down)
      const w = labels.width(text), h = lh;
      const out = Math.abs(nx) * w * 0.5 + Math.abs(ny) * h * 0.5;
      // left of the train, beyond its half width (side -1); the picked / followed train may also try its right (+1)
      const box = (side) => {
        const off = cand.lat[c] + side * (k.half + 1 + out);
        const cx = (S[0] + S[2]) * 0.5 + nx * off, cy = (S[1] + S[3]) * 0.5 + ny * off;
        return [cx - w * 0.5, cy - h * 0.5, cx + w * 0.5, cy + h * 0.5];
      };
      // wholly inside the visible map (never cut by the screen edge or under the page's own bars and sheet), clear of
      // every placed label: the picked / followed train too (a train standing at its terminal put "→ Osaki" on
      // "Osaki"), which tries its other side before it goes without a label (rule 9)
      const fits = (b) => !(b[0] < ins.left || b[1] < ins.top || b[2] > W - ins.right || b[3] > H - ins.bottom)
        && !hits(b[0] - GAP, b[1] - GAP, b[2] + GAP, b[3] + GAP, grids);
      const sel = cand.key[c] === 0;
      let bx = box(-1);
      if (!fits(bx)) { if (!sel) continue; bx = box(1); if (!fits(bx)) continue; }
      const [x0, y0, x1, y1] = bx;
      const cell = labels.get(text, sel);
      if (!cell) continue;
      if (boxes.data.length < 4 * (boxes.n + 1)) { const d = new Float32Array(boxes.data.length * 2); d.set(boxes.data); boxes.data = d; }
      const b = 4 * boxes.n++; boxes.data[b] = x0; boxes.data[b + 1] = y0; boxes.data[b + 2] = x1; boxes.data[b + 3] = y1;
      grow(tags, (tags.n + 1) * TAG);
      if (tagRect.length < 4 * (tags.n + 1)) { const d = new Float32Array(tagRect.length * 2); d.set(tagRect); tagRect = d; }
      const dpr = labels.dpr || 1, t = tags.n * TAG, T = tags.data;
      T[t] = Math.floor(x0 * dpr + 0.5) / dpr; T[t + 1] = Math.floor(y0 * dpr + 0.5) / dpr; T[t + 2] = w; T[t + 3] = h;
      T[t + 4] = cell.x; T[t + 5] = cell.y;
      T[t + 6] = frame.alpha[i] * k.label * (run.line !== focus.line && focus.line >= 0 ? 0.35 : 1) * (cand.u[c] ? 0.8 : 1);
      tagRect[4 * tags.n] = x0; tagRect[4 * tags.n + 1] = y0; tagRect[4 * tags.n + 2] = x1; tagRect[4 * tags.n + 3] = y1; tagRun[tags.n] = run;
      tags.n++;
      run[SHOWN] = id;
    }
  }
  function hits(x0, y0, x1, y1, grids) {
    const B = boxes.data;
    for (let b = 0, e = 4 * boxes.n; b < e; b += 4) if (x0 < B[b + 2] && x1 > B[b] && y0 < B[b + 3] && y1 > B[b + 1]) return true;
    // the page's own bars, buttons and sheet over the map (layer.js reads them from the DOM)
    for (let b = 0, e = 4 * avoidN; b < e; b += 4) if (x0 < avoid[b + 2] && x1 > avoid[b] && y0 < avoid[b + 3] && y1 > avoid[b + 1]) return true;
    for (let gi = 0; gi < grids.length; gi++) {
      const bb = grids[gi].bboxes, X0 = x0 + PAD, Y0 = y0 + PAD, X1 = x1 + PAD, Y1 = y1 + PAD;
      for (let b = 0, e = bb.length; b < e; b += 4) if (X0 < bb[b + 2] && X1 > bb[b] && Y0 < bb[b + 3] && Y1 > bb[b + 1]) return true;
      // labels placed along a line (road and river names) sit in the grid as circles [x, y, r] (
      // "Express → Chuo-rinkan" over "Eitai-dori Avenue")
      const cc = grids[gi].circles;
      if (!Array.isArray(cc)) continue;
      for (let c = 0, e = cc.length; c < e; c += 3) {
        const cx = cc[c], cy = cc[c + 1], r = cc[c + 2];
        if (cx + r <= X0 || cx - r >= X1 || cy + r <= Y0 || cy - r >= Y1) continue;
        const dx = cx < X0 ? X0 - cx : cx > X1 ? cx - X1 : 0, dy = cy < Y0 ? Y0 - cy : cy > Y1 ? cy - Y1 : 0;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  const layer = {
    id: 'tokyo-trains', type: 'custom', renderingMode: '2d', lost: false,
    onAdd(m, gl) {
      map = m; this.gl = gl;
      try { this.init(gl); } catch (err) { this.lost = true; console.error('[tokyo-trains]', err.message); }
      this._lost = () => { this.lost = true; };
      this._restored = () => { this.lost = false; try { this.init(this.gl); placed.dirty = true; } catch { this.lost = true; } };
      m.on('webglcontextlost', this._lost); m.on('webglcontextrestored', this._restored);
    },
    init(gl) {
      const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
      this.gl2 = gl2;
      if (gl2) { this.div = (l, d) => gl.vertexAttribDivisor(l, d); this.draw = (n) => gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n); this.vao = (v) => gl.bindVertexArray(v); } else {
        const ext = gl.getExtension('ANGLE_instanced_arrays'), vao = gl.getExtension('OES_vertex_array_object');
        if (!ext) throw new Error('Tokyo trains: no instancing');
        this.div = (l, d) => ext.vertexAttribDivisorANGLE(l, d); this.draw = (n) => ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, n); this.vao = (v) => { if (vao) vao.bindVertexArrayOES(v); };
      }
      this.car = compile(gl, CAR_VS, CAR_FS, ['a_corner', 'a_ends', 'a_info', 'a_look']);
      this.tag = compile(gl, LABEL_VS, LABEL_FS, ['a_corner', 'a_rect', 'a_cell']);
      this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.unit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.unit); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      this.bufCars = gl.createBuffer(); this.bufTags = gl.createBuffer(); this.capCars = 0; this.capTags = 0;
      this.tex = gl.createTexture(); this.texVersion = -1;
    },
    onRemove(m, gl) {
      clearTimeout(timer); timer = 0;
      m.off('webglcontextlost', this._lost); m.off('webglcontextrestored', this._restored);
      if (!this.car) return;
      for (const b of [this.quad, this.unit, this.bufCars, this.bufTags]) gl.deleteBuffer(b);
      gl.deleteTexture(this.tex); gl.deleteProgram(this.car.p); gl.deleteProgram(this.tag.p);
      this.car = null;
    },
    attr(gl, loc, buf, size, stride, offset, div) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset); this.div(loc, div);
    },
    reset(gl) { for (let i = 0; i < 4; i++) { this.div(i, 0); gl.disableVertexAttribArray(i); } },
    // upload the first `count` floats of `data` into buffer `buf` (grown by doubling; sub-uploads, no new views on WebGL2)
    upload(gl, buf, data, count, capKey) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (this[capKey] < count) { this[capKey] = Math.max(count, data.length); gl.bufferData(gl.ARRAY_BUFFER, this[capKey] * 4, gl.DYNAMIC_DRAW); }
      if (!count) return;
      if (this.gl2) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count); else gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count));
    },
    render(gl, args) {
      if (this.lost || !this.car) return;
      const t0 = performance.now(), ms = clock(), z = map.getZoom();
      const cvs = map.getCanvas(), W = cvs.clientWidth || cvs.width, H = cvs.clientHeight || cvs.height, dpr = cvs.width / Math.max(1, W);
      labels.dpr = dpr;
      // the map's matrix with our origin folded in (float64), and whether the view changed since the last placement
      const m = args.defaultProjectionData.mainMatrix;
      let moved = placed.dirty || W !== placed.W || H !== placed.H;
      for (let i = 0; i < 16; i++) if (m[i] !== lastM[i]) { moved = true; lastM[i] = m[i]; }
      for (let i = 0; i < 12; i++) Q[i] = m[i];
      for (let i = 0; i < 4; i++) Q[12 + i] = m[i] * OX + m[4 + i] * OY + m[12 + i];
      // Place the trains again only when the view or the focus changed, or when they have moved about a pixel.
      this.vao(null);
      if (moved || ms - placed.ms >= placed.every || ms < placed.ms) {
        arrange(ms, z, W, H);
        this.upload(gl, this.bufCars, cars.data, cars.n * STRIDE, 'capCars');
        this.upload(gl, this.bufTags, tags.data, tags.n * TAG, 'capTags');
      }
      const k = sizes(z);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const M = this.m || (this.m = new Float32Array(16));
      for (let i = 0; i < 16; i++) M[i] = Q[i];
      const aa = 0.6 / Math.max(1, dpr) + 0.15;
      if (cars.n) {
        const C = this.car;
        gl.useProgram(C.p);
        gl.uniformMatrix4fv(C.u.u_matrix, false, M);
        gl.uniform2f(C.u.u_view, W, H);
        gl.uniform4f(C.u.u_geo, k.half, 0, 0.35, k.halo);
        gl.uniform1f(C.u.u_corner, k.corner);
        gl.uniform4f(C.u.u_look, k.detail, k.fine, aa, k.halo);
        gl.uniform2f(C.u.u_style, k.cab, k.joint);
        gl.uniform3f(C.u.u_under, smallUg ? k.ugHalf : 1, muted ? 1 : 0, smallUg ? 1 : 0);
        gl.uniform1f(C.u.u_ring, liveOn ? k.ring : 0);
        this.attr(gl, 0, this.quad, 2, 0, 0, 0);
        // two groups: the trains below ground, then those in the open (and the picked one) over them; in each,
        // outlines and shadows first, then every car over them: cars of one train join without seams
        for (let gi = 0; gi < 2; gi++) {
          const first = gi === 0 ? 0 : split, count = gi === 0 ? split : cars.n - split;
          if (count <= 0) continue;
          const b = first * STRIDE * 4;
          this.attr(gl, 1, this.bufCars, 4, STRIDE * 4, b, 1);
          this.attr(gl, 2, this.bufCars, 4, STRIDE * 4, b + 16, 1);
          this.attr(gl, 3, this.bufCars, 4, STRIDE * 4, b + 32, 1);
          gl.uniform1f(C.u.u_pass, 0); this.draw(count);
          gl.uniform1f(C.u.u_pass, 1); this.draw(count);
        }
        this.reset(gl);
      }
      if (tags.n) {
        const T = this.tag;
        if (labels.version !== this.texVersion && labels.canvas) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, gl.LUMINANCE_ALPHA, gl.UNSIGNED_BYTE, labels.canvas);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          for (const [p, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, p, v);
          this.texVersion = labels.version;
        }
        gl.useProgram(T.p);
        gl.uniform2f(T.u.u_view, W, H);
        gl.uniform2f(T.u.u_atlas, labels.W, labels.H);
        gl.uniform1f(T.u.u_scale, labels.S);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(T.u.u_tex, 0);
        this.attr(gl, 0, this.unit, 2, 0, 0, 0);
        this.attr(gl, 1, this.bufTags, 4, TAG * 4, 0, 1);
        this.attr(gl, 2, this.bufTags, 4, TAG * 4, 16, 1);
        this.draw(tags.n);
        this.reset(gl);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      const t1 = performance.now();
      times[timesI] = t1; timesI = (timesI + 1) & 127; if (timesN < 128) timesN++;
      let fps = 0; for (let i = 0; i < timesN; i++) if (times[i] > t1 - 1000) fps++;
      stats.frames++; stats.fps = fps; stats.frameLast = t1 - t0; stats.cpuMs = stats.cpuMs * 0.9 + (t1 - t0) * 0.1;
      if (frames) wake(placed.every - (ms - placed.ms));
    },
  };
  let due = 0;
  const repaint = () => { timer = 0; if (!(typeof document !== 'undefined' && document.hidden)) map?.triggerRepaint(); };
  function wake(ms = 0) {
    if (!map || (typeof document !== 'undefined' && document.hidden)) return;
    const at_ = performance.now() + Math.max(0, ms);
    if (timer && due <= at_ + 2) return;
    clearTimeout(timer); due = at_;
    timer = setTimeout(repaint, Math.max(0, ms));
  }
  const lineIndex = (line) => (line == null ? -1 : typeof line === 'number' ? line : model.lineById?.get(line) ? model.lines.indexOf(model.lineById.get(line)) : model.lines.findIndex((l) => l.id === line));
  return {
    layer, wake, frame,
    stop() { clearTimeout(timer); timer = 0; },
    /** Picked line (index or id) and train (run id or key): the line's trains stay bright, others dim; the train is
     * drawn last with a dark outline and its label is placed first. */
    setFocus(line, train) {
      const run = train ? model.runById?.get(train) || null : null;
      focus = { line: lineIndex(line), run, key: train && !run ? train : null };
      placed.dirty = true; wake();
    },
    /** Draw only the trains fn(run) keeps (null: all). */
    setShow(fn) { show = typeof fn === 'function' ? fn : null; placed.dirty = true; wake(); },
    setLang(l) { if (l && l !== lang) { lang = l; labels.reset(); placed.dirty = true; wake(); } },
    /** types.js hooks when they arrive after the layer: typeStyle(type, line, run), typeLabel(type, lang). */
    setTypes({ style = typeStyle, label = typeLabel } = {}) { typeStyle = style; typeLabel = label; lookV++; labels.reset(); placed.dirty = true; wake(); },
    setLanePx(fn) { lanePx = typeof fn === 'function' ? fn : null; placed.dirty = true; wake(); },
    /** the heights build's elev-v1.json (parsed): trains turn muted exactly where a tunnel starts. null = station flags only. */
    setElevation(json) {
      rails = json && json.tracks ? railsOf(model, json) : null;
      elev = null;
      if (json && json.lines && typeof json.lines === 'object') {
        elev = model.lines.map((line) => {
          const R = json.lines[line.id];
          if (!Array.isArray(R)) return null; // a line ELEV does not cover: its stations decide
          const len = json.len?.[line.id], k = len > 0 && line.length > 0 ? line.length / len : 1;
          const out = [];
          for (const r of R) {
            if (!(r?.[2] < 0)) continue;
            const a = r[0] * k, b = r[1] * k, n = out.length;
            if (n && a - out[n - 1] <= 1) out[n - 1] = Math.max(out[n - 1], b); else out.push(a, b);
          }
          return Float64Array.from(out);
        });
      }
      placed.dirty = true; wake();
    },
    /** Mark trains with a fresh live position (live.js's model.measured via model.js's frames, live 1): a thin ring in the live
     * green at every zoom, full strength below ground, the delay in the label from a whole minute. false = every train
     * looks scheduled (estimated ones never get the mark). */
    setLive(on) { liveOn = !!on; placed.dirty = true; wake(); },
    /** Trains below ground: 'exact' (default: small, opaque, the line's exact colour, under the rest: ODPT guideline 4
     * "unmodified"), 'full' (the underground view: full size), 'muted' (kept as an option, unused: muted colour). */
    setUnderground(look) { muted = look !== 'full' && look !== 'exact'; smallUg = look !== 'full'; placed.dirty = true; wake(); },
    /** Hide the 2D trainsets (the 3D city's 3D view draws every train itself); taps find no train while hidden. */
    setHidden(h) { hidden = !!h; if (map?.getLayer?.(layer.id)) map.setLayoutProperty(layer.id, 'visibility', hidden ? 'none' : 'visible'); if (!hidden) { placed.dirty = true; wake(); } },
    /** Boxes labels keep out of (css px on the canvas: x0, y0, x1, y1 each): the page's bars, buttons and sheet.
     * Re-places labels only when they changed. */
    setAvoid(list, n = list ? list.length >> 2 : 0) {
      let same = n === avoidN;
      for (let i = 0; same && i < 4 * n; i++) if (Math.abs(avoid[i] - list[i]) > 0.5) same = false;
      if (same) return;
      if (avoid.length < 4 * n) avoid = new Float32Array(4 * n);
      for (let i = 0; i < 4 * n; i++) avoid[i] = list[i];
      avoidN = n; placed.dirty = true; wake();
    },
    /** Keep labels out of the page's bars and sheet: { top, right, bottom, left } css px, or fn(W, H) -> that; null =
     * MapLibre's padding. */
    setInsets(v) { insets = v || null; placed.dirty = true; wake(); },
    /** The run under a tap at css px (x, y) from the canvas' top left (its label or its cars), or null. */
    hit(x, y) {
      if (hidden) return null;
      for (let t = tags.n - 1; t >= 0; t--) if (x >= tagRect[4 * t] && x <= tagRect[4 * t + 2] && y >= tagRect[4 * t + 1] && y <= tagRect[4 * t + 3]) return tagRun[t];
      const k = trainSizes(map ? map.getZoom() : 12), r = Math.max(22, k.half + k.side + 8);
      let best = null, bd = r;
      for (let i = 0; i < hitN; i++) {
        if (!project(Q, hitXY[2 * i], hitXY[2 * i + 1], placed.W, placed.H, S, 0)) continue;
        const d = Math.hypot(S[0] - x, S[1] - y);
        if (d < bd) { bd = d; best = hitRun[i]; }
      }
      return best;
    },
    /** Trains on the map at ms where the frames draw them: { id, run, line, lng, lat, along, sign, atStop }. Allocates. */
    positions(ms = clock()) {
      const n = frame.update(ms), out = [];
      for (let i = 0; i < n; i++) {
        at(geoOf(frame.line[i]), frame.along[i], pt, 0);
        out.push({ id: frame.runs[i].id, run: frame.runs[i], line: frame.line[i], lng: lngOf(pt[0]), lat: latOf(pt[1]), along: frame.along[i], sign: frame.sign[i], atStop: frame.state[i] !== 0 });
      }
      return out;
    },
    /** Shown labels now: [{ id, text, x0, y0, x1, y1 }] (css px). For tests and QA. */
    shownLabels() {
      const out = [];
      if (hidden) return out;   // 3D draws the trains: nothing of ours is on screen
      for (let t = 0; t < tags.n; t++) out.push({ id: tagRun[t].id, text: tagRun[t][LOOK]?.text, x0: tagRect[4 * t], y0: tagRect[4 * t + 1], x1: tagRect[4 * t + 2], y1: tagRect[4 * t + 3] });
      return out;
    },
    /** The picked run now (it follows a through-run onto its next run), or null. */
    picked: () => focus.run,
    stats: () => ({ ...stats, labelCells: labels.cells.size, avoid: avoidN, scheduled: !!timer }),
  };
}
