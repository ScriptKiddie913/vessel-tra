import * as satellite from 'satellite.js'
import type { SatellitePosition } from './types'

export function getSatellitePosition(
  tle1: string,
  tle2: string,
  date: Date = new Date()
): SatellitePosition | null {
  try {
    const satrec = satellite.twoline2satrec(tle1, tle2)
    const positionAndVelocity = satellite.propagate(satrec, date)

    if (
      !positionAndVelocity.position ||
      typeof positionAndVelocity.position === 'boolean'
    )
      return null

    const positionEci = positionAndVelocity.position as satellite.EciVec3<number>
    const velocityEci = positionAndVelocity.velocity as satellite.EciVec3<number>

    const gmst = satellite.gstime(date)
    const positionGd = satellite.eciToGeodetic(positionEci, gmst)

    const lat = satellite.degreesLat(positionGd.latitude)
    const lng = satellite.degreesLong(positionGd.longitude)
    const alt = positionGd.height

    const velocity = Math.sqrt(
      velocityEci.x ** 2 + velocityEci.y ** 2 + velocityEci.z ** 2
    )

    return { lat, lng, alt, velocity }
  } catch {
    return null
  }
}

export function getOrbitPath(
  tle1: string,
  tle2: string,
  durationMinutes: number = 90,
  steps: number = 180,
  startDate: Date = new Date()
): Array<[number, number, number]> {
  try {
    const satrec = satellite.twoline2satrec(tle1, tle2)
    const path: Array<[number, number, number]> = []
    const startMs = startDate.getTime()

    for (let i = 0; i <= steps; i++) {
      const t = new Date(startMs + (i / steps) * durationMinutes * 60 * 1000)
      const pv = satellite.propagate(satrec, t)
      if (!pv.position || typeof pv.position === 'boolean') continue

      const gmst = satellite.gstime(t)
      const gd = satellite.eciToGeodetic(
        pv.position as satellite.EciVec3<number>,
        gmst
      )

      path.push([
        satellite.degreesLat(gd.latitude),
        satellite.degreesLong(gd.longitude),
        gd.height,
      ])
    }
    return path
  } catch {
    return []
  }
}

export function getFullOrbitPath(
  tle1: string,
  tle2: string,
  steps: number = 200
): Array<[number, number]> {
  try {
    const satrec = satellite.twoline2satrec(tle1, tle2)
    const periodMinutes = (2 * Math.PI) / satrec.no
    const now = Date.now()
    const path: Array<[number, number]> = []

    for (let i = 0; i <= steps; i++) {
      const t = new Date(now + (i / steps) * periodMinutes * 60 * 1000)
      const pv = satellite.propagate(satrec, t)
      if (!pv.position || typeof pv.position === 'boolean') continue

      const gmst = satellite.gstime(t)
      const gd = satellite.eciToGeodetic(
        pv.position as satellite.EciVec3<number>,
        gmst
      )

      path.push([
        satellite.degreesLat(gd.latitude),
        satellite.degreesLong(gd.longitude),
      ])
    }
    return path
  } catch {
    return []
  }
}

export function getCoverageFootprint(
  lat: number,
  lng: number,
  altKm: number,
  points: number = 64
): Array<[number, number]> {
  const earthRadius = 6371
  const halfAngle = Math.acos(earthRadius / (earthRadius + altKm))
  const footprint: Array<[number, number]> = []

  for (let i = 0; i <= points; i++) {
    const bearing = (i / points) * 2 * Math.PI
    const latRad = Math.asin(
      Math.sin((lat * Math.PI) / 180) * Math.cos(halfAngle) +
        Math.cos((lat * Math.PI) / 180) *
          Math.sin(halfAngle) *
          Math.cos(bearing)
    )
    const lngRad =
      (lng * Math.PI) / 180 +
      Math.atan2(
        Math.sin(bearing) *
          Math.sin(halfAngle) *
          Math.cos((lat * Math.PI) / 180),
        Math.cos(halfAngle) -
          Math.sin((lat * Math.PI) / 180) * Math.sin(latRad)
      )
    footprint.push([(latRad * 180) / Math.PI, (lngRad * 180) / Math.PI])
  }
  return footprint
}

export function classifyOrbit(altKm: number): string {
  if (altKm < 2000) return 'LEO'
  if (altKm < 35786) return 'MEO'
  if (altKm >= 35786 && altKm <= 35800) return 'GEO'
  return 'HEO'
}

export function getOrbitalPeriod(tle1: string, tle2: string): number {
  try {
    const satrec = satellite.twoline2satrec(tle1, tle2)
    return (2 * Math.PI) / satrec.no // minutes
  } catch {
    return 90
  }
}
