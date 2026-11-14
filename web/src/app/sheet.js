// Bottom sheet for phones (peek 206 px / half the screen / full up to the top bar): 1:1 drag, momentum
// projection on release, spring
// settle that starts from the finger's velocity, rubber-band past the ends, and interruptible at any frame. At full
// height the content scrolls; pulling down from the top of the content drags the sheet again (iOS behaviour).
// On desktop (>= 900 px) the sheet is a static side panel and this module stays out of the way.

import { animate, project, rubber } from './spring.js';

const SLOP = 6;

export function createSheet({ sheet, body, isDesktop, reduceMotion, onMove, onSettle }) {
  let v = 0;              // visible height in px (what the user sees above the bottom edge)
  let anim = null;
  let detent = 'peek';
  let peekPx = 206;   // the peek height
  let g = null;           // the gesture in progress

  const H = () => sheet.offsetHeight || 1;
  const detents = () => {
    const h = H();
    const vh = window.innerHeight;
    const peek = Math.min(peekPx, h);
    const half = Math.max(peek + 80, Math.min(Math.round(vh * 0.5), h));
    return { peek, half: Math.min(half, h), full: h };
  };

  function paint(vis) {
    v = vis;
    sheet.style.transform = `translate3d(0, ${(H() - vis).toFixed(1)}px, 0)`;
    onMove?.(vis, detents());
  }

  function setFull(on) {
    if (on) sheet.setAttribute('data-full', '');
    else sheet.removeAttribute('data-full');
  }

  function stopAnim() {
    if (!anim) return null;
    const cur = anim.stop();
    const target = anim.to;
    anim = null;
    return { ...cur, target };
  }

  /** Go to a detent; `velocity` (px/s, positive = growing) hands the finger's speed to the spring. */
  function snap(name, { velocity = 0, instant = false } = {}) {
    if (isDesktop()) { detent = name; return; }
    const d = detents();
    const to = d[name] ?? d.peek;
    detent = name;
    stopAnim();
    if (name !== 'full') setFull(false);
    if (instant || reduceMotion()) {
      paint(to);
      if (name === 'full') setFull(true);
      onSettle?.(name);
      return;
    }
    const momentum = Math.abs(velocity) > 300;
    anim = animate({
      from: v,
      to,
      velocity,
      response: momentum ? 0.42 : 0.38,
      damping: momentum ? 0.86 : 1,
      onUpdate: paint,
      onDone: () => {
        anim = null;
        if (name === 'full') setFull(true);
        onSettle?.(name);
      },
    });
  }

  function nearest(px, d) {
    let best = 'peek';
    for (const k of ['peek', 'half', 'full']) if (Math.abs(d[k] - px) < Math.abs(d[best] - px)) best = k;
    return best;
  }

  function dragTo(raw) {
    const d = detents();
    let vis = raw;
    if (raw > d.full) vis = d.full + rubber(raw - d.full, window.innerHeight);
    else if (raw < d.peek) vis = d.peek - rubber(d.peek - raw, window.innerHeight);
    paint(vis);
  }

  function velocityOf(samples) {
    // Finger velocity over the last ~90 ms, px/s; positive = finger moving down.
    const last = samples[samples.length - 1];
    let first = last;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (last[1] - samples[i][1] > 90) break;
      first = samples[i];
    }
    const dt = last[1] - first[1];
    return dt > 0 ? ((last[0] - first[0]) / dt) * 1000 : 0;
  }

  function release(fingerV, startDetent) {
    const vel = -fingerV;  // sheet grows when the finger moves up
    const d = detents();
    let target = nearest(v + project(vel), d);
    const order = ['peek', 'half', 'full'];
    if (Math.abs(vel) > 450 && target === startDetent) {
      const i = order.indexOf(startDetent) + (vel > 0 ? 1 : -1);
      if (i >= 0 && i < order.length) target = order[i];
    }
    snap(target, { velocity: vel });
  }

  // ---------------------------------------------------------------- touch (phones)
  sheet.addEventListener('touchstart', (e) => {
    if (isDesktop() || e.touches.length > 1) { g = null; return; }
    const t = e.touches[0];
    const was = stopAnim();
    g = {
      id: t.identifier,
      x0: t.clientX,
      y0: t.clientY,
      mode: null,
      samples: [[t.clientY, e.timeStamp]],
      resume: was ? was.target : null,
      startDetent: detent,
      handle: !!e.target.closest('.grab, [data-drag]') && !e.target.closest('.chips, .rail'),
    };
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!g) return;
    let t = null;
    for (const c of e.changedTouches) if (c.identifier === g.id) t = c;
    if (!t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.mode) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dx) > Math.abs(dy)) { g.mode = 'x'; return; }
      const d = detents();
      const atFull = v >= d.full - 1;
      if (!e.cancelable) { g.mode = 'native'; return; }
      if (g.handle || !atFull || (body.scrollTop <= 0 && dy > 0)) {
        g.mode = 'sheet';
        g.yStart = t.clientY;
        g.vStart = v;
        setFull(false);
      } else {
        g.mode = 'native';
        return;
      }
    }
    if (g.mode !== 'sheet') return;
    e.preventDefault();
    dragTo(g.vStart - (t.clientY - g.yStart));
    g.samples.push([t.clientY, e.timeStamp]);
    if (g.samples.length > 12) g.samples.shift();
  }, { passive: false });

  const touchEnd = (e) => {
    if (!g) return;
    let ended = false;
    for (const c of e.changedTouches) if (c.identifier === g.id) ended = true;
    if (!ended) return;
    const gg = g;
    g = null;
    if (gg.mode === 'sheet') release(velocityOf(gg.samples), gg.startDetent);
    else if (gg.resume != null) snap(detent);  // a tap interrupted a settle: finish it
  };
  sheet.addEventListener('touchend', touchEnd);
  sheet.addEventListener('touchcancel', touchEnd);

  // ---------------------------------------------------------------- mouse / pen (narrow desktop windows)
  sheet.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || isDesktop() || e.button !== 0) return;
    if (!e.target.closest('.grab, [data-drag]') || e.target.closest('.chips, .rail, input, a, button')) return;
    stopAnim();
    const p = { id: e.pointerId, y0: e.clientY, vStart: v, moved: false, samples: [[e.clientY, e.timeStamp]], startDetent: detent };
    const move = (ev) => {
      if (ev.pointerId !== p.id) return;
      if (!p.moved && Math.abs(ev.clientY - p.y0) < SLOP) return;
      if (!p.moved) { p.moved = true; setFull(false); try { sheet.setPointerCapture(p.id); } catch { /* fine */ } }
      dragTo(p.vStart - (ev.clientY - p.y0));
      p.samples.push([ev.clientY, ev.timeStamp]);
      if (p.samples.length > 12) p.samples.shift();
    };
    const up = (ev) => {
      if (ev.pointerId !== p.id) return;
      sheet.removeEventListener('pointermove', move);
      sheet.removeEventListener('pointerup', up);
      sheet.removeEventListener('pointercancel', up);
      if (p.moved) {
        release(velocityOf(p.samples), p.startDetent);
        const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        sheet.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => sheet.removeEventListener('click', swallow, { capture: true }), 0);
      } else if (detent && !anim) snap(detent);
    };
    sheet.addEventListener('pointermove', move);
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
  });

  addEventListener('resize', () => {
    if (isDesktop()) { sheet.style.transform = ''; return; }
    snap(detent, { instant: true });
  });

  return {
    snap,
    get detent() { return detent; },
    get visible() { return v; },
    detents,
    /** Height of the collapsed state, clamped to sensible bounds. */
    setPeek(px) { peekPx = Math.max(150, Math.min(Math.round(px), 320)); },
    /** Tap on the grabber: peek -> half -> full -> half. */
    cycle() { snap(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'half'); },
    isDragging: () => !!(g && g.mode === 'sheet'),
  };
}
