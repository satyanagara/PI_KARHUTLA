// Timeline jumlah titik panas harian (gabungan tiga satelit VIIRS NASA, seluruh Indonesia), dipecah menjadi titik
// di lahan gambut dan lainnya, dengan jumlah keyakinan tinggi. Hari dihitung menurut WIB (UTC+7).
//
// FIRMS hanya mengizinkan 5 hari per permintaan, jadi data diambil per jendela 3 hari dengan kolom ringkas dan
// langsung diringkas menjadi angka harian. Hari yang sudah lengkap disimpan di disk (CACHE_DIR) dan tidak dihitung
// ulang; hanya 2 hari terakhir yang diperbarui. Perhitungan dipecah-pecah agar server tetap responsif.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { NASA_SOURCES, fetchFirms, getReference, mergeViirs } from './report.ts'
import type { Fire } from '../src/risk.ts'
import type { TimelineDay, TimelineReport } from '../src/report-types.ts'

const DAYS = 14
const WINDOW_DAYS = 3
const REFRESH_MS = 30 * 60 * 1000
const WIB_MS = 7 * 3600 * 1000
const KEEP = ['latitude', 'longitude', 'acq_date', 'acq_time', 'daynight', 'frp', 'confidence']
const CACHE_FILE = path.join(process.env.CACHE_DIR ?? tmpdir(), 'timeline-harian.json')

const days = new Map<string, TimelineDay>()
let fetchedAt = ''
let building: Promise<void> | null = null
let lastError: string | null = null

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const wibDate = (utcDate: string, hhmm: string) => {
  const padded = hhmm.padStart(4, '0')
  return isoDate(Date.parse(`${utcDate}T${padded.slice(0, 2)}:${padded.slice(2)}:00Z`) + WIB_MS)
}

async function loadDisk() {
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, 'utf8')) as { days: TimelineDay[]; fetchedAt: string }
    for (const day of saved.days) days.set(day.date, day)
    fetchedAt = saved.fetchedAt
  } catch {
    // Belum ada salinan; dibangun dari awal.
  }
}

async function saveDisk() {
  await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => writeFile(CACHE_FILE, JSON.stringify({ days: [...days.values()], fetchedAt })))
    .catch((error) => console.warn('[timeline] cache disk gagal ditulis:', error.message))
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

// Ringkas satu jendela UTC [startDate, +WINDOW_DAYS) menjadi hitungan per hari WIB.
async function summarizeWindow(startDate: string, length: number, counts: Map<string, TimelineDay>) {
  const reference = getReference()
  if (!reference) throw new Error('Data rujukan belum dimuat.')
  const sets: Fire[][] = []
  for (const source of NASA_SOURCES) sets.push(await fetchFirms(source, length, startDate, KEEP))
  const merged = mergeViirs(sets)
  sets.length = 0
  let processed = 0
  for (const fire of merged) {
    const lat = Number(fire.latitude)
    const lon = Number(fire.longitude)
    if (++processed % 2500 === 0) await tick()
    if (!reference.provinces.locate(lat, lon, 2)) continue
    const date = wibDate(fire.acq_date, fire.acq_time ?? '0000')
    const day = counts.get(date) ?? { date, total: 0, peat: 0, high: 0 }
    day.total++
    if (reference.peat.locate(lat, lon, 0)) day.peat++
    const confidence = String(fire.confidence ?? '').toLowerCase()
    if (confidence === 'h' || Number(confidence) >= 80) day.high++
    counts.set(date, day)
  }
}

async function rebuild() {
  const today = isoDate(Date.now() + WIB_MS)
  const wanted: string[] = []
  for (let i = DAYS; i >= 0; i--) wanted.push(isoDate(Date.parse(`${today}T00:00:00Z`) - i * 24 * 3600 * 1000))
  // Hari lengkap yang sudah tersimpan dilewati; hari ini dan kemarin selalu dihitung ulang.
  const recompute = new Set(wanted.filter((date, index) => !days.has(date) || index >= wanted.length - 2))
  const oldest = [...recompute].sort()[0]
  if (!oldest) return
  // Tanggal UTC yang perlu diminta: satu hari sebelum hari WIB tertua (hari WIB dimulai 17.00 UTC sebelumnya).
  const startMs = Date.parse(`${oldest}T00:00:00Z`) - 24 * 3600 * 1000
  const endMs = Date.parse(`${today}T00:00:00Z`) + 24 * 3600 * 1000
  const counts = new Map<string, TimelineDay>()
  for (let ms = startMs; ms <= endMs; ms += WINDOW_DAYS * 24 * 3600 * 1000) {
    const length = Math.min(WINDOW_DAYS, Math.round((endMs - ms) / (24 * 3600 * 1000)) + 1)
    await summarizeWindow(isoDate(ms), length, counts)
  }
  for (const date of recompute) {
    const day = counts.get(date) ?? { date, total: 0, peat: 0, high: 0 }
    days.set(date, day)
  }
  // Buang hari di luar rentang.
  for (const date of days.keys()) if (!wanted.includes(date)) days.delete(date)
  fetchedAt = new Date().toISOString()
  await saveDisk()
}

export function refreshTimeline(): Promise<void> {
  building ??= rebuild()
    .then(() => { lastError = null })
    .catch((error) => {
      lastError = error instanceof Error ? error.message : String(error)
      console.error('[timeline] gagal memperbarui:', lastError)
    })
    .finally(() => { building = null })
  return building
}

export async function startTimeline() {
  await loadDisk()
  void refreshTimeline()
  setInterval(() => void refreshTimeline(), REFRESH_MS).unref()
}

export function getTimeline(): TimelineReport | { building: true; error: string | null } {
  const today = isoDate(Date.now() + WIB_MS)
  const list = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (list.length < 3) return { building: true, error: lastError }
  return { fetchedAt, today, days: list }
}
