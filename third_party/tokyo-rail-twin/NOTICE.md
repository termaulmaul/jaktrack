# Third-party notices

Tokyo Rail Twin's own code is under the MIT License (`LICENSE`, Copyright (c) 2026 Jatevo Labs). This file lists
the third-party code, data and services it uses, with their licences and the credit each one asks for.

**The repository carries no transit data.** The network, timetable, exit, bus and 3D data files are built on your
machine by `npm run data` (see `docs/DATA.md`); their licences below apply to the files you build and to anything
you publish from them. The data-like files in the repository are: small test fixtures of Toei open data (CC BY 4.0,
listed below) and hand-made test inputs (`server/fixtures/polite-*`); the Japanese holiday list (below); and
`data-build/net/known-offsets.json`, a test tolerance table of our own (station ids and allowed metres, no Mini Tokyo 3D
coordinates or times).

## Code bundled into the page

| Package | Licence | Notes |
|---|---|---|
| [MapLibre GL JS](https://maplibre.org) 5.24.0 | BSD-3-Clause | Includes code from mapbox-gl-js v1.13 and earlier (BSD-3-Clause), glfx.js (MIT) and d3-color (ISC); the full texts ship in `web/public/LICENSES.txt`. |
| MapLibre's dependencies (`@maplibre/*`, `@mapbox/*`, `earcut`, `gl-matrix`, `kdbush`, `pbf`, `potpack`, `quickselect`, `tinyqueue`, `murmurhash-js`, `minimist`, ...) | MIT, ISC, BSD-2-Clause, BSD-3-Clause, `MIT OR Apache-2.0` (`@maplibre/mlt`) | Every package in `package-lock.json` is under one of these permissive licences. |
| [esbuild](https://esbuild.github.io) 0.28.2 | MIT | Build tool only (devDependency); not shipped. |

Optional data steps use Python packages that are not shipped: [pyosmium](https://osmcode.org/pyosmium/) (BSD-2-Clause)
and [Pillow](https://python-pillow.org) (MIT-CMU).

## Mini Tokyo 3D

Network, timetable and station-exit data, and parts of the code, come from
[Mini Tokyo 3D](https://github.com/nagix/mini-tokyo-3d) by Akihiko Kusanagi, MIT License. `npm run data` downloads
its `data/` folder at a pinned commit (`data-build/paths.mjs`); nothing of it is committed here. Files with ported
code start with `/*! Portions from Mini Tokyo 3D, (c) 2019-2026 Akihiko Kusanagi, MIT License */`:
`data-build/net/build.mjs` (track composition), `web/src/tokyo/model.js`, `web/src/tokyo/calendar.js`,
`web/src/tokyo/live.js`, `server/live.mjs`.

```
The MIT License (MIT)

Copyright (c) 2019-2026 Akihiko Kusanagi

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

Mini Tokyo 3D's data is itself sourced from the Public Transportation Open Data Center (below). MIT covers what its
author owns; it does not lift the Center's terms on the operators' data inside it. Do not publish the built timetable
or network files for reuse (see `docs/DATA.md`, "Publishing").

## Public Transportation Open Data Center (ODPT)

Apps showing ODPT data must show this notice (公共交通オープンデータ開発者ガイドライン 3.1). The page shows it in
About > Data and credits, with the contact address set at build time (`TOKYO_CONTACT`):

> 本アプリケーションが利用する公共交通データは、公共交通オープンデータセンターにおいて提供されるものです。
> 公共交通事業者により提供されたデータを元にしていますが、必ずしも正確・完全なものとは限りません。本アプリケーションの表示内容について、公共交通事業者への直接の問合せは行わないでください。
> 本アプリケーションに関するお問い合わせは、以下のメールアドレスにお願いします。

> The source of the public transportation data in this app, etc. is the Public Transportation Open Data Center.
> They are based on the data provided by the public transportation operators. The accuracy and integrity of the data
> are not guaranteed. Please do not contact the public transportation operators directly regarding the content of the
> app. For inquiries on the app, please contact the following e-mail address.

Terms: https://developer.odpt.org/terms

### Toei (Bureau of Transportation, Tokyo Metropolitan Government), CC BY 4.0

Used for: Toei lines in the timetable data, the live Toei train positions and service status (`npm run live`), the
Toei Bus stops, routes and live positions (`npm run data:bus`, `npm run live`), and the test fixtures in
`server/fixtures/` (`real-train-toei.json`, `real-traininfo-toei.json`, `bus-toei-vp.pb`: answers of ODPT's keyless
endpoint saved once; `bus-snapshot-toei.json`: our service's answer built from them; `center-train-toei.json`:
hand-made in the same shape). Credit in the ODPT FAQ format
(https://developer.odpt.org/en/faq-info#cc-by-credit), as the page shows it:

> This app uses the following copyrighted material with modifications. Bureau of Transportation, Tokyo Metropolitan
> Government / Association for Open Data of Public Transportation, Train timetable, Station information, Route
> information, Train location information and Train status information of Bureau of Transportation, Tokyo
> Metropolitan Government, Creative Commons License Attribution 4.0 International
> (https://creativecommons.org/licenses/by/4.0/deed.en)

> このアプリは、以下の著作物を改変して利用しています。 東京都交通局・公共交通オープンデータ協議会、東京都交通局
> 列車時刻表・駅情報・路線系統情報・列車ロケーション情報・運行情報、クリエイティブ・コモンズ・ライセンス　表示4.0国際
> （https://creativecommons.org/licenses/by/4.0/deed.ja）

> This app uses the following copyrighted material with modifications. Bureau of Transportation, Tokyo Metropolitan
> Government / Association for Open Data of Public Transportation, Bus information and Bus realtime information of
> Bureau of Transportation, Tokyo Metropolitan Government, Creative Commons License Attribution 4.0 International
> (https://creativecommons.org/licenses/by/4.0/deed.en)

Datasets: https://ckan.odpt.org/dataset/r_train_timetable-toei, https://ckan.odpt.org/dataset/r_train_location-toei,
https://ckan.odpt.org/dataset/r_train_status-toei, https://ckan.odpt.org/dataset/b_bus_gtfs_jp-toei,
https://ckan.odpt.org/dataset/b_bus_gtfs_rt-toei

## Maps

- **OpenStreetMap**: map data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/),
  https://www.openstreetmap.org/copyright. "© OpenStreetMap" stays visible on the map. The optional data steps build
  files from OSM (station numbering via the Overpass API, line heights, tunnel alignments, platform levels, river
  crossings from Geofabrik extracts): those files are Derivative Databases under the ODbL.
- **OpenFreeMap / OpenMapTiles** (the default basemap): "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
  https://openfreemap.org, https://www.openmaptiles.org. Its tiles and glyphs are loaded from tiles.openfreemap.org
  (free public instance, no key; see its terms of service at https://openfreemap.org/tos/).
- **Protomaps Basemap** (only with `BASEMAP=protomaps`, your own tiles): https://protomaps.com, built from
  OpenStreetMap with Natural Earth (public domain).
- **Noto Sans** label glyphs (served with the basemap tiles): © The Noto Project Authors, SIL Open Font License 1.1.
- **Wikidata** (station numbers, optional `npm run data:codes`): CC0.

## Elevation and depths (optional `npm run data:3d`)

- **GSI elevation tiles**: 出典：国土地理院（地理院タイル 標高タイル DEM5A・DEM5B・DEM10B）を加工して作成
  (Geospatial Information Authority of Japan, processed), https://maps.gsi.go.jp/development/ichiran.html
- **Japanese Wikipedia** (only with `--wiki`): platform floors parsed from articles, CC BY-SA 4.0; the build keeps
  each article's URL and revision date with the value it took from it.

## Other

- Japanese public holidays (`data-build/tt/syukujitsu-2026-2027.csv`, mirrored in `web/src/tokyo/calendar.js`):
  Cabinet Office (内閣府)「国民の祝日について」, https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html, published
  under the Government of Japan Standard Terms of Use (compatible with CC BY 4.0).
- The app icon and the in-page art (`web/public/icon*`, `web/src/tokyo/art/`) are made for this project and are under
  the project's MIT License.

This project is not affiliated with any railway operator, the Public Transportation Open Data Center, Mini Tokyo 3D,
OpenFreeMap or the OpenStreetMap Foundation.
