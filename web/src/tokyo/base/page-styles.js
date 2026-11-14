// The train page's base styles (written for trafik.live's train page as .kr-app; styles.js renames them to .tk-app),
// on top of app.css's tokens (--panel, --text2, 24 px sheets, 14 px controls; ring bullets from ring-styles.js).
export default `
.kr-app .topbar .back{visibility:visible}
.kr-app .round.oyen{background:var(--realm-card);overflow:hidden}
.kr-app .round.oyen img{object-fit:contain}
.kr-app .views{display:grid;gap:16px;min-width:0}
.kr-app[data-screen]:not([data-screen="peta"]):not([data-screen="stasiun"]) #search{display:none}
.kr-app .lcard .lart{object-fit:contain}
.kr-now{display:grid;gap:4px;min-width:0}
.kr-chips .chip b{font-weight:700}
.kr-sth{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;min-width:0}
.kr-sth h2{display:flex;align-items:center;gap:6px;font:700 20px/25px var(--font);letter-spacing:-.01em;min-width:0}
.kr-star{flex:none;width:17px;height:17px;fill:#F5B014;stroke:#E3A008;stroke-width:1.2}
.kr-ghost,.kr-link{position:relative;font:600 14px/18px var(--font);color:var(--chart);padding:0;background:none}
.kr-ghost::after{content:"";position:absolute;inset:-12px -10px}
.kr-link{display:inline;font-size:inherit;line-height:inherit;text-decoration:underline;text-decoration-color:var(--chart-soft);text-underline-offset:2px}
.kr-home{display:grid;gap:10px;min-width:0}
.kr-dg{display:grid;border-radius:18px;background:var(--panel);overflow:hidden;min-width:0}
.kr-dgh{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:11px 14px 1px;min-width:0}
.kr-dgh b{font:600 13.5px/18px var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.kr-dgh small{flex:none;font:400 12px/16px var(--font);color:var(--text3)}
.kr-dg .row{min-height:58px}
.kr-dgf{display:flex;justify-content:space-between;gap:10px;padding:9px 14px 10px;border-top:.5px solid var(--border);font:400 12.5px/16px var(--font);color:var(--text2)}
.kr-dgf b{font-weight:600;color:var(--text);font-variant-numeric:tabular-nums}
.kr-dep .rt b em{font-style:normal;font-weight:500;font-size:13px;color:var(--text3);margin-left:5px}
.kr-where.on::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--text3);margin-right:6px;vertical-align:1px}
.kr-app .row .rr .cd{font:600 17px/22px var(--font);font-variant-numeric:tabular-nums;white-space:nowrap}
.kr-app .cd.go{color:var(--income)}
.kr-none{margin:0;padding:12px 14px 14px;font:400 13px/18px var(--font);color:var(--text2)}
.kr-more{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:0 14px;border-radius:14px;background:var(--panel);font:600 14px/18px var(--font);color:var(--text);text-align:left}
.kr-more .chev{width:16px;height:16px;color:var(--text3)}
.kr-night{display:grid;grid-template-columns:84px minmax(0,1fr);gap:12px;align-items:center;padding:8px 14px 8px 6px;border-radius:18px;background:#EFEDF7}
.kr-night img{width:84px;height:84px;object-fit:contain}
.kr-night b{display:block;font:600 15px/20px var(--font)}
.kr-night span{display:block;font:400 13px/17px var(--font);color:var(--text2)}
.kr-pick{display:grid;gap:12px;padding:12px;border-radius:22px;background:var(--panel)}
.kr-pickh{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:center}
.kr-pickh img{width:72px;height:72px;object-fit:contain;border-radius:18px;background:var(--bg)}
.kr-pickh b{display:block;font:600 16px/21px var(--font)}
.kr-pickh span{display:block;font:400 13px/17px var(--font);color:var(--text2)}
.kr-pick .btn{height:44px;background:var(--bg);font-size:15px}
.kr-hubs{display:flex;flex-wrap:wrap;gap:8px}
.kr-hubs .chip{background:var(--bg)}
.kr-locate{height:44px;font-size:15px}
.kr-brow{align-items:flex-start;gap:10px;padding:11px 14px}
.kr-brow + .row::before,.row + .kr-brow::before{left:14px}
.kr-tm{flex:none;width:58px;font:700 19px/22px var(--font);letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.kr-brow .rt > span{white-space:normal}
.kr-brow .rr .cd{font-size:13px;line-height:17px;color:var(--text2)}
.kr-brow .rr .cd.go{color:var(--income)}
.kr-acts{display:flex;gap:8px;flex-wrap:wrap}
.kr-save{display:inline-flex;align-items:center;gap:8px;height:40px;padding:0 14px 0 12px;border-radius:999px;background:var(--panel);font:600 14px/18px var(--font);color:var(--text)}
.kr-save .kr-star{fill:none;stroke:var(--text2);stroke-width:1.8}
.kr-save[aria-pressed="true"] .kr-star{fill:#F5B014;stroke:#E3A008;stroke-width:1.2}
.kr-twins{margin:0;font:400 13px/18px var(--font);color:var(--text2)}
.kr-twins .kr-link{font-weight:600}
.kr-pill{display:flex;align-items:center;gap:9px;margin:0;padding:10px 12px;border-radius:14px;background:var(--panel);font:400 13px/17px var(--font);color:var(--text2)}
.kr-pill b{color:var(--text);font-weight:600}
.kr-pill i{flex:none;width:8px;height:8px;border-radius:50%;background:var(--lc,var(--chart));box-shadow:0 0 0 3px color-mix(in srgb,var(--lc,var(--chart)) 22%,transparent)}
.kr-note{margin:0;font:400 13px/18px var(--font);color:var(--text3)}
.kr-note .kr-link{color:var(--text2);text-decoration-color:var(--border)}
.kr-stile{background:var(--elevated)}
.kr-stile .kr-sg{width:21px;height:21px;fill:none;stroke:var(--text);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.kr-buls{flex:none;display:flex;gap:3px;margin-left:4px}
.kr-buls .rtile.krl-bullet{width:24px;height:24px;box-shadow:inset 0 0 0 3.2px var(--rc)}
.kr-buls .rtile.krl-bullet b{font-size:11.5px}
.kr-buls .rtile.krl-bullet[data-len="2"] b{font-size:8.5px}
.kr-buls .rtile.krl-bullet[data-len="3"] b{font-size:6.5px}
.kr-srow .rt > span{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.kr-aart{flex:none;width:56px;height:56px;object-fit:contain;border-radius:28px;background:var(--panel)}
.kr-seg{background:var(--realm-track)}
.kr-seg button{height:34px}
/* the train's line as a vertical track: passed stops grey, the train drawn between two stops */
.kr-track{display:grid;border-radius:18px;background:var(--panel);padding:6px 0;--lc:#6B6B70}
.kr-stop{position:relative;display:flex;align-items:center;gap:10px;min-height:40px;padding:0 14px 0 48px;text-align:left;color:var(--text);width:100%}
.kr-stop::before{content:"";position:absolute;left:24px;top:0;bottom:0;width:4px;background:var(--lc)}
.kr-stop.past::before{background:#D3D3D8}
.kr-stop.first::before{top:50%}
.kr-stop.last::before{bottom:50%}
.kr-stop.first.last::before{display:none}
.kr-stop > i{position:absolute;left:19px;top:50%;width:14px;height:14px;margin-top:-7px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 3px var(--lc)}
.kr-stop.past > i{box-shadow:inset 0 0 0 3px #C9C9CE}
.kr-stop.here > i{width:18px;height:18px;margin-top:-9px;left:17px;background:var(--lc);box-shadow:0 0 0 3px #fff,0 0 0 5px color-mix(in srgb,var(--lc) 35%,transparent)}
.kr-stop .n{flex:1;min-width:0;display:flex;align-items:center;gap:8px;font:500 15px/20px var(--font);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kr-stop .n small{font:400 12px/16px var(--font);color:var(--text3);margin-left:2px}
.kr-stop.past .n{color:var(--text3)}
.kr-stop .t{flex:none;font:600 15px/20px var(--font);font-variant-numeric:tabular-nums}
.kr-stop.past .t{color:var(--text3);font-weight:500}
.kr-stop.mine .n{font-weight:700}
.kr-stop .me{flex:none;font:600 11px/1 var(--font);color:var(--chart);background:var(--chart-soft);border-radius:999px;padding:4px 8px}
.kr-stop .cd{flex:none;font:600 15px/20px var(--font);color:var(--income);font-variant-numeric:tabular-nums}
.kr-stop.more .n{font:400 13px/18px var(--font);color:var(--text2)}
.kr-stop.more::before{background:repeating-linear-gradient(var(--lc) 0 5px,transparent 5px 9px)}
.kr-stop.past.more::before{background:repeating-linear-gradient(#D3D3D8 0 5px,transparent 5px 9px)}
.kr-stop.far .n{flex-direction:column;align-items:flex-start;gap:0}
.kr-stop.here-mark{min-height:46px}
.kr-stop.here-mark::before{background:linear-gradient(#D3D3D8 0 50%,var(--lc) 50% 100%)}
.kr-stop.here-mark .n{display:grid;gap:0;font:600 13px/17px var(--font)}
.kr-stop.here-mark .n small{margin:0;color:var(--text2);font-size:12.5px}
.kr-train{position:absolute;left:16px;top:50%;width:20px;height:34px;margin-top:-17px;border-radius:7px 7px 5px 5px;background:var(--lc);box-shadow:0 0 0 3px #fff,0 4px 12px rgba(16,24,40,.22)}
.kr-train::before{content:"";position:absolute;left:3px;right:3px;top:4px;height:7px;border-radius:3px;background:rgba(20,20,24,.82)}
.kr-train::after{content:"";position:absolute;left:4px;right:4px;top:15px;bottom:5px;border-radius:2px;background:repeating-linear-gradient(rgba(255,255,255,.75) 0 3px,transparent 3px 6px)}
.kr-line .kr-stop{min-height:44px}
@media (prefers-reduced-motion:no-preference){
  .kr-train{animation:krNudge 2.4s ease-in-out infinite}
  @keyframes krNudge{0%,100%{translate:0 -3px}50%{translate:0 3px}}
}
@media (hover:hover){.kr-more:hover,.kr-save:hover{background:var(--elevated)}.kr-stop:hover .n{text-decoration:underline;text-decoration-color:var(--border)}}
`;
