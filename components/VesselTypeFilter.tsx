'use client'

import { useState } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { ChevronDown, ChevronUp, Filter } from 'lucide-react'

const VESSEL_TYPES = [
  { key: 'military', label: 'MILITARY', emoji: '⚔️', color: '#ff1744' },
  { key: 'cargo', label: 'CARGO', emoji: '📦', color: '#42a5f5' },
  { key: 'tanker', label: 'TANKER', emoji: '🛢️', color: '#ff7043' },
  { key: 'passenger', label: 'PASSENGER', emoji: '🛳️', color: '#66bb6a' },
  { key: 'fishing', label: 'FISHING', emoji: '🎣', color: '#fdd835' },
  { key: 'tug', label: 'TUG', emoji: '⚓', color: '#ab47bc' },
  { key: 'high speed', label: 'HIGH SPD', emoji: '⚡', color: '#e91e63' },
  { key: 'sar', label: 'SAR', emoji: '🆘', color: '#76ff03' },
  { key: 'research', label: 'RESEARCH', emoji: '🔬', color: '#00bcd4' },
  { key: 'unknown', label: 'OTHER', emoji: '🚢', color: '#78909c' },
]

export default function VesselTypeFilter() {
  const { vesselTypeFilters, toggleVesselTypeFilter, liveVessels, showVessels } = useSatelliteStore()
  const [isCollapsed, setIsCollapsed] = useState(true)

  if (!showVessels) return null

  const typeCounts: Record<string, number> = {}
  liveVessels.forEach(v => {
    const t = (v.type || 'Unknown').toLowerCase()
    typeCounts[t] = (typeCounts[t] || 0) + 1
  })

  return (
    <div className="absolute top-56 right-3 z-[1000]">
      <div className="bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden backdrop-blur-sm">
        <div
          className="px-3 py-1.5 text-[10px] font-mono tracking-wider border-b border-gray-800/50 flex items-center justify-between cursor-pointer hover:bg-gray-800/30 transition-colors"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="flex items-center gap-1.5">
            <Filter size={10} className="text-blue-400" />
            <span className="text-gray-500">VESSEL FILTER</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-blue-400">{liveVessels.length}</span>
            {isCollapsed ? <ChevronDown size={10} className="text-gray-500" /> : <ChevronUp size={10} className="text-gray-500" />}
          </div>
        </div>
        {!isCollapsed && (
          <div className="flex flex-col max-h-[320px] overflow-y-auto">
            {VESSEL_TYPES.map(({ key, label, emoji, color }) => {
              const active = vesselTypeFilters[key] !== false
              const count = typeCounts[key] || 0
              return (
                <button
                  key={key}
                  onClick={() => toggleVesselTypeFilter(key)}
                  className="flex items-center gap-2 px-2.5 py-1 font-mono text-[10px] tracking-wider transition-all hover:bg-gray-800/50"
                  style={{
                    color: active ? color : '#555',
                    opacity: active ? 1 : 0.5,
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: active ? color : '#333' }}
                  />
                  <span className="flex-shrink-0">{emoji}</span>
                  <span className="flex-1 text-left">{label}</span>
                  <span style={{ color: active ? color : '#444' }}>{count}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}