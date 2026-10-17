// Server web Pemantau Independen KARHUTLA: menyajikan halaman hasil build (dist/), API /api/hotspots, dan data kawasan lindung.
// Jalankan dengan Node 22.18+ (type stripping bawaan): node --env-file-if-exists=.env.local server/index.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import dns from 'node:dns'
import net from 'node:net'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlib, gzipSync } from 'node:zlib'
import { DAY_OPTIONS, SOURCES, type Source } from '../src/report-types.ts'
import { getBnpbReport } from './bnpb.ts'
import { cacheStatus, checkLocation, getReport, loadReference, searchPlaces } from './report.ts'

// Server tanpa IPv6: dahulukan IPv4 dan beri waktu cukup per percobaan koneksi. Batas bawaan Node (250 ms)
// lebih pendek dari latensi ke NASA FIRMS di AS, sehingga fetch kadang gagal ETIMEDOUT.
dns.setDefaultResultOrder('ipv4first')
net.setDefaultAutoSelectFamilyAttemptTimeout(2500)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DATA = path.join(ROOT, 'data')
const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.HOST ?? '0.0.0.0'
const TRUST_PROXY = process.env.TRUST_PROXY === '1'
const RATE_LIMIT_PER_MINUTE = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 60)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://server.arcgisonline.com",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

type Payload = { raw: Buffer; gzip: Buffer; br: Buffer; etag: string; type: string }

function compress(raw: Buffer, type: string): Payload {
  return {
    raw,
    gzip: gzipSync(raw, { level: 9 }),
    br: brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9 } }),
    etag: `"${createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`,
    type,
  }
}

function send(req: IncomingMessage, res: ServerResponse, payload: Payload, cacheControl: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Content-Type': payload.type, 'Cache-Control': cacheControl, ETag: payload.etag, Vary: 'Accept-Encoding', ...extra }
  if (req.headers['if-none-match'] === payload.etag) {
    res.writeHead(304, headers).end()
    return
  }
  const accept = String(req.headers['accept-encoding'] ?? '')
  let body = payload.raw
  if (/\bbr\b/.test(accept)) {
    body = payload.br
    headers['Content-Encoding'] = 'br'
  } else if (/\bgzip\b/.test(accept)) {
    body = payload.gzip
    headers['Content-Encoding'] = 'gzip'
  }
  headers['Content-Length'] = String(body.length)
  res.writeHead(200, headers)
  res.end(req.method === 'HEAD' ? undefined : body)
}

function sendError(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ error: message }))
}

// ---------- Pembatas laju per IP ----------

const hits = new Map<string, { count: number; reset: number }>()
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of hits) if (entry.reset < now) hits.delete(ip)
}, 60_000).unref()

// Di belakang proxy, pakai X-Real-IP yang disetel proxy sendiri, atau entri terakhir X-Forwarded-For
// (entri awal bisa dipalsukan pengunjung).
function clientIp(req: IncomingMessage) {
  if (TRUST_PROXY) {
    const realIp = String(req.headers['x-real-ip'] ?? '').trim()
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((part) => part.trim()).filter(Boolean).pop()
    if (realIp || forwarded) return realIp || forwarded!
  }
  return req.socket.remoteAddress || 'unknown'
}

function allowed(req: IncomingMessage, res: ServerResponse) {
  const ip = clientIp(req)
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 })
    return true
  }
  entry.count++
  if (entry.count <= RATE_LIMIT_PER_MINUTE) return true
  res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)))
  sendError(res, 429, 'Terlalu banyak permintaan. Coba lagi sebentar lagi.')
  return false
}

// ---------- Rute ----------

const reportPayloads = new Map<string, { at: number; payload: Payload }>()

async function handleHotspots(req: IncomingMessage, res: ServerResponse, url: URL) {
  const source = (url.searchParams.get('source') ?? 'VIIRS_NOAA21_NRT') as Source
  const days = Number(url.searchParams.get('days') ?? 3)
  if (!SOURCES.includes(source)) return sendError(res, 400, 'Sumber satelit tidak didukung.')
  if (!(DAY_OPTIONS as readonly number[]).includes(days)) return sendError(res, 400, 'Rentang hari tidak valid.')
  try {
    const report = await getReport(source, days)
    const key = `${source}:${days}`
    let cached = reportPayloads.get(key)
    if (!cached || cached.at !== report.at) {
      cached = { at: report.at, payload: compress(Buffer.from(report.json), MIME['.json']) }
      reportPayloads.set(key, cached)
    }
    send(req, res, cached.payload, 'public, max-age=60, stale-while-revalidate=600', { 'X-Report-Age': String(Math.round((Date.now() - report.at) / 1000)) })
  } catch (error) {
    console.error('[hotspots]', error)
    sendError(res, 502, error instanceof Error ? error.message : 'Gagal memuat data hotspot.')
  }
}

function sendJson(req: IncomingMessage, res: ServerResponse, body: unknown, cacheControl = 'no-store') {
  send(req, res, compress(Buffer.from(JSON.stringify(body)), MIME['.json']), cacheControl)
}

function readFilters(url: URL) {
  const source = (url.searchParams.get('source') ?? 'VIIRS_NOAA21_NRT') as Source
  const days = Number(url.searchParams.get('days') ?? 3)
  const valid = SOURCES.includes(source) && (DAY_OPTIONS as readonly number[]).includes(days)
  return valid ? { source, days } : null
}

async function handleLocation(req: IncomingMessage, res: ServerResponse, url: URL) {
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  const filters = readFilters(url)
  if (!filters) return sendError(res, 400, 'Sumber atau periode tidak valid.')
  if (!(lat >= -12 && lat <= 7 && lon >= 93 && lon <= 143)) return sendError(res, 400, 'Lokasi di luar wilayah Indonesia.')
  try {
    sendJson(req, res, await checkLocation(lat, lon, filters.source, filters.days), 'public, max-age=120')
  } catch (error) {
    console.error('[lokasi]', error)
    sendError(res, 502, error instanceof Error ? error.message : 'Gagal memeriksa lokasi.')
  }
}

const fileCache = new Map<string, Payload>()

async function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string, cacheControl: string) {
  let payload = fileCache.get(filePath)
  if (!payload) {
    const raw = await readFile(filePath)
    payload = compress(raw, MIME[path.extname(filePath)] ?? 'application/octet-stream')
    fileCache.set(filePath, payload)
  }
  send(req, res, payload, cacheControl)
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const relative = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const target = path.join(DIST, relative)
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return sendError(res, 400, 'Path tidak valid.')
  const isFile = await stat(target).then((info) => info.isFile(), () => false)
  if (isFile) {
    const immutable = relative.startsWith('assets/')
    return serveFile(req, res, target, immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
  }
  if (path.extname(relative)) return sendError(res, 404, 'Berkas tidak ditemukan.')
  const index = path.join(DIST, 'index.html')
  if (!(await stat(index).then(() => true, () => false))) return sendError(res, 503, 'Halaman belum dibangun. Jalankan npm run build.')
  return serveFile(req, res, index, 'no-cache')
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'Metode tidak diizinkan.')
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ ok: true, reports: cacheStatus() }))
    }
    if (url.pathname === '/api/hotspots') return allowed(req, res) && (await handleHotspots(req, res, url))
    if (url.pathname === '/api/lokasi') return allowed(req, res) && (await handleLocation(req, res, url))
    if (url.pathname === '/api/laporan-bnpb') {
      if (!allowed(req, res)) return
      try {
        return sendJson(req, res, await getBnpbReport(), 'public, max-age=300')
      } catch (error) {
        console.error('[bnpb]', error)
        return sendError(res, 502, 'Laporan BNPB sedang tidak tersedia.')
      }
    }
    if (url.pathname === '/api/cari') {
      if (!allowed(req, res)) return
      const query = (url.searchParams.get('q') ?? '').slice(0, 60)
      return sendJson(req, res, searchPlaces(query), 'public, max-age=3600')
    }
    if (url.pathname.startsWith('/api/')) return sendError(res, 404, 'Endpoint tidak ditemukan.')
    if (url.pathname === '/data/kawasan-hutan.json') return serveFile(req, res, path.join(DATA, 'kawasan-hutan-web.json'), 'public, max-age=86400')
    if (url.pathname === '/data/gambut.json') return serveFile(req, res, path.join(DATA, 'gambut-web.json'), 'public, max-age=86400')
    return serveStatic(req, res, url.pathname)
  } catch (error) {
    console.error('[server]', error)
    if (!res.headersSent) sendError(res, 500, 'Kesalahan server.')
  }
})

const counts = await loadReference(DATA)
console.log(`[server] data rujukan: ${counts.settlements} permukiman, ${counts.areas} poligon kawasan hutan, ${counts.peat} KHG, ${counts.regencies} kabupaten/kota`)
if (!process.env.FIRMS_MAP_KEY) console.warn('[server] PERINGATAN: FIRMS_MAP_KEY belum diatur, /api/hotspots akan gagal.')
server.listen(PORT, HOST, () => console.log(`[server] berjalan di http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`))
