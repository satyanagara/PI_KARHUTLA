# Membangun data/wilayah.txt dari cahyadsn/wilayah (MIT): nama provinsi, kabupaten/kota, dan kecamatan
# menurut kode Kemendagri. Format: kode|nama per baris (level 1-3; desa ada di data/desa.txt).
# Pemakaian: build_wilayah.py keluar.txt
import re, sys, urllib.request

URL = 'https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql'
ROW = re.compile(r"\('(\d{2}(?:\.\d{2}(?:\.\d{2})?)?)','((?:[^'\\]|\\.|'')*)'\)")

request = urllib.request.Request(URL, headers={'User-Agent': 'PemantauKarhutla/1.0 (reference data build)'})
sql = urllib.request.urlopen(request, timeout=180).read().decode('utf-8', 'replace')
rows = {code: name.replace("''", "'").replace("\\'", "'").replace('|', ' ').strip() for code, name in ROW.findall(sql)}
with open(sys.argv[1], 'w', encoding='utf8') as out:
    out.write('\n'.join(f'{code}|{name}' for code, name in sorted(rows.items())))
print(f'{len(rows)} wilayah -> {sys.argv[1]}')
