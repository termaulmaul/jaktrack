// Display rules for trains, lines and operators in trafik.live's calm look.
// Colour only on data, round chips (no square badges), light UI, readable text (contrast >= 4.5).
//
// Train types: every type in Mini Tokyo 3D's data/train-types.json (170, (c) Akihiko Kusanagi, MIT) has a rule here:
// rank (0 local, 1 rapid / semi express, 2 express / commuter rapid, 3 special or limited-stop express, 4 limited
// express or liner that needs a reserved-seat or supplement ticket), a short label EN / JA / ID (ID uses the EN
// words, the way they appear on the signs) and an ink. Inks follow the operator's own type colour where there is one
// (sources in: Keio and Odakyu route-map colours, the common 特急 red of Keisei / Keikyu / Toei,
// 快特 green, エアポート快特 / アクセス特急 orange, JR rapid orange, Chuo-line 特快 colours ...), else a calm neutral.
// Through services keep one colour across operators (F Liner, Asakusa-line types, Tokyu = Minatomirai ...).
//
// Exports: typeStyle, typeLabel, typeRank, typeChip, trainWord, opName, opId, lineChip, lineCode, lineName, setLineCodes,
// viaText, contrastText, contrastRatio, luminance, hexToRgb, normLang, TYPES_CSS, TYPE_IDS, OPERATOR_IDS.
// API notes:. HTML helpers return strings; every dynamic value is escaped.

// ------------------------------------------------------------------------------------------------ colour maths
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
/** '#abc' / 'abc' / '#AABBCC' -> [r, g, b] 0..255, or null. */
export function hexToRgb(hex) {
  const m = HEX.exec(String(hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of a hex colour (0 black .. 1 white). */
export function luminance(hex) {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
/** WCAG contrast ratio of two hex colours (1 .. 21). */
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const INK_TEXT = '#171717', WHITE = '#FFFFFF';
/** Readable text colour on a background: white or the ink (#171717), whichever reads better; pure black/white
 * when the softer ink would fall under 4.5 (one of black or white always reaches 4.58). */
export function contrastText(hex) {
  const bg = hexToRgb(hex) ? hex : '#6B6B70';
  const w = contrastRatio(bg, WHITE), k = contrastRatio(bg, INK_TEXT);
  if (w >= k) return w >= 4.5 ? WHITE : (contrastRatio(bg, '#000000') > w ? '#000000' : WHITE);
  return k >= 4.5 ? INK_TEXT : '#000000';
}
/** a mixed toward b by t (0 = a, 1 = b). */
const mix = (a, b, t) => { const x = hexToRgb(a), y = hexToRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
/** The ink darkened just enough to read on bg (>= 4.5). */
function readableOn(ink, bg) {
  let fg = ink;
  for (let i = 0; i < 24 && contrastRatio(fg, bg) < 4.5; i++) fg = mix(fg, INK_TEXT, 0.12);
  return contrastRatio(fg, bg) >= 4.5 ? fg : INK_TEXT;
}

// ------------------------------------------------------------------------------------------------ inks
// Route-map inks (not neon), shared so through services read the same on both sides of a junction.
const RED = '#E60012';        // 特急 red ("各社局共通" on Keisei / Keikyu / Toei boards); JR, JR Central, Izu, Fuji 特急;
                              // Tsukuba Express 快速; Tokyo Monorail 空港快速
const ORANGE = '#F08300';     // JR 快速; エアポート快特 + アクセス特急 (Keikyu = Keisei since 2012); Tobu 特急; TX 通勤快速;
                              // Seibu 急行 (Seibu's stop maps: orange, red is for its paid 特急)
const GREEN = '#00A040';      // 快特 / 快速特急 (Keikyu, Keisei); 準急 (Tokyu, Seibu, Tobu); Tozai 通勤快速
const BLUE = '#0079C2';       // JR 特別快速 / 中央特快; Tobu 快速急行; Sotetsu 快速; TX 区間快速; Keikyu 急行 (the former
                              // エアポート急行 blue, as in Keikyu diagrams)
const SKY = '#00A0E0';        // 通勤特急 (Keisei 空色, used on the Asakusa line too)
const PINK = '#E4007F';       // Keisei 快速 (also on Toei / Keikyu / Shibayama); JR 通勤特快; Tobu 区間急行
const PURPLE = '#8E5DBE';     // JR 通勤快速 (Chuo line); Seibu 快速急行; Tobu 川越特急
const LIME = '#5DAE48';       // Tobu 区間準急
const GOLD = '#C9A100';       // Seibu 通勤急行
const VIOLET = '#5A5FD0';     // Seibu 通勤準急
const SEIBU_RAPID = '#2B9BD8';
const T_EXPRESS = '#E64530';  // Odakyu 急行 / 通勤急行 (route map #e64530); Tokyu 急行 red; Tokyo Metro / Toei 急行 (through);
                              // Tozai-line 快速 red (also Toyo Rapid's 快速 that runs through onto it)
const O_SEMI = '#009D6A';     // Odakyu 準急 / 通勤準急 (#009d6a)
const O_RAPIDEXP = '#F3962C'; // Odakyu 快速急行 (#f3962c)
const ROMANCECAR = '#EE5A24'; // Odakyu Romancecar vermilion (also on Tokyo Metro Chiyoda and into Hakone-Yumoto)
const K_SPECIAL = '#CA2D73';  // Keio 特急 "Special Express" (route map pink #ca2d73)
const K_EXPRESS = '#0CA73D';  // Keio 急行 (#0ca73d)
const K_SEMI = '#CFBC30';     // Keio 区間急行 (#cfbc30)
const K_RAPID = '#394471';    // Keio 快速 (#394471)
const SKYLINER = '#1D4F9E';   // Keisei Skyliner blue
const F_LINER = '#6E6E73';    // F Liner (no published colour found yet: neutral)
const NEUTRAL = '#6E6E73';    // a non-local type without a known operator colour
const RESERVED = '#5A6478';   // a reserved-seat / supplement train without a known colour (liners, steam, trolley): slate, not
                              // black (black pills read as primary buttons)

// ------------------------------------------------------------------------------------------------ train types
// id: [rank, ink | null, ja]   (ja = MT3D's Japanese title; null ink = local, no band)
const TYPES = {
  'JR-East.ChuoSpecialRapid': [3, BLUE, '中央特快'],
  'JR-East.CommuterRapid': [2, PURPLE, '通勤快速'],
  'JR-East.CommuterSpecialRapid': [3, PINK, '通勤特快'],
  'JR-East.Express': [2, NEUTRAL, '急行'],
  'JR-East.LimitedExpress': [4, RED, '特急'],
  'JR-East.Liner': [4, RESERVED, 'ライナー'],
  'JR-East.Local': [0, null, '普通'],
  'JR-East.OmeSpecialRapid': [3, GREEN, '青梅特快'],
  'JR-East.Rapid': [1, ORANGE, '快速'],
  'JR-East.SpecialRapid': [3, BLUE, '特別快速'],
  'TokyoMetro.CommuterExpress': [2, ORANGE, '通勤急行'],
  'JR-Central.LimitedExpress': [4, RED, '特急'],
  'JR-Central.Local': [0, null, '普通'],
  'TokyoMetro.CommuterLimitedExpress': [3, RED, '通勤特急'],
  'TokyoMetro.CommuterRapid': [2, GREEN, '通勤快速'],
  'TokyoMetro.Express': [2, T_EXPRESS, '急行'],
  'TokyoMetro.F-Liner': [3, F_LINER, 'Fライナー'],
  'TokyoMetro.LimitedExpress': [4, ROMANCECAR, '特急'],
  'TokyoMetro.Local': [0, null, '普通'],
  'TokyoMetro.RapidExpress': [3, PURPLE, '快速急行'],
  'TokyoMetro.Rapid': [1, T_EXPRESS, '快速'],
  'TokyoMetro.S-TRAIN': [4, RESERVED, 'Sトレイン'],
  'TokyoMetro.SemiExpress': [1, GREEN, '準急'],
  'TokyoMetro.TH-LINER': [4, RESERVED, 'THライナー'],
  'TWR.CommuterRapid': [2, PURPLE, '通勤快速'],
  'TWR.Local': [0, null, '各駅停車'],
  'TWR.Rapid': [1, ORANGE, '快速'],
  'Toei.AccessExpress': [3, ORANGE, 'アクセス特急'],
  'Toei.AirportRapidLimitedExpress': [3, ORANGE, 'エアポート快特'],
  'Toei.CommuterLimitedExpress': [3, SKY, '通勤特急'],
  'Toei.Express': [2, T_EXPRESS, '急行'],
  'Toei.LimitedExpress': [3, RED, '特急'],
  'Toei.Local': [0, null, '普通'],
  'Toei.RapidLimitedExpress': [3, GREEN, '快特'],
  'Toei.Rapid': [1, PINK, '快速'],
  'YokohamaMunicipal.Local': [0, null, '普通'],
  'YokohamaMunicipal.Rapid': [1, NEUTRAL, '快速'],
  'Keio.Express': [2, K_EXPRESS, '急行'],
  'Keio.KeioLiner': [4, RESERVED, '京王ライナー'],
  'Keio.LimitedExpress': [3, K_SPECIAL, '特急'],
  'Keio.Local': [0, null, '各駅停車'],
  'Keio.Rapid': [1, K_RAPID, '快速'],
  'Keio.SemiExpress': [1, K_SEMI, '区間急行'],
  'Keikyu.AccessExpress': [3, ORANGE, 'アクセス特急'],
  'Keikyu.AirportRapidLimitedExpress': [3, ORANGE, 'エアポート快特'],
  'Keikyu.CommuterLimitedExpress': [3, SKY, '通勤特急'],
  'Keikyu.Express': [2, BLUE, '急行'],
  'Keikyu.EveningWing': [4, RESERVED, 'イブニング・ウィング'],
  'Keikyu.LimitedExpress': [3, RED, '特急'],
  'Keikyu.Local': [0, null, '普通'],
  'Keikyu.MorningWing': [4, RESERVED, 'モーニング・ウィング'],
  'Keikyu.RapidLimitedExpress': [3, GREEN, '快特'],
  'Keikyu.Rapid': [1, PINK, '快速'],
  'Keisei.AccessExpress': [3, ORANGE, 'アクセス特急'],
  'Keisei.CommuterLimitedExpress': [3, SKY, '通勤特急'],
  'Keisei.Eveningliner': [4, SKYLINER, 'イブニングライナー'],
  'Keisei.Express': [2, NEUTRAL, '急行'],
  'Keisei.LimitedExpress': [3, RED, '特急'],
  'Keisei.Local': [0, null, '普通'],
  'Keisei.Morningliner': [4, SKYLINER, 'モーニングライナー'],
  'Keisei.RapidLimitedExpress': [3, GREEN, '快速特急'],
  'Keisei.Rapid': [1, PINK, '快速'],
  'Keisei.Skyliner': [4, SKYLINER, 'スカイライナー'],
  'Hokuso.Local': [0, null, '普通'],
  'Hokuso.Express': [2, NEUTRAL, '急行'],
  'Hokuso.LimitedExpress': [3, RED, '特急'],
  'Tobu.Express': [2, RED, '急行'],
  'Tobu.F-Liner': [3, F_LINER, 'Fライナー'],
  'Tobu.KawagoeLimitedExpress': [3, PURPLE, '川越特急'],
  'Tobu.LimitedExpress': [4, ORANGE, '特急'],
  'Tobu.Local': [0, null, '普通'],
  'Tobu.RapidExpress': [3, BLUE, '快速急行'],
  'Tobu.Rapid': [2, NEUTRAL, '快速'],
  'Tobu.SL-Taiju': [4, RESERVED, 'SL大樹'],
  'Tobu.SectionExpress': [2, PINK, '区間急行'],
  'Tobu.SectionSemiExpress': [1, LIME, '区間準急'],
  'Tobu.SemiExpress': [1, GREEN, '準急'],
  'Tobu.TJ-Liner': [4, RESERVED, 'TJライナー'],
  'Tobu.TH-LINER': [4, RESERVED, 'THライナー'],
  'Seibu.CommuterExpress': [2, GOLD, '通勤急行'],
  'Seibu.CommuterSemiExpress': [1, VIOLET, '通勤準急'],
  'Seibu.Express': [2, ORANGE, '急行'],
  'Seibu.F-Liner': [3, F_LINER, 'Fライナー'],
  'Seibu.HaijimaLiner': [4, RESERVED, '拝島ライナー'],
  'Seibu.LimitedExpress': [4, RED, '特急'],
  'Seibu.Local': [0, null, '各駅停車'],
  'Seibu.RapidExpress': [3, PURPLE, '快速急行'],
  'Seibu.Rapid': [1, SEIBU_RAPID, '快速'],
  'Seibu.S-TRAIN': [4, RESERVED, 'Sトレイン'],
  'Seibu.SemiExpress': [1, GREEN, '準急'],
  'Odakyu.CommuterExpress': [2, T_EXPRESS, '通勤急行'],
  'Odakyu.CommuterSemiExpress': [1, O_SEMI, '通勤準急'],
  'Odakyu.Express': [2, T_EXPRESS, '急行'],
  'Odakyu.LimitedExpress': [4, ROMANCECAR, '特急'],
  'Odakyu.Local': [0, null, '各駅停車'],
  'Odakyu.RapidExpress': [3, O_RAPIDEXP, '快速急行'],
  'Odakyu.SemiExpress': [1, O_SEMI, '準急'],
  'OdakyuHakone.LimitedExpress': [4, ROMANCECAR, '特急'],
  'OdakyuHakone.Local': [0, null, '各駅停車'],
  'Tokyu.CommuterLimitedExpress': [3, RED, '通勤特急'],
  'Tokyu.Express': [2, T_EXPRESS, '急行'],
  'Tokyu.F-Liner': [3, F_LINER, 'Fライナー'],
  'Tokyu.LimitedExpress': [3, RED, '特急'],
  'Tokyu.Local': [0, null, '各駅停車'],
  'Tokyu.S-TRAIN': [4, RESERVED, 'Sトレイン'],
  'Tokyu.SemiExpress': [1, GREEN, '準急'],
  'Minatomirai.CommuterLimitedExpress': [3, RED, '通勤特急'],
  'Minatomirai.Express': [2, T_EXPRESS, '急行'],
  'Minatomirai.F-Liner': [3, F_LINER, 'Fライナー'],
  'Minatomirai.LimitedExpress': [3, RED, '特急'],
  'Minatomirai.Local': [0, null, '各駅停車'],
  'Minatomirai.S-TRAIN': [4, RESERVED, 'Sトレイン'],
  'Sotetsu.CommuterExpress': [2, T_EXPRESS, '通勤急行'],
  'Sotetsu.CommuterLimitedExpress': [3, ORANGE, '通勤特急'],
  'Sotetsu.Express': [2, T_EXPRESS, '急行'],
  'Sotetsu.LimitedExpress': [3, ORANGE, '特急'],
  'Sotetsu.Local': [0, null, '各駅停車'],
  'Sotetsu.Rapid': [1, BLUE, '快速'],
  'SaitamaRailway.Local': [0, null, '普通'],
  'SaitamaRailway.Express': [2, T_EXPRESS, '急行'],
  'MIR.CommuterRapid': [2, ORANGE, '通勤快速'],
  'MIR.Local': [0, null, '普通'],
  'MIR.Rapid': [2, RED, '快速'],
  'MIR.SemiRapid': [1, BLUE, '区間快速'],
  'ToyoRapid.Local': [0, null, '普通'],
  'ToyoRapid.Rapid': [1, T_EXPRESS, '快速'],
  'ToyoRapid.CommuterRapid': [2, GREEN, '通勤快速'],
  'Shibayama.CommuterLimitedExpress': [3, SKY, '通勤特急'],
  'Shibayama.LimitedExpress': [3, RED, '特急'],
  'Shibayama.Local': [0, null, '普通'],
  'Shibayama.RapidLimitedExpress': [3, GREEN, '快速特急'],
  'Shibayama.Rapid': [1, PINK, '快速'],
  'KantoRailway.Local': [0, null, '普通'],
  'KantoRailway.Rapid': [1, NEUTRAL, '快速'],
  'Ryutetsu.Local': [0, null, '普通'],
  'Kominato.Local': [0, null, '普通'],
  'Kominato.Bus': [0, null, 'バス代行運転'],
  'Isumi.Local': [0, null, '普通'],
  'Isumi.Express': [2, NEUTRAL, '急行'],
  'Choshi.Local': [0, null, '普通'],
  'KashimaRinkai.Local': [0, null, '普通'],
  'Hitachinaka.Local': [0, null, '普通'],
  'Moka.Local': [0, null, '普通'],
  'Moka.SL-Moka': [4, RESERVED, 'SLもおか'],
  'UtsunomiyaLightRail.Local': [0, null, '普通'],
  'UtsunomiyaLightRail.Rapid': [1, NEUTRAL, '快速'],
  'Enoden.Local': [0, null, '普通'],
  'IzuHakone.LimitedExpress': [4, RED, '特急'],
  'IzuHakone.Local': [0, null, '普通'],
  'Izukyu.LimitedExpress': [4, RED, '特急'],
  'Izukyu.Local': [0, null, '普通'],
  'Fujikyu.LimitedExpress': [4, RED, '特急'],
  'Fujikyu.Local': [0, null, '普通'],
  'Chichibu.Local': [0, null, '普通'],
  'Chichibu.Express': [2, NEUTRAL, '急行'],
  'Chichibu.PaleoExpress': [4, RESERVED, 'パレオエクスプレス'],
  'Jomo.Local': [0, null, '普通'],
  'Joshin.Local': [0, null, '普通'],
  'WataraseKeikoku.Local': [0, null, '普通'],
  'WataraseKeikoku.Torokko': [4, RESERVED, 'トロッコ'],
  'Yurikamome.Local': [0, null, '普通'],
  'YokohamaSeaside.Local': [0, null, '普通'],
  'Yamaman.Local': [0, null, '普通'],
  'SaitamaTransit.Local': [0, null, '普通'],
  'TokyoMonorail.HanedaExpress': [3, RED, '空港快速'],
  'TokyoMonorail.Local': [0, null, '普通'],
  'TokyoMonorail.Rapid': [1, ORANGE, '区間快速'],
  'TamaMonorail.Local': [0, null, '普通'],
  'ChibaMonorail.Local': [0, null, '普通'],
  'ShonanMonorail.Local': [0, null, '普通'],
};

// Through types whose colour depends on the line they run on (the partner operator's colour), so a train keeps its
// colour across the junction: type id -> { line id: ink }. Applied when typeStyle / typeChip get the line.
const BY_LINE = {
  'Toei.Express': { 'Toei.Asakusa': BLUE, 'Toei.Shinjuku': K_EXPRESS },   // Keikyu 急行 / Keio 急行; Mita = Tokyu red
  'TokyoMetro.Rapid': { 'TokyoMetro.Yurakucho': SEIBU_RAPID },            // Seibu 快速 through; Tozai 快速 stays red
};

// English by the id's suffix: [short (chips, map labels), long (official English, as on the signs)].
const EN = {
  Local: ['Local', 'Local'],
  Rapid: ['Rapid', 'Rapid'],
  SemiRapid: ['Semi Rapid', 'Semi Rapid'],
  CommuterRapid: ['Comm. Rapid', 'Commuter Rapid'],
  SpecialRapid: ['Sp. Rapid', 'Special Rapid'],
  ChuoSpecialRapid: ['Chuo Sp. Rapid', 'Chuo Special Rapid'],
  OmeSpecialRapid: ['Ome Sp. Rapid', 'Ome Special Rapid'],
  CommuterSpecialRapid: ['Comm. Sp. Rapid', 'Commuter Special Rapid'],
  SemiExpress: ['Semi Exp.', 'Semi Express'],
  SectionSemiExpress: ['Sec. Semi Exp.', 'Section Semi Express'],
  CommuterSemiExpress: ['Comm. Semi Exp.', 'Commuter Semi Express'],
  SectionExpress: ['Sec. Exp.', 'Section Express'],
  Express: ['Express', 'Express'],
  CommuterExpress: ['Comm. Exp.', 'Commuter Express'],
  RapidExpress: ['Rapid Exp.', 'Rapid Express'],
  LimitedExpress: ['Ltd. Exp.', 'Limited Express'],
  CommuterLimitedExpress: ['Comm. Ltd. Exp.', 'Commuter Limited Express'],
  RapidLimitedExpress: ['Rapid Ltd. Exp.', 'Rapid Limited Express'],
  AirportRapidLimitedExpress: ['Apt. Rapid Ltd. Exp.', 'Airport Rapid Limited Express'],
  AccessExpress: ['Access Exp.', 'Access Express'],
  KawagoeLimitedExpress: ['Kawagoe Ltd. Exp.', 'Kawagoe Limited Express'],
  HanedaExpress: ['Haneda Exp.', 'Haneda Express'],
  Liner: ['Liner', 'Liner'],
  'F-Liner': ['F Liner', 'F Liner'],
  'S-TRAIN': ['S-TRAIN', 'S-TRAIN'],
  'TH-LINER': ['TH Liner', 'TH Liner'],
  'TJ-Liner': ['TJ Liner', 'TJ Liner'],
  KeioLiner: ['Keio Liner', 'Keio Liner'],
  HaijimaLiner: ['Haijima Liner', 'Haijima Liner'],
  MorningWing: ['Morning Wing', 'Morning Wing'],
  EveningWing: ['Evening Wing', 'Evening Wing'],
  Morningliner: ['Morningliner', 'Morningliner'],
  Eveningliner: ['Eveningliner', 'Eveningliner'],
  Skyliner: ['Skyliner', 'Skyliner'],
  'SL-Taiju': ['SL Taiju', 'SL Taiju'],
  'SL-Moka': ['SL Moka', 'SL Moka'],
  PaleoExpress: ['Paleo Exp.', 'Paleo Express'],
  Torokko: ['Torokko', 'Torokko trolley train'],
  Bus: ['Bus', 'Replacement bus'],
};
// Per-id English where the operator's own English differs from the suffix default.
const EN_ID = {
  'Keio.LimitedExpress': ['Special Exp.', 'Special Express'],   // Keio signs 特急 as "Special Express"
};
// Indonesian: the EN words (as on the signs), except where a sign word would not help.
const ID_SUFFIX = { Bus: ['Bus pengganti', 'Bus pengganti kereta'], Torokko: ['Torokko', 'Kereta troli Torokko'] };
// Default rank by suffix, for a type id this table has not seen (new data).
const RANK_SUFFIX = {
  Local: 0, Bus: 0, Rapid: 1, SemiRapid: 1, SemiExpress: 1, SectionSemiExpress: 1, CommuterSemiExpress: 1,
  CommuterRapid: 2, Express: 2, CommuterExpress: 2, SectionExpress: 2, SpecialRapid: 3, RapidExpress: 3,
  LimitedExpress: 3, CommuterLimitedExpress: 3, RapidLimitedExpress: 3, AccessExpress: 3,
  AirportRapidLimitedExpress: 3, 'F-Liner': 3, HanedaExpress: 3,
};

/** Normalise a language tag to 'en' | 'ja' | 'id' (navigator-style tags too: ja-JP, id-ID, ms). */
export function normLang(lang) {
  const l = String(lang || 'en').toLowerCase();
  return l.startsWith('ja') ? 'ja' : l.startsWith('id') || l.startsWith('ms') || l === 'in' ? 'id' : 'en';
}
const typeIdOf = (type) => typeof type === 'string' ? type : type && typeof type === 'object' ? String(type.id || '') : '';
const suffixOf = (id) => id.slice(id.indexOf('.') + 1);

/** The rule for a type (object from model.types or an MT3D id): { id, rank, ink, ja, known }. */
function rule(type) {
  const id = typeIdOf(type), t = TYPES[id];
  if (t) return { id, rank: t[0], ink: t[1], ja: t[2], known: true };
  const suf = suffixOf(id), obj = type && typeof type === 'object' ? type : null;
  const rank = Number.isFinite(obj?.rank) ? Math.max(0, Math.min(4, obj.rank | 0))
    : RANK_SUFFIX[suf] ?? (/Liner|LINER|TRAIN|Wing|^SL-/.test(suf) ? 4 : /Limited/.test(suf) ? 3 : /Express/.test(suf) ? 2 : /Rapid/.test(suf) ? 1 : 0);
  const ink = rank === 0 ? null : hexToRgb(obj?.color) ? toHex(hexToRgb(obj.color)) : rank === 4 ? RESERVED : NEUTRAL;
  return { id, rank, ink, ja: obj?.title?.ja || '', known: false };
}

/** Rank 0 local, 1 rapid / semi express, 2 express / commuter rapid, 3 special or limited-stop express,
 * 4 limited express or liner (reserved seat / supplement ticket). */
export function typeRank(type) { return rule(type).rank; }

const LOCAL_CHIP = { bg: '#EAEAED', fg: '#5E5E63' };   // the 'elevated' grey (shows on white sheets AND on #F5F5F7
                                                      // cards, where boards sit) + a grey text at 5.4:1
const styleCache = new Map();
/** Too close to tell apart as a stripe on a body of the other colour (similar hue AND similar lightness). */
function near(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  if (!x || !y) return false;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 110 && contrastRatio(a, b) < 1.6;
}
/**
 * How a type looks. Answer (shared, do not mutate):
 * { band: '#hex' | null   stripe on the trainset (null for locals: they look like the line),
 *   weight: 0..0.5        stripe width as a share of the half width (0 for locals, wider for higher ranks),
 *   chip: { bg, fg }      the label chip (round pill): locals grey, ranks 1-3 a soft tint with the ink as text,
 *                         rank 4 solid ink with white or ink text; fg always >= 4.5 on bg,
 *   emphasis: 0 | 1 | 2   0 local, 1 rapid .. limited-stop express, 2 needs a reserved-seat / supplement ticket,
 *   ink: '#hex' | null    the type's colour (legend dots, text, strips); deliberately NOT called `color`, which
 *                         trainset code reads as the body colour,
 *   rank, known }         known = false when the id is not in MT3D's list (style guessed from its name).
 * No `body`: the trainset keeps the line colour (rank 4: trains.js's warm white body). With `line` given, a band that
 * would vanish on a body of the line's colour (JR rapid orange on the orange Chuo Rapid line, Keio's pink special
 * express on Keio's magenta) is drawn as a pale stripe of the same hue instead; `ink` stays the type colour.
 */
export function typeStyle(type, line, run) {
  const r = rule(type), lc = line && typeof line === 'object' && hexToRgb(line.color) ? toHex(hexToRgb(line.color)) : '';
  const lid = line && typeof line === 'object' ? String(line.id || '') : typeof line === 'string' ? line : '';
  const over = BY_LINE[r.id]?.[lid];
  if (over) r.ink = over;
  const key = `${r.known ? r.id : `${r.id}|${r.rank}|${r.ink}`}|${lc}|${over ? lid : ''}`;
  let s = styleCache.get(key);
  if (s) return s;
  if (r.rank === 0 || !r.ink) s = { band: null, weight: 0, chip: LOCAL_CHIP, emphasis: 0, ink: null, rank: r.rank, known: r.known };
  else {
    const emphasis = r.rank >= 4 ? 2 : 1;
    let chip;
    if (emphasis === 2) chip = { bg: r.ink, fg: contrastText(r.ink) };
    else { const bg = mix(r.ink, WHITE, 0.86); chip = { bg, fg: readableOn(r.ink, bg) }; }
    const band = emphasis === 1 && lc && near(r.ink, lc) ? mix(r.ink, WHITE, 0.6) : r.ink;
    s = { band, weight: [0, 0.3, 0.36, 0.42, 0.5][r.rank], chip, emphasis, ink: r.ink, rank: r.rank, known: r.known };
  }
  Object.freeze(s.chip); Object.freeze(s);
  styleCache.set(key, s);
  return s;
}

/**
 * A type's label. form: 'map' (default: '' for locals, else the short word: what a map label next to a train shows,
 * trains.js calls typeLabel(type, lang)), 'short' (chips and rows, locals too: "Local", "各停"), 'long' (the full
 * official name). JA uses MT3D's Japanese (各駅停車 shortened to 各停 in short forms), EN the operator's English, ID
 * the EN words (a replacement bus is "Bus pengganti").
 */
export function typeLabel(type, lang = 'en', form = 'map') {
  const r = rule(type), L = normLang(lang), long = form === 'long';
  if (form === 'map' && r.rank === 0) return '';
  if (L === 'ja') {
    const ja = r.ja || (type && typeof type === 'object' ? type.title?.ja || type.title?.en : '') || '';
    return long ? ja : ja.replace('各駅停車', '各停').replace('バス代行運転', 'バス代行');
  }
  const suf = suffixOf(r.id);
  const pair = (L === 'id' && ID_SUFFIX[suf]) || EN_ID[r.id] || EN[suf];
  if (pair) return long ? pair[1] : pair[0];
  const en = type && typeof type === 'object' ? type.title?.en || '' : '';
  return en || suf.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** The word a map label or a row title shows for a run: its train name when it has one (the timetable build run.names: limited
 * expresses "Azusa 3" / "あずさ 3号", "Narita Express 1"; a few named locals "Musashino"), else typeLabel(type, lang,
 * form) (default 'map': '' for locals). Several names (a train that splits) are joined with " / " (JA "・"). */
export function trainWord(type, run, lang = 'en', form = 'map') {
  const L = normLang(lang), names = Array.isArray(run?.names) ? run.names.filter(Boolean) : [];
  const txt = names.map((n) => (typeof n === 'string' ? n : L === 'ja' ? n.ja || n.en : n.en || n.ja) || '').filter(Boolean);
  return txt.length ? txt.join(L === 'ja' ? '・' : ' / ') : typeLabel(type, lang, form);
}

/** A type's label as a round chip (HTML). opts.form as typeLabel (default 'short': locals too); opts.title adds the
 * long name as a tooltip; opts.line (line object or id) picks the through-service colour on that line. */
export function typeChip(type, lang = 'en', opts = {}) {
  ensureCss();
  const ln = opts.line, s = typeStyle(type, ln && typeof ln === 'object' ? { id: ln.id } : ln), text = typeLabel(type, lang, opts.form || 'short');
  const tip = opts.title ? ` title="${esc(typeLabel(type, lang, 'long'))}"` : '';
  return `<span class="tk-type" data-e="${s.emphasis}" style="--tb:${s.chip.bg};--tf:${s.chip.fg}"${tip}>${esc(text)}</span>`;
}

// ------------------------------------------------------------------------------------------------ operators
// The 46 rail operators of MT3D (the id prefixes of railways.json; its data/operators.json lists airlines only).
// id: [EN full, EN short, JA full, JA short]. ID uses the EN names.
const OPS = {
  'JR-East': ['JR East', 'JR East', 'JR東日本', 'JR東日本'],
  'JR-Central': ['JR Central', 'JR Central', 'JR東海', 'JR東海'],
  TWR: ['Tokyo Waterfront Area Rapid Transit', 'Rinkai Line', '東京臨海高速鉄道', 'りんかい線'],
  TokyoMetro: ['Tokyo Metro', 'Tokyo Metro', '東京メトロ', '東京メトロ'],
  Toei: ['Toei Transportation', 'Toei', '東京都交通局', '都営'],
  YokohamaMunicipal: ['Yokohama Municipal Subway', 'Yokohama Subway', '横浜市営地下鉄', '横浜市営'],
  Keio: ['Keio Corporation', 'Keio', '京王電鉄', '京王'],
  Keikyu: ['Keikyu Corporation', 'Keikyu', '京浜急行電鉄', '京急'],
  Keisei: ['Keisei Electric Railway', 'Keisei', '京成電鉄', '京成'],
  Hokuso: ['Hokuso Railway', 'Hokuso', '北総鉄道', '北総'],
  Shibayama: ['Shibayama Railway', 'Shibayama', '芝山鉄道', '芝山'],
  Tobu: ['Tobu Railway', 'Tobu', '東武鉄道', '東武'],
  Seibu: ['Seibu Railway', 'Seibu', '西武鉄道', '西武'],
  Odakyu: ['Odakyu Electric Railway', 'Odakyu', '小田急電鉄', '小田急'],
  OdakyuHakone: ['Odakyu Hakone', 'Hakone Tozan', '小田急箱根', '箱根登山'],
  Tokyu: ['Tokyu Railways', 'Tokyu', '東急電鉄', '東急'],
  Minatomirai: ['Yokohama Minatomirai Railway', 'Minatomirai', '横浜高速鉄道', 'みなとみらい線'],
  Sotetsu: ['Sotetsu (Sagami Railway)', 'Sotetsu', '相模鉄道', '相鉄'],
  SaitamaRailway: ['Saitama Railway', 'Saitama Railway', '埼玉高速鉄道', '埼玉高速'],
  MIR: ['Tsukuba Express', 'TX', 'つくばエクスプレス', 'TX'],
  ToyoRapid: ['Toyo Rapid Railway', 'Toyo Rapid', '東葉高速鉄道', '東葉高速'],
  KantoRailway: ['Kanto Railway', 'Kantetsu', '関東鉄道', '関鉄'],
  Ryutetsu: ['Ryutetsu', 'Ryutetsu', '流鉄', '流鉄'],
  Kominato: ['Kominato Railway', 'Kominato', '小湊鐵道', '小湊'],
  Isumi: ['Isumi Railway', 'Isumi', 'いすみ鉄道', 'いすみ'],
  Choshi: ['Choshi Electric Railway', 'Choden', '銚子電気鉄道', '銚子電鉄'],
  KashimaRinkai: ['Kashima Rinkai Railway', 'Kashima Rinkai', '鹿島臨海鉄道', '鹿島臨海'],
  Hitachinaka: ['Hitachinaka Seaside Railway', 'Hitachinaka', 'ひたちなか海浜鉄道', 'ひたちなか'],
  Moka: ['Moka Railway', 'Moka', '真岡鐵道', '真岡'],
  UtsunomiyaLightRail: ['Utsunomiya Light Rail', 'Light Line', '宇都宮ライトレール', 'ライトライン'],
  Enoden: ['Enoshima Electric Railway', 'Enoden', '江ノ島電鉄', '江ノ電'],
  IzuHakone: ['Izuhakone Railway', 'Izuhakone', '伊豆箱根鉄道', '伊豆箱根'],
  Izukyu: ['Izukyu Corporation', 'Izukyu', '伊豆急行', '伊豆急'],
  Fujikyu: ['Fujikyu Railway', 'Fujikyu', '富士山麓電気鉄道', '富士急'],
  Chichibu: ['Chichibu Railway', 'Chichibu', '秩父鉄道', '秩父鉄道'],
  Jomo: ['Jomo Electric Railway', 'Jomo', '上毛電気鉄道', '上毛電鉄'],
  Joshin: ['Joshin Electric Railway', 'Joshin', '上信電鉄', '上信'],
  WataraseKeikoku: ['Watarase Keikoku Railway', 'Watetsu', 'わたらせ渓谷鐵道', 'わ鐵'],
  Yurikamome: ['Yurikamome', 'Yurikamome', 'ゆりかもめ', 'ゆりかもめ'],
  YokohamaSeaside: ['Yokohama Seaside Line', 'Seaside Line', '横浜シーサイドライン', 'シーサイドライン'],
  SaitamaTransit: ['Saitama New Urban Transit', 'New Shuttle', '埼玉新都市交通', 'ニューシャトル'],
  Yamaman: ['Yamaman', 'Yamaman', '山万', '山万'],
  TokyoMonorail: ['Tokyo Monorail', 'Tokyo Monorail', '東京モノレール', '東京モノレール'],
  TamaMonorail: ['Tama Monorail', 'Tama Monorail', '多摩モノレール', '多摩モノレール'],
  ChibaMonorail: ['Chiba Urban Monorail', 'Chiba Monorail', '千葉都市モノレール', '千葉モノレール'],
  ShonanMonorail: ['Shonan Monorail', 'Shonan Monorail', '湘南モノレール', '湘南モノレール'],
};
/** Operator id from an operator object ({id}), its id, or any line / type / station id ('JR-East.Yamanote'). */
export function opId(op) {
  const id = typeof op === 'string' ? op : op && typeof op === 'object' ? String(op.id || '') : '';
  if (OPS[id]) return id;
  const pre = id.split('.')[0];
  return OPS[pre] ? pre : id;
}
/** An operator's name: full ('JR East', 'Keio Corporation', '京王電鉄') or short ('Keio', '京王'). ID = EN. */
export function opName(op, lang = 'en', short = false) {
  const id = opId(op), row = OPS[id], ja = normLang(lang) === 'ja';
  if (row) return row[(ja ? 2 : 0) + (short ? 1 : 0)];
  const t = op && typeof op === 'object' ? op.title : null;
  return (ja ? t?.ja || t?.en : t?.en || t?.ja) || id;
}
/** Every rail operator id this file names (= MT3D's 46). */
export const OPERATOR_IDS = Object.freeze(Object.keys(OPS));

// ------------------------------------------------------------------------------------------------ lines
const codes = new Map();
/** Line codes from the codes build's codes-v1.json (or any { lineId: code } map / [{id, code}] list); model.lines[i].code wins. */
export function setLineCodes(src) {
  if (!src) return;
  const lines = src.lines ?? src;
  if (Array.isArray(lines)) { for (const x of lines) if (x && x.id && x.code) codes.set(String(x.id), String(x.code)); }
  else if (typeof lines === 'object') for (const [k, v] of Object.entries(lines)) {
    const c = typeof v === 'string' ? v : v && (v.code || v.prefix);
    if (c) codes.set(k, String(c));
  }
}
/** A line's name in the language (ID uses the EN names). */
export function lineName(line, lang = 'en') {
  if (typeof line === 'string') return line;
  const t = line?.title || line?.name || {};
  return normLang(lang) === 'ja' ? t.ja || t.en || '' : t.en || t.ja || '';
}
/** The line's official code: model code, else the codes build's table, else '' (about 30 MT3D lines have no numbering: no
 * made-up code is shown for them). opts.initials: true -> initials of the English name instead ('Keio New Line' ->
 * 'KN') for a place that must write something. */
export function lineCode(line, opts = {}) {
  if (!line) return '';
  if (typeof line === 'object' && String(line.code ?? '').trim()) return String(line.code).trim();
  const id = typeof line === 'string' ? line : String(line.id || '');
  if (codes.has(id)) return codes.get(id);
  if (!opts.initials) return '';
  const en = (typeof line === 'object' ? line.title?.en : '') || id.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2');
  const words = en.replace(/\b(Line|Main|Branch)\b/g, '').split(/[\s\-・]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
/**
 * A line as a round chip (HTML) with its code: the ring of trafik.live's train page (`rtile krl-bullet`, --rc = the
 * line colour, unmodified as ODPT asks; code in <b>, ink #231F20 on white), used on the whole page. opts: { size: '' (40) | 'xl' (56) | 'md' (36) | 'sm' (32) | 'xs' (24: kereta's row
 * chip; its codes stay >= 11 px, condensed so all 84 codes fit the ring) (app.css .rtile sizes; TYPES_CSS
 * scales ring + type for them), solid: true -> app.css's filled `.rtile` (line colour, text
 * contrastText() >= 4.5; only where kereta fills), name: true -> pill with the line name after the chip,
 * label: true -> the chip is announced (role img + the line name) instead of aria-hidden, initials: true -> initials
 * when the line has no official code, blank: true -> a blank ring for a line without one }. A line without an official
 * code wears the Lines list's two letters from its EN title ("Jo" Joetsu, "Uc" Uchibo; the same in every language), as
 * views.js / train-view.js draw it; the lower-case second
 * letter keeps them apart from official codes (all capitals). lineCode() itself still answers '' for such a line.
 * --rt always carries contrastText(colour) for pages without the ring CSS.
 */
const listLetters = (line) => String((typeof line === 'object' && line ? line.title?.en || String(line.id || '').split('.').pop() : String(line || '').split('.').pop()) || '')
  .replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
export function lineChip(line, lang = 'en', opts = {}) {
  ensureCss();
  const bg = hexToRgb(line?.color) ? toHex(hexToRgb(line.color)) : '#6B6B70';
  const code = lineCode(line, opts) || (opts.blank ? '' : listLetters(line)), name = lineName(line, lang);
  const size = ['xl', 'md', 'sm', 'xs'].includes(opts.size) ? ` ${opts.size}` : '';
  const a11y = opts.label && !opts.name ? ` role="img" aria-label="${esc(name)}"` : ' aria-hidden="true"';
  const len = Math.max(1, Math.min(3, [...code].length));
  const chip = opts.solid
    ? `<span class="rtile${size}" style="--rc:${bg};--rt:${contrastText(bg)}" data-len="${len}"${luminance(bg) > 0.7 ? ' data-light' : ''}${a11y}>${esc(code)}</span>`
    : `<span class="rtile krl-bullet${size}" style="--rc:${bg};--rt:${contrastText(bg)}" data-len="${len}"${a11y}><b>${esc(code)}</b></span>`;
  return opts.name ? `<span class="tk-lpill">${chip}<span>${esc(name)}</span></span>` : chip;
}

/** Through-running text: EN "via Fukutoshin Line", JA "副都心線直通", ID "lewat Fukutoshin Line". line: a line object,
 * a name, or a list of them ("via A, B" / "A・B直通"). */
export function viaText(line, lang = 'en') {
  const L = normLang(lang), list = (Array.isArray(line) ? line : [line]).map((x) => lineName(x, L)).filter(Boolean);
  if (!list.length) return '';
  if (L === 'ja') return `${list.join('・')}直通`;
  return `${L === 'id' ? 'lewat' : 'via'} ${list.join(', ')}`;
}

// ------------------------------------------------------------------------------------------------ CSS
/** Styles for .tk-type (type chip), .tk-lpill (line pill) and the sized ring chips (.rtile.krl-bullet.xl/md/sm/xs:
 * krl/styles.js only styles the 40 px ring; the base ring comes from krl/styles.js via page.js's styles.js). Injected
 * once on first use in a browser; a page may also inject it itself. Fonts and radii are the app's. */
export const TYPES_CSS = `
.tk-type{display:inline-flex;align-items:center;flex:none;height:20px;padding:0 8px;border-radius:999px;background:var(--tb);color:var(--tf);font:600 12px/1 var(--font,-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif);letter-spacing:.01em;white-space:nowrap;vertical-align:middle;font-variant-numeric:tabular-nums}
.tk-type[data-e="2"]{font-weight:700}
.rtile.krl-bullet.xl{box-shadow:inset 0 0 0 7.5px var(--rc)}.rtile.krl-bullet.xl[data-len] b{font-size:26px}.rtile.krl-bullet.xl[data-len="2"] b{font-size:19.5px}.rtile.krl-bullet.xl[data-len="3"] b{font-size:14.5px}
.rtile.krl-bullet.md{box-shadow:inset 0 0 0 5px var(--rc)}.rtile.krl-bullet.md[data-len] b{font-size:17px}.rtile.krl-bullet.md[data-len="2"] b{font-size:12.5px}.rtile.krl-bullet.md[data-len="3"] b{font-size:9.5px}
.rtile.krl-bullet.sm{box-shadow:inset 0 0 0 4.4px var(--rc)}.rtile.krl-bullet.sm[data-len] b{font-size:15px}.rtile.krl-bullet.sm[data-len="2"] b{font-size:11.5px}.rtile.krl-bullet.sm[data-len="3"] b{font-size:8.5px}
.rtile.krl-bullet.xs{width:24px;height:24px;box-shadow:inset 0 0 0 3px var(--rc)}.rtile.krl-bullet.xs[data-len] b{font-size:12px}.rtile.krl-bullet.xs[data-len="2"] b{font-size:11px;letter-spacing:-0.04em;transform:scaleX(.8)}.rtile.krl-bullet.xs[data-len="3"] b{font-size:11px;letter-spacing:-0.06em;transform:scaleX(.62)}
.tk-lpill{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 12px 0 0;border-radius:999px;background:var(--panel,#F5F5F7);color:var(--text,#171717);font:500 13px/17px var(--font,-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif);white-space:nowrap;vertical-align:middle}
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head || !document.createElement) return;
  cssDone = true;
  if (document.getElementById?.('tk-types-css')) return;
  const el = document.createElement('style');
  el.id = 'tk-types-css';
  el.textContent = TYPES_CSS;
  document.head.appendChild(el);
}

/** Every train-type id this file has a rule for (= MT3D's train-types.json, same order). */
export const TYPE_IDS = Object.freeze(Object.keys(TYPES));
