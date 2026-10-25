// Keterangan waktu data dalam zona waktu setempat (WIB/WITA/WIT), dipakai di halaman, teks bagikan, dan gambar.
// Angka kualitas udara adalah rata-rata 24 jam hingga jam pengambilan data, jadi jam dibulatkan ke bawah.

type Zone = { tz: string; label: 'WIB' | 'WITA' | 'WIT' }

const WIB: Zone = { tz: 'Asia/Jakarta', label: 'WIB' }
const WITA: Zone = { tz: 'Asia/Makassar', label: 'WITA' }
const WIT: Zone = { tz: 'Asia/Jayapura', label: 'WIT' }

export function zoneFor(province?: string | null, lon?: number | null): Zone {
  const name = (province ?? '').toLowerCase()
  if (/maluku|papua/.test(name)) return WIT
  if (/bali|nusa tenggara|kalimantan (selatan|timur|utara)|sulawesi|gorontalo/.test(name)) return WITA
  if (name) return WIB
  // Tanpa provinsi: perkiraan kasar dari bujur.
  if (lon !== null && lon !== undefined && lon >= 127) return WIT
  if (lon !== null && lon !== undefined && lon >= 116) return WITA
  return WIB
}

function parts(iso: string, zone: Zone) {
  const date = new Date(iso)
  date.setUTCMinutes(0, 0, 0)
  const get = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('id-ID', { ...options, timeZone: zone.tz }).format(date)
  return {
    weekday: get({ weekday: 'long' }),
    day: get({ day: 'numeric' }),
    month: get({ month: 'short' }).replace('.', ''),
    hour: get({ hour: '2-digit', hourCycle: 'h23' }).padStart(2, '0'),
  }
}

// "Jumat 24 Okt, 14.00 WIB": untuk apa pun yang dibawa keluar situs (teks bagikan, gambar).
export function stampText(iso: string, province?: string | null, lon?: number | null) {
  const zone = zoneFor(province, lon)
  const p = parts(iso, zone)
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}.00 ${zone.label}`
}

// "14.00 WIB": untuk halaman situs, yang selalu menampilkan data terbaru.
export function hourText(iso: string, province?: string | null, lon?: number | null) {
  const zone = zoneFor(province, lon)
  return `${parts(iso, zone).hour}.00 ${zone.label}`
}

// Nama tempat ringkas untuk teks pendek: tanpa kecamatan, dan tanpa provinsi bila masih ada nama kota/kabupaten.
// "Kel. Palangka, Kec. Jekan Raya, Kota Palangkaraya, Kalimantan Tengah" -> "Kel. Palangka, Kota Palangkaraya"
export function shortPlace(place: string) {
  const segments = place.split(',').map((segment) => segment.trim()).filter((segment) => segment && !/^kec(\.|amatan)\s/i.test(segment))
  return (segments.length > 2 ? segments.slice(0, -1) : segments).join(', ')
}
