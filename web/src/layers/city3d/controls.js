// 3D view: the 3D view's own controls, so the page wires one call.
//
//   const ctl = mountCity3dControls(el, city3d, { lang? })
//     el      the page's app root (`#app`, the .tk-app element the map, the Scheduled pill and the sheet live in)
//     city3d  mountCity3d()'s object (its onChange tells the row when 3D or the underground view turns on or off)
//   ctl.setLang(lang), ctl.update(), ctl.destroy()
//
// One compact row of calm round chips in kereta's look (the Scheduled pill's: white card, soft shadow, 600 12.5 px,
// 32 px visual pill inside a 44 px target): Underground (a toggle: pressed = near-black, as the 3D button) and the four
// presets (Shinjuku, Shibuya, Tokyo Station, Ikebukuro: fly in, pitched 60). Shown only while 3D is on.
// Where (styles/app.css + tokyo/styles.js layout): on a phone right under the Scheduled pill (which ends at
// safe-top + 104 px), from its left edge to just left of the map controls' column (right 14 px + 44 px), so it never
// covers the pill, the top tabs (topbar, above the pill), the controls or the sheet (the sheet, z 40, slides over it
// when pulled up); a row too long for the phone scrolls sideways, its right edge fading. On desktop (>= 900 px, the
// docked pane on the left) it sits at the top of the map, right-aligned beside the controls.
// Copy: the page's i18n (web/src/tokyo/i18n.js, the 3D city block city3d.*), in the page's language, following its
// switches; TEXT (index.js) when the page has no i18n.

import * as I18N from '../../tokyo/i18n.js';
import { PRESETS, TEXT, UG_PRESETS } from './presets.js';

const CSS = `
.tk3d-ctl{position:absolute;z-index:29;left:calc(10px + var(--safe-l,0px));right:calc(66px + var(--safe-r,0px));top:calc(var(--safe-t,0px) + 104px);display:flex;align-items:center;gap:6px;padding:0 4px;overflow-x:auto;overflow-y:hidden;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;pointer-events:auto}
.tk3d-ctl::-webkit-scrollbar{display:none}
.tk3d-ctl[hidden]{display:none}
.tk3d-ctl[data-more]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent)}
.tk3d-chip{flex:none;display:flex;align-items:center;height:44px;padding:0;margin:0;border:0;background:none;font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.tk3d-chip>span{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;background:var(--realm-card,#fff);box-shadow:var(--realm-shadow,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.07));font:600 12.5px/1 var(--font,-apple-system,system-ui,sans-serif);color:var(--text,#171717);white-space:nowrap;transition:background-color .15s,color .15s,opacity .15s}
.tk3d-chip svg{flex:none;width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tk3d-chip[aria-pressed="true"]>span{background:var(--primary,#171717);color:var(--on-primary,#fff)}
.tk3d-chip:active>span{opacity:.7}
.tk3d-chip:focus-visible{outline:none}
.tk3d-chip:focus-visible>span{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--chart,#6C63F0)}
.tk3d-sep{flex:none;width:1px;height:18px;margin:0 2px;background:var(--border,rgba(60,60,67,.18))}
@media (min-width:900px){.tk3d-ctl{left:calc(var(--pane-w,380px) + 16px);right:76px;top:16px;justify-content:flex-end;-webkit-mask-image:none;mask-image:none}}
@media (prefers-reduced-motion:reduce){.tk3d-chip>span{transition:none}}
`;

const UG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18"/><path d="M5 12.5h14M7 17h10" opacity=".55"/></svg>';
// the free camera's chip (a glider: fly where you look)
const FLY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 20.5 4l-7.2 17-2.4-7.4z"/><path d="M10.9 13.6 20.5 4"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function injectCss(doc) {
  if (doc.getElementById('tk3d-ctl-css')) return;
  const st = doc.createElement('style');
  st.id = 'tk3d-ctl-css';
  st.textContent = CSS;
  doc.head.appendChild(st);
}

export function mountCity3dControls(el, city3d, opts = {}) {
  if (!el || !city3d || typeof document === 'undefined') return null;
  const doc = el.ownerDocument || document;
  injectCss(doc);
  let lang = opts.lang || (typeof I18N.lang === 'function' ? I18N.lang() : 'en');
  // the page's words (its i18n follows its own language), else ours
  const word = (key, fallback) => {
    try {
      if (typeof I18N.t === 'function' && (typeof I18N.has !== 'function' || I18N.has(key))) {
        const v = I18N.t(key);
        if (v && v !== key) return v;
      }
    } catch { /* ours */ }
    return fallback;
  };
  const own = () => TEXT[lang] || TEXT.en;
  const root = doc.createElement('div');
  root.className = 'tk3d-ctl';
  root.setAttribute('role', 'group');   // a toolbar would owe arrow keys; a group of buttons Tab walks
  root.hidden = true;
  el.appendChild(root);
  try { city3d.attachControls?.(root); } catch { /* fine */ }

  // the map card's own Underground button (page #b-ug, shown) does it in one tap, so the row then
  // carries only the places (ONE BUTTON = ONE THING); while the underground is on, the places are its own (Otemachi,
  // Shinjuku, Shibuya, Ueno, Ikebukuro: where the levels stack), each flown to at depth
  const cardButton = () => { const b = doc.getElementById('b-ug'); return !!b && !b.hidden; };
  let drawnKey = '';
  function render() {
    const T = own();
    const s = city3d.state?.() || {};
    const ugOn = !!s.underground, card = cardButton();
    const riding = s.ride != null, ts = !!s.trueScale, rv = s.rideView || 'behind', flying = !!s.fly;
    drawnKey = `${lang}|${ugOn}|${card}|${riding}|${ts}|${rv}|${flying}`;
    const P = ugOn ? UG_PRESETS : PRESETS;
    // the underground view round 3: while the underground shows: True scale (a toggle) and Ride a train; while riding: Stop riding
    const ugChips = !ugOn ? [] : riding
      ? [`<button type="button" class="tk3d-chip" data-c3d="stopride"><span>${esc(word('city3d.ug.stop', T.stopRide))}</span></button>`,
        '<i class="tk3d-sep" aria-hidden="true"></i>',
        `<button type="button" class="tk3d-chip" data-c3d="rideview" data-v="behind" aria-pressed="${rv === 'behind'}"><span>${esc(word('city3d.ug.behind', T.behind))}</span></button>`,
        `<button type="button" class="tk3d-chip" data-c3d="rideview" data-v="cab" aria-pressed="${rv === 'cab'}"><span>${esc(word('city3d.ug.cab', T.cab))}</span></button>`]
      : [`<button type="button" class="tk3d-chip" data-c3d="truescale" aria-pressed="${ts}"><span>${esc(word('city3d.ug.true', T.trueScale))}</span></button>`,
        `<button type="button" class="tk3d-chip" data-c3d="ride"><span>${esc(word('city3d.ug.ride', T.ride))}</span></button>`,
        '<i class="tk3d-sep" aria-hidden="true"></i>'];
    // one toggle, first in the row in both 3D views (riding too: Fly takes the camera from the ride)
    const flyChip = typeof city3d.setFly === 'function' ? [`<button type="button" class="tk3d-chip" data-c3d="fly" aria-pressed="${flying}"><span>${FLY_ICON}${esc(word('city3d.fly', T.fly || 'Fly'))}</span></button>`] : [];
    const chips = [
      ...(card ? [] : [`<button type="button" class="tk3d-chip" data-c3d="ug" aria-pressed="${ugOn}" aria-label="${esc(word('city3d.underground.aria', T.underground))}"><span>${UG_ICON}${esc(word('city3d.underground', T.underground))}</span></button>`,
        '<i class="tk3d-sep" aria-hidden="true"></i>']),
      ...flyChip,
      ...(flyChip.length && !ugOn ? ['<i class="tk3d-sep" aria-hidden="true"></i>'] : []),
      ...ugChips,
      ...(riding ? [] : Object.keys(P).map((k) => `<button type="button" class="tk3d-chip" data-c3d="go" data-p="${k}"><span>${esc(word(`city3d.p.${k}`, P[k].title[lang] || P[k].title.en))}</span></button>`)),
    ];
    root.setAttribute('aria-label', word('city3d.goto', T.presets));
    root.innerHTML = chips.join('');
    edge();
  }
  // the fade on the right edge only while more chips wait there
  function edge() {
    const more = root.scrollWidth - root.clientWidth - root.scrollLeft > 4;
    root.toggleAttribute('data-more', more);
  }
  function update() {
    const s = city3d.state?.() || {};
    const show = !!s.on;
    if (root.hidden === show) root.hidden = !show;
    if (drawnKey !== `${lang}|${!!s.underground}|${cardButton()}|${s.ride != null}|${!!s.trueScale}|${s.rideView || 'behind'}|${!!s.fly}`) render();
    const ug = root.querySelector('[data-c3d="ug"]');
    if (ug) ug.setAttribute('aria-pressed', String(!!s.underground));
    if (show) edge();
  }
  const onClick = (e) => {
    const b = e.target.closest?.('[data-c3d]');
    if (!b || !root.contains(b)) return;
    e.preventDefault();
    e.stopPropagation();
    if (b.dataset.c3d === 'ug') {
      const on = b.getAttribute('aria-pressed') !== 'true';
      try {
        if (city3d.enterUnderground) (on ? city3d.enterUnderground() : city3d.exitUnderground()).catch?.((err) => console.warn('[city3d] underground', err));
        else city3d.setUnderground(on);
      } catch (err) { console.warn('[city3d] underground', err); }
      update();
    } else if (b.dataset.c3d === 'truescale') {
      try { city3d.setTrueScale?.(b.getAttribute('aria-pressed') !== 'true'); } catch (err) { console.warn('[city3d] true scale', err); }
      update();
    } else if (b.dataset.c3d === 'ride') {
      let ok = null;
      try { ok = city3d.rideNearest?.(); } catch (err) { console.warn('[city3d] ride', err); }
      if (!ok) { b.querySelector('span').textContent = word('city3d.ug.ridenone', own().rideNone); setTimeout(() => render(), 2200); }
      update();
    } else if (b.dataset.c3d === 'rideview') {
      try { city3d.setRideView?.(b.dataset.v); } catch (err) { console.warn('[city3d] ride view', err); }
      update();
    } else if (b.dataset.c3d === 'stopride') {
      try { city3d.stopRide?.(); } catch (err) { console.warn('[city3d] ride', err); }
      update();
    } else if (b.dataset.c3d === 'fly') {
      try { city3d.setFly?.(b.getAttribute('aria-pressed') !== 'true', { event: e }); } catch (err) { console.warn('[city3d] fly', err); }
      update();
    } else if (b.dataset.c3d === 'go') {
      try { city3d.flyTo(b.dataset.p); } catch (err) { console.warn('[city3d] flyTo', err); }
    }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('scroll', edge, { passive: true });
  const offChange = typeof city3d.onChange === 'function' ? city3d.onChange(update) : null;
  const offLang = typeof I18N.onLang === 'function' ? I18N.onLang((l) => { lang = l || lang; render(); update(); }) : null;
  const onResize = () => edge();
  addEventListener('resize', onResize);
  render();
  update();

  return {
    el: root,
    setLang(l) { lang = l || lang; render(); update(); },
    update,
    destroy() {
      try { city3d.attachControls?.(null); } catch { /* fine */ }
      offChange?.();
      offLang?.();
      removeEventListener('resize', onResize);
      root.removeEventListener('click', onClick);
      root.remove();
    },
  };
}
