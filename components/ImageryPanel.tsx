'use client'

import { useSatelliteStore } from '@/src/store/satelliteStore'
import { GIBS_LAYERS } from '@/lib/gibs-layers'
import { Layers, Satellite } from 'lucide-react'
import { useState } from 'react'

export default function ImageryPanel() {
  const { activeImageryLayer, setImageryLayer } = useSatelliteStore()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="absolute top-4 right-80 z-[1000] font-mono">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
          isOpen || activeImageryLayer
            ? 'bg-intel-purple/20 text-intel-purple border border-intel-purple/30'
            : 'bg-black/70 text-gray-400 border border-intel-border hover:text-white'
        }`}
      >
        <Layers size={14} />
        <span className="text-[10px] tracking-wider">NASA GIBS</span>
      </button>

      {isOpen && (
        <div className="mt-2 w-64 bg-black/90 backdrop-blur-md border border-intel-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-intel-border flex items-center gap-2">
            <Satellite size={12} className="text-intel-purple" />
            <span className="text-intel-purple text-[10px] font-bold tracking-[0.15em]">
              EARTH OBSERVATION
            </span>
          </div>

          <div className="p-2 space-y-0.5">
            {/* None option */}
            <button
              onClick={() => setImageryLayer(null)}
              className={`w-full px-3 py-2 rounded text-left text-xs transition-all ${
                !activeImageryLayer
                  ? 'bg-intel-purple/15 text-intel-purple'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              <div className="font-bold text-[10px]">BASE MAP ONLY</div>
              <div className="text-[9px] text-gray-600 mt-0.5">
                ESRI World Imagery
              </div>
            </button>

            {GIBS_LAYERS.map((layer) => (
              <button
                key={layer.id}
                onClick={() => setImageryLayer(layer.id)}
                className={`w-full px-3 py-2 rounded text-left text-xs transition-all ${
                  activeImageryLayer === layer.id
                    ? 'bg-intel-purple/15 text-intel-purple border border-intel-purple/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                <div className="font-bold text-[10px]">{layer.name}</div>
                <div className="text-[9px] text-gray-600 mt-0.5">
                  {layer.resolution} · {layer.updateRate}
                </div>
              </button>
            ))}
          </div>

          <div className="px-4 py-2 border-t border-intel-border text-[9px] text-gray-600">
            Powered by NASA GIBS WMTS
          </div>
        </div>
      )}
    </div>
  )
}
