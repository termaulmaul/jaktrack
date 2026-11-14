// The round line-code chips ("ring bullets"), shared by every screen; styles.js injects them with the page styles.
export default `
.krl-glyph { font:700 19px/1 var(--font); }
.rtile.krl-bullet { background:#FFFFFF; color:#231F20; box-shadow:inset 0 0 0 5.5px var(--rc); }
.rtile.krl-bullet b { display:block; font:800 19px/1 var(--font); letter-spacing:-0.02em; transform:scaleX(.88); }
.rtile.krl-bullet[data-len="2"] b { font-size:14px; letter-spacing:-0.03em; }
.rtile.krl-bullet[data-len="3"] b { font-size:10.5px; letter-spacing:-0.02em; transform:none; }
.krl-note { margin:0; font:400 13px/18px var(--font); color:var(--text2); }
.krl-times .row { min-height:64px; }
.krl-times .rr { font-variant-numeric:tabular-nums; white-space:nowrap; }
.krl-times .rr .big { font-size:17px; }
.krl-times .rt > b { white-space:normal; }
.krl-links { display:flex; flex-wrap:wrap; gap:8px; }
.krl-links button { min-height:44px; padding:4px 12px 4px 4px; display:flex; align-items:center; gap:8px; border-radius:999px; background:var(--panel); font-size:13px; }
`;
