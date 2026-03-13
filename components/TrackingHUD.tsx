'use client'

import { useEffect, useState } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { getSatellitePosition, getOrbitalPeriod, classifyOrbit } from '@/lib/propagate'
import { guessOwnerFromName, getOwnerInfo } from '@/lib/country-map'
import { X, Crosshair, Globe2, Gauge, MapPin, Compass } from 'lucide-react'
import type { SatellitePosition } from '@/lib/types'

export default function TrackingHUD() {
  const { satellites, lockedId, setLockedId, timelineOffset } = useSatelliteStore()
  const [pos, setPos] = useState<SatellitePosition | null>(null)

  const locked = satellites.find((s) => s.noradId === lockedId)

  useEffect(() => {
    if (!locked) return

    const update = () => {
      const now = new Date(Date.now() + timelineOffset * 60 * 1000)
      const p = getSatellitePosition(locked.line1, locked.line2, now)
      setPos(p)
    }
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [locked, timelineOffset])

  if (!locked || !pos) return null

  const ownerCode = guessOwnerFromName(locked.name)
  const ownerInfo = getOwnerInfo(ownerCode)
  const orbitType = classifyOrbit(pos.alt)
  const period = getOrbitalPeriod(locked.line1, locked.line2)

  return (
    <div className="absolute top-4 right-4 w-72 bg-black/85 backdrop-blur-md border border-intel-cyan/20 rounded-lg overflow-hidden font-mono z-[1000]">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-intel-cyan/10 border-b border-intel-cyan/20">
        <Crosshair size={14} className="text-intel-cyan" />
        <span className="text-intel-cyan text-[10px] font-bold tracking-[0.2em]">
          TRACKING LOCKED
        </span>
        <button
          onClick={() => setLockedId(null)}
          className="ml-auto text-gray-500 hover:text-intel-red transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Satellite name */}
      <div className="px-4 pt-3 pb-2 border-b border-white/5">
        <div className="text-white text-sm font-bold truncate">{locked.name}</div>
        <div className="text-gray-500 text-[10px] mt-0.5">
          {ownerInfo.flag} {ownerInfo.name}
        </div>
      </div>

      {/* Data grid */}
      <div className="px-4 py-3 space-y-2 text-xs">
        <Row icon={<Globe2 size={11} />} label="NORAD ID" value={locked.noradId} />
        <Row icon={<Compass size={11} />} label="ORBIT" value={orbitType} />
        <Row icon={<MapPin size={11} />} label="LATITUDE" value={`${pos.lat.toFixed(4)}°`} />
        <Row icon={<MapPin size={11} />} label="LONGITUDE" value={`${pos.lng.toFixed(4)}°`} />
        <Row
          icon={<Globe2 size={11} />}
          label="ALTITUDE"
          value={`${pos.alt.toFixed(1)} km`}
          highlight
        />
        <Row
          icon={<Gauge size={11} />}
          label="VELOCITY"
          value={`${pos.velocity.toFixed(2)} km/s`}
          highlight
        />
        <Row
          icon={<Gauge size={11} />}
          label="PERIOD"
          value={`${period.toFixed(1)} min`}
        />
      </div>

      {/* Orbit progress */}
      <div className="px-4 pb-3">
        <div className="flex justify-between text-[10px] text-gray-600 mb-1">
          <span>ORBIT PROGRESS</span>
          <span>
            {(((Date.now() % (period * 60000)) / (period * 60000)) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-intel-cyan to-intel-green rounded-full transition-all duration-1000"
            style={{
              width: `${((Date.now() % (period * 60000)) / (period * 60000)) * 100}%`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

function Row({
  icon,
  label,
  value,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-gray-500">
        {icon}
        <span>{label}</span>
      </div>
      <span className={`tabular-nums ${highlight ? 'text-intel-cyan' : 'text-gray-300'}`}>
        {value}
      </span>
    </div>
  )
}
