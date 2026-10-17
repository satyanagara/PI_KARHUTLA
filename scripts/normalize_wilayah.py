# Menormalkan batas wilayah SiPongi (Kementerian Kehutanan) menjadi properti ringkas:
#   n (nama wilayah), p (provinsi), k (kabupaten | provinsi)
# Pemakaian: normalize_wilayah.py kabupaten|provinsi masuk.geojson keluar.json
import json, sys

level, src, dst = sys.argv[1:4]
g = json.load(open(src))
features = [
    {'type': 'Feature', 'properties': {'n': f['properties']['nama_wilayah'], 'p': f['properties']['provinsi'], 'k': level}, 'geometry': f['geometry']}
    for f in g['features'] if f.get('geometry')
]
json.dump({'type': 'FeatureCollection', 'features': features}, open(dst, 'w'), separators=(',', ':'))
print(f'{level}: {len(features)} -> {dst}')
