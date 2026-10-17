# Mengubah dump GeoNames ID.txt menjadi berkas ringkas: nama|lat*1e4|lon*1e4|rank|populasi|provinsi
# rank 3 = ibu kota/provinsi, 2 = kabupaten/kecamatan, 1 = desa/kampung.
import sys

# Kode admin1 GeoNames untuk Indonesia -> nama provinsi.
PROVINSI = {
    '01': 'Aceh', '02': 'Bali', '03': 'Bengkulu', '04': 'DKI Jakarta', '05': 'Jambi', '07': 'Jawa Tengah',
    '08': 'Jawa Timur', '10': 'DI Yogyakarta', '11': 'Kalimantan Barat', '12': 'Kalimantan Selatan',
    '13': 'Kalimantan Tengah', '14': 'Kalimantan Timur', '15': 'Lampung', '17': 'Nusa Tenggara Barat',
    '18': 'Nusa Tenggara Timur', '21': 'Sulawesi Tengah', '22': 'Sulawesi Tenggara', '24': 'Sumatera Barat',
    '26': 'Sumatera Utara', '28': 'Maluku', '29': 'Maluku Utara', '30': 'Jawa Barat', '31': 'Sulawesi Utara',
    '32': 'Sumatera Selatan', '33': 'Banten', '34': 'Gorontalo', '35': 'Kepulauan Bangka Belitung', '36': 'Papua',
    '37': 'Riau', '38': 'Sulawesi Selatan', '39': 'Papua Barat', '40': 'Kepulauan Riau', '41': 'Sulawesi Barat',
    '42': 'Kalimantan Utara', 'PD': 'Papua Barat Daya', 'PT': 'Papua Tengah', 'PE': 'Papua Pegunungan', 'PS': 'Papua Selatan',
}

SKIP = {'PPLQ', 'PPLH', 'PPLW', 'PPLCH'}
RANK = {'PPLC': 3, 'PPLA': 3, 'PPLA2': 2, 'PPLA3': 2}

src, dst = sys.argv[1], sys.argv[2]
seen, rows = set(), []
for line in open(src, encoding='utf8'):
    c = line.rstrip('\n').split('\t')
    if c[6] != 'P' or c[7] in SKIP:
        continue
    lat, lon = round(float(c[4]), 4), round(float(c[5]), 4)
    if not (-11.5 <= lat <= 6.5 and 94 <= lon <= 142):
        continue
    key = (c[1].lower(), round(lat, 2), round(lon, 2))
    if key in seen:
        continue
    seen.add(key)
    name = c[1].replace('|', ' ').strip()
    if name.endswith(' City'):
        name = 'Kota ' + name[:-5]
    rows.append((name, lat, lon, RANK.get(c[7], 1), int(c[14] or 0), PROVINSI.get(c[10], '')))

rows.sort(key=lambda r: (r[1], r[2]))
with open(dst, 'w', encoding='utf8') as out:
    out.write('\n'.join(f'{n}|{round(la * 1e4)}|{round(lo * 1e4)}|{r}|{p or ""}|{prov}' for n, la, lo, r, p, prov in rows))
print(f'{len(rows)} permukiman -> {dst}')
