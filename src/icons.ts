// Ikon tingkat bahaya udara (ISPU) yang langsung dapat dipahami: wajah yang makin tertekan seiring memburuknya
// udara, dari tersenyum hingga tengkorak, ditambah meteran lima warna. Semua berupa SVG sebaris.
import { ISPU_LEVELS, levelRank } from './risk.ts'

const FEATURE = '#1d1d1b'

const faces: Record<string, string> = {
  // Baik: tersenyum.
  baik: `<circle cx="22" cy="26" r="3.4" fill="${FEATURE}"/><circle cx="42" cy="26" r="3.4" fill="${FEATURE}"/>
    <path d="M19 38 Q32 50 45 38" fill="none" stroke="${FEATURE}" stroke-width="3.6" stroke-linecap="round"/>`,
  // Sedang: datar.
  sedang: `<circle cx="22" cy="26" r="3.4" fill="${FEATURE}"/><circle cx="42" cy="26" r="3.4" fill="${FEATURE}"/>
    <path d="M21 41 H43" stroke="${FEATURE}" stroke-width="3.6" stroke-linecap="round"/>`,
  // Tidak sehat: memakai masker.
  'tidak-sehat': `<circle cx="22" cy="25" r="3.2" fill="${FEATURE}"/><circle cx="42" cy="25" r="3.2" fill="${FEATURE}"/>
    <path d="M6 33 L16 35 M58 33 L48 35" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="15" y="32" width="34" height="18" rx="6" fill="#fff" stroke="${FEATURE}" stroke-width="2"/>
    <path d="M20 38 H44 M20 43 H44" stroke="#c9ced6" stroke-width="2" stroke-linecap="round"/>`,
  // Sangat tidak sehat: masker, alis cemas, mata menyipit, keringat.
  'sangat-tidak-sehat': `<path d="M15 19 L27 23 M49 19 L37 23" stroke="${FEATURE}" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M18 28 Q22 25 26 28 M38 28 Q42 25 46 28" fill="none" stroke="${FEATURE}" stroke-width="3" stroke-linecap="round"/>
    <path d="M6 34 L16 36 M58 34 L48 36" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
    <rect x="15" y="33" width="34" height="18" rx="6" fill="#fff" stroke="${FEATURE}" stroke-width="2"/>
    <path d="M20 39 H44 M20 44 H44" stroke="#c9ced6" stroke-width="2" stroke-linecap="round"/>
    <path d="M53 14 C56 19 56 22 53 23 C50 22 50 19 53 14 Z" fill="#9fd3ff" stroke="${FEATURE}" stroke-width="1.4"/>`,
  // Berbahaya: tengkorak.
  berbahaya: `<path d="M32 10 C19 10 12 19 12 29 C12 36 15 40 19 42 L19 49 C19 51 21 52 23 52 L41 52 C43 52 45 51 45 49 L45 42 C49 40 52 36 52 29 C52 19 45 10 32 10 Z" fill="#f4efe9"/>
    <ellipse cx="24" cy="30" rx="5.5" ry="6" fill="#2a1d1b"/><ellipse cx="40" cy="30" rx="5.5" ry="6" fill="#2a1d1b"/>
    <path d="M32 36 L29 42 H35 Z" fill="#2a1d1b"/>
    <path d="M26 46 V52 M32 46 V52 M38 46 V52" stroke="#2a1d1b" stroke-width="2"/>`,
  na: `<text x="32" y="43" text-anchor="middle" font-family="system-ui, sans-serif" font-size="30" font-weight="700" fill="#fff">?</text>`,
}

// Ikon wajah untuk satu kategori ISPU.
export function levelIcon(key: string, size = 28, title?: string) {
  const level = ISPU_LEVELS.find((item) => item.key === key)
  const color = level?.color ?? '#9aa69f'
  const label = title ?? level?.label ?? 'Tidak ada data'
  return `<svg class="level-icon level-icon-${key}" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${label}">
    <title>${label}</title>
    <circle cx="32" cy="32" r="30" fill="${color}" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
    ${key === 'berbahaya' ? '<circle cx="32" cy="32" r="30" fill="none" stroke="#d8432c" stroke-width="3"/>' : ''}
    ${faces[key] ?? faces.na}
  </svg>`
}

// Meteran lima warna dengan penanda pada kategori saat ini.
export function levelMeter(key: string) {
  const current = levelRank(key)
  return `<div class="level-meter" role="img" aria-label="Tingkat ${ISPU_LEVELS.find((item) => item.key === key)?.label ?? 'tidak diketahui'} dari lima tingkat ISPU">
    ${ISPU_LEVELS.map((level) => `<span class="level-meter-step${levelRank(level.key) === current ? ' active' : ''}" style="--level:${level.color}"><i></i><small>${level.label}</small></span>`).join('')}
  </div>`
}
