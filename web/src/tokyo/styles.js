// The page styles: app.css (light tokens, sheet, pane, rows, chips) + the train page's base styles (base/page-styles.js,
// renamed to .tk-app) + the ring bullets (base/ring-styles.js) + Tokyo's deltas below.
// Injected once by page.js. Light UI only; 44 px controls; phone 390x844 first.
import kereta from './base/page-styles.js';
import krl from './base/ring-styles.js';

const base = kereta
  .replace(/\.kr-app \.topbar \.back\{[^}]*\}\n/, '')                        // Tokyo has no parent page: back only in a detail
  .replace(/\.kr-app\[data-screen\][^\n]*#search\{display:none\}\n/, '')     // our screen names differ (rule below)
  .replaceAll('.kr-app', '.tk-app');

export default `${base}${krl}
.tk-app[data-screen="station"] #search,.tk-app[data-screen="train"] #search,.tk-app[data-screen="line"] #search,.tk-app[data-screen="about"] #search{display:none}
/* Scheduled: the pill on the map (phones) and the badge in the pane head (desktop). */
.tk-sched{position:absolute;z-index:30;left:calc(10px + var(--safe-l));top:calc(var(--safe-t) + 60px);display:flex;align-items:center;height:44px;padding:0 4px;background:none;border-radius:999px}
.tk-sched .tk-pill{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px 0 10px;border-radius:999px;background:var(--realm-card);box-shadow:var(--realm-shadow);font:600 12.5px/1 var(--font);color:var(--text2);white-space:nowrap}
.tk-sched i,.tk-badge i{flex:none;width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 1.6px currentColor;position:relative}
.tk-sched i::before,.tk-badge i::before{content:"";position:absolute;left:5.2px;top:2.6px;width:1.6px;height:3.8px;background:currentColor;border-radius:1px}
.tk-sched i::after,.tk-badge i::after{content:"";position:absolute;left:5.2px;top:5.6px;width:3.2px;height:1.6px;background:currentColor;border-radius:1px}
.tk-app[data-loading] .tk-sched{visibility:hidden}
@media (min-width:900px){.tk-sched{display:none}}
.tk-badgebtn{display:inline-flex;align-items:center;height:44px;padding:0 2px;background:none;border-radius:999px}
/* 44 px controls: the segmented tabs and the station chips */
.tk-ug svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.tk-ug[aria-pressed="true"],.tk-app .c3d[aria-pressed="true"]{background:var(--primary,#171717);color:#fff}
/* the card's Underground button: tunnel icon; on desktop its word in a pill left of the card */
.tk-ug .tk-ugw{display:none}
@media (min-width:900px){.tk-app #c3dcard{overflow:visible}.tk-app #c3dcard>#b-3d{border-radius:var(--r-control,14px) var(--r-control,14px) 0 0}.tk-app #c3dcard>#b-locate{border-radius:0 0 var(--r-control,14px) var(--r-control,14px)}.tk-app .ccard .tk-ug{position:relative}.tk-ug .tk-ugw{display:flex;align-items:center;position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);height:32px;padding:0 12px;border-radius:999px;background:var(--realm-card,#fff);box-shadow:var(--realm-shadow,0 1px 2px rgba(16,24,40,.04),0 8px 24px rgba(16,24,40,.07));color:var(--text,#171717);font:600 12.5px/1 var(--font);white-space:nowrap}.tk-ug[aria-pressed="true"] .tk-ugw{background:var(--primary,#171717);color:var(--on-primary,#fff)}}
.tk-seeug svg.i{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
.tk-racts .kr-save .i{width:17px;height:17px}
.tk-sbar{display:flex;gap:8px;align-items:center;min-width:0}
.tk-sbar .search{flex:1;min-width:0}
.tk-rbtn{flex:none;width:44px;height:44px;border-radius:var(--r-control,14px);display:grid;place-items:center;background:var(--panel);color:var(--text)}
.tk-rbtn .i{width:22px;height:22px}
.tk-app[data-detail] .tk-sbar,.tk-app[data-screen="lines"] .tk-sbar{display:none}
@media (hover:hover){.tk-rbtn:hover{background:var(--elevated)}}
.tk-app[data-screen="route"] #search{display:none}
/* app.css hides every .search in a detail screen (the pane's own field); ROUTE's from/to fields use that class too */
.tk-app[data-detail] .rt-f.search{display:flex}
.tk-app .kr-save{height:44px}
.tk-more{align-self:center;margin-left:2px;font:600 12px/1 var(--font);color:var(--text2)}
.tk-app .seg{padding:3px}
/* phones: the toast sits low (over the sheet's list), never over a screen's title */
@media (max-width:899px){.tk-app .toast{top:auto;bottom:calc(var(--safe-b,0px) + 24px)}}
.tk-app .seg button{height:44px}
/* one chip: kereta's 32 px pill in a 44 px box */
.tk-app .chip,.tk-langs button{height:44px;border-top:6px solid transparent;border-bottom:6px solid transparent;background-clip:padding-box}
/* one control card: 3D / Underground / locate; hairlines only between the visible buttons */
.tk-app .ccard button+button{border-top:0}
.tk-app .ccard button:not([hidden])~button:not([hidden]){border-top:.5px solid var(--realm-line)}
/* Japanese words on any screen: Japanese fonts and glyph forms */
:lang(ja){--font:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",Meiryo,"Noto Sans JP","Noto Sans CJK JP",sans-serif}
/* a live train's own screen: the pill says "Live position" with live.js's green dot; an estimated one says
   "Estimated" in the pill's own grey (never green: not measured) */
.tk-app[data-live="live"] .tk-sched .tk-pill,.tk-app[data-live="live"] .tk-badge{color:#157A39}   /* green text at 4.5:1+ (A11Y A6) */
.tk-app[data-live="live"] .tk-sched i,.tk-app[data-live="live"] .tk-badge i{width:8px;height:8px;box-shadow:none;background:currentColor}
.tk-app[data-live="live"] .tk-sched i::before,.tk-app[data-live="live"] .tk-sched i::after,.tk-app[data-live="live"] .tk-badge i::before,.tk-app[data-live="live"] .tk-badge i::after{display:none}
/* with trains on live positions the pill says "● Live · 281" in the same green (data-live="live"
   too); the home headline's live count is a green pill-button to the Live now sheet; the Live chip leads the operator
   chips (pressed = only live trains on the map). The green dot = the map's live ring colour (--income). No motion. */
.tk-ldot{flex:none;display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--income)}
.tk-app .kr-now .big .tk-livehead{position:relative;align-self:center;display:inline-grid;justify-items:start;align-content:center;row-gap:1px;min-height:44px;margin:-5px 0;padding:4px 12px 4px 10px;border-radius:14px;background:var(--income-soft);text-align:left;white-space:nowrap;font-variant-numeric:tabular-nums}
.tk-app .tk-livehead .tk-lh1{display:inline-flex;align-items:center;gap:6px;font:600 15px/18px var(--font);color:#157A39}
.tk-app .tk-livehead .tk-lh2{padding-left:14px;font:400 13px/16px var(--font);color:var(--text2)}
.tk-app .kr-now .big .tk-livehead:focus-visible{outline:none}
.tk-app .kr-now .big .tk-livehead:focus-visible::before{content:"";position:absolute;inset:-4px;border:2px solid var(--chart);border-radius:17px;pointer-events:none}
@media (hover:hover){.tk-app .kr-now .big .tk-livehead:hover{background:rgba(30,158,74,.16)}}
.tk-app .chip.tk-livechip{color:#157A39;font-weight:600}
.tk-app .chip.tk-livechip[aria-pressed="true"]{color:var(--on-primary,#fff)}
.tk-app .chip.tk-livechip[aria-pressed="true"] .tk-ldot{box-shadow:0 0 0 1.5px rgba(255,255,255,.9)}
.tk-badge{cursor:pointer;gap:6px}
.tk-badge i{width:11px;height:11px}
.tk-badge i::before{left:4.7px;top:2.3px;height:3.5px}
.tk-badge i::after{left:4.7px;top:5px;width:3px}
.tk-app .round.oyen{background:var(--realm-card);overflow:hidden}
.tk-app .round.oyen img{object-fit:contain}
.tk-app .ptitle h1{font:700 20px/25px var(--font);letter-spacing:-.01em;white-space:nowrap}
/* names in the other script, small: kanji under romaji on EN/ID screens, romaji under kanji on JA */
.tk-alt{font:400 12.5px/16px var(--font);color:var(--text3);margin-left:6px;white-space:nowrap}
.ph .tk-alt{display:block;margin:2px 0 0}
.tk-langs{display:flex;gap:8px;flex-wrap:wrap}
.tk-langs button{padding:0 16px;border-radius:999px;background:var(--panel);font:600 14px/18px var(--font);color:var(--text)}
.tk-langs button[aria-pressed="true"]{background:var(--primary,#171717);color:#fff}
.tk-text{display:grid;gap:10px;font:400 15px/21px var(--font);color:var(--text)}
.tk-text p{margin:0}
.tk-text .fine,.tk-fine{font:400 13px/18px var(--font);color:var(--text3)}
.tk-credits{display:grid;gap:10px;font:400 13px/18px var(--font);color:var(--text2);overflow-wrap:anywhere}   /* A11Y A14: long words / links no longer push About 8 px past a 320 px screen */
.tk-credits b{display:block;font:600 14px/18px var(--font);color:var(--text)}
.tk-credits a{color:inherit}
.tk-schedcard{display:flex;flex-direction:column;gap:6px;align-items:flex-start;padding:14px 16px;border-radius:18px;background:var(--panel);font:400 13.5px/19px var(--font);color:var(--text2)}
.tk-schedcard b{color:var(--text);font-weight:600}
.tk-tm{flex:none;width:52px;font:700 17px/22px var(--font);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.tk-dep .rt > span{white-space:normal}
.tk-hubs{display:flex;flex-wrap:wrap;gap:8px}
.tk-hubs .chip{background:var(--bg)}
.tk-stops{display:grid;border-radius:18px;background:var(--panel);padding:6px 0}
.tk-app .views{display:grid;gap:16px;min-width:0}
.tk-app .grab .credit a{pointer-events:auto;color:inherit;text-decoration:none}
.tk-app .grab .credit a:hover{text-decoration:underline}
.tk-app .rtile.krl-bullet b{font-family:var(--font)}
@media (min-width:900px){.tk-app .ptitle{gap:10px}}
/* About: the Live position card: the pill's green dot */
.tk-app .badge.tk-livebadge{color:#157A39}
.tk-app .badge.tk-livebadge i{width:8px;height:8px;box-shadow:none;background:currentColor}
.tk-app .badge.tk-livebadge i::before,.tk-app .badge.tk-livebadge i::after{display:none}
/* the bus button in the control card (off by default; pressed = black like 3D); the desktop close */
.tk-bus svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.tk-app[data-screen="bus"] #search,.tk-app[data-screen="bus"] .tk-sbar{display:none}
/* visually hidden text (phone h1, the polite status line) */
.tk-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
/* the search field shows keyboard focus; the placeholder reads at 4.5:1 */
.tk-app .search:focus-within{box-shadow:inset 0 0 0 2px var(--chart)}
.tk-app .search input::placeholder{color:var(--text2)}
/* the tertiary grey is real text everywhere (5.1:1 on white, 4.7:1 on the panel); inactive tabs 5.3:1 */
.tk-app{--text3:#6E6E73}
.tk-app .seg button:not([aria-selected="true"]){color:#5E5E63}
/* the pane head (desktop / landscape): a long badge ("Live position · 19:44") goes under the name instead of cutting it */
.tk-app .ptitle{flex-wrap:wrap;row-gap:0}
.tk-app .ptitle h1{flex-shrink:0;max-width:100%}
/* a section head whose small label does not fit beside the h2 puts it under */
.tk-app .sech{flex-wrap:wrap;row-gap:2px}
/* a focused row's grey keeps its sub-line at 4.5:1 */
.tk-app .row:focus-visible{background:#F0F0F2}
/* text in the sheet >= 13 px */
.tk-app .pfoot .credit{font-size:13px;line-height:17px}
.tk-app .eyebrow{font-size:13px;line-height:16px}
.tk-app .badge.tk-badge{font-size:13px;line-height:16px;height:24px}
.tk-alt{font-size:13px}
/* the phone handle's credit line reads at 13 px on its own row under the grabber
   (9 px beside the grabber touched it at 390 px, and 13 px there runs into it); narrow phones wrap the map credit.
   Phones only: the docked pane (desktop, phones sideways) hides the handle. */
@media (max-width:899px){
.tk-app .grab{height:auto;display:block;justify-items:normal;padding:8px 14px 9px}
.tk-app .grabber{display:block;margin:0 auto}
.tk-app .grab .credit{position:static;flex-wrap:wrap;justify-content:center;gap:0 6px;margin-top:5px;font:400 13px/17px var(--font);color:var(--text3)}
.tk-app .grab .credit span:last-child{margin-left:0}
.tk-app .grab .credit span:first-child::after{content:"·";margin-left:6px}
/* the OSM link is a 44 px tall target that stays inside the handle (never over the search field under it) */
.tk-app .grab .credit a{display:inline-block;padding:18px 0 9px;margin:-18px 0 -9px}
}
@media (max-width:359px){.tk-app .grab .credit span:first-child::after{display:none}}   /* two lines there: no dangling dot */
/* a focused chip shows the app's lavender ring round its visible 32 px pill, not round its
   44 px box (DESIGN D4), like the 3D and playback chips; SHELL's focusin handler scrolls the row to it */
.tk-app .chip:focus-visible,.tk-app .tk-langs button:focus-visible{outline:none}
.tk-app .tk-langs button{position:relative}
.tk-app .chip:focus-visible::before,.tk-app .tk-langs button:focus-visible::before{content:"";position:absolute;inset:-4px;border:2px solid var(--chart);border-radius:999px;pointer-events:none}
/* the same for the Scheduled pill (phones) and badge (pane head): ring round what is seen, not the 44 px button */
.tk-app .tk-sched:focus-visible,.tk-app .tk-badgebtn:focus-visible{outline:none}
.tk-app .tk-sched:focus-visible .tk-pill,.tk-app .tk-badgebtn:focus-visible .tk-badge{outline:2px solid var(--chart);outline-offset:2px}
/* map control cards clip their buttons (overflow hidden, radius 14): the ring goes inside the button, rounded, or a
   focused 3D / bus / locate / zoom button shows only two thin lines */
.tk-app .ccard button:focus-visible{outline:2px solid var(--chart);outline-offset:-5px;border-radius:12px}
/* wrapping chip rows: the 44 px boxes already leave 12 px between the 32 px pills (kereta: 8 px), so no extra row gap */
.tk-app .kr-hubs,.tk-app .tk-hubs,.tk-app .tk-langs{row-gap:0}
/* WebKit draws its own clear button in search fields next to ours (search, planner) */
.tk-app input[type="search"]::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none;display:none}
/* a screen's title takes focus when the screen opens by keyboard (programmatic, not a control: no ring) */
.tk-app .ph h2:focus,.tk-app #view h2[tabindex="-1"]:focus{outline:none}

/* Phones held sideways: the desktop's docked pane, narrower.
   A copy of app.css's (min-width: 900px) block; page.js isDesktop() matches the same query. */
@media (min-width: 640px) and (max-width: 899px) and (max-height: 500px) and (orientation: landscape) {
  :root { --pad-x: 16px; --pane-w: 340px; }
  .app > #map { left: var(--pane-w); }
  .topbar, .grab, .tk-app .grab { display: none; }
  .pane { left: 0; right: auto; top: 0; bottom: 0; width: var(--pane-w); border-radius: 0; border-right: 0.5px solid var(--border); box-shadow: none; transform: none !important; will-change: auto; touch-action: auto; }
  .pane::after { display: none; }
  .phead { display: flex; align-items: center; gap: 12px; padding: 18px 20px 10px; }
  .ptitle { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
  .ptitle h1 { font: 600 20px/25px var(--font); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex-shrink: 1; }
  .ptabs { display: block; padding: 0 20px 12px; }
  .pbody { overflow-y: auto !important; padding: 2px 20px 40px; scrollbar-width: thin; }
  .app[data-detail] .pbody { padding-top: 8px; }
  .pbody::-webkit-scrollbar { display: block; width: 8px; }
  .pbody::-webkit-scrollbar-thumb { background: var(--elevated); border-radius: 4px; }
  .pfoot { display: block; flex: none; border-top: 0.5px solid var(--border); }
  .pfoot .credit { display: block; width: 100%; min-height: 44px; padding: 9px 20px 11px; font: 500 11px/14px var(--font); color: var(--text3); text-align: left; }
  .ctrls { top: calc(16px + var(--safe-t)); right: calc(16px + var(--safe-r)); }
  /* phones pinch to zoom (portrait shows no zoom card either), so the zoom card goes and
     its 98 px of the control column no longer cover station names ("Kinshicho" ran under it) */
  .czoom { display: none; }
  .loading { left: var(--pane-w); z-index: 35; }
  /* iPhone sideways: the Dynamic Island / rounded corners / home indicator stay clear of the pane + controls */
  .pane { padding-left: var(--safe-l); padding-bottom: var(--safe-b); width: calc(var(--pane-w) + var(--safe-l)); box-sizing: border-box; }
  .app > #map { left: calc(var(--pane-w) + var(--safe-l)); }
  .app[data-mapfail] .loading { padding-top: 0; place-items: center; }
  .toast { top: auto; bottom: 24px; left: calc(50% + var(--pane-w) / 2); }
  .consent { left: calc(var(--pane-w) + 16px); right: auto; top: 16px; width: 360px; }
  .app[data-detail] .search { display: none; }
  .tk-sched{display:none}
  .tk-app .toast{left:calc(50% + var(--pane-w) / 2)}
  .phead{padding:10px 16px 6px}
  .tk-app .ptitle h1{font-size:17px;line-height:22px}
  .ptabs{padding:0 16px 8px}
  /* the clock chip and the 3D chip row sit on the map, not under the pane (their own CSS
     only moves them for >= 900 px, so sideways the chip was unreachable). The clock goes bottom right: at the opening
     view that corner is Tokyo Bay, while top left it covered "Ikebukuro" (rule 9); the 3D row takes the top, as on desktop */
  .tk-app .tk-tl{left:auto;right:calc(12px + var(--safe-r));top:auto;bottom:calc(10px + var(--safe-b));max-width:none}
  .tk-app .tk3d-ctl{left:calc(var(--pane-w) + var(--safe-l) + 10px);right:calc(66px + var(--safe-r));top:calc(16px + var(--safe-t))}
  /* the playback sheet: a card beside the pane (desktop's), not a bottom sheet over the pane and most of the map */
  .tk-app .tk-pbsheet{left:calc(var(--pane-w) + var(--safe-l) + 12px);right:auto;bottom:auto;top:calc(8px + var(--safe-t));width:min(380px, calc(100% - var(--pane-w) - var(--safe-l) - var(--safe-r) - 24px));max-height:calc(100% - 16px - var(--safe-t) - var(--safe-b));overflow-y:auto;overscroll-behavior:contain;padding:12px 16px 14px;border-radius:24px;box-shadow:0 1px 2px rgba(16,24,40,.06),0 12px 36px rgba(16,24,40,.16)}
  /* one left edge in the pane (head and tabs are at 16 px, the body and footer were at 20, and the sideways
     chip rows started 4 px short of the pane edge: their -16 px margins follow --pad-x) */
  .pbody{padding-left:var(--pad-x);padding-right:var(--pad-x)}
  .tk-app .pfoot .credit{padding-left:var(--pad-x);padding-right:var(--pad-x)}
  /* the loading card and the toast centre on the map, past the island's inset too */
  .loading{left:calc(var(--pane-w) + var(--safe-l))}
  .tk-app .toast{left:calc(50% + (var(--pane-w) + var(--safe-l)) / 2)}
}
`;
