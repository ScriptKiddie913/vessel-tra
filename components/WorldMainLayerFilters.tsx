import { useMemo, useState } from 'react'
import { Layers, ChevronDown, ChevronUp, Link2 } from 'lucide-react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { WORLD_MAIN_LAYER_FILTERS, type WorldMainLayerId } from '@/lib/world-main-catalog'
import { probeWorldMainEndpoints } from '@/lib/world-main-endpoint'

type ProbeState = {
  status: 'idle' | 'loading' | 'ok' | 'error'
  count?: number
}

export default function WorldMainLayerFilters() {
  const [open, setOpen] = useState(false)
  const [remoteToggles, setRemoteToggles] = useState<Record<string, boolean>>({})
  const [probes, setProbes] = useState<Record<string, ProbeState>>({})

  const store = useSatelliteStore()

  const storeMap = useMemo(() => ({
    earthquakes: { active: store.showQuakes, toggle: store.toggleQuakes },
    fires: { active: store.showFires, toggle: store.toggleFires },
    disasters: { active: store.showEvents, toggle: store.toggleEvents },
    aviation: { active: store.showFlights, toggle: store.toggleFlights },
    ships: { active: store.showVessels, toggle: store.toggleVessels },
    satellites: { active: store.showSatellites, toggle: store.toggleSatellites },
    weather: { active: store.showWeather, toggle: store.toggleWeather },
  }), [
    store.showQuakes,
    store.showFires,
    store.showEvents,
    store.showFlights,
    store.showVessels,
    store.showSatellites,
    store.showWeather,
    store.toggleQuakes,
    store.toggleFires,
    store.toggleEvents,
    store.toggleFlights,
    store.toggleVessels,
    store.toggleSatellites,
    store.toggleWeather,
  ])

  const onLayerClick = async (id: WorldMainLayerId, endpoints: string[], integrated: boolean) => {
    if (integrated && storeMap[id as keyof typeof storeMap]) {
      storeMap[id as keyof typeof storeMap].toggle()
      return
    }

    setRemoteToggles((prev: Record<string, boolean>) => ({ ...prev, [id]: !prev[id] }))
    setProbes((prev: Record<string, ProbeState>) => ({ ...prev, [id]: { status: 'loading' } }))
    const result = await probeWorldMainEndpoints(endpoints)
    setProbes((prev: Record<string, ProbeState>) => ({
      ...prev,
      [id]: result.ok
        ? { status: 'ok', count: result.count }
        : { status: 'error' },
    }))
  }

  const activeCount = WORLD_MAIN_LAYER_FILTERS.filter((layer) => {
    if (layer.integrated && storeMap[layer.id as keyof typeof storeMap]) {
      return storeMap[layer.id as keyof typeof storeMap].active
    }
    return !!remoteToggles[layer.id]
  }).length

  return (
    <div className="absolute top-32 right-3 z-[1000] font-mono">
      <div className="bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden backdrop-blur-sm w-80">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40 transition-colors"
        >
          <Layers size={12} className="text-cyan-400" />
          <span className="text-[10px] tracking-wider text-cyan-300 flex-1">WORLD-MAIN LAYER FILTERS</span>
          <span className="text-[9px] text-gray-400">{activeCount}/{WORLD_MAIN_LAYER_FILTERS.length}</span>
          {open ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
        </button>

        {open && (
          <div className="max-h-72 overflow-y-auto border-t border-gray-800/60 p-1.5 grid grid-cols-2 gap-1">
            {WORLD_MAIN_LAYER_FILTERS.map((layer) => {
              const integratedState = layer.integrated && storeMap[layer.id as keyof typeof storeMap]
                ? storeMap[layer.id as keyof typeof storeMap].active
                : false
              const isActive = integratedState || !!remoteToggles[layer.id]
              const probe = probes[layer.id]

              return (
                <button
                  key={layer.id}
                  onClick={() => onLayerClick(layer.id, layer.endpoints, layer.integrated)}
                  className={`text-[9px] px-2 py-1.5 rounded border transition-all text-left ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-400/40'
                      : 'bg-black/30 text-gray-400 border-gray-700/40 hover:text-gray-200'
                  }`}
                  title={`${layer.label} -> ${layer.endpoints.join(' | ')}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{layer.label}</span>
                    {!layer.integrated && <Link2 size={9} className="text-gray-500" />}
                  </div>
                  <div className="mt-1 text-[8px] text-gray-500 truncate">{layer.endpoints.join(' | ')}</div>
                  {probe?.status === 'loading' && <div className="mt-1 text-[8px] text-amber-400">checking endpoint...</div>}
                  {probe?.status === 'ok' && <div className="mt-1 text-[8px] text-emerald-400">count: {probe.count ?? 0}</div>}
                  {probe?.status === 'error' && <div className="mt-1 text-[8px] text-red-400">endpoint unavailable</div>}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
