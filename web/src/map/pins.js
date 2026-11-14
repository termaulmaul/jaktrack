// Map pins: a white circle with a ring in the colour, an emoji in the middle and a soft shadow; a lavender count badge top-right with a white border; a
// white label pill with semibold dark text; a small pointer under a selected pin. Used for the selected bus (it glides
// with the bus, updated every frame), a selected stop, a focused route's terminals, and one label tag.
//
// They are DOM markers (one to four at a time). MapLibre owns each marker root's `transform` and `opacity`, so every
// style that animates or scales lives on the inner `.in` element, never on the root.
//
// Geometry of a selected pin (anchor = the point): the pointer's tip sits `lift` px above the point (so a bus chip or a
// stop dot under it stays visible) and the label pill sits under the point, clear of whatever is drawn there.
// `ml` = the MapLibre namespace the map was made with (the host's own when it passes one).
const SYS = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

export const PIN_CSS = `
.tm-pin{width:44px;height:54px;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none}
.tm-pin.plain{width:36px;height:36px}
.tm-pin .in{position:absolute;inset:0;transform-origin:50% 100%}
.tm-pin.plain .in{transform-origin:50% 50%}
.tm-pin .hd{position:absolute;left:0;top:0;width:44px;height:44px;box-sizing:border-box;border-radius:50%;background:#fff;
  box-shadow:0 0 0 3px var(--c),0 0 0 7px rgba(255,255,255,.9),0 8px 20px rgba(16,24,40,.28);display:grid;place-items:center}
.tm-pin.plain .hd{width:36px;height:36px;box-shadow:0 0 0 2.5px var(--c),0 4px 12px rgba(16,24,40,.22)}
.tm-pin .em{font-size:22px;line-height:1;font-family:${EMOJI};user-select:none}
.tm-pin.plain .em{font-size:18px}
.tm-pin .tx{font:700 17px/1 ${SYS};color:#171717;font-variant-numeric:tabular-nums}
.tm-pin.plain .tx{font-size:14px}
.tm-pin .tp{position:absolute;left:50%;top:42px;width:12px;height:12px;margin-left:-6px;background:var(--c);clip-path:polygon(0 0,100% 0,50% 100%)}
.tm-pin.plain .tp{display:none}
.tm-pin .bd{position:absolute;top:-5px;right:-6px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;
  background:#6C63F0;color:#fff;font:700 12px/22px ${SYS};text-align:center;box-shadow:0 0 0 2px #fff;font-variant-numeric:tabular-nums}
.tm-pin .bd.ink{background:#171717}
.tm-pin.plain .bd{top:-6px;right:-8px;min-width:20px;height:20px;padding:0 5px;font-size:11.5px;line-height:20px}
.tm-pin .bd[hidden],.tm-pin .lb[hidden]{display:none}
.tm-pin .lb{position:absolute;left:50%;top:calc(100% + var(--below,6px));translate:-50% 0;padding:4px 8px;border-radius:9px;
  background:rgba(255,255,255,.96);box-shadow:0 2px 8px rgba(16,24,40,.14);white-space:nowrap;font-family:${SYS};color:#171717;
  text-align:center;pointer-events:none}
.tm-pin.plain .lb{top:calc(100% + 6px);padding:2px 7px;border-radius:7px;box-shadow:0 2px 6px rgba(16,24,40,.14)}
.tm-pin .lb b{display:block;font-weight:600;font-size:12.5px;line-height:1.15;max-width:170px;overflow:hidden;text-overflow:ellipsis}
.tm-pin.plain .lb b{font-size:11.5px;line-height:1.3;max-width:140px}
.tm-pin .lb span{display:block;font-weight:600;font-size:11.5px;line-height:1.2;color:#6B6B70;font-variant-numeric:tabular-nums}
.tm-pin .lb span:empty{display:none}
.tm-pin:focus-visible .hd{outline:2px solid #6C63F0;outline-offset:6px}
.tm-pin.pop .in{animation:tm-popin .45s cubic-bezier(.3,1.5,.5,1) backwards}
@keyframes tm-popin{from{scale:.2;opacity:0}}
.tm-pin.out .in{transition:opacity .2s,scale .2s;opacity:0;scale:.6}
.tm-tag{pointer-events:none}
.tm-tag .in{position:relative;padding:5px 9px;border-radius:10px;background:rgba(255,255,255,.96);
  box-shadow:0 4px 12px rgba(16,24,40,.18);font:600 12px/1.2 ${SYS};color:#171717;white-space:nowrap;text-align:center;
  font-variant-numeric:tabular-nums;animation:tm-tagin .25s ease-out backwards}
.tm-tag .in span{display:block;font-weight:500;color:#6B6B70}
.tm-tag .in::after{content:"";position:absolute;left:50%;bottom:-5px;width:10px;height:6px;margin-left:-5px;background:rgba(255,255,255,.96);
  clip-path:polygon(0 0,100% 0,50% 100%)}
.tm-tag[data-side="bottom"] .in::after{bottom:auto;top:-5px;clip-path:polygon(50% 0,100% 100%,0 100%)}
.tm-tag[data-side="right"] .in::after{left:-5px;top:50%;bottom:auto;width:6px;height:10px;margin:-5px 0 0;clip-path:polygon(100% 0,100% 100%,0 50%)}
.tm-tag[data-side="left"] .in::after{left:auto;right:-5px;top:50%;bottom:auto;width:6px;height:10px;margin:-5px 0 0;clip-path:polygon(0 0,100% 50%,0 100%)}
@keyframes tm-tagin{from{opacity:0;translate:0 4px}}
@media (prefers-reduced-motion:reduce){.tm-pin.pop .in,.tm-tag .in{animation:none}.tm-pin.out .in{transition:none}}
`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * One pin. `o` = {color, emoji?, text? (instead of the emoji, e.g. "A"), label?, sub?, badge?, badgeInk?,
 * selected?, lift?, below?, z?, aria?, onClick?}. `selected` pins have the pointer and the white halo and are anchored
 * at the pointer's tip; plain pins are smaller and centred on the point.
 */
export class Pin {
  constructor(ml, map, lngLat, o = {}) {
    this.ml = ml;
    this.map = map;
    this.o = {};
    const el = document.createElement('div');
    el.className = 'tm-pin pop';
    el.innerHTML = '<div class="in"><div class="hd"><span class="em"></span><b class="bd" hidden></b></div><div class="tp"></div>'
      + '<div class="lb" hidden><b></b><span></span></div></div>';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    this.el = el;
    this.hd = el.querySelector('.hd');
    this.em = el.querySelector('.em');
    this.bd = el.querySelector('.bd');
    this.lb = el.querySelector('.lb');
    const fire = (e) => { e.stopPropagation(); if (this.o.onClick) this.o.onClick(); };
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); } });
    // a press on a pin is not the start of a map drag
    for (const t of ['mousedown', 'touchstart', 'pointerdown', 'dblclick']) el.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
    this.lngLat = lngLat;
    this.marker = null;
    this.set(o);
  }

  set(o) {
    const p = { ...this.o, ...o };
    const prev = this.o;
    this.o = p;
    const el = this.el;
    if (p.color !== prev.color) el.style.setProperty('--c', p.color || '#171717');
    el.classList.toggle('plain', !p.selected);
    const isText = p.text != null && p.text !== '';
    this.em.className = isText ? 'tx' : 'em';
    const glyph = isText ? String(p.text) : (p.emoji || '📍');
    if (this.em.textContent !== glyph) this.em.textContent = glyph;
    const hasBadge = p.badge != null && p.badge !== '' && p.badge !== 0;
    this.bd.hidden = !hasBadge;
    if (hasBadge && this.bd.textContent !== String(p.badge)) this.bd.textContent = String(p.badge);
    this.bd.classList.toggle('ink', !!p.badgeInk);
    const hasLabel = !!(p.label || p.sub);
    this.lb.hidden = !hasLabel;
    if (hasLabel) {
      const b = this.lb.firstElementChild, s = this.lb.lastElementChild;
      if (b.textContent !== String(p.label || '')) b.textContent = String(p.label || '');
      if (s.textContent !== String(p.sub || '')) s.textContent = String(p.sub || '');
    }
    if (p.below !== prev.below) el.style.setProperty('--below', `${p.below ?? 6}px`);
    el.style.zIndex = String(p.z ?? 2);
    el.setAttribute('aria-label', p.aria || [p.label, p.sub].filter(Boolean).join(', ') || 'Pin');
    const anchor = p.selected ? 'bottom' : 'center';
    const offset = [0, p.selected ? -(p.lift || 0) : 0];
    if (!this.marker || anchor !== this.anchor) {
      if (this.marker) this.marker.remove();
      this.anchor = anchor;
      this.marker = new this.ml.Marker({ element: el, anchor, offset, subpixelPositioning: true }).setLngLat(this.lngLat).addTo(this.map);
    } else if (offset[1] !== this.offY) this.marker.setOffset(offset);
    this.offY = offset[1];
    return this;
  }

  /** Move the pin (cheap enough to call every frame). */
  setLngLat(lngLat) {
    this.lngLat = lngLat;
    if (this.marker) this.marker.setLngLat(lngLat);
  }

  setHidden(h) { this.el.style.visibility = h ? 'hidden' : ''; }

  remove() {
    if (!this.marker) return;
    const m = this.marker;
    this.marker = null;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { m.remove(); return; }
    this.el.style.pointerEvents = 'none';
    this.el.classList.remove('pop');
    this.el.classList.add('out');
    setTimeout(() => m.remove(), 210);
  }
}

/** Where a tag sits around its point: the marker anchor, and the offset direction. */
const SIDES = { top: ['bottom', 0, -1], bottom: ['top', 0, 1], right: ['left', 1, 0], left: ['right', -1, 0] };

/**
 * One label pill with a small pointer, `lift` px from the point. It sits above the point unless that would cover a
 * pin; then right, left or below (`side`); with no room on any side it is hidden until there is.
 */
export class Tag {
  constructor(ml, map) {
    this.ml = ml;
    this.map = map;
    this.marker = null;
    this.key = '';
    this.side = 'top';
    this.lift = 4;
    this.hidden = false;
  }

  set(tag, lift = 4, side = this.side) {
    if (!tag || !Array.isArray(tag.lngLat) || !Number.isFinite(tag.lngLat[0]) || !Number.isFinite(tag.lngLat[1])) { this.clear(); return; }
    const key = `${tag.text}\u0000${tag.sub || ''}`;
    if (!this.marker || key !== this.key || side !== this.side) {
      if (this.marker) { this.marker.remove(); this.marker = null; }
      const el = document.createElement('div');
      el.className = 'tm-tag';
      el.dataset.side = side;
      el.style.zIndex = '3';
      if (this.hidden) el.style.visibility = 'hidden';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', [tag.text, tag.sub].filter(Boolean).join(', '));
      el.innerHTML = `<div class="in"${key === this.key ? ' style="animation:none"' : ''}>${esc(tag.text)}${tag.sub ? `<span>${esc(tag.sub)}</span>` : ''}</div>`;
      const [anchor, dx, dy] = SIDES[side] || SIDES.top;
      this.marker = new this.ml.Marker({ element: el, anchor, offset: [dx * (lift + 5), dy * (lift + 5)], subpixelPositioning: true })
        .setLngLat(tag.lngLat).addTo(this.map);
      this.key = key;
      this.side = side;
    } else {
      this.marker.setLngLat(tag.lngLat);
      const [, dx, dy] = SIDES[side] || SIDES.top;
      if (lift !== this.lift) this.marker.setOffset([dx * (lift + 5), dy * (lift + 5)]);
    }
    this.lift = lift;
  }

  /** Step aside (no room next to a pin) without losing the tag; it keeps its place and text. */
  setHidden(h) {
    this.hidden = !!h;
    if (this.marker) this.marker.getElement().style.visibility = h ? 'hidden' : '';
  }

  clear() {
    if (this.marker) { this.marker.remove(); this.marker = null; }
    this.key = '';
    this.side = 'top';
    this.hidden = false;
  }
}

/** The tag's box around its point for a side (css px, y down): [x0, y0, x1, y1]. */
export function tagBox(side, w, h, lift = 4) {
  const g = lift + 5;
  if (side === 'bottom') return [-w / 2, lift, w / 2, g + h];
  if (side === 'right') return [lift, -h / 2, g + w, h / 2];
  if (side === 'left') return [-(g + w), -h / 2, -lift, h / 2];
  return [-w / 2, -(g + h), w / 2, -lift];
}
