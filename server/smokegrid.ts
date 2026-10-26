// Sebaran asap (model): PM2.5 CAMS lewat Open-Meteo pada grid 0,5° (±55 km) di daratan Indonesia, untuk saat ini
// hingga 4 hari ke depan per 3 jam. Diperbarui tiap 6 jam. Satu titik dihitung satu panggilan oleh Open-Meteo, jadi
// ±600–700 titik × 4 kali sehari tetap jauh di bawah batas gratis (10.000/hari, 600/menit); permintaan dikirim per
// 100 titik dengan jeda 12 detik. Hasil terakhir disimpan di disk (CACHE_DIR) agar langsung tersedia setelah restart.
// Angin untuk animasi partikel: kisi teratur 1,5° termasuk laut (462 titik, u/v dalam km/jam), diperbarui paling
// sering tiap 12 jam (±900 panggilan/hari). Bila gagal, grid asap tetap diperbarui dan data angin lama dipakai.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getReference } from './report.ts'

// u/v: komponen angin ke arah timur/utara (km/jam), per waktu, berurutan baris demi baris dari selatan-barat.
export type WindGrid = { fetchedAt: string; step: number; west: number; south: number; nx: number; ny: number; times: string[]; u: number[][]; v: number[][] }
export type SmokeGrid = { fetchedAt: string; step: number; times: string[]; points: [number, number][]; values: number[][]; wind?: WindGrid }

const STEP = 0.5
const BBOX = { west: 95, east: 141.5, south: -11, north: 6 }
const LAND_BUFFER_KM = 15
const BATCH = 100
const BATCH_GAP_MS = 12_000
const REFRESH_MS = 6 * 3600 * 1000
const RETRY_MS = 30 * 60 * 1000
const MAX_AGE_MS = 12 * 3600 * 1000
const HOURS_AHEAD = 96
const HOUR_STEP = 3
const CACHE_FILE = path.join(process.env.CACHE_DIR ?? tmpdir(), 'sebaran-asap.json')
const WIND = { step: 1.5, west: 94, south: -12, nx: 33, ny: 14 }
const WIND_REFRESH_MS = 11 * 3600 * 1000

let grid: SmokeGrid | null = null
let points: [number, number][] | null = null
let building = false
let lastError: string | null = null

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function landPoints(): [number, number][] | null {
  const reference = getReference()
  if (!reference) return null
  const list: [number, number][] = []
  for (let lat = BBOX.south + STEP / 2; lat < BBOX.north; lat += STEP) {
    for (let lon = BBOX.west + STEP / 2; lon < BBOX.east; lon += STEP) {
      if (reference.provinces.locate(lat, lon, LAND_BUFFER_KM)) list.push([Number(lat.toFixed(2)), Number(lon.toFixed(2))])
    }
  }
  return list
}

// Tiap kelompok dicoba hingga 3 kali: gangguan jaringan sesaat jangan sampai menggagalkan seluruh grid.
async function fetchBatchWithRetry(batch: [number, number][], fetcher: (batch: [number, number][]) => Promise<HourlyResult[]> = fetchBatch) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetcher(batch)
    } catch (error) {
      if (attempt >= 3) throw error
      await pause(5000 * attempt)
    }
  }
}

type HourlyResult = { hourly?: { time: string[]; [variable: string]: (number | null)[] | string[] } }

async function openMeteo(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Open-Meteo (${response.status}): ${(await response.text()).slice(0, 160)}`)
  const body = await response.json()
  return (Array.isArray(body) ? body : [body]) as HourlyResult[]
}

const coords = (batch: [number, number][]) => `latitude=${batch.map(([lat]) => lat).join(',')}&longitude=${batch.map(([, lon]) => lon).join(',')}`

function fetchBatch(batch: [number, number][]) {
  return openMeteo(`https://air-quality-api.open-meteo.com/v1/air-quality?${coords(batch)}&hourly=pm2_5&forecast_days=5&timezone=GMT`)
}

function fetchWindBatch(batch: [number, number][]) {
  return openMeteo(`https://api.open-meteo.com/v1/forecast?${coords(batch)}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh&forecast_days=5&timezone=GMT`)
}

async function buildWind(times: string[]): Promise<WindGrid> {
  const nodes: [number, number][] = []
  for (let row = 0; row < WIND.ny; row++) {
    for (let col = 0; col < WIND.nx; col++) nodes.push([WIND.south + row * WIND.step, WIND.west + col * WIND.step])
  }
  const u = times.map(() => new Array<number>(nodes.length).fill(0))
  const v = times.map(() => new Array<number>(nodes.length).fill(0))
  for (let offset = 0; offset < nodes.length; offset += BATCH) {
    await pause(BATCH_GAP_MS)
    const results = await fetchBatchWithRetry(nodes.slice(offset, offset + BATCH), fetchWindBatch)
    results.forEach((result, index) => {
      const hourly = result.hourly
      if (!hourly) return
      const speed = hourly.wind_speed_10m as (number | null)[]
      const from = hourly.wind_direction_10m as (number | null)[]
      const byHour = new Map(hourly.time.map((time, at) => [time.slice(0, 13), at]))
      times.forEach((time, step) => {
        const at = byHour.get(time)
        if (at === undefined || typeof speed[at] !== 'number' || typeof from[at] !== 'number') return
        // Arah angin meteorologi = arah datang; partikel bergerak ke arah sebaliknya.
        const radians = (from[at]! * Math.PI) / 180
        u[step][offset + index] = Math.round(-speed[at]! * Math.sin(radians) * 10) / 10
        v[step][offset + index] = Math.round(-speed[at]! * Math.cos(radians) * 10) / 10
      })
    })
  }
  return { fetchedAt: new Date().toISOString(), ...WIND, times, u, v }
}

async function rebuild() {
  points ??= landPoints()
  if (!points) throw new Error('Data rujukan belum dimuat.')
  const now = Date.now()
  const start = now - (now % (3600 * 1000))
  const times: string[] = []
  for (let hour = 0; hour <= HOURS_AHEAD; hour += HOUR_STEP) times.push(new Date(start + hour * 3600 * 1000).toISOString().slice(0, 13))
  const values = times.map(() => new Array<number>(points!.length).fill(-1))
  for (let offset = 0; offset < points.length; offset += BATCH) {
    if (offset) await pause(BATCH_GAP_MS)
    const results = await fetchBatchWithRetry(points.slice(offset, offset + BATCH))
    results.forEach((result, index) => {
      const hourly = result.hourly
      if (!hourly) return
      const pm25 = hourly.pm2_5 as (number | null)[]
      const byHour = new Map(hourly.time.map((time, at) => [time.slice(0, 13), pm25[at]]))
      times.forEach((time, step) => {
        const value = byHour.get(time)
        if (typeof value === 'number') values[step][offset + index] = Math.round(value)
      })
    })
  }
  let wind = grid?.wind
  if (!wind || Date.now() - Date.parse(wind.fetchedAt) > WIND_REFRESH_MS) {
    try {
      wind = await buildWind(times)
      console.log(`[sebaran asap] angin ${WIND.nx * WIND.ny} titik diperbarui`)
    } catch (error) {
      console.error('[sebaran asap] angin gagal diperbarui, data lama dipakai:', error instanceof Error ? error.message : error)
    }
  }
  grid = { fetchedAt: new Date().toISOString(), step: STEP, times, points, values, wind }
  await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => writeFile(CACHE_FILE, JSON.stringify(grid)))
    .catch((error) => console.warn('[sebaran asap] cache disk gagal ditulis:', error.message))
  console.log(`[sebaran asap] ${points.length} titik grid diperbarui`)
}

async function refresh() {
  if (building) return
  building = true
  try {
    await rebuild()
    lastError = null
    setTimeout(() => void refresh(), REFRESH_MS).unref()
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && error.cause instanceof Error ? ` (sebab: ${(error.cause as NodeJS.ErrnoException).code ?? ''} ${error.cause.message})` : ''
    console.error(`[sebaran asap] gagal memperbarui: ${lastError}${cause}`)
    setTimeout(() => void refresh(), getReference() ? RETRY_MS : 30_000).unref()
  } finally {
    building = false
  }
}

export async function startSmokeGrid() {
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as SmokeGrid
    if (Date.now() - Date.parse(saved.fetchedAt) < MAX_AGE_MS) grid = saved
  } catch {
    // Belum ada salinan.
  }
  // Salinan disk yang masih segar dipakai dulu; pembaruan berikutnya menyesuaikan sisa umurnya.
  const age = grid ? Date.now() - Date.parse(grid.fetchedAt) : Infinity
  setTimeout(() => void refresh(), Math.max(30_000, REFRESH_MS - age)).unref()
}

export function getSmokeGrid(): SmokeGrid | { building: true; error: string | null } {
  return grid ?? { building: true, error: lastError }
}
