// Animasi nyala api untuk titik yang diyakini kebakaran (keyakinan tinggi, bukan sumber panas tetap).
// Satu canvas di atas peta, bukan satu elemen per titik: sprite api dirender sekali (beberapa bingkai), lalu
// tiap bingkai animasi hanya drawImage untuk titik yang terlihat. Titik aslinya tetap bisa diklik di bawahnya.
import * as L from 'leaflet'

const FRAMES = 12
const SPRITE_W = 32
const SPRITE_H = 48
const FPS = 18
const MAX_VISIBLE = 600

type Flame = { lat: number; lon: number; frp: number; phase: number }

// Bingkai sprite: tiap bingkai sedikit berbeda tinggi, lebar, dan condong agar terlihat berkedip.
function buildSprites() {
  return Array.from({ length: FRAMES }, (_, frame) => {
    const canvas = document.createElement('canvas')
    canvas.width = SPRITE_W
    canvas.height = SPRITE_H
    const ctx = canvas.getContext('2d')!
    const t = (frame / FRAMES) * Math.PI * 2
    const flicker = 1 + 0.1 * Math.sin(t) + 0.05 * Math.sin(t * 3)
    const sway = 2.2 * Math.sin(t * 2)
    const cx = SPRITE_W / 2
    const base = SPRITE_H - 4

    const glow = ctx.createRadialGradient(cx, base - 8, 1, cx, base - 8, 15)
    glow.addColorStop(0, 'rgba(255, 140, 40, 0.45)')
    glow.addColorStop(1, 'rgba(255, 90, 20, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, SPRITE_W, SPRITE_H)

    const flame = (height: number, width: number, colors: [number, string][]) => {
      const tip = base - height * flicker
      const gradient = ctx.createLinearGradient(cx, base, cx, tip)
      for (const [stop, color] of colors) gradient.addColorStop(stop, color)
      ctx.beginPath()
      ctx.moveTo(cx + sway, tip)
      ctx.bezierCurveTo(cx + width + sway * 0.4, base - height * 0.45, cx + width * 0.95, base, cx, base)
      ctx.bezierCurveTo(cx - width * 0.95, base, cx - width + sway * 0.4, base - height * 0.45, cx + sway, tip)
      ctx.fillStyle = gradient
      ctx.fill()
    }
    flame(36, 11, [[0, '#c2321b'], [0.45, '#f0612a'], [1, 'rgba(255, 170, 60, 0.85)']])
    flame(22, 6.5, [[0, '#ffb020'], [0.7, '#ffe27a'], [1, 'rgba(255, 245, 200, 0.9)']])
    return canvas
  })
}

export class FlameLayer extends L.Layer {
  private flames: Flame[] = []
  private canvas: HTMLCanvasElement | null = null
  private sprites: HTMLCanvasElement[] = []
  private frameId = 0
  private lastDraw = 0
  private zooming = false
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  setFires(fires: { lat: number; lon: number; frp: number }[]) {
    // Fase acak tapi tetap per titik agar api tidak berkedip serempak.
    this.flames = fires
      .map((fire) => ({ ...fire, phase: Math.abs(Math.sin(fire.lat * 12.9898 + fire.lon * 78.233)) * FRAMES }))
      .sort((a, b) => b.frp - a.frp)
    this.draw(performance.now())
    return this
  }

  onAdd(map: L.Map) {
    if (!map.getPane('flames')) {
      const pane = map.createPane('flames')
      pane.style.zIndex = '450'
      pane.style.pointerEvents = 'none'
    }
    this.sprites = buildSprites()
    this.canvas = L.DomUtil.create('canvas', 'flame-canvas') as HTMLCanvasElement
    map.getPane('flames')!.appendChild(this.canvas)
    map.on('moveend zoomend resize viewreset', this.reset, this)
    map.on('move', this.redraw, this)
    map.on('zoomstart', this.hide, this)
    document.addEventListener('visibilitychange', this.loop)
    this.reset()
    this.loop()
    return this
  }

  onRemove(map: L.Map) {
    cancelAnimationFrame(this.frameId)
    map.off('moveend zoomend resize viewreset', this.reset, this)
    map.off('move', this.redraw, this)
    map.off('zoomstart', this.hide, this)
    document.removeEventListener('visibilitychange', this.loop)
    this.canvas?.remove()
    this.canvas = null
    return this
  }

  private hide() {
    this.zooming = true
    if (this.canvas) this.canvas.style.visibility = 'hidden'
  }

  private reset() {
    if (!this.canvas || !this._map) return
    this.zooming = false
    const size = this._map.getSize()
    const ratio = window.devicePixelRatio || 1
    this.canvas.width = size.x * ratio
    this.canvas.height = size.y * ratio
    this.canvas.style.width = `${size.x}px`
    this.canvas.style.height = `${size.y}px`
    this.canvas.style.visibility = 'visible'
    this.redraw()
  }

  private redraw() {
    this.draw(performance.now())
  }

  private loop = () => {
    cancelAnimationFrame(this.frameId)
    if (!this.canvas || document.hidden || this.reduceMotion.matches) return
    const tick = (now: number) => {
      if (now - this.lastDraw >= 1000 / FPS) this.draw(now)
      this.frameId = requestAnimationFrame(tick)
    }
    this.frameId = requestAnimationFrame(tick)
  }

  private draw(now: number) {
    const map = this._map
    if (!this.canvas || !map || this.zooming) return
    this.lastDraw = now
    // Canvas mengikuti geseran peta: letakkan di sudut kiri atas kontainer dalam koordinat lapisan.
    L.DomUtil.setPosition(this.canvas, map.containerPointToLayerPoint([0, 0]))
    const ctx = this.canvas.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    const zoom = map.getZoom()
    const height = Math.min(30, Math.max(9, 6 + (zoom - 4) * 3.4))
    const width = height * (SPRITE_W / SPRITE_H)
    const bounds = map.getBounds().pad(0.05)
    const frameShift = this.reduceMotion.matches ? 0 : (now / 1000) * FPS
    let drawn = 0
    for (const flame of this.flames) {
      if (drawn >= MAX_VISIBLE) break
      if (!bounds.contains([flame.lat, flame.lon])) continue
      const point = map.latLngToContainerPoint([flame.lat, flame.lon])
      const sprite = this.sprites[Math.floor(flame.phase + frameShift) % FRAMES]
      // Dasar api berada sedikit di bawah titik agar api tampak "tumbuh" dari lokasi deteksi.
      ctx.drawImage(sprite, point.x - width / 2, point.y - height * 0.88, width, height)
      drawn++
    }
  }
}
