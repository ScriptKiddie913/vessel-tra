import type { AISVessel, Quake, EONETEvent } from '@/lib/types'
import { JAMMING_ZONES, AIS_VESSELS } from '@/lib/intel-data'

export interface ThreatAlert {
  id: string
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  type: string
  title: string
  description: string
  location?: { lat: number; lng: number }
  recommendation?: string
  timestamp: number
  dismissed: boolean
}

// India-centric threat zones
const INDIA_THREAT_ZONES: Array<{ name: string; lat: number; lng: number; radius: number; priority: string }> = [
  // LAC / China Border
  { name: 'Ladakh / LAC (Aksai Chin)', lat: 34.5, lng: 78.0, radius: 4, priority: 'CRITICAL' },
  { name: 'Arunachal Pradesh / McMahon Line', lat: 28.0, lng: 94.0, radius: 4, priority: 'CRITICAL' },
  { name: 'Doklam / Sikkim Border', lat: 27.3, lng: 89.0, radius: 2, priority: 'HIGH' },
  { name: 'Chumbi Valley', lat: 27.5, lng: 89.3, radius: 2, priority: 'HIGH' },
  { name: 'Depsang Plains', lat: 35.3, lng: 78.0, radius: 2, priority: 'CRITICAL' },
  { name: 'Pangong Tso', lat: 33.7, lng: 78.7, radius: 2, priority: 'CRITICAL' },
  { name: 'Galwan Valley', lat: 34.7, lng: 78.2, radius: 2, priority: 'CRITICAL' },

  // LoC / Pakistan Border
  { name: 'LoC Kashmir (Uri-Poonch)', lat: 34.0, lng: 74.0, radius: 3, priority: 'HIGH' },
  { name: 'LoC Kashmir (Kupwara-Tangdhar)', lat: 34.5, lng: 74.3, radius: 2, priority: 'HIGH' },
  { name: 'International Border (Punjab)', lat: 31.5, lng: 74.5, radius: 3, priority: 'MEDIUM' },
  { name: 'International Border (Rajasthan)', lat: 26.0, lng: 70.0, radius: 4, priority: 'MEDIUM' },
  { name: 'Sir Creek / Gujarat', lat: 23.5, lng: 68.5, radius: 2, priority: 'MEDIUM' },
  { name: 'Siachen Glacier', lat: 35.4, lng: 77.1, radius: 2, priority: 'HIGH' },

  // Indian Ocean Region (IOR)
  { name: 'Andaman Sea / Malacca Approach', lat: 10.0, lng: 94.0, radius: 5, priority: 'HIGH' },
  { name: 'Lakshadweep Sea / Arabian Sea', lat: 10.0, lng: 72.0, radius: 5, priority: 'HIGH' },
  { name: 'Gulf of Aden / Anti-Piracy', lat: 12.0, lng: 45.0, radius: 5, priority: 'MEDIUM' },
  { name: 'Strait of Hormuz / Energy', lat: 26.5, lng: 56.0, radius: 4, priority: 'HIGH' },
  { name: 'Bay of Bengal / Eastern Seaboard', lat: 14.0, lng: 85.0, radius: 6, priority: 'MEDIUM' },

  // String of Pearls (Chinese naval bases)
  { name: 'Hambantota (Chinese Port)', lat: 6.1, lng: 81.1, radius: 2, priority: 'HIGH' },
  { name: 'Gwadar (CPEC Port)', lat: 25.1, lng: 62.3, radius: 2, priority: 'HIGH' },
  { name: 'Djibouti (PLA Base)', lat: 11.5, lng: 43.1, radius: 2, priority: 'MEDIUM' },
  { name: 'Chittagong (Bangladesh)', lat: 22.3, lng: 91.8, radius: 2, priority: 'MEDIUM' },

  // Internal Security
  { name: 'Red Corridor (Maoist Belt)', lat: 22.0, lng: 82.0, radius: 6, priority: 'MEDIUM' },
  { name: 'Northeast India (Insurgency)', lat: 26.0, lng: 93.0, radius: 4, priority: 'MEDIUM' },
]

// Adversary flag detection
const ADVERSARY_FLAGS: Record<string, string> = {
  '🇨🇳': 'CHINA',
  '🇵🇰': 'PAKISTAN',
  'CN': 'CHINA',
  'PK': 'PAKISTAN',
  'China': 'CHINA',
  'Pakistan': 'PAKISTAN',
}

const INDIAN_FLAGS = new Set(['🇮🇳', 'IN', 'India'])

function dist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return Math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2)
}

function genId(): string {
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isAdversaryFlag(flag: string): string | null {
  return ADVERSARY_FLAGS[flag] || null
}

export function analyzeThreats(
  liveVessels: AISVessel[],
  quakes: Quake[],
  events: EONETEvent[],
  prevAlerts: ThreatAlert[]
): ThreatAlert[] {
  const alerts: ThreatAlert[] = []
  const existingTitles = new Set(prevAlerts.filter(a => !a.dismissed).map(a => a.title))
  const allVessels = [...AIS_VESSELS, ...liveVessels]

  // 1. Vessels in jamming zones
  for (const zone of JAMMING_ZONES.filter(z => z.active)) {
    const inZone = allVessels.filter(v =>
      dist(v.lat, v.lng, zone.center[0], zone.center[1]) < (zone.radiusKm / 111)
    )
    if (inZone.length > 0) {
      const title = `Vessels in ${zone.name} jamming zone`
      if (!existingTitles.has(title)) {
        alerts.push({
          id: genId(), level: zone.severity === 'high' ? 'HIGH' : 'MEDIUM',
          type: 'JAMMING_DETECTED', title,
          description: `${inZone.length} vessel(s) in active ${zone.type} jamming zone. Source: ${zone.source || 'Unknown'}. Affected: ${inZone.slice(0, 3).map(v => v.name).join(', ')}`,
          location: { lat: zone.center[0], lng: zone.center[1] },
          recommendation: `Monitor NavIC/IRNSS signal integrity. Alert NTRO for SIGINT collection. Cross-ref with RISAT-2B imagery.`,
          timestamp: Date.now(), dismissed: false,
        })
      }
    }
  }

  // 2. Adversary vessels near India
  for (const v of allVessels) {
    const adversary = isAdversaryFlag(v.flag)
    if (!adversary) continue

    for (const zone of INDIA_THREAT_ZONES) {
      if (dist(v.lat, v.lng, zone.lat, zone.lng) < zone.radius) {
        const isMilitary = /military|warship|naval|navy|submarine/i.test(v.type || '')
        const level = isMilitary ? 'CRITICAL' : (zone.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM')
        const title = `${adversary} vessel ${v.name} near ${zone.name}`
        if (!existingTitles.has(title)) {
          alerts.push({
            id: genId(), level: level as any, type: 'MARITIME_INTRUSION', title,
            description: `${adversary} flag ${v.name} (${v.type}) detected ${dist(v.lat, v.lng, zone.lat, zone.lng).toFixed(1)}° from ${zone.name}. Speed: ${v.speed}kn, Course: ${v.course}°. ${isMilitary ? '⚠️ MILITARY VESSEL — ELEVATED THREAT.' : ''}`,
            location: { lat: v.lat, lng: v.lng },
            recommendation: isMilitary
              ? `IMMEDIATE: Alert Indian Navy ${v.lng < 75 ? 'Western' : 'Eastern'} Naval Command. Deploy P-8I for surveillance. Request RISAT retasking. Track via AIS and satellite correlation.`
              : `Monitor vessel pattern-of-life. Cross-ref with port calls database. Flag for customs/coast guard awareness.`,
            timestamp: Date.now(), dismissed: false,
          })
        }
      }
    }
  }

  // 3. Dark/unknown vessels in Indian waters
  const indianWaters = allVessels.filter(v => {
    const inIOR = v.lat > -10 && v.lat < 35 && v.lng > 40 && v.lng < 100
    return inIOR && (v.type === 'Unknown' || v.type === 'unknown' || v.speed === 0 && !v.name)
  })
  for (const v of indianWaters.slice(0, 5)) {
    const title = `Dark vessel in IOR: ${v.name || 'UNKNOWN'}`
    if (!existingTitles.has(title)) {
      alerts.push({
        id: genId(), level: 'HIGH', type: 'AIS_ANOMALY', title,
        description: `Vessel with disabled/absent AIS at ${v.lat.toFixed(2)}°N, ${v.lng.toFixed(2)}°E in Indian Ocean Region. Flag: ${v.flag || 'UNKNOWN'}. Potential smuggling, espionage, or submarine support vessel.`,
        location: { lat: v.lat, lng: v.lng },
        recommendation: `Deploy Coast Guard patrol vessel. Request P-8I overflight. Alert Indian Navy IMAC (Information Management & Analysis Centre). Cross-reference with NIA watchlist.`,
        timestamp: Date.now(), dismissed: false,
      })
    }
  }

  // 4. Military vessels in IOR (non-Indian, non-allied)
  const foreignMilitary = allVessels.filter(v =>
    (v.type === 'Military' || v.type === 'Warship' || /military|warship/i.test(v.type || '')) &&
    !INDIAN_FLAGS.has(v.flag) &&
    v.lat > -15 && v.lat < 30 && v.lng > 40 && v.lng < 105
  )
  for (const v of foreignMilitary) {
    const adversary = isAdversaryFlag(v.flag)
    const title = `Foreign military vessel ${v.name} in IOR`
    if (!existingTitles.has(title)) {
      alerts.push({
        id: genId(),
        level: adversary ? 'CRITICAL' : 'MEDIUM',
        type: 'FORCE_MOVEMENT', title,
        description: `${v.flag} ${v.name} (${v.type}) operating in Indian Ocean at ${v.lat.toFixed(2)}°N, ${v.lng.toFixed(2)}°E. Speed: ${v.speed}kn, Course: ${v.course}°.${adversary ? ` ⚠️ ${adversary} MILITARY — HIGH PRIORITY TRACK.` : ''}`,
        location: { lat: v.lat, lng: v.lng },
        recommendation: adversary
          ? `IMMEDIATE: Establish continuous tracking. Deploy maritime patrol aircraft. Alert IFC-IOR (Information Fusion Centre). Notify CNS office. Consider deploying CBG if carrier-class vessel.`
          : `Track via IFC-IOR. Share data with Quad partners. Monitor for unusual loitering patterns.`,
        timestamp: Date.now(), dismissed: false,
      })
    }
  }

  // 5. Earthquakes threatening Indian territory
  for (const q of quakes) {
    const nearIndia = (q.lat > 5 && q.lat < 40 && q.lng > 65 && q.lng < 100) ||
                      dist(q.lat, q.lng, 28.6, 77.2) < 15 // Near Delhi
    if (q.mag >= 4.5 && nearIndia) {
      const title = `M${q.mag.toFixed(1)} earthquake: ${q.place}`
      if (!existingTitles.has(title)) {
        const isHimalayan = q.lat > 25 && q.lat < 38 && q.lng > 72 && q.lng < 97
        alerts.push({
          id: genId(),
          level: q.mag >= 6.5 ? 'CRITICAL' : q.mag >= 5.5 ? 'HIGH' : 'MEDIUM',
          type: 'SEISMIC_THREAT', title,
          description: `Magnitude ${q.mag.toFixed(1)} at depth ${q.depth.toFixed(0)}km near Indian territory. ${q.tsunami ? '⚠️ TSUNAMI WARNING — alert coastal states!' : ''} ${isHimalayan ? 'Himalayan seismic zone — assess BRO road/tunnel damage.' : ''}`,
          location: { lat: q.lat, lng: q.lng },
          recommendation: q.mag >= 6.0
            ? `IMMEDIATE: Activate NDRF. Assess damage to border roads (BRO). Check airstrip status (DBO, Nyoma, Fukche). Monitor LAC for opportunistic PLA incursions. Alert Army/ITBP posts. ${q.tsunami ? 'Evacuate coastal areas. Alert Indian Navy ships at sea.' : ''}`
            : `Monitor aftershocks. Check ISRO satellite feeds for damage assessment. Alert local garrison commanders.`,
          timestamp: Date.now(), dismissed: false,
        })
      }
    }
  }

  // 6. High-speed vessels (smuggling / fast attack)
  const highSpeed = allVessels.filter(v =>
    v.speed > 25 && v.lat > -5 && v.lat < 30 && v.lng > 55 && v.lng < 100
  )
  for (const v of highSpeed.slice(0, 3)) {
    const title = `High-speed anomaly in IOR: ${v.name}`
    if (!existingTitles.has(title)) {
      alerts.push({
        id: genId(), level: 'MEDIUM', type: 'PATTERN_BREAK', title,
        description: `${v.flag} ${v.name} (${v.type}) at ${v.speed}kn — exceeds normal class speed. Course: ${v.course}°. Potential smuggling, fast attack craft, or speed run.`,
        location: { lat: v.lat, lng: v.lng },
        recommendation: `Cross-reference with NCB/DRI smuggling watchlist. Alert Indian Coast Guard. Monitor for AIS signal loss (going dark). Check against known drug trafficking routes (Arabian Sea golden crescent corridor).`,
        timestamp: Date.now(), dismissed: false,
      })
    }
  }

  // 7. Natural events near Indian assets
  for (const ev of events) {
    const nearIndia = ev.lat > 5 && ev.lat < 40 && ev.lng > 65 && ev.lng < 100
    if (nearIndia && (ev.category === 'Wildfires' || ev.category === 'Severe Storms' || ev.category === 'Floods')) {
      const title = `${ev.category} near India: ${ev.title}`
      if (!existingTitles.has(title)) {
        alerts.push({
          id: genId(), level: 'MEDIUM', type: 'INFRASTRUCTURE_RISK', title,
          description: `${ev.title} detected in/near Indian territory. Category: ${ev.category}. May impact military operations, supply lines, or civilian infrastructure.`,
          location: { lat: ev.lat, lng: ev.lng },
          recommendation: `Assess impact on nearby military installations. Check ISRO weather satellite data. Coordinate with NDMA/SDRF if civilian impact. Monitor for infrastructure damage to border roads.`,
          timestamp: Date.now(), dismissed: false,
        })
      }
    }
  }

  return alerts
}
