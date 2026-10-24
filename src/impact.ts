// Membuat informasi kualitas udara terasa dekat dan mendorong tindakan: setara rokok, hari berturut-turut,
// langkah aman yang bisa dicentang, dan kartu siap bagikan. Ketakutan selalu dipasangkan dengan langkah konkret.
import { cigarettesPerDay, type IspuLevel } from './risk.ts'
import { levelIcon } from './icons.ts'

const SITE = 'amukapi.santaralabs.ai'

// Ajakan perilaku: pembakaran sampah di permukiman menambah asap tepat di tempat orang bernapas.
const NO_BURNING = 'Jangan menambah asap: tunda membakar sampah selama kabut asap (membakar sampah terbuka juga dilarang UU 18/2008).'

export const SAFETY_STEPS: Record<string, string[]> = {
  baik: [
    'Udara bersih, aman beraktivitas di luar.',
    'Tetap pantau arah asap beberapa jam ke depan.',
    'Melihat api? Laporkan ke 112 atau BPBD setempat.',
  ],
  sedang: [
    'Kelompok sensitif (anak, lansia, penderita asma) kurangi aktivitas berat di luar.',
    'Siapkan masker N95/KN95 di rumah.',
    'Pantau perkembangan asap beberapa jam ke depan.',
    NO_BURNING,
  ],
  'tidak-sehat': [
    'Tutup jendela dan pintu.',
    'Pakai masker N95/KN95 saat keluar; masker kain tidak menyaring asap.',
    'Anak, lansia, ibu hamil, dan penderita asma tetap di dalam ruangan.',
    NO_BURNING,
  ],
  'sangat-tidak-sehat': [
    'Tutup jendela, pintu, dan celah-celahnya dengan kain basah.',
    'Hindari keluar rumah; bila terpaksa, pakai N95/KN95.',
    'Siapkan satu ruangan paling tertutup sebagai ruang bersih untuk kelompok rentan.',
    NO_BURNING,
  ],
  berbahaya: [
    'Tetap di dalam ruangan tertutup; tutup celah dengan kain basah.',
    'Kelompok rentan sebaiknya pindah sementara ke tempat berudara bersih.',
    'Sesak napas, nyeri dada, atau batuk berat? Segera ke fasilitas kesehatan atau hubungi 112.',
    NO_BURNING,
  ],
  na: [
    'Pantau informasi resmi pemerintah daerah.',
    'Siapkan masker N95/KN95 di rumah.',
    'Melihat api? Laporkan ke 112 atau BPBD setempat.',
  ],
}

// Ancaman kesehatan bagi kelompok rentan, disarikan dari panduan WHO dan Kementerian Kesehatan tentang asap
// kebakaran hutan dan PM2.5. Ditulis sebagai risiko ("dapat"), bukan kepastian.
export const VULNERABLE = [
  {
    who: 'Anak-anak & balita',
    risk: 'Bernapas lebih cepat dan menghirup lebih banyak udara untuk ukuran tubuhnya, sementara parunya masih tumbuh. Asap memicu ISPA, serangan asma, dan batuk berkepanjangan; paparan berhari-hari dapat mengganggu perkembangan paru.',
  },
  {
    who: 'Lansia',
    risk: 'Partikel halus PM2.5 masuk hingga ke aliran darah dan dapat memicu serangan jantung dan stroke, serta memperparah PPOK, asma, dan penyakit jantung.',
  },
  {
    who: 'Ibu hamil',
    risk: 'Paparan asap pekat dikaitkan dengan kelahiran prematur dan bayi berat lahir rendah.',
  },
]

export const DANGER_SIGNS = 'Segera ke fasilitas kesehatan bila anak bernapas cepat atau dadanya tertarik ke dalam saat bernapas, bibir kebiruan, atau lansia sesak, nyeri dada, lemas mendadak, atau tampak bingung.'

const UNHEALTHY = ['tidak-sehat', 'sangat-tidak-sehat', 'berbahaya']

export function vulnerableBlock(level: IspuLevel) {
  if (level.key === 'sedang') {
    return `<div class="vulnerable mild"><strong>Untuk anak-anak & lansia</strong><p>Anak dengan asma dan lansia dengan penyakit jantung atau paru mungkin mulai merasakan gejala. Kurangi aktivitas berat di luar.</p></div>`
  }
  if (!UNHEALTHY.includes(level.key)) return ''
  return `<div class="vulnerable"><strong>Ancaman bagi yang paling rentan</strong><ul>${VULNERABLE.map((item) => `<li><b>${item.who}:</b> ${item.risk}</li>`).join('')}</ul><p class="danger-signs">${DANGER_SIGNS}</p></div>`
}

export const VULNERABLE_SHORT = 'Anak-anak paling terancam ISPA dan serangan asma; lansia terancam serangan jantung dan stroke.'

// ---------- Skala emisi: setara sampah rumah tangga yang dibakar ----------
// Dari kekuatan api (FRP, MW) diperkirakan biomassa terbakar (0,368 kg/MJ; Wooster dkk. 2005), lalu PM2.5 yang
// dilepaskan: ±9 g/kg untuk vegetasi (Akagi dkk. 2011) hingga ±17 g/kg untuk gambut (Stockwell dkk. 2016).
// Tiap deteksi dianggap mewakili ±12 jam (dua lintasan satelit per hari). Pembanding: pembakaran sampah terbuka
// ±9,8 g PM2.5/kg (Wiedinmyer dkk. 2014) dan sampah rumah tangga Indonesia ±2,7 kg/hari (SIPSN KLHK).
// Ini gambaran skala (ketelitian ±2–3 kali lipat), bukan pengukuran.
const SECONDS_PER_DETECTION = 12 * 3600
const BIOMASS_PER_MJ = 0.368
const EF_VEGETATION = 0.009
const EF_PEAT = 0.017
const EF_TRASH = 0.0098
const TRASH_PER_HOUSEHOLD_DAY = 2.7
const HOUSEHOLDS_INDONESIA = 70_000_000
// Pembanding PLTU: batas partikulat PLTU batubara yang beroperasi sebelum 2019 adalah 100 mg/Nm³ (Permen LHK
// P.15/2019, Lampiran I), dengan gas buang PLTU 1.000 MW ±2,8 juta Nm³/jam. Jadi satu PLTU besar yang beroperasi tepat
// di batas boleh membuang paling banyak ±6,7 ton partikulat per hari. Batas itu untuk partikulat total, bukan hanya
// PM2.5, sehingga perbandingan dengan PM2.5 kebakaran ini cenderung meremehkan api, bukan melebih-lebihkan.
const PLTU_PM_KG_PER_DAY = 2_800_000 * 100e-6 * 24
// Pedoman kualitas udara WHO 2021: rata-rata PM2.5 24 jam sebaiknya tidak melebihi 15 µg/m³.
export const WHO_PM25_24H = 15

export function smokeEmissionKg(frpMw: number, peatFraction: number) {
  const biomassKg = BIOMASS_PER_MJ * frpMw * SECONDS_PER_DETECTION
  return biomassKg * (EF_VEGETATION + (EF_PEAT - EF_VEGETATION) * Math.min(1, Math.max(0, peatFraction)))
}

// Jumlah rumah tangga yang sampah hariannya harus dibakar setiap hari selama `days` untuk menghasilkan PM2.5 sebanyak itu.
export function trashHouseholds(pm25Kg: number, days: number) {
  return pm25Kg / (EF_TRASH * TRASH_PER_HOUSEHOLD_DAY * Math.max(1, days))
}

export function formatHouseholds(households: number) {
  if (households >= HOUSEHOLDS_INDONESIA) return `${(households / HOUSEHOLDS_INDONESIA).toFixed(1).replace('.', ',')} kali seluruh rumah tangga Indonesia`
  if (households >= 1e6) return `±${(households / 1e6).toFixed(1).replace('.', ',')} juta rumah tangga`
  if (households >= 1e3) return `±${Math.round(households / 1e3)} ribu rumah tangga`
  return `±${Math.round(households)} rumah tangga`
}

export function trashEquivalent(frpMw: number, peatFraction: number, days: number) {
  if (!frpMw) return null
  const pm25Kg = smokeEmissionKg(frpMw, peatFraction)
  return { pm25Tonnes: pm25Kg / 1000, households: trashHouseholds(pm25Kg, days), text: formatHouseholds(trashHouseholds(pm25Kg, days)), pltu: pltuEquivalent(pm25Kg, days) }
}

// Jumlah PLTU batubara 1.000 MW yang beroperasi di batas emisi untuk menyamai PM2.5 api per hari.
export function pltuEquivalent(pm25Kg: number, days: number) {
  const plants = pm25Kg / Math.max(1, days) / PLTU_PM_KG_PER_DAY
  if (plants < 0.5) return null
  return { plants, text: plants >= 10 ? `±${Math.round(plants).toLocaleString('id-ID')} PLTU batubara besar` : `±${plants.toFixed(1).replace('.', ',')} PLTU batubara besar` }
}

export function whoMultipleText(pm25: number | null) {
  if (pm25 === null || !Number.isFinite(pm25)) return null
  const ratio = pm25 / WHO_PM25_24H
  if (ratio < 1) return null
  return `${ratio < 10 ? ratio.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(ratio).toLocaleString('id-ID')} kali batas aman WHO`
}

export function cigaretteText(pm25: number | null) {
  const count = cigarettesPerDay(pm25)
  if (count === null) return null
  if (count < 1) return 'kurang dari 1 batang rokok'
  return `±${Math.round(count)} batang rokok`
}

export function streakText(days: number) {
  if (days >= 7) return 'sudah 7 hari atau lebih berturut-turut'
  if (days >= 2) return `hari ke-${days} berturut-turut`
  return null
}

export function checklist(level: IspuLevel, id: string) {
  const steps = SAFETY_STEPS[level.key] ?? SAFETY_STEPS.na
  return `<div class="safety-steps"><strong>Lakukan sekarang</strong><ul>${steps.map((step, index) => `
    <li><label><input type="checkbox" id="${id}-${index}" /><span>${step}</span></label></li>`).join('')}</ul></div>`
}

// ---------- Kartu bagikan ----------

export type ShareCard = {
  level: IspuLevel
  place: string
  pm25: number | null
  streakDays: number
  note: string
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (context.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  return lines
}

function loadSvg(svg: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}`
  })
}

export async function renderShareCard(card: ShareCard): Promise<Blob> {
  const width = 1080
  const height = 1350
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  const font = (weight: number, size: number) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`
  const onColor = card.level.key === 'tidak-sehat' ? '#1d1d1b' : '#ffffff'

  // Pita warna kategori di atas, panel putih di bawah.
  context.fillStyle = card.level.color
  context.fillRect(0, 0, width, 620)
  context.fillStyle = '#f7f9f6'
  context.fillRect(0, 620, width, height - 620)

  context.fillStyle = onColor
  context.font = font(600, 30)
  context.fillText('AMUK API · Pemantau Independen Karhutla', 70, 90)

  const icon = await loadSvg(levelIcon(card.level.key, 220))
  context.drawImage(icon, 70, 140, 220, 220)

  context.font = font(800, 84)
  wrapText(context, card.level.label.toUpperCase(), width - 400).forEach((line, index) => context.fillText(line, 330, 235 + index * 90))
  context.font = font(500, 34)
  context.fillText('kualitas udara hari ini', 330, card.level.label.length > 12 ? 410 : 320)

  context.font = font(700, 44)
  wrapText(context, card.place, width - 140).slice(0, 2).forEach((line, index) => context.fillText(line, 70, 470 + index * 54))

  // Isi kartu dari atas ke bawah; baris yang tidak muat sebelum kaki kartu dilewati.
  const bottom = height - 150
  let y = 700
  context.fillStyle = '#1d1d1b'
  const cigarettes = cigaretteText(card.pm25)
  if (cigarettes) {
    context.font = font(500, 32)
    context.fillText('Menghirup udara ini seharian setara mengisap', 70, y)
    context.font = font(800, 72)
    context.fillStyle = card.level.key === 'baik' ? '#3f9a5c' : '#c0392b'
    context.fillText(cigarettes, 70, y + 80)
    context.fillStyle = '#1d1d1b'
    context.font = font(500, 30)
    context.fillText('termasuk bagi bayi dan anak-anak.', 70, y + 126)
    y += 180
  }
  const streak = streakText(card.streakDays)
  if (streak && UNHEALTHY.includes(card.level.key)) {
    context.font = font(700, 34)
    context.fillStyle = '#8a5a2b'
    context.fillText(`Udara tidak sehat ${streak}.`, 70, y)
    y += 58
  }
  if (UNHEALTHY.includes(card.level.key)) {
    context.font = font(700, 30)
    context.fillStyle = '#c0392b'
    for (const line of wrapText(context, VULNERABLE_SHORT, width - 140)) {
      context.fillText(line, 70, y)
      y += 40
    }
    y += 22
  }

  context.fillStyle = '#1d1d1b'
  context.font = font(700, 32)
  context.fillText('Lakukan sekarang:', 70, y)
  y += 48
  context.font = font(500, 28)
  for (const step of (SAFETY_STEPS[card.level.key] ?? SAFETY_STEPS.na).slice(0, 3)) {
    const lines = wrapText(context, step, width - 190)
    if (y + (lines.length - 1) * 36 > bottom) break
    context.fillText('✓', 80, y)
    lines.forEach((line, index) => context.fillText(line, 125, y + index * 36))
    y += lines.length * 36 + 14
  }

  context.fillStyle = card.level.color
  context.fillRect(0, height - 130, width, 130)
  context.fillStyle = onColor
  context.font = font(700, 38)
  context.fillText(`Cek lokasi Anda: ${SITE}`, 70, height - 70)
  context.font = font(400, 22)
  context.fillText(card.note, 70, height - 30)

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat gambar.'))), 'image/png'))
}

// Bagikan lewat menu bagikan perangkat (bila didukung; di ponsel pengguna bisa memilih Instagram, Facebook,
// X, dll.), atau unduh gambarnya. Mengembalikan 'shared' atau 'downloaded'.
export async function shareCardImage(card: ShareCard, filename: string, text: string): Promise<'shared' | 'downloaded'> {
  const blob = await renderShareCard(card)
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text }).catch(() => undefined)
    return 'shared'
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  return 'downloaded'
}

export function whatsappLink(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

// Teks pendek untuk X (batas 280 karakter termasuk tautan).
export function shortShareText(card: ShareCard) {
  const cigarettes = cigaretteText(card.pm25)
  const parts = [
    `Kualitas udara di ${card.place} hari ini: ${card.level.label.toUpperCase()}.`,
    cigarettes ? `Setara mengisap ${cigarettes} sehari, termasuk bagi anak-anak.` : '',
    UNHEALTHY.includes(card.level.key) ? VULNERABLE_SHORT : '',
  ].filter(Boolean)
  let text = parts.join(' ')
  while (text.length > 230 && parts.length > 1) {
    parts.pop()
    text = parts.join(' ')
  }
  return text.length > 230 ? `${text.slice(0, 227)}…` : text
}

// Tautan bagikan per platform. Instagram tidak punya tautan bagikan web; dipakai gambar lewat menu bagikan perangkat.
export function shareLinks(card: ShareCard, url: string) {
  const long = shareText(card)
  const short = shortShareText(card)
  return {
    whatsapp: whatsappLink(long),
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(short)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(short)}&url=${encodeURIComponent(url)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(`${short} ${url}`)}`,
  }
}

const ICON_WA = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 12 12 0 0 0 4.6 4 5.3 5.3 0 0 0 3.2.7 2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3Z"/></svg>'
const ICON_FB = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.8c0-.9.3-1.6 1.6-1.6h1.7V4.4a22 22 0 0 0-2.5-.1c-2.5 0-4.1 1.5-4.1 4.2v2.3H7.4V14h2.8v8Z"/></svg>'
const ICON_X = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.5 3h3l-6.8 7.8L21.7 21h-6.2l-4.8-6.3L5 21H2l7.3-8.3L1.6 3h6.3l4.4 5.8Zm-1.1 16.2h1.7L6.8 4.7H5Z"/></svg>'
const ICON_THREADS = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12.2 22c-3 0-5.3-1-6.9-3-1.4-1.8-2.1-4.2-2.2-7v-.1c.1-2.8.8-5.2 2.2-7C6.9 3 9.2 2 12.2 2c2.3 0 4.2.6 5.7 1.8 1.3 1.1 2.2 2.6 2.7 4.5l-2 .5c-.7-2.8-2.9-4.6-6.4-4.6-2.3 0-4 .7-5.2 2.2-1.1 1.4-1.7 3.4-1.7 5.6 0 2.3.6 4.3 1.7 5.6 1.2 1.5 2.9 2.2 5.2 2.2 2 0 3.4-.5 4.3-1.5.8-.8 1-1.8.9-2.5-.1-.8-.5-1.4-1.1-1.9a7 7 0 0 0-.2 1.3c-.3 1.9-1.6 3-3.6 3.1-1.2.1-2.2-.3-3-1-.7-.7-1-1.6-1-2.6.1-1.9 1.5-3.2 3.8-3.4.9-.1 1.7 0 2.5.1v-.3c0-1-.3-1.7-.8-2.1-.5-.4-1.2-.6-2-.6-1.1 0-2.1.4-2.6 1.3l-1.7-1.1c.9-1.4 2.5-2.2 4.4-2.2 1.4 0 2.6.4 3.5 1.2.9.8 1.4 2 1.4 3.4v.9c1.5.8 2.4 2 2.6 3.5.2 1.6-.3 3.2-1.5 4.4-1.3 1.3-3.2 2-5.6 2Zm.5-8.5c-1.3.1-2 .6-2 1.4 0 .5.2.8.5 1 .4.3.9.4 1.5.4 1-.1 1.6-.5 1.8-1.5.1-.3.1-.7.1-1.1-.6-.2-1.2-.2-1.9-.2Z"/></svg>'
const ICON_IG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Zm0 7.9a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 0 1 0 6.2ZM17 5.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2ZM12 2.2c-2.7 0-3 0-4 .1a7 7 0 0 0-2.4.5 5 5 0 0 0-2.8 2.8 7 7 0 0 0-.5 2.4c-.1 1-.1 1.3-.1 4s0 3 .1 4a7 7 0 0 0 .5 2.4 5 5 0 0 0 2.8 2.8 7 7 0 0 0 2.4.5c1 .1 1.3.1 4 .1s3 0 4-.1a7 7 0 0 0 2.4-.5 5 5 0 0 0 2.8-2.8 7 7 0 0 0 .5-2.4c.1-1 .1-1.3.1-4s0-3-.1-4a7 7 0 0 0-.5-2.4 5 5 0 0 0-2.8-2.8 7 7 0 0 0-2.4-.5c-1-.1-1.3-.1-4-.1Zm0 1.8c2.7 0 3 0 4 .1.9 0 1.5.2 1.8.3a3.2 3.2 0 0 1 1.8 1.8c.1.3.3.9.3 1.8.1 1 .1 1.3.1 4s0 3-.1 4c0 .9-.2 1.5-.3 1.8a3.2 3.2 0 0 1-1.8 1.8c-.3.1-.9.3-1.8.3-1 .1-1.3.1-4 .1s-3 0-4-.1c-.9 0-1.5-.2-1.8-.3a3.2 3.2 0 0 1-1.8-1.8c-.1-.3-.3-.9-.3-1.8-.1-1-.1-1.3-.1-4s0-3 .1-4c0-.9.2-1.5.3-1.8a3.2 3.2 0 0 1 1.8-1.8c.3-.1.9-.3 1.8-.3 1-.1 1.3-.1 4-.1Z"/></svg>'

// Menu bagikan: WhatsApp, Facebook, X, Threads (tautan), Instagram (gambar), simpan gambar.
export function shareMenu(kind: 'status' | 'check', card: ShareCard, url: string) {
  const links = shareLinks(card, url)
  const link = (href: string, cls: string, icon: string, label: string) =>
    `<a class="share-button ${cls}" href="${href}" target="_blank" rel="noreferrer noopener">${icon}<span>${label}</span></a>`
  return `<div class="share-menu"><strong>Bagikan ke</strong><div class="share-row">
    ${link(links.whatsapp, 'whatsapp', ICON_WA, 'WhatsApp')}
    ${link(links.facebook, 'facebook', ICON_FB, 'Facebook')}
    ${link(links.x, 'x', ICON_X, 'X')}
    ${link(links.threads, 'threads', ICON_THREADS, 'Threads')}
    <button type="button" class="share-button instagram" data-share="${kind}" data-share-target="instagram">${ICON_IG}<span>Instagram</span></button>
    <button type="button" class="share-button plain" data-share="${kind}" data-share-target="image"><span>Simpan gambar</span></button>
  </div><small class="share-hint" data-share-hint="${kind}"></small></div>`
}

export function shareText(card: ShareCard) {
  const cigarettes = cigaretteText(card.pm25)
  const streak = streakText(card.streakDays)
  return [
    `Kualitas udara di ${card.place} hari ini: ${card.level.label.toUpperCase()}.`,
    cigarettes ? `Menghirupnya seharian setara mengisap ${cigarettes}, termasuk bagi bayi dan anak-anak.` : '',
    streak ? `Udara tidak sehat ${streak}.` : '',
    UNHEALTHY.includes(card.level.key) ? VULNERABLE_SHORT : '',
    `Lakukan sekarang: ${(SAFETY_STEPS[card.level.key] ?? SAFETY_STEPS.na)[0]}`,
    `Cek lokasi Anda: https://${SITE}`,
  ].filter(Boolean).join('\n')
}
