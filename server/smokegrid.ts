// Sebaran asap (model): PM2.5 CAMS lewat Open-Meteo pada grid 0,5° (±55 km) di daratan Indonesia, untuk saat ini
// hingga 4 hari ke depan per 3 jam. Diperbarui tiap 6 jam. Satu titik dihitung satu panggilan oleh Open-Meteo, jadi
// ±600–700 titik × 4 kali sehari tetap jauh di bawah batas gratis (10.000/hari, 600/menit); permintaan dikirim per
// 100 titik dengan jeda 12 detik. Hasil terakhir disimpan di disk (CACHE_DIR) agar langsung tersedia setelah restart.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getReference } from './report.ts'

export type SmokeGrid = { fetchedAt: string; step: number; times: string[]; points: [number, number][]; values: number[][] }

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
async function fetchBatchWithRetry(batch: [number, number][]) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchBatch(batch)
    } catch (error) {
      if (attempt >= 3) throw error
      await pause(5000 * attempt)
    }
  }
}

async function fetchBatch(batch: [number, number][]) {
  const latitude = batch.map(([lat]) => lat).join(',')
  const longitude = batch.map(([, lon]) => lon).join(',')
  const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&hourly=pm2_5&forecast_days=5&timezone=GMT`, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Open-Meteo (${response.status}): ${(await response.text()).slice(0, 160)}`)
  const body = await response.json()
  return (Array.isArray(body) ? body : [body]) as { hourly?: { time: string[]; pm2_5: (number | null)[] } }[]
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
      const byHour = new Map(hourly.time.map((time, at) => [time.slice(0, 13), hourly.pm2_5[at]]))
      times.forEach((time, step) => {
        const value = byHour.get(time)
        if (typeof value === 'number') values[step][offset + index] = Math.round(value)
      })
    })
  }
  grid = { fetchedAt: new Date().toISOString(), step: STEP, times, points, values }
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
