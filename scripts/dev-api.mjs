// Menjalankan server API saat pengembangan dan memulainya ulang bila berkas berubah.
// Memakai polling (bukan fs.watch) karena perubahan dari host tidak terlihat lewat mount volume container Podman.
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WATCH = ['server', 'data', 'src/risk.ts', 'src/report-types.ts', '.env.local']
const INTERVAL_MS = 1000

function snapshot() {
  const stamps = []
  const visit = (target) => {
    let info
    try {
      info = statSync(target)
    } catch {
      return
    }
    if (info.isDirectory()) {
      for (const name of readdirSync(target)) visit(path.join(target, name))
    } else {
      stamps.push(`${target}:${info.mtimeMs}:${info.size}`)
    }
  }
  WATCH.forEach((entry) => visit(path.join(ROOT, entry)))
  return stamps.join('|')
}

let child = null
function start() {
  child = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server/index.ts'], { cwd: ROOT, stdio: 'inherit' })
}

function restart() {
  console.log('[dev-api] perubahan terdeteksi, memulai ulang server...')
  if (!child || child.exitCode !== null) return start()
  child.once('exit', start)
  child.kill('SIGTERM')
}

let last = snapshot()
start()
setInterval(() => {
  const next = snapshot()
  if (next !== last) {
    last = next
    restart()
  }
}, INTERVAL_MS)

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill(signal)
    process.exit(0)
  })
}
