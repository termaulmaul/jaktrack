# Ketinggian rel: layang, permukaan, bawah tanah

Catatan riset untuk tampilan 3D: ruas mana yang layang, di permukaan, dan di bawah tanah pada tiap jalur di data jaktrack, dari mana informasinya, dan seberapa yakin. Data yang dipakai halaman dibangun `data-build/elev.mjs` dari OpenStreetMap; sumber lain di sini berfungsi sebagai pembanding.

Riset dilakukan 14–15 November 2026.

## Jawaban singkat untuk pemilik repo

**Mengapa terowongan MRT 3D tidak sampai Lebak Bulus?** Karena terowongan aslinya memang tidak sampai ke sana. Lin Utara-Selatan fase 1 hanya berada di bawah tanah dari Senayan sampai Bundaran HI (6 stasiun). Dari Lebak Bulus sampai ASEAN (7 stasiun) relnya layang, dan mulut terowongan ada di antara ASEAN dan Senayan. Jadi yang kurang selama ini adalah viaduknya, dan itu yang sekarang ditambahkan.

- Wikipedia, ASEAN Headquarters MRT station: "the northernmost elevated station for the first phase of the Jakarta MRT project before entering the underground line" (S1).
- Wikipedia, Senayan Mastercard MRT station: "the first underground station (when heading north towards Bundaran HI)" dan "the southernmost underground station on the MRT" (S2).
- Wikipedia, Jakarta MRT: fase 1 terdiri atas "7 elevated stations and 6 underground stations" (S3); versi Indonesia menyebut hal yang sama (S4).
- The Jakarta Post, 27 Januari 2016: "the 6-kilometer underground section of the MRT, between Bundaran HI and Senayan" dan "the elevated section from Senayan to Lebak Bulus" (S5).
- OpenStreetMap: way rel MRT bertag `bridge=yes layer=3` dari Lebak Bulus sampai ±560 m di utara Stasiun ASEAN, lalu ±370 m tanpa tag (jalur turun), lalu `tunnel=yes` sampai Bundaran HI (S0).

**LRT seharusnya di atas.** Benar. LRT Jakarta dan LRT Jabodebek sekarang berjalan di viaduk (dek dan tiang). Satu pengecualian yang bersumber: ±0,7 km Lin Cibubur di antara Taman Mini dan Cawang berada di permukaan (lihat tabel).

**MRT sebagian lewat atas.** Benar: 8,8 km pertama dari Lebak Bulus layang, lalu turun ke terowongan.

## Hasil per jalur

Kilometer dihitung dari stasiun pertama jalur itu di data kita. "A/B" berarti di antara stasiun A dan B. Keyakinan: **tinggi** = OSM dan sumber tertulis sepakat; **sedang** = hanya OSM, atau sumber tertulis kurang rinci; **rendah** = ada yang tidak cocok.

| Jalur | Ruas | Keadaan | Sumber | Keyakinan |
|---|---|---|---|---|
| MRT Lin Utara-Selatan | Lebak Bulus – 0,5 km setelah ASEAN (km 0,0–8,8) | Layang | S0, S1, S3, S5 | Tinggi |
| | ASEAN/Senayan (km 8,8–9,2) | Peralihan: turun dari viaduk ke mulut terowongan | S0 (rel tanpa tag di antara jembatan dan terowongan) | Sedang |
| | 0,6 km sebelum Senayan – Bundaran HI (km 9,2–14,7) | Bawah tanah | S0, S2, S3, S5 | Tinggi |
| LRT Jakarta | Kelapa Gading (Pegangsaan Dua) – Manggarai (km 0,0–11,7) | Layang seluruhnya | S0, S6, S7 | Tinggi; 200 m pertama sedang (lihat catatan 1) |
| LRT Jabodebek Lin Cibubur | Harjamukti – Taman Mini/Cawang (km 0,0–11,1) | Layang | S0, S8 | Tinggi |
| | Taman Mini/Cawang (km 11,1–11,8) | Permukaan | S0, S8 ("tracks are made at grade because it is close to the approach zone of Halim Perdanakusuma Airport") | Sedang (lihat catatan 2) |
| | Taman Mini/Cawang – Dukuh Atas (km 11,8–24,5) | Layang | S0, S8 | Tinggi |
| LRT Jabodebek Lin Bekasi | Jati Mulya – Dukuh Atas (km 0,0–27,3) | Layang seluruhnya | S0, S9 ("fully-elevated line") | Tinggi |
| KRL Lin Bogor | Jakarta Kota – Manggarai (km 0,2–9,6) | Layang | S0, S10, S11 | Tinggi |
| | Stasiun Manggarai, rel atas (km 9,6–10,6) | Layang | S0, S12 (Lin Bogor pindah ke rel atas, jalur 10–13, sejak 25 September 2021) | Sedang (lihat catatan 3) |
| | Manggarai – Bogor / Nambo | Permukaan | S0 (tidak ada jembatan ≥ 300 m) | Sedang |
| KRL Lin Cikarang (lewat Manggarai) | Manggarai/Matraman – Matraman/Jatinegara (km 15,9–17,1) | Layang | S0 saja | Sedang |
| | Sisanya, dan cabang lewat Pasar Senen | Permukaan | S0 | Sedang |
| KRL Lin Rangkasbitung | Seluruhnya | Permukaan | S0 | Sedang |
| KRL Lin Tangerang | Seluruhnya | Permukaan | S0 | Sedang |
| KRL Lin Tanjung Priok | Seluruhnya | Permukaan | S0 | Sedang |
| KA antarkota dari Gambir | Gambir – menjelang Manggarai (km 0,0–3,9) | Layang | S0, S10, S11 | Tinggi |
| | Manggarai/Jatinegara (km 4,8–6,0) | Layang | S0 saja | Sedang |
| | Sisanya | Permukaan | S0 | Sedang |
| KA antarkota dari Pasar Senen | Seluruhnya | Permukaan | S0 | Sedang |
| KA Pangrango (Bogor–Sukabumi) | Seluruhnya | Permukaan | S0 | Sedang |

Catatan:

1. **LRT Jakarta, 200 m pertama.** Rel Stasiun Pegangsaan Dua (di data kita bernama "Kelapa Gading") dipetakan di OSM dengan `covered=yes` tanpa `bridge`, karena berada di dalam bangunan depo. Wikipedia Indonesia menyebut jalur ini "sepenuhnya berbentuk layang" (S6), jadi pembangun menyambung potongan ujung tanpa tag itu ke viaduk di sebelahnya.
2. **Lin Cibubur di permukaan.** Wikipedia menyebut seluruh ruas Cawang–TMII di permukaan; OSM hanya memetakan ±0,7 km tanpa `bridge` (dua way di sekitar −6,271…−6,277; 106,873). Yang dipakai adalah OSM. Panjang ruas permukaan yang sebenarnya **tidak diketahui**.
3. **Manggarai.** Lintasan sumber kita melewati rel bawah Stasiun Manggarai. Karena Lin Bogor memakai rel atas (S12), di radius 1,2 km dari stasiun itu pembangun memilih rel layang OSM terdekat untuk jalur `krl.Bogor.*` saja (`PREFER_UP` di `data-build/elev.mjs`). Titik naik dan turunnya di selatan stasiun mengikuti jembatan OSM terdekat dan bisa meleset beberapa ratus meter.

### Yang tetap di permukaan walau ada tag jembatan

Jembatan KRL/KA yang lebih pendek dari 300 m (sungai, jalan, saluran) dan terowongan yang lebih pendek dari 150 m (rel lewat bawah jalan atau bangunan, misalnya 40–60 m di Sudirman dan Buaran) dibiarkan di permukaan. Ruas terpanjang yang dibuang dengan aturan ini: 240 m di Nambo/Cibinong, 240 m di Cikarang/Karawang, 220 m di Kampung Bandan/Angke, 220 m di Pondok Ranji/Jurang Mangu, 200 m di Manggarai/Sudirman. `bun data-build/elev.mjs` mencetak daftar lengkapnya per jalur.

## Yang tidak ditemukan

- **Kedalaman tiap stasiun bawah tanah MRT dan elevasi rel terowongan.** Tidak ada di OSM (hanya `layer=-1…-3`), dan tidak ada di artikel Wikipedia yang dibaca. Tidak diketahui.
- **Tinggi viaduk dalam meter** untuk MRT, kedua LRT, dan jalur layang Jakarta Kota–Manggarai. Tidak ada di OSM maupun sumber tertulis yang dibaca. Tidak diketahui.
- **Letak persis mulut terowongan MRT menurut operator.** Yang ada hanya ujung way `tunnel=yes` OSM di sekitar −6,2304; 106,7988 (Jl. Sisingamangaraja, ±600 m di selatan Stasiun Senayan).
- **Pembanding tertulis untuk ruas layang Manggarai–Jatinegara** (Lin Cikarang, KA dari Gambir). Hanya OSM.
- **Panjang ruas bawah tanah yang pasti.** OSM: 5,5 km terowongan ditambah ±0,4 km jalur turun. The Jakarta Post menyebut 6 km (S5). Artikel Wikipedia North–South Line menyebut kontrak "9.2 km underground section" (S13), tidak cocok dengan dua sumber lain dan tidak dipakai.
- Situs resmi operator (jakartamrt.co.id, lrtjabodebek.kai.id, lrtjakarta.co.id) tidak sempat diperiksa.

## Angka meter: perkiraan

| Keadaan | Nilai di data | Asal |
|---|---|---|
| Terowongan | −18 m | Bawaan kode (`DEPTH_M` di `web/src/layers/city3d/elevation.js`). **Perkiraan.** |
| Viaduk, `layer` OSM 1–2 | 12 m | Bawaan kode (`VIADUCT_M`). **Perkiraan.** |
| Viaduk, `layer` 3 / 4 / 5 | 17 / 22 / 27 m | 12 m ditambah 5 m per tingkat di atas 2. **Perkiraan**; yang bersumber hanya urutan tingkatnya (tag `layer`), supaya viaduk yang saling melintas tidak berpotongan. |

Tidak ada angka per stasiun. Di mode Bawah tanah, kedalaman digambar 5× lebih dalam (bawaan kode asal), kecuali "Skala asli" dinyalakan. Tanjakan antara dua tinggi dibuat kode web: 30 m rel per 1 m beda tinggi (±3,3 %).

Tingkat OSM per jalur: MRT layang `layer=3` (17 m); LRT Jabodebek `layer=3` (17 m); LRT Jakarta `layer=2` sampai Velodrome (12 m), lalu naik bertahap ke `layer=5` di Manggarai (27 m); KRL Jakarta Kota–Manggarai `layer=1–2` (12 m), rel atas Manggarai `layer=3` (17 m).

## Metode

1. Satu kueri Overpass mengambil semua way `railway=rail|subway|light_rail` di kotak Jabodetabek (3.324 way, 3,1 MB, data OSM per 14 November 2026 17.39 UTC), disimpan di `var/src/osm/rail.json`. Kuerinya tercantum di `data-build/elev.mjs` (`QUERY`).
2. Tiap jalur disampel tiap 20 m. Tiap titik mengambil rel OSM terdekat dalam 45 m yang searah (±30°) dan sejenis: `subway` untuk MRT, `light_rail` untuk LRT, `rail` untuk KRL dan KA antarkota. Rel kereta cepat (`highspeed=yes`) dan rel langsir tidak dipakai. Semua jalur cocok 100 %.
3. Tingkat tiap titik dari tag: `tunnel` (selain `building_passage`) = terowongan; `bridge` atau `layer ≥ 1` = layang; lainnya permukaan.
4. Celah tanpa tag ≤ 200 m di antara dua ruas sejenis diisi (rel stasiun). Untuk KRL/KA, jembatan < 300 m dan terowongan < 150 m dibuang. Perubahan `layer` yang lebih pendek dari 250 m di tengah viaduk diabaikan.
5. Hasilnya `var/static/tokyo/elev-v1.json` dalam format yang sudah dibaca kode web: `{ lines: { idJalur: [[dariM, sampaiM, meter], …] }, len: { idJalur: panjangM } }`, ditambah `elev-latest.json` dan pendaftaran di `packs.json`.

Pemeriksaan silang: pembangun mencetak `PERIKSA` bila stasiun yang ditandai bawah tanah di `data-build/jakarta.mjs` tidak berada di ruas terowongan menurut OSM, atau sebaliknya. Saat ini tidak ada yang tidak cocok: keenam stasiun (Senayan, Istora, Bendungan Hilir, Setiabudi, Dukuh Atas, Bundaran HI) berada di terowongan, dan ASEAN tidak.

Batasan metode:

- Viaduk digambar dari garis tengah jalur kita, yang sejak perbaikan lanjutan (bagian berikut) diselaraskan ke garis tengah rel OSM; satu dek untuk kedua arah.
- Bila lintasan kita jatuh di antara rel layang dan rel permukaan yang sejajar, rel terdekat yang menang. Itu yang terjadi di Manggarai (catatan 3); tempat lain yang serupa belum diperiksa satu per satu.
- OSM bisa salah atau tertinggal. Data ini potret satu tanggal; jalankan ulang `bun data-build/elev.mjs --fetch` untuk memperbaruinya.

## Trase dan tampilan 3D (perbaikan lanjutan)

Pemilik repo melihat, saat mengikuti kereta MRT di Lebak Bulus dalam 3D, bahwa viaduk tidak berimpit dengan "bangunan jalur" di peta dan garis rute merah tertinggal di tanah. Dugaan awalnya trase kita meleset dari OpenStreetMap. Hasil pemeriksaan:

- **Trase sumber sudah menempel pada rel OSM.** Lintasan dari berkas jadwal mengikuti salah satu rel OSM dengan selisih rata-rata 0,2–0,8 m (tabel di bawah). Satu-satunya selisih besar ada di Manggarai (97 m di Lin Bogor), tempat lintasan sumber melompat di antara rel bawah dan rel atas.
- **"Bangunan jalur" di tanah itu gambar kita sendiri.** Peta dasar tidak menggambar rel MRT/LRT sama sekali (lapisan `rail`-nya hanya untuk kelas `rail`). Pita lebar di tanah adalah lapisan viaduk 2D kita (`tk-via-deck`, `tk-via-edge`) dan garis jalur (`tk-rest`, `tk-pick`), yang tetap digambar datar sementara dek 3D berdiri 12–27 m di atasnya. Dilihat miring, keduanya terpisah oleh paralaks; dilihat tegak lurus dari atas, keduanya berimpit.

Yang diubah:

1. **Garis jalur, garis rute, dan penanda stasiun ikut tinggi rel.** MapLibre tidak bisa menaikkan lapisan garis atau simbol (tidak ada properti elevasi untuk keduanya), jadi selama kota 3D tampil dengan kereta 3D (zoom ≥ 14,2), salinan di tanah untuk ruas layang disembunyikan dengan filter, dan lapisan WebGL kereta menggambar gantinya di atas dek: garis jalur abu-abu, garis jalur atau rute yang dipilih (selubung putih dan warna jalurnya), dan titik stasiun (cincin abu-abu; cincin warna jalur bila jalurnya dipilih). Ruas di permukaan, tampilan 2D, dan mode Bawah tanah tidak berubah. Nama stasiun tetap label peta biasa di posisi tanahnya.
2. **Trase digeser ke garis tengah rel OSM** (`data-build/snap.mjs`, dipanggil `data-build/jakarta.mjs` per potongan rel antarstasiun). Tiap titik hanya digeser menyamping: ke rel OSM sejenis terdekat, atau ke tengah-tengahnya dengan rel kembaran 2–7 m di sebelahnya. Karena lintasan sumber berada di salah satu dari dua rel, pergeserannya umumnya ±2 m; gunanya dek viaduk 9 m kini menutup kedua rel, dan lekukan pendek akibat lintasan sumber pindah rel berkurang dari 47 menjadi 9 potongan. Di Manggarai, Lin Bogor kini mengikuti rel atas sepanjang stasiun (aturan `PREFER_UP` yang sama dengan pembangun ketinggian). Urutan stasiun, jadwal, dan uji `data-build/jakarta.test.mjs` tidak berubah; panjang jalur berubah paling banyak ±0,1 km.
3. **Label tombol ride.** "Ikut di terowongan" hanya saat kereta berada di ruas terowongan menurut `elev-v1.json`; di ruas layang dan permukaan labelnya "Ikut kereta dari dekat".

Selisih lintasan terhadap rel OSM sejenis terdekat yang searah, dalam meter (keluaran `bun data-build/jakarta.mjs`). "Sesudah" lebih besar daripada "sebelum" karena garis tengah jalur ganda memang berjarak setengah jarak antar-rel dari rel terdekat; yang relevan adalah maksimumnya.

| Jalur | Sebelum: rata-rata | Sebelum: maks | Sesudah: rata-rata | Sesudah: maks | Tanpa rel OSM |
|---|---|---|---|---|---|
| `krl.Bogor.0` | 0,3 | 97,2 | 1,8 | 4,7 | 0 m |
| `krl.Bogor.1` | 0,3 | 97,2 | 1,4 | 3,6 | 0 m |
| `krl.Rangkasbitung.2` | 0,2 | 1,7 | 1,7 | 57,1 | 0 m |
| `krl.Rangkasbitung.3` | 0,2 | 2,5 | 1,6 | 2,9 | 0 m |
| `krl.Tangerang.4` | 0,2 | 1,0 | 1,8 | 3,2 | 0 m |
| `krl.Tangerang.5` | 0,2 | 2,4 | 1,6 | 13,0 | 0 m |
| `krl.Tanjung-Priok.6` | 0,8 | 4,7 | 1,6 | 3,2 | 0 m |
| `krl.Cikarang.7` | 0,3 | 2,4 | 1,7 | 5,1 | 0 m |
| `krl.Cikarang.8` | 0,5 | 3,4 | 1,7 | 3,7 | 0 m |
| `mrt.MRT.9` | 0,2 | 0,6 | 3,3 | 8,0 | 0 m |
| `lrtj.LRTJ.10` | 0,3 | 8,3 | 2,0 | 7,9 | 0 m |
| `jbdb.Cibubur.11` | 0,2 | 0,7 | 1,9 | 3,0 | 0 m |
| `jbdb.Bekasi.12` | 0,2 | 0,7 | 1,9 | 3,2 | 0 m |
| `kai.KA-GMR.13` | 0,2 | 5,8 | 1,9 | 3,8 | 0 m |
| `kai.KA-PSE.14` | 0,3 | 3,3 | 1,9 | 6,6 | 0 m |
| `kai.KA-PG.15` | 0,2 | 0,7 | 1,0 | 3,5 | 0 m |

Yang dibiarkan:

- **Sembilan lekukan pendek (10–20 m) warisan lintasan sumber**, tempat lintasan pindah rel dalam satu langkah: dekat Jakarta Kota (Lin Bogor), satu di Lin Rangkasbitung sekitar 106,5188; −6,3549 (asal angka 57,1 m di tabel: di lekukan itu arah lintasan melintang sehingga rel "searah" terdekat adalah rel lain), dua di Lin Tangerang sekitar 106,6648; −6,1720, dan dua di Lin Cikarang (106,9232; −6,2155 dan 106,9707; −6,2213). Angka 13,0 m di `krl.Tangerang.5` sejenis. Tidak diperbaiki satu per satu.
- **Satu garis untuk dua arah.** Garis jalur tetap satu, di tengah. Kereta kedua arah kini berjalan di relnya masing-masing di kiri-kanan garis itu ([REL.md](REL.md)).
- **Terowongan** mengikuti garis tengah yang sama. Sejak pemisahan dua arah ([REL.md](REL.md)), lintasan MRT di terowongan berada di tengah-tengah kedua tabung OSM (terpisah 10–16 m), sehingga jaraknya ke rel terdekat menjadi 5–8 m (angka MRT di tabel). Berkas opsional `tunnels-v1.json` milik kode asal (trase per rel di terowongan) tidak dibangun; tabung digambar dengan jarak bawaan kode di kiri-kanan garis tengah itu.
- **Tinggi dek tetap perkiraan** (bagian "Angka meter"); bila angka aslinya berbeda, dek tetap berimpit dari atas tetapi tingginya salah.
- Overpass tidak dipanggil lagi; semuanya memakai `var/src/osm/rail.json` yang sama. `network-v1.json` kini juga turunan OSM (ODbL) dan mencatatnya di `meta.source.alignment`; berkas itu tetap hanya di `var/`.

## Lisensi

`elev-v1.json` adalah turunan data OpenStreetMap, © kontributor OpenStreetMap, Open Database License (ODbL) 1.0. Berkas itu dan `var/src/osm/rail.json` hanya ada di `var/` dan tidak di-commit. Atribusinya tampil di Tentang → Data dan kredit (`web/src/tokyo/credits.js`) saat berkas itu dimuat. Tidak ada data ketinggian yang diambil dari trafik.live.

## Sumber

- **S0** OpenStreetMap lewat Overpass API, tag `bridge`/`tunnel`/`layer` way rel, data per 2026-11-14T17:39:19Z. <https://www.openstreetmap.org/copyright>, <https://overpass-api.de/>. Way MRT: jembatan [898547116](https://www.openstreetmap.org/way/898547116), jalur turun tanpa tag [754520845](https://www.openstreetmap.org/way/754520845), terowongan [499578964](https://www.openstreetmap.org/way/499578964) dan [485764779](https://www.openstreetmap.org/way/485764779). Way LRT Jabodebek tanpa `bridge`: [1332161175](https://www.openstreetmap.org/way/1332161175), [1332161176](https://www.openstreetmap.org/way/1332161176).
- **S1** Wikipedia, "ASEAN Headquarters MRT station". <https://en.wikipedia.org/wiki/ASEAN_Headquarters_MRT_station>
- **S2** Wikipedia, "Senayan Mastercard MRT station". <https://en.wikipedia.org/wiki/Senayan_Mastercard_MRT_station>
- **S3** Wikipedia, "Jakarta MRT". <https://en.wikipedia.org/wiki/Jakarta_MRT>
- **S4** Wikipedia Indonesia, "MRT Jakarta". <https://id.wikipedia.org/wiki/MRT_Jakarta>
- **S5** The Jakarta Post, "Greater Jakarta: MRT project 38 percent complete", 27 Januari 2016. <https://www.thejakartapost.com/news/2016/01/27/greater-jakarta-mrt-project-38-percent-complete.html>
- **S6** Wikipedia Indonesia, "LRT Jakarta". <https://id.wikipedia.org/wiki/LRT_Jakarta>
- **S7** Wikipedia, "Manggarai railway station" (stasiun LRT Manggarai: "an elevated station"). <https://en.wikipedia.org/wiki/Manggarai_railway_station>
- **S8** Wikipedia, "Cibubur Line". <https://en.wikipedia.org/wiki/Cibubur_Line>
- **S9** Wikipedia, "Bekasi Line". <https://en.wikipedia.org/wiki/Bekasi_Line>
- **S10** Wikipedia, "Jakarta–Bogor railway" ("Between 1988 and 1992, the so far ground-level railway was reconstructed into an elevated railway"). <https://en.wikipedia.org/wiki/Jakarta%E2%80%93Bogor_railway>
- **S11** Wikipedia, "Gambir railway station" (stasiun layang sejak 1992; "Jakarta Kota–Manggarai elevated railway"). <https://en.wikipedia.org/wiki/Gambir_railway_station>
- **S12** Wikipedia, "Manggarai railway station" (rel atas, Lin Bogor sejak 25 September 2021). <https://en.wikipedia.org/wiki/Manggarai_railway_station>
- **S13** Wikipedia, "North–South Line (Jakarta MRT)" (daftar kontrak CP 101–106: layang untuk Lebak Bulus–ASEAN, terowongan untuk Senayan–Bundaran HI). <https://en.wikipedia.org/wiki/North%E2%80%93South_Line_(Jakarta_MRT)>

Wikipedia adalah sumber sekunder; angka dan kutipan di atas belum dicocokkan dengan dokumen operator.
