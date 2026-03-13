import { useMemo, useState } from 'react'
import { Shield, ChevronDown, ChevronUp } from 'lucide-react'
import { WORLD_MAIN_INTEL_FILTERS, type WorldMainIntelFilterDef } from '@/lib/world-main-catalog'
import { probeWorldMainEndpoints } from '@/lib/world-main-endpoint'

type IntelProbe = {
  status: 'idle' | 'loading' | 'ok' | 'error'
  count?: number
}

export default function WorldMainIntelFilters() {
  const [open, setOpen] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>('')
  const [probeMap, setProbeMap] = useState<Record<string, IntelProbe>>({})

  const grouped = useMemo<Array<{ name: 'news' | 'markets' | 'cyber'; filters: WorldMainIntelFilterDef[] }>>(() => ([
    { name: 'news', filters: WORLD_MAIN_INTEL_FILTERS.filter((f) => f.group === 'news') },
    { name: 'markets', filters: WORLD_MAIN_INTEL_FILTERS.filter((f) => f.group === 'markets') },
    { name: 'cyber', filters: WORLD_MAIN_INTEL_FILTERS.filter((f) => f.group === 'cyber') },
  ]), [])

  const applyFilter = async (id: string, endpoints: string[]) => {
    setActiveFilter(id)
    setProbeMap((prev: Record<string, IntelProbe>) => ({ ...prev, [id]: { status: 'loading' } }))
    const result = await probeWorldMainEndpoints(endpoints)
    setProbeMap((prev: Record<string, IntelProbe>) => ({
      ...prev,
      [id]: result.ok
        ? { status: 'ok', count: result.count }
        : { status: 'error' },
    }))
  }

  return (
    <div className="absolute top-[460px] right-3 z-[1000] font-mono">
      <div className="bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden backdrop-blur-sm w-80">
        <button
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/40 transition-colors"
        >
          <Shield size={12} className="text-red-400" />
          <span className="text-[10px] tracking-wider text-red-300 flex-1">WORLD-MAIN INTELLIGENCE FILTERS</span>
          {open ? <ChevronUp size={11} className="text-gray-400" /> : <ChevronDown size={11} className="text-gray-400" />}
        </button>

        {open && (
          <div className="border-t border-gray-800/60 p-2 space-y-2">
            {grouped.map(({ name, filters }: { name: 'news' | 'markets' | 'cyber'; filters: WorldMainIntelFilterDef[] }) => (
              <div key={name}>
                <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">{name}</div>
                <div className="grid grid-cols-2 gap-1">
                  {filters.map((filter: WorldMainIntelFilterDef) => {
                    const probe = probeMap[filter.id]
                    const active = activeFilter === filter.id
                    return (
                      <button
                        key={filter.id}
                        onClick={() => applyFilter(filter.id, filter.endpoints)}
                        className={`text-[9px] px-2 py-1.5 rounded border text-left transition-all ${
                          active
                            ? 'bg-red-500/15 text-red-300 border-red-400/40'
                            : 'bg-black/30 text-gray-400 border-gray-700/40 hover:text-gray-200'
                        }`}
                        title={`${filter.label} -> ${filter.endpoints.join(' | ')}`}
                      >
                        <div className="truncate">{filter.label}</div>
                        <div className="text-[8px] text-gray-500 truncate">{filter.endpoints.join(' | ')}</div>
                        {probe?.status === 'loading' && <div className="text-[8px] text-amber-400">checking endpoint...</div>}
                        {probe?.status === 'ok' && <div className="text-[8px] text-emerald-400">count: {probe.count ?? 0}</div>}
                        {probe?.status === 'error' && <div className="text-[8px] text-red-400">endpoint unavailable</div>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
