// 3D view, Fly: a free camera for the 3D / underground view, so the tunnels can be reached and explored freely from
// above or below the street. Five degrees of freedom: forward / back (along the view), sideways, up / down (above AND below the street: into the tunnels and the
// station boxes), turn (yaw), look up / down (pitch). No roll, no collisions: the eye passes through walls, boxes and the
// street (boreeye.js tells vehicles.js when it is inside a bore or a station box: the tunnel then draws as from inside,
// the ride's lining, lamps and platforms; outside it the tube in its line colour).
//
// How: MapLibre's own camera, put anywhere (checked in Chromium's SwiftShader). MapLibre 5.24
// describes a camera by a centre (lng, lat, ELEVATION), a zoom, a bearing and a pitch (0 down, 90 level, 180 up); the eye
// sits cameraToCenterDistance behind the centre on the view ray. We keep the EYE (track.js local metres x / y, altitude z
// in drawn metres: the underground view draws depth x5), its bearing and pitch, and every frame put the centre D metres
// ahead on the view ray (its elevation = the ray's height there) with the zoom that makes the eye-centre distance D.
// D (centreDistance): where the ray meets the street when that is near (MapLibre's tiles and bounds then see the street as
// usual), else 25-75 m under the street (zoom >= 20: bores.js draws the tunnel interiors from DETAIL_Z 18.5, and the near
// plane, D / 75, stays under 1 m), growing with the height over it (~1 km high: city zoom), small again near a bore.
// MapLibre's own calculateCameraOptionsFromCameraLngLatAltRotation puts the centre 10 km away whenever the ray misses its
// elevation plane (zoom ~14 among the tunnels), so the centre is ours.
// While flying, MapLibre's three "never below the street" rules are lifted and put back after: centerClampedToGround
// (else the centre elevation snaps to 0 m on every render); the terrain guard in Map._applyUpdatedTransform (a camera
// under 0 m goes back up to 0 m: our transformCameraUpdate, a public hook that runs after it, hands back the pitch and
// zoom we asked for); maxPitch / maxZoom (180 / 24). The map's own handlers are off (ours fly), each back as it was.
// Any other camera move (Reset view, a preset chip, locate, search, an opened station or train, the underground on / off)
// ends Fly first, quietly: easeTo / flyTo / jumpTo are wrapped while flying; one that only sets the padding (the sheet
// moving) passes and Fly goes on; + / − (zoomIn / zoomOut) move the eye forward / back. Leaving Fly puts back a normal
// camera looking at what the fly camera looked at (exitView: above the street the street point under the view ray, below
// it the street point over what the eye looked at), eased 0.7 s (reduced motion: a jump). Map taps while flying are the
// look surface (no train / station opens).
// Input. Desktop: W S / up down = forward / back (along the view), A D / left right = sideways, E or Space = up, Q or C =
// down, drag = look (grab: the scene follows the pointer), wheel = along the view, J L = turn, I K = look up / down, Shift
// = 3x, Esc = Fly off; a small key card (dismissable). Phone: a thumb pad (left) to move, drag elsewhere = look, up / down
// buttons (right), pinch = forward / back. Speed: speedFor(altitude): 8-30 m/s under the street, 10 m/s at street level
// up to 1,200 m/s at 2.4 km; damped (no jolts), no allocation per frame. Clamped to Greater Tokyo (FLY.bounds), to -250
// .. +3,000 drawn metres and to pitch 2 .. 178 (never level to the hundredth: MapLibre's tile LOD divides by the eye's
// height over the centre).
//
// export const FLY, FLY_ORIGIN, clamp, clamp1, latOfY, lngOfX
// export function toLocal(lng, lat, out), speedFor(z), centreDistance(z, pitch, near?), basis(bearing, pitch, out),
//   fromCamera(lng, lat, alt, bearing, pitch, F), clampState(F), newState(), step(F, input, dt, o),
//   cameraFor(F, ctcPx, out, D?, near?), exitView(F, o), exitPose(view, ctcPx), lerpPose(F, a, b, s)
// export function createFreeCam(map, opts) -> { start(o), stop(o), active(), pose(p?), input(i), push(m), stats(),
//   refresh(), update(), destroy() }
//   opts: { host() -> element for the pad / buttons / key card (the 3D row's host in #app), area() -> the free map in
//   canvas css px { l, t, r, b }, text() -> TEXT[lang], reduced() -> bool, onChange(), onStop(), trains() -> vehicles
//   (its flyInfo(): the eye among the bores, last frame) }

// No static imports: this file is its own lazy chunk (index.js imports it on the first Fly tap). track.js's local frame
// (Web Mercator scaled to metres at Tokyo Station, x east, y north), copied: freecam.test.mjs checks it is the same.
const D2R = Math.PI / 180, C = 40075016.68557849;
export const FLY_ORIGIN = [106.8229, -6.2003];
const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const OX = mercX(FLY_ORIGIN[0]), OY = mercY(FLY_ORIGIN[1]), LS = C * Math.cos(FLY_ORIGIN[1] * D2R);
export function toLocal(lng, lat, out = [0, 0]) { out[0] = (mercX(lng) - OX) * LS; out[1] = (OY - mercY(lat)) * LS; return out; }

export const FLY = Object.freeze({
  minZ: -250, maxZ: 3000,                  // drawn metres (depth x UG_EXAG in the underground view)
  bounds: [105.8, -7.4, 108.7, -5.6],     // Greater Tokyo (inside the map's maxBounds, 10+ km to spare for the centre)
  pitchMin: 2, pitchMax: 178, level: 0.25, // MapLibre's tile LOD divides by the eye-centre height: never exactly level
  // eye-centre distance D (m): 25 at the street, 25-75 under it (zoom >= 20: bores.js draws the interiors from DETAIL_Z
  // 18.5, and MapLibre's near plane D / 75 stays under 1 m, so a wall the eye passes is never cut far ahead), + 3.5 m a
  // metre of height over it; within nearM of a bore at most 0.8 x its distance + 20 (zoom >= 19.9 there)
  dMin: 25, dUp: 3.5, dDown: 0.2, dUnder: 75, dMax: 4000, nearM: 80,
  // MapLibre's zoom at most 20 (D >= ~80 m): past it the basemap's labels are laid out in tiles overscaled 2^6+ times
  // ("Too many glyphs" warnings, more tiles); the near plane is ours (0.3 m under 120 m of height), so a 25 m or an 80 m
  // centre looks the same
  zoomMax: 20, nearClose: 0.3,
  farMin: 4000,                            // m: MapLibre's far plane is the street's; ours reaches the deepest bores too
  tauGo: 0.16, tauStop: 0.24, tauPush: 0.12, tauReduced: 0.04,
  boost: 3, yawRate: 70, pitchRate: 50,    // deg/s for J L / I K
  lookDeg: 100,                            // degrees of turn per drag over the viewport's shorter side
  maxDt: 0.2, exitMs: 700,
});

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v || 0);
const wrap180 = (b) => { b = ((b + 180) % 360 + 360) % 360 - 180; return b === -180 ? 180 : b; };
// track.js's local frame: Web Mercator scaled to metres at Tokyo Station (x east, y north); no allocation
export const latOfY = (y) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * (OY - y / LS)) * Math.PI)) - 90;
export const lngOfX = (x) => (OX + x / LS) * 360 - 180;
/** Local units per true metre at a latitude (1.000 at Tokyo Station, 1.004 at 36 N). */
const kAt = (lat) => LS / (C * Math.cos(lat * D2R));

/** Fly speed (m/s, before Shift) at a drawn altitude: slow among the tunnels, fast high over the city. */
export function speedFor(z) {
  return z >= 0 ? Math.min(1200, 10 + 0.5 * z) : Math.min(30, 8 + 0.1 * -z);
}

/** Eye-centre distance (m): where the view ray meets the street when that is within reach, else a distance growing
 * with the height over the street (small under it); near = m to the nearest bore (eyeIn) keeps it small near tunnels.
 * Continuous in z and pitch. */
export function centreDistance(z, pitch, near = Infinity) {
  let far = z >= 0 ? Math.min(FLY.dMax, FLY.dMin + FLY.dUp * z) : Math.min(FLY.dUnder, FLY.dMin + FLY.dDown * -z);
  if (near < FLY.nearM) far = Math.min(far, Math.max(FLY.dMin, 0.8 * near + 20));
  const fu = -Math.cos(pitch * D2R);   // the view ray's vertical part (up +)
  let t = Infinity;
  if (z > 0 && fu < -1e-6) t = z / -fu;         // above the street, looking down: the street under the ray
  else if (z < 0 && fu > 1e-6) t = -z / fu;     // below it, looking up: the street over us
  return Math.max(FLY.dMin, Math.min(far, t));
}

/** The eye-centre distance the camera uses: centreDistance, but never under the one at FLY.zoomMax. */
export function distanceFor(F, ctcPx, near = Infinity) {
  return Math.max(ctcPx * C * Math.cos(latOfY(F.y) * D2R) / (512 * 2 ** FLY.zoomMax), centreDistance(F.z, F.pitch, near));
}

/** out = [forward east, north, up (unit, along the view), right east, north (horizontal)]. */
export function basis(bearing, pitch, out = new Float64Array(5)) {
  const b = bearing * D2R, p = pitch * D2R, sp = Math.sin(p);
  out[0] = sp * Math.sin(b); out[1] = sp * Math.cos(b); out[2] = -Math.cos(p);
  out[3] = Math.cos(b); out[4] = -Math.sin(b);
  return out;
}

const LB = (() => { const a = toLocal(FLY.bounds[0], FLY.bounds[1]), b = toLocal(FLY.bounds[2], FLY.bounds[3]); return [a[0], a[1], b[0], b[1]]; })();

function clampPitch(p, prev = 0) {
  p = clamp(p, FLY.pitchMin, FLY.pitchMax);
  if (Math.abs(p - 90) < FLY.level) p = prev > 90 ? 90 + FLY.level : 90 - FLY.level;
  return p;
}

/** Keep the eye in Greater Tokyo and between FLY.minZ and FLY.maxZ (a velocity into a wall stops there). */
export function clampState(F) {
  if (F.x < LB[0]) { F.x = LB[0]; if (F.vx < 0) F.vx = 0; } else if (F.x > LB[2]) { F.x = LB[2]; if (F.vx > 0) F.vx = 0; }
  if (F.y < LB[1]) { F.y = LB[1]; if (F.vy < 0) F.vy = 0; } else if (F.y > LB[3]) { F.y = LB[3]; if (F.vy > 0) F.vy = 0; }
  if (F.z < FLY.minZ) { F.z = FLY.minZ; if (F.vz < 0) F.vz = 0; } else if (F.z > FLY.maxZ) { F.z = FLY.maxZ; if (F.vz > 0) F.vz = 0; }
  if (Math.abs(F.push) > 0 && ((F.z <= FLY.minZ && F.push * F.fu < 0) || (F.z >= FLY.maxZ && F.push * F.fu > 0))) F.push = 0;
  return F;
}

export const newState = () => ({ x: 0, y: 0, z: 0, bearing: 0, pitch: 60, vx: 0, vy: 0, vz: 0, push: 0, fu: 0 });

/** The fly state from a camera (MapLibre: transform.getCameraLngLat(), getCameraAltitude(), bearing, pitch). */
export function fromCamera(lng, lat, alt, bearing, pitch, F = newState()) {
  const P = toLocal(lng, lat, TMP);
  F.x = P[0]; F.y = P[1]; F.z = Number.isFinite(alt) ? alt : 0;
  F.bearing = wrap180(bearing || 0); F.pitch = clampPitch(Number.isFinite(pitch) ? pitch : 60);
  F.vx = F.vy = F.vz = 0; F.push = 0;
  return clampState(F);
}
const TMP = [0, 0];
const BS = new Float64Array(5), BC = new Float64Array(5);

/**
 * One frame (in place, no allocation): look (input.yaw / input.look in degrees, input.turn / input.tilt -1..1 at
 * FLY.yawRate / pitchRate), then the velocity eased toward the input's (forward along the view, sideways level, up
 * world vertical; -1..1 each, input.boost = x FLY.boost), the push (wheel / pinch / + −: metres along the view, eased
 * out), the eye moved, clamped. Returns true while anything still moves.
 */
export function step(F, I, dt, o = {}) {
  dt = clamp(Number.isFinite(dt) ? dt : 0, 0, FLY.maxDt);
  const turn = clamp1(I.turn), tilt = clamp1(I.tilt);
  if (I.yaw || turn) F.bearing = wrap180(F.bearing + (I.yaw || 0) + turn * FLY.yawRate * dt);
  if (I.look || tilt) F.pitch = clampPitch(F.pitch + (I.look || 0) + tilt * FLY.pitchRate * dt, F.pitch);
  const B = basis(F.bearing, F.pitch, BS);
  F.fu = B[2];
  let fwd = clamp1(I.fwd), side = clamp1(I.side);
  const h = Math.hypot(fwd, side);
  if (h > 1) { fwd /= h; side /= h; }
  const up = clamp1(I.up);
  const v = speedFor(F.z) * (I.boost ? FLY.boost : 1);
  const tx = v * (B[0] * fwd + B[3] * side), ty = v * (B[1] * fwd + B[4] * side), tz = v * (B[2] * fwd + up);
  const going = fwd !== 0 || side !== 0 || up !== 0;
  const tau = o.reduced ? FLY.tauReduced : going ? FLY.tauGo : FLY.tauStop;
  const a = 1 - Math.exp(-dt / tau);
  F.vx += (tx - F.vx) * a; F.vy += (ty - F.vy) * a; F.vz += (tz - F.vz) * a;
  let d = 0;
  if (F.push) {
    d = o.reduced ? F.push : F.push * (1 - Math.exp(-dt / FLY.tauPush));
    F.push -= d;
    if (Math.abs(F.push) < 0.02) { d += F.push; F.push = 0; }
  }
  if (!going && Math.abs(F.vx) + Math.abs(F.vy) + Math.abs(F.vz) < 0.03) { F.vx = 0; F.vy = 0; F.vz = 0; }
  const k = kAt(latOfY(F.y));
  F.x += (F.vx * dt + B[0] * d) * k;
  F.y += (F.vy * dt + B[1] * d) * k;
  F.z += F.vz * dt + B[2] * d;
  clampState(F);
  return going || F.push !== 0 || F.vx !== 0 || F.vy !== 0 || F.vz !== 0;
}

/**
 * MapLibre camera options for the fly eye: the centre D m ahead on the view ray (elevation = the ray's height there),
 * zoom = the eye-centre distance D. ctcPx = transform.cameraToCenterDistance (px), tileSize 512. out is reused.
 */
export function cameraFor(F, ctcPx, out = { center: [0, 0], zoom: 0, bearing: 0, pitch: 0, elevation: 0, D: 0 }, Dfix = null, near = Infinity) {
  const D = Dfix ?? distanceFor(F, ctcPx, near);
  const B = basis(F.bearing, F.pitch, BC);
  let lat = latOfY(F.y), cx = F.x, cy = F.y;
  for (let i = 0; i < 2; i++) {   // MapLibre measures D in metres at the CENTRE's latitude: one refinement
    const k = kAt(lat);
    cx = F.x + B[0] * D * k; cy = F.y + B[1] * D * k;
    lat = latOfY(cy);
  }
  out.center[0] = lngOfX(cx); out.center[1] = lat;
  out.zoom = Math.log2(ctcPx * C * Math.cos(lat * D2R) / (D * 512));
  out.bearing = F.bearing; out.pitch = F.pitch; out.elevation = F.z + B[2] * D; out.D = D;
  return out;
}

/**
 * The normal camera Fly hands back (centre on the street, elevation 0): above the street, the street point under the
 * view ray at the same distance (pitch capped at maxPitch); otherwise (below the street, or looking level / up) the
 * street point over the place the eye looked at, from above (below: pitch <= 62, the closest zoom). o: { ctcPx,
 * maxPitch, maxZoom, minZoom }.
 */
export function exitView(F, o = {}) {
  const B = basis(F.bearing, F.pitch, BC);
  const k0 = kAt(latOfY(F.y));
  const maxP = Math.max(0, (o.maxPitch ?? 60) - 0.5), zMax = o.maxZoom ?? 18.6, zMin = o.minZoom ?? 12;
  let tx, ty, dist, pitch;
  if (F.z > 0 && B[2] < -0.05 && F.z / -B[2] <= 30000) {
    const t = F.z / -B[2];
    tx = F.x + B[0] * t * k0; ty = F.y + B[1] * t * k0;
    pitch = Math.min(F.pitch, maxP); dist = t;
  } else {
    const D = distanceFor(F, o.ctcPx || 1266);
    tx = F.x + B[0] * D * k0; ty = F.y + B[1] * D * k0;
    pitch = F.z > 0 ? Math.min(maxP, Math.max(30, Math.min(F.pitch, 70))) : Math.min(maxP, 62);
    dist = F.z > 0 ? Math.max(60, F.z) / Math.cos(pitch * D2R) : 0;   // above: about the same height; below: closest
  }
  const lat = latOfY(ty);
  const z = dist > 0 ? Math.log2((o.ctcPx || 1266) * C * Math.cos(lat * D2R) / (dist * 512)) : zMax;
  return { center: [lngOfX(tx), lat], zoom: clamp(z, zMin, zMax), pitch, bearing: F.bearing };
}

/** The eye of a normal camera view ({ center, zoom, pitch, bearing }, elevation 0) as a fly pose { x, y, z, bearing,
 * pitch }. */
export function exitPose(view, ctcPx) {
  const lat = view.center[1];
  const dist = ctcPx * C * Math.cos(lat * D2R) / (512 * 2 ** view.zoom);
  const B = basis(view.bearing, view.pitch, new Float64Array(5));
  const P = toLocal(view.center[0], lat, [0, 0]), k = kAt(lat);
  return { x: P[0] - B[0] * dist * k, y: P[1] - B[1] * dist * k, z: -B[2] * dist, bearing: view.bearing, pitch: view.pitch };
}

/** F between two poses at s (0..1, already eased): straight line, bearing the short way round. */
export function lerpPose(F, a, b, s) {
  F.x = a.x + (b.x - a.x) * s; F.y = a.y + (b.y - a.y) * s; F.z = a.z + (b.z - a.z) * s;
  F.bearing = wrap180(a.bearing + (((b.bearing - a.bearing + 540) % 360) - 180) * s);
  F.pitch = clamp(a.pitch + (b.pitch - a.pitch) * s, 0, 180);
  return F;
}

// ---------------------------------------------------------------------------------------------------- the engine
const CSS = `
.tk3d-fly{position:absolute;left:0;top:0;width:0;height:0;z-index:28;pointer-events:none}
.tk3d-fly[hidden]{display:none}
.tk3d-flypad{position:absolute;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;background:rgba(255,255,255,.62);box-shadow:inset 0 0 0 1px rgba(60,60,67,.14),0 8px 24px rgba(16,24,40,.08);pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.tk3d-flypad>i{position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;border-radius:50%;background:var(--realm-card,#fff);box-shadow:0 1px 2px rgba(16,24,40,.12),0 4px 12px rgba(16,24,40,.14);transform:translate(var(--kx,0px),var(--ky,0px))}
.tk3d-flypad>i::after{content:"";position:absolute;inset:19px;border-radius:50%;border:2px solid var(--text,#171717);opacity:.28}
.tk3d-flyud{position:absolute;display:flex;flex-direction:column;gap:10px;pointer-events:auto}
.tk3d-flyud button{width:52px;height:52px;padding:0;border:0;border-radius:50%;display:grid;place-items:center;background:var(--realm-card,#fff);color:var(--text,#171717);box-shadow:var(--realm-shadow,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.07));touch-action:none;cursor:pointer;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
.tk3d-flyud button[data-held]{background:var(--primary,#171717);color:var(--on-primary,#fff)}
.tk3d-flyud svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.tk3d-flyhint{position:absolute;pointer-events:auto;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100vw - 32px));padding:10px 34px 10px 12px;border-radius:14px;background:var(--realm-card,#fff);color:var(--text,#171717);box-shadow:var(--realm-shadow,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.07));font:500 12px/1.5 var(--font,-apple-system,system-ui,sans-serif)}
.tk3d-flyhint b{display:block;font-weight:700;margin-bottom:2px}
.tk3d-flyhint kbd{display:inline-block;min-width:16px;padding:0 4px;margin:0 1px;border-radius:5px;background:var(--surface-2,rgba(60,60,67,.08));font:600 11px/17px var(--font,-apple-system,system-ui,sans-serif);text-align:center}
.tk3d-flyhint button{position:absolute;right:4px;top:4px;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:none;color:inherit;font:600 16px/1 var(--font,-apple-system,system-ui,sans-serif);cursor:pointer;opacity:.6}
.tk3d-flyhint button:hover{opacity:1}
.tk3d-flyhint[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.tk3d-flypad>i{transition:none}}
`;
const UP_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14.5 12 8.5l6 6"/></svg>';
const DOWN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';
const HINT_KEY = 'tk3d.flyhint.v1';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kbd = (s) => esc(s).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
const HANDLERS = ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'keyboard', 'boxZoom'];
const WRAPPED = ['jumpTo', 'easeTo', 'flyTo', 'zoomIn', 'zoomOut'];
// key (KeyboardEvent.code: the physical key, so AZERTY users get the same places) -> what it does
const KEYS = { KeyW: 1, ArrowUp: 1, KeyS: 1, ArrowDown: 1, KeyA: 1, ArrowLeft: 1, KeyD: 1, ArrowRight: 1, KeyE: 1, Space: 1, KeyQ: 1, KeyC: 1,
  KeyJ: 1, KeyL: 1, KeyI: 1, KeyK: 1, ShiftLeft: 1, ShiftRight: 1 };
const padOnly = (o) => !!o && typeof o === 'object' && !('center' in o) && !('zoom' in o) && !('bearing' in o) && !('pitch' in o)
  && !('roll' in o) && !('elevation' in o) && !('around' in o);
const editable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
const NO_HOLES = Object.freeze([]);

export function createFreeCam(map, opts = {}) {
  const F = newState();
  const IN = { fwd: 0, side: 0, up: 0, boost: false, yaw: 0, look: 0, turn: 0, tilt: 0 };
  const QA = { fwd: 0, side: 0, up: 0, turn: 0, tilt: 0, boost: false };   // scripted input (QA: input())
  const KD = Object.create(null);                                         // keys held (code -> true)
  const PAD = { x: 0, y: 0, id: null, cx: 0, cy: 0 }, UD = { up: 0, id: null };
  const PT = new Map();                                                   // pointers on the map: id -> { x, y }
  const CAM = { center: [0, 0], zoom: 0, bearing: 0, pitch: 0, elevation: 0, D: 0 };
  const JO = { center: CAM.center, zoom: 0, bearing: 0, pitch: 0, elevation: 0 };
  const EV = { tk3dFly: true };
  const WANT = { on: false, pitch: 0, zoom: 0 };
  const LAST = { lng: NaN, lat: NaN, zoom: NaN, bearing: NaN, pitch: NaN, elevation: NaN, w: 0, h: 0 };
  const saved = { fn: {}, own: {}, h: {} };
  let on = false, exiting = null, raf = 0, last = 0, pinch0 = 0, ui = null, dead = false;
  const reduced = () => { try { return typeof opts.reduced === 'function' ? !!opts.reduced() : typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const canvas = map.getCanvas();
  const box = () => map.getCanvasContainer?.() || canvas.parentElement;
  const ctc = () => map.transform?.cameraToCenterDistance || 1.5 * (canvas.clientHeight || 800);
  const text = () => (typeof opts.text === 'function' ? opts.text() : null) || {};

  // ------------------------------------------------------------------ the camera
  // vehicles.js measures, each frame it draws, where the eye is among the bores (eyeIn: inside, dist): the distance to
  // the nearest bore keeps D small (zoom >= DETAIL_Z) near tunnels
  const nearBore = () => { try { const fi = opts.trains?.()?.flyInfo?.(); return fi && Number.isFinite(fi.dist) ? fi.dist : Infinity; } catch { return Infinity; } };
  // MapLibre fits its far plane to the street (sea level, 100 m under the eye at most): with the centre ~80 m away that
  // cut the bores 150-250 m deeper (drawn x5) out of the picture. Ours: 4 km, or to the street at the top of the view from
  // high up; the near plane 0.3 m up to 120 m over the street
  function nearFar(ctcPx) {
    let farM = Math.max(FLY.farMin, 3 * CAM.D);
    if (F.z > 0) farM = Math.max(farM, Math.min(300000, F.z / Math.cos(Math.min(89.25, CAM.pitch + 36.87) * D2R) * 1.05));
    // the near plane: 0.3 m near the street and under it (a wall the eye passes is cut only 0.3 m before it), else
    // MapLibre's own (D / 75), at most a hundredth of the height
    const nearM = F.z < 120 ? FLY.nearClose : Math.min(CAM.D / 75, F.z / 100);
    try { map.transform.overrideNearFarZ(nearM * ctcPx / CAM.D, farM * ctcPx / CAM.D); } catch { /* fine */ }
  }
  function apply(force = false) {
    const ctcPx = ctc();
    cameraFor(F, ctcPx, CAM, null, nearBore());
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!force && Math.abs(CAM.center[0] - LAST.lng) < 1e-9 && Math.abs(CAM.center[1] - LAST.lat) < 1e-9 && Math.abs(CAM.zoom - LAST.zoom) < 1e-6
      && Math.abs(CAM.bearing - LAST.bearing) < 1e-6 && Math.abs(CAM.pitch - LAST.pitch) < 1e-6 && Math.abs(CAM.elevation - LAST.elevation) < 1e-4
      && w === LAST.w && h === LAST.h) return false;
    JO.zoom = CAM.zoom; JO.bearing = CAM.bearing; JO.pitch = CAM.pitch; JO.elevation = CAM.elevation;
    WANT.pitch = CAM.pitch; WANT.zoom = CAM.zoom;
    nearFar(ctcPx);
    (saved.fn.jumpTo || map.jumpTo).call(map, JO, EV);
    LAST.lng = CAM.center[0]; LAST.lat = CAM.center[1]; LAST.zoom = CAM.zoom; LAST.bearing = CAM.bearing; LAST.pitch = CAM.pitch;
    LAST.elevation = CAM.elevation; LAST.w = w; LAST.h = h;
    return true;
  }
  // MapLibre's terrain guard (Map._elevateCameraIfInsideTerrain: no terrain = a camera under 0 m goes back up to 0 m) runs
  // before this public hook in _applyUpdatedTransform: hand back the pitch / zoom we asked for
  const tcu = () => (WANT.on ? { pitch: WANT.pitch, zoom: WANT.zoom } : {});

  function gather() {
    const k = (c) => (KD[c] ? 1 : 0);
    IN.fwd = clamp1(k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + PAD.y + QA.fwd);
    IN.side = clamp1(k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + PAD.x + QA.side);
    IN.up = clamp1(k('KeyE') + k('Space') - k('KeyQ') - k('KeyC') + UD.up + QA.up);
    IN.turn = clamp1(k('KeyL') - k('KeyJ') + QA.turn);
    IN.tilt = clamp1(k('KeyI') - k('KeyK') + QA.tilt);
    IN.boost = !!(KD.ShiftLeft || KD.ShiftRight || QA.boost);
    return IN.fwd !== 0 || IN.side !== 0 || IN.up !== 0 || IN.turn !== 0 || IN.tilt !== 0;
  }
  let settle = 0;   // a few frames more after the last input: the bore distance of the last frame drawn settles D
  function tick(ts) {
    raf = 0;
    if (!on || exiting || dead) return;
    const dt = last ? (ts - last) / 1000 : 1 / 60;
    last = ts;
    const held = gather();
    const moving = step(F, IN, dt, { reduced: reduced() });
    IN.yaw = 0; IN.look = 0;
    apply(false);
    if (moving || held || settle-- > 0) raf = requestAnimationFrame(tick);
    else { last = 0; settle = 0; }
  }
  function wake() { settle = 4; if (on && !exiting && !raf && !dead) raf = requestAnimationFrame(tick); }

  // ------------------------------------------------------------------ input
  // keys fly unless they type somewhere or a widget owns them (tabs, lists, menus, sliders, dialogs); a key that flies
  // from a focused button (the Fly chip, + / −) moves the focus to the map, so Space never presses that button
  const owned = (t) => editable(t) || !!t?.closest?.('[role="tablist"], [role="listbox"], [role="menu"], [role="slider"], [role="dialog"], [data-seg], select');
  const clearKeys = () => { for (const c of Object.keys(KD)) delete KD[c]; };
  const onKeyDown = (e) => {
    if (!on || exiting || e.ctrlKey || e.metaKey || e.altKey || owned(e.target)) return;
    if (e.key === 'Escape' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); stop(); return; }
    if (!KEYS[e.code]) return;
    e.preventDefault();
    const t = e.target;
    if (t && t !== canvas && t !== document.body && t !== document.documentElement && !t.closest?.('.tk3d-flyhint')) { try { canvas.focus({ preventScroll: true }); } catch { /* fine */ } }
    KD[e.code] = true;
    wake();
  };
  const onKeyUp = (e) => { if (KD[e.code]) { delete KD[e.code]; wake(); } };
  const onBlur = () => { clearKeys(); PAD.x = PAD.y = 0; UD.up = 0; };
  const lookK = () => FLY.lookDeg / Math.max(200, Math.min(canvas.clientWidth || 800, canvas.clientHeight || 800));
  const pinchD = () => { let a = null, d = 0; for (const p of PT.values()) { if (a) d = Math.hypot(p.x - a.x, p.y - a.y); else a = p; } return d; };
  const onDown = (e) => {
    if (!on || exiting || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    PT.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { box().setPointerCapture(e.pointerId); } catch { /* fine */ }
    if (PT.size === 2) pinch0 = pinchD();
  };
  const onMove = (e) => {
    const p = PT.get(e.pointerId);
    if (!p || !on || exiting) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (PT.size === 1) {
      // grab: the scene follows the pointer (drag right = turn left, drag down = look up)
      const k = lookK();
      IN.yaw -= dx * k; IN.look += dy * k;
    } else if (PT.size === 2) {
      const d = pinchD();
      if (pinch0 > 0 && d > 0) F.push += Math.log(d / pinch0) * speedFor(F.z) * 1.6;
      pinch0 = d;
    }
    wake();
  };
  const onUp = (e) => {
    const p = PT.get(e.pointerId);
    if (!p) return;
    PT.delete(e.pointerId);
    try { box().releasePointerCapture(e.pointerId); } catch { /* fine */ }
    if (PT.size < 2) pinch0 = 0;
  };
  const onWheel = (e) => {
    if (!on || exiting) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    F.push += clamp(-dy, -300, 300) / 100 * speedFor(F.z) * 0.6 * (KD.ShiftLeft || KD.ShiftRight || e.shiftKey ? FLY.boost : 1);
    wake();
  };
  // map taps while flying: the look surface (no train / station opens, no map click); a drag never ends in a tap
  const onClick = (e) => {
    if (!on || !map.getContainer().contains(e.target) || ui?.root.contains(e.target)) return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  const onMenu = (e) => { if (on) e.preventDefault(); };
  const nudge = (dir) => { F.push += dir * speedFor(F.z) * 0.8; wake(); };

  function attach() {
    addEventListener('keydown', onKeyDown, true);
    addEventListener('keyup', onKeyUp, true);
    addEventListener('blur', onBlur);
    addEventListener('click', onClick, true);
    const b = box();
    b.addEventListener('pointerdown', onDown);
    b.addEventListener('pointermove', onMove);
    b.addEventListener('pointerup', onUp);
    b.addEventListener('pointercancel', onUp);
    b.addEventListener('wheel', onWheel, { passive: false });
    b.addEventListener('contextmenu', onMenu);
    saved.touch = b.style.touchAction;
    b.style.touchAction = 'none';   // the map's own pinch / pan classes go with its handlers: no page zoom under a pinch
  }
  function detach() {
    removeEventListener('keydown', onKeyDown, true);
    removeEventListener('keyup', onKeyUp, true);
    removeEventListener('blur', onBlur);
    const b = box();
    b.removeEventListener('pointerdown', onDown);
    b.removeEventListener('pointermove', onMove);
    b.removeEventListener('pointerup', onUp);
    b.removeEventListener('pointercancel', onUp);
    b.removeEventListener('wheel', onWheel);
    b.removeEventListener('contextmenu', onMenu);
    b.style.touchAction = saved.touch || '';
    clearKeys(); PT.clear(); pinch0 = 0;
    PAD.x = PAD.y = 0; PAD.id = null; UD.up = 0; UD.id = null;
    Object.assign(QA, { fwd: 0, side: 0, up: 0, turn: 0, tilt: 0, boost: false });
  }
  // the click listener stays one frame longer than the rest: the click that follows the last pointerup is still ours
  const dropClick = () => setTimeout(() => { if (!on) removeEventListener('click', onClick, true); }, 0);

  // ------------------------------------------------------------------ MapLibre's rules, lifted while flying
  function lift() {
    saved.clamp = typeof map.getCenterClampedToGround === 'function' ? map.getCenterClampedToGround() : null;
    saved.maxPitch = map.getMaxPitch(); saved.maxZoom = map.getMaxZoom();
    saved.tcu = map.transformCameraUpdate ?? null;
    try { map.setCenterClampedToGround?.(false); } catch { /* fine */ }
    map.transformCameraUpdate = tcu;
    WANT.on = true;
    map.setMaxPitch(180); map.setMaxZoom(24);
    // tiles: never more detail than the map's own maxZoom asks for. MapLibre picks a tile's zoom from its distance to the
    // eye (+3..+4 levels next to an eye a few metres from the street), and overscaled 2^9 times its line labels ran into
    // "Too many glyphs being rendered in a tile" (and slow layouts). Each source's calculateTileZoom (public: what
    // setSourceTileLodParams sets; 9.314 / 3 = MapLibre's defaults) capped at it, put back after.
    saved.lod = {};
    let ids = [];
    try { ids = Object.keys(map.getStyle()?.sources || {}); } catch { ids = []; }
    for (const id of ids) {
      const src = map.getSource(id);
      if (!src) continue;
      saved.lod[id] = src.calculateTileZoom;
      let f = src.calculateTileZoom;
      if (typeof f !== 'function') { try { map.setSourceTileLodParams(9.314, 3, id); f = src.calculateTileZoom; } catch { f = null; } }
      const cap = saved.maxZoom;
      if (typeof f === 'function') src.calculateTileZoom = (a, b, c, d, e) => Math.min(cap, f(a, b, c, d, e));
    }
    for (const k of HANDLERS) { const h = map[k]; saved.h[k] = !!h?.isEnabled?.(); if (saved.h[k]) { try { h.disable(); } catch { /* fine */ } } }
    for (const k of WRAPPED) { saved.own[k] = Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined; saved.fn[k] = map[k]; }
    map.jumpTo = function (o, e) { if (on && !padOnly(o)) halt(); return saved.fn.jumpTo.call(this, o, e); };
    map.easeTo = function (o, e) { if (on) { if (padOnly(o)) return saved.fn.jumpTo.call(this, { padding: o.padding }, e); halt(); } return saved.fn.easeTo.call(this, o, e); };
    map.flyTo = function (o, e) { if (on) { if (padOnly(o)) return saved.fn.jumpTo.call(this, { padding: o.padding }, e); halt(); } return saved.fn.flyTo.call(this, o, e); };
    map.zoomIn = function (o, e) { if (on && !exiting) { nudge(1); return this; } return saved.fn.zoomIn.call(this, o, e); };
    map.zoomOut = function (o, e) { if (on && !exiting) { nudge(-1); return this; } return saved.fn.zoomOut.call(this, o, e); };
  }
  function putBack() {
    for (const k of WRAPPED) { if (saved.own[k] !== undefined) map[k] = saved.own[k]; else delete map[k]; }
    WANT.on = false;
    map.transformCameraUpdate = saved.tcu;
    try { map.setMaxZoom(saved.maxZoom); map.setMaxPitch(saved.maxPitch); } catch (e) { console.warn('[city3d] fly limits', e); }
    try { if (saved.clamp != null) map.setCenterClampedToGround?.(saved.clamp); } catch { /* fine */ }
    for (const k of HANDLERS) if (saved.h[k]) { try { map[k].enable(); } catch { /* fine */ } }
    for (const id of Object.keys(saved.lod || {})) { const src = map.getSource(id); if (src) src.calculateTileZoom = saved.lod[id]; }
    saved.lod = null;
  }
  /** Another camera move while flying: Fly ends at once (a normal camera here), then that move runs from it. */
  function halt() { stop({ quiet: true, external: true }); }

  // ------------------------------------------------------------------ on / off
  function start(o = {}) {
    if (on || dead) return on;
    try { map.stop?.(); } catch { /* fine */ }
    let p = o.pose;
    if (!p) {
      const tr = map.transform, ll = tr.getCameraLngLat();
      p = { lng: ll.lng, lat: ll.lat, alt: tr.getCameraAltitude(), bearing: map.getBearing(), pitch: map.getPitch() };
    }
    fromCamera(p.lng, p.lat, p.alt, p.bearing, p.pitch, F);
    // a train the page follows (train-view.js's Follow eases the map every second): the user took the camera, as a drag does
    try { map.fire('dragstart', { originalEvent: o.event || { type: 'tk3d-fly' } }); } catch { /* fine */ }
    lift();
    on = true; exiting = null; last = 0;
    attach();
    showUI();
    try { opts.trains?.()?.setFly?.(true); } catch { /* fine */ }
    map.on('resize', onResize);
    map.on('move', place);
    apply(true);
    wake();
    if (o.focus !== false) { try { canvas.focus({ preventScroll: true }); } catch { /* fine */ } }
    opts.onChange?.();
    return true;
  }
  const onResize = () => { if (on && !exiting) { apply(true); place(); } };

  /** Fly off: the normal camera exitView gives, eased (quiet / external / reduced motion: at once). */
  function stop(o = {}) {
    if (!on) return false;
    if (exiting) { finish(exiting.view); return true; }
    detach(); dropClick();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const view = exitView(F, { ctcPx: ctc(), maxPitch: saved.maxPitch, maxZoom: saved.maxZoom, minZoom: Math.max(map.getMinZoom?.() ?? 0, 12) });
    hideUI();
    if (o.quiet || reduced()) { finish(view); return true; }
    exiting = { t0: 0, view, from: { x: F.x, y: F.y, z: F.z, bearing: F.bearing, pitch: F.pitch }, to: exitPose(view, ctc()) };
    opts.onChange?.();
    raf = requestAnimationFrame(exitTick);
    return true;
  }
  function exitTick(ts) {
    raf = 0;
    const E = exiting;
    if (!E || !on) return;
    if (!E.t0) E.t0 = ts;
    const k = Math.min(1, (ts - E.t0) / FLY.exitMs), s = k * k * (3 - 2 * k);
    if (k >= 1) { finish(E.view); return; }
    lerpPose(F, E.from, E.to, s);
    apply(true);
    raf = requestAnimationFrame(exitTick);
  }
  function finish(view) {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    on = false; exiting = null;
    WANT.on = false;
    map.off('resize', onResize);
    map.off('move', place);
    try { map.transform.clearNearFarZOverride(); } catch { /* fine */ }
    try { (saved.fn.jumpTo || map.jumpTo).call(map, { center: view.center, zoom: view.zoom, pitch: view.pitch, bearing: view.bearing, elevation: 0 }, EV); } catch (e) { console.warn('[city3d] fly exit', e); }
    putBack();
    try { opts.trains?.()?.setFly?.(false); } catch { /* fine */ }
    LAST.lng = NaN;
    opts.onChange?.();
    opts.onStop?.();
  }

  // ------------------------------------------------------------------ the pad, the up / down buttons, the key card
  function showUI() {
    const host = (typeof opts.host === 'function' ? opts.host() : null) || map.getContainer().parentElement;
    if (!host) return;
    const doc = host.ownerDocument || document;
    if (!doc.getElementById('tk3d-fly-css')) { const st = doc.createElement('style'); st.id = 'tk3d-fly-css'; st.textContent = CSS; doc.head.appendChild(st); }
    if (!ui || ui.host !== host) { ui?.root.remove(); ui = buildUI(doc, host); }
    const T = text();
    const coarse = typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches;
    const fine = typeof matchMedia !== 'function' || matchMedia('(any-pointer: fine)').matches;
    let hidden = false;
    try { hidden = localStorage.getItem(HINT_KEY) === 'hidden'; } catch { hidden = false; }
    ui.pad.hidden = !coarse; ui.ud.hidden = !coarse;
    ui.up.setAttribute('aria-label', T.flyUp || 'Fly up'); ui.down.setAttribute('aria-label', T.flyDown || 'Fly down');
    ui.hint.hidden = hidden;
    ui.hint.innerHTML = `<b>${esc(T.fly || 'Fly')}</b>${fine ? [T.flyMove, T.flyUpDown, T.flyLook, T.flyFast].filter(Boolean).map((s) => `<div>${kbd(s)}</div>`).join('') : ''}`
      + `${coarse ? `<div>${kbd(T.flyTouch || '')}</div>` : ''}<button type="button" aria-label="${esc(T.flyHide || 'Hide')}">×</button>`;
    ui.root.hidden = false;
    PL.fill(NaN);
    place();
  }
  function hideUI() { if (ui) { ui.root.hidden = true; ui.knob.style.setProperty('--kx', '0px'); ui.knob.style.setProperty('--ky', '0px'); ui.up.removeAttribute('data-held'); ui.down.removeAttribute('data-held'); } }
  function buildUI(doc, host) {
    const root = doc.createElement('div');
    root.className = 'tk3d-fly';
    root.hidden = true;
    root.innerHTML = '<div class="tk3d-flypad" aria-hidden="true"><i></i></div>'
      + `<div class="tk3d-flyud"><button type="button" data-fly="up">${UP_SVG}</button><button type="button" data-fly="down">${DOWN_SVG}</button></div>`
      + '<div class="tk3d-flyhint" role="note"></div>';
    host.appendChild(root);
    const pad = root.querySelector('.tk3d-flypad'), knob = pad.firstChild, ud = root.querySelector('.tk3d-flyud');
    const up = ud.children[0], down = ud.children[1], hint = root.querySelector('.tk3d-flyhint');
    // the thumb pad: the knob follows the thumb within R px; x = sideways, y = forward (up the screen)
    const R = 40;
    const padAt = (e) => {
      let dx = e.clientX - PAD.cx, dy = e.clientY - PAD.cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.setProperty('--kx', `${dx.toFixed(1)}px`); knob.style.setProperty('--ky', `${dy.toFixed(1)}px`);
      const m = Math.min(1, l / R), dead = 0.12;
      const s = m < dead ? 0 : (m - dead) / (1 - dead) / Math.max(1e-6, m);
      PAD.x = dx / R * s; PAD.y = -dy / R * s;
      wake();
    };
    pad.addEventListener('pointerdown', (e) => {
      if (!on || exiting) return;
      e.preventDefault(); e.stopPropagation();
      const r = pad.getBoundingClientRect();
      PAD.cx = r.left + r.width / 2; PAD.cy = r.top + r.height / 2; PAD.id = e.pointerId;
      try { pad.setPointerCapture(e.pointerId); } catch { /* fine */ }
      padAt(e);
    });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === PAD.id) padAt(e); });
    const padUp = (e) => { if (e.pointerId !== PAD.id) return; PAD.id = null; PAD.x = PAD.y = 0; knob.style.setProperty('--kx', '0px'); knob.style.setProperty('--ky', '0px'); wake(); };
    pad.addEventListener('pointerup', padUp); pad.addEventListener('pointercancel', padUp);
    // up / down: held = climb / sink; a click without a hold (keyboard) = a short hop
    for (const [b, dir] of [[up, 1], [down, -1]]) {
      let held = false;
      b.addEventListener('pointerdown', (e) => {
        if (!on || exiting) return;
        e.preventDefault(); e.stopPropagation();
        UD.up = dir; UD.id = e.pointerId; held = true; b.setAttribute('data-held', '');
        try { b.setPointerCapture(e.pointerId); } catch { /* fine */ }
        wake();
      });
      const rel = (e) => { if (e.pointerId !== UD.id) return; UD.up = 0; UD.id = null; b.removeAttribute('data-held'); wake(); };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel);
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (held) { held = false; return; }
        if (!on || exiting) return;
        F.vz += dir * speedFor(F.z) * 1.2; wake();
      });
    }
    hint.addEventListener('click', (e) => {
      if (!e.target.closest('button')) return;
      hint.hidden = true;
      PL.fill(NaN); place();   // its hole goes too
      try { localStorage.setItem(HINT_KEY, 'hidden'); } catch { /* this visit only */ }
      try { canvas.focus({ preventScroll: true }); } catch { /* fine */ }
    });
    return { host, root, pad, knob, ud, up, down, hint };
  }
  // where they go (css px in the host's positioned parent): the free map's corners, over the sheet's top edge, under
  // the chip row; the pad bottom left, the buttons bottom right (left of the controls' column), the card bottom left
  const PL = new Float64Array(6).fill(NaN);   // the last placement written (no style writes, no reflow, while it holds)
  // the pad, the buttons and the key card in canvas px [x0, y0, x1, y1] (labels.js keeps its labels out of them)
  const HOLES = [];
  const hole = (i, x0, y0, x1, y1) => { const h = HOLES[i] || (HOLES[i] = [0, 0, 0, 0]); h[0] = x0 - 4; h[1] = y0 - 4; h[2] = x1 + 4; h[3] = y1 + 4; };
  function place() {
    if (!ui || ui.root.hidden) return;
    const par = ui.root.offsetParent || ui.host;
    const pr = par.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    let a = null;
    try { a = typeof opts.area === 'function' ? opts.area() : null; } catch { a = null; }
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const l = (a?.l ?? 0), r = (a?.r ?? W), b = (a?.b ?? H);
    const ox = Math.round(cr.left - pr.left), oy = Math.round(cr.top - pr.top);
    if (PL[0] === ox && PL[1] === oy && PL[2] === l && PL[3] === r && PL[4] === b && PL[5] === W) return;
    PL[0] = ox; PL[1] = oy; PL[2] = l; PL[3] = r; PL[4] = b; PL[5] = W;
    HOLES.length = 0;
    if (!ui.pad.hidden) {
      const cx = Math.round(l + 16 + 62), cy = Math.round(b - 16 - 62);
      ui.pad.style.left = `${ox + cx}px`; ui.pad.style.top = `${oy + cy}px`;
      hole(HOLES.length, cx - 62, cy - 62, cx + 62, cy + 62);
    }
    if (!ui.ud.hidden) {
      const x = Math.round(Math.min(r, W - 66) - 16 - 52), y = Math.round(b - 16 - 114);
      ui.ud.style.left = `${ox + x}px`; ui.ud.style.top = `${oy + y}px`;
      hole(HOLES.length, x, y, x + 52, y + 114);
    }
    if (!ui.hint.hidden) {
      // bottom left of the free map; with the pad (touch), over the pad, never wider than the map
      const x = Math.round(l + 16);
      ui.hint.style.left = `${ox + x}px`;
      ui.hint.style.maxWidth = `${Math.max(160, Math.min(300, Math.min(r, W) - l - 32))}px`;
      ui.hint.style.top = '';
      const hh = ui.hint.offsetHeight || 96, hw = ui.hint.offsetWidth || 260;
      const y = Math.round(b - 16 - (ui.pad.hidden ? 0 : 124 + 10) - hh);
      ui.hint.style.top = `${oy + y}px`;
      hole(HOLES.length, x, y, x + hw, y + hh);
    }
  }

  // ------------------------------------------------------------------ the object
  return {
    start,
    stop,
    /** Flying (the exit's ease counts as off). */
    active: () => on && !exiting,
    /** QA / index.js: the eye now { lng, lat, alt, bearing, pitch } (a pose given: put the eye there, still flying). */
    pose(p) {
      if (p && on && !exiting) {
        fromCamera(p.lng ?? lngOfX(F.x), p.lat ?? latOfY(F.y), p.alt ?? F.z, p.bearing ?? F.bearing, p.pitch ?? F.pitch, F);
        apply(true);
        wake();
      }
      return { lng: lngOfX(F.x), lat: latOfY(F.y), alt: F.z, bearing: F.bearing, pitch: F.pitch };
    },
    /** QA: a held input until changed ({ fwd, side, up, turn, tilt: -1..1, boost }). */
    input(i = {}) { for (const k of Object.keys(QA)) if (k in i) QA[k] = k === 'boost' ? !!i[k] : clamp1(i[k]); wake(); return { ...QA }; },
    /** QA: wheel / + − steps along the view (metres). */
    push(m) { if (on && !exiting && Number.isFinite(m)) { F.push += m; wake(); } },
    stats: () => {
      const fi = opts.trains?.()?.flyInfo?.() || null;
      return { on, exiting: !!exiting, lng: lngOfX(F.x), lat: latOfY(F.y), alt: F.z, bearing: F.bearing, pitch: F.pitch,
        v: Math.hypot(F.vx, F.vy, F.vz), speed: speedFor(F.z), D: CAM.D, zoom: CAM.zoom, elevation: CAM.elevation, looping: !!raf,
        inside: !!fi?.inside, line: fi ? fi.line : -1, near: fi ? fi.dist : null };
    },
    /** The key card / buttons' words again (a language switch). */
    refresh() { if (on && !exiting) showUI(); },
    /** The pad, buttons and key card in canvas px ([[x0, y0, x1, y1], ...], live): no label goes there. */
    holes: () => (on && !exiting ? HOLES : NO_HOLES),
    /** The drawn world changed under the eye (True scale on / off): D and the inside test again. */
    update() { if (on && !exiting) { apply(true); wake(); } },
    destroy() { if (on) stop({ quiet: true }); dead = true; ui?.root.remove(); ui = null; },
  };
}
