// Laporan harian Satgas Karhutla dari dashboard BNPB (gis.bnpb.go.id/karhutla2026), di-cache 15 menit.
// Bila BNPB tidak dapat dihubungi, laporan terakhir yang berhasil tetap dikirim; salinannya disimpan
// di disk (CACHE_DIR) agar tetap tersedia setelah server dimulai ulang.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BnpbProvinceReport, BnpbReport } from '../src/report-types.ts'

const CACHE_FILE = path.join(process.env.CACHE_DIR ?? tmpdir(), 'bnpb-terakhir.json')

const URL_BNPB = 'https://gis.bnpb.go.id/karhutla2026/karhutla-api.php'
const TTL_MS = 15 * 60 * 1000
const PROVINCES: Record<string, string> = {
  sumsel: 'Sumatera Selatan',
  sumbar: 'Sumatera Barat',
  sumut: 'Sumatera Utara',
  kalbar: 'Kalimantan Barat',
  kalteng: 'Kalimantan Tengah',
  kalsel: 'Kalimantan Selatan',
  kaltim: 'Kalimantan Timur',
  kaltara: 'Kalimantan Utara',
  ntt: 'Nusa Tenggara Timur',
  ntb: 'Nusa Tenggara Barat',
}

type Row = Record<string, string | number | null>

const text = (value: unknown) => String(value ?? '').replace(/\s+\n/g, '\n').trim().replace(/^-$/, '')
function number(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number(String(value ?? '').replace(/\./g, '').replace(',', '.'))
  return String(value ?? '').trim() && Number.isFinite(parsed) ? parsed : null
}

function normalize(row: Row): BnpbProvinceReport {
  const raw = text(row.Provinsi)
  return {
    province: PROVINCES[raw.toLowerCase()] ?? raw,
    hotspots: number(row['Total Hotspot']),
    fireSpots: number(row['Fire Spot']),
    burnedIndicativeHa: number(row['Lahan Terbakar Indikatif (Ha)']),
    burnedTodayHa: number(row['Lahan Terbakar Harian (Ha)']),
    airQuality: text(row['Kualitas Udara (PM 25)']).replace(/Sanagat/i, 'Sangat'),
    airportVisibilityKm: text(row['Jarak Pandang Bandara (Km)']),
    regenciesAffected: number(row['Kabkot Terdampak']),
    landToExtinguishHa: number(row['luas lahan yang akan dipadamkan']),
    personnel: number(row['Total Personel']),
    waterBombingLiters: number(row['Volume WB (Ltr)']),
    conclusion: text(row.kesimpulan).slice(0, 1500),
    recommendation: text(row.rekomendasi).slice(0, 1500),
  }
}

let cached: { at: number; report: BnpbReport } | null = null
let pending: Promise<BnpbReport> | null = null

async function load(): Promise<BnpbReport> {
  const response = await fetch(`${URL_BNPB}?t=${Date.now()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PemantauKarhutla/1.0; +https://amukapi.santaralabs.ai)',
      Referer: 'https://gis.bnpb.go.id/karhutla2026/',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`BNPB (${response.status})`)
  const body = await response.json() as { updatedAt?: string; rows?: Row[] }
  if (!Array.isArray(body.rows)) throw new Error('Format laporan BNPB berubah.')
  const report: BnpbReport = {
    updatedAt: body.updatedAt ?? '',
    fetchedAt: new Date().toISOString(),
    provinces: body.rows.filter((row) => text(row.Provinsi)).map(normalize),
  }
  await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    .then(() => writeFile(CACHE_FILE, JSON.stringify(report)))
    .catch((error) => console.warn('[bnpb] cache disk gagal ditulis:', error.message))
  return report
}

async function readDiskCache(): Promise<BnpbReport | null> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, 'utf8')) as BnpbReport
  } catch {
    return null
  }
}

export async function getBnpbReport(): Promise<BnpbReport> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.report
  pending ??= load()
    .then((report) => {
      cached = { at: Date.now(), report }
      return report
    })
    .finally(() => { pending = null })
  try {
    return await pending
  } catch (error) {
    const fallback = cached?.report ?? await readDiskCache()
    if (fallback) {
      console.error('[bnpb] memakai laporan terakhir:', error instanceof Error ? error.message : error)
      // Simpan di memori agar BNPB tidak dihubungi ulang di setiap permintaan selama gangguan.
      cached = { at: Date.now() - TTL_MS + 60_000, report: fallback }
      return fallback
    }
    throw error
  }
}
