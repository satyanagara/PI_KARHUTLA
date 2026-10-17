#!/usr/bin/env bash
# Membangun ulang data rujukan di data/ (dibaca oleh server):
#   settlements.txt                      permukiman Indonesia dari GeoNames (CC BY 4.0)
#   kawasan-hutan.json / -web.json       kawasan konservasi & hutan lindung, IGT Kawasan Hutan 1:250.000
#   gambut.json / gambut-web.json        Kesatuan Hidrologis Gambut (KHG) 1:250.000
# Kawasan hutan dan KHG bersumber dari SIGAP Kementerian Kehutanan (Ditjen Planologi Kehutanan).
# Butuh: curl, unzip, python3, npx (mapshaper diunduh otomatis). Unduhan SIGAP ±860 MB.
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

# Buang fitur yang geometrinya hilang karena terlalu kecil setelah penyederhanaan.
drop_empty() {
  python3 -I -c 'import json,sys; g=json.load(open(sys.argv[1])); g["features"]=[f for f in g["features"] if f.get("geometry")]; json.dump(g,open(sys.argv[2],"w"),separators=(",",":"))' "$1" "$2"
}
drop_empty "$WORK/kawasan-server.json" "$OUT/kawasan-hutan.json"
drop_empty "$WORK/kawasan-web.json" "$OUT/kawasan-hutan-web.json"
drop_empty "$WORK/gambut-server.json" "$OUT/gambut.json"
drop_empty "$WORK/gambut-web.json" "$OUT/gambut-web.json"

ls -la "$OUT"
