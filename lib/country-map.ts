import type { CountryInfo } from './types'

export const OWNER_MAP: Record<string, { name: string; flag: string; color: string }> = {
  US: { name: 'United States', flag: '🇺🇸', color: '#3b82f6' },
  CN: { name: 'China', flag: '🇨🇳', color: '#ef4444' },
  RU: { name: 'Russia', flag: '🇷🇺', color: '#f59e0b' },
  IN: { name: 'India', flag: '🇮🇳', color: '#f97316' },
  EU: { name: 'ESA (Europe)', flag: '🇪🇺', color: '#06b6d4' },
  JP: { name: 'Japan', flag: '🇯🇵', color: '#ec4899' },
  UK: { name: 'United Kingdom', flag: '🇬🇧', color: '#8b5cf6' },
  FR: { name: 'France', flag: '🇫🇷', color: '#6366f1' },
  DE: { name: 'Germany', flag: '🇩🇪', color: '#84cc16' },
  CA: { name: 'Canada', flag: '🇨🇦', color: '#dc2626' },
  AU: { name: 'Australia', flag: '🇦🇺', color: '#14b8a6' },
  IL: { name: 'Israel', flag: '🇮🇱', color: '#0ea5e9' },
  KR: { name: 'South Korea', flag: '🇰🇷', color: '#a855f7' },
  TR: { name: 'Turkey', flag: '🇹🇷', color: '#e11d48' },
  BR: { name: 'Brazil', flag: '🇧🇷', color: '#16a34a' },
  IT: { name: 'Italy', flag: '🇮🇹', color: '#059669' },
  ESA: { name: 'ESA', flag: '🇪🇺', color: '#06b6d4' },
  ISS: { name: 'ISS (Intl)', flag: '🌍', color: '#ffffff' },
  AB: { name: 'Arabsat', flag: '🌍', color: '#78716c' },
  CIS: { name: 'CIS', flag: '🌍', color: '#a3a3a3' },
  EUME: { name: 'EUMETSAT', flag: '🇪🇺', color: '#06b6d4' },
  IRID: { name: 'Iridium', flag: '🇺🇸', color: '#60a5fa' },
  SES: { name: 'SES', flag: '🇱🇺', color: '#c084fc' },
  O3B: { name: 'O3b/SES', flag: '🇱🇺', color: '#c084fc' },
  ORB: { name: 'Orbcomm', flag: '🇺🇸', color: '#60a5fa' },
  GLOB: { name: 'Globalstar', flag: '🇺🇸', color: '#60a5fa' },
}

export function getOwnerInfo(
  code: string
): { name: string; flag: string; color: string } {
  return OWNER_MAP[code] || { name: code || 'Unknown', flag: '🌍', color: '#6b7280' }
}

export function guessOwnerFromName(name: string): string {
  const n = name.toUpperCase()
  if (n.includes('STARLINK') || n.includes('GPS') || n.includes('TDRS')) return 'US'
  if (n.includes('BEIDOU') || n.includes('YAOGAN') || n.includes('CZ-')) return 'CN'
  if (n.includes('GLONASS') || n.includes('COSMOS') || n.includes('MOLNIYA')) return 'RU'
  if (n.includes('GALILEO')) return 'EU'
  if (n.includes('IRNSS') || n.includes('GSAT') || n.includes('CARTOSAT')) return 'IN'
  if (n.includes('QZSS') || n.includes('HIMAWARI')) return 'JP'
  if (n.includes('KOMPSAT') || n.includes('KOREASAT')) return 'KR'
  if (n.includes('TURKSAT') || n.includes('GOKTURK')) return 'TR'
  if (n.includes('EROS') || n.includes('OFEQ')) return 'IL'
  if (n.includes('SPOT') || n.includes('PLEIADES')) return 'FR'
  if (n.includes('ISS')) return 'ISS'
  return 'US'
}

export const COUNTRY_LIST: { code: string; name: string; flag: string }[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺' },
  { code: 'EU', name: 'ESA (Europe)', flag: '🇪🇺' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷' },
  { code: 'UK', name: 'United Kingdom', flag: '🇬🇧' },
]
