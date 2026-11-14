// Toei buses: route codes for the bus chips, ported from trafik.live's bus map: the font stack adds Japanese faces so 都01 / 渋66 draw on every phone.
//
// Route codes for the bus chips, drawn once each into a signed-distance-field atlas (one cell per code). The chip
// shader samples it, so a code stays sharp at any sub-pixel position while the bus glides, at any device pixel ratio.
// The distance transform is the Felzenszwalb-Huttenlocher EDT as in @mapbox/tiny-sdf (BSD-2-Clause).

const INF = 1e20;
// The font: the system stack (SF Pro on Apple devices), nothing downloaded; codes at 600.
const FAMILY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic UI', 'Yu Gothic', Meiryo, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const WEIGHT = 600;

export class LabelAtlas {
  constructor() {
    const dpr = (globalThis.devicePixelRatio || 1);
    this.S = Math.min(3, Math.max(2, Math.round(dpr))); // atlas px per css px
    this.cellW = 64; // css px
    this.cellH = 22;
    this.pad = 4; // css px of SDF buffer left/right of the text
    this.R = 3; // css px of distance range on each side of an edge
    this.fontPx = 11;
    this.width = 1024;
    this.cols = Math.floor(this.width / (this.cellW * this.S));
    this.rows = 0;
    this.height = 0;
    this.data = new Uint8Array(0);
    this.map = new Map();
    this.count = 0;
    this.dirty = false;
    this.version = 0;
    this._canvas = null;
  }

  /** {i, w} for a code (w = text width in css px), drawing it on first use. */
  get(text) {
    let e = this.map.get(text);
    if (e) return e;
    if (typeof document === 'undefined') return null;
    const i = this.count++;
    const row = Math.floor(i / this.cols);
    if (row >= this.rows) this._growRows(row + 1);
    const w = this._draw(text, i);
    e = { i, w };
    this.map.set(text, e);
    this.dirty = true;
    this.version++;
    return e;
  }

  _growRows(need) {
    const cellHpx = this.cellH * this.S;
    let rows = Math.max(need, this.rows ? this.rows * 2 : 8);
    // texture height: power of two (WebGL1 friendly), at most 4096
    let h = 64;
    while (h < rows * cellHpx) h *= 2;
    h = Math.min(h, 4096);
    rows = Math.floor(h / cellHpx);
    const data = new Uint8Array(this.width * h);
    if (this.data.length) data.set(this.data);
    this.data = data;
    this.rows = rows;
    this.height = h;
  }

  _draw(text, i) {
    const S = this.S;
    const cw = this.cellW * S, ch = this.cellH * S;
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = cw; this._canvas.height = ch;
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }
    const g = this._ctx;
    g.clearRect(0, 0, cw, ch);
    // a "JAK." style prefix is set smaller, so Mikrotrans chips stay compact and the number reads first
    const m = /^([A-Z]{2,4}\.)(.+)$/.exec(text);
    const parts = m ? [[m[1], 0.7], [m[2], 1]] : [[text, 1]];
    let fs = this.fontPx * S;
    const measure = () => parts.reduce((a, [t, k]) => { g.font = `${WEIGHT} ${fs * k}px ${FAMILY}`; return a + g.measureText(t).width; }, 0);
    let w = measure();
    const maxW = (this.cellW - this.pad * 2) * S;
    if (w > maxW) { fs *= maxW / w; w = measure(); }
    g.fillStyle = '#000';
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    // centre the cap height (codes are capitals and digits)
    const base = ch / 2 + (fs * 0.72) / 2;
    let x = this.pad * S;
    for (const [t, k] of parts) {
      g.font = `${WEIGHT} ${fs * k}px ${FAMILY}`;
      g.fillText(t, x, base);
      x += g.measureText(t).width;
    }
    const img = g.getImageData(0, 0, cw, ch).data;
    const sdf = this._sdf(img, cw, ch, this.R * S);
    const col = i % this.cols, row = Math.floor(i / this.cols);
    const x0 = col * cw, y0 = row * ch;
    for (let y = 0; y < ch; y++) this.data.set(sdf.subarray(y * cw, (y + 1) * cw), (y0 + y) * this.width + x0);
    return w / S;
  }

  _sdf(rgba, w, h, radius) {
    const n = w * h;
    const outer = new Float64Array(n), inner = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = rgba[i * 4 + 3] / 255;
      if (a >= 1) { outer[i] = 0; inner[i] = INF; } else if (a <= 0) { outer[i] = INF; inner[i] = 0; } else {
        const d = 0.5 - a;
        outer[i] = d > 0 ? d * d : 0;
        inner[i] = d < 0 ? d * d : 0;
      }
    }
    const L = Math.max(w, h);
    const f = new Float64Array(L), v = new Uint16Array(L), z = new Float64Array(L + 1);
    edt(outer, w, h, f, v, z);
    edt(inner, w, h, f, v, z);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
      out[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / radius + 0.5))));
    }
    return out;
  }
}

function edt(data, w, h, f, v, z) {
  for (let x = 0; x < w; x++) edt1d(data, x, w, h, f, v, z);
  for (let y = 0; y < h; y++) edt1d(data, y * w, 1, w, f, v, z);
}

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
