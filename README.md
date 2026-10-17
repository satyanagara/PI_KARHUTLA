# Pemantau Independen KARHUTLA

Situs publik untuk memantau titik panas kebakaran hutan dan lahan (karhutla) di Indonesia dari satelit NASA FIRMS, lengkap dengan:

- perkiraan **jalur dan tingkat bahaya asap** (angin + PM2.5 model CAMS, kategori ISPU),
- **kedekatan api ke permukiman** (±257 ribu desa/kota),
- api **di dalam atau dekat kawasan konservasi dan hutan lindung** menurut peta resmi Kawasan Hutan Kementerian Kehutanan,
- api **di lahan gambut** (Kesatuan Hidrologis Gambut),
- daftar **kluster prioritas** dan unduhan CSV,
- untuk warga: **status risiko** dalam bahasa sederhana beserta anjuran kesehatan sesuai ISPU, **cek lokasi** (cari nama daerah atau pakai lokasi perangkat), dan daftar **kota di jalur asap**.

API publik: `GET /api/hotspots?source=&days=`, `GET /api/cari?q=` (cari nama daerah), `GET /api/lokasi?lat=&lon=&source=&days=` (risiko di satu titik).

## Arsitektur

```
browser ──► server Node (server/index.ts) ──► NASA FIRMS (MAP_KEY rahasia, hanya di server)
                 │                          └► Open-Meteo (angin & PM2.5)
                 ├─ /api/hotspots            laporan siap pakai, di-cache 10 menit per sumber × periode
                 ├─ /data/kawasan-hutan.json batas kawasan hutan untuk lapisan peta
                 ├─ /data/gambut.json        batas KHG untuk lapisan peta
                 └─ dist/                    halaman web hasil build Vite
```

Semua analisis dijalankan di server dan di-cache, jadi berapa pun jumlah pengunjung, server hanya memanggil FIRMS dan Open-Meteo beberapa kali per 10 menit. Data permukiman dan poligon kawasan detail tidak pernah dikirim ke browser.

## Pengembangan dengan Podman

Buat `.env.local` berisi MAP_KEY FIRMS (gratis di <https://firms.modaps.eosdis.nasa.gov/api/area/>):

```bash
echo "FIRMS_MAP_KEY=kunci_anda" > .env.local
podman compose up dev        # buka http://localhost:5173
```

Kode di folder proyek di-mount ke container: perubahan di `src/` langsung dimuat ulang oleh Vite, perubahan di `server/` atau `data/` memulai ulang server API (`scripts/dev-api.mjs`, berbasis polling karena event berkas dari host tidak menembus mount Podman). `node_modules` container disimpan di volume terpisah dari `node_modules` host.

Tanpa container: `npm install && npm run dev` (butuh Node.js 22.18+).

## Produksi: amukapi.santaralabs.ai

Situs publik berjalan di server aplikasi `10.129.90.36` (IP publik `103.138.205.33`):

- container Docker `pemantau-karhutla` hanya mendengarkan `127.0.0.1:8787`, cache laporan BNPB di volume `pemantau-karhutla-cache`;
- Nginx di server yang sama menerima HTTP/HTTPS dan meneruskan ke container ([deploy/nginx/](deploy/nginx/));
- sertifikat Let's Encrypt diterbitkan dan diperpanjang oleh certbot di server itu.

```bash
npm run deploy                  # kirim kode, build image di server, ganti container
bash scripts/enable-https.sh    # sekali saja: sertifikat + konfigurasi HTTPS (butuh DNS A amukapi -> 103.138.205.33)
```

Kredensial SSH dibaca dari `secrets/server.txt` (tidak di-commit). Server hanya menerima `FIRMS_MAP_KEY` di `~/pemantau-karhutla/.env`.

## Produksi dengan Podman

```bash
podman compose up -d app     # build Containerfile lalu jalankan di http://localhost:8787
```

atau manual:

```bash
podman build -t pemantau-karhutla -f Containerfile .
podman run -d --name karhutla -p 8787:8787 --env-file .env.local --restart unless-stopped pemantau-karhutla
```

Image hanya berisi `dist/`, `data/`, `server/`, dan dua modul bersama dari `src/`; server tidak memerlukan paket npm saat berjalan dan berjalan sebagai user non-root. Pasang HTTPS di reverse proxy di depannya dan setel `TRUST_PROXY=1`.

### Variabel lingkungan

| Nama | Wajib | Keterangan |
|---|---|---|
| `FIRMS_MAP_KEY` | ya | MAP_KEY NASA FIRMS. Jangan dimasukkan ke kode atau repo. |
| `PORT` | tidak | Port server, bawaan `8787`. |
| `HOST` | tidak | Alamat bind, bawaan `0.0.0.0`. |
| `TRUST_PROXY` | tidak | Isi `1` bila di belakang reverse proxy agar pembatas laju memakai IP asli dari `X-Real-IP` (atau entri terakhir `X-Forwarded-For`). |
| `RATE_LIMIT_PER_MINUTE` | tidak | Batas permintaan API per IP per menit, bawaan `60`. |

Server menyetel header keamanan (CSP, `nosniff`, `frame-ancestors 'none'`), kompresi Brotli/gzip, ETag, dan cache statis.

## Data rujukan

Berkas di `data/` dibaca server saat start; perbarui dengan `npm run data` (unduhan ±860 MB) lalu restart server.

| Berkas | Isi | Sumber |
|---|---|---|
| `settlements.txt` | 257 ribu permukiman | GeoNames, dump `ID` (CC BY 4.0) |
| `kawasan-hutan.json` (server) / `kawasan-hutan-web.json` (peta) | Kawasan konservasi (TN, CA, SM, TWA, Tahura, TB, KSA/KPA) dan hutan lindung | IGT Kawasan Hutan 1:250.000 status Juni 2026, layer `sigap:kwshutan_ar_250k_jun2026` |
| `gambut.json` (server) / `gambut-web.json` (peta) | 865 Kesatuan Hidrologis Gambut | KHG 1:250.000, layer `sigap:khg_ar_250k` |

Kawasan hutan dan KHG diunduh dari GeoServer SIGAP Kementerian Kehutanan (Ditjen Planologi Kehutanan), `https://sigap.kehutanan.go.id/sigap-forge-geoserver-2026/sigap/wms`. Lisensi tidak dicantumkan pada metadata; data disebut sebagai milik Kementerian Kehutanan pada atribusi.

## Atribusi

Hotspot: NASA FIRMS (VIIRS 375 m) · Kawasan hutan & KHG: Kementerian Kehutanan (SIGAP) · Angin & kualitas udara: Open-Meteo (model CAMS, penggunaan non-komersial) · Permukiman: GeoNames · Peta dasar: Esri World Light Gray Canvas.

Hotspot adalah indikasi anomali termal, bukan konfirmasi kebakaran. Kualitas udara berasal dari model, bukan alat ukur lapangan.
