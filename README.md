# Pemantau Independen KARHUTLA

Situs publik untuk memantau kebakaran hutan dan lahan (karhutla) di Indonesia: titik panas satelit, perkiraan sebaran asap, dan risikonya bagi warga, kawasan hutan, serta lahan gambut.

**Situs:** <https://amukapi.santaralabs.ai>

> Proyek ini masih purwarupa dan sengaja dibuka agar bisa diperbaiki bersama. Lihat bagian [Berkontribusi](#berkontribusi).

## Fitur

- **Titik panas** dari NASA FIRMS (VIIRS 375 m) atau data resmi BRIN/LAPAN lewat SiPongi; hanya titik di wilayah Indonesia yang dihitung.
- **Perkiraan jalur dan tingkat bahaya asap**: arah angin dan PM2.5 model CAMS (Open-Meteo), kategori ISPU.
- **Kedekatan api** ke ±257 ribu permukiman, ke kawasan konservasi dan hutan lindung (peta resmi Kawasan Hutan Kementerian Kehutanan), serta ke lahan gambut (KHG).
- **Untuk warga**: status risiko dalam bahasa sederhana beserta anjuran kesehatan, cek lokasi (cari nama daerah atau pakai lokasi perangkat), dan daftar kota di jalur asap.
- **Laporan lapangan Satgas Karhutla BNPB** per provinsi prioritas.
- **Ringkasan per kabupaten/kota**, daftar wilayah api prioritas, dan unduhan CSV.

API publik (JSON):

| Endpoint | Isi |
|---|---|
| `GET /api/hotspots?source=&days=` | Laporan lengkap: titik panas, kluster, asap, ringkasan |
| `GET /api/cari?q=` | Cari nama kota/desa |
| `GET /api/lokasi?lat=&lon=&source=&days=` | Risiko di satu titik |
| `GET /api/laporan-bnpb` | Laporan lapangan BNPB |

`source`: `VIIRS_NOAA21_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_SNPP_NRT`, atau `BRIN_LAPAN`. `days`: `1`, `3`, atau `5`.

## Arsitektur

```
browser ──► server Node (server/index.ts) ──► NASA FIRMS / SiPongi (hotspot)
                 │                          ├► Open-Meteo (angin & PM2.5)
                 │                          └► BNPB (laporan lapangan)
                 ├─ /api/*                   analisis siap pakai, di-cache di server
                 ├─ /data/*.json             batas kawasan hutan & KHG untuk lapisan peta
                 └─ dist/                    halaman web hasil build Vite
```

Semua analisis dijalankan dan di-cache di server (10 menit untuk hotspot, 15 menit untuk laporan BNPB), sehingga berapa pun jumlah pengunjung, sumber data hanya dipanggil beberapa kali per periode. MAP_KEY FIRMS tidak pernah dikirim ke browser, begitu juga data permukiman dan poligon kawasan resolusi penuh.

| Folder | Isi |
|---|---|
| `src/` | Halaman web (TypeScript, Leaflet) dan modul analisis bersama (`risk.ts`) |
| `server/` | Server HTTP tanpa dependensi npm, dijalankan langsung oleh Node 22.18+ |
| `data/` | Data rujukan (permukiman, kawasan hutan, KHG, batas wilayah) |
| `scripts/` | Pembangun data rujukan, deploy, HTTPS, firewall |
| `deploy/` | Konfigurasi Nginx dan templat kredensial server |

## Menjalankan secara lokal

Dapatkan MAP_KEY FIRMS gratis di <https://firms.modaps.eosdis.nasa.gov/api/area/>, lalu:

```bash
echo "FIRMS_MAP_KEY=kunci_anda" > .env.local
podman compose up dev        # atau docker compose; buka http://localhost:5173
```

Kode di-mount ke container: perubahan di `src/` langsung dimuat ulang oleh Vite, perubahan di `server/` atau `data/` memulai ulang server API (`scripts/dev-api.mjs`, berbasis polling agar bekerja di mount container).

Tanpa container: `npm install && npm run dev` (Node.js 22.18+).

## Menjalankan di server sendiri

Image produksi hanya berisi `dist/`, `data/`, `server/`, dan dua modul bersama dari `src/`; tidak memerlukan paket npm saat berjalan dan berjalan sebagai user non-root.

```bash
podman build -t pemantau-karhutla -f Containerfile .
podman run -d --name karhutla -p 127.0.0.1:8787:8787 --env-file .env.local \
  -e TRUST_PROXY=1 -v karhutla-cache:/app/.cache --restart unless-stopped pemantau-karhutla
```

Letakkan reverse proxy dengan HTTPS di depannya; contoh konfigurasi Nginx ada di [deploy/nginx/](deploy/nginx/).

### Deploy otomatis lewat SSH (opsional)

Salin [deploy/server.example.txt](deploy/server.example.txt) ke `secrets/server.txt` dan isi data server Anda. Folder `secrets/` dan berkas `.env*` diabaikan oleh git dan tidak ikut ke image.

```bash
npm run deploy                   # push ke GitHub, git pull di server, build image, ganti container
PESAN="fix: ..." npm run deploy  # sekaligus git add + commit bila masih ada perubahan
bash scripts/enable-https.sh     # sekali: sertifikat Let's Encrypt + konfigurasi Nginx HTTPS
```

Deploy selalu lewat git: perubahan harus sudah di-commit dan di-push, server menjalankan `git pull --ff-only` dan memastikan commit-nya sama dengan lokal. Di server hanya `FIRMS_MAP_KEY` yang ditulis ke `.env`.

[scripts/tutup-port-publik.sh](scripts/tutup-port-publik.sh) membantu menutup port lain dari internet (termasuk port Docker) dengan ufw, lengkap dengan pemulihan otomatis bila akses terputus.

### Variabel lingkungan

| Nama | Wajib | Keterangan |
|---|---|---|
| `FIRMS_MAP_KEY` | ya | MAP_KEY NASA FIRMS. Jangan dimasukkan ke kode atau repo. |
| `PORT` | tidak | Port server, bawaan `8787`. |
| `HOST` | tidak | Alamat bind, bawaan `0.0.0.0`. |
| `TRUST_PROXY` | tidak | Isi `1` bila di belakang reverse proxy agar pembatas laju memakai IP asli dari `X-Real-IP`. |
| `RATE_LIMIT_PER_MINUTE` | tidak | Batas permintaan API per IP per menit, bawaan `60`. |
| `CACHE_DIR` | tidak | Folder salinan laporan BNPB terakhir, bawaan direktori sementara sistem. |

## Data rujukan

Berkas di `data/` dibaca server saat start; bangun ulang dengan `npm run data` (unduhan ±860 MB).

| Berkas | Isi | Sumber |
|---|---|---|
| `settlements.txt` | 257 ribu permukiman | GeoNames, dump `ID` (CC BY 4.0) |
| `kawasan-hutan.json` / `-web.json` | Kawasan konservasi (TN, CA, SM, TWA, Tahura, TB, KSA/KPA) dan hutan lindung | IGT Kawasan Hutan 1:250.000 status Juni 2026, SIGAP Kementerian Kehutanan |
| `gambut.json` / `gambut-web.json` | 865 Kesatuan Hidrologis Gambut | KHG 1:250.000, SIGAP Kementerian Kehutanan |
| `provinsi.json` / `kabupaten.json` | Batas provinsi dan kabupaten/kota | SiPongi, Kementerian Kehutanan |

Data pemerintah tidak mencantumkan lisensi pada metadatanya; sumbernya disebut pada atribusi.

## Berkontribusi

Ini masih versi minimal. Masukan yang paling dibutuhkan:

- **Kebakaran hutan & gambut**: indikator atau data penting yang belum ada.
- **Kesehatan**: ketepatan dan kejelasan anjuran kesehatan per kategori ISPU.
- **GIS & pemodelan**: model sebaran asap yang lebih baik daripada kerucut 6 jam searah angin.
- **Warga di daerah terdampak**: informasi yang paling dibutuhkan saat asap datang.
- **Pengembang**: perbaikan kode, aksesibilitas, kinerja, dan pengujian.

Silakan buka *issue* untuk ide atau laporan masalah, atau kirim *pull request*. Pesan commit memakai bahasa Indonesia dengan awalan conventional commit (`feat:`, `fix:`, `docs:`, ...).

## Melaporkan celah keamanan

Mohon jangan membuka *issue* publik untuk celah keamanan; hubungi pemelihara proyek secara pribadi lewat GitHub.

## Lisensi

Hak cipta © 2026 Ginanjar dan para kontributor.

Kode sumber dirilis di bawah [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). Anda bebas memakai, mempelajari, mengubah, dan membagikannya; bila versi yang diubah dijalankan sebagai layanan web untuk orang lain, kode sumbernya juga wajib dibuka dengan lisensi yang sama. Data rujukan di `data/` mengikuti ketentuan sumber masing-masing (lihat [Data rujukan](#data-rujukan)).

## Atribusi

Hotspot: NASA FIRMS (VIIRS 375 m), BRIN/LAPAN via SiPongi · Laporan lapangan: BNPB · Kawasan hutan, KHG & batas wilayah: Kementerian Kehutanan · Angin & kualitas udara: Open-Meteo (model CAMS, penggunaan non-komersial) · Permukiman: GeoNames · Peta dasar: Esri World Light Gray Canvas.

Hotspot adalah indikasi anomali termal, bukan konfirmasi kebakaran. Kualitas udara berasal dari model, bukan alat ukur lapangan. Gunakan sebagai peringatan dini, bukan pengganti informasi resmi.
