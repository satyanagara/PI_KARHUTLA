import './style.css'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ISPU_ADVICE, ISPU_LEVELS, SETTLEMENT_ALERT_KM, UNHEALTHY_LEVELS, compassLabel, compassName, levelRank, type Cluster, type IspuLevel } from './risk.ts'
import { DAY_OPTIONS, SOURCES, type LocationCheck, type Report, type ReportFire, type Source } from './report-types.ts'

const sourceNames: Record<Source, string> = {
  VIIRS_NOAA21_NRT: 'NOAA-21 · VIIRS 375 m',
  VIIRS_NOAA20_NRT: 'NOAA-20 · VIIRS 375 m',
  VIIRS_SNPP_NRT: 'Suomi-NPP · VIIRS 375 m',
}
const AREA_SOURCE = 'Kementerian Kehutanan (SIGAP)'
const AUTO_REFRESH_MS = 10 * 60 * 1000

// Pilihan sumber & periode dibaca dari URL agar tautan bisa dibagikan.
const params = new URLSearchParams(location.search)
let activeSource: Source = SOURCES.includes(params.get('sumber') as Source) ? (params.get('sumber') as Source) : 'VIIRS_NOAA21_NRT'
let activeDays: number = (DAY_OPTIONS as readonly number[]).includes(Number(params.get('hari'))) ? Number(params.get('hari')) : 3

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#overview" aria-label="Pemantau Independen KARHUTLA">
        <span class="brand-mark"><span></span></span>
        <span class="brand-name"><small class="brand-kicker">PEMANTAU INDEPENDEN</small>KARHUT<span>LA</span></span>
      </a>
      <div class="side-label">PEMANTAUAN</div>
      <nav class="side-nav" aria-label="Navigasi utama">
        <a class="nav-link selected" href="#overview"><span class="nav-icon">◫</span> Ringkasan</a>
        <a class="nav-link" href="#cek-lokasi"><span class="nav-icon">◎</span> Cek lokasi Anda</a>
        <a class="nav-link" href="#map-section"><span class="nav-icon">⌖</span> Peta hotspot</a>
        <a class="nav-link" href="#risk"><span class="nav-icon">◬</span> Analisis risiko</a>
        <a class="nav-link" href="#detections"><span class="nav-icon">≋</span> Deteksi terbaru</a>
        <a class="nav-link" href="#about"><span class="nav-icon">ⓘ</span> Metodologi</a>
      </nav>
      <div class="side-bottom">
        <div class="source-card">
          <span class="source-orbit">N</span>
          <div><strong>NASA FIRMS</strong><small>Fire Information System</small></div>
          <span class="live-dot"></span>
        </div>
        <div class="sidebar-foot">INDONESIA <span>·</span> v1.0</div>
      </div>
    </aside>

    <main class="workspace" id="overview">
      <header class="topbar">
        <a class="topbar-brand" href="#overview" aria-label="Pemantau Independen KARHUTLA"><span class="brand-mark"><span></span></span><span><small>PEMANTAU INDEPENDEN</small><span>KARHUT<b>LA</b></span></span></a>
        <div class="crumb"><span>PEMANTAUAN</span><b>/</b> Indonesia</div>
        <div class="top-actions">
          <div class="feed-state" id="feed-state"><span class="state-dot"></span><span id="feed-label">Memuat data</span></div>
          <button class="icon-button" id="refresh-button" title="Perbarui data" aria-label="Perbarui data"><span class="refresh-glyph">↻</span></button>
        </div>
      </header>

      <div class="content">
        <section class="page-heading">
          <div>
            <div class="eyebrow"><span class="eyebrow-line"></span> PEMANTAU INDEPENDEN KARHUTLA</div>
            <h1>Situasi kebakaran hutan &amp; lahan <span>Indonesia</span></h1>
            <p class="heading-note">Titik panas satelit NASA FIRMS, perkiraan sebaran asap, dan risikonya bagi permukiman serta kawasan konservasi.</p>
          </div>
          <div class="heading-meta"><span class="meta-label">PEMBARUAN TERAKHIR</span><strong id="updated-at">Memuat…</strong></div>
        </section>

        <section class="status-section" aria-label="Status risiko saat ini">
          <article class="status-card" id="status-card" style="--level:#9aa69f">
            <div class="status-kicker">STATUS RISIKO SAAT INI</div>
            <div class="status-level"><span class="status-pill" id="status-pill">Memuat…</span><span class="status-scope" id="status-scope"></span></div>
            <h2 id="status-headline">Mengambil data satelit terbaru…</h2>
            <ul class="status-points" id="status-points"></ul>
            <div class="status-advice" id="status-advice" hidden><strong>Yang perlu dilakukan</strong><p id="status-advice-text"></p></div>
            <p class="status-emergency">Melihat api atau asap pekat di sekitar Anda? Hubungi <b>112</b> atau BPBD setempat.</p>
          </article>
          <article class="check-card" id="cek-lokasi">
            <div class="status-kicker">CEK LOKASI ANDA</div>
            <h2>Apakah wilayah saya terdampak?</h2>
            <p class="check-intro">Ketik nama kota, kecamatan, atau desa, atau gunakan lokasi perangkat Anda.</p>
            <form class="check-form" id="check-form" autocomplete="off">
              <input id="check-input" type="search" placeholder="Contoh: Palangka Raya" aria-label="Nama kota atau desa" />
              <button type="button" class="locate-button" id="locate-button" title="Gunakan lokasi saya">◎ Lokasi saya</button>
              <ul class="check-suggestions" id="check-suggestions" hidden></ul>
            </form>
            <div class="check-result" id="check-result" aria-live="polite"></div>
          </article>
        </section>

        <section class="stats-grid" aria-label="Ringkasan hotspot">
          <article class="stat-panel stat-main">
            <div class="stat-top"><span>TITIK PANAS (KEMUNGKINAN API)</span><span class="stat-icon fire-icon">✳</span></div>
            <div class="stat-value" id="active-count">—</div>
            <div class="stat-foot"><span class="stat-note" id="period-note">Memuat data satelit</span><span class="stat-unit">titik</span></div>
          </article>
          <article class="stat-panel">
            <div class="stat-top"><span>KEYAKINAN TINGGI</span><span class="stat-icon high-icon">↗</span></div>
            <div class="stat-value" id="high-count">—</div>
            <div class="stat-foot"><span class="legend-dot high"></span><span class="stat-note">Hampir pasti api, menurut NASA</span></div>
          </article>
          <article class="stat-panel">
            <div class="stat-top"><span>KEKUATAN API (FRP)</span><span class="stat-icon frp-icon">⌁</span></div>
            <div class="stat-value"><span id="frp-total">—</span><small> MW</small></div>
            <div class="stat-foot"><span class="legend-dot warm"></span><span class="stat-note">Makin besar, makin hebat api &amp; asapnya</span></div>
          </article>
          <article class="stat-panel stat-status">
            <div class="stat-top"><span>STATUS PEMANTAUAN</span><span class="scan-mark"><i></i><i></i><i></i></span></div>
            <div class="status-value" id="monitor-status">Memuat…</div>
            <div class="stat-foot"><span class="stat-note" id="source-summary">Menghubungi server</span></div>
          </article>
        </section>

        <section class="map-section" id="map-section">
          <div class="section-head">
            <div><div class="section-kicker">SEBARAN GEOGRAFIS</div><h2>Peta hotspot aktif</h2></div>
            <div class="map-controls">
              <label class="select-wrap"><span class="sr-only">Sumber satelit</span><select id="source-select" aria-label="Pilih sumber satelit">${SOURCES.map((source) => `<option value="${source}">${sourceNames[source].replace(' 375 m', '')}</option>`).join('')}</select></label>
              <div class="segmented" aria-label="Rentang waktu">${DAY_OPTIONS.map((days) => `<button data-days="${days}">${days === 1 ? '24J' : `${days} HARI`}</button>`).join('')}</div>
            </div>
          </div>
          <div class="map-frame">
            <div id="fire-map" role="img" aria-label="Peta Indonesia dengan titik panas terdeteksi"></div>
            <div class="map-overline"><span class="map-crosshair">⌖</span> WILAYAH PEMANTAUAN <b>INDONESIA</b></div>
            <div class="map-layers" aria-label="Lapisan peta"><label><input type="checkbox" id="layer-smoke" checked /> Jalur asap</label><label><input type="checkbox" id="layer-areas" checked /> Kawasan hutan</label><label><input type="checkbox" id="layer-peat" /> Lahan gambut (KHG)</label></div>
            <div class="map-legend"><span><i class="legend-fire strong"></i> Tinggi</span><span><i class="legend-fire medium"></i> Sedang</span><span><i class="legend-fire low"></i> Rendah</span></div>
            <div class="map-loading visible" id="map-message"><span class="map-message-icon">⌖</span><strong>Memuat data hotspot</strong><small>Mengambil deteksi satelit terbaru…</small><button id="map-retry" hidden>Coba lagi <span>↻</span></button></div>
            <div class="map-credit">Peta dasar © Esri, HERE, Garmin · Kawasan hutan &amp; KHG © ${AREA_SOURCE} · Permukiman © GeoNames · Asap: Open-Meteo/CAMS · Hotspot: NASA FIRMS</div>
          </div>
        </section>

        <section class="risk-section" id="risk">
          <div class="section-head">
            <div><div class="section-kicker">ANALISIS DAMPAK</div><h2>Seberapa berbahaya api saat ini?</h2></div>
            <span class="risk-state" id="risk-state">Menunggu data hotspot</span>
          </div>
          <div class="risk-grid">
            <article class="risk-tile"><div class="stat-top"><span>≤ ${SETTLEMENT_ALERT_KM} KM DARI PERMUKIMAN</span><span class="stat-icon home-icon">⌂</span></div><div class="stat-value" id="risk-settlement">—</div><div class="stat-note" id="risk-settlement-note">Titik panas dekat desa atau kota</div><p class="tile-why">Api sedekat ini dapat merambat ke rumah warga dan asapnya langsung terhirup.</p></article>
            <article class="risk-tile"><div class="stat-top"><span>DI KAWASAN KONSERVASI</span><span class="stat-icon park-icon">♣</span></div><div class="stat-value" id="risk-konservasi">—</div><div class="stat-note" id="risk-konservasi-note">TN, cagar alam, suaka margasatwa</div><p class="tile-why">Mengancam satwa dan hutan yang dilindungi negara.</p></article>
            <article class="risk-tile"><div class="stat-top"><span>DI HUTAN LINDUNG</span><span class="stat-icon forest-icon">▲</span></div><div class="stat-value" id="risk-lindung">—</div><div class="stat-note" id="risk-lindung-note">Kawasan hutan lindung</div><p class="tile-why">Hutan penjaga air dan tanah; seharusnya tidak terbakar.</p></article>
            <article class="risk-tile"><div class="stat-top"><span>DI LAHAN GAMBUT</span><span class="stat-icon peat-icon">≋</span></div><div class="stat-value" id="risk-peat">—</div><div class="stat-note" id="risk-peat-note">Kesatuan Hidrologis Gambut (KHG)</div><p class="tile-why">Api gambut sulit dipadamkan dan sumber utama kabut asap.</p></article>
            <article class="risk-tile"><div class="stat-top"><span>WILAYAH API DENGAN ASAP TIDAK SEHAT</span><span class="stat-icon smoke-icon">≈</span></div><div class="stat-value" id="risk-smoke">—</div><div class="stat-note" id="risk-smoke-note">Berdasarkan ISPU PM2.5</div><p class="tile-why">Asap dari wilayah ini mengganggu kesehatan warga yang dilaluinya.</p></article>
          </div>
          <article class="data-panel towns-panel">
            <div class="panel-heading"><div><div class="section-kicker">PERKIRAAN 6 JAM KE DEPAN</div><h2>Kota &amp; kecamatan di jalur asap</h2></div><span class="result-count" id="towns-count">—</span></div>
            <p class="panel-intro">Daerah yang diperkirakan dilalui asap dari wilayah api, beserta kualitas udaranya. Klik untuk melihat di peta.</p>
            <ul class="town-list" id="town-list"><li class="area-empty">Belum ada data.</li></ul>
          </article>
          <div class="risk-panels">
            <article class="data-panel priority-panel">
              <div class="panel-heading"><div><div class="section-kicker">DIURUTKAN DARI YANG PALING BERISIKO</div><h2>Wilayah api paling berisiko</h2></div><div class="ispu-legend">${ISPU_LEVELS.map((level) => `<span><i style="background:${level.color}"></i>${level.label}</span>`).join('')}</div></div>
              <div class="table-wrap"><table class="priority-table"><colgroup><col class="col-rank" /><col class="col-cluster" /><col class="col-count" /><col class="col-settlement" /><col class="col-area" /><col class="col-air" /><col class="col-wind" /></colgroup><thead><tr><th>#</th><th>WILAYAH API</th><th>JUMLAH TITIK · KEKUATAN</th><th>PERMUKIMAN TERDEKAT</th><th>KAWASAN HUTAN</th><th>KUALITAS UDARA</th><th>ARAH &amp; JANGKAUAN ASAP</th></tr></thead><tbody id="priority-rows"><tr><td colspan="7" class="empty-row">Analisis tampil setelah data hotspot dimuat.</td></tr></tbody></table></div>
              <div class="table-foot"><span>Wilayah api = kumpulan titik panas dalam radius ±20 km. Klik baris untuk melihatnya di peta.</span></div>
            </article>
            <article class="data-panel areas-panel">
              <div class="panel-heading"><div><div class="section-kicker">KAWASAN TERDAMPAK</div><h2>Api di kawasan lindung</h2></div></div>
              <ol class="area-list" id="area-list"><li class="area-empty">Belum ada data.</li></ol>
              <div class="disclaimer"><span class="info-mark">i</span><p>Jalur asap adalah <strong>perkiraan 6 jam searah angin</strong>; kualitas udara dari model CAMS (resolusi ±40 km), bukan alat ukur lapangan.</p></div>
            </article>
          </div>
        </section>

        <section class="lower-grid" id="detections">
          <article class="data-panel detections-panel">
            <div class="panel-heading"><div><div class="section-kicker">FEED NEAR-REAL-TIME</div><h2>Deteksi terbaru</h2></div><span class="result-count" id="result-count">0 TITIK</span></div>
            <div class="table-wrap"><table><thead><tr><th>LOKASI</th><th>WAKTU UTC</th><th>CONF.</th><th>FRP</th></tr></thead><tbody id="fire-rows"><tr><td colspan="4" class="empty-row">Memuat deteksi…</td></tr></tbody></table></div>
            <div class="table-foot"><span>Menampilkan deteksi paling baru</span><button id="export-button" disabled title="Unduh data CSV">Unduh CSV <span>↓</span></button></div>
          </article>
          <article class="data-panel insight-panel">
            <div class="panel-heading"><div><div class="section-kicker">RINGKASAN SINYAL</div><h2>Profil deteksi</h2></div><span class="mini-satellite">VIIRS</span></div>
            <div class="profile-chart" id="profile-chart"><div class="chart-empty">Grafik tampil setelah data dimuat</div></div>
            <div class="profile-legend"><span><i class="legend-dot high"></i> Tinggi</span><span><i class="legend-dot medium"></i> Sedang</span><span><i class="legend-dot low"></i> Rendah</span></div>
            <div class="disclaimer"><span class="info-mark">i</span><p>Hotspot merupakan <strong>indikasi anomali termal</strong>, bukan konfirmasi kebakaran. Resolusi VIIRS sekitar 375 m.</p></div>
          </article>
        </section>

        <section class="about-section ispu-guide" aria-label="Arti warna kualitas udara">
          <div class="section-kicker">PANDUAN KUALITAS UDARA (ISPU)</div>
          <h2>Arti warna &amp; apa yang harus dilakukan</h2>
          <div class="ispu-guide-grid">${ISPU_LEVELS.map((level) => `<div class="ispu-guide-item" style="--level:${level.color}"><span class="ispu-badge ${level.key}">${level.label}</span><p><b>${ISPU_ADVICE[level.key].meaning}</b> ${ISPU_ADVICE[level.key].action}</p></div>`).join('')}</div>
        </section>

        <section class="about-section" id="about">
          <div class="section-kicker">METODOLOGI &amp; SUMBER DATA</div>
          <h2>Cara membaca halaman ini</h2>
          <div class="about-grid">
            <div><h3>Titik panas</h3><p>Deteksi anomali termal satelit VIIRS (375 m) dari <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a>, near-real-time. Data diperbarui di server setiap 10 menit.</p></div>
            <div><h3>Kedekatan</h3><p>Jarak tiap titik ke permukiman terdekat (<a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, ±257 ribu desa/kota) dan ke batas kawasan konservasi atau hutan lindung menurut peta resmi Kawasan Hutan 1:250.000 status Juni 2026, serta apakah titik berada di Kesatuan Hidrologis Gambut. Keduanya dari <a href="https://sigap.kehutanan.go.id/" target="_blank" rel="noreferrer">SIGAP Kementerian Kehutanan</a>.</p></div>
            <div><h3>Asap &amp; ISPU</h3><p>Titik dikelompokkan per ±20 km. Untuk 30 kluster teratas, angin dan PM2.5 diambil dari <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (model CAMS). Kategori mengikuti ISPU PM2.5 rata-rata 24 jam (PermenLHK P.14/2020). Jalur asap adalah kerucut 6 jam searah angin.</p></div>
            <div><h3>Istilah</h3><p><b>Titik panas</b>: lokasi yang jauh lebih panas dari sekitarnya menurut satelit, umumnya api. <b>FRP</b>: kekuatan api dalam megawatt. <b>PM2.5</b>: partikel asap halus yang masuk ke paru-paru. <b>ISPU</b>: Indeks Standar Pencemar Udara. <b>KHG</b>: Kesatuan Hidrologis Gambut.</p></div>
            <div><h3>Batasan</h3><p>Hotspot bukan konfirmasi kebakaran, kualitas udara berasal dari model, dan batas kawasan dapat berbeda dari kondisi lapangan. Gunakan sebagai peringatan dini, bukan pengganti verifikasi lapangan.</p></div>
          </div>
        </section>
        <footer class="app-footer"><span>SUMBER DATA <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS ↗</a></span><span>Deteksi satelit bukan pengganti verifikasi lapangan.</span></footer>
      </div>
    </main>
  </div>
`

// ---------- Peta ----------

const map = L.map('fire-map', { preferCanvas: true, zoomControl: false, attributionControl: false, minZoom: 3, maxZoom: 13 })
map.fitBounds([[-11, 94], [6, 142]], { padding: [12, 12] })
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map)
L.control.zoom({ position: 'bottomright' }).addTo(map)
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map)
map.createPane('areas').style.zIndex = '350'
map.createPane('smoke').style.zIndex = '380'

const fireLayer = L.layerGroup().addTo(map)
const smokeLayer = L.layerGroup().addTo(map)
let areaLayer: L.GeoJSON | null = null
let areaLoad: Promise<void> | null = null
let peatLayer: L.GeoJSON | null = null
let peatLoad: Promise<void> | null = null

// ---------- Status ----------

type Confidence = 'high' | 'medium' | 'low'
let report: Report | null = null
let priorityClusters: Cluster[] = []
let controller: AbortController | null = null

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const sourceSelect = byId<HTMLSelectElement>('source-select')
const mapMessage = byId<HTMLDivElement>('map-message')
const numberFormat = new Intl.NumberFormat('id-ID')
const wibFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' })

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
}

function confidenceOf(raw: string): Confidence {
  const value = raw.toLowerCase()
  if (value === 'h' || value === 'high' || Number(value) >= 80) return 'high'
  if (value === 'l' || value === 'low' || (Number(value) > 0 && Number(value) < 40)) return 'low'
  return 'medium'
}

function formatKm(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`
}

// Satu kalimat sederhana yang menjelaskan risiko wilayah api.
function clusterSentence(cluster: Cluster) {
  const parts: string[] = []
  const area = cluster.areas[0]
  if (area?.km === 0) parts.push(`Api di dalam ${escapeHtml(area.name)}`)
  else parts.push(`${numberFormat.format(cluster.count)} titik api`)
  if (cluster.nearest && cluster.nearestKm <= 5) parts.push(`${formatKm(cluster.nearestKm)} dari permukiman`)
  if (cluster.peatFires / cluster.count >= 0.5) parts.push('sebagian besar di lahan gambut')
  let sentence = parts.join(', ') + '.'
  const smoke = cluster.smoke
  if (smoke && levelRank(smoke.level.key) >= levelRank('sedang')) {
    sentence += ` Asap ${smoke.level.label.toLowerCase()} bergerak ke ${compassName(smoke.heading)} ±${Math.round(smoke.reachKm)} km${smoke.towns.length ? `, melewati ${smoke.towns.slice(0, 2).map((town) => escapeHtml(town.name)).join(' dan ')}` : ''}.`
  }
  return sentence
}

function levelPill(level: IspuLevel) {
  return `<span class="ispu-badge ${level.key}" style="--level:${level.color}">${level.label}</span>`
}

function renderStatus(data: Report) {
  const { summary } = data
  const smoked = data.clusters.filter((cluster) => cluster.smoke)
  const worst = smoked.map((cluster) => cluster.smoke!.level).sort((a, b) => levelRank(b.key) - levelRank(a.key))[0]
  const card = byId('status-card')
  const period = data.days === 1 ? '24 jam terakhir' : `${data.days} hari terakhir`
  const points: string[] = []
  let headline: string

  if (!summary.total) {
    card.style.setProperty('--level', '#3f9a5c')
    byId('status-pill').textContent = 'Tidak ada titik api'
    headline = `Satelit tidak mendeteksi titik panas dalam ${period}.`
  } else if (!worst) {
    card.style.setProperty('--level', '#9aa69f')
    byId('status-pill').textContent = 'Data asap belum tersedia'
    headline = `${numberFormat.format(summary.total)} titik panas terpantau dalam ${period}.`
  } else {
    const count = smoked.filter((cluster) => cluster.smoke!.level.key === worst.key).length
    card.style.setProperty('--level', worst.color)
    byId('status-pill').textContent = worst.label
    headline = UNHEALTHY_LEVELS.includes(worst.key)
      ? `Asap ${worst.label.toLowerCase()} terdeteksi di ${count} wilayah api.`
      : `Kualitas udara di sekitar titik api umumnya ${worst.label.toLowerCase()}.`
  }
  byId('status-scope').textContent = `Seluruh Indonesia · ${period}`
  byId('status-headline').textContent = headline

  if (summary.total) {
    points.push(`<b>${numberFormat.format(summary.total)}</b> titik panas terpantau satelit; <b>${numberFormat.format(summary.nearSettlement)}</b> di antaranya kurang dari ${SETTLEMENT_ALERT_KM} km dari permukiman warga.`)
    const unhealthy = data.exposedTowns.filter((town) => UNHEALTHY_LEVELS.includes(town.level.key))
    if (unhealthy.length) points.push(`<b>${unhealthy.length}</b> kota/kecamatan diperkirakan dilalui asap tidak sehat, antara lain ${unhealthy.slice(0, 4).map((town) => `<b>${escapeHtml(town.name)}</b>`).join(', ')}.`)
    const forest = summary.konservasi.inside + summary.lindung.inside
    if (forest || summary.peat.inside) points.push(`<b>${numberFormat.format(forest)}</b> titik berada di kawasan konservasi atau hutan lindung, dan <b>${numberFormat.format(summary.peat.inside)}</b> di lahan gambut yang menghasilkan asap pekat.`)
  }
  byId('status-points').innerHTML = points.map((point) => `<li>${point}</li>`).join('')

  const advice = byId('status-advice')
  advice.hidden = !worst
  if (worst) byId('status-advice-text').textContent = `Bila Anda berada di daerah berstatus ${worst.label.toLowerCase()}: ${ISPU_ADVICE[worst.key].action}`
}

function renderTowns(data: Report) {
  byId('towns-count').textContent = `${data.exposedTowns.length} DAERAH`
  byId('town-list').innerHTML = data.exposedTowns.length ? data.exposedTowns.slice(0, 24).map((town, index) => `
    <li><button type="button" data-town="${index}">${levelPill(town.level)}<span class="town-name"><strong>${escapeHtml(town.name)}</strong><small>${escapeHtml(town.province)}${town.pm25 !== null ? ` · PM2.5 ±${Math.round(town.pm25)} µg/m³` : ''}</small></span><small class="town-fire">Api ${formatKm(town.fireKm)} di ${town.fireDirection}</small></button></li>`).join('')
    : '<li class="area-empty">Tidak ada kota yang diperkirakan dilalui asap berkategori sedang atau lebih buruk.</li>'
}

function formatPm(value: number | null) {
  return value === null ? '–' : `${Math.round(value)} µg/m³`
}

function formatPlace(lat: number, lon: number) {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? 'LS' : 'LU'}, ${lon.toFixed(2)}° BT`
}

function setRiskState(text: string, tone: '' | 'busy' | 'error' = '') {
  const state = byId('risk-state')
  state.textContent = text
  state.className = `risk-state ${tone}`
}

function setLoading(loading: boolean) {
  byId<HTMLButtonElement>('refresh-button').disabled = loading
  byId('refresh-button').classList.toggle('spinning', loading)
  if (loading) {
    byId('feed-label').textContent = 'Memuat data'
    setRiskState('Menganalisis…', 'busy')
  }
}

function setError(message: string) {
  byId('feed-state').classList.add('error')
  byId('feed-label').textContent = 'Data tidak tersedia'
  byId('monitor-status').textContent = 'Gangguan data'
  byId('source-summary').textContent = message
  setRiskState('Analisis tidak tersedia', 'error')
  if (report) return
  mapMessage.classList.add('visible')
  mapMessage.querySelector('strong')!.textContent = 'Data belum dapat dimuat'
  mapMessage.querySelector('small')!.textContent = message
  byId<HTMLButtonElement>('map-retry').hidden = false
}

// ---------- Render ----------

function firePopup(fire: ReportFire) {
  const [lat, lon, date, time, confidence, frp, , settlementIndex, settlementKm, areaIndex, areaKm, peatIndex] = fire
  const lines = [
    '<strong>Titik panas (kemungkinan api)</strong>',
    `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    `Keyakinan: ${({ high: 'tinggi', medium: 'sedang', low: 'rendah' } as const)[confidenceOf(confidence)]} · kekuatan ${frp.toFixed(1)} MW`,
    `${escapeHtml(date)} ${escapeHtml(time.slice(0, 2))}:${escapeHtml(time.slice(2))} UTC`,
    settlementIndex >= 0 ? `Permukiman terdekat: <b>${escapeHtml(report!.settlementNames[settlementIndex])}</b> (${formatKm(settlementKm)})` : 'Tidak ada permukiman dalam 10 km',
  ]
  if (areaIndex >= 0) lines.push(`${areaKm === 0 ? 'Di dalam' : `${formatKm(areaKm)} dari`} <b>${escapeHtml(report!.areas[areaIndex].name)}</b>`)
  if (peatIndex >= 0) lines.push(`Lahan gambut: <b>${escapeHtml(report!.peatUnits[peatIndex])}</b>`)
  return lines.join('<br>')
}

function renderMap(fires: ReportFire[]) {
  fireLayer.clearLayers()
  // Titik keyakinan tinggi digambar terakhir agar tidak tertutup titik lain.
  const drawOrder: Record<Confidence, number> = { low: 0, medium: 1, high: 2 }
  const colors: Record<Confidence, string> = { high: '#df593c', medium: '#df9b35', low: '#5e9d78' }
  const ordered = fires.map((fire) => ({ fire, confidence: confidenceOf(fire[4]) })).sort((a, b) => drawOrder[a.confidence] - drawOrder[b.confidence])
  for (const { fire, confidence } of ordered) {
    L.circleMarker([fire[0], fire[1]], {
      radius: confidence === 'high' ? 4.5 : 3.2,
      color: colors[confidence],
      weight: 1,
      opacity: 0.9,
      fillColor: colors[confidence],
      fillOpacity: 0.68,
    }).bindPopup(() => firePopup(fire)).addTo(fireLayer)
  }
}

function renderChart(fires: ReportFire[]) {
  const counts = { high: 0, medium: 0, low: 0 }
  for (const fire of fires) counts[confidenceOf(fire[4])]++
  const max = Math.max(1, counts.high, counts.medium, counts.low)
  const columns: [Confidence, string][] = [['high', 'Tinggi'], ['medium', 'Sedang'], ['low', 'Rendah']]
  byId('profile-chart').innerHTML = columns.map(([key, label]) => `
    <div class="chart-column"><div class="chart-number">${numberFormat.format(counts[key])}</div><div class="chart-track"><div class="chart-bar ${key}" style="height:${Math.max(4, (counts[key] / max) * 100)}%"></div></div><span>${label}</span></div>
  `).join('')
}

function renderLatest(fires: ReportFire[]) {
  const latest = [...fires].sort((a, b) => `${b[2]}${b[3]}`.localeCompare(`${a[2]}${a[3]}`)).slice(0, 7)
  byId('fire-rows').innerHTML = latest.length ? latest.map((fire) => {
    const confidence = confidenceOf(fire[4])
    return `<tr><td><span class="location-cell"><span class="table-fire ${confidence}"></span>${formatPlace(fire[0], fire[1])}</span></td><td>${escapeHtml(fire[2])} <span class="muted-time">${escapeHtml(fire[3].slice(0, 2))}:${escapeHtml(fire[3].slice(2))}Z</span></td><td><span class="confidence ${confidence}">${escapeHtml(fire[4].toUpperCase())}</span></td><td>${fire[5].toFixed(1)}</td></tr>`
  }).join('') : '<tr><td colspan="4" class="empty-row">Tidak ada titik panas dalam periode ini.</td></tr>'
  byId('result-count').textContent = `${numberFormat.format(fires.length)} TITIK`
}

function renderRisk(data: Report) {
  const { summary } = data
  byId('risk-settlement').textContent = numberFormat.format(summary.nearSettlement)
  byId('risk-settlement-note').textContent = `Di sekitar ${numberFormat.format(summary.villages)} desa/kota`
  byId('risk-konservasi').textContent = numberFormat.format(summary.konservasi.inside)
  byId('risk-konservasi-note').textContent = `${summary.konservasi.areas} kawasan · +${numberFormat.format(summary.konservasi.nearEdge)} titik ≤ 2 km dari batas`
  byId('risk-lindung').textContent = numberFormat.format(summary.lindung.inside)
  byId('risk-lindung-note').textContent = `${summary.lindung.areas} kawasan · +${numberFormat.format(summary.lindung.nearEdge)} titik ≤ 2 km dari batas`
  byId('risk-peat').textContent = numberFormat.format(summary.peat.inside)
  byId('risk-peat-note').textContent = `Di ${numberFormat.format(summary.peat.units)} KHG · ${summary.total ? Math.round((summary.peat.inside / summary.total) * 100) : 0}% dari semua titik`
  byId('risk-smoke').textContent = data.smokeError ? '–' : numberFormat.format(summary.smoky)
  byId('risk-smoke-note').textContent = data.smokeError ? 'Data asap sedang tidak tersedia' : `${numberFormat.format(summary.exposed)} permukiman di jalur asapnya`

  const max = Math.max(1, ...data.areaRanking.map((area) => area.inside + area.near))
  byId('area-list').innerHTML = data.areaRanking.length ? data.areaRanking.map((area) => `
    <li><div class="area-name"><span class="area-kind ${area.kind}">${area.kind === 'lindung' ? 'HL' : 'KK'}</span><strong>${escapeHtml(area.name)}</strong></div>
    <div class="area-bar"><i class="inside" style="width:${(area.inside / max) * 100}%"></i><i class="near" style="width:${(area.near / max) * 100}%"></i></div>
    <small>${numberFormat.format(area.inside)} titik di dalam · ${numberFormat.format(area.near)} di tepi · ${numberFormat.format(area.frp)} MW</small></li>`).join('') : '<li class="area-empty">Tidak ada hotspot di dalam atau dekat kawasan lindung.</li>'

  priorityClusters = data.clusters.slice(0, 12)
  byId('priority-rows').innerHTML = priorityClusters.map((cluster, index) => {
    const smoke = cluster.smoke
    const nearest = cluster.nearest ? `<strong>${escapeHtml(cluster.nearest.name)}</strong><small>${formatKm(cluster.nearestKm)} · ${cluster.nearSettlementFires} titik ≤ ${SETTLEMENT_ALERT_KM} km</small>` : '<small>Tidak ada dalam 10 km</small>'
    const peat = cluster.peatFires ? `<small class="peat-note">${numberFormat.format(cluster.peatFires)} titik di lahan gambut</small>` : ''
    const area = (cluster.areas[0] ? `<span class="area-tag ${cluster.areas[0].kind}">${cluster.areas[0].km === 0 ? 'Di dalam' : formatKm(cluster.areas[0].km)}</span><small>${escapeHtml(cluster.areas[0].name)}${cluster.areas.length > 1 ? ` +${cluster.areas.length - 1}` : ''}</small>` : '<small class="muted">—</small>') + peat
    const air = smoke ? `<span class="ispu-badge ${smoke.level.key}" style="--level:${smoke.level.color}">${smoke.level.label}</span><small>PM2.5 ${formatPm(smoke.pm25Mean24)} rata² 24j · puncak ${formatPm(smoke.pm25Max24)}</small>` : '<small class="muted">Tidak dianalisis</small>'
    const wind = smoke ? `<span class="wind"><i style="transform:rotate(${smoke.heading}deg)">↑</i>${smoke.windKmh.toFixed(0)} km/j ke ${compassLabel(smoke.heading)}</span><small>±${Math.round(smoke.reachKm)} km · ${numberFormat.format(smoke.settlements)} permukiman${smoke.towns.length ? ` (${smoke.towns.slice(0, 2).map((town) => escapeHtml(town.name)).join(', ')})` : ''}</small>` : '<small class="muted">—</small>'
    return `<tr data-cluster="${index}"><td class="rank">${index + 1}</td><td class="cluster-cell"><strong>${cluster.nearest ? `Dekat ${escapeHtml(cluster.nearest.name)}` : formatPlace(cluster.lat, cluster.lon)}</strong><small>${cluster.nearest?.province ? `${escapeHtml(cluster.nearest.province)} · ` : ''}${formatPlace(cluster.lat, cluster.lon)}</small><small class="row-summary">${clusterSentence(cluster)}</small></td><td data-label="Titik · FRP"><strong>${numberFormat.format(cluster.count)}</strong><small>${numberFormat.format(Math.round(cluster.frp))} MW · ${cluster.high} tinggi</small></td><td data-label="Permukiman terdekat">${nearest}</td><td data-label="Kawasan">${area}</td><td data-label="Kualitas udara">${air}</td><td data-label="Angin · jangkauan asap">${wind}</td></tr>`
  }).join('') || '<tr><td colspan="7" class="empty-row">Tidak ada kluster.</td></tr>'

  smokeLayer.clearLayers()
  for (const cluster of data.clusters) {
    const smoke = cluster.smoke
    if (!smoke || smoke.level.key === 'baik') continue
    L.polygon(smoke.plume, { pane: 'smoke', color: smoke.level.color, weight: 1, opacity: 0.55, fillColor: smoke.level.color, fillOpacity: 0.2, dashArray: '4 3' })
      .bindTooltip(`Asap ${smoke.level.label} · PM2.5 ${formatPm(smoke.pm25Mean24)}<br>Angin ${smoke.windKmh.toFixed(0)} km/j ke ${compassLabel(smoke.heading)} · ±${Math.round(smoke.reachKm)} km`, { sticky: true })
      .addTo(smokeLayer)
  }

  if (data.smokeError) setRiskState('Data asap sedang tidak tersedia', 'error')
  else setRiskState(`${numberFormat.format(summary.clusterCount)} kluster · asap dianalisis untuk ${summary.smokeAnalyzed} teratas`)
}

function render(data: Report) {
  report = data
  const { summary } = data
  renderMap(data.fires)
  byId('active-count').textContent = numberFormat.format(summary.total)
  byId('high-count').textContent = numberFormat.format(summary.high)
  byId('frp-total').textContent = numberFormat.format(summary.frp)
  byId('period-note').textContent = `${data.days === 1 ? '24 jam' : `${data.days} hari`} terakhir · ${sourceNames[data.source]}`
  byId('monitor-status').textContent = summary.total ? 'Feed aktif' : 'Tidak ada deteksi'
  byId('source-summary').textContent = summary.total ? `${numberFormat.format(summary.total)} rekaman satelit` : 'Tidak ada hotspot terdeteksi'
  byId('updated-at').textContent = `${wibFormat.format(new Date(data.fetchedAt))} WIB`
  byId('feed-state').classList.remove('error')
  byId('feed-label').textContent = 'Data terkini'
  mapMessage.classList.remove('visible')
  byId<HTMLButtonElement>('export-button').disabled = summary.total === 0
  renderLatest(data.fires)
  renderChart(data.fires)
  renderRisk(data)
  renderStatus(data)
  renderTowns(data)
  void loadAreas()
}

// Batas kawasan dimuat terpisah setelah data utama tampil, lapisan gambut hanya saat diaktifkan.
function geojsonLayer(url: string, style: (feature?: GeoJSON.Feature) => L.PathOptions, tooltip: (properties: Record<string, string>) => string) {
  return fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<GeoJSON.FeatureCollection>
    })
    .then((geojson) => L.geoJSON(geojson, {
      pane: 'areas',
      style,
      onEachFeature: (feature, layer) => layer.bindTooltip(tooltip(feature.properties ?? {}), { sticky: true }),
    }))
}

function loadAreas() {
  areaLoad ??= geojsonLayer(
    '/data/kawasan-hutan.json',
    (feature) => {
      const lindung = feature?.properties?.k === 'lindung'
      return { color: lindung ? '#4f7f5f' : '#2f6b49', weight: 0.7, opacity: 0.7, fillColor: lindung ? '#8fbf8f' : '#4f9a6c', fillOpacity: 0.16 }
    },
    (properties) => `${escapeHtml(properties.n)}<br><small>${escapeHtml(properties.t)}</small>`,
  )
    .then((layer) => {
      areaLayer = layer
      if (byId<HTMLInputElement>('layer-areas').checked) layer.addTo(map)
    })
    .catch((error) => {
      areaLoad = null
      console.warn('Batas kawasan gagal dimuat:', error)
    })
  return areaLoad
}

function loadPeat() {
  peatLoad ??= geojsonLayer(
    '/data/gambut.json',
    () => ({ color: '#8a5a2b', weight: 0.6, opacity: 0.6, fillColor: '#b07a43', fillOpacity: 0.18 }),
    (properties) => `${escapeHtml(properties.n)}<br><small>Kesatuan Hidrologis Gambut</small>`,
  )
    .then((layer) => {
      peatLayer = layer
      if (byId<HTMLInputElement>('layer-peat').checked) layer.addTo(map)
    })
    .catch((error) => {
      peatLoad = null
      console.warn('Batas KHG gagal dimuat:', error)
    })
  return peatLoad
}

// ---------- Data ----------

async function refreshData() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  setLoading(true)
  byId<HTMLButtonElement>('map-retry').hidden = true
  try {
    const response = await fetch(`/api/hotspots?source=${activeSource}&days=${activeDays}`, { signal: current.signal })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `Server merespons ${response.status}`)
    render(body as Report)
  } catch (error) {
    if (current.signal.aborted) return
    setError(error instanceof Error ? error.message : 'Gagal memuat data hotspot.')
  } finally {
    if (controller === current) setLoading(false)
  }
}

function syncControls() {
  sourceSelect.value = activeSource
  document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((button) => button.classList.toggle('active', Number(button.dataset.days) === activeDays))
  const url = new URL(location.href)
  url.searchParams.set('sumber', activeSource)
  url.searchParams.set('hari', String(activeDays))
  history.replaceState(null, '', url)
}

function exportCsv() {
  if (!report?.fires.length) return
  const headers = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp', 'daynight', 'permukiman_terdekat', 'jarak_permukiman_km', 'kawasan', 'jenis_kawasan', 'jarak_kawasan_km', 'khg_gambut']
  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`
  const lines = report.fires.map(([lat, lon, date, time, confidence, frp, daynight, settlementIndex, settlementKm, areaIndex, areaKm, peatIndex]) => [
    lat, lon, date, time, confidence, frp, daynight,
    settlementIndex >= 0 ? report!.settlementNames[settlementIndex] : '',
    settlementIndex >= 0 ? settlementKm : '',
    areaIndex >= 0 ? report!.areas[areaIndex].name : '',
    areaIndex >= 0 ? report!.areas[areaIndex].kind : '',
    areaIndex >= 0 ? areaKm : '',
    peatIndex >= 0 ? report!.peatUnits[peatIndex] : '',
  ].map(escape).join(','))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['﻿', [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }))
  link.download = `karhutla-${report.source.toLowerCase()}-${report.days}hari-${report.fetchedAt.slice(0, 10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
}

// ---------- Cek lokasi ----------

const checkInput = byId<HTMLInputElement>('check-input')
const suggestions = byId<HTMLUListElement>('check-suggestions')
const checkResult = byId('check-result')
const locationLayer = L.layerGroup().addTo(map)
let suggestionItems: { name: string; province: string; lat: number; lon: number }[] = []
let searchTimer = 0

async function runCheck(lat: number, lon: number, label: string) {
  suggestions.hidden = true
  checkResult.innerHTML = `<p class="check-loading">Memeriksa ${escapeHtml(label)}…</p>`
  try {
    const response = await fetch(`/api/lokasi?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&source=${activeSource}&days=${activeDays}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `Server merespons ${response.status}`)
    renderCheck(body as LocationCheck, lat, lon, label)
  } catch (error) {
    checkResult.innerHTML = `<p class="check-error">${escapeHtml(error instanceof Error ? error.message : 'Pemeriksaan gagal.')}</p>`
  }
}

function renderCheck(result: LocationCheck, lat: number, lon: number, label: string) {
  const period = result.days === 1 ? '24 jam terakhir' : `${result.days} hari terakhir`
  const fire = result.nearestFire
  const lines: string[] = []
  if (fire && fire.km <= 25) {
    const urgency = fire.km <= SETTLEMENT_ALERT_KM ? ' <b>Sangat dekat — waspadai api dan ikuti arahan BPBD.</b>' : ''
    lines.push(`Titik api terdekat <b>${formatKm(fire.km)}</b> di arah ${fire.direction}${fire.settlement ? ` (dekat ${escapeHtml(fire.settlement)})` : ''}.${urgency}`)
    lines.push(`${numberFormat.format(result.counts.km5)} titik dalam 5 km · ${numberFormat.format(result.counts.km10)} dalam 10 km · ${numberFormat.format(result.counts.km25)} dalam 25 km (${period}).`)
  } else {
    lines.push(`Tidak ada titik api dalam radius 25 km selama ${period}${fire ? `; yang terdekat ${formatKm(fire.km)} di arah ${fire.direction}` : ''}.`)
  }
  const plume = result.smoke[0]
  if (plume) lines.push(`Lokasi ini <b>berada di jalur asap</b> dari wilayah api ${formatKm(plume.fireKm)} di arah ${plume.fireDirection}${plume.place ? ` (dekat ${escapeHtml(plume.place)})` : ''}.`)
  else lines.push('Lokasi ini tidak berada di jalur asap wilayah api utama yang dianalisis.')
  if (result.air) {
    lines.push(`Perkiraan PM2.5 rata-rata 24 jam: <b>${formatPm(result.air.pm25Mean24)}</b>, puncak 24 jam ke depan ${formatPm(result.air.pm25Max24)}. Angin ${result.air.windKmh.toFixed(0)} km/jam ke ${compassName((result.air.windFrom + 180) % 360)}.`)
  }
  const place = result.place ? `${result.place.name}${result.place.province ? `, ${result.place.province}` : ''}` : label
  checkResult.innerHTML = `
    <div class="check-summary" style="--level:${result.level.color}">
      <div class="check-head">${levelPill(result.level)}<strong>${escapeHtml(place)}</strong></div>
      <ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
      <p class="check-advice"><b>${ISPU_ADVICE[result.level.key].meaning}</b> ${ISPU_ADVICE[result.level.key].action}</p>
      <button type="button" class="check-map" id="check-map">Lihat di peta ↗</button>
    </div>`
  locationLayer.clearLayers()
  L.circleMarker([lat, lon], { radius: 9, color: '#1f5fbf', weight: 3, fillColor: '#ffffff', fillOpacity: 1 }).bindTooltip(escapeHtml(place)).addTo(locationLayer)
  L.circle([lat, lon], { radius: 10000, color: '#1f5fbf', weight: 1, dashArray: '4 4', fill: false }).addTo(locationLayer)
  byId('check-map').addEventListener('click', () => {
    byId('map-section').scrollIntoView({ behavior: 'smooth' })
    map.flyTo([lat, lon], 10, { duration: 0.8 })
  })
}

checkInput.addEventListener('input', () => {
  window.clearTimeout(searchTimer)
  const query = checkInput.value.trim()
  if (query.length < 2) {
    suggestions.hidden = true
    return
  }
  searchTimer = window.setTimeout(async () => {
    const response = await fetch(`/api/cari?q=${encodeURIComponent(query)}`).catch(() => null)
    suggestionItems = response?.ok ? await response.json() : []
    suggestions.innerHTML = suggestionItems.length
      ? suggestionItems.map((item, index) => `<li><button type="button" data-place="${index}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.province)}</small></button></li>`).join('')
      : '<li class="check-none">Nama tidak ditemukan.</li>'
    suggestions.hidden = false
  }, 250)
})

suggestions.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-place]')
  const item = button && suggestionItems[Number(button.dataset.place)]
  if (!item) return
  checkInput.value = item.name
  void runCheck(item.lat, item.lon, item.name)
})

byId<HTMLFormElement>('check-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const first = suggestionItems[0]
  if (first) {
    checkInput.value = first.name
    void runCheck(first.lat, first.lon, first.name)
  }
})

byId('locate-button').addEventListener('click', () => {
  if (!navigator.geolocation) {
    checkResult.innerHTML = '<p class="check-error">Peramban ini tidak mendukung lokasi perangkat.</p>'
    return
  }
  checkResult.innerHTML = '<p class="check-loading">Meminta izin lokasi…</p>'
  navigator.geolocation.getCurrentPosition(
    (position) => void runCheck(position.coords.latitude, position.coords.longitude, 'lokasi Anda'),
    () => { checkResult.innerHTML = '<p class="check-error">Lokasi tidak dapat diakses. Ketik nama daerah Anda sebagai gantinya.</p>' },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
  )
})

byId('town-list').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-town]')
  const town = button && report?.exposedTowns[Number(button.dataset.town)]
  if (!town) return
  checkInput.value = town.name
  byId('cek-lokasi').scrollIntoView({ behavior: 'smooth' })
  void runCheck(town.lat, town.lon, town.name)
})

// ---------- Interaksi ----------

byId('refresh-button').addEventListener('click', refreshData)
byId('map-retry').addEventListener('click', refreshData)
byId('export-button').addEventListener('click', exportCsv)

sourceSelect.addEventListener('change', () => {
  activeSource = sourceSelect.value as Source
  syncControls()
  void refreshData()
})
document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((button) => {
  button.addEventListener('click', () => {
    activeDays = Number(button.dataset.days)
    syncControls()
    void refreshData()
  })
})

byId<HTMLInputElement>('layer-smoke').addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).checked) smokeLayer.addTo(map)
  else smokeLayer.remove()
})
byId<HTMLInputElement>('layer-areas').addEventListener('change', (event) => {
  if (!areaLayer) return
  if ((event.target as HTMLInputElement).checked) areaLayer.addTo(map)
  else areaLayer.remove()
})
byId<HTMLInputElement>('layer-peat').addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).checked) {
    if (peatLayer) peatLayer.addTo(map)
    else void loadPeat()
  } else peatLayer?.remove()
})
byId('priority-rows').addEventListener('click', (event) => {
  const row = (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-cluster]')
  const cluster = row && priorityClusters[Number(row.dataset.cluster)]
  if (!cluster) return
  byId('map-section').scrollIntoView({ behavior: 'smooth' })
  map.flyTo([cluster.lat, cluster.lon], 9, { duration: 0.8 })
})

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.side-nav .nav-link')
navLinks.forEach((link) => link.addEventListener('click', () => {
  navLinks.forEach((item) => item.classList.toggle('selected', item === link))
}))

// Perbarui otomatis selama halaman terbuka; server sendiri menyegarkan cache tiap 10 menit.
setInterval(() => {
  if (document.visibilityState === 'visible') void refreshData()
}, AUTO_REFRESH_MS)

new ResizeObserver(() => map.invalidateSize()).observe(byId('fire-map'))
syncControls()
void refreshData()
