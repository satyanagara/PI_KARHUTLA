// Analisis risiko hotspot: kedekatan ke permukiman dan kawasan lindung, kluster, serta perkiraan sebaran asap.

export type Fire = Record<string, string>

export type Settlement = { name: string; lat: number; lon: number; rank: number; population: number; province: string }
export type AreaKind = 'konservasi' | 'lindung' | 'gambut' | 'kabupaten' | 'provinsi'
export type AreaHit = { name: string; kind: AreaKind; km: number }

export type FireRisk = {
  settlement: Settlement | null
  settlementKm: number
  area: AreaHit | null
  // Nama Kesatuan Hidrologis Gambut (KHG) bila titik berada di lahan gambut.
  peat: string | null
}

export type Cluster = {
  id: string
  lat: number
  lon: number
  count: number
  high: number
  frp: number
  latest: string
  nearest: Settlement | null
  nearestKm: number
  nearSettlementFires: number
  peatFires: number
  areas: AreaHit[]
  smoke?: Smoke
}

// unhealthyDays: berapa periode 24 jam berturut-turut (berakhir sekarang, maks. 7) yang rata-rata PM2.5-nya ≥ 55,5 µg/m³.
export type SmokeReading = { pm25Now: number | null; pm25Mean24: number | null; pm25Max24: number | null; windKmh: number; windFrom: number; unhealthyDays: number }

// Perkiraan setara rokok: PM2.5 22 µg/m³ selama 24 jam ≈ 1 batang rokok (Berkeley Earth, Muller & Muller 2015).
export const PM25_PER_CIGARETTE = 22
export const cigarettesPerDay = (pm25: number | null) => (pm25 === null ? null : pm25 / PM25_PER_CIGARETTE)

export type Smoke = SmokeReading & {
  heading: number
  reachKm: number
  level: IspuLevel
  plume: [number, number][]
  settlements: number
  population: number
  towns: Settlement[]
}

export type IspuLevel = { key: string; label: string; color: string }

const EARTH_KM = 6371
const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

export function destination(lat: number, lon: number, headingDeg: number, km: number): [number, number] {
  const d = km / EARTH_KM
  const h = toRad(headingDeg)
  const lat1 = toRad(lat)
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h))
  const lon2 = toRad(lon) + Math.atan2(Math.sin(h) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return [toDeg(lat2), toDeg(lon2)]
}

// Kategori ISPU PM2.5 (PermenLHK P.14/2020, konsentrasi rata-rata 24 jam dalam µg/m³).
const ISPU: (IspuLevel & { max: number })[] = [
  { key: 'baik', label: 'Baik', color: '#3f9a5c', max: 15.5 },
  { key: 'sedang', label: 'Sedang', color: '#3a7bc8', max: 55.4 },
  { key: 'tidak-sehat', label: 'Tidak sehat', color: '#e0b11f', max: 150.4 },
  { key: 'sangat-tidak-sehat', label: 'Sangat tidak sehat', color: '#d8432c', max: 250.4 },
  { key: 'berbahaya', label: 'Berbahaya', color: '#2a1d1b', max: Infinity },
]
export const ISPU_LEVELS: IspuLevel[] = ISPU.map(({ key, label, color }) => ({ key, label, color }))

// Arti tiap kategori dan anjuran bagi warga, disarikan dari panduan ISPU.
export const ISPU_ADVICE: Record<string, { meaning: string; action: string }> = {
  baik: { meaning: 'Udara bersih.', action: 'Aman beraktivitas di luar ruangan.' },
  sedang: { meaning: 'Udara masih dapat diterima.', action: 'Orang yang sangat sensitif sebaiknya mengurangi aktivitas berat di luar ruangan.' },
  'tidak-sehat': { meaning: 'Asap mulai mengganggu kesehatan, terutama kelompok rentan.', action: 'Kurangi aktivitas di luar ruangan dan pakai masker. Anak, lansia, ibu hamil, serta penderita asma atau penyakit jantung sebaiknya tetap di dalam.' },
  'sangat-tidak-sehat': { meaning: 'Asap berisiko bagi kesehatan semua orang.', action: 'Hindari aktivitas di luar ruangan, tutup jendela, dan pakai masker N95/KN95 bila harus keluar. Kelompok rentan tetap di dalam ruangan.' },
  berbahaya: { meaning: 'Asap sangat pekat dan membahayakan kesehatan semua orang.', action: 'Tetap di dalam ruangan dengan jendela tertutup. Kelompok rentan sebaiknya pindah sementara ke tempat berudara bersih. Segera cari pertolongan medis bila sesak napas.' },
  na: { meaning: 'Data kualitas udara belum tersedia.', action: 'Pantau informasi resmi dari pemerintah daerah.' },
}

export const UNHEALTHY_LEVELS = ['tidak-sehat', 'sangat-tidak-sehat', 'berbahaya']
export const levelRank = (key: string) => ['na', 'baik', 'sedang', 'tidak-sehat', 'sangat-tidak-sehat', 'berbahaya'].indexOf(key)
export const UNKNOWN_LEVEL: IspuLevel = { key: 'na', label: 'Tidak ada data', color: '#9aa69f' }

export function ispuLevel(pm25: number | null): IspuLevel {
  if (pm25 === null || !Number.isFinite(pm25)) return UNKNOWN_LEVEL
  const { key, label, color } = ISPU.find((level) => pm25 <= level.max)!
  return { key, label, color }
}

// ---------- Permukiman ----------

// Menyamakan ejaan untuk pencarian: ejaan lama (oe, dj, tj) dan huruf ganda ("Pangkalanbuun" = "Pangkalan Bun").
export function foldSpelling(text: string) {
  return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/oe/g, 'u').replace(/dj/g, 'j').replace(/tj/g, 'c').replace(/[^a-z0-9]/g, '').replace(/(.)\1+/g, '$1')
}

const SETTLEMENT_CELL = 0.05

export class SettlementIndex {
  private grid = new Map<string, number[]>()
  readonly items: Settlement[]
  private constructor(items: Settlement[]) {
    this.items = items
    items.forEach((item, index) => {
      const key = cellKey(item.lat, item.lon, SETTLEMENT_CELL)
      const bucket = this.grid.get(key)
      if (bucket) bucket.push(index)
      else this.grid.set(key, [index])
    })
  }

  // Format berkas: nama|lat*1e4|lon*1e4|rank|populasi|provinsi per baris.
  static parse(text: string) {
    const items: Settlement[] = []
    for (const line of text.split('\n')) {
      const [name, lat, lon, rank, population, province] = line.split('|')
      if (!name || !lat) continue
      items.push({ name, lat: Number(lat) / 1e4, lon: Number(lon) / 1e4, rank: Number(rank) || 1, population: Number(population) || 0, province: province ?? '' })
    }
    return new SettlementIndex(items)
  }

  nearest(lat: number, lon: number, maxKm: number) {
    let best: Settlement | null = null
    let bestKm = Infinity
    this.forEachNear(lat, lon, maxKm, (item) => {
      const km = distanceKm(lat, lon, item.lat, item.lon)
      if (km < bestKm) {
        best = item
        bestKm = km
      }
    })
    return { settlement: best as Settlement | null, km: bestKm }
  }

  // Pencarian nama: kota besar diutamakan, lalu kecocokan awal kata dan populasi. Spasi diabaikan
  // agar "Palangka Raya" cocok dengan "Palangkaraya".
  search(query: string, limit = 8) {
    const needle = query.trim().toLowerCase()
    const compact = foldSpelling(needle)
    if (compact.length < 2) return []
    const scored: { item: Settlement; score: number }[] = []
    for (const item of this.items) {
      const name = item.name.toLowerCase()
      const at = name.indexOf(needle)
      const wordStart = at === 0 || (at > 0 && name[at - 1] === ' ')
      const compactStart = foldSpelling(name).startsWith(compact)
      if (!wordStart && !compactStart) continue
      const exact = name === needle || foldSpelling(name) === compact
      const score = item.rank * 300 + (exact ? 150 : 0) + (at === 0 || compactStart ? 100 : 0) + Math.log10(1 + item.population) * 10 - name.length
      scored.push({ item, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ item }) => item)
  }

  forEachNear(lat: number, lon: number, radiusKm: number, visit: (item: Settlement) => void) {
    const latSpan = radiusKm / 111
    const lonSpan = radiusKm / (111 * Math.max(0.2, Math.cos(toRad(lat))))
    const [row0, col0] = cellOf(lat - latSpan, lon - lonSpan, SETTLEMENT_CELL)
    const [row1, col1] = cellOf(lat + latSpan, lon + lonSpan, SETTLEMENT_CELL)
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const bucket = this.grid.get(`${row}:${col}`)
        if (bucket) for (const index of bucket) visit(this.items[index])
      }
    }
  }
}

// ---------- Kawasan konservasi / hutan lindung ----------

type Ring = [number, number][]
type Area = { name: string; kind: AreaKind; polygons: Ring[][]; bbox: [number, number, number, number] }
type AreaFeature = { properties: { n: string; k: AreaKind }; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }

const AREA_CELL = 0.5

export class AreaIndex {
  private grid = new Map<string, number[]>()
  readonly areas: Area[]
  private constructor(areas: Area[]) {
    this.areas = areas
    areas.forEach((area, index) => {
      const [minLon, minLat, maxLon, maxLat] = area.bbox
      const [row0, col0] = cellOf(minLat, minLon, AREA_CELL)
      const [row1, col1] = cellOf(maxLat, maxLon, AREA_CELL)
      for (let row = row0; row <= row1; row++) {
        for (let col = col0; col <= col1; col++) {
          const key = `${row}:${col}`
          const bucket = this.grid.get(key)
          if (bucket) bucket.push(index)
          else this.grid.set(key, [index])
        }
      }
    })
  }

  static parse(geojson: { features: AreaFeature[] }) {
    const areas: Area[] = []
    for (const feature of geojson.features) {
      const coordinates = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates as Ring[]] : (feature.geometry.coordinates as Ring[][])
      const bbox: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const polygon of coordinates) {
        for (const [lon, lat] of polygon[0]) {
          bbox[0] = Math.min(bbox[0], lon)
          bbox[1] = Math.min(bbox[1], lat)
          bbox[2] = Math.max(bbox[2], lon)
          bbox[3] = Math.max(bbox[3], lat)
        }
      }
      areas.push({ name: feature.properties.n, kind: feature.properties.k, polygons: coordinates, bbox })
    }
    return new AreaIndex(areas)
  }

  // Kawasan yang memuat titik, atau yang batasnya dalam nearKm. Hasil di dalam kawasan berjarak 0.
  locate(lat: number, lon: number, nearKm: number): AreaHit | null {
    const bucket = this.grid.get(cellKey(lat, lon, AREA_CELL))
    if (!bucket) return null
    const padLat = nearKm / 111
    const padLon = nearKm / (111 * Math.cos(toRad(lat)))
    let best: AreaHit | null = null
    for (const index of bucket) {
      const area = this.areas[index]
      const [minLon, minLat, maxLon, maxLat] = area.bbox
      if (lon < minLon - padLon || lon > maxLon + padLon || lat < minLat - padLat || lat > maxLat + padLat) continue
      const km = distanceToArea(area, lat, lon)
      if (km <= nearKm && (!best || km < best.km || (km === best.km && area.kind === 'konservasi'))) {
        best = { name: area.name, kind: area.kind, km }
      }
    }
    return best
  }
}

function distanceToArea(area: Area, lat: number, lon: number) {
  const kx = 111.32 * Math.cos(toRad(lat))
  const ky = 110.57
  let minKm = Infinity
  for (const polygon of area.polygons) {
    let inside = false
    for (const ring of polygon) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]
        const [xj, yj] = ring[j]
        if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
        // Jarak titik ke segmen pada proyeksi equirectangular lokal.
        const ax = (xj - lon) * kx
        const ay = (yj - lat) * ky
        const bx = (xi - lon) * kx
        const by = (yi - lat) * ky
        const dx = bx - ax
        const dy = by - ay
        const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0
        minKm = Math.min(minKm, Math.hypot(ax + t * dx, ay + t * dy))
      }
    }
    if (inside) return 0
  }
  return minKm
}

function cellOf(lat: number, lon: number, size: number): [number, number] {
  return [Math.floor(lat / size), Math.floor(lon / size)]
}

function cellKey(lat: number, lon: number, size: number) {
  const [row, col] = cellOf(lat, lon, size)
  return `${row}:${col}`
}

// ---------- Analisis titik dan kluster ----------

export const SETTLEMENT_SEARCH_KM = 10
export const SETTLEMENT_ALERT_KM = 2
export const AREA_NEAR_KM = 2
const CLUSTER_CELL = 0.2

export function assessFire(lat: number, lon: number, settlements: SettlementIndex, areas: AreaIndex, peat: AreaIndex | null = null): FireRisk {
  const { settlement, km } = settlements.nearest(lat, lon, SETTLEMENT_SEARCH_KM)
  return { settlement, settlementKm: km, area: areas.locate(lat, lon, AREA_NEAR_KM), peat: peat?.locate(lat, lon, 0)?.name ?? null }
}

export function buildClusters(fires: { lat: number; lon: number; fire: Fire; risk: FireRisk; high: boolean; time: string }[]) {
  const groups = new Map<string, typeof fires>()
  for (const item of fires) {
    const key = cellKey(item.lat, item.lon, CLUSTER_CELL)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }

  const clusters: Cluster[] = []
  for (const [id, group] of groups) {
    let weight = 0
    let lat = 0
    let lon = 0
    let frp = 0
    let high = 0
    let latest = ''
    let nearest: Settlement | null = null
    let nearestKm = Infinity
    let nearSettlementFires = 0
    let peatFires = 0
    const areas = new Map<string, AreaHit>()
    for (const item of group) {
      const itemFrp = Number(item.fire.frp) || 0
      const w = Math.max(1, itemFrp)
      weight += w
      lat += item.lat * w
      lon += item.lon * w
      frp += itemFrp
      if (item.high) high++
      if (item.time > latest) latest = item.time
      if (item.risk.settlementKm < nearestKm) {
        nearestKm = item.risk.settlementKm
        nearest = item.risk.settlement
      }
      if (item.risk.settlementKm <= SETTLEMENT_ALERT_KM) nearSettlementFires++
      if (item.risk.peat) peatFires++
      const area = item.risk.area
      if (area) {
        const known = areas.get(area.name)
        if (!known || area.km < known.km) areas.set(area.name, area)
      }
    }
    clusters.push({
      id,
      lat: lat / weight,
      lon: lon / weight,
      count: group.length,
      high,
      frp,
      latest,
      nearest,
      nearestKm,
      nearSettlementFires,
      peatFires,
      areas: [...areas.values()].sort((a, b) => a.km - b.km),
    })
  }
  return clusters.sort((a, b) => b.frp - a.frp)
}

// ---------- Sebaran asap ----------

const PLUME_HOURS = 6
const PLUME_HALF_ANGLE = 20

// Kerucut asap searah angin: jangkauan = kecepatan angin × 6 jam, dibatasi 5–150 km.
export function buildSmoke(cluster: Cluster, reading: SmokeReading, settlements: SettlementIndex): Smoke {
  const heading = (reading.windFrom + 180) % 360
  const reachKm = Math.min(150, Math.max(5, reading.windKmh * PLUME_HOURS))
  const plume: [number, number][] = [[cluster.lat, cluster.lon]]
  for (let step = -PLUME_HALF_ANGLE; step <= PLUME_HALF_ANGLE; step += 5) {
    plume.push(destination(cluster.lat, cluster.lon, heading + step, reachKm))
  }

  let count = 0
  let population = 0
  const towns: Settlement[] = []
  settlements.forEachNear(cluster.lat, cluster.lon, reachKm, (item) => {
    const km = distanceKm(cluster.lat, cluster.lon, item.lat, item.lon)
    if (km > reachKm) return
    const offset = Math.abs(((bearing(cluster.lat, cluster.lon, item.lat, item.lon) - heading + 540) % 360) - 180)
    if (km > 1 && offset > PLUME_HALF_ANGLE) return
    count++
    population += item.population
    if (item.rank >= 2) towns.push(item)
  })
  towns.sort((a, b) => b.rank - a.rank || b.population - a.population)

  return {
    ...reading,
    heading,
    reachKm,
    level: ispuLevel(reading.pm25Mean24 ?? reading.pm25Now),
    plume,
    settlements: count,
    population,
    towns: towns.slice(0, 12),
  }
}

// Apakah suatu titik berada di dalam kerucut asap kluster.
export function inPlume(cluster: Cluster, lat: number, lon: number) {
  const smoke = cluster.smoke
  if (!smoke) return false
  const km = distanceKm(cluster.lat, cluster.lon, lat, lon)
  if (km > smoke.reachKm) return false
  if (km <= 1) return true
  const offset = Math.abs(((bearing(cluster.lat, cluster.lon, lat, lon) - smoke.heading + 540) % 360) - 180)
  return offset <= PLUME_HALF_ANGLE
}

export function compassName(deg: number) {
  const names = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut']
  return names[Math.round(deg / 45) % 8]
}

// Skor prioritas: energi api diperberat bila dekat permukiman, di kawasan lindung, di lahan gambut
// (api gambut menghasilkan asap jauh lebih pekat), asap berbahaya, atau banyak permukiman di jalur asap.
export function priorityScore(cluster: Cluster) {
  const levelWeight: Record<string, number> = { baik: 1, sedang: 1.2, 'tidak-sehat': 1.6, 'sangat-tidak-sehat': 2.2, berbahaya: 3, na: 1 }
  const settlementWeight = cluster.nearestKm <= 1 ? 2.2 : cluster.nearestKm <= SETTLEMENT_ALERT_KM ? 1.7 : cluster.nearestKm <= 5 ? 1.25 : 1
  const areaWeight = cluster.areas.some((area) => area.km === 0) ? 1.8 : cluster.areas.length ? 1.3 : 1
  const exposureWeight = 1 + Math.log10(1 + (cluster.smoke?.settlements ?? 0)) / 2
  const peatWeight = 1 + 0.4 * (cluster.peatFires / cluster.count)
  return Math.log10(10 + cluster.frp) * cluster.count ** 0.35 * settlementWeight * areaWeight * peatWeight * levelWeight[cluster.smoke?.level.key ?? 'na'] * exposureWeight
}

export function compassLabel(deg: number) {
  const names = ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL']
  return names[Math.round(deg / 45) % 8]
}
