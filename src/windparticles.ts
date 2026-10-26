// Animasi aliran angin: partikel berekor yang bergerak mengikuti prakiraan angin (grid 1,5° dari server), sinkron
// dengan waktu yang sedang ditampilkan di lapisan sebaran asap. Satu canvas di atas peta, tanpa menangkap klik.
// Kecepatan di tiap partikel diinterpolasi dari 4 titik grid terdekat dan 2 langkah waktu terdekat.
// Pengguna "kurangi gerakan" mendapat garis aliran diam yang tetap menunjukkan arah angin.
import * as L from 'leaflet'

export type WindGrid = { fetchedAt: string; step: number; west: number; south: number; nx: number; ny: number; times: string[]; u: number[][]; v: number[][] }

const FPS = 30
const SPEED = 0.07 // piksel per bingkai untuk tiap km/jam
const FADE = 0.92 // sisa kecerahan ekor per bingkai
const HOUR_MS = 3600 * 1000

type Particle = { x: number; y: number; age: number; maxAge: number }

export class WindLayer extends L.Layer {
  private grid: WindGrid | null = null
  private canvas: HTMLCanvasElement | null = null
  private particles: Particle[] = []
  private frameId = 0
  private lastDraw = 0
  private moving = false
  private color = 'rgba(25, 45, 60, 0.6)'
  private timeMs = Date.now()
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  setWind(grid: WindGrid) {
    this.grid = grid
    this.reset()
    return this
  }

  // Waktu yang ditampilkan (ms), mengikuti penggeser/putar lapisan sebaran asap.
  setTime(ms: number) {
    this.timeMs = ms
  }

  setColor(color: string) {
    this.color = color
    this.reset()
  }

  onAdd(map: L.Map) {
    if (!map.getPane('wind')) {
      const pane = map.createPane('wind')
      pane.style.zIndex = '420'
      pane.style.pointerEvents = 'none'
    }
    this.canvas = L.DomUtil.create('canvas', 'wind-canvas') as HTMLCanvasElement
    map.getPane('wind')!.appendChild(this.canvas)
    map.on('movestart zoomstart', this.pause, this)
    map.on('moveend zoomend resize viewreset', this.reset, this)
    document.addEventListener('visibilitychange', this.loop)
    this.reset()
    return this
  }

  onRemove(map: L.Map) {
    cancelAnimationFrame(this.frameId)
    map.off('movestart zoomstart', this.pause, this)
    map.off('moveend zoomend resize viewreset', this.reset, this)
    document.removeEventListener('visibilitychange', this.loop)
    this.canvas?.remove()
    this.canvas = null
    return this
  }

  private pause() {
    this.moving = true
    cancelAnimationFrame(this.frameId)
    if (this.canvas) this.canvas.style.visibility = 'hidden'
  }

  private reset() {
    const map = this._map
    if (!this.canvas || !map) return
    this.moving = false
    const size = map.getSize()
    const ratio = window.devicePixelRatio || 1
    this.canvas.width = size.x * ratio
    this.canvas.height = size.y * ratio
    this.canvas.style.width = `${size.x}px`
    this.canvas.style.height = `${size.y}px`
    this.canvas.style.visibility = 'visible'
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]))
    const ctx = this.canvas.getContext('2d')!
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    // Jumlah partikel menyesuaikan luas peta: ±1 per 450 px², dibatasi agar ringan di ponsel.
    const count = Math.min(1600, Math.round((size.x * size.y) / 450))
    this.particles = Array.from({ length: count }, () => this.spawn({ x: 0, y: 0, age: 0, maxAge: 0 }))
    if (this.reduceMotion.matches) this.drawStatic()
    else this.loop()
  }

  private spawn(particle: Particle) {
    const size = this._map.getSize()
    particle.x = Math.random() * size.x
    particle.y = Math.random() * size.y
    particle.age = 0
    particle.maxAge = 40 + Math.random() * 70
    return particle
  }

  // Angin (km/jam) di titik layar: interpolasi bilinear dalam ruang dan linear dalam waktu.
  private windAt(x: number, y: number): [number, number] | null {
    const grid = this.grid
    if (!grid) return null
    const { lat, lng } = this._map.containerPointToLatLng([x, y])
    const col = (lng - grid.west) / grid.step
    const row = (lat - grid.south) / grid.step
    if (col < 0 || row < 0 || col > grid.nx - 1 || row > grid.ny - 1) return null
    const first = Date.parse(`${grid.times[0]}:00:00Z`)
    const stepMs = grid.times.length > 1 ? Date.parse(`${grid.times[1]}:00:00Z`) - first : 3 * HOUR_MS
    const t = Math.min(grid.times.length - 1, Math.max(0, (this.timeMs - first) / stepMs))
    const t0 = Math.floor(t)
    const t1 = Math.min(grid.times.length - 1, t0 + 1)
    const ft = t - t0
    const c0 = Math.floor(col)
    const r0 = Math.floor(row)
    const c1 = Math.min(grid.nx - 1, c0 + 1)
    const r1 = Math.min(grid.ny - 1, r0 + 1)
    const fc = col - c0
    const fr = row - r0
    const sample = (field: number[][]) => {
      const at = (step: number) => {
        const values = field[step]
        const top = values[r1 * grid.nx + c0] * (1 - fc) + values[r1 * grid.nx + c1] * fc
        const bottom = values[r0 * grid.nx + c0] * (1 - fc) + values[r0 * grid.nx + c1] * fc
        return bottom * (1 - fr) + top * fr
      }
      return at(t0) * (1 - ft) + at(t1) * ft
    }
    return [sample(grid.u), sample(grid.v)]
  }

  private step(ctx: CanvasRenderingContext2D) {
    ctx.beginPath()
    for (const particle of this.particles) {
      const wind = particle.age < particle.maxAge ? this.windAt(particle.x, particle.y) : null
      if (!wind) {
        this.spawn(particle)
        continue
      }
      const nx = particle.x + wind[0] * SPEED
      const ny = particle.y - wind[1] * SPEED
      ctx.moveTo(particle.x, particle.y)
      ctx.lineTo(nx, ny)
      particle.x = nx
      particle.y = ny
      particle.age++
    }
    ctx.strokeStyle = this.color
    ctx.lineWidth = 1.3
    ctx.stroke()
  }

  private loop = () => {
    cancelAnimationFrame(this.frameId)
    if (!this.canvas || !this.grid || this.moving || document.hidden || this.reduceMotion.matches) return
    const tick = (now: number) => {
      if (now - this.lastDraw >= 1000 / FPS && this.canvas) {
        this.lastDraw = now
        const ctx = this.canvas.getContext('2d')!
        const size = this._map.getSize()
        // Ekor memudar: kurangi kepekatan isi canvas sedikit tiap bingkai, lalu gambar langkah baru.
        ctx.globalCompositeOperation = 'destination-in'
        ctx.fillStyle = `rgba(0, 0, 0, ${FADE})`
        ctx.fillRect(0, 0, size.x, size.y)
        ctx.globalCompositeOperation = 'source-over'
        this.step(ctx)
      }
      this.frameId = requestAnimationFrame(tick)
    }
    this.frameId = requestAnimationFrame(tick)
  }

  // Tanpa animasi: jalankan simulasi beberapa langkah sekaligus dan biarkan garisnya diam.
  private drawStatic() {
    if (!this.canvas || !this.grid) return
    const ctx = this.canvas.getContext('2d')!
    for (const particle of this.particles) particle.maxAge = Infinity
    for (let i = 0; i < 12; i++) this.step(ctx)
  }
}
