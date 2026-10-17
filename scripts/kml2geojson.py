# Convert GeoServer KML (kmattr description) to GeoJSON. usage: kml2geojson.py in.kml out.geojson
import sys, re, json, html
import xml.etree.ElementTree as ET
NS='{http://www.opengis.net/kml/2.2}'
def ring(el):
    c=el.find(f'.//{NS}coordinates').text.split()
    return [[float(v) for v in p.split(',')[:2]] for p in c]
def polys(pm):
    out=[]
    for pg in pm.iter(f'{NS}Polygon'):
        outer=ring(pg.find(f'{NS}outerBoundaryIs'))
        inners=[ring(i) for i in pg.findall(f'{NS}innerBoundaryIs')]
        out.append([outer]+inners)
    return out
NUM={'fid','no_reg','kode_prov','fungsikws','lskkws','lsktap','shape_length','shape_area','id','luas','luas_ha','objectid'}
feats=[]
for ev,el in ET.iterparse(sys.argv[1]):
    if el.tag==f'{NS}Placemark':
        d=el.find(f'{NS}description')
        props={}
        if d is not None and d.text:
            for k,v in re.findall(r'atr-name">([^<]*)</span>:</strong> <span class="atr-value">(.*?)</span>',d.text,flags=re.S):
                v=html.unescape(v)
                if k in NUM:
                    try: v=float(v); v=int(v) if v.is_integer() else v
                    except: pass
                props[k]=v
        props.pop('geom_invalid',None)
        p=polys(el)
        if p: feats.append({'type':'Feature','properties':props,'geometry':{'type':'MultiPolygon','coordinates':p}})
        el.clear()
json.dump({'type':'FeatureCollection','features':feats},open(sys.argv[2],'w'),separators=(',',':'))
print(len(feats))
