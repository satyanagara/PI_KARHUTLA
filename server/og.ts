// Gambar pratinjau (Open Graph) per lokasi untuk tautan yang dibagikan ke media sosial: kartu status kualitas
// udara 1200×630 dirender dari SVG ke PNG di server dengan resvg (WebAssembly, tanpa dependensi native).
// Font Inter (OFL) dibundel di data/fonts.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import { levelIcon } from '../src/icons.ts'
import { VULNERABLE_SHORT, cigaretteText, streakText } from '../src/impact.ts'
import { UNHEALTHY_LEVELS } from '../src/risk.ts'
import type { LocationCheck } from '../src/report-types.ts'

const WIDTH = 1200
const HEIGHT = 630
const BAND = 440
const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_MAX = 500

let fonts: Uint8Array[] = []
let ready: Promise<void> | null = null

export function prepareOg(root: string) {
  ready ??= (async () => {
    const wasm = await readFile(path.join(root, 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm'))
    await initWasm(wasm)
    fonts = await Promise.all(['Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-ExtraBold.ttf'].map((name) => readFile(path.join(root, 'data', 'fonts', name))))
  })()
  return ready
}

const esc = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

// Pembungkus baris sederhana: lebar huruf Inter rata-rata ±0,55 × ukuran font.
function wrap(text: string, fontSize: number, maxWidth: number, maxLines: number) {
  const perLine = Math.max(8, Math.floor(maxWidth / (fontSize * 0.55)))
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word
    if (test.length > perLine && line) {
      lines.push(line)
      line = word
    } else line = test
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, perLine - 1)}…`
  }
  return lines
}

function textBlock(lines: string[], x: number, y: number, size: number, weight: number, fill: string, lineHeight = 1.25) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * size * lineHeight}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(line)}</text>`).join('')
}

export function buildOgSvg(result: LocationCheck, place: string, source: string) {
  const level = result.level
  const onBand = level.key === 'tidak-sehat' ? '#1d1d1b' : '#ffffff'
  const unhealthy = UNHEALTHY_LEVELS.includes(level.key)
  const pm25 = result.air?.pm25Mean24 ?? null
  const cigarettes = cigaretteText(pm25)
  const streak = streakText(result.air?.unhealthyDays ?? 0)
  const left = BAND + 56
  const textWidth = WIDTH - left - 56
  const icon = levelIcon(level.key, 240).replace('<svg ', '<svg x="100" y="150" ')

  let y = 118
  let body = ''
  body += textBlock(['KUALITAS UDARA HARI INI'], left, y, 20, 700, '#6b7570')
  y += 76
  const levelLines = wrap(level.label.toUpperCase(), 64, textWidth, 2)
  body += textBlock(levelLines, left, y, 64, 800, '#1d1d1b', 1.1)
  y += levelLines.length * 70 + 8
  const placeLines = wrap(place, 30, textWidth, 2)
  body += textBlock(placeLines, left, y, 30, 700, '#1d1d1b')
  y += placeLines.length * 38 + 18
  if (cigarettes) {
    const lines = wrap(`Menghirup udara ini seharian setara mengisap ${cigarettes}, termasuk bagi bayi dan anak-anak${streak && unhealthy ? `. Udara tidak sehat ${streak}` : ''}.`, 26, textWidth, 4)
    body += textBlock(lines, left, y, 26, 400, '#2b2b29')
    y += lines.length * 33 + 14
  }
  if (unhealthy) {
    const lines = wrap(VULNERABLE_SHORT, 24, textWidth, 2)
    body += textBlock(lines, left, y, 24, 700, '#c0392b')
    y += lines.length * 30
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#f7f9f6"/>
  <rect width="${BAND}" height="${HEIGHT}" fill="${level.color}"/>
  ${icon}
  <text x="${BAND / 2}" y="470" text-anchor="middle" font-family="Inter" font-size="40" font-weight="800" fill="${onBand}">${esc(level.label)}</text>
  <text x="${BAND / 2}" y="60" text-anchor="middle" font-family="Inter" font-size="18" font-weight="700" fill="${onBand}" opacity="0.85">AMUK API · PEMANTAU INDEPENDEN KARHUTLA</text>
  ${body}
  <rect x="${BAND}" y="${HEIGHT - 74}" width="${WIDTH - BAND}" height="74" fill="#16251d"/>
  <text x="${left}" y="${HEIGHT - 42}" font-family="Inter" font-size="24" font-weight="700" fill="#f4f7f2">Cek lokasi Anda: amukapi.santaralabs.ai</text>
  <text x="${left}" y="${HEIGHT - 16}" font-family="Inter" font-size="14" font-weight="400" fill="#9aab9f">Perkiraan model kualitas udara (CAMS) · hotspot ${esc(source === 'BRIN_LAPAN' ? 'BRIN/LAPAN (SiPongi)' : 'NASA FIRMS')} · bukan hasil alat ukur</text>
</svg>`
}

const cache = new Map<string, { at: number; png: Uint8Array }>()

export async function renderOgPng(key: string, result: LocationCheck, place: string, source: string): Promise<Uint8Array> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.png
  await prepareOg(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'))
  const resvg = new Resvg(buildOgSvg(result, place, source), {
    fitTo: { mode: 'width', value: WIDTH },
    font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  })
  const png = resvg.render().asPng()
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), png })
  return png
}
