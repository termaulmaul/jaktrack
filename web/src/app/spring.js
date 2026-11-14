// Springs in Apple's terms (response in seconds, damping ratio), solved analytically so an animation can be
// interrupted at any frame and re-targeted from its live position and velocity.

/** Displacement x0 (from target) and velocity v0 (units/s) -> [x, v] after t seconds. */
export function springAt(x0, v0, response, damping, t) {
  const w0 = (2 * Math.PI) / response;
  if (damping < 1) {
    const wd = w0 * Math.sqrt(1 - damping * damping);
    const e = Math.exp(-damping * w0 * t);
    const B = (v0 + damping * w0 * x0) / wd;
    const c = Math.cos(wd * t);
    const s = Math.sin(wd * t);
    return [e * (x0 * c + B * s), e * ((B * wd - damping * w0 * x0) * c - (x0 * wd + damping * w0 * B) * s)];
  }
  const e = Math.exp(-w0 * t);
  const B = v0 + w0 * x0;
  return [e * (x0 + B * t), e * (B - w0 * (x0 + B * t))];
}

/** Momentum projection (Apple's Designing Fluid Interfaces sample): where a flick at `v` px/s would come to rest. */
export const project = (v, rate = 0.994) => ((v / 1000) * rate) / (1 - rate);

/** Rubber-band an overshoot: the further past the edge, the less it follows. */
export const rubber = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));

/**
 * Animate a number with a spring. Returns a handle whose stop() gives the live {x, v} so the next animation (or a
 * finger) can start exactly there.
 */
export function animate({ from, to, velocity = 0, response = 0.36, damping = 1, onUpdate, onDone }) {
  const t0 = performance.now();
  const x0 = from - to;
  let cur = { x: from, v: velocity };
  let raf = 0;
  let done = false;
  const frame = (now) => {
    const t = Math.max(0, (now - t0) / 1000);
    const [x, v] = springAt(x0, velocity, response, damping, t);
    if (Math.abs(x) < 0.25 && Math.abs(v) < 6) {
      cur = { x: to, v: 0 };
      done = true;
      onUpdate(to);
      onDone?.();
      return;
    }
    cur = { x: to + x, v };
    onUpdate(to + x);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      cancelAnimationFrame(raf);
      return cur;
    },
    get done() { return done; },
    to,
  };
}
