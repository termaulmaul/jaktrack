# Jumlah rel per ruas dan sisi jalan kereta

Dasar pemisahan kereta dua arah di peta: di ruas mana ada satu rel, dua rel, atau lebih, dan di rel mana kereta berjalan. Dibangun `data-build/elev.mjs` (fungsi `tracks` di `data-build/snap.mjs`) dari `var/src/osm/rail.json`, potret OpenStreetMap 14 November 2026 yang sama dengan [ELEVASI.md](ELEVASI.md). Overpass tidak dipanggil lagi. Hasilnya masuk ke `elev-v1.json` (kunci `tracks` dan `hand`), turunan OSM (ODbL), hanya di `var/`.

Riset dan uji: 15 November 2026.

## Ringkasan per jalur

Kilometer menurut jumlah rel utama yang sejajar. "3+" berarti tiga rel atau lebih (dwiganda, emplasemen stasiun). Tidak ada ruas yang tidak bisa ditentukan: semua lintasan punya rel OSM sejenis dalam 16 m.

| Jalur | Tunggal | Ganda | 3+ | Tidak diketahui | Way OSM berarah: kanan / kiri |
|---|---|---|---|---|---|
| `krl.Bogor.0` Jakarta Kota–Bogor | 0,5 | 52,0 | 2,4 | 0 | 5.141 / 27 |
| `krl.Bogor.1` Nambo–Jakarta Kota | 13,0 | 35,6 | 2,4 | 0 | 3.534 / 3 |
| `krl.Rangkasbitung.2` Tanah Abang–Rangkasbitung | 0,0 | 72,2 | 0,6 | 0 | 441 / 0 |
| `krl.Rangkasbitung.3` Manggarai–Angke | 0,0 | 8,6 | 2,2 | 0 | 0 / 0 |
| `krl.Tangerang.4` Tangerang–Duri | 0,0 | 18,9 | 0,8 | 0 | 1.838 / 2 |
| `krl.Tangerang.5` Duri–Manggarai | 0,0 | 8,2 | 1,6 | 0 | 0 / 0 |
| `krl.Tanjung-Priok.6` | 0,0 | 5,1 | 3,1 | 0 | 122 / 0 |
| `krl.Cikarang.7` Kampung Bandan–Cikarang | 0,0 | 31,3 | 18,3 | 0 | 1.650 / 0 |
| `krl.Cikarang.8` Jakarta Kota–Cikarang | 0,4 | 24,9 | 18,8 | 0 | 2.496 / 0 |
| `mrt.MRT.9` MRT Lin Utara-Selatan | 0,0 | 14,6 | 0,0 | 0 | 0 / 0 |
| `lrtj.LRTJ.10` LRT Jakarta | 0,1 | 11,5 | 0,0 | 0 | 1.120 / 0 |
| `jbdb.Cibubur.11` LRT Jabodebek Cibubur | 0,0 | 24,4 | 0,0 | 0 | 891 / 0 |
| `jbdb.Bekasi.12` LRT Jabodebek Bekasi | 0,0 | 27,3 | 0,0 | 0 | 891 / 0 |
| `kai.KA-GMR.13` KA dari Gambir | 0,0 | 61,2 | 17,8 | 0 | 5.891 / 5 |
| `kai.KA-PSE.14` KA dari Pasar Senen | 0,0 | 60,8 | 16,7 | 0 | 6.081 / 5 |
| `kai.KA-PG.15` KA Pangrango | 29,9 | 26,8 | 0,0 | 0 | 2.563 / 0 |

Rel tunggal yang berarti: cabang Nambo (Nambo–Cibinong–Pondok Rajeg, 13,0 km di `krl.Bogor.1`) dan 29,9 km lintas Bogor–Sukabumi (KA Pangrango). Sisanya pendek (ujung jalur, satu potongan dekat Depok dan Pasar Senen).

## Sisi jalan kereta

Semua sistem di data kita berjalan di **rel kanan** menurut arah jalannya (jalan kanan), berbeda dengan lalu lintas jalan raya Indonesia yang di kiri.

| Sistem | Sisi | Sumber tertulis | Arah way OSM | Keyakinan |
|---|---|---|---|---|
| KRL Commuter Line | Kanan | R1 | 15.222 kanan / 32 kiri | Tinggi |
| KA antarkota | Kanan | R1 | 14.535 kanan / 10 kiri | Tinggi |
| LRT Jakarta | Kanan | R1 (menyebut LRT) | 1.120 kanan / 0 kiri | Tinggi |
| LRT Jabodebek | Kanan | R1 (menyebut LRT) | 1.782 kanan / 0 kiri | Tinggi |
| MRT Jakarta | Kanan | R1, R2 | tidak bertag arah di OSM | Sedang: dua kutipan Wikipedia, tanpa pembanding OSM |

- **R1** Wikipedia, "Double-track railway": "In Indonesia, right-hand running for railways (including LRT and MRT systems) and left-hand running for roads." <https://en.wikipedia.org/wiki/Double-track_railway>
- **R2** Wikipedia, "Jakarta MRT": "Trains run on the right to match Indonesian railways, which also have a right handed traffic, despite Indonesia having left handed traffic for roads." <https://en.wikipedia.org/wiki/Jakarta_MRT>
- **Arah way OSM**: tag `railway:preferred_direction=forward` (1.253 way) menyatakan way digambar searah jalannya kereta. Di tiap titik dengan tepat dua rel, pembangun mencatat apakah way berarah itu berada di kanan atau di kiri arahnya sendiri. Angka di tabel adalah jumlah titik contoh (tiap 20 m), dijumlahkan per sistem. Jalur `krl.Rangkasbitung.3` dan `krl.Tangerang.5` (Manggarai–Duri–Angke) tidak punya way berarah; keduanya mengikuti sistem KRL.

Situs resmi operator tidak diperiksa. Wikipedia adalah sumber sekunder. Tabel yang menentukan ada di `data-build/elev.mjs` (`HAND`); arah way OSM hanya pemeriksa, dan pembangun mencetak `PERIKSA` bila keduanya berlawanan (saat ini tidak ada).

## Metode jumlah rel

Tag jumlah rel di OSM terlalu jarang untuk dipakai langsung: `tracks` ada di 29 way dan `passenger_lines` di 55 way dari 3.324. Yang dipakai adalah jumlah way sejajar:

1. Lintasan tiap jalur (sudah di garis tengah rel OSM) disampel tiap 20 m.
2. Di tiap titik dihitung way sejenis (`subway` untuk MRT, `light_rail` untuk LRT, `rail` untuk KRL/KA) yang searah (±30°) dalam 16 m ke kiri dan kanan. Way ber-`service` (`yard`, `siding`, `spur`, `crossover`, `depot`) dan rel kereta cepat tidak dihitung. Way yang berjarak kurang dari 1,5 m dianggap satu rel.
3. Jumlahnya dihaluskan dengan median 11 titik (220 m), dan ruas di bawah 300 m di antara dua ruas yang sama mengikuti tetangganya, supaya wesel dan sepur simpang pendek tidak dihitung.
4. Di ruas dua rel atau lebih dicatat setengah jarak antara rel terdekat di kiri dan di kanan lintasan, dibulatkan 0,5 m (1,5–8 m). Nilai umum 2–2,5 m (jarak antar-rel 4–5 m); di terowongan MRT 5–8 m (dua tabung terpisah 10–16 m); di peron pulau melebar.

Keyakinan: **tinggi** untuk ruas yang seluruhnya satu nilai (132 dari 191 ruas); **sedang** untuk ruas campuran di tabel bawah (emplasemen stasiun, peralihan ganda ke dwiganda), karena batasnya bergantung pada cara pemeta menandai rel langsir.

Batasan:

- Di ruas tiga rel atau lebih, data tidak tahu rel mana yang dipakai tiap jalur. Kereta ditaruh di sepasang rel terdekat di kiri dan kanan lintasan kita.
- Jalur yang berbagi rel yang sama (Bogor dan Nambo; kedua Cikarang; Rangkasbitung, Tangerang, dan Cikarang di Manggarai–Duri) tetap digambar sebagai garis yang bertumpuk, karena relnya memang sama. Yang berubah: kereta kedua arah kini di relnya masing-masing, jadi kereta jalur yang berbeda di rel yang sama tampil di rel yang sama, bukan bertumpuk di garis tengah.
- Kereta yang bersilang di rel tunggal (misalnya di lintas Sukabumi) tetap bisa tampak berpapasan di satu garis di luar stasiun bila jadwal sumbernya begitu; data tidak memuat sepur simpang.

## Penerapan di peta

- **3D**: kereta berjalan `setengah jarak antar-rel` di kanan arah jalannya di ruas dua rel atau lebih, dan tepat di garis jalur di rel tunggal (peralihan landai 40 m). Berlaku di viaduk, di permukaan, dan untuk kamera ride. Di terowongan MRT (mode Bawah tanah) tiap arah tetap di tabungnya, kini tabung kanan.
- **Jalur atau kereta yang dibuka**: di 3D sorotannya (selubung putih dan warna jalur, seperti garis terpilih di peta 2D) mengenai **kedua rel** jalur itu dari ujung ke ujung, baik yang dibuka jalur maupun satu keretanya. Rel jalur lain mundur ke abu-abu. Tidak ada lagi satu rel berwarna dan satu abu-abu, dan tidak ada garis rute terpisah yang bisa tampak sebagai bayangan di samping kereta.
- **2D**: kereta sudah digambar di samping garisnya; sekarang sisinya kanan (tadinya kiri, bawaan Tokyo) dan di rel tunggal kereta berada tepat di garis.
- **Rel terlihat di 3D, berwarna jalurnya**: tiap rel digambar sebagai pita selebar 1,4 m (dikali pelebaran kereta) tepat di tempat keretanya berjalan: dua pita di ruas dua rel atau lebih, satu di rel tunggal. Kedua arah memakai warna jalurnya (MRT merah di kedua rel). Pitanya memakai jarak dan faktor pelebaran yang sama dengan kereta (`rails.js` dan `wideOf(kw)`), dihitung di shader, jadi kereta selalu di atas pitanya pada zoom berapa pun. Jalur yang berbagi rel digambar bertumpuk; warna jalur yang terakhir di daftar yang terlihat.
- **Satu gambar per jalur, menerus**: pita rel digambar dari ujung ke ujung jalur: di atas dek, di permukaan, menuruni landaian, dan terus di dalam terowongan pada kedalamannya (`railData` di `vehicles.js`). Di terowongan pitanya putus-putus dan sedikit lebih pucat, satu per tabung, sehingga terbaca sebagai bawah tanah dan tetap tersambung ke ruas layang. Selama rel 3D tampil, semua garis jalur 2D (`tk-rest`, `tk-rest-ug`, `tk-via-*`, `tk-pick*`) disembunyikan (`raiseNet` di `city3d/index.js`), jadi tidak ada garis ganda. Di peralihan rel tunggal ke ganda kedua pita merapat lalu menyatu (peralihan 40 m dari `rails.js`), bukan lompatan.
- **Di bawah zoom 14,2 dan di 2D**: yang tampil garis 2D tunggal. Selama 3D menyala garis itu memakai warna jalurnya, sehingga melewati zoom 14,2 satu garis merah berganti dua rel merah. Di 2D garisnya tetap abu-abu tenang. Ruas terowongan pada garis 2D kini putus-putus dengan abu-abu dan lebar yang sama dengan ruas permukaan (tadinya lebih tipis dan pucat sampai nyaris hilang di mulut terowongan).
- **Dek viaduk melebar**: di bawah zoom 17,5 kereta 3D digambar lebih lebar dari aslinya (sampai 8× di zoom 14,2), dan jarak relnya ikut melebar. Dek dibangun dalam tujuh rentang zoom (14,2–15, lalu tiap setengah tingkat sampai 17,5 ke atas) dengan lebar yang memuat kedua rel dan keretanya di rentang itu.
- **Jarak minimum**: jarak sumbu dua rel paling sedikit 4 m (`MIN_HALF_M`), dan pelebaran jarak rel dibulatkan ke atas dari pelebaran badan kereta. Maka jarak sumbu ≥ 4 m × pelebaran, sedangkan lebar badan 2,95 m × pelebaran: dua badan tidak bisa saling menutupi pada zoom mana pun di ruas ganda.
- **Terowongan (mode Bawah tanah)**: dua tabung digambar terpisah dan tiap arah berjalan di tabungnya; rel di dalam tabung terlihat saat ride ("Dari belakang", "Kabin"). Ruas terbuka tiap jalur digambar sebagai rel berwarna rata di permukaan jalan, di atas selubung, sampai ke mulut tabung; garis 2D ruas terbuka disembunyikan. Jejak dan garis putus-putus 2D ruas terowongan tetap. Rel permukaan ini tidak digambar saat ride atau Terbang bebas.
- **Ujung jalur**: di stasiun ujung (Lebak Bulus, Bundaran HI, dan lainnya) kereta yang tiba dan yang berangkat tetap di rel arahnya masing-masing sampai titik akhir. **Pindah rel (wesel) di ujung tidak dimodelkan**: kereta yang tiba di rel kanan berangkat lagi sebagai perjalanan baru di rel kanan arah sebaliknya, tanpa gerakan melintas di antara keduanya.
- Tanpa `elev-v1.json` (atau tanpa kunci `tracks`), semuanya kembali ke perilaku lama.

## Tabel per ruas

Ruas antarstasiun yang disinggahi jalur itu, panjang dalam km, dan bagian panjangnya menurut jumlah rel. Dicetak `bun data-build/elev.mjs --rel`.

| Jalur | Ruas | km | Jumlah rel |
|---|---|---|---|
| `krl.Bogor.0` | Jakarta Kota – Jayakarta | 1.3 | 2 rel 72%, 3 rel 28% |
| `krl.Bogor.0` | Jayakarta – Mangga Besar | 1.1 | 2 rel 100% |
| `krl.Bogor.0` | Mangga Besar – Sawah Besar | 1.2 | 2 rel 100% |
| `krl.Bogor.0` | Sawah Besar – Juanda | 0.8 | 2 rel 100% |
| `krl.Bogor.0` | Juanda – Gondangdia | 2.2 | 2 rel 100% |
| `krl.Bogor.0` | Gondangdia – Cikini | 1.7 | 2 rel 100% |
| `krl.Bogor.0` | Cikini – Manggarai | 1.6 | 4 rel 70%, 2 rel 23%, 3 rel 7% |
| `krl.Bogor.0` | Manggarai – Tebet | 2.1 | 2 rel 62%, 4 rel 38% |
| `krl.Bogor.0` | Tebet – Cawang | 1.8 | 2 rel 100% |
| `krl.Bogor.0` | Cawang – Duren Kalibata | 1.5 | 2 rel 100% |
| `krl.Bogor.0` | Duren Kalibata – Pasar Minggu Baru | 0.9 | 2 rel 100% |
| `krl.Bogor.0` | Pasar Minggu Baru – Pasar Minggu | 2.5 | 2 rel 100% |
| `krl.Bogor.0` | Pasar Minggu – Tanjung Barat | 2.7 | 2 rel 100% |
| `krl.Bogor.0` | Tanjung Barat – Lenteng Agung | 2.6 | 2 rel 100% |
| `krl.Bogor.0` | Lenteng Agung – Univ. Pancasila | 1.0 | 2 rel 100% |
| `krl.Bogor.0` | Univ. Pancasila – Univ. Indonesia | 2.4 | 2 rel 100% |
| `krl.Bogor.0` | Univ. Indonesia – Pondok Cina | 0.9 | 2 rel 100% |
| `krl.Bogor.0` | Pondok Cina – Depok Baru | 2.8 | 2 rel 100% |
| `krl.Bogor.0` | Depok Baru – Depok | 1.6 | 2 rel 70%, 1 rel 30% |
| `krl.Bogor.0` | Depok – Citayam | 5.2 | 2 rel 100%, 1 rel 0% |
| `krl.Bogor.0` | Citayam – Bojonggede | 5.2 | 2 rel 100% |
| `krl.Bogor.0` | Bojonggede – Cilebut | 4.4 | 2 rel 100% |
| `krl.Bogor.0` | Cilebut – Bogor | 7.7 | 2 rel 100% |
| `krl.Bogor.1` | Nambo – Cibinong | 6.4 | 1 rel 100% |
| `krl.Bogor.1` | Cibinong – Pondok Rajeg | 3.2 | 1 rel 100% |
| `krl.Bogor.1` | Pondok Rajeg – Citayam | 3.7 | 1 rel 78%, 2 rel 22% |
| `krl.Bogor.1` | Citayam – Depok | 5.2 | 2 rel 97%, 1 rel 3% |
| `krl.Bogor.1` | Depok – Depok Baru | 1.6 | 2 rel 81%, 1 rel 19% |
| `krl.Bogor.1` | Depok Baru – Pondok Cina | 2.8 | 2 rel 100% |
| `krl.Bogor.1` | Pondok Cina – Univ. Indonesia | 0.9 | 2 rel 100% |
| `krl.Bogor.1` | Univ. Indonesia – Univ. Pancasila | 2.4 | 2 rel 100% |
| `krl.Bogor.1` | Univ. Pancasila – Lenteng Agung | 1.0 | 2 rel 100% |
| `krl.Bogor.1` | Lenteng Agung – Tanjung Barat | 2.6 | 2 rel 100% |
| `krl.Bogor.1` | Tanjung Barat – Pasar Minggu | 2.7 | 2 rel 100% |
| `krl.Bogor.1` | Pasar Minggu – Pasar Minggu Baru | 2.5 | 2 rel 100% |
| `krl.Bogor.1` | Pasar Minggu Baru – Duren Kalibata | 0.9 | 2 rel 100% |
| `krl.Bogor.1` | Duren Kalibata – Cawang | 1.5 | 2 rel 100% |
| `krl.Bogor.1` | Cawang – Tebet | 1.8 | 2 rel 100% |
| `krl.Bogor.1` | Tebet – Manggarai | 2.1 | 2 rel 54%, 4 rel 46% |
| `krl.Bogor.1` | Manggarai – Cikini | 1.6 | 4 rel 59%, 2 rel 33%, 3 rel 7% |
| `krl.Bogor.1` | Cikini – Gondangdia | 1.7 | 2 rel 100% |
| `krl.Bogor.1` | Gondangdia – Juanda | 2.2 | 2 rel 100% |
| `krl.Bogor.1` | Juanda – Sawah Besar | 0.8 | 2 rel 100% |
| `krl.Bogor.1` | Sawah Besar – Mangga Besar | 1.2 | 2 rel 100% |
| `krl.Bogor.1` | Mangga Besar – Jayakarta | 1.1 | 2 rel 100% |
| `krl.Bogor.1` | Jayakarta – Jakarta Kota | 1.3 | 2 rel 67%, 4 rel 27%, 3 rel 5% |
| `krl.Rangkasbitung.2` | Tanah Abang – Palmerah | 3.2 | 2 rel 80%, 4 rel 13%, 3 rel 7% |
| `krl.Rangkasbitung.2` | Palmerah – Kebayoran | 3.7 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Kebayoran – Pondok Ranji | 6.2 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Pondok Ranji – Jurang Mangu | 2.2 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Jurang Mangu – Sudimara | 2.1 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Sudimara – Rawa Buntu | 4.5 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Rawa Buntu – Serpong | 1.4 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Serpong – Cisauk | 2.8 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Cisauk – Cicayur | 2.6 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Cicayur – Jatake | 1.5 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Jatake – Parung Panjang | 4.3 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Parung Panjang – Cilejit | 7.2 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Cilejit – Daru | 2.7 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Daru – Tenjo | 3.8 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Tenjo – Tigaraksa | 3.1 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Tigaraksa – Cikoya | 2.6 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Cikoya – Maja | 1.8 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Maja – Citeras | 7.4 | 2 rel 100% |
| `krl.Rangkasbitung.2` | Citeras – Rangkasbitung | 9.9 | 2 rel 100% |
| `krl.Rangkasbitung.3` | Manggarai – Sudirman | 3.2 | 2 rel 83%, 4 rel 12%, 3 rel 5% |
| `krl.Rangkasbitung.3` | Sudirman – Sudirman Baru | 0.5 | 2 rel 100% |
| `krl.Rangkasbitung.3` | Sudirman Baru – Tanah Abang | 2.4 | 2 rel 67%, 4 rel 22%, 3 rel 10% |
| `krl.Rangkasbitung.3` | Tanah Abang – Duri | 3.7 | 2 rel 80%, 3 rel 9%, 5 rel 7%, 4 rel 4% |
| `krl.Rangkasbitung.3` | Duri – Angke | 1.2 | 2 rel 84%, 5 rel 9%, 3 rel 5%, 4 rel 2% |
| `krl.Tangerang.4` | Tangerang – Tanah Tinggi | 1.7 | 2 rel 100% |
| `krl.Tangerang.4` | Tanah Tinggi – Batu Ceper | 2.1 | 2 rel 82%, 3 rel 18% |
| `krl.Tangerang.4` | Batu Ceper – Poris | 1.8 | 2 rel 100% |
| `krl.Tangerang.4` | Poris – Kalideres | 2.5 | 2 rel 100% |
| `krl.Tangerang.4` | Kalideres – Rawa Buaya | 2.2 | 2 rel 100% |
| `krl.Tangerang.4` | Rawa Buaya – Bojong Indah | 1.4 | 2 rel 100% |
| `krl.Tangerang.4` | Bojong Indah – Taman Kota | 2.2 | 2 rel 100% |
| `krl.Tangerang.4` | Taman Kota – Pesing | 1.8 | 2 rel 100% |
| `krl.Tangerang.4` | Pesing – Grogol | 1.9 | 2 rel 100% |
| `krl.Tangerang.4` | Grogol – Duri | 1.9 | 2 rel 80%, 3 rel 8%, 4 rel 6%, 5 rel 5% |
| `krl.Tangerang.5` | Duri – Tanah Abang | 3.7 | 2 rel 89%, 5 rel 6%, 4 rel 4%, 3 rel 1% |
| `krl.Tangerang.5` | Tanah Abang – Sudirman Baru | 2.4 | 2 rel 74%, 4 rel 21%, 3 rel 4% |
| `krl.Tangerang.5` | Sudirman Baru – Sudirman | 0.5 | 2 rel 100% |
| `krl.Tangerang.5` | Sudirman – Manggarai | 3.2 | 2 rel 83%, 5 rel 10%, 3 rel 5%, 4 rel 3% |
| `krl.Tanjung-Priok.6` | Jakarta Kota – Kampung Bandan | 1.7 | 2 rel 67%, 3 rel 33% |
| `krl.Tanjung-Priok.6` | Kampung Bandan – Ancol | 1.9 | 2 rel 99%, 3 rel 1%, 4 rel 0% |
| `krl.Tanjung-Priok.6` | Ancol – Jakarta International Stadium | 2.0 | 4 rel 100% |
| `krl.Tanjung-Priok.6` | Jakarta International Stadium – Tanjung Priok | 2.5 | 2 rel 80%, 4 rel 18%, 3 rel 2% |
| `krl.Cikarang.7` | Kampung Bandan – Angke | 4.4 | 2 rel 90%, 3 rel 10% |
| `krl.Cikarang.7` | Angke – Duri | 1.2 | 2 rel 82%, 5 rel 11%, 3 rel 3%, 4 rel 3% |
| `krl.Cikarang.7` | Duri – Tanah Abang | 3.7 | 2 rel 89%, 5 rel 6%, 4 rel 3%, 3 rel 1% |
| `krl.Cikarang.7` | Tanah Abang – Sudirman Baru | 2.4 | 2 rel 74%, 4 rel 21%, 3 rel 5% |
| `krl.Cikarang.7` | Sudirman Baru – Sudirman | 0.5 | 2 rel 100% |
| `krl.Cikarang.7` | Sudirman – Manggarai | 3.2 | 2 rel 85%, 5 rel 10%, 3 rel 3%, 4 rel 2% |
| `krl.Cikarang.7` | Manggarai – Matraman | 1.4 | 2 rel 100% |
| `krl.Cikarang.7` | Matraman – Jatinegara | 1.3 | 2 rel 49%, 5 rel 34%, 4 rel 17% |
| `krl.Cikarang.7` | Jatinegara – Klender | 3.2 | 4 rel 91%, 5 rel 9% |
| `krl.Cikarang.7` | Klender – Buaran | 2.6 | 4 rel 100% |
| `krl.Cikarang.7` | Buaran – Klender Baru | 1.9 | 4 rel 100% |
| `krl.Cikarang.7` | Klender Baru – Cakung | 1.4 | 4 rel 84%, 3 rel 16% |
| `krl.Cikarang.7` | Cakung – Kranji | 3.1 | 4 rel 89%, 3 rel 11% |
| `krl.Cikarang.7` | Kranji – Bekasi | 2.5 | 4 rel 74%, 2 rel 22%, 3 rel 4% |
| `krl.Cikarang.7` | Bekasi – Bekasi Timur | 2.4 | 2 rel 74%, 3 rel 26% |
| `krl.Cikarang.7` | Bekasi Timur – Tambun | 4.4 | 2 rel 100% |
| `krl.Cikarang.7` | Tambun – Cibitung | 3.2 | 2 rel 100% |
| `krl.Cikarang.7` | Cibitung – Metland Telagamurni | 3.1 | 2 rel 100% |
| `krl.Cikarang.7` | Metland Telagamurni – Cikarang | 3.8 | 2 rel 85%, 4 rel 10%, 3 rel 5% |
| `krl.Cikarang.8` | Jakarta Kota – Kampung Bandan | 1.7 | 2 rel 67%, 3 rel 33% |
| `krl.Cikarang.8` | Kampung Bandan – Rajawali | 1.8 | 2 rel 100% |
| `krl.Cikarang.8` | Rajawali – Kemayoran | 1.9 | 4 rel 95%, 2 rel 4%, 3 rel 1% |
| `krl.Cikarang.8` | Kemayoran – Pasar Senen | 1.5 | 2 rel 66%, 1 rel 18%, 4 rel 10%, 3 rel 5% |
| `krl.Cikarang.8` | Pasar Senen – Gang Sentiong | 1.5 | 2 rel 90%, 1 rel 10% |
| `krl.Cikarang.8` | Gang Sentiong – Kramat | 1.1 | 2 rel 100% |
| `krl.Cikarang.8` | Kramat – Pondok Jati | 1.9 | 2 rel 100% |
| `krl.Cikarang.8` | Pondok Jati – Jatinegara | 1.2 | 2 rel 45%, 4 rel 38%, 3 rel 17% |
| `krl.Cikarang.8` | Jatinegara – Klender | 3.2 | 4 rel 91%, 5 rel 9% |
| `krl.Cikarang.8` | Klender – Buaran | 2.6 | 4 rel 100% |
| `krl.Cikarang.8` | Buaran – Klender Baru | 1.9 | 4 rel 84%, 3 rel 16% |
| `krl.Cikarang.8` | Klender Baru – Cakung | 1.4 | 4 rel 84%, 3 rel 16% |
| `krl.Cikarang.8` | Cakung – Kranji | 3.1 | 4 rel 89%, 3 rel 11% |
| `krl.Cikarang.8` | Kranji – Bekasi | 2.5 | 4 rel 74%, 2 rel 22%, 3 rel 4% |
| `krl.Cikarang.8` | Bekasi – Bekasi Timur | 2.4 | 2 rel 74%, 3 rel 26% |
| `krl.Cikarang.8` | Bekasi Timur – Tambun | 4.4 | 2 rel 100% |
| `krl.Cikarang.8` | Tambun – Cibitung | 3.2 | 2 rel 100% |
| `krl.Cikarang.8` | Cibitung – Metland Telagamurni | 3.1 | 2 rel 100% |
| `krl.Cikarang.8` | Metland Telagamurni – Cikarang | 3.8 | 2 rel 85%, 4 rel 10%, 3 rel 5% |
| `mrt.MRT.9` | Lebak Bulus – Fatmawati | 2.0 | 2 rel 100% |
| `mrt.MRT.9` | Fatmawati – Cipete Raya | 1.8 | 2 rel 100% |
| `mrt.MRT.9` | Cipete Raya – Haji Nawi | 1.3 | 2 rel 100% |
| `mrt.MRT.9` | Haji Nawi – Blok A | 1.2 | 2 rel 100% |
| `mrt.MRT.9` | Blok A – Blok M | 1.3 | 2 rel 100% |
| `mrt.MRT.9` | Blok M – ASEAN | 0.6 | 2 rel 100% |
| `mrt.MRT.9` | ASEAN – Senayan | 1.5 | 2 rel 100% |
| `mrt.MRT.9` | Senayan – Istora | 0.8 | 2 rel 100% |
| `mrt.MRT.9` | Istora – Bendungan Hilir | 1.3 | 2 rel 100% |
| `mrt.MRT.9` | Bendungan Hilir – Setiabudi | 0.8 | 2 rel 100% |
| `mrt.MRT.9` | Setiabudi – Dukuh Atas | 0.9 | 2 rel 100% |
| `mrt.MRT.9` | Dukuh Atas – Bundaran HI | 1.0 | 2 rel 100% |
| `lrtj.LRTJ.10` | Kelapa Gading – Boulevard Utara | 1.5 | 2 rel 93%, 1 rel 7% |
| `lrtj.LRTJ.10` | Boulevard Utara – Boulevard Selatan | 1.3 | 2 rel 100% |
| `lrtj.LRTJ.10` | Boulevard Selatan – Pulomas | 1.2 | 2 rel 100% |
| `lrtj.LRTJ.10` | Pulomas – Equestrian | 0.7 | 2 rel 100% |
| `lrtj.LRTJ.10` | Equestrian – Velodrome | 1.0 | 2 rel 100% |
| `lrtj.LRTJ.10` | Velodrome – Rawamangun | 1.1 | 2 rel 100% |
| `lrtj.LRTJ.10` | Rawamangun – Pramuka | 1.3 | 2 rel 100% |
| `lrtj.LRTJ.10` | Pramuka – Matraman | 1.3 | 2 rel 100% |
| `lrtj.LRTJ.10` | Matraman – Proklamasi | 1.3 | 2 rel 100% |
| `lrtj.LRTJ.10` | Proklamasi – Manggarai | 1.0 | 2 rel 100% |
| `jbdb.Cibubur.11` | Harjamukti – Ciracas | 5.7 | 2 rel 100% |
| `jbdb.Cibubur.11` | Ciracas – Kampung Rambutan | 1.6 | 2 rel 100% |
| `jbdb.Cibubur.11` | Kampung Rambutan – Taman Mini | 2.0 | 2 rel 100% |
| `jbdb.Cibubur.11` | Taman Mini – Cawang | 5.9 | 2 rel 100% |
| `jbdb.Cibubur.11` | Cawang – Ciliwung | 0.8 | 2 rel 100% |
| `jbdb.Cibubur.11` | Ciliwung – Cikoko | 0.8 | 2 rel 100% |
| `jbdb.Cibubur.11` | Cikoko – Pancoran | 2.1 | 2 rel 100% |
| `jbdb.Cibubur.11` | Pancoran – Kuningan | 2.6 | 2 rel 100% |
| `jbdb.Cibubur.11` | Kuningan – Rasuna Said | 0.8 | 2 rel 100% |
| `jbdb.Cibubur.11` | Rasuna Said – Setiabudi | 1.4 | 2 rel 100% |
| `jbdb.Cibubur.11` | Setiabudi – Dukuh Atas | 0.8 | 2 rel 100% |
| `jbdb.Bekasi.12` | Jati Mulya – Bekasi Barat | 3.7 | 2 rel 100% |
| `jbdb.Bekasi.12` | Bekasi Barat – Cikunir 2 | 3.3 | 2 rel 100% |
| `jbdb.Bekasi.12` | Cikunir 2 – Cikunir 1 | 1.3 | 2 rel 100% |
| `jbdb.Bekasi.12` | Cikunir 1 – Jati Bening Baru | 2.7 | 2 rel 100% |
| `jbdb.Bekasi.12` | Jati Bening Baru – Halim | 5.2 | 2 rel 100% |
| `jbdb.Bekasi.12` | Halim – Cawang | 2.0 | 2 rel 100% |
| `jbdb.Bekasi.12` | Cawang – Ciliwung | 0.9 | 2 rel 100% |
| `jbdb.Bekasi.12` | Ciliwung – Cikoko | 0.8 | 2 rel 100% |
| `jbdb.Bekasi.12` | Cikoko – Pancoran | 2.1 | 2 rel 100% |
| `jbdb.Bekasi.12` | Pancoran – Kuningan | 2.6 | 2 rel 100% |
| `jbdb.Bekasi.12` | Kuningan – Rasuna Said | 0.8 | 2 rel 100% |
| `jbdb.Bekasi.12` | Rasuna Said – Setiabudi | 1.4 | 2 rel 100% |
| `jbdb.Bekasi.12` | Setiabudi – Dukuh Atas | 0.8 | 2 rel 100% |
| `kai.KA-GMR.13` | Gambir – Jatinegara | 6.9 | 2 rel 74%, 4 rel 23%, 3 rel 2% |
| `kai.KA-GMR.13` | Jatinegara – Bekasi | 14.7 | 4 rel 78%, 3 rel 19%, 2 rel 3% |
| `kai.KA-GMR.13` | Bekasi – Cikarang | 16.9 | 2 rel 93%, 4 rel 4%, 3 rel 3% |
| `kai.KA-GMR.13` | Cikarang – Karawang | 19.2 | 2 rel 100% |
| `kai.KA-GMR.13` | Karawang – Cikampek | 21.2 | 2 rel 97%, 3 rel 3% |
| `kai.KA-PSE.14` | Pasar Senen – Jatinegara | 5.5 | 2 rel 88%, 3 rel 12%, 1 rel 1% |
| `kai.KA-PSE.14` | Jatinegara – Bekasi | 14.7 | 4 rel 77%, 3 rel 19%, 2 rel 3% |
| `kai.KA-PSE.14` | Bekasi – Cikarang | 16.9 | 2 rel 93%, 4 rel 4%, 3 rel 3% |
| `kai.KA-PSE.14` | Cikarang – Karawang | 19.2 | 2 rel 100% |
| `kai.KA-PSE.14` | Karawang – Cikampek | 21.2 | 2 rel 97%, 3 rel 3% |
| `kai.KA-PG.15` | Sukabumi – Cisaat | 4.8 | 1 rel 97%, 2 rel 3% |
| `kai.KA-PG.15` | Cisaat – Karangtengah | 7.6 | 1 rel 97%, 2 rel 3% |
| `kai.KA-PG.15` | Karangtengah – Cibadak | 4.9 | 1 rel 100% |
| `kai.KA-PG.15` | Cibadak – Parungkuda | 5.4 | 1 rel 100% |
| `kai.KA-PG.15` | Parungkuda – Cicurug | 7.9 | 1 rel 97%, 2 rel 3% |
| `kai.KA-PG.15` | Cicurug – Cigombong | 7.1 | 2 rel 100% |
| `kai.KA-PG.15` | Cigombong – Maseng | 5.5 | 2 rel 100% |
| `kai.KA-PG.15` | Maseng – Batutulis | 9.7 | 2 rel 100% |
| `kai.KA-PG.15` | Batutulis – Bogor Paledang | 3.9 | 2 rel 100% |
