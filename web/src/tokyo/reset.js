// The map card's "Reset view" button. One tap = the OPENING view exactly as a fresh load frames it: the style's
// HOME_VIEW fitted the way page.js fits it on load (map.cameraForBounds(HOME_VIEW, { padding: 8 }) with the map padding
// of the opening screen: phones = the sheet at peek), north up, flat; 3D and Underground off; the Live filter back to
// All; the picked line / train / station and the follow camera off; the sheet back to Home (at its opening detent, not
// closed). A smooth flight (prefers-reduced-motion: a jump). The bus layer stays as the user set it (a layer choice, not
// a view). Nothing here names or fetches a data source.
//
//   const r = mountResetButton(cardEl, ctx)  -> { el, reset(): Promise<plan>, plan(): plan, busy, last, destroy() }
//     (page.js keeps it as window.__tokyo.state.reset: QA taps #b-reset, waits for !busy, reads last)
//   resetPlan(state)                         -> { steps, screen, sheet, on3D, underground, liveOnly, camera }   (pure)
//   flightFor(from, to, { reduceMotion, width }) -> { mode: 'jump' | 'ease' | 'fly', duration }              (pure)
//   runReset(ctx)                            -> Promise<plan>: the steps on the page through ctx, then the camera
//
// ctx (page.js `// reset.js` block): { t(key), say(text), map() -> MapLibre map | null, state() -> the resetPlan input,
//   followOff(), home(), clearPicks(), undergroundOff(), off3d(), liveAll(), sheetPeek() } (every action optional).

/** The opening view when the style has none: tokyo-map.js YAMANOTE_VIEW (the map's own fallback on load). */
export const HOME_FALLBACK = [[106.72, -6.33], [106.93, -6.09]];
/** page.js fits HOME_VIEW with { padding: 8 } on top of the map padding when the map is ready (the opening camera). */
export const HOME_PAD = 8;
/** What a tap does, in this order (resetPlan picks the ones the state needs; clear-picks and camera always run). */
export const STEPS = ['follow-off', 'home', 'clear-picks', 'underground-off', '3d-off', 'live-all', 'sheet-peek', 'camera'];

/** A house: "the opening view" (the card's locate button is a crosshair: near me). 22 px in the card's 44 px button. */
export const RESET_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
  + '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M5.8 9.3v10.2h4.4v-5.2h3.6v5.2h4.4V9.3"/></svg>';

const okBounds = (b) => Array.isArray(b) && b.length === 2 && b.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));

/**
 * The plan for one tap from `state` (pure). state = { cam?, screen: { name, id }, tab, stack (depth), q (search text),
 * on3D, underground, liveOnly, following, desktop, reduceMotion, homeBounds? }. The result always ends at the opening
 * view: screen home, phones' sheet at peek, 3D / Underground / Live filter off, north up and flat.
 */
export function resetPlan(state = {}) {
  const s = state || {};
  const tab = s.tab || 'home';
  const sc = s.screen || { name: tab, id: null };
  const atHome = !(Number(s.stack) > 0) && tab === 'home' && (sc.name || 'home') === 'home' && !String(s.q || '').trim();
  const want = new Set(['clear-picks', 'camera']);
  if (s.following) want.add('follow-off');
  if (!atHome) want.add('home');
  if (s.underground) want.add('underground-off');
  if (s.on3D || s.underground) want.add('3d-off');
  if (s.liveOnly) want.add('live-all');
  if (!s.desktop) want.add('sheet-peek');
  return {
    steps: STEPS.filter((k) => want.has(k)),
    screen: 'home',
    sheet: s.desktop ? null : 'peek',
    on3D: false,
    underground: false,
    liveOnly: false,
    following: false,
    camera: { bounds: okBounds(s.homeBounds) ? s.homeBounds : HOME_FALLBACK, padding: HOME_PAD, bearing: 0, pitch: 0, motion: s.reduceMotion ? 'jump' : 'animate' },
  };
}

/** Web-mercator x / y in 0..1 (MapLibre's world at zoom z is 512 * 2^z px wide). */
function merc([lng, lat]) {
  const s = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/**
 * How the camera gets home (pure): reduced motion = a jump; a short hop (the target within 1.5 screens at the lower zoom,
 * less than 1.5 zoom levels apart: a tilt, a turn, a small pan) = an ease; else a flight, longer the further it zooms.
 */
export function flightFor(from, to, { reduceMotion = false, width = 390 } = {}) {
  if (reduceMotion || !from?.center || !to?.center) return { mode: 'jump', duration: 0 };
  const z0 = Number(from.zoom) || 0, z1 = Number(to.zoom) || 0;
  const dz = Math.abs(z1 - z0);
  const [ax, ay] = merc(from.center), [bx, by] = merc(to.center);
  const px = Math.hypot(ax - bx, ay - by) * 512 * 2 ** Math.min(z0, z1);
  if (px <= 1.5 * Math.max(200, width) && dz <= 1.5) return { mode: 'ease', duration: 800 };
  return { mode: 'fly', duration: Math.round(Math.min(1800, 1000 + 200 * dz)) };
}

const call = async (fn) => { if (typeof fn === 'function') await fn(); };

/** The camera now ({ center: [lng, lat], zoom, bearing, pitch }) or null. */
function camOf(map) {
  try { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }; } catch { return null; }
}

/**
 * One tap: the plan's steps through the page (ctx), then the camera to the opening view. Resolves with the plan (+ the
 * target camera and the flight) once the camera has settled.
 */
export async function runReset(ctx = {}) {
  const plan = resetPlan(ctx.state?.() || {});
  const act = { 'follow-off': ctx.followOff, home: ctx.home, 'clear-picks': ctx.clearPicks, 'underground-off': ctx.undergroundOff, '3d-off': ctx.off3d, 'live-all': ctx.liveAll, 'sheet-peek': ctx.sheetPeek };
  for (const k of plan.steps) {
    if (k === 'camera') continue;
    try { await call(act[k]); } catch (e) { console.warn(`[reset] ${k}`, e); }
  }
  const map = ctx.map?.() || null;
  if (map && plan.steps.includes('camera')) {
    let target = null;
    try { target = map.cameraForBounds(plan.camera.bounds, { padding: plan.camera.padding }); } catch (e) { console.warn('[reset] camera', e); }
    if (target?.center) {
      const c = target.center;
      const to = { center: Array.isArray(c) ? c : [c.lng, c.lat], zoom: target.zoom, bearing: 0, pitch: 0 };
      const st = ctx.state?.() || {};
      const fl = flightFor(camOf(map), to, { reduceMotion: plan.camera.motion === 'jump', width: st.width });
      plan.target = to; plan.flight = fl;
      const view = { center: to.center, zoom: to.zoom, bearing: 0, pitch: 0 };
      if (fl.mode === 'jump') map.jumpTo(view);
      else {
        const settled = new Promise((res) => {
          const done = () => { clearTimeout(to2); try { map.off('moveend', onEnd); } catch { /* fine */ } res(); };
          const onEnd = () => { if (!map.isMoving?.()) done(); };
          const to2 = setTimeout(done, fl.duration + 700);
          (fl.mode === 'ease' ? map.easeTo : map.flyTo).call(map, { ...view, duration: fl.duration, essential: true });
          map.on('moveend', onEnd);   // after the call: the flight's own end, not the one it interrupted
        });
        await settled;
      }
    }
  }
  try { ctx.say?.(ctx.t?.('reset.say')); } catch { /* fine */ }
  return plan;
}

/**
 * The button: 44 px in the map's control card (#c3dcard), before the locate crosshair, the card's own look (app.css
 * .ccard button: hairline, hover, focus ring). aria-label + title "Reset view" (data-i18n-* so the language switch
 * re-labels it). A tap while a reset runs is ignored.
 */
export function mountResetButton(cardEl, ctx = {}) {
  if (!cardEl) return null;
  const doc = cardEl.ownerDocument || globalThis.document;
  const t = typeof ctx.t === 'function' ? ctx.t : (k) => (k === 'reset.view' ? 'Reset view' : k);
  const el = doc.createElement('button');
  el.type = 'button';
  el.id = 'b-reset';
  el.className = 'tk-reset';
  el.setAttribute('aria-label', t('reset.view'));
  el.setAttribute('title', t('reset.view'));
  el.setAttribute('data-i18n-aria', 'reset.view');
  el.setAttribute('data-i18n-title', 'reset.view');
  el.innerHTML = RESET_SVG;
  const before = cardEl.querySelector?.('#b-locate');
  if (before && before.parentNode === cardEl) cardEl.insertBefore(el, before);
  else cardEl.append(el);
  let running = null, last = null;
  const reset = () => {
    if (running) return running;
    running = runReset(ctx).then((p) => { last = p; return p; }).finally(() => { running = null; });
    return running;
  };
  const onClick = (e) => { e?.preventDefault?.(); reset(); };
  el.addEventListener('click', onClick);
  try { ctx.chromeSync?.(); } catch { /* fine */ }   // the card grew by one button (names keep out of it)
  return {
    el,
    reset,
    plan: () => resetPlan(ctx.state?.() || {}),
    /** QA: a reset is running / the plan the last finished tap ran (+ target camera and flight). */
    get busy() { return !!running; },
    get last() { return last; },
    destroy() { el.removeEventListener('click', onClick); el.remove(); },
  };
}

export default mountResetButton;
