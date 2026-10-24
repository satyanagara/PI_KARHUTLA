#!/usr/bin/env bash
# Membangun ulang data rujukan di data/ (dibaca oleh server):
#   settlements.txt                      permukiman Indonesia dari GeoNames (CC BY 4.0)
#   kawasan-hutan.json / -web.json       kawasan konservasi & hutan lindung, IGT Kawasan Hutan 1:250.000
#   gambut.json / gambut-web.json        Kesatuan Hidrologis Gambut (KHG) 1:250.000
#   lapisan-*.json                       lapisan peta area penting (hanya tampilan): moratorium PIPPIB 2026, Kawasan
#                                        Ekosistem Esensial, hutan adat, mangrove 2024, rawan karhutla 2025 (kelas tinggi)
#   provinsi.json / kabupaten.json       batas wilayah (SiPongi, Kementerian Kehutanan); provinsi = penyaring wilayah RI
#   desa.txt                             kode desa Kemendagri + titik tengah (cahyadsn/wilayah_boundaries, MIT) untuk API BMKG
#   wilayah.txt                          nama provinsi/kabupaten/kecamatan menurut kode Kemendagri (cahyadsn/wilayah, MIT)
# Kawasan hutan, KHG, dan lapisan area penting bersumber dari SIGAP Kementerian Kehutanan.
# Butuh: curl, unzip, python3, npx (mapshaper diunduh otomatis). Unduhan SIGAP ±5,7 GB (lapisan area penting ±4,8 GB).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/data"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
MAPSHAPER="npx -y mapshaper@0.6.102"
UA="Mozilla/5.0 (PemantauKarhutla/1.0; reference data build)"

echo "Mengunduh GeoNames ID..."
curl -sSf -o "$WORK/ID.zip" https://download.geonames.org/export/dump/ID.zip
unzip -q -o "$WORK/ID.zip" ID.txt -d "$WORK"
python3 -I "$ROOT/scripts/build_settlements.py" "$WORK/ID.txt" "$OUT/settlements.txt"

# WFS SIGAP dinonaktifkan; WMS GetMap berformat KML mengembalikan vektor resolusi penuh beserta atributnya.
WMS="https://sigap.kehutanan.go.id/sigap-forge-geoserver-2026/sigap/wms"
BASE="service=WMS&version=1.1.1&request=GetMap&styles=&srs=EPSG:4326&bbox=94.9,-11.1,141.1,6.1&width=9240&height=3440&format=application/vnd.google-earth.kml%2Bxml&format_options=kmscore:100;kmattr:true"
# fungsikws: 100100 hutan lindung; 1000xx/1002xx KSA/KPA (CA, SM, TB, TN, TWA, Tahura, termasuk perairan).
FUNGSI="fungsikws IN (100100,100000,100200,100210,100220,100230,100240,100250,100260,100201,100211,100221,100241,100251)"

echo "Mengunduh Kawasan Hutan dari SIGAP (±600 MB)..."
curl -sSf --max-time 1800 -A "$UA" -o "$WORK/kawasan.kml" \
  "$WMS?$BASE&layers=sigap:kwshutan_ar_250k_jun2026&CQL_FILTER=$(python3 -I -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$FUNGSI")"
echo "Mengunduh KHG gambut dari SIGAP (±260 MB)..."
curl -sSf --max-time 1800 -A "$UA" -o "$WORK/gambut.kml" "$WMS?$BASE&layers=sigap:khg_ar_250k"

python3 -I "$ROOT/scripts/kml2geojson.py" "$WORK/kawasan.kml" "$WORK/kawasan.geojson"
python3 -I "$ROOT/scripts/kml2geojson.py" "$WORK/gambut.kml" "$WORK/gambut.geojson"
python3 -I "$ROOT/scripts/normalize_klhk.py" kawasan "$WORK/kawasan.geojson" "$WORK/kawasan-norm.geojson"
python3 -I "$ROOT/scripts/normalize_klhk.py" gambut "$WORK/gambut.geojson" "$WORK/gambut-norm.geojson"

# Versi server (analisis, detail ±80 m) dan versi web (tampilan peta, ±400 m).
(cd "$WORK" && \
  NODE_OPTIONS=--max-old-space-size=8192 $MAPSHAPER kawasan-norm.geojson -simplify interval=80 keep-shapes -o kawasan-server.json format=geojson precision=0.0001 && \
  NODE_OPTIONS=--max-old-space-size=8192 $MAPSHAPER kawasan-norm.geojson -simplify interval=400 keep-shapes -filter-slivers min-area=0.05km2 -o kawasan-web.json format=geojson precision=0.001 && \
  $MAPSHAPER gambut-norm.geojson -dissolve2 c copy-fields=n,k -simplify interval=120 keep-shapes -clean -o gambut-server.json format=geojson precision=0.0001 && \
  $MAPSHAPER gambut-norm.geojson -dissolve2 c copy-fields=n,k -simplify interval=600 keep-shapes -clean -o gambut-web.json format=geojson precision=0.001)

# Lapisan area penting: KML dibaca streaming (berkas sumber sampai ±2,3 GB) lalu digabung per kelas dan disederhanakan.
for spec in "kee kee_ar_50k" "adat hutan_adat_50k_092025" "pippib pippib_2026_i_250k" "mangrove mangrove_ar_25k_24" "rawan rawan_karhutla_ar_250k_2025"; do
  set -- $spec
  echo "Mengunduh lapisan $2 dari SIGAP..."
  curl -sSf --max-time 2400 -A "$UA" -o "$WORK/$1.kml" "$WMS?$BASE&layers=sigap:$2"
  python3 -I "$ROOT/scripts/kml_layer.py" "$1" "$WORK/$1.kml" "$WORK/$1.geojson"
  rm -f "$WORK/$1.kml"
done
(cd "$WORK" && export NODE_OPTIONS=--max-old-space-size=10000 && \
  $MAPSHAPER kee.geojson -simplify interval=60 keep-shapes -o "$OUT/lapisan-kee.json" format=geojson precision=0.0001 && \
  $MAPSHAPER adat.geojson -simplify interval=60 keep-shapes -o "$OUT/lapisan-adat.json" format=geojson precision=0.0001 && \
  $MAPSHAPER pippib.geojson -simplify interval=500 -dissolve2 c -filter-slivers min-area=0.2km2 -clean -o "$OUT/lapisan-pippib.json" format=geojson precision=0.001 && \
  $MAPSHAPER rawan.geojson -simplify interval=600 -dissolve2 c -filter-slivers min-area=0.2km2 -clean -o "$OUT/lapisan-rawan.json" format=geojson precision=0.001 && \
  $MAPSHAPER mangrove.geojson -simplify interval=250 -dissolve2 c -filter-slivers min-area=0.2km2 -clean -o "$OUT/lapisan-mangrove.json" format=geojson precision=0.001)

echo "Mengunduh batas provinsi dan kabupaten/kota dari SiPongi..."
for LEVEL in provinsi kabupaten; do
  curl -sSf --compressed --max-time 300 -A "$UA" -o "$WORK/$LEVEL.geojson" "https://opsroom-sipongi.gakkum.kehutanan.go.id/api/boundaries?level=$LEVEL"
  python3 -I "$ROOT/scripts/normalize_wilayah.py" "$LEVEL" "$WORK/$LEVEL.geojson" "$OUT/$LEVEL.json"
done

echo "Mengunduh kode desa Kemendagri + titik tengah (cahyadsn/wilayah_boundaries, MIT)..."
python3 -I "$ROOT/scripts/build_desa.py" "$OUT/desa.txt"
curl -sSf -o "$OUT/LICENSE-wilayah-boundaries.txt" https://raw.githubusercontent.com/cahyadsn/wilayah_boundaries/main/LICENSE
python3 -I "$ROOT/scripts/build_wilayah.py" "$OUT/wilayah.txt"
curl -sSf -o "$OUT/LICENSE-wilayah.txt" https://raw.githubusercontent.com/cahyadsn/wilayah/master/LICENSE

# Buang fitur yang geometrinya hilang karena terlalu kecil setelah penyederhanaan.
drop_empty() {
  python3 -I -c 'import json,sys; g=json.load(open(sys.argv[1])); g["features"]=[f for f in g["features"] if f.get("geometry")]; json.dump(g,open(sys.argv[2],"w"),separators=(",",":"))' "$1" "$2"
}
drop_empty "$WORK/kawasan-server.json" "$OUT/kawasan-hutan.json"
drop_empty "$WORK/kawasan-web.json" "$OUT/kawasan-hutan-web.json"
drop_empty "$WORK/gambut-server.json" "$OUT/gambut.json"
drop_empty "$WORK/gambut-web.json" "$OUT/gambut-web.json"

ls -la "$OUT"
