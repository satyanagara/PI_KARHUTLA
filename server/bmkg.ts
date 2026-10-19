// Prakiraan cuaca BMKG per desa (https://data.bmkg.go.id/prakiraan-cuaca/).
// Ketentuan BMKG: wajib mencantumkan BMKG sebagai sumber, batas 60 permintaan per menit per IP, data diperbarui
// 2 kali sehari. Karena itu permintaan diantrekan (±1 per 1,1 detik) dan hasilnya di-cache 3 jam per desa.
import { nearestVillage } from './wilayah.ts'
import type { BmkgForecast } from '../src/report-types.ts'

const API = 'https://api.bmkg.go.id/publik/prakiraan-cuaca'
const CACHE_TTL_MS = 3 * 60 * 60 * 1000
const MIN_INTERVAL_MS = 1100
const HAZE = /asap|kabur|haze|smoke/i

// ---------- Antrean permintaan & cache ----------

const cache = new Map<string, { at: number; forecast: BmkgForecast }>()
const inflight = new Map<string, Promise<BmkgForecast>>()
let queue: Promise<unknown> = Promise.resolve()
let lastRequest = 0

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastRequest = Date.now()
    return task()
  })
  queue = run.catch(() => undefined)
  return run
}

type Step = {
  utc_datetime: string
  local_datetime: string
  t: number
  hu: number
  ws: number
  wd_deg: number
  vs_text: string | null
  weather_desc: string
}

async function fetchForecast(code: string): Promise<BmkgForecast> {
  const response = await throttled(() => fetch(`${API}?adm4=${encodeURIComponent(code)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PemantauKarhutla/1.0; +https://amukapi.santaralabs.ai)', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  }))
  if (!response.ok) throw new Error(`BMKG (${response.status})`)
  const body = await response.json() as {
    lokasi: { desa: string; kecamatan: string; kotkab: string; provinsi: string }
    data: { cuaca: Step[][] }[]
  }
  const steps = (body.data?.[0]?.cuaca ?? []).flat()
    .map((step) => ({ ...step, at: Date.parse(`${step.utc_datetime.replace(' ', 'T')}Z`) }))
    .filter((step) => Number.isFinite(step.at))
    .sort((a, b) => a.at - b.at)
  if (!steps.length) throw new Error('Prakiraan BMKG kosong.')
  const now = Date.now()
  // Langkah 3 jam yang sedang berlaku: yang terakhir dimulai sebelum sekarang, atau langkah pertama.
  const current = [...steps].reverse().find((step) => step.at <= now) ?? steps[0]
  const next24 = steps.filter((step) => step.at >= current.at && step.at <= now + 24 * 3600 * 1000)
  return {
    code,
    village: body.lokasi?.desa ?? '',
    district: body.lokasi?.kecamatan ?? '',
    regency: body.lokasi?.kotkab ?? '',
    province: body.lokasi?.provinsi ?? '',
    now: {
      time: current.local_datetime,
      description: current.weather_desc,
      temperature: current.t,
      humidity: current.hu,
      windKmh: current.ws,
      windFrom: current.wd_deg,
      visibility: current.vs_text ?? null,
    },
    hazeNext24: next24.filter((step) => HAZE.test(step.weather_desc)).map((step) => ({ time: step.local_datetime, description: step.weather_desc })),
    fetchedAt: new Date(now).toISOString(),
  }
}

async function forecastFor(code: string): Promise<BmkgForecast> {
  const hit = cache.get(code)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.forecast
  let pending = inflight.get(code)
  if (!pending) {
    pending = fetchForecast(code)
      .then((forecast) => {
        cache.set(code, { at: Date.now(), forecast })
        return forecast
      })
      .finally(() => inflight.delete(code))
    inflight.set(code, pending)
  }
  try {
    return await pending
  } catch (error) {
    if (hit) return hit.forecast
    throw error
  }
}

// Prakiraan BMKG untuk desa terdekat dari sebuah titik (dalam 15 km); null bila tidak ada desa terdekat.
export async function forecastNear(lat: number, lon: number): Promise<BmkgForecast | null> {
  const village = nearestVillage(lat, lon)
  return village ? forecastFor(village.code) : null
}

export const isHaze = (description: string) => HAZE.test(description)
