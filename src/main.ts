import './style.css'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ISPU_ADVICE, ISPU_LEVELS, SETTLEMENT_ALERT_KM, UNHEALTHY_LEVELS, compassLabel, compassName, ispuLevel, levelRank, type Cluster, type IspuLevel } from './risk.ts'
import { VULNERABLE_SHORT, checklist, cigaretteText, shareCardImage, shareMenu, shareText, streakText, trashEquivalent, vulnerableBlock, type ShareCard } from './impact.ts'
import { levelIcon, levelMeter } from './icons.ts'
import { FlameLayer } from './flames.ts'
import { footballFields, prognosis, speciesText, visibilityComparison, wildlifeFor } from './context.ts'
import { DAY_OPTIONS, DEFAULT_SOURCE, FLAG_STATIONARY, SOURCES, type BmkgForecast, type BnpbReport, type TimelineDay, type TimelineReport, type CctvReport, type LocationCheck, type Report, type ReportFire, type Source } from './report-types.ts'

const sourceNames: Record<Source, string> = {
  VIIRS_ALL: 'Gabungan VIIRS · 3 satelit NASA',
  VIIRS_NOAA21_NRT: 'NOAA-21 · VIIRS 375 m',
  VIIRS_NOAA20_NRT: 'NOAA-20 · VIIRS 375 m',
  VIIRS_SNPP_NRT: 'Suomi-NPP · VIIRS 375 m',
  BRIN_LAPAN: 'BRIN/LAPAN · SiPongi (resmi)',
}
const AREA_SOURCE = 'Kementerian Kehutanan (SIGAP)'

// Area penting lainnya dari SIGAP Kementerian Kehutanan; masing-masing dimuat hanya saat dicentang.
type Overlay = { id: string; label: string; hint: string; style: (feature?: GeoJSON.Feature) => L.PathOptions; tooltip: (properties: Record<string, string>) => string }
const PIPPIB_LABEL: Record<string, string> = { primer: 'hutan alam primer', gambut: 'lahan gambut', kawasan: 'kawasan hutan konservasi/lindung' }
const OVERLAYS: Overlay[] = [
  {
    id: 'pippib',
    label: 'Moratorium hutan primer & gambut',
    hint: 'Peta Indikatif Penghentian Pemberian Izin Baru (PIPPIB) 2026: hutan alam primer dan gambut yang tidak boleh diberi izin baru',
    style: (feature) => {
      const color = { primer: '#5b3f8c', gambut: '#7a4f2a', kawasan: '#4a5f8c' }[feature?.properties?.c as string] ?? '#5b3f8c'
      return { color, weight: 0.6, opacity: 0.7, fillColor: color, fillOpacity: 0.14, dashArray: '3 3' }
    },
    tooltip: (properties) => `Moratorium izin baru: ${escapeHtml(PIPPIB_LABEL[properties.c] ?? properties.c)}<br><small>PIPPIB 2026 periode I</small>`,
  },
  {
    id: 'kee',
    label: 'Kawasan Ekosistem Esensial',
    hint: 'Kawasan bernilai penting di luar kawasan konservasi: koridor satwa, taman kehati, mangrove, karst, lahan basah',
    style: () => ({ color: '#1f7a9c', weight: 1.2, opacity: 0.85, fillColor: '#3fa3c8', fillOpacity: 0.22 }),
    tooltip: (properties) => `${escapeHtml(properties.n)}<br><small>Kawasan Ekosistem Esensial${properties.t ? ` · ${escapeHtml(properties.t)}` : ''}</small>`,
  },
  {
    id: 'adat',
    label: 'Hutan adat',
    hint: 'Hutan adat yang sudah ditetapkan Kementerian Kehutanan',
    style: () => ({ color: '#a0521d', weight: 1.4, opacity: 0.9, fillColor: '#d98a4a', fillOpacity: 0.2, dashArray: '5 3' }),
    tooltip: (properties) => `${escapeHtml(properties.n)}<br><small>Hutan adat${properties.s ? ` · ${escapeHtml(properties.s)}` : ''}</small>`,
  },
  {
    id: 'mangrove',
    label: 'Mangrove',
    hint: 'Peta Mangrove Nasional 2024 (citra PlanetScope dan Sentinel-2)',
    style: (feature) => ({ color: '#0e7c66', weight: 0.5, opacity: 0.8, fillColor: '#16a085', fillOpacity: { lebat: 0.45, sedang: 0.32, jarang: 0.2 }[feature?.properties?.c as string] ?? 0.3 }),
    tooltip: (properties) => `Mangrove ${escapeHtml(properties.c)}<br><small>Peta Mangrove Nasional 2024</small>`,
  },
  {
    id: 'rawan',
    label: 'Rawan karhutla (tinggi)',
    hint: 'Peta kerawanan kebakaran hutan dan lahan 2025, hanya kelas tinggi dan sangat tinggi',
    style: (feature) => {
      const severe = feature?.properties?.c === 'sangat-tinggi'
      return { color: severe ? '#b03a2e' : '#d9822b', weight: 0.4, opacity: 0.6, fillColor: severe ? '#c0392b' : '#e8913a', fillOpacity: severe ? 0.24 : 0.16 }
    },
    tooltip: (properties) => `Rawan karhutla: ${properties.c === 'sangat-tinggi' ? 'sangat tinggi' : 'tinggi'}<br><small>Peta kerawanan karhutla 2025</small>`,
  },
]
const AUTO_REFRESH_MS = 10 * 60 * 1000

// Pilihan sumber & periode dibaca dari URL agar tautan bisa dibagikan.
const params = new URLSearchParams(location.search)
let activeSource: Source = SOURCES.includes(params.get('sumber') as Source) ? (params.get('sumber') as Source) : DEFAULT_SOURCE
let activeDays: number = (DAY_OPTIONS as readonly number[]).includes(Number(params.get('hari'))) ? Number(params.get('hari')) : 3

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="#overview" aria-label="AMUK API - Pemantau Independen Karhutla">
        <span class="brand-mark"><span></span></span>
        <span class="brand-name"><small class="brand-kicker">PEMANTAU INDEPENDEN KARHUTLA</small>AMUK <span>API</span></span>
      </a>
      <div class="side-label">PEMANTAUAN</div>
      <nav class="side-nav" aria-label="Navigasi utama">
        <a class="nav-link selected" href="#overview"><span class="nav-icon">◫</span> Ringkasan</a>
        <a class="nav-link" href="#cek-lokasi"><span class="nav-icon">◎</span> Cek Lokasi Anda</a>
        <a class="nav-link" href="#map-section"><span class="nav-icon">⌖</span> Peta Hotspot</a>
        <a class="nav-link" href="#risk"><span class="nav-icon">◬</span> Analisis Risiko</a>
        <a class="nav-link" href="#cctv"><span class="nav-icon">◉</span> CCTV Kota</a>
        <a class="nav-link" href="#bmkg"><span class="nav-icon">☁</span> Data BMKG</a>
        <a class="nav-link" href="#detections"><span class="nav-icon">≋</span> Deteksi Terbaru</a>
        <a class="nav-link" href="#about"><span class="nav-icon">ⓘ</span> Metodologi</a>
      </nav>
      <div class="side-bottom">
        <div class="source-card">
          <span class="source-orbit">N</span>
          <div><strong id="source-card-title">NASA FIRMS</strong><small id="source-card-note">Fire Information System</small></div>
          <span class="live-dot"></span>
        </div>
        <div class="sidebar-foot">INDONESIA <span>·</span> v1.0</div>
      </div>
    </aside>

    <main class="workspace" id="overview">
      <header class="topbar">
        <a class="topbar-brand" href="#overview" aria-label="AMUK API - Pemantau Independen Karhutla"><span class="brand-mark"><span></span></span><span><small>PEMANTAU INDEPENDEN KARHUTLA</small><span>AMUK <b>API</b></span></span></a>
        <div class="crumb"><span>PEMANTAUAN</span><b>/</b> Indonesia</div>
        <div class="top-actions">
          <div class="feed-state" id="feed-state"><span class="state-dot"></span><span id="feed-label">Memuat data</span></div>
          <button class="icon-button" id="refresh-button" title="Perbarui data" aria-label="Perbarui data"><span class="refresh-glyph">↻</span></button>
        </div>
      </header>

      <div class="content">
        <section class="page-heading">
          <div>
            <div class="eyebrow"><span class="eyebrow-line"></span> AMUK API · PEMANTAU INDEPENDEN KARHUTLA</div>
            <h1>Situasi kebakaran hutan &amp; lahan <span>Indonesia</span></h1>
            <p class="heading-note">Titik panas satelit NASA FIRMS, perkiraan sebaran asap, dan risikonya bagi permukiman serta kawasan konservasi.</p>
          </div>
          <div class="heading-meta"><span class="meta-label">PEMBARUAN TERAKHIR</span><strong id="updated-at">Memuat…</strong></div>
        </section>

        <section class="status-section" aria-label="Status risiko saat ini">
          <article class="status-card" id="status-card" style="--level:#9aa69f">
            <div class="status-kicker">STATUS RISIKO SAAT INI</div>
            <div class="status-top"><span class="status-icon" id="status-icon">${levelIcon('na', 72)}</span>
              <div><div class="status-level"><span class="status-pill" id="status-pill">Memuat…</span><span class="status-scope" id="status-scope"></span></div>
              <h2 id="status-headline">Mengambil data satelit terbaru…</h2></div></div>
            <p class="impact-line" id="status-impact" hidden></p>
            <ul class="status-points" id="status-points"></ul>
            <div class="status-advice" id="status-advice" hidden><strong>Yang perlu dilakukan</strong><p id="status-advice-text"></p></div>
            <div id="status-share" hidden></div>
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

        <section class="bnpb-section" id="laporan-bnpb">
          <div class="section-head">
            <div><div class="section-kicker">LAPORAN RESMI SATGAS KARHUTLA · BNPB</div><h2>Kondisi lapangan di provinsi prioritas</h2></div>
            <span class="risk-state" id="bnpb-state">Memuat laporan BNPB…</span>
          </div>
          <div class="bnpb-grid" id="bnpb-grid"></div>
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
            <div class="stat-foot"><span class="legend-dot high"></span><span class="stat-note" id="high-note">Hampir pasti api, menurut NASA</span></div>
          </article>
          <article class="stat-panel">
            <div class="stat-top"><span>KEKUATAN API (FRP)</span><span class="stat-icon frp-icon">⌁</span></div>
            <div class="stat-value"><span id="frp-total">—</span><small> MW</small></div>
            <div class="stat-foot"><span class="legend-dot warm"></span><span class="stat-note" id="frp-note">Makin besar, makin hebat api &amp; asapnya</span></div>
          </article>
          <article class="stat-panel stat-status">
            <div class="stat-top"><span>STATUS PEMANTAUAN</span><span class="scan-mark"><i></i><i></i><i></i></span></div>
            <div class="status-value" id="monitor-status">Memuat…</div>
            <div class="stat-foot"><span class="stat-note" id="source-summary">Menghubungi server</span></div>
          </article>
        </section>

        <section class="timeline-panel" id="timeline" aria-label="Tren titik panas harian">
          <div class="panel-heading"><div><div class="section-kicker">TREN HARIAN · GABUNGAN 3 SATELIT VIIRS</div><h2>Titik panas 2 minggu terakhir</h2></div><span class="trend-chip" id="trend-chip" hidden></span></div>
          <div class="timeline-chart" id="timeline-chart"><div class="chart-empty">Memuat tren harian…</div></div>
          <div class="timeline-legend"><span><i class="swatch other"></i> Bukan lahan gambut</span><span><i class="swatch peat"></i> Lahan gambut</span><span><i class="swatch avg"></i> Rata-rata 7 hari</span><span><i class="swatch partial"></i> Hari ini (belum lengkap)</span></div>
          <p class="timeline-note" id="timeline-note"></p>
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
            <div class="map-layers" aria-label="Lapisan peta"><label class="basemap-pick"><span>Peta dasar</span><select id="basemap-select" aria-label="Pilih peta dasar"></select></label><label><input type="checkbox" id="layer-smoke" checked /> Jalur asap</label><label><input type="checkbox" id="layer-konservasi" checked /><i class="layer-swatch konservasi"></i> Kawasan konservasi</label><label><input type="checkbox" id="layer-lindung" checked /><i class="layer-swatch lindung"></i> Hutan lindung</label><label><input type="checkbox" id="layer-peat" /><i class="layer-swatch gambut"></i> Lahan gambut (KHG)</label><details class="layer-more"><summary>Area penting lainnya</summary>${OVERLAYS.map((overlay) => `<label title="${escapeHtml(overlay.hint)}"><input type="checkbox" id="layer-${overlay.id}" data-overlay="${overlay.id}" /><i class="layer-swatch ${overlay.id}"></i> ${escapeHtml(overlay.label)}</label>`).join('')}</details></div>
            <div class="map-legend"><span title="Titik keyakinan tinggi yang bukan sumber panas tetap; dianimasikan sebagai nyala api"><i class="legend-flame"></i> Diyakini kebakaran</span><span><i class="legend-fire strong"></i> Tinggi</span><span><i class="legend-fire medium"></i> Sedang</span><span><i class="legend-fire low"></i> Rendah</span><span title="Terdeteksi berulang di titik yang sama dekat permukiman; tidak dihitung dalam analisis risiko"><i class="legend-fire stationary"></i> Sumber panas tetap</span></div>
            <div class="map-loading visible" id="map-message"><span class="map-message-icon">⌖</span><strong>Memuat data hotspot</strong><small>Mengambil deteksi satelit terbaru…</small><button id="map-retry" hidden>Coba lagi <span>↻</span></button></div>
            <div class="map-credit"><span id="basemap-credit"></span> · Kawasan hutan, KHG, PIPPIB, KEE, hutan adat, mangrove &amp; kerawanan karhutla © ${AREA_SOURCE} · Permukiman © GeoNames · Prakiraan cuaca: BMKG · Asap: Open-Meteo/CAMS · Hotspot: NASA FIRMS, BRIN/LAPAN (SiPongi) · Laporan: BNPB</div>
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
          <article class="data-panel regency-panel">
            <div class="panel-heading"><div><div class="section-kicker">PER WILAYAH ADMINISTRASI</div><h2>Kabupaten/kota dengan titik api terbanyak</h2></div></div>
            <div class="table-wrap"><table class="regency-table"><thead><tr><th>KABUPATEN/KOTA</th><th>TITIK API</th><th>KEYAKINAN TINGGI</th><th>≤ ${SETTLEMENT_ALERT_KM} KM DARI PERMUKIMAN</th><th>DI LAHAN GAMBUT</th><th>DI KAWASAN HUTAN</th></tr></thead><tbody id="regency-rows"><tr><td colspan="6" class="empty-row">Belum ada data.</td></tr></tbody></table></div>
          </article>
          <div class="risk-panels">
            <article class="data-panel priority-panel">
              <div class="panel-heading"><div><div class="section-kicker">DIURUTKAN DARI YANG PALING BERISIKO</div><h2>Wilayah api paling berisiko</h2></div><div class="ispu-legend">${ISPU_LEVELS.map((level) => `<span>${levelIcon(level.key, 16)}${level.label}</span>`).join('')}</div></div>
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

        <section class="cctv-section" id="cctv">
          <div class="section-head">
            <div><div class="section-kicker">PANTAUAN VISUAL</div><h2>CCTV kota di daerah berasap</h2></div>
            <span class="risk-state" id="cctv-state">Memuat daftar kamera…</span>
          </div>
          <p class="panel-intro">Kamera lalu lintas milik pemerintah kota yang terbuka untuk umum. Ini bukan kamera pemantau api, tetapi sering memperlihatkan seberapa pekat kabut asap. Video dimuat dari YouTube hanya setelah Anda menekan putar.</p>
          <div class="cctv-grid" id="cctv-grid"></div>
          <h3 class="cctv-subhead">Portal CCTV pemerintah kota</h3>
          <ul class="cctv-portals" id="cctv-portals"></ul>
        </section>

        <section class="bmkg-section" id="bmkg">
          <div class="section-head">
            <div><div class="section-kicker">SUMBER RESMI</div><h2>Data BMKG</h2></div>
          </div>
          <p class="panel-intro">Prakiraan cuaca per desa dari BMKG sudah dipakai di <a href="#cek-lokasi">Cek Lokasi Anda</a> dan daftar kota di jalur asap. Data resmi BMKG lainnya dapat dilihat langsung di situs BMKG:</p>
          <ul class="cctv-portals bmkg-links">
            <li><a href="https://www.bmkg.go.id/kualitas-udara/pm25" target="_blank" rel="noreferrer"><strong>Kualitas udara PM2.5</strong><small>Hasil ukur stasiun BMKG</small><span>Konsentrasi PM2.5 per jam dari alat ukur di kota-kota, bukan model.</span><em>Buka di BMKG ↗</em></a></li>
            <li><a href="https://www.bmkg.go.id/cuaca/karhutla" target="_blank" rel="noreferrer"><strong>Peringkat bahaya kebakaran</strong><small>FWI / FDRS harian per provinsi</small><span>Seberapa mudah api menyala dan menyebar berdasarkan cuaca.</span><em>Buka di BMKG ↗</em></a></li>
            <li><a href="https://www.bmkg.go.id/cuaca/satelit" target="_blank" rel="noreferrer"><strong>Citra satelit & asap</strong><small>Himawari, sebaran asap, hotspot</small><span>Gambar satelit terbaru, termasuk sebaran asap.</span><em>Buka di BMKG ↗</em></a></li>
            <li><a href="https://www.bmkg.go.id/cuaca/prakiraan-cuaca" target="_blank" rel="noreferrer"><strong>Prakiraan cuaca</strong><small>Per kecamatan dan desa</small><span>Prakiraan resmi lengkap untuk wilayah Anda.</span><em>Buka di BMKG ↗</em></a></li>
          </ul>
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
          <div class="ispu-guide-grid">${ISPU_LEVELS.map((level) => `<div class="ispu-guide-item" style="--level:${level.color}">${levelIcon(level.key, 48)}<span class="ispu-badge ${level.key}">${level.label}</span><p><b>${ISPU_ADVICE[level.key].meaning}</b> ${ISPU_ADVICE[level.key].action}</p></div>`).join('')}</div>
        </section>

        <section class="about-section" id="about">
          <div class="section-kicker">METODOLOGI &amp; SUMBER DATA</div>
          <h2>Cara membaca halaman ini</h2>
          <div class="about-grid">
            <div><h3>Titik panas</h3><p>Deteksi anomali termal satelit VIIRS (375 m) dari <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS</a>. Bawaannya gabungan ketiga satelit (NOAA-21, NOAA-20, Suomi-NPP) karena satu satelit saja bisa melewatkan api akibat awan atau jam lintas; deteksi ganda atas api yang sama digabung. Tersedia juga per satelit, atau data resmi BRIN/LAPAN (keyakinan sedang dan tinggi) dari <a href="https://sipongi.kehutanan.go.id/" target="_blank" rel="noreferrer">SiPongi</a>. Hanya titik di wilayah Indonesia yang dihitung. Data diperbarui di server setiap 10 menit.</p></div>
            <div><h3>Laporan lapangan</h3><p>Firespot, luas lahan terbakar, jarak pandang bandara, dan kesimpulan Satgas berasal dari <a href="https://data.bnpb.go.id/data/karhutla2026" target="_blank" rel="noreferrer">Dashboard Karhutla BNPB</a>, diperbarui setiap 15 menit.</p></div>
            <div><h3>Kedekatan</h3><p>Jarak tiap titik ke permukiman terdekat (<a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>, ±257 ribu desa/kota) dan ke batas kawasan konservasi atau hutan lindung menurut peta resmi Kawasan Hutan 1:250.000 status Juni 2026, serta apakah titik berada di Kesatuan Hidrologis Gambut. Keduanya dari <a href="https://sigap.kehutanan.go.id/" target="_blank" rel="noreferrer">SIGAP Kementerian Kehutanan</a>.</p></div>
            <div><h3>Prakiraan BMKG</h3><p>Prakiraan cuaca per desa (kondisi, angin, suhu, kelembapan, jarak pandang, termasuk prakiraan "Kabut/Asap" dan "Udara Kabur") diambil dari <a href="https://data.bmkg.go.id/prakiraan-cuaca/" target="_blank" rel="noreferrer">API prakiraan cuaca BMKG</a> untuk desa terdekat, memakai kode wilayah Kemendagri. Sumber: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika).</p></div>
            <div><h3>Asap &amp; ISPU</h3><p>Titik dikelompokkan per ±20 km. Untuk 30 kluster teratas, angin dan PM2.5 diambil dari <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (model CAMS). Kategori mengikuti ISPU PM2.5 rata-rata 24 jam (PermenLHK P.14/2020). Jalur asap adalah kerucut 6 jam searah angin.</p></div>
            <div><h3>Sumber panas tetap</h3><p>Titik yang terdeteksi pada ≥3 hari berbeda dalam 5 hari terakhir di tempat yang sama (±440 m) dan dekat permukiman ditandai abu-abu sebagai kemungkinan pabrik, pembangkit, atau pembakaran berulang, lalu tidak dihitung dalam analisis risiko. Titik tetap tampil di peta dan CSV. Titik di lahan gambut atau kawasan hutan tidak pernah ditandai.</p></div>
            <div><h3>Setara sampah dibakar</h3><p>Skala asap sebuah wilayah api dibandingkan dengan pembakaran sampah rumah tangga: dari kekuatan api satelit (FRP) diperkirakan biomassa yang terbakar (0,368 kg per MJ, Wooster dkk. 2005) dan PM2.5 yang dilepaskan (±9 g/kg vegetasi, Akagi dkk. 2011; ±17 g/kg gambut, Stockwell dkk. 2016), lalu dibagi emisi pembakaran sampah terbuka (±9,8 g/kg, Wiedinmyer dkk. 2014) dan sampah rumah tangga Indonesia (±2,7 kg/hari, SIPSN KLHK). Tiap deteksi dianggap mewakili ±12 jam. Ini gambaran skala dengan ketelitian 2–3 kali lipat, bukan pengukuran, dan tidak tersedia untuk data BRIN/LAPAN yang tanpa FRP.</p></div>
            <div><h3>Lapisan area penting</h3><p>Semua batas area berasal dari SIGAP Kementerian Kehutanan. Moratorium (PIPPIB 2026 periode I) adalah hutan alam primer dan gambut yang tidak boleh diberi izin baru, sehingga api di dalamnya patut dicurigai sebagai pembukaan lahan. Kawasan Ekosistem Esensial mencakup koridor satwa, taman kehati, mangrove, karst, dan lahan basah di luar kawasan konservasi. Hutan adat adalah yang sudah ditetapkan dengan SK. Mangrove dari Peta Mangrove Nasional 2024; kerawanan karhutla dari peta 2025, hanya kelas tinggi dan sangat tinggi. Lapisan besar disederhanakan untuk tampilan (detail ±250–600 m), jadi tepi batasnya tidak presisi.</p></div>
            <div><h3>Satwa, luas, dan prakiraan</h3><p>Satwa unggulan per taman nasional (status kritis/genting menurut IUCN Red List) ditampilkan bila ada api di dalam kawasan itu. Luas terbakar dibandingkan dengan lapangan sepak bola (0,714 ha) dan DKI Jakarta (±661 km²); jarak pandang dengan panjang lapangan (105 m). Prakiraan "kapan membaik" memakai rata-rata PM2.5 model CAMS per 24 jam untuk 4 hari ke depan, sehingga bisa meleset bila cuaca berubah.</p></div>
            <div><h3>Kesehatan & setara rokok</h3><p>Ancaman bagi anak-anak, lansia, dan ibu hamil disarikan dari panduan WHO dan Kementerian Kesehatan tentang asap kebakaran dan PM2.5. Setara rokok memakai perkiraan Berkeley Earth: PM2.5 22 µg/m³ selama sehari ≈ 1 batang rokok. Keduanya untuk memberi gambaran, bukan diagnosis; ikuti arahan tenaga kesehatan setempat.</p></div>
            <div><h3>Istilah</h3><p><b>Titik panas</b>: lokasi yang jauh lebih panas dari sekitarnya menurut satelit, umumnya api. <b>FRP</b>: kekuatan api dalam megawatt. <b>PM2.5</b>: partikel asap halus yang masuk ke paru-paru. <b>ISPU</b>: Indeks Standar Pencemar Udara. <b>KHG</b>: Kesatuan Hidrologis Gambut.</p></div>
            <div><h3>Privasi</h3><p>Situs ini tidak meminta data pribadi. Lokasi perangkat hanya dipakai di peramban Anda dan dikirim ke server sebatas koordinat untuk dihitung, tanpa disimpan. Bila statistik kunjungan diaktifkan (Google Analytics), penghitungan dilakukan tanpa personalisasi iklan dan tidak berjalan bagi pengunjung yang menyalakan Do Not Track.</p></div>
            <div><h3>Batasan</h3><p>Hotspot bukan konfirmasi kebakaran, kualitas udara berasal dari model, dan batas kawasan dapat berbeda dari kondisi lapangan. Gunakan sebagai peringatan dini, bukan pengganti verifikasi lapangan.</p></div>
          </div>
        </section>
        <footer class="app-footer"><span>SUMBER DATA <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noreferrer">NASA FIRMS ↗</a> · <a href="https://github.com/satyanagara/PI_KARHUTLA" target="_blank" rel="noreferrer">KODE SUMBER (AGPL-3.0) ↗</a></span><span>Deteksi satelit bukan pengganti verifikasi lapangan.</span></footer>
      </div>
    </main>
  </div>
`

// ---------- Peta ----------

const map = L.map('fire-map', { preferCanvas: true, zoomControl: false, attributionControl: false, minZoom: 3, maxZoom: 13 })
map.fitBounds([[-11, 94], [6, 142]], { padding: [12, 12] })
// Peta dasar yang bisa dipilih pengunjung. Semua tanpa kunci API; atribusi tampil di kredit peta.
const BASEMAPS = [
  { key: 'esri-gray', label: 'Abu-abu kalem (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', maxZoom: 16, credit: 'Peta dasar © Esri, HERE, Garmin, kontributor OpenStreetMap' },
  { key: 'osm', label: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, credit: 'Peta dasar © kontributor OpenStreetMap (ODbL)' },
  { key: 'esri-satellite', label: 'Citra satelit (Esri)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, credit: 'Citra © Esri, Maxar, Earthstar Geographics' },
] as const
type BasemapKey = (typeof BASEMAPS)[number]['key']
let basemapLayer: L.TileLayer | null = null

function readBasemapChoice(): BasemapKey {
  try {
    const saved = localStorage.getItem('peta-dasar')
    if (BASEMAPS.some((item) => item.key === saved)) return saved as BasemapKey
  } catch {
    // Penyimpanan lokal bisa tidak tersedia (mode privat); pakai bawaan.
  }
  return 'esri-gray'
}

function setBasemap(key: BasemapKey) {
  const basemap = BASEMAPS.find((item) => item.key === key) ?? BASEMAPS[0]
  basemapLayer?.remove()
  basemapLayer = L.tileLayer(basemap.url, { maxZoom: basemap.maxZoom }).addTo(map)
  basemapLayer.bringToBack()
  byId('basemap-credit').textContent = basemap.credit
  byId<HTMLSelectElement>('basemap-select').value = basemap.key
  try {
    localStorage.setItem('peta-dasar', basemap.key)
  } catch {
    // Pilihan tetap berlaku untuk sesi ini.
  }
}

L.control.zoom({ position: 'bottomright' }).addTo(map)
L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map)
map.createPane('areas').style.zIndex = '350'
map.createPane('smoke').style.zIndex = '380'

const fireLayer = L.layerGroup().addTo(map)
const flameLayer = new FlameLayer().addTo(map)
const smokeLayer = L.layerGroup().addTo(map)
const areaLayers: Partial<Record<'konservasi' | 'lindung', L.GeoJSON>> = {}
let areaLoad: Promise<void> | null = null
const overlayLayers: Record<string, L.GeoJSON> = {}
const overlayLoads: Record<string, Promise<void>> = {}
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

function wildlifeLine(areaName: string) {
  const species = wildlifeFor(areaName)
  return species.length ? `<small class="wildlife">🐾 Habitat ${species.map(speciesText).join(', ')}</small>` : ''
}

function formatKm(km: number) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`
}

// Satu kalimat sederhana yang menjelaskan risiko wilayah api.
function clusterSentence(cluster: Cluster) {
  const parts: string[] = []
  const area = cluster.areas[0]
  const species = area?.km === 0 ? wildlifeFor(area.name) : []
  if (area?.km === 0) parts.push(`Api di dalam ${escapeHtml(area.name)}${species.length ? `, habitat ${species.slice(0, 2).map(speciesText).join(' dan ')}` : ''}`)
  else parts.push(`${numberFormat.format(cluster.count)} titik api`)
  if (cluster.nearest && cluster.nearestKm <= 5) parts.push(`${formatKm(cluster.nearestKm)} dari permukiman`)
  if (cluster.peatFires / cluster.count >= 0.5) parts.push('sebagian besar di lahan gambut')
  let sentence = parts.join(', ') + '.'
  const smoke = cluster.smoke
  if (smoke && levelRank(smoke.level.key) >= levelRank('sedang')) {
    sentence += ` Asap ${smoke.level.label.toLowerCase()} bergerak ke ${compassName(smoke.heading)} ±${Math.round(smoke.reachKm)} km${smoke.towns.length ? `, melewati ${smoke.towns.slice(0, 2).map((town) => escapeHtml(town.name)).join(' dan ')}` : ''}.`
  }
  const trash = report?.frpAvailable ? trashEquivalent(cluster.frp, cluster.peatFires / cluster.count, report.days) : null
  if (trash && trash.households >= 1000) sentence += ` Asapnya setara membakar sampah harian <b>${trash.text}</b> selama ${report!.days === 1 ? 'sehari' : `${report!.days} hari`}.`
  return sentence
}

function levelPill(level: IspuLevel) {
  return `<span class="ispu-badge with-icon ${level.key}" style="--level:${level.color}">${levelIcon(level.key, 16)}${level.label}</span>`
}

function renderStatus(data: Report) {
  const { summary } = data
  const smoked = data.clusters.filter((cluster) => cluster.smoke)
  const worst = smoked.map((cluster) => cluster.smoke!.level).sort((a, b) => levelRank(b.key) - levelRank(a.key))[0]
  const card = byId('status-card')
  const period = data.days === 1 ? '24 jam terakhir' : `${data.days} hari terakhir`
  const points: string[] = []
  let headline: string

  byId('status-icon').innerHTML = levelIcon(worst?.key ?? (summary.total ? 'na' : 'baik'), 72)
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
    if (summary.stationary) points.push(`<b>${numberFormat.format(summary.stationary)}</b> titik lain tidak dihitung karena terdeteksi berulang di tempat yang sama, kemungkinan pabrik, pembangkit, atau pembakaran berulang.`)
    const trash = data.frpAvailable && summary.total ? trashEquivalent(summary.frp, summary.peat.inside / summary.total, data.days) : null
    if (trash) points.push(`Semua api itu melepaskan <b>±${numberFormat.format(Math.round(trash.pm25Tonnes))} ton</b> asap halus (PM2.5), setara membakar sampah harian <b>${trash.text}</b> setiap hari selama ${period} <small>(perkiraan kasar dari kekuatan api satelit)</small>.`)
    const wild = data.areaRanking.filter((area) => area.inside > 0 && wildlifeFor(area.name).length).slice(0, 3)
    if (wild.length) points.push(`Api sedang berkobar di <b>habitat satwa terancam punah</b>: ${wild.map((area) => `<b>${escapeHtml(area.name)}</b> (${wildlifeFor(area.name).slice(0, 2).map(speciesText).join(', ')})`).join('; ')}.`)
    const forest = summary.konservasi.inside + summary.lindung.inside
    if (forest || summary.peat.inside) points.push(`<b>${numberFormat.format(forest)}</b> titik berada di kawasan konservasi atau hutan lindung, dan <b>${numberFormat.format(summary.peat.inside)}</b> di lahan gambut yang menghasilkan asap pekat.`)
  }
  byId('status-points').innerHTML = points.map((point) => `<li>${point}</li>`).join('')

  // Kota terdampak dengan udara terburuk: disampaikan dalam setara rokok dan hari berturut-turut.
  const worstTown = [...data.exposedTowns].filter((town) => town.pm25 !== null).sort((a, b) => (b.pm25 ?? 0) - (a.pm25 ?? 0))[0]
  const impact = byId('status-impact')
  impact.hidden = !worstTown || !UNHEALTHY_LEVELS.includes(worstTown.level.key)
  if (worstTown && !impact.hidden) {
    const streak = streakText(worstTown.unhealthyDays)
    impact.innerHTML = `Hari ini, menghirup udara di <b>${escapeHtml(worstTown.name)}</b> seharian setara mengisap <b class="impact-number">${cigaretteText(worstTown.pm25)}</b>, termasuk bagi bayi dan anak-anak${streak ? `, dan ini sudah <b>${streak}</b>` : ''}.<span class="impact-vulnerable">${VULNERABLE_SHORT}</span><small>Perkiraan dari model kualitas udara; 22 µg/m³ PM2.5 sehari ≈ 1 batang rokok (Berkeley Earth).</small>`
    statusCard = { level: worstTown.level, place: `${worstTown.name}, ${worstTown.province}`, pm25: worstTown.pm25, streakDays: worstTown.unhealthyDays, note: 'Perkiraan model kualitas udara (CAMS) · titik panas NASA FIRMS · ' + wibFormat.format(new Date(data.fetchedAt)) + ' WIB' }
    byId('status-share').innerHTML = shareMenu('status', statusCard, `https://${location.host}/?cek=${worstTown.lat.toFixed(4)},${worstTown.lon.toFixed(4)}`)
  }
  byId('status-share').hidden = impact.hidden

  const advice = byId('status-advice')
  advice.hidden = !worst
  if (worst) byId('status-advice-text').textContent = `Bila Anda berada di daerah berstatus ${worst.label.toLowerCase()}: ${ISPU_ADVICE[worst.key].action}`
}

let statusCard: ShareCard | null = null
let checkCard: ShareCard | null = null

// ---------- Prakiraan BMKG ----------

const isHazeText = (text: string) => /asap|kabur|haze|smoke/i.test(text)
const clock = (localDatetime: string) => localDatetime.slice(11, 16).replace(':', '.')

function bmkgBlock(forecast: BmkgForecast) {
  const now = forecast.now
  const place = [forecast.village && `Desa ${forecast.village}`, forecast.district && `Kec. ${forecast.district}`].filter(Boolean).join(', ')
  const haze = forecast.hazeNext24.length
    ? `<b>Kabut/asap atau udara kabur diprakirakan</b> pukul ${forecast.hazeNext24.slice(0, 6).map((step) => clock(step.time)).join(', ')} (24 jam ke depan).`
    : 'Tidak ada prakiraan kabut/asap dalam 24 jam ke depan.'
  return `<div class="check-bmkg${isHazeText(now.description) || forecast.hazeNext24.length ? ' haze' : ''}">
    <strong>Prakiraan BMKG · ${escapeHtml(place)}</strong>
    <p>Pukul ${escapeHtml(clock(now.time))}: <b>${escapeHtml(now.description)}</b>, ${now.temperature}°C, kelembapan ${now.humidity}%, angin ${now.windKmh} km/jam dari ${compassName(now.windFrom)}${now.visibility ? `, jarak pandang ${escapeHtml(now.visibility)} km` : ''}.</p>
    <p>${haze}</p>
    <small>Sumber: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)</small>
  </div>`
}

// Penanda BMKG untuk kota di jalur asap; dimuat setelah daftar tampil, diantrekan di server.
let townBmkgRun = 0
async function loadTownBmkg(data: Report) {
  const run = ++townBmkgRun
  const towns = data.exposedTowns.slice(0, 12)
  await Promise.all(towns.map(async (town, index) => {
    try {
      const response = await fetch(`/api/bmkg?lat=${town.lat.toFixed(4)}&lon=${town.lon.toFixed(4)}`)
      if (!response.ok || run !== townBmkgRun) return
      const forecast = await response.json() as BmkgForecast
      const slot = document.querySelector<HTMLElement>(`[data-town-bmkg="${index}"]`)
      if (!slot) return
      const haze = isHazeText(forecast.now.description) || forecast.hazeNext24.length > 0
      slot.className = `town-bmkg${haze ? ' haze' : ''}`
      slot.textContent = `BMKG: ${forecast.now.description}${haze && !isHazeText(forecast.now.description) ? ' · asap diprakirakan' : ''}`
    } catch {
      // Penanda BMKG bersifat tambahan; daftar tetap tampil tanpa itu.
    }
  }))
}

function renderTowns(data: Report) {
  byId('towns-count').textContent = `${data.exposedTowns.length} DAERAH`
  byId('town-list').innerHTML = data.exposedTowns.length ? data.exposedTowns.slice(0, 24).map((town, index) => `
    <li><button type="button" data-town="${index}">${levelPill(town.level)}<span class="town-name"><strong>${escapeHtml(town.name)}</strong><small>${escapeHtml(town.province)}${town.pm25 !== null ? ` · PM2.5 ±${Math.round(town.pm25)} µg/m³` : ''}</small></span><small class="town-fire">Api ${formatKm(town.fireKm)} di ${town.fireDirection}</small>${index < 12 ? `<small class="town-bmkg" data-town-bmkg="${index}"></small>` : ''}</button></li>`).join('')
    : '<li class="area-empty">Tidak ada kota yang diperkirakan dilalui asap berkategori sedang atau lebih buruk.</li>'
}

function renderRegencies(data: Report) {
  const cell = (value: number, total: number) => `${numberFormat.format(value)}${value ? `<small>${Math.round((value / total) * 100)}%</small>` : ''}`
  byId('regency-rows').innerHTML = data.regencies.length ? data.regencies.slice(0, 15).map((regency) => `
    <tr><td><strong>${escapeHtml(regency.name)}</strong><small>${escapeHtml(regency.province)}</small></td><td><strong>${numberFormat.format(regency.total)}</strong></td><td>${cell(regency.high, regency.total)}</td><td>${cell(regency.nearSettlement, regency.total)}</td><td>${cell(regency.peat, regency.total)}</td><td>${cell(regency.forest, regency.total)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty-row">Tidak ada titik api.</td></tr>'
}

// Warna kategori udara dari teks laporan BNPB, mengambil kategori terburuk yang disebut.
function bnpbLevel(text: string): IspuLevel {
  const value = text.toLowerCase()
  const key = value.includes('berbahaya') ? 'berbahaya'
    : value.includes('sangat tidak sehat') ? 'sangat-tidak-sehat'
    : value.includes('tidak sehat') ? 'tidak-sehat'
    : value.includes('sedang') ? 'sedang'
    : value.includes('baik') ? 'baik' : 'na'
  return ISPU_LEVELS.find((level) => level.key === key) ?? { key: 'na', label: 'Tidak ada data', color: '#9aa69f' }
}

// ---------- Tren harian ----------

const shortDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weekday = new Intl.DateTimeFormat('id-ID', { weekday: 'short', timeZone: 'UTC' })
const asUtc = (date: string) => new Date(`${date}T00:00:00Z`)

// Interval sumbu-Y bulat (1, 2, 5 × 10^k) agar tick-nya mudah dibaca, dengan 3–5 garis bantu.
function niceScale(value: number) {
  const raw = value / 4
  const base = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = ([1, 2, 5, 10].map((factor) => factor * base).find((candidate) => candidate >= raw)) ?? 10 * base
  return { step, max: step * Math.ceil(value / step) }
}

function renderTimeline(report: TimelineReport) {
  const days = report.days
  const complete = days.filter((day) => day.date < report.today)
  const W = 760
  const H = 270
  const pad = { left: 56, right: 12, top: 22, bottom: 42 }
  const plotW = W - pad.left - pad.right
  const plotH = H - pad.top - pad.bottom
  const scale = niceScale(Math.max(1, ...days.map((day) => day.total)))
  const max = scale.max
  const slot = plotW / days.length
  const barW = Math.min(34, slot * 0.66)
  const y = (value: number) => pad.top + plotH - (value / max) * plotH
  const ticks = Array.from({ length: Math.round(max / scale.step) + 1 }, (_, index) => index * scale.step)

  const grid = ticks.map((tick) => `<line x1="${pad.left}" x2="${W - pad.right}" y1="${y(tick)}" y2="${y(tick)}" class="tl-grid"/><text x="${pad.left - 6}" y="${y(tick) + 3.5}" text-anchor="end" class="tl-axis">${tick >= 1000 ? `${numberFormat.format(tick / 1000)} rb` : tick}</text>`).join('')
  const peakDay = complete.reduce<TimelineDay | null>((best, day) => (!best || day.total > best.total ? day : best), null)
  const bars = days.map((day, index) => {
    const x = pad.left + slot * index + (slot - barW) / 2
    const other = day.total - day.peat
    const partial = day.date >= report.today
    const date = asUtc(day.date)
    const label = `${weekday.format(date)}, ${shortDate.format(date)}${partial ? ' (belum lengkap)' : ''}: ${numberFormat.format(day.total)} titik · ${numberFormat.format(day.peat)} di lahan gambut · ${numberFormat.format(day.high)} keyakinan tinggi`
    return `<g class="tl-bar${partial ? ' partial' : ''}" tabindex="0" role="img" aria-label="${label}"><title>${label}</title>
      <rect x="${x}" y="${y(day.peat)}" width="${barW}" height="${Math.max(0, plotH - (y(day.peat) - pad.top))}" class="tl-peat"/>
      <rect x="${x}" y="${y(day.total)}" width="${barW}" height="${Math.max(0, y(day.peat) - y(day.total))}" class="tl-other"/>
      <rect x="${x - 3}" y="${pad.top}" width="${barW + 6}" height="${plotH}" fill="transparent"/>
      ${other >= 0 && peakDay?.date === day.date ? `<text x="${x + barW / 2}" y="${y(day.total) - 5}" text-anchor="middle" class="tl-peak">${numberFormat.format(day.total)}</text>` : ''}
      <text x="${x + barW / 2}" y="${H - 24}" text-anchor="middle" class="tl-axis">${date.getUTCDate()}/${date.getUTCMonth() + 1}</text>
      <text x="${x + barW / 2}" y="${H - 11}" text-anchor="middle" class="tl-axis dim">${weekday.format(date).slice(0, 3)}</text>
    </g>`
  }).join('')

  // Rata-rata bergerak 7 hari, hanya dari hari yang sudah lengkap.
  const points: string[] = []
  complete.forEach((_day, index) => {
    if (index < 6) return
    const mean = complete.slice(index - 6, index + 1).reduce((sum, item) => sum + item.total, 0) / 7
    points.push(`${(pad.left + slot * index + slot / 2).toFixed(1)},${y(mean).toFixed(1)}`)
  })
  const avgLine = points.length > 1 ? `<polyline points="${points.join(' ')}" class="tl-avg"/>` : ''

  byId('timeline-chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Grafik batang jumlah titik panas per hari">${grid}${bars}${avgLine}</svg>`

  // Tren: 7 hari lengkap terakhir dibanding 7 hari sebelumnya.
  const chip = byId('trend-chip')
  if (complete.length >= 14) {
    const last = complete.slice(-7).reduce((sum, day) => sum + day.total, 0) / 7
    const before = complete.slice(-14, -7).reduce((sum, day) => sum + day.total, 0) / 7
    const change = before ? ((last - before) / before) * 100 : 0
    const direction = Math.abs(change) < 3 ? 'flat' : change > 0 ? 'up' : 'down'
    chip.hidden = false
    chip.className = `trend-chip ${direction}`
    chip.textContent = `${direction === 'up' ? '▲ Naik' : direction === 'down' ? '▼ Turun' : '▬ Stabil'}${direction === 'flat' ? '' : ` ${Math.abs(Math.round(change))}%`} dibanding minggu sebelumnya`
    byId('timeline-note').textContent = `Rata-rata ${numberFormat.format(Math.round(last))} titik per hari dalam 7 hari terakhir (minggu sebelumnya ${numberFormat.format(Math.round(before))}).${peakDay ? ` Puncak ${numberFormat.format(peakDay.total)} titik pada ${shortDate.format(asUtc(peakDay.date))}.` : ''} Hari dihitung menurut WIB; jumlah titik per hari dipengaruhi tutupan awan dan jam lintas satelit, bukan hanya luas api.`
  } else {
    chip.hidden = true
    byId('timeline-note').textContent = 'Jumlah titik per hari dipengaruhi tutupan awan dan jam lintas satelit, bukan hanya luas api.'
  }
}

let timelineRetries = 0
async function loadTimeline() {
  try {
    const response = await fetch('/api/timeline')
    const body = await response.json().catch(() => null)
    if (response.status === 202 && timelineRetries < 8) {
      timelineRetries++
      byId('timeline-chart').innerHTML = '<div class="chart-empty">Menyiapkan tren harian (pertama kali ±1 menit)…</div>'
      setTimeout(() => void loadTimeline(), 20000)
      return
    }
    if (!response.ok || !body?.days) throw new Error('Tren harian belum tersedia.')
    timelineRetries = 0
    renderTimeline(body as TimelineReport)
  } catch (error) {
    if (!byId('timeline-chart').querySelector('svg')) byId('timeline-chart').innerHTML = `<div class="chart-empty">${escapeHtml(error instanceof Error ? error.message : 'Tren harian belum tersedia.')}</div>`
  }
}

function compareLine(text: string | null) {
  return text ? `<small class="compare">${escapeHtml(text)}</small>` : ''
}

function renderBnpb(data: BnpbReport) {
  const hectare = (value: number | null) => value === null ? '–' : `${numberFormat.format(Math.round(value))} ha`
  const updated = data.updatedAt ? wibFormat.format(new Date(data.updatedAt)) : wibFormat.format(new Date(data.fetchedAt))
  byId('bnpb-state').textContent = `Sumber: BNPB · diperbarui ${updated} WIB`
  byId('bnpb-state').className = 'risk-state'
  byId('bnpb-grid').innerHTML = data.provinces.map((province) => {
    const level = bnpbLevel(province.airQuality)
    return `
    <article class="bnpb-card" style="--level:${level.color}">
      <div class="bnpb-head"><h3>${escapeHtml(province.province)}</h3><span class="ispu-badge with-icon ${level.key}" style="--level:${level.color}">${levelIcon(level.key, 16)}${escapeHtml(province.airQuality || 'Tidak dilaporkan')}</span></div>
      <dl class="bnpb-stats">
        <div><dt>Titik api terverifikasi</dt><dd>${province.fireSpots ?? '–'}</dd></div>
        <div><dt>Terbakar hari ini</dt><dd>${hectare(province.burnedTodayHa)}</dd>${compareLine(footballFields(province.burnedTodayHa))}</div>
        <div><dt>Jarak pandang bandara</dt><dd>${province.airportVisibilityKm ? `${escapeHtml(province.airportVisibilityKm)} km` : '–'}</dd>${compareLine(visibilityComparison(province.airportVisibilityKm))}</div>
        <div><dt>Kab/kota terdampak</dt><dd>${province.regenciesAffected ?? '–'}</dd></div>
        <div><dt>Total lahan terbakar</dt><dd>${hectare(province.burnedIndicativeHa)}</dd>${compareLine(footballFields(province.burnedIndicativeHa))}</div>
        <div><dt>Personel dikerahkan</dt><dd>${province.personnel === null ? '–' : numberFormat.format(province.personnel)}</dd></div>
      </dl>
      ${province.conclusion ? `<details><summary>Kesimpulan Satgas</summary><p>${escapeHtml(province.conclusion)}</p>${province.recommendation ? `<p><b>Rekomendasi:</b> ${escapeHtml(province.recommendation)}</p>` : ''}</details>` : ''}
    </article>`
  }).join('') || '<p class="area-empty">Belum ada laporan.</p>'
}

async function loadBnpb() {
  try {
    const response = await fetch('/api/laporan-bnpb')
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `Server merespons ${response.status}`)
    renderBnpb(body as BnpbReport)
  } catch (error) {
    byId('bnpb-state').textContent = error instanceof Error ? error.message : 'Laporan BNPB tidak tersedia.'
    byId('bnpb-state').className = 'risk-state error'
  }
}

// ---------- CCTV kota ----------

function cctvPlayer(videoId: string, label: string) {
  return `<button type="button" class="cctv-facade" data-video="${escapeHtml(videoId)}" aria-label="Putar siaran langsung ${escapeHtml(label)}">
    <img src="https://i.ytimg.com/vi/${escapeHtml(videoId)}/hqdefault_live.jpg" alt="" loading="lazy" />
    <span class="cctv-play">▶ Putar siaran langsung</span>
  </button>`
}

function renderCctv(data: CctvReport) {
  byId('cctv-state').textContent = `${data.youtube.reduce((sum, channel) => sum + channel.streams.length, 0)} kamera siaran langsung · ${data.portals.length} portal`
  byId('cctv-state').className = 'risk-state'
  byId('cctv-grid').innerHTML = data.youtube.filter((channel) => channel.streams.length).map((channel, index) => `
    <article class="cctv-card" data-channel="${index}">
      <div class="cctv-head"><div><h3>${escapeHtml(channel.city)}</h3><small>${escapeHtml(channel.province)} · ${escapeHtml(channel.operator)}</small></div>
        <label class="select-wrap"><span class="sr-only">Pilih lokasi kamera ${escapeHtml(channel.city)}</span><select data-cctv-select="${index}">${channel.streams.map((stream) => `<option value="${escapeHtml(stream.id)}">${escapeHtml(stream.location)}</option>`).join('')}</select></label>
      </div>
      <div class="cctv-frame" data-cctv-frame="${index}">${cctvPlayer(channel.streams[0].id, `${channel.city} ${channel.streams[0].location}`)}</div>
      <a class="cctv-link" href="${escapeHtml(channel.channelUrl)}" target="_blank" rel="noreferrer">Semua kamera ${escapeHtml(channel.city)} di YouTube ↗</a>
    </article>`).join('') || '<p class="area-empty">Siaran YouTube sedang tidak tersedia.</p>'
  byId('cctv-portals').innerHTML = data.portals.map((portal) => `
    <li><a href="${escapeHtml(portal.url)}" target="_blank" rel="noreferrer"><strong>${escapeHtml(portal.city)}</strong><small>${escapeHtml(portal.province)} · ${escapeHtml(portal.operator)}</small><span>${escapeHtml(portal.note)}</span><em>Buka portal ↗</em></a></li>`).join('')

  // Gambar pratinjau live kadang belum tersedia; pakai pratinjau biasa sebagai cadangan.
  byId('cctv-grid').querySelectorAll<HTMLImageElement>('.cctv-facade img').forEach((image) => {
    image.addEventListener('error', () => {
      if (!image.src.endsWith('/hqdefault.jpg')) image.src = image.src.replace('hqdefault_live.jpg', 'hqdefault.jpg')
    }, { once: true })
  })
}

async function loadCctv() {
  try {
    const response = await fetch('/api/cctv')
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `Server merespons ${response.status}`)
    cctvData = body as CctvReport
    renderCctv(cctvData)
  } catch (error) {
    byId('cctv-state').textContent = error instanceof Error ? error.message : 'Daftar CCTV tidak tersedia.'
    byId('cctv-state').className = 'risk-state error'
  }
}

let cctvData: CctvReport | null = null

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
  const [lat, lon, date, time, confidence, frp, , settlementIndex, settlementKm, areaIndex, areaKm, peatIndex, regencyIndex, flag] = fire
  const lines = [
    flag === FLAG_STATIONARY
      ? '<strong>Kemungkinan sumber panas tetap</strong><br><small>Terdeteksi berulang di tempat yang sama dekat permukiman: kemungkinan pabrik, pembangkit, atau pembakaran berulang. Tidak dihitung dalam analisis risiko.</small>'
      : '<strong>Titik panas (kemungkinan api)</strong>',
    `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
    `Keyakinan: ${({ high: 'tinggi', medium: 'sedang', low: 'rendah' } as const)[confidenceOf(confidence)]}${report?.frpAvailable === false ? '' : ` · kekuatan ${frp.toFixed(1)} MW`}`,
    `${escapeHtml(date)} ${escapeHtml(time.slice(0, 2))}:${escapeHtml(time.slice(2))} UTC${regencyIndex >= 0 ? ` · ${escapeHtml(report!.regencyNames[regencyIndex])}` : ''}`,
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
  // Nyala api beranimasi hanya untuk titik yang diyakini kebakaran: keyakinan tinggi dan bukan sumber panas tetap.
  flameLayer.setFires(ordered.filter(({ fire, confidence }) => confidence === 'high' && fire[13] !== FLAG_STATIONARY).map(({ fire }) => ({ lat: fire[0], lon: fire[1], frp: fire[5] })))
  for (const { fire, confidence } of ordered) {
    if (fire[13] === FLAG_STATIONARY) {
      L.circleMarker([fire[0], fire[1]], { radius: 3.5, color: '#6b7280', weight: 1.5, opacity: 0.9, fillColor: '#ffffff', fillOpacity: 0.9 })
        .bindPopup(() => firePopup(fire)).addTo(fireLayer)
      continue
    }
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
    <small>${numberFormat.format(area.inside)} titik di dalam · ${numberFormat.format(area.near)} di tepi · ${numberFormat.format(area.frp)} MW</small>${wildlifeLine(area.name)}</li>`).join('') : '<li class="area-empty">Tidak ada hotspot di dalam atau dekat kawasan lindung.</li>'

  priorityClusters = data.clusters.slice(0, 12)
  byId('priority-rows').innerHTML = priorityClusters.map((cluster, index) => {
    const smoke = cluster.smoke
    const nearest = cluster.nearest ? `<strong>${escapeHtml(cluster.nearest.name)}</strong><small>${formatKm(cluster.nearestKm)} · ${cluster.nearSettlementFires} titik ≤ ${SETTLEMENT_ALERT_KM} km</small>` : '<small>Tidak ada dalam 10 km</small>'
    const peat = cluster.peatFires ? `<small class="peat-note">${numberFormat.format(cluster.peatFires)} titik di lahan gambut</small>` : ''
    const area = (cluster.areas[0] ? `<span class="area-tag ${cluster.areas[0].kind}">${cluster.areas[0].km === 0 ? 'Di dalam' : formatKm(cluster.areas[0].km)}</span><small>${escapeHtml(cluster.areas[0].name)}${cluster.areas.length > 1 ? ` +${cluster.areas.length - 1}` : ''}</small>` : '<small class="muted">—</small>') + peat
    const air = smoke ? `<span class="ispu-badge ${smoke.level.key}" style="--level:${smoke.level.color}">${smoke.level.label}</span><small>PM2.5 ${formatPm(smoke.pm25Mean24)} rata² 24j · puncak ${formatPm(smoke.pm25Max24)}</small>` : '<small class="muted">Tidak dianalisis</small>'
    const wind = smoke ? `<span class="wind"><i style="transform:rotate(${smoke.heading}deg)">↑</i>${smoke.windKmh.toFixed(0)} km/j ke ${compassLabel(smoke.heading)}</span><small>±${Math.round(smoke.reachKm)} km · ${numberFormat.format(smoke.settlements)} permukiman${smoke.towns.length ? ` (${smoke.towns.slice(0, 2).map((town) => escapeHtml(town.name)).join(', ')})` : ''}</small>` : '<small class="muted">—</small>'
    return `<tr data-cluster="${index}"><td class="rank">${index + 1}</td><td class="cluster-cell"><strong>${cluster.nearest ? `Dekat ${escapeHtml(cluster.nearest.name)}` : formatPlace(cluster.lat, cluster.lon)}</strong><small>${cluster.nearest?.province ? `${escapeHtml(cluster.nearest.province)} · ` : ''}${formatPlace(cluster.lat, cluster.lon)}</small><small class="row-summary">${clusterSentence(cluster)}</small></td><td data-label="Titik · FRP"><strong>${numberFormat.format(cluster.count)}</strong><small>${report?.frpAvailable === false ? '' : `${numberFormat.format(Math.round(cluster.frp))} MW · `}${cluster.high} tinggi</small></td><td data-label="Permukiman terdekat">${nearest}</td><td data-label="Kawasan">${area}</td><td data-label="Kualitas udara">${air}</td><td data-label="Angin · jangkauan asap">${wind}</td></tr>`
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
  const official = data.source === 'BRIN_LAPAN'
  byId('high-note').textContent = `Hampir pasti api, menurut ${official ? 'BRIN/LAPAN' : 'NASA'}`
  byId('source-card-title').textContent = official ? 'SiPongi' : 'NASA FIRMS'
  byId('source-card-note').textContent = official ? 'BRIN/LAPAN · Kemenhut' : 'Fire Information System'
  byId('frp-total').textContent = data.frpAvailable ? numberFormat.format(summary.frp) : '—'
  byId('frp-note').textContent = data.frpAvailable ? 'Makin besar, makin hebat api & asapnya' : 'Tidak tersedia pada data BRIN/LAPAN'
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
  void loadTownBmkg(data)
  renderRegencies(data)
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
  // Satu berkas kawasan hutan dipecah menjadi dua lapisan agar konservasi dan hutan lindung bisa dinyalakan terpisah.
  areaLoad ??= fetch('/data/kawasan-hutan.json')
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<GeoJSON.FeatureCollection>
    })
    .then((geojson) => {
      for (const kind of ['konservasi', 'lindung'] as const) {
        const lindung = kind === 'lindung'
        const layer = L.geoJSON(geojson, {
          pane: 'areas',
          filter: (feature) => (feature.properties?.k === 'lindung') === lindung,
          style: { color: lindung ? '#5f8f4f' : '#1f6b45', weight: lindung ? 0.6 : 0.9, opacity: 0.75, fillColor: lindung ? '#a8cf8a' : '#3f9a6c', fillOpacity: lindung ? 0.14 : 0.2 },
          onEachFeature: (feature, item) => item.bindTooltip(`${escapeHtml(feature.properties?.n)}<br><small>${escapeHtml(feature.properties?.t)}</small>`, { sticky: true }),
        })
        areaLayers[kind] = layer
        if (byId<HTMLInputElement>(`layer-${kind}`).checked) layer.addTo(map)
      }
    })
    .catch((error) => {
      areaLoad = null
      console.warn('Batas kawasan gagal dimuat:', error)
    })
  return areaLoad
}

function loadOverlay(id: string) {
  const overlay = OVERLAYS.find((item) => item.id === id)
  if (!overlay) return Promise.resolve()
  overlayLoads[id] ??= geojsonLayer(`/data/lapisan/${id}.json`, overlay.style, overlay.tooltip)
    .then((layer) => {
      overlayLayers[id] = layer
      if (byId<HTMLInputElement>(`layer-${id}`).checked) layer.addTo(map)
    })
    .catch((error) => {
      delete overlayLoads[id]
      console.warn(`Lapisan ${overlay.label} gagal dimuat:`, error)
    })
  return overlayLoads[id]
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
  const headers = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp', 'daynight', 'permukiman_terdekat', 'jarak_permukiman_km', 'kawasan', 'jenis_kawasan', 'jarak_kawasan_km', 'khg_gambut', 'kabupaten_kota', 'kemungkinan_sumber_panas_tetap']
  const escape = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`
  const lines = report.fires.map(([lat, lon, date, time, confidence, frp, daynight, settlementIndex, settlementKm, areaIndex, areaKm, peatIndex, regencyIndex, flag]) => [
    lat, lon, date, time, confidence, frp, daynight,
    settlementIndex >= 0 ? report!.settlementNames[settlementIndex] : '',
    settlementIndex >= 0 ? settlementKm : '',
    areaIndex >= 0 ? report!.areas[areaIndex].name : '',
    areaIndex >= 0 ? report!.areas[areaIndex].kind : '',
    areaIndex >= 0 ? areaKm : '',
    peatIndex >= 0 ? report!.peatUnits[peatIndex] : '',
    regencyIndex >= 0 ? report!.regencyNames[regencyIndex] : '',
    flag === FLAG_STATIONARY ? 'ya' : '',
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
let suggestionItems: { name: string; label: string; province: string; lat: number; lon: number; level?: number }[] = []
let searchTimer = 0

async function runCheck(lat: number, lon: number, label: string, preferredLabel?: string) {
  suggestions.hidden = true
  checkResult.innerHTML = `<p class="check-loading">Memeriksa ${escapeHtml(label)}…</p>`
  try {
    const response = await fetch(`/api/lokasi?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&source=${activeSource}&days=${activeDays}`)
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `Server merespons ${response.status}`)
    renderCheck(body as LocationCheck, lat, lon, label, preferredLabel)
  } catch (error) {
    checkResult.innerHTML = `<p class="check-error">${escapeHtml(error instanceof Error ? error.message : 'Pemeriksaan gagal.')}</p>`
  }
}

// Menjelaskan dari mana status kualitas udara berasal, agar status dari model (sering polusi perkotaan)
// tidak terbaca sebagai asap kebakaran.
function prognosisBlock(result: LocationCheck) {
  const air = result.air
  if (!air) return ''
  const outlook = prognosis(result.level, air.pm25Mean24, air.forecastMeans ?? [])
  if (!outlook) return ''
  return `<div class="prognosis"><strong>Kapan udara membaik?</strong>
    <div class="prognosis-chips">${outlook.chips.map((chip) => `<span class="prognosis-chip" style="--level:${chip.level.color}" title="${escapeHtml(chip.level.label)}${chip.pm25 !== null ? ` · PM2.5 ±${Math.round(chip.pm25)} µg/m³` : ''}"><i></i><b>${escapeHtml(chip.label)}</b><small>${escapeHtml(chip.level.label)}</small></span>`).join('')}</div>
    <p>${outlook.text}</p></div>`
}

function statusReason(result: LocationCheck) {
  const air = result.air
  const plume = result.smoke[0]
  const bmkgHaze = Boolean(result.bmkg && (isHazeText(result.bmkg.now.description) || result.bmkg.hazeNext24.length))
  const fireNear = Boolean(result.nearestFire && result.nearestFire.km <= 10)
  const points: string[] = []
  const fromPlume = plume && (!air || levelRank(plume.level.key) >= levelRank(air.level.key))
  if (fromPlume) {
    points.push(`Status berasal dari <b>asap wilayah api ${formatKm(plume.fireKm)} di arah ${plume.fireDirection}</b>${plume.place ? ` (dekat ${escapeHtml(plume.place)})` : ''}, kategori ${plume.level.label.toLowerCase()}.`)
  } else if (air) {
    const nowLevel = ispuLevel(air.pm25Now)
    points.push(`Status berasal dari <b>perkiraan model kualitas udara</b> (CAMS, resolusi ±40 km): PM2.5 rata-rata 24 jam ${formatPm(air.pm25Mean24)}${air.pm25Now !== null ? `; saat ini ${formatPm(air.pm25Now)} (setara ${nowLevel.label.toLowerCase()})` : ''}. Ini perkiraan, bukan hasil alat ukur.`)
    if (!plume && !bmkgHaze && !fireNear && levelRank(result.level.key) >= levelRank('sedang')) {
      points.push('Lokasi ini <b>tidak di jalur asap</b>, tidak ada titik api dalam 10 km, dan BMKG tidak memprakirakan kabut/asap. Kemungkinan besar ini <b>polusi perkotaan atau regional</b> (kendaraan, industri, pembakaran sampah), bukan asap kebakaran.')
    }
  }
  if (bmkgHaze) points.push('BMKG juga memprakirakan kabut/asap di desa ini, sejalan dengan status di atas.')
  if (!points.length) return ''
  return `<div class="check-reason"><strong>Kenapa statusnya begini?</strong><ul>${points.map((point) => `<li>${point}</li>`).join('')}</ul></div>`
}

function renderCheck(result: LocationCheck, lat: number, lon: number, label: string, preferredLabel?: string) {
  const period = result.days === 1 ? '24 jam terakhir' : `${result.days} hari terakhir`
  const fire = result.nearestFire
  const lines: string[] = []
  if (fire && fire.km <= 25) {
    const urgency = fire.km <= SETTLEMENT_ALERT_KM ? ' <b>Sangat dekat — waspadai api dan ikuti arahan BPBD.</b>' : ''
    const certainty = { high: 'keyakinan satelit tinggi', medium: 'keyakinan satelit sedang', low: 'keyakinan satelit rendah, bisa jadi bukan api' }[confidenceOf(fire.confidence)]
    lines.push(`Titik api terdekat <b>${formatKm(fire.km)}</b> di arah ${fire.direction}${fire.settlement ? ` (dekat ${escapeHtml(fire.settlement)})` : ''}, ${certainty}.${urgency}`)
    lines.push(`${numberFormat.format(result.counts.km5)} titik dalam 5 km · ${numberFormat.format(result.counts.km10)} dalam 10 km · ${numberFormat.format(result.counts.km25)} dalam 25 km (${period}).`)
  } else {
    lines.push(`Tidak ada titik api dalam radius 25 km selama ${period}${fire ? `; yang terdekat ${formatKm(fire.km)} di arah ${fire.direction}` : ''}.`)
  }
  if (result.stationary) lines.push(`Ada sumber panas tetap ${formatKm(result.stationary.km)} di arah ${result.stationary.direction}${result.stationary.settlement ? ` (dekat ${escapeHtml(result.stationary.settlement)})` : ''}. Titik ini terdeteksi berulang di tempat yang sama (kemungkinan pabrik, pembangkit, atau pembakaran berulang), sehingga tidak dihitung dalam analisis risiko.`)
  const plume = result.smoke[0]
  if (plume) lines.push(`Lokasi ini <b>berada di jalur asap</b> dari wilayah api ${formatKm(plume.fireKm)} di arah ${plume.fireDirection}${plume.place ? ` (dekat ${escapeHtml(plume.place)})` : ''}.`)
  else lines.push('Lokasi ini tidak berada di jalur asap wilayah api utama yang dianalisis.')
  if (result.air) {
    lines.push(`Perkiraan PM2.5 rata-rata 24 jam: <b>${formatPm(result.air.pm25Mean24)}</b>, puncak 24 jam ke depan ${formatPm(result.air.pm25Max24)}. Angin ${result.air.windKmh.toFixed(0)} km/jam ke ${compassName((result.air.windFrom + 180) % 360)}.`)
  }
  // Bila yang dicari kota/kabupaten/kecamatan, tampilkan nama itu, bukan desa terdekat dari titik tengahnya.
  const place = preferredLabel ?? (result.place ? `${result.place.name}${result.place.province ? `, ${result.place.province}` : ''}` : label)
  const reason = statusReason(result)
  // Nilai yang disampaikan ke warga: asap di jalur bila lebih buruk, selain itu model di titik ini.
  const pm25 = result.air?.pm25Mean24 ?? null
  const cigarettes = cigaretteText(pm25)
  const streak = streakText(result.air?.unhealthyDays ?? 0)
  checkCard = { level: result.level, place, pm25, streakDays: result.air?.unhealthyDays ?? 0, note: 'Perkiraan model kualitas udara (CAMS) · titik panas NASA FIRMS · prakiraan BMKG' }
  checkResult.innerHTML = `
    <div class="check-summary" style="--level:${result.level.color}">
      <div class="check-head">${levelIcon(result.level.key, 52)}<div><small>Udara yang Anda hirup hari ini di</small><strong>${escapeHtml(place)}</strong><span class="ispu-badge ${result.level.key}" style="--level:${result.level.color}">${result.level.label}</span></div></div>
      ${levelMeter(result.level.key)}
      ${cigarettes ? `<p class="impact-line">Menghirup udara ini seharian setara mengisap <b class="impact-number">${cigarettes}</b>, termasuk bagi bayi dan anak-anak${streak && UNHEALTHY_LEVELS.includes(result.level.key) ? `. Udara tidak sehat <b>${streak}</b>` : ''}.${levelRank(result.level.key) >= levelRank('sangat-tidak-sehat') ? ' Rasanya seperti berdiri seharian di dalam asap pembakaran sampah.' : ''}<small>Perkiraan dari model kualitas udara; 22 µg/m³ PM2.5 sehari ≈ 1 batang rokok (Berkeley Earth).</small></p>` : ''}
      ${prognosisBlock(result)}
      ${vulnerableBlock(result.level)}
      ${checklist(result.level, 'langkah-cek')}
      <ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
      ${reason}
      ${result.bmkg ? bmkgBlock(result.bmkg) : ''}
      <p class="check-advice"><b>${ISPU_ADVICE[result.level.key].meaning}</b> ${ISPU_ADVICE[result.level.key].action}</p>
      ${shareMenu('check', checkCard, `https://${location.host}/?cek=${lat.toFixed(4)},${lon.toFixed(4)}`)}
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
      ? suggestionItems.map((item, index) => `<li><button type="button" data-place="${index}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.label ?? item.province)}</small></button></li>`).join('')
      : '<li class="check-none">Nama tidak ditemukan.</li>'
    suggestions.hidden = false
  }, 250)
})

suggestions.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-place]')
  const item = button && suggestionItems[Number(button.dataset.place)]
  if (!item) return
  checkInput.value = item.name
  void runCheck(item.lat, item.lon, item.name, item.level && item.level <= 3 ? item.label : undefined)
})

byId<HTMLFormElement>('check-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const first = suggestionItems[0]
  if (first) {
    checkInput.value = first.name
    void runCheck(first.lat, first.lon, first.name, first.level && first.level <= 3 ? first.label : undefined)
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
for (const kind of ['konservasi', 'lindung'] as const) {
  byId<HTMLInputElement>(`layer-${kind}`).addEventListener('change', (event) => {
    const layer = areaLayers[kind]
    if (!layer) return
    if ((event.target as HTMLInputElement).checked) layer.addTo(map)
    else layer.remove()
  })
}
document.querySelectorAll<HTMLInputElement>('[data-overlay]').forEach((input) => input.addEventListener('change', () => {
  const id = input.dataset.overlay!
  if (input.checked) {
    if (overlayLayers[id]) overlayLayers[id].addTo(map)
    else void loadOverlay(id)
  } else overlayLayers[id]?.remove()
}))
byId<HTMLInputElement>('layer-peat').addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).checked) {
    if (peatLayer) peatLayer.addTo(map)
    else void loadPeat()
  } else peatLayer?.remove()
})
byId('cctv-grid').addEventListener('click', (event) => {
  const facade = (event.target as HTMLElement).closest<HTMLButtonElement>('.cctv-facade')
  if (!facade) return
  const videoId = facade.dataset.video ?? ''
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return
  const frame = document.createElement('iframe')
  frame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&rel=0&playsinline=1`
  frame.title = facade.getAttribute('aria-label') ?? 'Siaran CCTV'
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  frame.allowFullscreen = true
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  facade.replaceWith(frame)
})
byId('cctv-grid').addEventListener('change', (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>('select[data-cctv-select]')
  if (!select) return
  const index = select.dataset.cctvSelect
  const frame = byId('cctv-grid').querySelector<HTMLElement>(`[data-cctv-frame="${index}"]`)
  const label = `${cctvData?.youtube[Number(index)]?.city ?? ''} ${select.selectedOptions[0]?.textContent ?? ''}`
  if (frame) frame.innerHTML = cctvPlayer(select.value, label)
})

document.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-share]')
  if (!button) return
  const kind = button.dataset.share
  const card = kind === 'status' ? statusCard : checkCard
  if (!card) return
  const label = button.querySelector('span')
  const original = label?.textContent ?? ''
  const hint = document.querySelector<HTMLElement>(`[data-share-hint="${kind}"]`)
  button.disabled = true
  if (label) label.textContent = 'Menyiapkan gambar…'
  const slug = card.place.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  shareCardImage(card, `amukapi-${slug}.png`, shareText(card))
    .then((result) => {
      if (!hint) return
      // Instagram tidak punya tautan bagikan web: gambarnya diunggah manual ke Story/Feed.
      hint.textContent = result === 'downloaded'
        ? (button.dataset.shareTarget === 'instagram' ? 'Gambar tersimpan. Buka Instagram, lalu unggah ke Story atau Feed.' : 'Gambar tersimpan.')
        : ''
    })
    .catch((error) => {
      console.warn('Gagal membagikan gambar:', error)
      if (hint) hint.textContent = 'Gambar tidak dapat dibuat di peramban ini.'
    })
    .finally(() => {
      button.disabled = false
      if (label) label.textContent = original
    })
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

// #overview adalah wadah yang digulir itu sendiri, sehingga lompatan anchor biasa tidak kembali ke atas.
// Logo dan menu Ringkasan menggulir wadah (desktop) dan halaman (ponsel) ke paling atas.
document.querySelectorAll<HTMLAnchorElement>('a[href="#overview"]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault()
  document.querySelector('.workspace')?.scrollTo({ top: 0, behavior: 'smooth' })
  window.scrollTo({ top: 0, behavior: 'smooth' })
  navLinks.forEach((item) => item.classList.toggle('selected', item.getAttribute('href') === '#overview'))
  history.replaceState(null, '', location.pathname + location.search)
}))

// Perbarui otomatis selama halaman terbuka; server sendiri menyegarkan cache tiap 10 menit.
setInterval(() => {
  if (document.visibilityState === 'visible') {
    void refreshData()
    void loadBnpb()
    void loadTimeline()
  }
}, AUTO_REFRESH_MS)

new ResizeObserver(() => map.invalidateSize()).observe(byId('fire-map'))
byId<HTMLSelectElement>('basemap-select').innerHTML = BASEMAPS.map((item) => `<option value="${item.key}">${item.label}</option>`).join('')
byId('basemap-select').addEventListener('change', (event) => setBasemap((event.target as HTMLSelectElement).value as BasemapKey))
setBasemap(readBasemapChoice())
syncControls()
void refreshData()
// Tautan bagikan membawa ?cek=lat,lon: langsung jalankan cek lokasi untuk titik itu.
const shared = params.get('cek')?.split(',').map(Number) ?? []
if (shared.length === 2 && shared.every(Number.isFinite) && shared[0] >= -12 && shared[0] <= 7 && shared[1] >= 93 && shared[1] <= 143) {
  byId('cek-lokasi').scrollIntoView()
  void runCheck(shared[0], shared[1], 'lokasi yang dibagikan')
}
void loadBnpb()
void loadTimeline()
void loadCctv()
