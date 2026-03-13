import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import type { FireHotspot, LightningStrike, AirQualityStation, ShodanDevice, RadiationSensor, IntelEvent } from '@/src/store/satelliteStore'
import {
  getSatellitePosition,
  getFullOrbitPath,
  getCoverageFootprint,
  classifyOrbit,
} from '@/lib/propagate'
import { guessOwnerFromName, getOwnerInfo } from '@/lib/country-map'
import { JAMMING_ZONES, ADSB_FLIGHTS, AIS_VESSELS, GROUND_STATIONS } from '@/lib/intel-data'
import { GIBS_LAYERS, getGIBSDate, getNDVIDate } from '@/lib/gibs-layers'
import type { TLESatellite, AISVessel } from '@/lib/types'

// ── Satellite icon — detailed SVG with solar panels ──
function createSatIcon(color: string, size: number, isLocked: boolean): L.DivIcon {
  const glow = isLocked
    ? `filter:drop-shadow(0 0 8px ${color}) drop-shadow(0 0 3px ${color});`
    : `filter:drop-shadow(0 0 3px ${color});`
  const pulse = isLocked
    ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1" opacity="0.4"><animate attributeName="r" from="8" to="15" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite"/></circle>`
    : ''
  const body = isLocked
    ? `<rect x="12" y="12" width="8" height="8" rx="1" fill="${color}" opacity="0.95"/><rect x="3" y="14" width="10" height="4" rx="1" fill="${color}" opacity="0.7"/><rect x="19" y="14" width="10" height="4" rx="1" fill="${color}" opacity="0.7"/><line x1="16" y1="8" x2="16" y2="12" stroke="${color}" stroke-width="1.5"/><circle cx="16" cy="7" r="1.5" fill="${color}"/>`
    : `<rect x="13" y="13" width="6" height="6" rx="1" fill="${color}" opacity="0.95"/><rect x="5" y="14.5" width="9" height="3" rx="0.5" fill="${color}" opacity="0.65"/><rect x="18" y="14.5" width="9" height="3" rx="0.5" fill="${color}" opacity="0.65"/><line x1="16" y1="10" x2="16" y2="13" stroke="${color}" stroke-width="1"/><circle cx="16" cy="9" r="1" fill="${color}"/>`
  return L.divIcon({
    className: 'sat-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<svg viewBox="0 0 32 32" width="${size}" height="${size}" style="${glow}">${body}${pulse}</svg>`,
  })
}

// ── Vessel icon — 10 hull types with caching ──
const _vesselIconCache = new Map<string, L.DivIcon>()
function createVesselIcon(type: string, course?: number): L.DivIcon {
  const tl = (type || '').toLowerCase()
  const rot = Math.round((course || 0) / 5) * 5
  const ck = `${tl}_${rot}`
  if (_vesselIconCache.has(ck)) return _vesselIconCache.get(ck)!

  const typeColors: Record<string, string> = {
    warship: '#ff1744', cargo: '#42a5f5', tanker: '#ff7043', passenger: '#66bb6a',
    fishing: '#fdd835', tug: '#ab47bc', military: '#ff1744', research: '#00bcd4',
    'high speed': '#e91e63', sar: '#76ff03', unknown: '#78909c',
  }
  const c = typeColors[tl] || '#78909c'
  let hull: string
  let sz = 28
  const vb = '0 0 32 32'

  if (tl === 'warship' || tl === 'military') {
    sz = 32
    hull = `<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff" stop-opacity=".25"/><stop offset="100%" stop-color="#000" stop-opacity=".3"/></linearGradient></defs><path d="M16 1 L22 7 L23 12 L22 26 L19 30 L13 30 L10 26 L9 12 L10 7 Z" fill="${c}" stroke="rgba(255,255,255,.3)" stroke-width=".6"/><path d="M16 1 L22 7 L23 12 L22 26 L19 30 L13 30 L10 26 L9 12 L10 7 Z" fill="url(#wg)"/><rect x="13" y="8" width="6" height="5" rx="1" fill="rgba(0,0,0,.4)" stroke="rgba(255,255,255,.15)" stroke-width=".4"/><rect x="14" y="14" width="4" height="3" rx=".5" fill="rgba(0,0,0,.35)"/><line x1="16" y1="3" x2="16" y2="8" stroke="#fff" stroke-width="1" opacity=".7"/><circle cx="16" cy="3" r="1" fill="#fff" opacity=".6"/><line x1="10" y1="18" x2="7" y2="16" stroke="${c}" stroke-width="1.2" opacity=".7"/><line x1="22" y1="18" x2="25" y2="16" stroke="${c}" stroke-width="1.2" opacity=".7"/>`
  } else if (tl === 'cargo') {
    hull = `<path d="M16 2 L22 8 L22 25 L19 29 L13 29 L10 25 L10 8 Z" fill="${c}" opacity=".92"/><rect x="12" y="10" width="8" height="5" rx="1" fill="rgba(0,0,0,.3)" stroke="rgba(255,255,255,.1)" stroke-width=".3"/><rect x="12" y="16" width="8" height="5" rx="1" fill="rgba(0,0,0,.25)" stroke="rgba(255,255,255,.1)" stroke-width=".3"/><line x1="16" y1="10" x2="16" y2="21" stroke="rgba(255,255,255,.12)" stroke-width=".4"/><rect x="14" y="4" width="4" height="3" rx="1" fill="${c}" opacity=".7"/><line x1="16" y1="2" x2="16" y2="5" stroke="rgba(255,255,255,.4)" stroke-width=".8"/>`
  } else if (tl === 'tanker') {
    hull = `<ellipse cx="16" cy="16" rx="7" ry="13" fill="${c}" opacity=".9"/><ellipse cx="16" cy="16" rx="5" ry="10" fill="rgba(0,0,0,.15)"/><line x1="16" y1="4" x2="16" y2="28" stroke="rgba(255,255,255,.12)" stroke-width=".5"/><rect x="14" y="5" width="4" height="3" rx="1" fill="${c}" opacity=".7"/>`
  } else if (tl === 'passenger') {
    hull = `<rect x="9" y="4" width="14" height="24" rx="4" fill="${c}" opacity=".92"/><rect x="11" y="7" width="10" height="3" rx="1" fill="rgba(255,255,255,.25)"/><rect x="11" y="12" width="10" height="3" rx="1" fill="rgba(255,255,255,.2)"/><rect x="11" y="17" width="10" height="3" rx="1" fill="rgba(255,255,255,.15)"/><rect x="13" y="22" width="6" height="4" rx="1" fill="rgba(0,0,0,.2)"/><circle cx="16" cy="5" r="1" fill="rgba(255,255,255,.4)"/>`
  } else if (tl === 'fishing') {
    hull = `<path d="M16 3 L21 22 L16 19 L11 22 Z" fill="${c}" opacity=".9"/><line x1="16" y1="1" x2="16" y2="10" stroke="${c}" stroke-width="1.5" opacity=".8"/><line x1="16" y1="3" x2="12" y2="7" stroke="${c}" stroke-width=".8" opacity=".5"/><line x1="16" y1="4" x2="21" y2="8" stroke="${c}" stroke-width=".8" opacity=".5"/><circle cx="16" cy="1" r="1" fill="${c}" opacity=".6"/>`
  } else if (tl === 'tug') {
    hull = `<rect x="10" y="8" width="12" height="16" rx="3" fill="${c}" opacity=".92"/><rect x="12" y="4" width="8" height="6" rx="2" fill="${c}" opacity=".75"/><rect x="14" y="2" width="4" height="3" rx="1" fill="${c}" opacity=".6"/><line x1="10" y1="20" x2="7" y2="22" stroke="${c}" stroke-width="1.5" opacity=".5"/><line x1="22" y1="20" x2="25" y2="22" stroke="${c}" stroke-width="1.5" opacity=".5"/>`
  } else if (tl === 'research') {
    hull = `<path d="M16 3 L21 8 L21 24 L18 28 L14 28 L11 24 L11 8 Z" fill="${c}" opacity=".9"/><circle cx="16" cy="12" r="3" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.3)" stroke-width=".4"/><line x1="16" y1="2" x2="16" y2="7" stroke="#fff" stroke-width=".8" opacity=".5"/><circle cx="16" cy="1" r=".8" fill="#fff" opacity=".5"/>`
  } else if (tl === 'high speed') {
    hull = `<path d="M16 1 L23 10 L21 28 L16 30 L11 28 L9 10 Z" fill="${c}" opacity=".9"/><path d="M16 5 L20 10 L19 22 L16 24 L13 22 L12 10 Z" fill="rgba(255,255,255,.1)"/><line x1="9" y1="14" x2="6" y2="12" stroke="${c}" stroke-width="1" opacity=".6"/><line x1="23" y1="14" x2="26" y2="12" stroke="${c}" stroke-width="1" opacity=".6"/>`
  } else if (tl === 'sar') {
    hull = `<path d="M16 2 L22 8 L22 24 L19 28 L13 28 L10 24 L10 8 Z" fill="${c}" opacity=".9"/><path d="M12 11 L16 7 L20 11 L16 15 Z" fill="rgba(255,255,255,.35)" stroke="#fff" stroke-width=".5"/><line x1="16" y1="2" x2="16" y2="7" stroke="#fff" stroke-width="1" opacity=".6"/>`
  } else {
    hull = `<path d="M16 3 L22 12 L20 27 L16 30 L12 27 L10 12 Z" fill="${c}" opacity=".8"/><circle cx="16" cy="15" r="2" fill="rgba(255,255,255,.15)"/>`
  }

  const icon = L.divIcon({
    className: 'vessel-icon',
    iconSize: [sz, sz],
    iconAnchor: [sz / 2, sz / 2],
    html: `<svg viewBox="${vb}" width="${sz}" height="${sz}" style="transform:rotate(${rot}deg);filter:drop-shadow(0 0 4px ${c}) drop-shadow(0 0 1px rgba(0,0,0,.8))">${hull}</svg>`,
  })
  _vesselIconCache.set(ck, icon)
  return icon
}

// ── Flight icon — military vs civilian (cached by heading bucket) ──
const _flightIconCache = new Map<string, L.DivIcon>()
function createFlightIcon(heading: number, isMilitary?: boolean): L.DivIcon {
  const rot = Math.round(heading / 10) * 10 // bucket to 10° for caching
  const key = `${isMilitary ? 'mil' : 'civ'}_${rot}`
  const cached = _flightIconCache.get(key)
  if (cached) return cached

  let icon: L.DivIcon
  if (isMilitary) {
    icon = L.divIcon({
      className: 'mil-flight-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      html: `<svg viewBox="0 0 24 24" width="24" height="24" style="transform:rotate(${rot}deg);filter:drop-shadow(0 0 8px #ff1744) drop-shadow(0 0 3px #ff0000)"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="#ff1744" opacity="1"/><circle cx="12" cy="12" r="11" fill="none" stroke="#ff1744" stroke-width="0.8" opacity="0.4"><animate attributeName="r" from="6" to="11" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>`,
    })
  } else {
    const c = '#aa44ff'
    icon = L.divIcon({
      className: 'flight-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      html: `<svg viewBox="0 0 24 24" width="16" height="16" style="transform:rotate(${rot}deg);filter:drop-shadow(0 0 4px ${c})"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="${c}" opacity="0.9"/></svg>`,
    })
  }
  _flightIconCache.set(key, icon)
  return icon
}

// ── Ground station icon ──
function createGSIcon(type: string): L.DivIcon {
  const colors: Record<string, string> = { launch: '#ff6600', sigint: '#ff0040', radar: '#ffee00', dsn: '#00ffcc' }
  const c = colors[type] || '#fff'
  return L.divIcon({
    className: 'gs-icon',
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="14" width="12" height="8" fill="${c}" opacity="0.8"/><polygon points="12,2 6,14 18,14" fill="${c}" opacity="0.9"/></svg>`,
  })
}

// ── Quake icon ──
function createQuakeIcon(mag: number): L.DivIcon {
  const s = Math.max(12, mag * 6)
  return L.divIcon({
    className: 'quake-icon',
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    html: `<svg viewBox="0 0 24 24" width="${s}" height="${s}"><circle cx="12" cy="12" r="10" fill="#ff3d3d" opacity="0.5"/><circle cx="12" cy="12" r="5" fill="#ff3d3d" opacity="0.9"/><circle cx="12" cy="12" r="10" fill="none" stroke="#ff3d3d" stroke-width="1" opacity="0.4"><animate attributeName="r" from="5" to="12" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>`,
  })
}

// ── EONET event icon ──
function createEventIcon(cat: string): L.DivIcon {
  const colors: Record<string, string> = { Wildfires: '#ff6600', 'Severe Storms': '#aa00ff', Volcanoes: '#ff0000', 'Sea and Lake Ice': '#00ccff', Floods: '#0066ff' }
  const c = colors[cat] || '#ffee00'
  return L.divIcon({
    className: 'eonet-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<svg viewBox="0 0 24 24" width="16" height="16"><polygon points="12,2 4,20 20,20" fill="${c}" opacity="0.85"/><text x="12" y="17" text-anchor="middle" font-size="10" fill="#000" font-weight="bold">!</text></svg>`,
  })
}

// ── Ship emoji marker — ship-shaped SVG hull + type emoji badge ──
const _shipEmojiCache = new Map<string, L.DivIcon>()
function createShipEmojiMarker(type: string, course?: number): L.DivIcon {
  const tl = (type || '').toLowerCase()
  const rot = Math.round((course || 0) / 5) * 5
  const ck = `ship_${tl}_${rot}`
  if (_shipEmojiCache.has(ck)) return _shipEmojiCache.get(ck)!

  let emoji: string, color: string, sz: number, hull: string
  switch (tl) {
    case 'warship':
    case 'military':
      emoji = '\u2694\uFE0F'; color = '#ff1744'; sz = 38
      hull = `<path d="M20,2 L28,10 L29,16 L28,30 L24,37 L16,37 L12,30 L11,16 L12,10 Z" fill="${color}" opacity=".9" stroke="rgba(255,255,255,.45)" stroke-width=".7"/><rect x="15" y="10" width="10" height="6" rx="1.5" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.15)" stroke-width=".4"/><rect x="17" y="18" width="6" height="4" rx=".8" fill="rgba(0,0,0,.3)"/><line x1="20" y1="3" x2="20" y2="10" stroke="#fff" stroke-width="1.2" opacity=".65"/><circle cx="20" cy="3" r="1.5" fill="#fff" opacity=".5"/><line x1="12" y1="22" x2="7" y2="19" stroke="${color}" stroke-width="1.5" opacity=".7"/><line x1="28" y1="22" x2="33" y2="19" stroke="${color}" stroke-width="1.5" opacity=".7"/>`
      break
    case 'cargo':
      emoji = '\uD83D\uDCE6'; color = '#42a5f5'; sz = 32
      hull = `<path d="M20,3 L27,10 L27,30 L23,36 L17,36 L13,30 L13,10 Z" fill="${color}" opacity=".9" stroke="rgba(255,255,255,.3)" stroke-width=".6"/><rect x="15" y="12" width="10" height="6" rx="1" fill="rgba(0,0,0,.25)" stroke="rgba(255,255,255,.1)" stroke-width=".3"/><rect x="15" y="20" width="10" height="6" rx="1" fill="rgba(0,0,0,.2)" stroke="rgba(255,255,255,.1)" stroke-width=".3"/><line x1="20" y1="12" x2="20" y2="26" stroke="rgba(255,255,255,.12)" stroke-width=".4"/><line x1="20" y1="3" x2="20" y2="8" stroke="rgba(255,255,255,.4)" stroke-width=".8"/>`
      break
    case 'tanker':
      emoji = '\uD83D\uDEE2\uFE0F'; color = '#ff7043'; sz = 32
      hull = `<ellipse cx="20" cy="20" rx="8" ry="16" fill="${color}" opacity=".9"/><ellipse cx="20" cy="20" rx="6" ry="12" fill="rgba(0,0,0,.15)"/><line x1="20" y1="5" x2="20" y2="35" stroke="rgba(255,255,255,.1)" stroke-width=".5"/><rect x="17" y="6" width="6" height="4" rx="1" fill="${color}" opacity=".7"/>`
      break
    case 'passenger':
      emoji = '\uD83D\uDEF3\uFE0F'; color = '#66bb6a'; sz = 34
      hull = `<rect x="12" y="5" width="16" height="30" rx="5" fill="${color}" opacity=".9"/><rect x="14" y="8" width="12" height="3.5" rx="1" fill="rgba(255,255,255,.25)"/><rect x="14" y="13" width="12" height="3.5" rx="1" fill="rgba(255,255,255,.2)"/><rect x="14" y="18" width="12" height="3.5" rx="1" fill="rgba(255,255,255,.15)"/><rect x="16" y="24" width="8" height="5" rx="1" fill="rgba(0,0,0,.2)"/><circle cx="20" cy="6" r="1.2" fill="rgba(255,255,255,.4)"/>`
      break
    case 'fishing':
      emoji = '\uD83C\uDFA3'; color = '#fdd835'; sz = 26
      hull = `<path d="M20,4 L26,26 L20,22 L14,26 Z" fill="${color}" opacity=".9"/><line x1="20" y1="1" x2="20" y2="12" stroke="${color}" stroke-width="1.5" opacity=".8"/><line x1="20" y1="4" x2="15" y2="9" stroke="${color}" stroke-width=".8" opacity=".5"/><line x1="20" y1="5" x2="26" y2="10" stroke="${color}" stroke-width=".8" opacity=".5"/><circle cx="20" cy="1" r="1" fill="${color}" opacity=".6"/>`
      break
    case 'tug':
      emoji = '\u2693'; color = '#ab47bc'; sz = 28
      hull = `<rect x="13" y="10" width="14" height="18" rx="4" fill="${color}" opacity=".9"/><rect x="15" y="5" width="10" height="7" rx="2.5" fill="${color}" opacity=".75"/><rect x="17" y="2" width="6" height="4" rx="1.5" fill="${color}" opacity=".6"/><line x1="13" y1="24" x2="9" y2="27" stroke="${color}" stroke-width="1.5" opacity=".5"/><line x1="27" y1="24" x2="31" y2="27" stroke="${color}" stroke-width="1.5" opacity=".5"/>`
      break
    case 'research':
      emoji = '\uD83D\uDD2C'; color = '#00bcd4'; sz = 30
      hull = `<path d="M20,4 L26,10 L26,28 L23,34 L17,34 L14,28 L14,10 Z" fill="${color}" opacity=".9"/><circle cx="20" cy="15" r="4" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.3)" stroke-width=".5"/><line x1="20" y1="2" x2="20" y2="9" stroke="#fff" stroke-width=".8" opacity=".5"/><circle cx="20" cy="2" r="1" fill="#fff" opacity=".5"/>`
      break
    case 'high speed':
      emoji = '\u26A1'; color = '#e91e63'; sz = 30
      hull = `<path d="M20,1 L28,12 L26,33 L20,37 L14,33 L12,12 Z" fill="${color}" opacity=".9"/><path d="M20,5 L25,12 L24,26 L20,30 L16,26 L15,12 Z" fill="rgba(255,255,255,.1)"/><line x1="12" y1="16" x2="8" y2="13" stroke="${color}" stroke-width="1" opacity=".6"/><line x1="28" y1="16" x2="32" y2="13" stroke="${color}" stroke-width="1" opacity=".6"/>`
      break
    case 'sar':
      emoji = '\uD83C\uDD98'; color = '#76ff03'; sz = 30
      hull = `<path d="M20,3 L27,10 L27,28 L23,34 L17,34 L13,28 L13,10 Z" fill="${color}" opacity=".9"/><path d="M15,14 L20,9 L25,14 L20,19 Z" fill="rgba(255,255,255,.35)" stroke="#fff" stroke-width=".5"/><line x1="20" y1="3" x2="20" y2="9" stroke="#fff" stroke-width="1" opacity=".6"/>`
      break
    case 'pilot':
      emoji = '\uD83E\uDDED'; color = '#ff9800'; sz = 26
      hull = `<path d="M20,4 L26,12 L25,30 L20,35 L15,30 L14,12 Z" fill="${color}" opacity=".85"/><circle cx="20" cy="17" r="3.5" fill="rgba(255,255,255,.2)" stroke="rgba(255,255,255,.2)" stroke-width=".5"/>`
      break
    default:
      emoji = '\uD83D\uDEA2'; color = '#78909c'; sz = 26
      hull = `<path d="M20,4 L27,14 L25,32 L20,36 L15,32 L13,14 Z" fill="${color}" opacity=".8"/><circle cx="20" cy="18" r="2.5" fill="rgba(255,255,255,.15)"/>`
      break
  }

  const isMil = tl === 'warship' || tl === 'military'
  const icon = L.divIcon({
    className: 'ship-emoji-marker',
    iconSize: [sz, sz],
    iconAnchor: [sz / 2, sz / 2],
    html: `<div style="position:relative;width:${sz}px;height:${sz}px;"><svg viewBox="0 0 40 40" width="${sz}" height="${sz}" style="transform:rotate(${rot}deg);filter:drop-shadow(0 0 ${isMil ? 8 : 5}px ${color}) drop-shadow(0 0 2px rgba(0,0,0,.9))">${hull}</svg><span style="position:absolute;top:-7px;right:-7px;font-size:13px;line-height:1;filter:drop-shadow(0 0 3px rgba(0,0,0,.95));z-index:2">${emoji}</span></div>`,
  })
  _shipEmojiCache.set(ck, icon)
  return icon
}

export default function IntelMap() {
  const mapRef = useRef<L.Map | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const orbitsRef = useRef<Map<string, L.Polyline>>(new Map())
  const coverageRef = useRef<Map<string, L.Polygon>>(new Map())
  const jammingRef = useRef<L.Circle[]>([])
  const jammingPulseRef = useRef<L.Circle[]>([])
  const flightRef = useRef<Map<string, { marker: L.Marker; line: L.Polyline }>>(new Map())
  const vesselRef = useRef<Map<string, L.Marker>>(new Map())
  const stationRef = useRef<L.Marker[]>([])
  const quakeRef = useRef<L.Marker[]>([])
  const eventRef = useRef<L.Marker[]>([])
  const fireRef = useRef<L.CircleMarker[]>([])
  const lightningRef = useRef<L.CircleMarker[]>([])
  const aqiRef = useRef<L.CircleMarker[]>([])
  const shodanRef = useRef<L.CircleMarker[]>([])
  const radiationRef = useRef<L.CircleMarker[]>([])
  const intelEventRef = useRef<L.Marker[]>([])
  const weatherLayerRef = useRef<L.TileLayer | null>(null)
  const imageryLayerRef = useRef<L.TileLayer | null>(null)
  const godsEyeLayerRef = useRef<L.TileLayer | null>(null)
  const animFrameRef = useRef<number>(0)

  const {
    satellites,
    lockedId,
    showOrbits,
    showCoverage,
    showJamming,
    showFlights,
    showVessels,
    showSatellites,
    showStations,
    showQuakes,
    showEvents,
    showFires,
    showLightning,
    showAirQuality,
    showShodan,
    showRadiation,
    showWeather,
    activeImageryLayer,
    godsEyeMode,
    timelineOffset,
    toggleLock,
    quakes,
    events,
    liveVessels,
    multiSourceVessels,
    liveFlights,
    vesselTypeFilters,
    fires,
    lightning,
    airQuality,
    shodanDevices,
    radiation,
    intelEvents,
  } = useSatelliteStore()

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      center: [20, 0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
    })

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18 }
    ).addTo(map)

    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, opacity: 0.5 }
    ).addTo(map)

    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.attribution({ position: 'bottomright', prefix: false })
      .addAttribution('ESRI | CelesTrak | NASA GIBS')
      .addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Imagery layer management
  useEffect(() => {
    if (!mapRef.current) return
    if (imageryLayerRef.current) {
      mapRef.current.removeLayer(imageryLayerRef.current)
      imageryLayerRef.current = null
    }
    if (activeImageryLayer) {
      const layer = GIBS_LAYERS.find((l) => l.id === activeImageryLayer)
      if (layer) {
        imageryLayerRef.current = L.tileLayer(layer.url, {
          maxZoom: layer.maxZoom,
          opacity: 0.7,
          attribution: 'NASA GIBS',
        }).addTo(mapRef.current)
      }
    }
  }, [activeImageryLayer])

  // God's Eye HD layer management
  useEffect(() => {
    if (!mapRef.current) return
    if (godsEyeLayerRef.current) {
      mapRef.current.removeLayer(godsEyeLayerRef.current)
      godsEyeLayerRef.current = null
    }
    if (!godsEyeMode) return
    const dt = getGIBSDate()
    if (godsEyeMode === 's2hd') {
      godsEyeLayerRef.current = L.tileLayer(
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
        { maxZoom: 15, opacity: 0.92 }
      ).addTo(mapRef.current)
    } else if (godsEyeMode === 'ndvi') {
      godsEyeLayerRef.current = L.tileLayer(
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${getNDVIDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
        { maxZoom: 9, opacity: 0.85 }
      ).addTo(mapRef.current)
    } else if (godsEyeMode === 'fires_hd') {
      godsEyeLayerRef.current = L.tileLayer(
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/${dt}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
        { maxZoom: 8, opacity: 0.85 }
      ).addTo(mapRef.current)
    } else if (godsEyeMode === 'night_hd') {
      godsEyeLayerRef.current = L.tileLayer(
        `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_ENCC/default/${dt}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
        { maxZoom: 8, opacity: 0.85 }
      ).addTo(mapRef.current)
    }
  }, [godsEyeMode])

  // Jamming zones
  useEffect(() => {
    if (!mapRef.current) return
    jammingRef.current.forEach((c) => mapRef.current!.removeLayer(c))
    jammingPulseRef.current.forEach((c) => mapRef.current!.removeLayer(c))
    jammingRef.current = []
    jammingPulseRef.current = []
    if (!showJamming) return

    JAMMING_ZONES.forEach((zone) => {
      if (!zone.active) return
      const sevColors: Record<string, string> = { high: '#ff3d3d', medium: '#ffab00', low: '#facc15' }
      const color = sevColors[zone.severity]

      const circle = L.circle(zone.center, {
        radius: zone.radiusKm * 1000,
        color,
        fillColor: color,
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '6 4',
      }).addTo(mapRef.current!)

      circle.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:${color};font-weight:bold">${zone.type} JAMMING</div>
          <div>${zone.name}</div>
          <div>Radius: ${zone.radiusKm}km</div>
          <div>Severity: ${zone.severity.toUpperCase()}</div>
          ${zone.source ? `<div style="color:#888">SRC: ${zone.source}</div>` : ''}
        </div>`,
        { className: 'intel-popup' }
      )
      jammingRef.current.push(circle)

      const pulse = L.circle(zone.center, {
        radius: zone.radiusKm * 1000,
        color,
        fillColor: 'transparent',
        weight: 2,
        opacity: 0,
      }).addTo(mapRef.current!)
      jammingPulseRef.current.push(pulse)
    })

    let phase = 0
    const animatePulse = () => {
      phase = (phase + 0.02) % 1
      jammingPulseRef.current.forEach((p, i) => {
        const zone = JAMMING_ZONES[i]
        if (!zone) return
        const r = zone.radiusKm * 1000 * (0.6 + phase * 0.4)
        p.setRadius(r)
        p.setStyle({ opacity: 0.5 * (1 - phase) })
      })
      animFrameRef.current = requestAnimationFrame(animatePulse)
    }
    animFrameRef.current = requestAnimationFrame(animatePulse)

    return () => cancelAnimationFrame(animFrameRef.current)
  }, [showJamming])

  // ADS-B Flight paths — live tracking with smooth updates
  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current

    if (!showFlights) {
      flightRef.current.forEach(({ marker, line }) => {
        map.removeLayer(marker)
        map.removeLayer(line)
      })
      flightRef.current.clear()
      return
    }

    // Build a set of current flight IDs for cleanup
    const currentIds = new Set(liveFlights.map(f => f.icao24))

    // Remove flights that no longer exist in the data
    flightRef.current.forEach(({ marker, line }, id) => {
      if (!currentIds.has(id)) {
        map.removeLayer(marker)
        map.removeLayer(line)
        flightRef.current.delete(id)
      }
    })

    // Viewport-aware rendering: render ALL at zoom >= 3, cull at very low zoom
    const bounds = map.getBounds().pad(0.5)
    const zoom = map.getZoom()
    // At low zoom show mil always + sample civilians; at higher zoom show all
    const flightsToRender = zoom < 3
      ? liveFlights.filter(f => f.isMilitary || bounds.contains([f.lat, f.lng]))
      : liveFlights

    for (const flight of flightsToRender) {
      const isMil = flight.isMilitary || false
      const existing = flightRef.current.get(flight.icao24)

      if (existing) {
        // Update position; only update icon if heading changed significantly
        existing.marker.setLatLng([flight.lat, flight.lng])
        const oldRot = (existing as any)._lastRot || 0
        const newRot = Math.round(flight.heading / 10) * 10
        if (newRot !== oldRot) {
          existing.marker.setIcon(createFlightIcon(flight.heading, isMil));
          (existing as any)._lastRot = newRot
        }
      } else {
        const icon = createFlightIcon(flight.heading, isMil)
        // At low zoom, make civilians non-interactive for performance
        const interactive = isMil || zoom >= 5
        const marker = L.marker([flight.lat, flight.lng], { icon, interactive }).addTo(map)
        if (interactive) {
          const milBadge = isMil ? '<div style="color:#ff1744;font-weight:bold;font-size:11px">🎖 MILITARY</div>' : ''
          const popupColor = isMil ? '#ff1744' : '#aa44ff'
          marker.bindPopup(
            `<div style="font-family:monospace;font-size:11px;color:#fff;background:#0d0d0d;padding:10px;border-radius:6px;border:1px solid ${isMil ? 'rgba(255,23,68,0.4)' : 'rgba(170,68,255,0.3)'}">
              <div style="color:${popupColor};font-weight:bold;font-size:12px">✈ ${flight.callsign}</div>
              ${milBadge}
              <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-top:4px">
                <span style="color:#666">ICAO</span><span>${flight.icao24.toUpperCase()}</span>
                <span style="color:#666">ALT</span><span>${Math.round(flight.alt)}m (FL${Math.round(flight.alt * 3.28084 / 100)})</span>
                <span style="color:#666">SPD</span><span>${Math.round(flight.velocity)} m/s (${Math.round(flight.velocity * 1.944)} kn)</span>
                <span style="color:#666">HDG</span><span>${Math.round(flight.heading)}°</span>
                <span style="color:#666">ORIGIN</span><span>${flight.origin || 'N/A'}</span>
              </div>
            </div>`,
            { className: 'intel-popup' }
          )
        }
        const emptyLine = L.polyline([], { opacity: 0 }).addTo(map)
        const entry = { marker, line: emptyLine } as any
        entry._lastRot = Math.round(flight.heading / 10) * 10
        flightRef.current.set(flight.icao24, entry)
      }
    }
  }, [showFlights, liveFlights])

  // AIS Vessels — smooth incremental updates with viewport culling & interpolation
  useEffect(() => {
    if (!mapRef.current) return

    if (!showVessels) {
      vesselRef.current.forEach((m) => mapRef.current!.removeLayer(m))
      vesselRef.current.clear()
      return
    }

    const map = mapRef.current
    let rafId = 0

    const renderVessels = () => {
      if (!mapRef.current) return
      const bounds = mapRef.current.getBounds().pad(0.3)
      const zoom = mapRef.current.getZoom()

      // Merge static + multi-source + live (live takes priority via reverse dedup)
      const allVessels = [
        ...AIS_VESSELS,
        ...multiSourceVessels.map((v: AISVessel) => ({
          id: v.id, name: v.name, type: v.type,
          lat: v.lat, lng: v.lng, course: v.course, speed: v.speed, flag: v.flag,
        })),
        ...liveVessels.map((v: AISVessel) => ({
          id: v.id, name: v.name, type: v.type,
          lat: v.lat, lng: v.lng, course: v.course, speed: v.speed, flag: v.flag,
        })),
      ]

      const seen = new Set<string>()
      const deduped: typeof allVessels = []
      for (let i = allVessels.length - 1; i >= 0; i--) {
        if (!seen.has(allVessels[i].id)) {
          seen.add(allVessels[i].id)
          deduped.push(allVessels[i])
        }
      }

      // At low zoom, limit vessel count for performance
      const maxVessels = zoom < 4 ? 800 : zoom < 6 ? 3000 : 8000
      const visible = deduped.filter(v => {
        if (!bounds.contains([v.lat, v.lng])) return false
        const typeKey = (v.type || 'Unknown').toLowerCase()
        return vesselTypeFilters[typeKey] !== false
      })
      const toRender = visible.length > maxVessels ? visible.slice(0, maxVessels) : visible

      // Remove markers no longer needed
      const incomingIds = new Set(toRender.map((v) => v.id))
      vesselRef.current.forEach((m, id) => {
        if (!incomingIds.has(id)) {
          mapRef.current!.removeLayer(m)
          vesselRef.current.delete(id)
        }
      })

      const tc: Record<string, string> = {
        warship: '#ff1744', military: '#ff1744', cargo: '#42a5f5', tanker: '#ff7043',
        passenger: '#66bb6a', fishing: '#fdd835', tug: '#ab47bc', research: '#00bcd4',
        'high speed': '#e91e63', sar: '#76ff03', pilot: '#ff9800', unknown: '#78909c',
      }

      // Batch DOM updates inside rAF
      rafId = requestAnimationFrame(() => {
        toRender.forEach((vessel) => {
          const existing = vesselRef.current.get(vessel.id)

          if (existing) {
            // Smooth move — setLatLng is already efficient in Leaflet
            existing.setLatLng([vessel.lat, vessel.lng])
            // Only update icon if course changed significantly
            const prevCourse = (existing.options as any)._course || 0
            if (Math.abs(vessel.course - prevCourse) > 10) {
              existing.setIcon(createShipEmojiMarker(vessel.type, vessel.course))
              ;(existing.options as any)._course = vessel.course
            }
          } else {
            const typeColor = tc[(vessel.type || '').toLowerCase()] || '#78909c'
            const marker = L.marker([vessel.lat, vessel.lng], {
              icon: createShipEmojiMarker(vessel.type, vessel.course),
            }).addTo(mapRef.current!)
            ;(marker.options as any)._course = vessel.course
            marker.bindPopup(
              `<div style="font-family:monospace;font-size:11px;color:#fff;background:#0d0d0d;padding:10px;border-radius:6px;border:1px solid ${typeColor}33">
                <div style="border-left:3px solid ${typeColor};padding-left:8px;margin-bottom:4px">
                  <span style="color:${typeColor};font-weight:bold;font-size:12px">${vessel.flag} ${vessel.name}</span>
                </div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;margin-top:4px">
                  <span style="color:#666">TYPE</span><span style="color:${typeColor}">${(vessel.type || 'Unknown').toUpperCase()}</span>
                  <span style="color:#666">MMSI</span><span>${vessel.id}</span>
                  <span style="color:#666">HDG</span><span>${vessel.course}°</span>
                  <span style="color:#666">SPD</span><span>${vessel.speed} kn</span>
                </div>
              </div>`,
              { className: 'intel-popup' }
            )
            vesselRef.current.set(vessel.id, marker)
          }
        })
      })
    }

    renderVessels()
    map.on('moveend zoomend', renderVessels)
    return () => {
      cancelAnimationFrame(rafId)
      map.off('moveend zoomend', renderVessels)
    }
  }, [showVessels, liveVessels, multiSourceVessels, vesselTypeFilters])

  // Ground Stations
  useEffect(() => {
    if (!mapRef.current) return
    stationRef.current.forEach((m) => mapRef.current!.removeLayer(m))
    stationRef.current = []
    if (!showStations) return

    GROUND_STATIONS.forEach((gs) => {
      const m = L.marker([gs.lat, gs.lng], { icon: createGSIcon(gs.type) }).addTo(mapRef.current!)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#ff6600;font-weight:bold">${gs.name}</div>
          <div>${gs.flag} · Type: ${gs.type.toUpperCase()}</div>
        </div>`,
        { className: 'intel-popup' }
      )
      stationRef.current.push(m)
    })
  }, [showStations])

  // Earthquakes
  useEffect(() => {
    if (!mapRef.current) return
    quakeRef.current.forEach((m) => mapRef.current!.removeLayer(m))
    quakeRef.current = []
    if (!showQuakes) return

    quakes.forEach((q) => {
      const m = L.marker([q.lat, q.lng], { icon: createQuakeIcon(q.mag) }).addTo(mapRef.current!)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#ff3d3d;font-weight:bold">M${q.mag.toFixed(1)} EARTHQUAKE</div>
          <div>${q.place}</div>
          <div>Depth: ${q.depth.toFixed(1)} km</div>
          <div>${new Date(q.time).toUTCString()}</div>
        </div>`,
        { className: 'intel-popup' }
      )
      quakeRef.current.push(m)
    })
  }, [showQuakes, quakes])

  // NASA EONET Events
  useEffect(() => {
    if (!mapRef.current) return
    eventRef.current.forEach((m) => mapRef.current!.removeLayer(m))
    eventRef.current = []
    if (!showEvents) return

    events.forEach((ev) => {
      if (!ev.lat || !ev.lng) return
      const m = L.marker([ev.lat, ev.lng], { icon: createEventIcon(ev.category) }).addTo(mapRef.current!)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#ffee00;font-weight:bold">${ev.title}</div>
          <div>Category: ${ev.category}</div>
          ${ev.date ? `<div>${new Date(ev.date).toUTCString()}</div>` : ''}
        </div>`,
        { className: 'intel-popup' }
      )
      eventRef.current.push(m)
    })
  }, [showEvents, events])

  // ── NASA FIRMS Fire Hotspots ──
  useEffect(() => {
    if (!mapRef.current) return
    fireRef.current.forEach(m => mapRef.current!.removeLayer(m))
    fireRef.current = []
    if (!showFires || fires.length === 0) return

    const map = mapRef.current
    const bounds = map.getBounds().pad(0.3)
    fires.filter(f => bounds.contains([f.lat, f.lng])).slice(0, 1500).forEach(f => {
      const r = Math.max(3, Math.min(8, f.frp / 20))
      const m = L.circleMarker([f.lat, f.lng], {
        radius: r, color: '#ff6600', fillColor: '#ff3300', fillOpacity: 0.7, weight: 1,
      }).addTo(map)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#ff6600;font-weight:bold">🔥 FIRE HOTSPOT</div>
          <div>Brightness: ${f.brightness.toFixed(1)}K</div>
          <div>FRP: ${f.frp.toFixed(1)} MW</div>
          <div>Confidence: ${f.confidence}</div>
          <div style="color:#888">${f.date}</div>
        </div>`, { className: 'intel-popup' }
      )
      fireRef.current.push(m)
    })
  }, [showFires, fires])

  // ── Lightning Strikes ──
  useEffect(() => {
    if (!mapRef.current) return
    lightningRef.current.forEach(m => mapRef.current!.removeLayer(m))
    lightningRef.current = []
    if (!showLightning || lightning.length === 0) return

    const map = mapRef.current
    lightning.slice(0, 1000).forEach(s => {
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 3, color: '#ffdd00', fillColor: '#ffff00', fillOpacity: 0.8, weight: 1,
      }).addTo(map)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#ffdd00;font-weight:bold">⚡ LIGHTNING STRIKE</div>
          <div>Energy: ${s.energy}</div>
          <div>${new Date(s.time * 1000).toUTCString()}</div>
        </div>`, { className: 'intel-popup' }
      )
      lightningRef.current.push(m)
    })
  }, [showLightning, lightning])

  // ── Air Quality Stations ──
  useEffect(() => {
    if (!mapRef.current) return
    aqiRef.current.forEach(m => mapRef.current!.removeLayer(m))
    aqiRef.current = []
    if (!showAirQuality || airQuality.length === 0) return

    const map = mapRef.current
    airQuality.forEach(s => {
      const color = s.aqi <= 50 ? '#4caf50' : s.aqi <= 100 ? '#ffeb3b' : s.aqi <= 150 ? '#ff9800' : s.aqi <= 200 ? '#f44336' : s.aqi <= 300 ? '#9c27b0' : '#7e0023'
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 5, color, fillColor: color, fillOpacity: 0.7, weight: 1,
      }).addTo(map)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:${color};font-weight:bold">💨 AIR QUALITY</div>
          <div>AQI: ${s.aqi} ${s.aqi <= 50 ? '(Good)' : s.aqi <= 100 ? '(Moderate)' : s.aqi <= 150 ? '(Unhealthy for Sensitive)' : s.aqi <= 200 ? '(Unhealthy)' : s.aqi <= 300 ? '(Very Unhealthy)' : '(Hazardous)'}</div>
          <div>${s.station}</div>
        </div>`, { className: 'intel-popup' }
      )
      aqiRef.current.push(m)
    })
  }, [showAirQuality, airQuality])

  // ── Shodan Devices ──
  useEffect(() => {
    if (!mapRef.current) return
    shodanRef.current.forEach(m => mapRef.current!.removeLayer(m))
    shodanRef.current = []
    if (!showShodan || shodanDevices.length === 0) return

    const map = mapRef.current
    shodanDevices.filter(d => d.lat !== 0 && d.lng !== 0).forEach(d => {
      const hasVulns = d.vulns && d.vulns.length > 0
      const color = hasVulns ? '#ff1744' : '#e91e63'
      const m = L.circleMarker([d.lat, d.lng], {
        radius: hasVulns ? 6 : 4, color, fillColor: color, fillOpacity: 0.6, weight: 1,
      }).addTo(map)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:#e91e63;font-weight:bold">🖥 SHODAN DEVICE</div>
          <div>IP: ${d.ip}:${d.port}</div>
          <div>Org: ${d.org}</div>
          ${d.product ? `<div>Product: ${d.product}</div>` : ''}
          ${d.os ? `<div>OS: ${d.os}</div>` : ''}
          <div>${d.city}, ${d.country}</div>
          <div>ISP: ${d.isp}</div>
          ${hasVulns ? `<div style="color:#ff1744">⚠ VULNS: ${d.vulns.slice(0, 5).join(', ')}</div>` : ''}
        </div>`, { className: 'intel-popup' }
      )
      shodanRef.current.push(m)
    })
  }, [showShodan, shodanDevices])

  // ── Radiation Sensors ──
  useEffect(() => {
    if (!mapRef.current) return
    radiationRef.current.forEach(m => mapRef.current!.removeLayer(m))
    radiationRef.current = []
    if (!showRadiation || radiation.length === 0) return

    const map = mapRef.current
    radiation.filter(s => s.lat && s.lng).forEach(s => {
      const color = s.value > 0.3 ? '#ff1744' : s.value > 0.15 ? '#ff9800' : '#76ff03'
      const m = L.circleMarker([s.lat, s.lng], {
        radius: 4, color, fillColor: color, fillOpacity: 0.6, weight: 1,
      }).addTo(map)
      m.bindPopup(
        `<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:8px;border-radius:4px">
          <div style="color:${color};font-weight:bold">☢ RADIATION</div>
          <div>${s.value.toFixed(3)} ${s.unit}</div>
          <div>Station: ${s.station}</div>
        </div>`, { className: 'intel-popup' }
      )
      radiationRef.current.push(m)
    })
  }, [showRadiation, radiation])

  // ── Intel Events from AI News Scanner ──
  useEffect(() => {
    if (!mapRef.current) return
    intelEventRef.current.forEach(m => mapRef.current!.removeLayer(m))
    intelEventRef.current = []
    if (intelEvents.length === 0) return

    const map = mapRef.current
    const severityColors: Record<string, string> = {
      critical: '#ff0040', high: '#ff4444', medium: '#ff9800', low: '#ffd600',
    }
    const categoryIcons: Record<string, string> = {
      military_strike: '💥', wmd: '☢️', conflict: '⚔️', terrorism: '🔴',
      natural_disaster: '🌊', civil_unrest: '✊', cyber: '💻', maritime: '🚢',
      geopolitical: '🌐', military_movement: '🎖️', humanitarian: '🏥', incident: '⚠️',
    }

    intelEvents.slice(0, 300).forEach(ev => {
      if (!ev.lat || !ev.lng || ev.lat === 0 && ev.lng === 0) return
      const color = severityColors[ev.severity] || '#ff9800'
      const icon = categoryIcons[ev.category] || '⚠️'
      const sz = ev.severity === 'critical' ? 28 : ev.severity === 'high' ? 22 : 18
      const pulse = ev.severity === 'critical' || ev.severity === 'high'
        ? `<circle cx="16" cy="16" r="14" fill="none" stroke="${color}" stroke-width="1"><animate attributeName="r" from="8" to="15" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="2s" repeatCount="indefinite"/></circle>`
        : ''

      const divIcon = L.divIcon({
        className: 'intel-event-icon',
        iconSize: [sz, sz],
        iconAnchor: [sz / 2, sz / 2],
        html: `<div style="position:relative;width:${sz}px;height:${sz}px;display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 32 32" width="${sz}" height="${sz}" style="position:absolute;top:0;left:0">
            <circle cx="16" cy="16" r="12" fill="${color}" opacity="0.3"/>
            <circle cx="16" cy="16" r="6" fill="${color}" opacity="0.8"/>
            ${pulse}
          </svg>
          <span style="font-size:${sz * 0.5}px;position:relative;z-index:1;filter:drop-shadow(0 0 2px rgba(0,0,0,.8))">${icon}</span>
        </div>`,
      })

      const timeStr = ev.event_time ? new Date(ev.event_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : 'Unknown time'

      const m = L.marker([ev.lat, ev.lng], { icon: divIcon }).addTo(map)
      m.bindPopup(
        `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;background:#0a0e1a;padding:12px;border-radius:6px;border:1px solid ${color}44;min-width:250px;max-width:350px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            <span style="font-size:16px">${icon}</span>
            <span style="color:${color};font-weight:bold;font-size:10px;text-transform:uppercase;letter-spacing:1px;background:${color}22;padding:2px 6px;border-radius:3px">${ev.severity}</span>
            <span style="color:#888;font-size:9px">${ev.category.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          <div style="color:#fff;font-weight:500;font-size:12px;line-height:1.4;margin-bottom:8px">${ev.title}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:10px">
            <span style="color:#666">📍 LOCATION</span><span>${ev.location_name || ev.country || 'Unknown'}</span>
            <span style="color:#666">🕐 TIME</span><span>${timeStr}</span>
            <span style="color:#666">📡 GPS</span><span>${ev.lat.toFixed(4)}°, ${ev.lng.toFixed(4)}°</span>
            ${ev.source_name ? `<span style="color:#666">📰 SOURCE</span><span>${ev.source_name}</span>` : ''}
          </div>
          ${ev.source_url ? `<div style="margin-top:8px;border-top:1px solid ${color}22;padding-top:6px"><a href="${ev.source_url}" target="_blank" style="color:${color};font-size:9px;text-decoration:none">VIEW SOURCE →</a></div>` : ''}
        </div>`,
        { className: 'intel-popup', maxWidth: 380 }
      )
      intelEventRef.current.push(m)
    })
  }, [intelEvents])

  // ── Weather Radar Tile Layer (NOAA) ──
  useEffect(() => {
    if (!mapRef.current) return
    if (weatherLayerRef.current) {
      mapRef.current.removeLayer(weatherLayerRef.current)
      weatherLayerRef.current = null
    }
    if (!showWeather) return
    weatherLayerRef.current = L.tileLayer(
      'https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=9de243494c0b295cca9337e1e96b00e2',
      { maxZoom: 18, opacity: 0.6, attribution: 'OpenWeatherMap' }
    ).addTo(mapRef.current)
  }, [showWeather])
  useEffect(() => {
    if (!mapRef.current || satellites.length === 0) return
    if (!showSatellites) {
      markersRef.current.forEach((m) => mapRef.current!.removeLayer(m))
      markersRef.current.clear()
      return
    }

    const map = mapRef.current
    const now = new Date(Date.now() + timelineOffset * 60 * 1000)
    const maxSats = 2000
    const satsToRender = satellites.slice(0, maxSats)

    satsToRender.forEach((sat: TLESatellite) => {
      const pos = getSatellitePosition(sat.line1, sat.line2, now)
      if (!pos || isNaN(pos.lat) || isNaN(pos.lng)) return

      const isLocked = sat.noradId === lockedId
      const ownerCode = guessOwnerFromName(sat.name)
      const ownerInfo = getOwnerInfo(ownerCode)
      const orbitType = classifyOrbit(pos.alt)

      let marker = markersRef.current.get(sat.noradId)

      if (!marker) {
        marker = L.marker([pos.lat, pos.lng], {
          icon: createSatIcon(ownerInfo.color, isLocked ? 28 : 16, isLocked),
        })
        marker.on('click', () => toggleLock(sat.noradId))
        marker.addTo(map)
        markersRef.current.set(sat.noradId, marker)
      } else {
        marker.setLatLng([pos.lat, pos.lng])
        if (isLocked !== (marker.options as any)._wasLocked) {
          marker.setIcon(createSatIcon(ownerInfo.color, isLocked ? 28 : 16, isLocked))
          ;(marker.options as any)._wasLocked = isLocked
        }
      }

      marker.unbindPopup()
      marker.bindPopup(
        `<div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#e0e0e0;background:#0a0e1a;padding:10px 12px;border-radius:6px;border:1px solid rgba(0,229,255,0.2);min-width:200px">
          <div style="color:#00e5ff;font-weight:bold;font-size:12px;margin-bottom:6px">${sat.name}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 12px">
            <span style="color:#666">NORAD</span><span>${sat.noradId}</span>
            <span style="color:#666">OWNER</span><span>${ownerInfo.flag} ${ownerInfo.name}</span>
            <span style="color:#666">ORBIT</span><span>${orbitType}</span>
            <span style="color:#666">ALT</span><span>${pos.alt.toFixed(1)} km</span>
            <span style="color:#666">VEL</span><span>${pos.velocity.toFixed(2)} km/s</span>
            <span style="color:#666">LAT</span><span>${pos.lat.toFixed(4)}°</span>
            <span style="color:#666">LNG</span><span>${pos.lng.toFixed(4)}°</span>
          </div>
        </div>`,
        { className: 'intel-popup', maxWidth: 300 }
      )

      // Orbit path for locked satellite
      if (isLocked && showOrbits) {
        if (!orbitsRef.current.has(sat.noradId)) {
          const path = getFullOrbitPath(sat.line1, sat.line2, 200)
          if (path.length > 0) {
            const segments: [number, number][][] = [[]]
            for (let i = 1; i < path.length; i++) {
              if (Math.abs(path[i][1] - path[i - 1][1]) > 180) {
                segments.push([])
              }
              segments[segments.length - 1].push([path[i][0], path[i][1]])
            }
            segments.forEach((seg) => {
              if (seg.length < 2) return
              const line = L.polyline(seg, {
                color: ownerInfo.color,
                weight: 1.5,
                opacity: 0.6,
                dashArray: '4 4',
              }).addTo(map)
              orbitsRef.current.set(sat.noradId + '_' + Math.random(), line)
            })
          }
        }
      }

      // Coverage footprint for locked satellite
      if (isLocked && showCoverage) {
        if (!coverageRef.current.has(sat.noradId)) {
          const footprint = getCoverageFootprint(pos.lat, pos.lng, pos.alt)
          if (footprint.length > 0) {
            const polygon = L.polygon(footprint, {
              color: ownerInfo.color,
              fillColor: ownerInfo.color,
              fillOpacity: 0.05,
              weight: 1,
              opacity: 0.3,
            }).addTo(map)
            coverageRef.current.set(sat.noradId, polygon)
          }
        } else {
          const footprint = getCoverageFootprint(pos.lat, pos.lng, pos.alt)
          coverageRef.current.get(sat.noradId)?.setLatLngs(footprint)
        }
      }
    })

    // Clean up orbit lines for unlocked sats
    if (!lockedId) {
      orbitsRef.current.forEach((line) => map.removeLayer(line))
      orbitsRef.current.clear()
      coverageRef.current.forEach((poly) => map.removeLayer(poly))
      coverageRef.current.clear()
    }

    // Fly to locked satellite
    if (lockedId) {
      const locked = satsToRender.find((s) => s.noradId === lockedId)
      if (locked) {
        const lpos = getSatellitePosition(locked.line1, locked.line2, now)
        if (lpos) {
          map.setView([lpos.lat, lpos.lng], map.getZoom(), { animate: true })
        }
      }
    }
  }, [satellites, lockedId, showOrbits, showCoverage, showSatellites, timelineOffset, toggleLock])

  // Auto-update positions every 2 seconds
  useEffect(() => {
    if (!mapRef.current || satellites.length === 0) return

    const interval = setInterval(() => {
      const now = new Date(
        Date.now() + useSatelliteStore.getState().timelineOffset * 60 * 1000
      )
      const maxSats = 2000

      satellites.slice(0, maxSats).forEach((sat: TLESatellite) => {
        const pos = getSatellitePosition(sat.line1, sat.line2, now)
        if (!pos || isNaN(pos.lat) || isNaN(pos.lng)) return

        const marker = markersRef.current.get(sat.noradId)
        if (marker) {
          marker.setLatLng([pos.lat, pos.lng])
        }

        const coverage = coverageRef.current.get(sat.noradId)
        if (coverage) {
          const footprint = getCoverageFootprint(pos.lat, pos.lng, pos.alt)
          coverage.setLatLngs(footprint)
        }
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [satellites])

  // Clean up all markers when satellites change
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        markersRef.current.forEach((m) => mapRef.current!.removeLayer(m))
        markersRef.current.clear()
        orbitsRef.current.forEach((l) => mapRef.current!.removeLayer(l))
        orbitsRef.current.clear()
        coverageRef.current.forEach((p) => mapRef.current!.removeLayer(p))
        coverageRef.current.clear()
      }
    }
  }, [satellites])

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: '#060a14' }}
    />
  )
}
