// Konteks yang membuat angka terasa nyata: satwa ikonik di kawasan yang terbakar, pembanding luas dan jarak
// pandang, serta prognosis kapan udara membaik. Semua dihitung dari data yang sudah ada, tanpa klaim baru.
import { ispuLevel, levelRank, type IspuLevel } from './risk.ts'

// ---------- Satwa ikonik per kawasan ----------
// Status menurut IUCN Red List: CR = kritis, EN = genting. Kunci dicocokkan dengan bagian nama kawasan
// (huruf kecil). Hanya spesies yang memang dikenal sebagai satwa unggulan kawasan itu.

type Species = { name: string; status: 'CR' | 'EN' }

const O_KAL: Species = { name: 'orangutan kalimantan', status: 'CR' }
const O_SUM: Species = { name: 'orangutan sumatera', status: 'CR' }
const HARIMAU: Species = { name: 'harimau sumatera', status: 'CR' }
const GAJAH: Species = { name: 'gajah sumatera', status: 'CR' }
const BADAK: Species = { name: 'badak sumatera', status: 'CR' }
const BEKANTAN: Species = { name: 'bekantan', status: 'EN' }
const BANTENG: Species = { name: 'banteng', status: 'EN' }
const ANOA: Species = { name: 'anoa', status: 'EN' }

const WILDLIFE: { match: string; species: Species[] }[] = [
  { match: 'sebangau', species: [O_KAL] },
  { match: 'tanjung puting', species: [O_KAL, BEKANTAN] },
  { match: 'gunung palung', species: [O_KAL] },
  { match: 'betung kerihun', species: [O_KAL] },
  { match: 'bukit baka', species: [O_KAL] },
  { match: 'kutai', species: [O_KAL, BEKANTAN] },
  { match: 'danau sentarum', species: [BEKANTAN] },
  { match: 'berbak', species: [HARIMAU] },
  { match: 'kerinci seblat', species: [HARIMAU] },
  { match: 'bukit tiga puluh', species: [HARIMAU, GAJAH] },
  { match: 'tesso nilo', species: [GAJAH, HARIMAU] },
  { match: 'way kambas', species: [GAJAH, BADAK] },
  { match: 'bukit barisan selatan', species: [BADAK, HARIMAU, GAJAH] },
  { match: 'gunung leuser', species: [O_SUM, HARIMAU, GAJAH, BADAK] },
  { match: 'meru betiri', species: [{ name: 'macan tutul jawa', status: 'CR' }] },
  { match: 'baluran', species: [BANTENG] },
  { match: 'alas purwo', species: [BANTENG] },
  { match: 'gede pangrango', species: [{ name: 'owa jawa', status: 'EN' }] },
  { match: 'lore lindu', species: [ANOA] },
  { match: 'rawa aopa', species: [ANOA] },
  { match: 'bogani nani wartabone', species: [{ name: 'maleo', status: 'EN' }, ANOA] },
]

export function wildlifeFor(areaName: string): Species[] {
  const name = areaName.toLowerCase()
  return WILDLIFE.find((entry) => name.includes(entry.match))?.species ?? []
}

const STATUS_LABEL = { CR: 'kritis', EN: 'genting' } as const

export const speciesText = (species: Species) => `${species.name} (${STATUS_LABEL[species.status]})`

// ---------- Pembanding luas ----------

const FOOTBALL_FIELD_HA = 0.714 // 105 m × 68 m
const JAKARTA_HA = 66_100

export function footballFields(hectares: number | null) {
  if (hectares === null || hectares < 1) return null
  const fields = hectares / FOOTBALL_FIELD_HA
  const text = fields >= 1000 ? `±${(fields / 1000).toFixed(1).replace('.', ',')} ribu lapangan sepak bola` : `±${Math.round(fields)} lapangan sepak bola`
  const jakarta = hectares / JAKARTA_HA
  return jakarta >= 0.3 ? `${text}, ${jakarta.toFixed(1).replace('.', ',')} kali luas DKI Jakarta` : text
}

// ---------- Jarak pandang ----------

// "0.2 - 7", "≤ 0.7 - 2", "< 7", "3.5": ambil angka terkecil (kondisi terburuk) dalam km.
export function worstVisibilityKm(text: string | null | undefined) {
  const numbers = (text ?? '').replace(/,/g, '.').match(/\d+(?:\.\d+)?/g)?.map(Number)
  return numbers?.length ? Math.min(...numbers) : null
}

export function visibilityComparison(text: string | null | undefined) {
  const km = worstVisibilityKm(text)
  if (km === null) return null
  const meters = km * 1000
  const fields = meters / 105
  if (meters < 100) return `terburuk ${Math.round(meters)} m: kurang dari panjang satu lapangan sepak bola`
  if (meters <= 1500) return `terburuk ${Math.round(meters)} m ≈ ${Math.max(1, Math.round(fields))} lapangan sepak bola berjajar; yang lebih jauh tak terlihat`
  return `terburuk ${km.toFixed(1).replace('.', ',')} km; di bawah 10 km udara sudah terasa kabur`
}

// ---------- Prognosis kapan udara membaik ----------

const DAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' })

export type Prognosis = {
  chips: { label: string; level: IspuLevel; pm25: number | null }[]
  text: string
}

// forecastMeans: 4 periode 24 jam ke depan. Chip pertama = periode 24 jam terakhir (kondisi sekarang).
export function prognosis(current: IspuLevel, currentMean: number | null, forecastMeans: (number | null)[], now = Date.now()): Prognosis | null {
  if (!forecastMeans.some((value) => value !== null)) return null
  const chips = [
    { label: 'Kemarin–kini', level: ispuLevel(currentMean), pm25: currentMean },
    ...forecastMeans.map((pm25, index) => ({
      label: DAY.format(new Date(now + index * 24 * 3600 * 1000 + 12 * 3600 * 1000)),
      level: ispuLevel(pm25),
      pm25,
    })),
  ]
  const unhealthyNow = levelRank(current.key) >= levelRank('tidak-sehat')
  const firstBetter = forecastMeans.findIndex((value) => value !== null && value < 55.5)
  const worstAhead = forecastMeans.reduce<number>((worst, value) => Math.max(worst, value ?? 0), 0)
  let text: string
  if (unhealthyNow) {
    text = firstBetter >= 0
      ? `Prakiraan model: udara diperkirakan membaik ke kategori "${ispuLevel(forecastMeans[firstBetter]).label}" pada ${chips[firstBetter + 1].label}.`
      : 'Prakiraan model: belum ada tanda udara membaik dalam 4 hari ke depan. Bertahan dengan langkah aman.'
  } else if (worstAhead >= 55.5) {
    const idx = forecastMeans.findIndex((value) => value !== null && value >= 55.5)
    text = `Prakiraan model: udara diperkirakan memburuk menjadi "${ispuLevel(forecastMeans[idx]).label}" pada ${chips[idx + 1].label}. Siapkan masker.`
  } else {
    text = 'Prakiraan model: udara diperkirakan tetap tidak memburuk dalam 4 hari ke depan.'
  }
  return { chips, text: `${text} Hujan dan angin dapat mengubah ini sewaktu-waktu.` }
}
