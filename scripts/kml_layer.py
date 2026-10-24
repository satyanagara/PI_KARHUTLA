# Mengubah KML GeoServer SIGAP menjadi GeoJSON ringkas untuk lapisan peta, secara streaming (berkas sumber bisa >2 GB).
# Hanya atribut yang ditampilkan yang disimpan, koordinat dibulatkan ke 0,0001° (±11 m), dan kelas yang tidak dipakai dibuang.
#   kee      : n (nama), t (jenis Kawasan Ekosistem Esensial)
#   adat     : n (masyarakat hukum adat), s (nomor SK penetapan)
#   pippib   : c (primer | gambut | kawasan)  Peta Indikatif Penghentian Pemberian Izin Baru
#   mangrove : c (lebat | sedang | jarang)
#   rawan    : c (tinggi | sangat-tinggi)     kelas rendah/sedang dibuang
# Pemakaian: kml_layer.py <mode> masuk.kml keluar.geojson
import html
import json
import re
import sys
import xml.etree.ElementTree as ET

NS = '{http://www.opengis.net/kml/2.2}'
ATTR = re.compile(r'atr-name">([^<]*)</span>:</strong> <span class="atr-value">(.*?)</span>', re.S)


def kee(p):
    return {'n': p.get('nama', '').strip() or 'Kawasan Ekosistem Esensial', 't': p.get('type_kee', '').strip()}


def adat(p):
    return {'n': (p.get('nama_mha') or p.get('namobj') or 'Hutan adat').strip(), 's': p.get('nomor_sk', '').strip()}


def pippib(p):
    return {'c': {'PIPPIB PRIMER': 'primer', 'PIPPIB GAMBUT': 'gambut', 'PIPPIB KAWASAN': 'kawasan'}.get(p.get('pippib', '').strip())}


def mangrove(p):
    return {'c': {'MANGROVE LEBAT': 'lebat', 'MANGROVE SEDANG': 'sedang', 'MANGROVE JARANG': 'jarang'}.get(p.get('kttj', '').strip())}


def rawan(p):
    return {'c': {'Tinggi': 'tinggi', 'Sangat Tinggi': 'sangat-tinggi'}.get(p.get('kelas', '').strip())}


MODES = {'kee': kee, 'adat': adat, 'pippib': pippib, 'mangrove': mangrove, 'rawan': rawan}


def ring(el):
    coords = el.find(f'.//{NS}coordinates').text.split()
    points = []
    for item in coords:
        lon, lat = item.split(',')[:2]
        point = [round(float(lon), 4), round(float(lat), 4)]
        if not points or points[-1] != point:
            points.append(point)
    return points


def polygons(placemark):
    out = []
    for polygon in placemark.iter(f'{NS}Polygon'):
        outer = ring(polygon.find(f'{NS}outerBoundaryIs'))
        if len(outer) < 4:
            continue
        out.append([outer] + [r for r in (ring(i) for i in polygon.findall(f'{NS}innerBoundaryIs')) if len(r) >= 4])
    return out


mode, src, dst = sys.argv[1:4]
convert = MODES[mode]
kept = dropped = 0
with open(dst, 'w') as out:
    out.write('{"type":"FeatureCollection","features":[')
    for _, el in ET.iterparse(src):
        if el.tag != f'{NS}Placemark':
            continue
        description = el.find(f'{NS}description')
        raw = {k: html.unescape(v) for k, v in ATTR.findall(description.text or '')} if description is not None else {}
        props = convert(raw)
        geometry = polygons(el)
        el.clear()
        if not geometry or ('c' in props and props['c'] is None):
            dropped += 1
            continue
        out.write((',' if kept else '') + json.dumps({'type': 'Feature', 'properties': props, 'geometry': {'type': 'MultiPolygon', 'coordinates': geometry}}, separators=(',', ':')))
        kept += 1
    out.write(']}')
print(f'{mode}: {kept} fitur disimpan, {dropped} dibuang -> {dst}')
