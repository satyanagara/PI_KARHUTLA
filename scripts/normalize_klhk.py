# Menormalkan GeoJSON dari SIGAP Kementerian Kehutanan menjadi properti ringkas yang dibaca analisis:
#   kawasan : n (nama berawalan jenis), k (konservasi | lindung), t (jenis kawasan)
#   gambut  : n (nama KHG), k (gambut), c (kode KHG)
# Pemakaian: normalize_klhk.py kawasan|gambut masuk.geojson keluar.geojson
import json, re, sys

FUNGSI = {
    100100: ('lindung', 'Hutan Lindung', 'HL'),
    100000: ('konservasi', 'KSA/KPA', 'KSA/KPA'),
    100200: ('konservasi', 'KSA/KPA', 'KSA/KPA'),
    100201: ('konservasi', 'KSA/KPA Perairan', 'KSA/KPA'),
    100210: ('konservasi', 'Cagar Alam', 'CA'),
    100211: ('konservasi', 'Cagar Alam Laut', 'CAL'),
    100220: ('konservasi', 'Suaka Margasatwa', 'SM'),
    100221: ('konservasi', 'Suaka Margasatwa Laut', 'SML'),
    100230: ('konservasi', 'Taman Buru', 'TB'),
    100240: ('konservasi', 'Taman Nasional', 'TN'),
    100241: ('konservasi', 'Taman Nasional Laut', 'TNL'),
    100250: ('konservasi', 'Taman Wisata Alam', 'TWA'),
    100251: ('konservasi', 'Taman Wisata Alam Laut', 'TWAL'),
    100260: ('konservasi', 'Taman Hutan Raya', 'Tahura'),
}
PREFIX = re.compile(r'^(HL|CA|CAL|SM|SML|TB|TN|TNL|TWA|TWAL|Tahura|KSA|KPA|Hutan Lindung|Cagar Alam|Suaka Margasatwa|Taman (Nasional|Wisata|Buru|Hutan))\b\.?', re.I)

def kawasan(props):
    kind, label, abbr = FUNGSI[int(props['fungsikws'])]
    name = re.sub(r'\s*\(sebagian\)\s*$', '', (props.get('namobj') or '').strip(), flags=re.I)
    if name in ('', '-'):
        name = f'{label} (tanpa nama)'
    elif not PREFIX.match(name):
        name = f'{abbr} {name}'
    return {'n': name[:120], 'k': kind, 't': label}

def gambut(props):
    return {'n': (props.get('nama_khg') or 'KHG').strip(), 'k': 'gambut', 'c': props.get('kode_khg', '')}

mode, src, dst = sys.argv[1:4]
g = json.load(open(src))
convert = kawasan if mode == 'kawasan' else gambut
features = [{'type': 'Feature', 'properties': convert(f['properties']), 'geometry': f['geometry']} for f in g['features'] if f.get('geometry')]
json.dump({'type': 'FeatureCollection', 'features': features}, open(dst, 'w'), separators=(',', ':'))
print(f'{mode}: {len(features)} fitur -> {dst}')
