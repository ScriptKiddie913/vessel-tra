'use client'

import { useState } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import {
  Eye,
  EyeOff,
  Radio,
  Plane,
  Ship,
  Orbit,
  Shield,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react'

export default function LayerToggles() {
  const {
    showOrbits,
    showCoverage,
    showJamming,
    showFlights,
    showVessels,
    toggleOrbits,
    toggleCoverage,
    toggleJamming,
    toggleFlights,
    toggleVessels,
  } = useSatelliteStore()
  const [isCollapsed, setIsCollapsed] = useState(true)

  const layers = [
    { label: 'ORBITS', active: showOrbits, toggle: toggleOrbits, icon: <Orbit size={12} />, color: '#00e5ff' },
    { label: 'COVERAGE', active: showCoverage, toggle: toggleCoverage, icon: <Radio size={12} />, color: '#4caf50' },
    { label: 'GPS JAM', active: showJamming, toggle: toggleJamming, icon: <Shield size={12} />, color: '#ff3d3d' },
    { label: 'ADS-B', active: showFlights, toggle: toggleFlights, icon: <Plane size={12} />, color: '#aa44ff' },
    { label: 'AIS', active: showVessels, toggle: toggleVessels, icon: <Ship size={12} />, color: '#ffab00' },
  ]

  const activeCount = layers.filter(l => l.active).length

  return (
    <div className="absolute bottom-16 right-4 z-[1000] font-mono">
      <div className="bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden backdrop-blur-sm">
        <div
          className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-800/30 transition-colors"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <Layers size={10} className="text-gray-400" />
          <span className="text-[10px] text-gray-500 tracking-wider flex-1">LAYERS</span>
          <span className="text-[9px] text-gray-600">{activeCount}/{layers.length}</span>
          {isCollapsed ? <ChevronDown size={10} className="text-gray-500" /> : <ChevronUp size={10} className="text-gray-500" />}
        </div>
        {!isCollapsed && (
          <div className="flex flex-col gap-0.5 p-1">
            {layers.map((l) => (
              <button
                key={l.label}
                onClick={l.toggle}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded transition-all text-[10px] tracking-wider"
                style={{
                  background: l.active ? `${l.color}15` : 'transparent',
                  borderLeft: l.active ? `2px solid ${l.color}` : '2px solid transparent',
                  color: l.active ? l.color : '#666',
                }}
              >
                {l.active ? <Eye size={12} /> : <EyeOff size={12} />}
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}