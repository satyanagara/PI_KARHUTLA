// Membuat informasi kualitas udara terasa dekat dan mendorong tindakan: setara rokok, hari berturut-turut,
// langkah aman yang bisa dicentang, dan kartu siap bagikan. Ketakutan selalu dipasangkan dengan langkah konkret.
import { cigarettesPerDay, type IspuLevel } from './risk.ts'
import { levelIcon } from './icons.ts'

const SITE = 'amukapi.santaralabs.ai'

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
  ],
  'tidak-sehat': [
    'Tutup jendela dan pintu.',
    'Pakai masker N95/KN95 saat keluar; masker kain tidak menyaring asap.',
    'Anak, lansia, ibu hamil, dan penderita asma tetap di dalam ruangan.',
  ],
  'sangat-tidak-sehat': [
    'Tutup jendela, pintu, dan celah-celahnya dengan kain basah.',
    'Hindari keluar rumah; bila terpaksa, pakai N95/KN95.',
    'Siapkan satu ruangan paling tertutup sebagai ruang bersih untuk kelompok rentan.',
  ],
  berbahaya: [
    'Tetap di dalam ruangan tertutup; tutup celah dengan kain basah.',
    'Kelompok rentan sebaiknya pindah sementara ke tempat berudara bersih.',
    'Sesak napas, nyeri dada, atau batuk berat? Segera ke fasilitas kesehatan atau hubungi 112.',
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

// Bagikan lewat menu bagikan perangkat (bila didukung), atau unduh gambarnya.
export async function shareCardImage(card: ShareCard, filename: string, text: string) {
  const blob = await renderShareCard(card)
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], text }).catch(() => undefined)
    return
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

export function whatsappLink(text: string) {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
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
