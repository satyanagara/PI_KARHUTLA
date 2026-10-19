// Wilayah administrasi resmi Kemendagri: desa/kelurahan (data/desa.txt, dengan titik tengah) dan nama
// provinsi/kabupaten/kecamatan (data/wilayah.txt). Dipakai untuk pencarian nama daerah, label lokasi,
// dan kode desa API BMKG. Sumber: cahyadsn/wilayah dan cahyadsn/wilayah_boundaries (MIT).
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { distanceKm, foldSpelling } from '../src/risk.ts'

export type Place = {
  code: string
  level: 2 | 3 | 4
  name: string
  // Label lengkap untuk ditampilkan, mis. "Desa Situmandala, Kec. Rancah, Kab. Ciamis, Jawa Barat".
  label: string
  province: string
  lat: number
  lon: number
}

type Entry = Place & { key: string; keyCompact: string; hay: string; words: string[] }

const VILLAGE_CELL = 0.05
let entries: Entry[] = []
let villages: Entry[] = []
const grid = new Map<string, number[]>()

const normalize = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const shortRegency = (name: string) => name.replace(/^Kabupaten\s+/i, 'Kab. ')
// Kata yang hanya menjelaskan jenis wilayah, tidak dipakai untuk pencocokan.
const STOP = new Set(['kab', 'kabupaten', 'kota', 'kec', 'kecamatan', 'desa', 'kel', 'kelurahan', 'prov', 'provinsi', 'kampung', 'dusun', 'di'])

function makeEntry(place: Place, ownName: string, context: string[]): Entry {
  const key = normalize(ownName)
  return { ...place, key, keyCompact: foldSpelling(key), hay: normalize([ownName, ...context].join(' ')), words: normalize([ownName, ...context].join(' ')).split(' ') }
}

export async function loadWilayah(dataDir: string) {
  const [desaText, wilayahText] = await Promise.all([
    readFile(path.join(dataDir, 'desa.txt'), 'utf8'),
    readFile(path.join(dataDir, 'wilayah.txt'), 'utf8'),
  ])
  const names = new Map<string, string>()
  for (const line of wilayahText.split('\n')) {
    const [code, name] = line.split('|')
    if (code && name) names.set(code, name)
  }

  villages = []
  grid.clear()
  // Titik tengah kecamatan dan kabupaten = rata-rata titik tengah desanya.
  const sums = new Map<string, { lat: number; lon: number; n: number }>()
  for (const line of desaText.split('\n')) {
    const [code, name, lat, lon] = line.split('|')
    if (!code || !lat) continue
    const point = { lat: Number(lat) / 1e5, lon: Number(lon) / 1e5 }
    const [p, r, d] = code.split('.')
    const province = names.get(p) ?? ''
    const regency = names.get(`${p}.${r}`) ?? ''
    const district = names.get(`${p}.${r}.${d}`) ?? ''
    const kind = code.split('.')[3]?.startsWith('1') ? 'Kel.' : 'Desa'
    const village = makeEntry({
      code, level: 4, name, province, ...point,
      label: [`${kind} ${name}`, district && `Kec. ${district}`, shortRegency(regency), province].filter(Boolean).join(', '),
    }, name, [district, regency, province])
    const key = `${Math.floor(point.lat / VILLAGE_CELL)}:${Math.floor(point.lon / VILLAGE_CELL)}`
    const bucket = grid.get(key)
    if (bucket) bucket.push(villages.length)
    else grid.set(key, [villages.length])
    villages.push(village)
    for (const parent of [`${p}.${r}`, `${p}.${r}.${d}`]) {
      const sum = sums.get(parent) ?? { lat: 0, lon: 0, n: 0 }
      sum.lat += point.lat
      sum.lon += point.lon
      sum.n++
      sums.set(parent, sum)
    }
  }

  const areas: Entry[] = []
  for (const [code, sum] of sums) {
    const parts = code.split('.')
    const province = names.get(parts[0]) ?? ''
    const own = names.get(code) ?? ''
    if (!own) continue
    const point = { lat: sum.lat / sum.n, lon: sum.lon / sum.n }
    if (parts.length === 2) {
      // "Kabupaten Ciamis" dicocokkan sebagai "Ciamis"; "Kota Palangkaraya" sebagai "Palangkaraya".
      const bare = own.replace(/^(Kabupaten|Kota)\s+/i, '')
      areas.push(makeEntry({ code, level: 2, name: own, province, ...point, label: [shortRegency(own), province].join(', ') }, bare, [own, province]))
    } else {
      const regency = names.get(parts.slice(0, 2).join('.')) ?? ''
      areas.push(makeEntry({ code, level: 3, name: own, province, ...point, label: [`Kec. ${own}`, shortRegency(regency), province].join(', ') }, own, [regency, province]))
    }
  }
  entries = [...areas, ...villages]
  return { villages: villages.length, areas: areas.length }
}

// Desa/kelurahan terdekat dari sebuah titik (dalam maxKm).
export function nearestVillage(lat: number, lon: number, maxKm = 15): (Place & { km: number }) | null {
  const rings = Math.ceil(maxKm / (111 * VILLAGE_CELL))
  const row = Math.floor(lat / VILLAGE_CELL)
  const col = Math.floor(lon / VILLAGE_CELL)
  let best: Entry | null = null
  let bestKm = maxKm
  for (let dr = -rings; dr <= rings; dr++) {
    for (let dc = -rings; dc <= rings; dc++) {
      for (const index of grid.get(`${row + dr}:${col + dc}`) ?? []) {
        const km = distanceKm(lat, lon, villages[index].lat, villages[index].lon)
        if (km < bestKm) {
          best = villages[index]
          bestKm = km
        }
      }
    }
  }
  if (!best) return null
  const { key: _k, keyCompact: _c, hay: _h, words: _w, ...place } = best
  return { ...place, km: bestKm }
}

// Pencarian: kata pertama mencocokkan nama wilayah itu sendiri (awal kata, spasi diabaikan),
// kata berikutnya menyaring kecamatan/kabupaten/provinsi, mis. "situmandala ciamis" atau "Situmandala, Kab. Ciamis".
export function searchWilayah(query: string, limit = 8): Place[] {
  const tokens = normalize(query).split(' ').filter((token) => token && !STOP.has(token))
  if (!tokens.length || tokens.join('').length < 2) return []
  const scored: { entry: Entry; score: number }[] = []
  for (const entry of entries) {
    // Ambil sebanyak mungkin token awal yang membentuk nama wilayah ini ("palangka raya" -> "palangkaraya").
    let used = 0
    for (let n = tokens.length; n >= 1; n--) {
      const joined = foldSpelling(tokens.slice(0, n).join(''))
      const spaced = tokens.slice(0, n).join(' ')
      if (entry.keyCompact.startsWith(joined) || entry.key.startsWith(spaced) || entry.key.includes(` ${spaced}`)) {
        used = n
        break
      }
    }
    if (!used) continue
    const rest = tokens.slice(used)
    if (!rest.every((token) => entry.words.some((word) => word.startsWith(token)))) continue
    const nameQuery = foldSpelling(tokens.slice(0, used).join(''))
    const exact = entry.keyCompact === nameQuery
    const levelWeight = entry.level === 2 ? 300 : entry.level === 3 ? 200 : 100
    scored.push({ entry, score: (exact ? 1000 : 0) + (entry.keyCompact.startsWith(nameQuery) ? 200 : 0) + levelWeight + rest.length * 50 - entry.key.length })
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry: { key: _k, keyCompact: _c, hay: _h, words: _w, ...place } }) => place)
}
