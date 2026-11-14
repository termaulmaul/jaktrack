import { PIN_CSS } from './pins.js';

// The map's own bits of DOM: the CSS MapLibre needs (so the map works even if the app doesn't load maplibre-gl.css)
// and the blue "you are here" dot. Every rule is either a `tm-` class
// or a MapLibre class scoped under our container's `tm-map` class inside `:where()` (zero specificity), so nothing
// leaks into a host page and the host's own layout rules for its container always win.

const CSS = `
:where(.tm-map.maplibregl-map){overflow:hidden;position:relative;-webkit-tap-highlight-color:rgba(0,0,0,0)}
:where(.tm-map .maplibregl-canvas){left:0;position:absolute;top:0}
:where(.tm-map .maplibregl-canvas-container.maplibregl-interactive){cursor:grab;-webkit-user-select:none;user-select:none}
:where(.tm-map .maplibregl-canvas-container.maplibregl-interactive:active){cursor:grabbing}
:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-zoom-rotate),:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-zoom-rotate .maplibregl-canvas){touch-action:pan-x pan-y}
:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-drag-pan),:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-drag-pan .maplibregl-canvas){touch-action:pinch-zoom}
:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan),:where(.tm-map .maplibregl-canvas-container.maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan .maplibregl-canvas){touch-action:none}
:where(.tm-map .maplibregl-ctrl-bottom-left),:where(.tm-map .maplibregl-ctrl-bottom-right),:where(.tm-map .maplibregl-ctrl-top-left),:where(.tm-map .maplibregl-ctrl-top-right){pointer-events:none;position:absolute;z-index:2}
:where(.tm-map .maplibregl-marker){position:absolute;top:0;left:0;will-change:transform}
:where(.tm-map .maplibregl-canvas-container.tm-hover){cursor:pointer}
.tm-attrib{position:absolute;right:var(--tm-attrib-right,8px);bottom:var(--tm-attrib-bottom,8px);z-index:3;display:flex;align-items:center;gap:2px;
  max-width:calc(100% - 16px);padding:0 2px 0 8px;height:22px;border-radius:11px;background:rgba(255,255,255,.88);
  -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 1px 1px rgba(16,24,40,.06),0 2px 8px rgba(16,24,40,.10);
  font:500 10.5px/22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#6B6B70;
  transition:background .2s;pointer-events:auto}
.tm-attrib a{color:inherit;text-decoration:none}
.tm-attrib a:hover{text-decoration:underline}
.tm-attrib .tm-full{display:none;white-space:normal;line-height:1.35;padding:4px 0}
.tm-attrib .tm-short{white-space:nowrap}
.tm-attrib button{all:unset;cursor:pointer;width:22px;height:22px;display:grid;place-items:center;border-radius:11px;flex:none;color:#6B6B70}
.tm-attrib button:focus-visible{outline:2px solid #6C63F0;outline-offset:-2px}
.tm-attrib button svg{width:14px;height:14px}
.tm-attrib.open{height:auto;min-height:22px;border-radius:12px;padding:2px 2px 2px 10px;align-items:flex-start}
.tm-attrib.open .tm-full{display:block}
.tm-attrib.open .tm-short{display:none}
.tm-me{width:22px;height:22px;pointer-events:none}
.tm-me::before{content:"";position:absolute;inset:-10px;border-radius:50%;background:rgba(47,124,246,.22);animation:tm-me 2.4s ease-out infinite}
.tm-me::after{content:"";position:absolute;inset:3px;border-radius:50%;background:#2F7CF6;border:3px solid #fff;box-shadow:0 1px 4px rgba(16,24,40,.35)}
@keyframes tm-me{0%{transform:scale(.45);opacity:1}100%{transform:scale(1.25);opacity:0}}
@media (prefers-reduced-motion:reduce){.tm-me::before{animation:none;opacity:.6;transform:scale(.8)}}
`;

export function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('tm-map-css')) return;
  const s = document.createElement('style');
  s.id = 'tm-map-css';
  s.textContent = CSS + PIN_CSS;
  document.head.appendChild(s);
}

