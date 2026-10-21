// Mengambil hotspot NASA FIRMS dan data asap Open-Meteo, menjalankan analisis risiko, dan menyimpan hasilnya di cache
// supaya lalu lintas publik tidak membebani kuota sumber data.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  AreaIndex,
  SETTLEMENT_ALERT_KM,
  SettlementIndex,
  assessFire,
  buildClusters,
  buildSmoke,
  bearing,
  compassName,
  distanceKm,
  foldSpelling,
  inPlume,
  ispuLevel,
  levelRank,
  priorityScore,
  type Fire,
  type FireRisk,
  type SmokeReading,
} from '../src/risk.ts'
import { forecastNear } from './bmkg.ts'
import { nearestVillage, searchWilayah } from './wilayah.ts'
import { FLAG_STATIONARY, type AreaRank, type ExposedTown, type LocationCheck, type Report, type ReportFire, type Source } from '../src/report-types.ts'

const REPORT_TTL_MS = 10 * 60 * 1000
// Laporan kedaluwarsa masih boleh dikirim sambil diperbarui, tetapi tidak lebih tua dari ini.
const REPORT_STALE_MAX_MS = 30 * 60 * 1000
const SMOKE_TTL_MS = 30 * 60 * 1000
const SMOKE_CLUSTERS = 30
const PRIORITY_CLUSTERS = 30
const FIRMS_AREA = '94,-11,142,6'

export type Reference = { settlements: SettlementIndex; areas: AreaIndex; peat: AreaIndex; regencies: AreaIndex; provinces: AreaIndex; regencyProvince: Map<string, string> }
let reference: Reference | null = null
export const getReference = () => reference

// Permukiman: GeoNames. Kawasan hutan (konservasi & lindung) dan KHG gambut: Kementerian Kehutanan (SIGAP).
export async function loadReference(dataDir: string) {
  const regencyProvince = new Map<string, string>()
  const readGeojson = async (name: string) => {
    const geojson = JSON.parse(await readFile(path.join(dataDir, name), 'utf8'))
    geojson.features = geojson.features.filter((feature: { geometry: unknown }) => feature.geometry)
    for (const feature of geojson.features) if (feature.properties.p) regencyProvince.set(feature.properties.n, feature.properties.p)
    return AreaIndex.parse(geojson)
  }
  const [settlementText, areas, peat, regencies, provinces] = await Promise.all([
    readFile(path.join(dataDir, 'settlements.txt'), 'utf8'),
    readGeojson('kawasan-hutan.json'),
    readGeojson('gambut.json'),
    readGeojson('kabupaten.json'),
    readGeojson('provinsi.json'),
  ])
  reference = { settlements: SettlementIndex.parse(settlementText), areas, peat, regencies, provinces, regencyProvince }
  return { settlements: reference.settlements.items.length, areas: areas.areas.length, peat: peat.areas.length, regencies: regencies.areas.length }
}

// ---------- NASA FIRMS ----------

// keep: bila diisi, hanya kolom itu yang disimpan (hemat memori untuk rentang waktu panjang).
function parseCsv(text: string, keep?: string[]): Fire[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 1 || !lines[0].toLowerCase().startsWith('latitude,longitude')) {
    throw new Error(`FIRMS: ${text.trim().slice(0, 200) || 'respons kosong'}`)
  }
  const headers = lines[0].split(',').map((value) => value.trim())
  const wanted = headers.map((header, index) => [header, index] as const).filter(([header]) => !keep || keep.includes(header))
  return lines.slice(1).filter(Boolean).map((line) => {
    const values = line.split(',')
    return Object.fromEntries(wanted.map(([header, index]) => [header, values[index] ?? '']))
  })
}

// startDate (YYYY-MM-DD, UTC) opsional: data dari tanggal itu selama `days` hari (FIRMS mengizinkan maksimal 5 hari per permintaan).
export async function fetchFirms(source: Source, days: number, startDate?: string, keep?: string[]) {
  const key = process.env.FIRMS_MAP_KEY
  if (!key) throw new Error('Server belum dikonfigurasi: FIRMS_MAP_KEY kosong.')
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${FIRMS_AREA}/${days}${startDate ? `/${startDate}` : ''}`
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`FIRMS (${response.status}): ${body.slice(0, 200)}`)
  return parseCsv(body, keep)
}

// ---------- SiPongi (BRIN/LAPAN) ----------

const SIPONGI_UA = 'Mozilla/5.0 (compatible; PemantauKarhutla/1.0; +https://amukapi.santaralabs.ai)'

// Hotspot resmi pemerintah dari SiPongi. Hanya keyakinan sedang dan tinggi, sesuai praktik pelaporan Kemenhut.
async function fetchSipongi(days: number): Promise<Fire[]> {
  const url = `https://opsroom.sipongidata.my.id/api/opsroom/indoHotspot?wilayah=IN&filterperiode=false&from=&to=&late=${days * 24}`
    + '&satelit%5B%5D=LPN-NPP&satelit%5B%5D=LPN-NOAA20&confidence%5B%5D=medium&confidence%5B%5D=high'
  const response = await fetch(url, { headers: { 'User-Agent': SIPONGI_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) })
  if (!response.ok) throw new Error(`SiPongi (${response.status})`)
  const body = await response.json() as { features: { properties: Record<string, string | number> }[] }
  return body.features.map(({ properties }) => {
    const at = new Date(String(properties.date_hotspot_ori))
    const iso = at.toISOString()
    return {
      latitude: String(properties.lat),
      longitude: String(properties.long),
      acq_date: iso.slice(0, 10),
      acq_time: iso.slice(11, 13) + iso.slice(14, 16),
      confidence: properties.confidence_level === 'high' ? 'h' : properties.confidence_level === 'low' ? 'l' : 'n',
      frp: '',
      daynight: '',
      satellite: String(properties.ori_sumber ?? ''),
    }
  })
}

// ---------- Open-Meteo ----------

const smokeCache = new Map<string, { at: number; reading: SmokeReading }>()
const smokeKey = (lat: number, lon: number) => `${lat.toFixed(1)},${lon.toFixed(1)}`
const meanOf = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)

async function getJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Open-Meteo (${response.status}): ${(await response.text()).slice(0, 200)}`)
  const body = await response.json()
  return Array.isArray(body) ? body : [body]
}

// Angin 10 m dan PM2.5 model CAMS. Titik dibulatkan 0,1° dan di-cache 30 menit.
async function fetchSmoke(points: { lat: number; lon: number }[]) {
  const now = Date.now()
  const missing = points.filter(({ lat, lon }) => {
    const hit = smokeCache.get(smokeKey(lat, lon))
    return !hit || now - hit.at > SMOKE_TTL_MS
  })
  if (missing.length) {
    const latitude = missing.map(({ lat }) => lat.toFixed(3)).join(',')
    const longitude = missing.map(({ lon }) => lon.toFixed(3)).join(',')
    const [air, wind] = await Promise.all([
      getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=pm2_5&hourly=pm2_5&past_days=7&forecast_days=5&timezone=GMT`),
      getJson(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&timezone=GMT`),
    ])
    missing.forEach(({ lat, lon }, index) => {
      const hourly = air[index]?.hourly ?? { time: [], pm2_5: [] }
      const past: number[] = []
      const next: number[] = []
      // Tujuh periode 24 jam ke belakang dari sekarang, untuk menghitung hari berturut-turut udara tidak sehat.
      const windows: number[][] = Array.from({ length: 7 }, () => [])
      const ahead: number[][] = Array.from({ length: 4 }, () => [])
      hourly.time.forEach((time: string, hour: number) => {
        const value = hourly.pm2_5[hour]
        if (typeof value !== 'number') return
        const at = Date.parse(`${time}Z`)
        if (at <= now && at > now - 24 * 3600 * 1000) past.push(value)
        if (at > now && at <= now + 24 * 3600 * 1000) next.push(value)
        const window = Math.floor((now - at) / (24 * 3600 * 1000))
        if (at <= now && window < 7) windows[window].push(value)
        const step = Math.floor((at - now) / (24 * 3600 * 1000))
        if (at > now && step < 4) ahead[step].push(value)
      })
      let unhealthyDays = 0
      for (const values of windows) {
        const mean = meanOf(values)
        if (mean === null || mean < 55.5) break
        unhealthyDays++
      }
      smokeCache.set(smokeKey(lat, lon), {
        at: now,
        reading: {
          pm25Now: air[index]?.current?.pm2_5 ?? null,
          pm25Mean24: meanOf(past),
          pm25Max24: next.length ? Math.max(...next) : null,
          windKmh: wind[index]?.current?.wind_speed_10m ?? 0,
          windFrom: wind[index]?.current?.wind_direction_10m ?? 0,
          unhealthyDays,
          forecastMeans: ahead.map((values) => meanOf(values)),
        },
      })
    })
  }
  return points.map(({ lat, lon }) => smokeCache.get(smokeKey(lat, lon))!.reading)
}

// ---------- Laporan ----------

const confidenceOf = (raw: string) => {
  const value = raw.toLowerCase()
  if (value === 'h' || value === 'high' || Number(value) >= 80) return 'high'
  if (value === 'l' || value === 'low' || (Number(value) > 0 && Number(value) < 40)) return 'low'
  return 'medium'
}
const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits

// ---------- Sumber panas tetap ----------
// Pabrik, pembangkit, atau pembakaran rutin muncul di titik yang sama hampir setiap hari, sedangkan kebakaran
// lahan biasanya berpindah atau padam. Riwayat 5 hari (gabungan ketiga satelit VIIRS untuk data NASA, karena
// tiap satelit bisa melihat sumber yang sama di hari berbeda) dipetakan ke sel ±440 m; titik ditandai bila sel
// itu dan tetangganya terdeteksi pada ≥3 tanggal berbeda. Titik di gambut atau di dalam kawasan hutan tidak pernah
// ditandai, karena api gambut memang dapat bertahan berhari-hari di tempat yang sama.
const PERSIST_CELL = 0.004
const PERSIST_MIN_DAYS = 3
const HISTORY_TTL_MS = 30 * 60 * 1000
type History = Map<string, Set<string>>
const histories = new Map<'NASA' | 'BRIN_LAPAN', { at: number; history: Promise<History> }>()
export const NASA_SOURCES: Source[] = ['VIIRS_NOAA21_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT']

// Gabungan ketiga satelit VIIRS. Api yang sama sering terekam oleh lebih dari satu satelit dalam satu lintasan
// siang/malam dengan posisi piksel bergeser beberapa ratus meter. Deteksi dari satelit LAIN pada tanggal dan
// siang/malam yang sama di sel ±440 m yang sama atau bertetangga dianggap api yang sama (diambil FRP tertinggi).
// Deteksi dari satelit yang sama tidak digabung, karena itu memang piksel api yang berbeda.
async function fetchAllViirs(days: number): Promise<Fire[]> {
  return mergeViirs(await Promise.all(NASA_SOURCES.map((item) => fetchFirms(item, days))))
}

export function mergeViirs(sets: Fire[][]): Fire[] {
  const kept: Fire[] = []
  const index = new Map<string, { at: number; satellite: string }[]>()
  sets.forEach((rows, satellite) => {
    for (const fire of rows) {
      const lat = Number(fire.latitude)
      const lon = Number(fire.longitude)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const row = Math.floor(lat / PERSIST_CELL)
      const col = Math.floor(lon / PERSIST_CELL)
      const stamp = `${fire.acq_date}:${fire.daynight}`
      let match: { at: number; satellite: string } | undefined
      for (let dr = -1; dr <= 1 && !match; dr++) {
        for (let dc = -1; dc <= 1 && !match; dc++) {
          match = index.get(`${row + dr}:${col + dc}:${stamp}`)?.find((entry) => entry.satellite !== String(satellite))
        }
      }
      if (match) {
        if ((Number(fire.frp) || 0) > (Number(kept[match.at].frp) || 0)) kept[match.at] = fire
        continue
      }
      const key = `${row}:${col}:${stamp}`
      const list = index.get(key) ?? []
      list.push({ at: kept.push(fire) - 1, satellite: String(satellite) })
      index.set(key, list)
    }
  })
  return kept
}

function buildHistory(rows: Fire[]): History {
  const history: History = new Map()
  for (const fire of rows) {
    const lat = Number(fire.latitude)
    const lon = Number(fire.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !fire.acq_date) continue
    const key = `${Math.floor(lat / PERSIST_CELL)}:${Math.floor(lon / PERSIST_CELL)}`
    const dates = history.get(key) ?? new Set<string>()
    dates.add(fire.acq_date)
    history.set(key, dates)
  }
  return history
}

function loadHistory(source: Source): Promise<History> {
  const key = source === 'BRIN_LAPAN' ? 'BRIN_LAPAN' : 'NASA'
  const hit = histories.get(key)
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.history
  const history = (key === 'BRIN_LAPAN'
    ? fetchSipongi(5)
    : Promise.all(NASA_SOURCES.map((item) => fetchFirms(item, 5))).then((sets) => sets.flat())
  ).then(buildHistory)
  histories.set(key, { at: Date.now(), history })
  history.catch(() => histories.delete(key))
  return history
}

function persistentDays(history: History, lat: number, lon: number) {
  const row = Math.floor(lat / PERSIST_CELL)
  const col = Math.floor(lon / PERSIST_CELL)
  const dates = new Set<string>()
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) history.get(`${row + dr}:${col + dc}`)?.forEach((date) => dates.add(date))
  }
  return dates.size
}

async function buildReport(source: Source, days: number): Promise<Report> {
  if (!reference) throw new Error('Data rujukan belum dimuat.')
  const { settlements, areas, peat, regencies, provinces, regencyProvince } = reference
  const official = source === 'BRIN_LAPAN'
  // FIRMS day_range=1 hanya berisi tanggal UTC hari ini, jadi 24 jam diambil dari 2 hari lalu disaring.
  const fetchDays = days === 1 ? 2 : days
  const raw = official ? await fetchSipongi(days) : source === 'VIIRS_ALL' ? await fetchAllViirs(fetchDays) : await fetchFirms(source, fetchDays)
  const fetchedAt = new Date()
  const cutoff = fetchedAt.getTime() - 24 * 3600 * 1000
  const rows = days === 1 && !official ? raw.filter((fire) => {
    const time = String(fire.acq_time ?? '').padStart(4, '0')
    return Date.parse(`${fire.acq_date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`) >= cutoff
  }) : raw
  let history: History | null = null
  try {
    history = await loadHistory(source)
  } catch (error) {
    console.error('[report] riwayat 5 hari gagal dimuat, penanda sumber panas tetap dilewati:', error instanceof Error ? error.message : error)
  }

  const settlementNames: string[] = []
  const settlementIndex = new Map<string, number>()
  const areaList: Report['areas'] = []
  const areaIndex = new Map<string, number>()
  const peatUnits: string[] = []
  const peatIndex = new Map<string, number>()
  const regencyNames: string[] = []
  const regencyIndex = new Map<string, number>()
  const regencyStats = new Map<string, { total: number; high: number; nearSettlement: number; peat: number; forest: number }>()
  const intern = <T>(map: Map<string, number>, list: T[], key: string, value: T) => {
    let index = map.get(key)
    if (index === undefined) {
      index = list.push(value) - 1
      map.set(key, index)
    }
    return index
  }

  const fires: ReportFire[] = []
  const assessed: Parameters<typeof buildClusters>[0] = []
  const ranking = new Map<string, AreaRank>()
  const villages = new Set<string>()
  let high = 0
  let totalFrp = 0
  let nearSettlement = 0
  let peatInside = 0
  let stationary = 0
  const kinds = { konservasi: { inside: 0, nearEdge: 0, names: new Set<string>() }, lindung: { inside: 0, nearEdge: 0, names: new Set<string>() } }

  for (const fire of rows) {
    const lat = Number(fire.latitude)
    const lon = Number(fire.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    // Kotak area FIRMS juga mencakup Papua Nugini, Timor-Leste, dan Malaysia; hanya wilayah RI yang dianalisis.
    if (!provinces.locate(lat, lon, 2)) continue
    const frp = Number(fire.frp) || 0
    const isHigh = confidenceOf(fire.confidence ?? '') === 'high'
    const risk: FireRisk = assessFire(lat, lon, settlements, areas, peat)
    const time = String(fire.acq_time ?? '').padStart(4, '0')
    const regency = regencies.locate(lat, lon, 0)?.name ?? null
    const isStationary = Boolean(history)
      && !risk.peat
      && risk.area?.km !== 0
      && risk.settlementKm <= SETTLEMENT_ALERT_KM
      && persistentDays(history!, lat, lon) >= PERSIST_MIN_DAYS
    const record: ReportFire = [
      round(lat, 5),
      round(lon, 5),
      fire.acq_date ?? '',
      time,
      fire.confidence ?? '',
      round(frp, 2),
      fire.daynight ?? '',
      risk.settlement ? intern(settlementIndex, settlementNames, risk.settlement.name, risk.settlement.name) : -1,
      risk.settlement ? round(risk.settlementKm, 2) : -1,
      risk.area ? intern(areaIndex, areaList, risk.area.name, { name: risk.area.name, kind: risk.area.kind }) : -1,
      risk.area ? round(risk.area.km, 2) : -1,
      risk.peat ? intern(peatIndex, peatUnits, risk.peat, risk.peat) : -1,
      regency ? intern(regencyIndex, regencyNames, regency, regency) : -1,
      isStationary ? FLAG_STATIONARY : 0,
    ]
    fires.push(record)
    // Sumber panas tetap tetap tampil di peta dan CSV, tetapi tidak masuk analisis risiko.
    if (isStationary) {
      stationary++
      continue
    }

    if (isHigh) high++
    totalFrp += frp
    if (risk.settlement && risk.settlementKm <= SETTLEMENT_ALERT_KM) {
      nearSettlement++
      villages.add(`${risk.settlement.name}|${risk.settlement.lat}|${risk.settlement.lon}`)
    }
    if (risk.peat) peatInside++
    if (regency) {
      const stats = regencyStats.get(regency) ?? { total: 0, high: 0, nearSettlement: 0, peat: 0, forest: 0 }
      stats.total++
      if (isHigh) stats.high++
      if (risk.settlementKm <= SETTLEMENT_ALERT_KM) stats.nearSettlement++
      if (risk.peat) stats.peat++
      if (risk.area?.km === 0) stats.forest++
      regencyStats.set(regency, stats)
    }
    if (risk.area && (risk.area.kind === 'konservasi' || risk.area.kind === 'lindung')) {
      const bucket = kinds[risk.area.kind]
      if (risk.area.km === 0) {
        bucket.inside++
        bucket.names.add(risk.area.name)
      } else bucket.nearEdge++
      const entry = ranking.get(risk.area.name) ?? { name: risk.area.name, kind: risk.area.kind, inside: 0, near: 0, frp: 0 }
      if (risk.area.km === 0) {
        entry.inside++
        entry.frp += frp
      } else entry.near++
      ranking.set(risk.area.name, entry)
    }

    assessed.push({ lat, lon, fire, risk, high: isHigh, time: `${fire.acq_date} ${time.slice(0, 2)}:${time.slice(2)}` })
  }

  const clusters = buildClusters(assessed).sort((a, b) => priorityScore(b) - priorityScore(a))
  const candidates = clusters.slice(0, SMOKE_CLUSTERS)
  let smokeError: string | null = null
  if (candidates.length) {
    try {
      const readings = await fetchSmoke(candidates.map(({ lat, lon }) => ({ lat, lon })))
      candidates.forEach((cluster, index) => { cluster.smoke = buildSmoke(cluster, readings[index], settlements) })
      clusters.sort((a, b) => priorityScore(b) - priorityScore(a))
    } catch (error) {
      smokeError = error instanceof Error ? error.message : String(error)
    }
  }
  const smoky = clusters.filter((cluster) => ['tidak-sehat', 'sangat-tidak-sehat', 'berbahaya'].includes(cluster.smoke?.level.key ?? ''))

  // Kota di jalur asap; bila satu kota terkena beberapa jalur, ambil kategori terburuk.
  const towns = new Map<string, ExposedTown>()
  for (const cluster of clusters) {
    const smoke = cluster.smoke
    if (!smoke || levelRank(smoke.level.key) < levelRank('sedang')) continue
    for (const town of smoke.towns) {
      const key = `${town.name}|${town.lat}|${town.lon}`
      const known = towns.get(key)
      if (known && levelRank(known.level.key) >= levelRank(smoke.level.key)) continue
      towns.set(key, {
        name: town.name,
        province: town.province,
        lat: town.lat,
        lon: town.lon,
        level: smoke.level,
        pm25: smoke.pm25Mean24 ?? smoke.pm25Now,
        population: town.population,
        unhealthyDays: smoke.unhealthyDays,
        fireKm: round(distanceKm(town.lat, town.lon, cluster.lat, cluster.lon), 1),
        fireDirection: compassName(bearing(town.lat, town.lon, cluster.lat, cluster.lon)),
      })
    }
  }
  const exposedTowns = [...towns.values()].sort((a, b) => levelRank(b.level.key) - levelRank(a.level.key) || a.fireKm - b.fireKm).slice(0, 40)

  return {
    source,
    days,
    fetchedAt: fetchedAt.toISOString(),
    settlementNames,
    areas: areaList,
    peatUnits,
    regencyNames,
    fires,
    frpAvailable: !official,
    regencies: [...regencyStats.entries()]
      .map(([name, stats]) => ({ name, province: regencyProvince.get(name) ?? '', ...stats }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20),
    summary: {
      total: fires.length,
      high,
      frp: Math.round(totalFrp),
      nearSettlement,
      villages: villages.size,
      konservasi: { inside: kinds.konservasi.inside, areas: kinds.konservasi.names.size, nearEdge: kinds.konservasi.nearEdge },
      lindung: { inside: kinds.lindung.inside, areas: kinds.lindung.names.size, nearEdge: kinds.lindung.nearEdge },
      peat: { inside: peatInside, units: peatUnits.length },
      stationary,
      clusterCount: clusters.length,
      smokeAnalyzed: smokeError ? 0 : candidates.length,
      smoky: smoky.length,
      exposed: smoky.reduce((sum, cluster) => sum + (cluster.smoke?.settlements ?? 0), 0),
    },
    areaRanking: [...ranking.values()].sort((a, b) => b.inside - a.inside || b.near - a.near).slice(0, 8).map((entry) => ({ ...entry, frp: Math.round(entry.frp) })),
    clusters: clusters.slice(0, PRIORITY_CLUSTERS),
    exposedTowns,
    smokeError,
  }
}

// ---------- Cache ----------

export type CachedReport = { at: number; json: string; report: Report }
const reports = new Map<string, CachedReport>()
const inflight = new Map<string, Promise<CachedReport>>()

// Mengembalikan laporan segar dari cache; bila kedaluwarsa, laporan lama dikirim sambil diperbarui di latar belakang.
export async function getReport(source: Source, days: number): Promise<CachedReport> {
  const key = `${source}:${days}`
  const hit = reports.get(key)
  if (hit && Date.now() - hit.at < REPORT_TTL_MS) return hit
  let pending = inflight.get(key)
  if (!pending) {
    pending = buildReport(source, days)
      .then((report) => {
        const entry = { at: Date.now(), json: JSON.stringify(report), report }
        reports.set(key, entry)
        return entry
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  if (hit && Date.now() - hit.at < REPORT_STALE_MAX_MS) {
    pending.catch((error) => console.error(`[report] gagal memperbarui ${key}:`, error.message))
    return hit
  }
  // Laporan terlalu lama: tunggu data baru; bila sumber gagal, laporan lama masih lebih baik daripada galat.
  try {
    return await pending
  } catch (error) {
    if (hit) {
      console.error(`[report] memakai laporan lama ${key}:`, error instanceof Error ? error.message : error)
      return hit
    }
    throw error
  }
}

export function cacheStatus() {
  return [...reports.entries()].map(([key, entry]) => ({ key, ageSeconds: Math.round((Date.now() - entry.at) / 1000) }))
}

// ---------- Cek lokasi warga ----------

// Pencarian nama daerah: wilayah resmi Kemendagri lebih dulu; GeoNames hanya untuk nama yang tidak ada di sana
// (dusun/kampung), karena koordinat GeoNames kadang meleset belasan kilometer.
export function searchPlaces(query: string) {
  const official = searchWilayah(query, 8).map(({ name, label, province, lat, lon, level }) => ({ name, label, province, lat, lon, level }))
  if (!reference) return official
  const compact = (text: string) => foldSpelling(text.replace(/^(kabupaten|kota)\s+/i, ''))
  // Sama dengan wilayah resmi bila namanya serupa dan letaknya berdekatan (≤15 km).
  const duplicate = (item: { name: string; lat: number; lon: number }) => official.some((place) =>
    distanceKm(place.lat, place.lon, item.lat, item.lon) <= 15
    && (compact(place.name).startsWith(compact(item.name)) || compact(item.name).startsWith(compact(place.name))))
  const geonames = reference.settlements.search(query, 8).filter((item) => !duplicate(item))
  const label = (item: { name: string; province: string }) => `${item.name}, ${item.province} (GeoNames)`
  // Kota/kecamatan terkenal dari GeoNames (mis. Sampit) diletakkan setelah kabupaten/kecamatan resmi, sebelum desa.
  const isTown = (item: { rank: number; population: number }) => item.rank >= 2 || item.population >= 20000
  const officialNames = new Set(official.map((place) => compact(place.name)))
  const towns = geonames.filter(isTown).map((item) => ({ name: item.name, label: label(item), province: item.province, lat: item.lat, lon: item.lon, level: 1 }))
  // Dusun GeoNames yang namanya sudah ada di data resmi disembunyikan (koordinatnya bisa meleset jauh).
  const hamlets = geonames.filter((item) => !isTown(item) && !officialNames.has(compact(item.name))).map((item) => ({ name: item.name, label: label(item), province: item.province, lat: item.lat, lon: item.lon, level: 5 }))
  const areas = official.filter((place) => place.level <= 3)
  const villagesFound = official.filter((place) => place.level === 4)
  return [...areas, ...towns, ...villagesFound, ...hamlets].slice(0, 8)
}

export async function checkLocation(lat: number, lon: number, source: Source, days: number, options: { skipBmkg?: boolean } = {}): Promise<LocationCheck> {
  if (!reference) throw new Error('Data rujukan belum dimuat.')
  const { report } = await getReport(source, days)
  const place = reference.settlements.nearest(lat, lon, 15)
  const village = nearestVillage(lat, lon, 15)

  let nearest: ReportFire | null = null
  let nearestKm = Infinity
  let stationary: ReportFire | null = null
  let stationaryKm = Infinity
  const counts = { km5: 0, km10: 0, km25: 0 }
  for (const fire of report.fires) {
    // Selisih >0,5° berarti jarak >55 km; lewati bila titik yang lebih dekat sudah ditemukan.
    if ((Math.abs(fire[0] - lat) > 0.5 || Math.abs(fire[1] - lon) > 0.5) && nearestKm <= 55) continue
    const km = distanceKm(lat, lon, fire[0], fire[1])
    if (fire[13] === FLAG_STATIONARY) {
      if (km < stationaryKm) {
        stationaryKm = km
        stationary = fire
      }
      continue
    }
    if (km <= 5) counts.km5++
    if (km <= 10) counts.km10++
    if (km <= 25) counts.km25++
    if (km < nearestKm) {
      nearestKm = km
      nearest = fire
    }
  }

  const smoke = report.clusters
    .filter((cluster) => cluster.smoke && inPlume(cluster, lat, lon))
    .map((cluster) => ({
      level: cluster.smoke!.level,
      fireKm: round(distanceKm(lat, lon, cluster.lat, cluster.lon), 1),
      fireDirection: compassName(bearing(lat, lon, cluster.lat, cluster.lon)),
      place: cluster.nearest?.name ?? null,
    }))
    .sort((a, b) => levelRank(b.level.key) - levelRank(a.level.key))

  // Prakiraan BMKG ditunggu paling lama 8 detik; bila antrean penuh, hasil tetap dikirim tanpa BMKG.
  const bmkgPromise = Promise.race([
    options.skipBmkg ? Promise.resolve(null) : forecastNear(lat, lon),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]).catch((error) => {
    console.error('[lokasi] prakiraan BMKG gagal:', error instanceof Error ? error.message : error)
    return null
  })
  let air: LocationCheck['air'] = null
  try {
    const [reading] = await fetchSmoke([{ lat, lon }])
    air = { ...reading, level: ispuLevel(reading.pm25Mean24 ?? reading.pm25Now) }
  } catch (error) {
    console.error('[lokasi] kualitas udara gagal dimuat:', error instanceof Error ? error.message : error)
  }
  const bmkg = await bmkgPromise

  const candidates = [air?.level, ...smoke.map((entry) => entry.level)].filter((level) => level !== undefined)
  const level = candidates.sort((a, b) => levelRank(b.key) - levelRank(a.key))[0] ?? ispuLevel(null)

  return {
    place: village
      ? { name: village.label.split(', ').slice(0, -1).join(', '), province: village.province, km: round(village.km, 1) }
      : place.settlement ? { name: place.settlement.name, province: place.settlement.province, km: round(place.km, 1) } : null,
    nearestFire: nearest ? {
      km: round(nearestKm, 1),
      direction: compassName(bearing(lat, lon, nearest[0], nearest[1])),
      frp: nearest[5],
      date: nearest[2],
      time: nearest[3],
      settlement: nearest[7] >= 0 ? report.settlementNames[nearest[7]] : null,
      confidence: nearest[4],
    } : null,
    stationary: stationary && stationaryKm <= 25 ? {
      km: round(stationaryKm, 1),
      direction: compassName(bearing(lat, lon, stationary[0], stationary[1])),
      settlement: stationary[7] >= 0 ? report.settlementNames[stationary[7]] : null,
    } : null,
    counts,
    smoke,
    air,
    bmkg,
    level,
    source,
    days,
    fetchedAt: report.fetchedAt,
  }
}
