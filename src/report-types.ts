// Bentuk respons /api/hotspots, dipakai bersama oleh server dan halaman web.
import type { AreaKind, Cluster, IspuLevel } from './risk.ts'

// VIIRS_ALL: gabungan ketiga satelit VIIRS NASA (bawaan; satu satelit saja bisa melewatkan api karena awan atau jam lintas).
// BRIN_LAPAN: hotspot resmi pemerintah (satelit SNPP & NOAA-20 olahan BRIN/LAPAN) dari SiPongi Kementerian Kehutanan.
export const SOURCES = ['VIIRS_ALL', 'VIIRS_NOAA21_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_SNPP_NRT', 'BRIN_LAPAN'] as const
export const DEFAULT_SOURCE = 'VIIRS_ALL'
export const DAY_OPTIONS = [1, 3, 5] as const
export type Source = (typeof SOURCES)[number]

// Satu titik panas dalam bentuk larik ringkas agar payload kecil:
// [lat, lon, tanggal, jam(HHMM), confidence, frp, day/night, idx permukiman, jarak permukiman km, idx kawasan, jarak kawasan km, idx KHG, idx kabupaten, tanda]
// Indeks -1 berarti tidak ada permukiman dalam radius pencarian / tidak dekat kawasan / bukan lahan gambut / di luar batas kabupaten.
// tanda: 0 = titik panas biasa, 1 = kemungkinan sumber panas tetap (industri, pembakaran rutin); tidak dihitung dalam analisis risiko.
export type ReportFire = [number, number, string, string, string, number, string, number, number, number, number, number, number, number]
export const FLAG_STATIONARY = 1

export type RegencyRank = { name: string; province: string; total: number; high: number; nearSettlement: number; peat: number; forest: number }

export type AreaRank = { name: string; kind: AreaKind; inside: number; near: number; frp: number }

export type ReportSummary = {
  total: number
  high: number
  frp: number
  nearSettlement: number
  villages: number
  konservasi: { inside: number; areas: number; nearEdge: number }
  lindung: { inside: number; areas: number; nearEdge: number }
  peat: { inside: number; units: number }
  // Titik yang dikecualikan karena kemungkinan sumber panas tetap.
  stationary: number
  clusterCount: number
  smokeAnalyzed: number
  smoky: number
  exposed: number
}

// Kota/kecamatan yang berada di jalur asap kluster dengan kualitas udara sedang atau lebih buruk.
export type ExposedTown = {
  name: string
  province: string
  lat: number
  lon: number
  level: IspuLevel
  pm25: number | null
  population: number
  unhealthyDays: number
  fireKm: number
  fireDirection: string
}

export type LocationCheck = {
  place: { name: string; province: string; km: number } | null
  nearestFire: { km: number; direction: string; frp: number; date: string; time: string; settlement: string | null; confidence: string } | null
  // Sumber panas tetap terdekat (≤ 25 km) yang tidak dihitung sebagai kebakaran.
  stationary: { km: number; direction: string; settlement: string | null } | null
  bmkg: BmkgForecast | null
  counts: { km5: number; km10: number; km25: number }
  smoke: { level: IspuLevel; fireKm: number; fireDirection: string; place: string | null }[]
  air: { pm25Mean24: number | null; pm25Now: number | null; pm25Max24: number | null; windKmh: number; windFrom: number; unhealthyDays: number; forecastMeans: (number | null)[]; level: IspuLevel } | null
  level: IspuLevel
  source: Source
  days: number
  fetchedAt: string
}

export type Report = {
  source: Source
  days: number
  fetchedAt: string
  settlementNames: string[]
  areas: { name: string; kind: AreaKind }[]
  peatUnits: string[]
  regencyNames: string[]
  fires: ReportFire[]
  // FRP tidak tersedia pada data BRIN/LAPAN.
  frpAvailable: boolean
  regencies: RegencyRank[]
  summary: ReportSummary
  areaRanking: AreaRank[]
  clusters: Cluster[]
  exposedTowns: ExposedTown[]
  smokeError: string | null
}

// Laporan harian Satgas Karhutla per provinsi prioritas, dari dashboard BNPB.
export type BnpbProvinceReport = {
  province: string
  hotspots: number | null
  fireSpots: number | null
  burnedIndicativeHa: number | null
  burnedTodayHa: number | null
  airQuality: string
  airportVisibilityKm: string
  regenciesAffected: number | null
  landToExtinguishHa: number | null
  personnel: number | null
  waterBombingLiters: number | null
  conclusion: string
  recommendation: string
}

export type BnpbReport = { updatedAt: string; fetchedAt: string; provinces: BnpbProvinceReport[] }

// CCTV kota yang terbuka untuk publik: siaran YouTube (disematkan) dan portal milik pemda (ditautkan).
export type CctvReport = {
  fetchedAt: string
  youtube: { city: string; province: string; operator: string; channelUrl: string; streams: { id: string; location: string }[] }[]
  portals: { city: string; province: string; operator: string; url: string; note: string }[]
}

// Prakiraan cuaca BMKG untuk satu desa (sumber wajib dicantumkan: BMKG).
export type BmkgForecast = {
  code: string
  village: string
  district: string
  regency: string
  province: string
  now: { time: string; description: string; temperature: number; humidity: number; windKmh: number; windFrom: number; visibility: string | null }
  // Langkah 3 jam dalam 24 jam ke depan yang diprakirakan berasap atau udara kabur.
  hazeNext24: { time: string; description: string }[]
  fetchedAt: string
}
