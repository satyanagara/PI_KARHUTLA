// Daftar CCTV kota yang terbuka untuk publik di daerah terdampak asap.
// Siaran YouTube dibaca dari feed RSS resmi kanal (video live berganti ID beberapa hari sekali),
// portal lain hanya ditautkan karena belum ada izin untuk menampilkannya di situs ini.
import type { CctvReport } from '../src/report-types.ts'

const TTL_MS = 30 * 60 * 1000

const CHANNELS = [
  { city: 'Pontianak', province: 'Kalimantan Barat', operator: 'Dishub Kota Pontianak', channelId: 'UCzCU5y8MsI7tgXEmV2ZpUBw', handle: '@CCTVDISHUBKOTAPONTIANAK' },
  { city: 'Samarinda', province: 'Kalimantan Timur', operator: 'Diskominfo Kota Samarinda', channelId: 'UCnHBvU8haQXiQhouEYg6iuA', handle: '@CCTVSAMARINDA' },
]

export const CCTV_PORTALS: CctvReport['portals'] = [
  { city: 'Palembang', province: 'Sumatera Selatan', operator: 'Diskominfo Kota Palembang', url: 'https://cctv.palembang.go.id/', note: 'Kamera "ARAH BKB" (Benteng Kuto Besak) memperlihatkan Sungai Musi dan Jembatan Ampera; kabut asap tampak jelas.' },
  { city: 'Pekanbaru', province: 'Riau', operator: 'Diskominfotiksan Kota Pekanbaru', url: 'https://cctv.pekanbaru.go.id/cam', note: 'Kamera di jalan panjang memperlihatkan jarak pandang.' },
  { city: 'Banjarbaru', province: 'Kalimantan Selatan', operator: 'Diskominfo Kota Banjarbaru', url: 'https://cctv.banjarbarukota.go.id/', note: '69 kamera lalu lintas kota.' },
  { city: 'Banjarmasin', province: 'Kalimantan Selatan', operator: 'Diskominfotik Kota Banjarmasin', url: 'https://cctv.banjarmasinkota.go.id/', note: 'Kamera lalu lintas kota.' },
  { city: 'Jambi', province: 'Jambi', operator: 'Pemerintah Kota Jambi', url: 'https://cctv.jambikota.go.id/', note: 'Kamera lalu lintas kota.' },
]

// "LIVE | Pantauan CCTV Samarinda - Wilayah Fly Over 17/10/2026" -> "Wilayah Fly Over"
function locationOf(title: string) {
  return title
    .replace(/🔴/g, '')
    .replace(/^\s*LIVE\s*\|?\s*/i, '')
    .replace(/^Pantauan CCTV [^-]+-\s*/i, '')
    .replace(/\s+\d{1,2}\/\d{1,2}\/\d{4}.*$/, '')
    .replace(/\s+\d\/\d$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function readChannel(channel: (typeof CHANNELS)[number]) {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`YouTube RSS (${response.status})`)
  const xml = await response.text()
  const newest = new Map<string, { id: string; title: string; location: string; published: string }>()
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = entry.match(/<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/)?.[1]
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1]?.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") ?? ''
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? ''
    if (!id || !/live/i.test(title)) continue
    const location = locationOf(title)
    // Lewati siaran umum kanal yang bukan satu lokasi kamera.
    if (!location || /stream cctv/i.test(title)) continue
    const known = newest.get(location.toLowerCase())
    if (!known || published > known.published) newest.set(location.toLowerCase(), { id, title, location, published })
  }
  return {
    city: channel.city,
    province: channel.province,
    operator: channel.operator,
    channelUrl: `https://www.youtube.com/${channel.handle}/streams`,
    streams: [...newest.values()].sort((a, b) => a.location.localeCompare(b.location, 'id')).map(({ id, location }) => ({ id, location })),
  }
}

let cached: { at: number; report: CctvReport } | null = null
let pending: Promise<CctvReport> | null = null

export async function getCctv(): Promise<CctvReport> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.report
  pending ??= Promise.allSettled(CHANNELS.map(readChannel))
    .then((results) => {
      const youtube = results.flatMap((result, index) => {
        if (result.status === 'fulfilled') return [result.value]
        console.error(`[cctv] ${CHANNELS[index].city}:`, result.reason instanceof Error ? result.reason.message : result.reason)
        // Pertahankan daftar terakhir bila feed sedang gagal.
        return cached?.report.youtube.filter((item) => item.city === CHANNELS[index].city) ?? []
      })
      const report: CctvReport = { fetchedAt: new Date().toISOString(), youtube, portals: CCTV_PORTALS }
      cached = { at: Date.now(), report }
      return report
    })
    .finally(() => { pending = null })
  return pending
}
