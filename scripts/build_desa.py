# Membangun data/desa.txt dari cahyadsn/wilayah_boundaries (MIT): kode desa Kemendagri (adm4) + titik tengah.
# Format: kode|nama|lat*1e5|lon*1e5 per baris. Kode ini dipakai untuk API prakiraan cuaca BMKG.
# Pemakaian: build_desa.py keluar.txt   (mengunduh ±500 berkas SQL dari GitHub)
import json, re, sys, urllib.request

REPO = 'cahyadsn/wilayah_boundaries'
ROW = re.compile(r"\('(\d{2}\.\d{2}\.\d{2}\.\d{4})','((?:[^'\\]|\\.|'')*)',(-?[\d.]+|NULL),(-?[\d.]+|NULL),")

def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'PemantauKarhutla/1.0 (reference data build)'})
    return urllib.request.urlopen(request, timeout=180).read()

tree = json.loads(get(f'https://api.github.com/repos/{REPO}/git/trees/HEAD?recursive=1'))['tree']
paths = [item['path'] for item in tree if item['path'].startswith('db/kel/') and item['type'] == 'blob']
rows = {}
for path in paths:
    sql = get(f'https://raw.githubusercontent.com/{REPO}/main/{path}').decode('utf-8', 'replace')
    for code, name, lat, lon in ROW.findall(sql):
        if lat == 'NULL' or lon == 'NULL':
            continue
        name = name.replace("''", "'").replace("\\'", "'").replace('|', ' ').strip()
        rows[code] = (name, round(float(lat) * 1e5), round(float(lon) * 1e5))
with open(sys.argv[1], 'w', encoding='utf8') as out:
    out.write('\n'.join(f'{code}|{name}|{lat}|{lon}' for code, (name, lat, lon) in sorted(rows.items())))
print(f'{len(rows)} desa -> {sys.argv[1]}')
