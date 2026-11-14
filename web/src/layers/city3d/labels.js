// 3D view: train labels in 3D: each 3D train
// carries the text its 2D label shows, above its middle car, in the 2D label's own look (near-black text in a white
// halo, the same font as the trainsets' labels), not in a pill, so a label reads the same on both sides of the 3D switch
// and long names never become the loudest marks on a calm map.
//
// Drawn on a 2D canvas laid over the map canvas (pointer-events none, under the map's controls), redrawn with every frame
// of the trains layer (vehicles.js calls draw()). Declutter: labels are placed greedily (the picked train first, then
// the trains nearest the camera; a label shown last frame places before new ones, so labels do not trade places while
// trains move) and one whose box, GAP_PX around it, would overlap a placed one is left out. Only solid trains (not the
// faint ones of the other level) and only from MIN_Z. The map's own labels (station names first) win: a train label
// that would cover one is left out.
//
// Only inside area() (css px { l, t, r, b }: index.js gives the map minus the page's bars, its own chip row, the
// controls and the sheet), whole, never cut by an edge.
// deco(train, mode) may add { code, color } (a round chip in the line's colour with its letter,
// before the text: the underground view's "line + destination") and live: true (a dot in the live green before it all,
// as the Live pill's: only a train with a fresh live report, never an estimate or the timetable). The underground view
// labels from MIN_Z_UG.
// export function createLabels(map, { text(train) -> string, deco?(train, mode), area?() }) -> { draw(trains, M64, map,
//   mode, selected), clear(), boxes(), destroy(), stats() }

export const FONT = "600 11.5px -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const MIN_Z = 14.6, MIN_Z_UG = 13.9, MAX_LABELS = 36, GAP_PX = 4, LIFT_PX = 8;
const H_PX = 16;
const CHIP_FONT = "700 9.5px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const CHIP_H = 14, DOT_D = 8, DECO_GAP = 4;
const TAG_FONT = "600 10.5px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Hiragino Sans', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const RULER_FONT = "600 10px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const TAG_H = 14;
// the free camera's depth gauge (a fixed scale, real metres, a marker at the eye)
const GAUGE_FONT = "700 11px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const GAUGE_H = 140;
const NO_HOLES = [];
export const LIVE_DOT = '#1E9E4A';   // trains.js LIVE_RING / the Live pill's dot

export function createLabels(map, { text = (t) => t.label || '', deco = null, area = null } = {}) {
  const host = map.getCanvasContainer?.() || map.getCanvas().parentElement;
  const cv = document.createElement('canvas');
  cv.className = 'tk3d-labels';
  cv.setAttribute('aria-hidden', 'true');
  Object.assign(cv.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '1' });
  host.appendChild(cv);
  const g = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1, dirty = false;
  let shown = new Set();
  let last = [];   // the labels drawn last frame: { kind, text, x, y, w, h } (css px, map canvas) for QA's overlap check
  const widths = new Map();
  const st = { drawn: 0, hidden: 0, yielded: 0 };

  function size() {
    const el = map.getCanvas();
    const cw = el.clientWidth, ch = el.clientHeight, r = Math.min(3, globalThis.devicePixelRatio || 1);
    if (cw !== w || ch !== h || r !== dpr) {
      w = cw; h = ch; dpr = r;
      cv.width = Math.round(cw * r); cv.height = Math.round(ch * r);
      cv.style.width = `${cw}px`; cv.style.height = `${ch}px`;
    }
  }
  function measure(s) {
    let v = widths.get(s);
    if (v == null) {
      g.font = FONT;
      v = Math.ceil(g.measureText(s).width) + 8;
      if (widths.size > 4000) widths.clear();
      widths.set(s, v);
    }
    return v;
  }
  const chipW = new Map();
  function measureChip(code) {
    let v = chipW.get(code);
    if (v == null) {
      g.font = CHIP_FONT;
      v = Math.max(CHIP_H, Math.ceil(g.measureText(code).width) + 8);
      chipW.set(code, v);
    }
    return v;
  }
  /** Readable white or near-black letters on a line colour (WCAG relative luminance). */
  const inkOn = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    if (!m) return '#FFFFFF';
    const n = parseInt(m[1], 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.36 ? '#1C1C21' : '#FFFFFF';
  };
  function clear() {
    if (!dirty) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    dirty = false;
    shown = new Set();
    last = [];
  }

  // the underground view round 2: extras = { ruler: [{ d (m), ny (NDC y of the map's centre at that the heights build depth) }], tags: [{ id,
  // nx, ny, text: 'B2 · −11 m', code, color }] }: a slim depth scale at the left of the free map (placed first, its box
  // kept clear) and depth tags at hub platforms (placed after the trains, decluttered like them: nothing overlaps)
  function draw(trains, M, mp, mode, selected, extras = null) {
    size();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    dirty = true;
    st.drawn = 0; st.hidden = 0; st.yielded = 0; st.live = 0;
    last = [];
    const hasExtras = !!(extras && (extras.ruler?.length || extras.tags?.length || extras.gauge));
    if (mp.getZoom() < (mode?.underground ? MIN_Z_UG : MIN_Z) || (!trains?.length && !hasExtras)) { shown = new Set(); return; }
    // candidates: screen point above the middle car, distance (clip w) for priority
    const cand = [];
    for (const t of trains) {
      if (t.faint || !t.anchor) continue;
      const [X, Y, Z] = t.anchor;
      const cw = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      if (cw <= 0) continue;
      const nx = (M[0] * X + M[4] * Y + M[8] * Z + M[12]) / cw, ny = (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / cw;
      if (nx < -1.1 || nx > 1.1 || ny < -1.1 || ny > 1.1) continue;
      const s = text(t);
      if (!s) continue;
      let d = null;
      try { d = typeof deco === 'function' ? deco(t, mode) : null; } catch { d = null; }
      const pri = (selected != null && (t.id === selected || t.run?.key === selected) ? -1e9 : 0) + (shown.has(t.id) ? cw * 0.6 : cw)
        - (d?.live ? 0.25 * Math.abs(cw) : 0);   // a live train's label places a little earlier (it is the news)
      cand.push({ t, s, d, x: (nx + 1) / 2 * w, y: (1 - ny) / 2 * h - LIFT_PX, pri });
    }
    cand.sort((a, b) => a.pri - b.pri);
    const boxes = [];
    const next = new Set();
    // the map's own labels win: station names, places, road and river names, station dots. MapLibre's last placement:
    // its collision grid AND ignored grid, boxes [x1, y1, x2, y2] and the line-placed labels as circles [x, y, r], css
    // px + its 100 px viewport padding: scanned the way trains.js does (3D labels sat on "Higashi
    // Gotanda", "Gotanda", "区役所通り"). Internal API, so only when it is there; else labels declutter among themselves.
    const grids = [];
    try {
      const ci = mp.style?.placement?.collisionIndex;
      for (const gr of [ci?.grid, ci?.ignoredGrid]) if (gr && Array.isArray(gr.bboxes)) grids.push(gr);
    } catch { grids.length = 0; }
    const mapHit = grids.length ? (x0, y0, x1, y1) => {
      const X0 = x0 + 100, Y0 = y0 + 100, X1 = x1 + 100, Y1 = y1 + 100;
      for (const gr of grids) {
        const bb = gr.bboxes;
        for (let i = 0, e = bb.length; i < e; i += 4) if (X0 < bb[i + 2] && X1 > bb[i] && Y0 < bb[i + 3] && Y1 > bb[i + 1]) return true;
        const cc = gr.circles;
        if (!Array.isArray(cc)) continue;
        for (let i = 0, e = cc.length; i < e; i += 3) {
          const cx = cc[i], cy = cc[i + 1], r = cc[i + 2];
          if (cx + r <= X0 || cx - r >= X1 || cy + r <= Y0 || cy - r >= Y1) continue;
          const dx = cx < X0 ? X0 - cx : cx > X1 ? cx - X1 : 0, dy = cy < Y0 ? Y0 - cy : cy > Y1 ? cy - Y1 : 0;
          if (dx * dx + dy * dy < r * r) return true;
        }
      }
      return false;
    } : null;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = FONT;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // where labels may go: the map minus the page's bars, pill row, controls and sheet (area(), css px), else the canvas
    let A = null;
    try { A = typeof area === 'function' ? area() : null; } catch { A = null; }
    const L = Math.max(2, A?.l ?? 0), T = Math.max(2, A?.t ?? 0), R = Math.min(w - 2, A?.r ?? w), B = Math.min(h - 2, A?.b ?? h);
    const HO = A?.holes || NO_HOLES;   // the free camera's pad, buttons and key card
    const inHole = (x0, y0, x1, y1) => { for (let i = 0; i < HO.length; i++) { const q = HO[i]; if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return true; } return false; };
    const free = (x0, y0, x1, y1) => {
      if (x0 + GAP_PX < L || x1 - GAP_PX > R || y0 + GAP_PX < T || y1 - GAP_PX > B) return false;   // whole, inside the free map
      if (HO.length && inHole(x0, y0, x1, y1)) return false;
      for (let i = 0; i < boxes.length; i += 4) {
        if (x0 < boxes[i + 2] && x1 > boxes[i] && y0 < boxes[i + 3] && y1 > boxes[i + 1]) return false;
      }
      if (mapHit && mapHit(x0, y0, x1, y1)) { st.yielded++; return false; }   // the box with its gap, as trains.js
      return true;
    };
    // the depth scale first: a slim vertical rule with ticks at 0, -10 ... -40 m (the heights build metres) where the map's centre
    // would be at that depth, at the left of the free map; its box stays clear of every label
    if (extras?.ruler?.length > 1) {
      const pts = extras.ruler.map((r) => ({ d: r.d, y: (1 - r.ny) / 2 * h })).filter((r) => r.y > T + 8 && r.y < B - 8);
      // left of the free map; if the map's own labels are there, the right side; else no scale this frame (rule 9)
      const ya = pts.length > 1 ? Math.min(pts[0].y, pts[pts.length - 1].y) - 8 : 0, yb = pts.length > 1 ? Math.max(pts[0].y, pts[pts.length - 1].y) + 8 : 0;
      let rx = -1;
      for (const xx of [L + 10, R - 52]) if (!mapHit || !mapHit(xx - 6, ya, xx + 40, yb)) { rx = xx; break; }
      if (pts.length > 1 && rx >= 0) {
        const x = rx, y0 = pts[0].y, y1 = pts[pts.length - 1].y;
        g.strokeStyle = 'rgba(85,85,93,0.55)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
        g.font = RULER_FONT; g.textAlign = 'left';
        for (const r of pts) {
          g.beginPath(); g.moveTo(x - 3, r.y); g.lineTo(x + 3, r.y); g.stroke();
          const tx = r.d === 0 ? '0 m' : `−${r.d}${r === pts[pts.length - 1] ? ' m' : ''}`;
          g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.strokeText(tx, x + 6, r.y);
          g.fillStyle = '#6B6B73'; g.fillText(tx, x + 6, r.y);
          g.strokeStyle = 'rgba(85,85,93,0.55)'; g.lineWidth = 1.2;
        }
        g.textAlign = 'center'; g.font = FONT;
        boxes.push(x - 6, Math.min(y0, y1) - 8, x + 40, Math.max(y0, y1) + 8);
        last.push({ kind: 'ruler', text: 'depth scale', x: x - 6, y: Math.min(y0, y1) - 8, w: 46, h: Math.abs(y1 - y0) + 16 });
      }
    }
    // while the free camera flies, the depth scale is a fixed one (0.. -40 m, real metres: drawn / exag)
    // with a marker at the eye's depth ("−12 m"; over the street "+35 m" at its top), left of the free map, else right
    if (extras?.gauge) {
      const gz = extras.gauge.z, real = gz < 0 ? gz / (extras.gauge.exag || 1) : gz;
      const maxD = Math.max(40, Math.min(60, Math.ceil(-real / 10) * 10));
      // near the top of the free map (the pad and the key card live at its bottom)
      const yTop = T + 34, yBot = yTop + GAUGE_H;
      let x = -1;
      if (yBot < B - 10) for (const xx of [L + 16, R - 76]) if ((!mapHit || !mapHit(xx - 12, yTop - 24, xx + 60, yBot + 8)) && !inHole(xx - 12, yTop - 24, xx + 60, yBot + 8)) { x = xx; break; }
      if (x >= 0) {
        const yAt = (d) => yTop + (d / maxD) * GAUGE_H;
        const my = real >= 0 ? yTop : yAt(Math.min(maxD, -real));
        g.strokeStyle = 'rgba(85,85,93,0.55)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, yTop); g.lineTo(x, yBot); g.stroke();
        g.font = RULER_FONT; g.textAlign = 'left';
        for (let d = 0; d <= maxD; d += 10) {
          const y = yAt(d);
          g.beginPath(); g.moveTo(x - 3, y); g.lineTo(x + 3, y); g.stroke();
          if (Math.abs(y - my) < 10) continue;   // the marker's own words win
          const tx = d === 0 ? '0 m' : `−${d}${d === maxD ? ' m' : ''}`;
          g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.strokeText(tx, x + 6, y);
          g.fillStyle = '#6B6B73'; g.fillText(tx, x + 6, y);
          g.strokeStyle = 'rgba(85,85,93,0.55)'; g.lineWidth = 1.2;
        }
        g.beginPath(); g.moveTo(x - 2, my); g.lineTo(x - 10, my - 5.5); g.lineTo(x - 10, my + 5.5); g.closePath();
        g.fillStyle = '#1C1C21'; g.fill();
        const mt = real >= 0 ? `+${Math.round(real)} m` : `−${Math.round(-real)} m`;
        g.font = GAUGE_FONT;
        g.lineWidth = 3.4; g.strokeStyle = '#FFFFFF'; g.strokeText(mt, x + 6, real >= 0 ? my - 14 : my);
        g.fillStyle = '#1C1C21'; g.fillText(mt, x + 6, real >= 0 ? my - 14 : my);
        g.textAlign = 'center'; g.font = FONT;
        boxes.push(x - 12, yTop - 24, x + 60, yBot + 8);
        last.push({ kind: 'gauge', text: mt, x: x - 12, y: yTop - 24, w: 72, h: GAUGE_H + 32 });
      }
    }
    for (const c of cand) {
      if (boxes.length >= MAX_LABELS * 4) { st.hidden++; continue; }
      const tw = measure(c.s);
      const cwid = c.d?.code ? measureChip(c.d.code) + DECO_GAP : 0, dw = c.d?.live ? DOT_D + DECO_GAP : 0;
      const bw = tw + cwid + dw;
      // above the train first, else just below it; a train near a side of the free map slides its label in (the underground view:
      // the label stays over its train, at most half its width off centre), so trains by the edges keep their names
      let y = -1;
      const half = bw / 2 + GAP_PX;
      const cx = Math.max(L + half, Math.min(R - half, c.x));
      if (Math.abs(cx - c.x) > bw / 2) { st.hidden++; continue; }
      for (const dy of [0, H_PX + 2 * LIFT_PX]) {
        const cy = c.y + dy;
        if (free(cx - half, cy - H_PX / 2 - GAP_PX, cx + half, cy + H_PX / 2 + GAP_PX)) { y = cy; break; }
      }
      if (y < 0) { st.hidden++; continue; }
      c.x = cx;
      boxes.push(c.x - bw / 2 - GAP_PX, y - H_PX / 2 - GAP_PX, c.x + bw / 2 + GAP_PX, y + H_PX / 2 + GAP_PX);
      next.add(c.t.id);
      last.push({ kind: 'train', text: c.s, id: c.t.id, x: c.x - bw / 2, y: y - H_PX / 2, w: bw, h: H_PX, live: !!c.d?.live, code: c.d?.code || null });
      // left to right: the live dot, the line chip, the text (centred as a whole over the train)
      let x0 = c.x - bw / 2 + 4;
      if (dw) {
        g.beginPath(); g.arc(x0 + DOT_D / 2, y, DOT_D / 2 + 1.5, 0, Math.PI * 2); g.fillStyle = '#FFFFFF'; g.fill();
        g.beginPath(); g.arc(x0 + DOT_D / 2, y, DOT_D / 2, 0, Math.PI * 2); g.fillStyle = LIVE_DOT; g.fill();
        x0 += dw;
      }
      if (cwid) {
        const chw = cwid - DECO_GAP, r = CHIP_H / 2;
        g.beginPath();
        g.moveTo(x0 + r, y - r); g.lineTo(x0 + chw - r, y - r); g.arc(x0 + chw - r, y, r, -Math.PI / 2, Math.PI / 2);
        g.lineTo(x0 + r, y + r); g.arc(x0 + r, y, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
        g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.stroke();
        g.fillStyle = c.d.color || '#888890'; g.fill();
        g.font = CHIP_FONT; g.fillStyle = inkOn(c.d.color); g.fillText(c.d.code, x0 + chw / 2, y + 0.5);
        g.font = FONT;
        x0 += cwid;
      }
      const tx = x0 + (tw - 8) / 2;
      g.strokeStyle = '#FFFFFF';
      g.lineWidth = 3.4;
      g.strokeText(c.s, tx, y);
      // the station names' ink; the picked train's label darker (as the 2D trains)
      g.fillStyle = c.pri < -1e8 ? '#1C1C21' : '#55555D';
      g.fillText(c.s, tx, y);
      st.drawn++;
      if (c.d?.live) st.live = (st.live || 0) + 1;
    }
    // depth tags at hub platforms (after the trains: a train's name wins): "[chip] B2 · −11 m" right of the platform
    if (extras?.tags?.length) {
      let n = 0;
      for (const tg of extras.tags) {
        if (n >= 14) break;
        const x = (tg.nx + 1) / 2 * w + 6, y = (1 - tg.ny) / 2 * h;
        g.font = TAG_FONT;
        const tw = Math.ceil(g.measureText(tg.text).width) + 8;
        const cwid = tg.code ? measureChip(tg.code) + DECO_GAP : 0;
        const bw = tw + cwid;
        const x0b = x - GAP_PX, y0b = y - TAG_H / 2 - GAP_PX, x1b = x + bw + GAP_PX, y1b = y + TAG_H / 2 + GAP_PX;
        if (!free(x0b, y0b, x1b, y1b)) continue;
        boxes.push(x0b, y0b, x1b, y1b);
        last.push({ kind: 'depth', text: tg.text, id: tg.id, x, y: y - TAG_H / 2, w: bw, h: TAG_H, code: tg.code || null });
        let xx = x;
        if (cwid) {
          const chw = cwid - DECO_GAP, r = CHIP_H / 2;
          g.beginPath();
          g.moveTo(xx + r, y - r); g.lineTo(xx + chw - r, y - r); g.arc(xx + chw - r, y, r, -Math.PI / 2, Math.PI / 2);
          g.lineTo(xx + r, y + r); g.arc(xx + r, y, r, Math.PI / 2, Math.PI * 1.5); g.closePath();
          g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.stroke();
          g.fillStyle = tg.color || '#888890'; g.fill();
          g.font = CHIP_FONT; g.textAlign = 'center'; g.fillStyle = inkOn(tg.color); g.fillText(tg.code, xx + chw / 2, y + 0.5);
          xx += cwid;
        }
        g.font = TAG_FONT; g.textAlign = 'left';
        g.lineWidth = 3; g.strokeStyle = '#FFFFFF'; g.strokeText(tg.text, xx + 2, y);
        g.fillStyle = '#4A4A52'; g.fillText(tg.text, xx + 2, y);
        g.textAlign = 'center'; g.font = FONT;
        n++;
      }
      st.tags = n;
    }
    shown = next;
  }

  return {
    draw,
    clear,
    stats: () => ({ ...st }),
    /** The labels drawn last frame (css px relative to the map canvas). */
    boxes: () => last.map((b) => ({ ...b })),
    destroy() { clear(); cv.remove(); },
  };
}
