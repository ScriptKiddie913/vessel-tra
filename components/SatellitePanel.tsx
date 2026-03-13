'use client'

import { useMemo } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { guessOwnerFromName } from '@/lib/country-map'
import { COUNTRY_LIST } from '@/lib/country-map'
import type { SatCategory } from '@/lib/types'
import { Search, Satellite, Radio, Cloud, Navigation, Shield, FlaskConical, Eye } from 'lucide-react'

const CATEGORIES: { id: SatCategory; label: string; icon: React.ReactNode }[] = [
  { id: 'active', label: 'ALL', icon: <Satellite size={12} /> },
  { id: 'stations', label: 'STATIONS', icon: <Radio size={12} /> },
  { id: 'starlink', label: 'STARLINK', icon: <Satellite size={12} /> },
  { id: 'weather', label: 'WEATHER', icon: <Cloud size={12} /> },
  { id: 'gps', label: 'GPS/NAV', icon: <Navigation size={12} /> },
  { id: 'military', label: 'MILITARY', icon: <Shield size={12} /> },
  { id: 'science', label: 'SCIENCE', icon: <FlaskConical size={12} /> },
  { id: 'resource', label: 'EARTH OBS', icon: <Eye size={12} /> },
]

export default function SatellitePanel() {
  const {
    satellites,
    category,
    searchQuery,
    countryFilter,
    lockedId,
    setCategory,
    setSearch,
    setCountryFilter,
    toggleLock,
  } = useSatelliteStore()

  const filtered = useMemo(() => {
    return satellites.filter((s) => {
      const matchSearch =
        !searchQuery ||
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.noradId.includes(searchQuery)
      const ownerCode = guessOwnerFromName(s.name)
      const matchCountry = !countryFilter || ownerCode === countryFilter
      return matchSearch && matchCountry
    })
  }, [satellites, searchQuery, countryFilter])

  return (
    <aside className="w-80 h-full bg-intel-panel border-r border-intel-border flex flex-col overflow-hidden flex-shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-intel-border">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-intel-green animate-pulse" />
          <h1 className="text-white font-mono font-bold tracking-[0.2em] text-sm">
            SAT-INTEL
          </h1>
        </div>
        <p className="text-gray-600 text-[10px] font-mono mt-1">
          {satellites.length.toLocaleString()} OBJECTS TRACKED · LIVE
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1 p-3 border-b border-intel-border">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono tracking-wider transition-all ${
              category === cat.id
                ? 'bg-intel-cyan/15 text-intel-cyan border border-intel-cyan/30'
                : 'text-gray-600 hover:text-gray-400 border border-transparent'
            }`}
          >
            {cat.icon}
            {cat.label}
          </button>
        ))}
      </div>

      {/* Country filter */}
      <div className="flex flex-wrap gap-1 p-3 border-b border-intel-border">
        {COUNTRY_LIST.map((c) => (
          <button
            key={c.code}
            onClick={() => setCountryFilter(c.code)}
            className={`px-2 py-1 rounded text-[10px] font-mono transition-all ${
              countryFilter === c.code
                ? 'bg-white/10 text-white border border-white/20'
                : 'text-gray-600 hover:text-gray-400 border border-transparent'
            }`}
          >
            {c.flag} {c.code}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="p-3 border-b border-intel-border">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"
          />
          <input
            value={searchQuery}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or NORAD ID..."
            className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 pl-8 text-xs font-mono text-white placeholder-gray-600 focus:outline-none focus:border-intel-cyan/50 transition-colors"
          />
        </div>
        <div className="text-gray-600 text-[10px] font-mono mt-1.5">
          {filtered.length.toLocaleString()} results
        </div>
      </div>

      {/* Satellite list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.slice(0, 300).map((sat) => {
          const isLocked = sat.noradId === lockedId
          return (
            <button
              key={sat.noradId}
              onClick={() => toggleLock(sat.noradId)}
              className={`w-full px-4 py-2.5 text-left transition-colors border-b border-white/[0.03] ${
                isLocked
                  ? 'bg-intel-cyan/10 border-l-2 border-l-intel-cyan'
                  : 'hover:bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    isLocked ? 'bg-intel-cyan animate-pulse' : 'bg-intel-green/50'
                  }`}
                />
                <span className="text-white text-xs font-mono truncate">
                  {sat.name}
                </span>
              </div>
              <div className="text-gray-600 text-[10px] font-mono mt-0.5 pl-3.5">
                NORAD {sat.noradId}
              </div>
            </button>
          )
        })}
        {filtered.length > 300 && (
          <div className="text-center text-gray-600 text-[10px] font-mono py-4">
            +{(filtered.length - 300).toLocaleString()} more — use search to
            narrow
          </div>
        )}
      </div>
    </aside>
  )
}
