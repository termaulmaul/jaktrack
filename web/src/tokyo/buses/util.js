// Toei buses: small shared helpers, ported from trafik.live's bus map.
// with Tokyo constants: Web Mercator, a local metric frame for Greater Tokyo, the network pack's polyline
// decoder, route colours that read on the calm light map.

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- geo
// Positions live in Web Mercator units (0..1). Multiplying by MPU gives ground metres near central Tokyo (the scale
// factor varies by < 0.4 % between Ome and Edogawa), so distances and speeds can be computed in that frame directly.
const LAT0 = -6.2;
export const MPU = 40075016.68557849 * Math.cos((LAT0 * Math.PI) / 180);
export const mercX = (lng) => (lng + 180) / 360;
export const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const lngOf = (mx) => mx * 360 - 180;
export const latOf = (my) => (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * my) * Math.PI)) - 90;
/** Metric frame: X east, Y south, metres. */
export const toX = (lng) => mercX(lng) * MPU;
export const toY = (lat) => mercY(lat) * MPU;
export const lngOfX = (x) => lngOf(x / MPU);
export const latOfY = (y) => latOf(y / MPU);
export const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
/** The middle of the Toei Bus area (Shinjuku-Tokyo station-ish): GPU positions are offsets from here (no shiver). */
export const ORIGIN = [mercX(106.82), mercY(-6.2)];

/** The network pack's polyline (precision 1e5, [lng, lat] order, net.js decodePath) -> flat [lng, lat, lng, lat, ...]. */
export function decodePath(str) {
  const out = [];
  let i = 0, lng = 0, lat = 0;
  const next = () => {
    let v = 0, shift = 0, b;
    do { b = str.charCodeAt(i++) - 63; v |= (b & 31) << shift; shift += 5; } while (b >= 32 && i <= str.length);
    return v & 1 ? ~(v >>> 1) : v >>> 1;
  };
  while (i < str.length) {
    lng += next(); lat += next();
    out.push(lng / 1e5, lat / 1e5);
  }
  return out;
}

// ---------------------------------------------------------------- colour
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export const toHex = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();

const s2l = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const l2s = (c) => 255 * clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1);
function oklab([r, g, b]) {
  r = s2l(r); g = s2l(g); b = s2l(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    l2s(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

export const BUS_GREY = '#6B6B70';

/**
 * A route colour that reads on the calm light map (trafik.live's rule): very light GTFS colours are taken down in OKLab
 * lightness, keeping their hue. Toei's own colours are mostly mid-tones and pass unchanged. Returns the display colour
 * and a text colour for the code on the chip.
 */
export function routeColor(hex) {
  const rgb0 = parseHex(hex) || parseHex(BUS_GREY);
  const lab = oklab(rgb0);
  const hue = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  const maxL = hue > 75 && hue < 125 && Math.hypot(lab[1], lab[2]) > 0.06 ? 0.68 : 0.74;
  if (lab[0] > maxL) {
    const k = maxL / lab[0];
    const L0 = lab[0];
    lab[0] = maxL;
    const boost = 1 + (1 - k) * 1.3;
    const C = Math.hypot(lab[1], lab[2]) * boost;
    let h = Math.atan2(lab[2], lab[1]);
    const hd = (h * 180) / Math.PI;
    if (hd > 80 && hd < 125) h -= ((14 * Math.PI) / 180) * clamp((L0 - 0.86) / 0.1, 0, 1);
    lab[1] = C * Math.cos(h); lab[2] = C * Math.sin(h);
  }
  const rgb = fromOklab(lab).map(Math.round);
  return { hex: toHex(rgb), rgb, text: lab[0] > 0.72 ? [31, 29, 43] : [255, 255, 255] };
}
