import { useEffect, useCallback, useState } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import { CATEGORY_LABELS } from '@/lib/satellites-data'
import { JAMMING_ZONES, AIS_VESSELS, GROUND_STATIONS, GODS_EYE_MODES } from '@/lib/intel-data'
import { parseTLEText } from '@/lib/tle-parser'
import { TLE_URLS } from '@/lib/satellites-data'
import { useAISStream } from '@/lib/useAISStream'
import SatellitePanel from '@/components/SatellitePanel'
import TrackingHUD from '@/components/TrackingHUD'
import Timeline from '@/components/Timeline'
import CountryDashboard from '@/components/CountryDashboard'
import ImageryPanel from '@/components/ImageryPanel'
import LayerToggles from '@/components/LayerToggles'
import IntelMap from '@/components/IntelMap'
import IntelAI from '@/components/IntelAI'
import ThreatAlerts from '@/components/ThreatAlerts'
import VesselTypeFilter from '@/components/VesselTypeFilter'
import type { SatCategory } from '@/lib/types'
import type { LiveFlight } from '@/src/store/satelliteStore'

const SUPABASE_PROJECT_ID = 'czbfzqegmwmglahhilio'
const SUPABASE_BASE = `https://${SUPABASE_PROJECT_ID}.supabase.co`
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN6YmZ6cWVnbXdtZ2xhaGhpbGlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NzI0NjcsImV4cCI6MjA4ODU0ODQ2N30.eqq0C19uy6MUlTrnmhWp81zyptAV9kpLKdGtcrFZsx4'

function useOSINTLayer(layer: string, setter: (data: any) => void, dataKey: string, enabled: boolean, interval = 60000) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const url = `${SUPABASE_BASE}/functions/v1/osint-aggregator`
    const fetchData = async () => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({ layer }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data[dataKey]) setter(data[dataKey])
      } catch {}
    }
    fetchData()
    const iv = setInterval(fetchData, interval)
    return () => { cancelled = true; clearInterval(iv) }
  }, [enabled, layer, setter, dataKey, interval])
}

export default function App() {
  const {
    category, setCategory, setSatellites, satellites,
    showSatellites, toggleSatellites,
    showVessels, toggleVessels,
    showFlights, toggleFlights,
    showStations, toggleStations,
    showQuakes, toggleQuakes,
    showEvents, toggleEvents,
    showFires, showLightning, showAirQuality, showShodan, showRadiation,
    godsEyeMode, setGodsEyeMode,
    sidebarCollapsed, toggleSidebar,
    setQuakes, setEvents,
    liveVessels,
    setMultiSourceVessels, multiSourceVessels,
    setLiveFlights, liveFlights,
    setFires, setLightning, setAirQuality, setShodanDevices, setRadiation,
    setIntelEvents, intelEvents,
    quakes, events, fires, shodanDevices,
  } = useSatelliteStore()

  useAISStream()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'sat' | 'ship'>('sat')
  const [worldOverlayOpen, setWorldOverlayOpen] = useState(true)
  const [worldOverlayMinimized, setWorldOverlayMinimized] = useState(false)
  const [worldOverlaySrc, setWorldOverlaySrc] = useState('/world-main/static/index.html')

  const worldPages = [
    { id: 'wm-main', label: 'WORLD OPS', src: '/world-main/static/index.html' },
    { id: 'wm-apt', label: 'APT BOARD', src: '/world-main/apt.html' },
    { id: 'wm-malware', label: 'MALWARE', src: '/world-main/malware.html' },
    { id: 'wm-netgraph', label: 'NETGRAPH', src: '/world-main/netgraph.html' },
    { id: 'wm-samples', label: 'SAMPLES', src: '/world-main/samples.html' },
  ] as const

  // Fetch TLE data via edge function proxy
  const fetchTLE = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${SUPABASE_BASE}/functions/v1/tle-proxy?category=${category}`, {
        headers: { 'apikey': SUPABASE_KEY },
        signal: AbortSignal.timeout(50000),
      })
      if (!res.ok) throw new Error(`Proxy ${res.status}`)
      const raw = await res.text()
      const sats = parseTLEText(raw)
      if (sats.length > 0) setSatellites(sats)
      else throw new Error('No satellites parsed')
    } catch (err: any) {
      // Fallback: direct CelesTrak
      try {
        const url = TLE_URLS[category as SatCategory]
        if (url) {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
          if (res.ok) {
            const raw = await res.text()
            const sats = parseTLEText(raw)
            if (sats.length > 0) { setSatellites(sats); setError(null); return }
          }
        }
      } catch {}
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [category, setSatellites])

  useEffect(() => {
    fetchTLE()
    const iv = setInterval(fetchTLE, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [fetchTLE])

  // Fetch quakes + events
  useEffect(() => {
    const fetchQuakes = async () => {
      try {
        const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { signal: AbortSignal.timeout(15000) })
        if (!res.ok) return
        const data = await res.json()
        const q = (data.features || []).slice(0, 200).map((f: any) => {
          const p = f.properties || {}
          const coords = f.geometry?.coordinates || [0, 0, 0]
          return { id: f.id, mag: p.mag, place: p.place, time: p.time, lng: coords[0], lat: coords[1], depth: coords[2], tsunami: p.tsunami }
        })
        setQuakes(q)
      } catch {}
    }
    const fetchEvents = async () => {
      try {
        const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80', { signal: AbortSignal.timeout(15000) })
        if (!res.ok) return
        const data = await res.json()
        const ev = (data.events || []).map((e: any) => {
          const geom = e.geometry || [{}]
          const coords = geom.length > 0 ? geom[geom.length - 1].coordinates || [0, 0] : [0, 0]
          const cats = (e.categories || []).map((c: any) => c.title)
          return { id: e.id, title: e.title, category: cats[0] || 'Unknown', lng: coords[0], lat: coords[1], date: geom.length > 0 ? geom[geom.length - 1].date : null }
        })
        setEvents(ev)
      } catch {}
    }
    fetchQuakes(); fetchEvents()
    const iv = setInterval(() => { fetchQuakes(); fetchEvents() }, 10 * 60 * 1000)
    return () => clearInterval(iv)
  }, [setQuakes, setEvents])

  // Live ADS-B flights
  useEffect(() => {
    let cancelled = false
    const fetchADSB = async () => {
      try {
        const res = await fetch(`${SUPABASE_BASE}/functions/v1/flight-tracker`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({ airborne: true }),
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data.flights) return
        const flights: LiveFlight[] = data.flights.slice(0, 5000).map((f: any) => ({
          icao24: f.icao24, callsign: f.callsign, lat: f.lat, lng: f.lng,
          alt: f.alt, velocity: f.velocity, heading: f.heading,
          onGround: f.onGround, origin: f.origin, isMilitary: f.isMilitary || false,
        }))
        setLiveFlights(flights)
      } catch {}
    }
    fetchADSB()
    const iv = setInterval(fetchADSB, 15000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [setLiveFlights])

  // OSINT layers
  useOSINTLayer('firms', setFires, 'fires', showFires, 120000)
  useOSINTLayer('lightning', setLightning, 'strikes', showLightning, 30000)
  useOSINTLayer('airquality', setAirQuality, 'stations', showAirQuality, 300000)
  useOSINTLayer('shodan', setShodanDevices, 'devices', showShodan, 120000)
  useOSINTLayer('radiation', setRadiation, 'sensors', showRadiation, 120000)

  // AI News Scanner → geocoded intel events
  useEffect(() => {
    let cancelled = false
    const NEWS_GEO_URL = `${SUPABASE_BASE}/functions/v1/news-geo`
    const scanNews = async () => {
      try {
        const res = await fetch(`${NEWS_GEO_URL}?mode=scan`, {
          headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          signal: AbortSignal.timeout(30000),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data.events) setIntelEvents(data.events)
      } catch {}
    }
    const readExisting = async () => {
      try {
        const res = await fetch(`${NEWS_GEO_URL}?mode=read`, {
          headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          const data = await res.json()
          if (!cancelled && data.events) setIntelEvents(data.events)
        }
      } catch {}
    }
    readExisting()
    const scanTimeout = setTimeout(scanNews, 10000)
    const iv = setInterval(scanNews, 5 * 60 * 1000)
    return () => { cancelled = true; clearTimeout(scanTimeout); clearInterval(iv) }
  }, [setIntelEvents])

  const activeJammed = JAMMING_ZONES.filter(z => z.active).length

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-intel-bg">
      {/* Left sidebar */}
      <div
        className="relative flex flex-col border-r border-gray-800/50 bg-intel-bg/95 backdrop-blur-sm z-[1001]"
        style={{ width: sidebarCollapsed ? 0 : 320, minWidth: sidebarCollapsed ? 0 : 320, overflow: 'hidden', transition: 'width 0.3s ease, min-width 0.3s ease' }}
      >
        <SatellitePanel />
      </div>

      <button
        onClick={toggleSidebar}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-[1002] bg-gray-900/90 hover:bg-gray-800 text-gray-400 hover:text-intel-cyan border border-gray-700/50 rounded-r-md px-1 py-3 transition-all"
        style={{ left: sidebarCollapsed ? 0 : 320, transition: 'left 0.3s ease' }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          {sidebarCollapsed
            ? <path d="M4 1l5 5-5 5" stroke="currentColor" strokeWidth="2" fill="none"/>
            : <path d="M8 1l-5 5 5 5" stroke="currentColor" strokeWidth="2" fill="none"/>}
        </svg>
      </button>

      <main className="flex-1 relative overflow-hidden">
        <IntelMap />

        {/* Top center: mode + stats */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3">
          <div className="flex bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden">
            <button onClick={() => { setMode('sat'); if (!showSatellites) toggleSatellites(); if (showVessels) toggleVessels() }}
              className={`px-4 py-1.5 font-mono text-xs tracking-wider transition-all ${mode === 'sat' ? 'bg-intel-cyan/20 text-intel-cyan border-r border-intel-cyan/30' : 'text-gray-500 hover:text-gray-300 border-r border-gray-700/50'}`}
            >SAT</button>
            <button onClick={() => { setMode('ship'); if (!showVessels) toggleVessels(); if (showSatellites) toggleSatellites() }}
              className={`px-4 py-1.5 font-mono text-xs tracking-wider transition-all ${mode === 'ship' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}
            >SHIP</button>
          </div>

          <div className="flex items-center gap-2 bg-gray-900/80 border border-gray-700/40 rounded-lg px-3 py-1.5 font-mono text-[10px]">
            <span className="text-intel-cyan">{satellites.length} SAT</span>
            <span className="text-gray-700">|</span>
            <span className="text-blue-400">{AIS_VESSELS.length + liveVessels.length + multiSourceVessels.length} SHIP</span>
            <span className="text-gray-700">|</span>
            <span className="text-purple-400">{liveFlights.length} FLIGHT</span>
            <span className="text-gray-700">|</span>
            <span className="text-red-400">{quakes.length} QUAKE</span>
            <span className="text-gray-700">|</span>
            <span className="text-yellow-400">{events.length} EVENT</span>
            {fires.length > 0 && <><span className="text-gray-700">|</span><span className="text-orange-400">{fires.length} 🔥</span></>}
            {intelEvents.length > 0 && <><span className="text-gray-700">|</span><span className="text-red-300">{intelEvents.length} INTEL</span></>}
            {activeJammed > 0 && <><span className="text-gray-700">|</span><span className="text-red-500">{activeJammed} JAMMED</span></>}
          </div>
        </div>

        {/* World-main overlay launcher */}
        <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1.5">
          <button
            onClick={() => {
              setWorldOverlayOpen((v) => !v)
              setWorldOverlayMinimized(false)
            }}
            className={`px-3 py-1.5 rounded border font-mono text-[10px] tracking-wider transition-all ${worldOverlayOpen ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300' : 'bg-gray-900/80 border-gray-700/60 text-gray-400 hover:text-gray-200 hover:border-gray-500/70'}`}
          >
            WORLD-MAIN OVERLAY
          </button>
          {worldOverlayOpen && !worldOverlayMinimized && (
            <div className="flex flex-wrap gap-1 max-w-[280px] rounded border border-gray-700/60 bg-gray-950/85 p-1 backdrop-blur-sm">
              {worldPages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => setWorldOverlaySrc(page.src)}
                  className={`px-2 py-1 rounded border font-mono text-[9px] transition-all ${worldOverlaySrc === page.src ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300' : 'border-gray-700/60 bg-gray-900/70 text-gray-500 hover:text-gray-300 hover:border-gray-500/70'}`}
                >
                  {page.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Top right: layer toggles */}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
          {[
            { label: 'SAT', active: showSatellites, toggle: toggleSatellites, color: '#00e5ff' },
            { label: 'SHIP', active: showVessels, toggle: toggleVessels, color: '#42a5f5' },
            { label: 'FLIGHT', active: showFlights, toggle: toggleFlights, color: '#aa44ff' },
            { label: 'STATION', active: showStations, toggle: toggleStations, color: '#ff6600' },
            { label: 'QUAKE', active: showQuakes, toggle: toggleQuakes, color: '#ff3d3d' },
            { label: 'EVENT', active: showEvents, toggle: toggleEvents, color: '#ffee00' },
          ].map(({ label, active, toggle, color }) => (
            <button key={label} onClick={toggle}
              className="flex items-center gap-2 px-2.5 py-1 rounded font-mono text-[10px] tracking-wider transition-all border"
              style={{ background: active ? `${color}15` : 'rgba(0,0,0,0.6)', borderColor: active ? `${color}40` : 'rgba(255,255,255,0.05)', color: active ? color : '#555' }}
            >
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: active ? color : '#333' }} />
              {label}
            </button>
          ))}
        </div>

        {/* God's Eye HD */}
        <div className="absolute top-3 right-32 z-[1000]">
          <div className="bg-gray-900/90 border border-gray-700/50 rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] font-mono text-gray-500 tracking-wider border-b border-gray-800/50">GOD&apos;S EYE HD</div>
            <div className="flex flex-col">
              {GODS_EYE_MODES.map((ge) => (
                <button key={ge.id} onClick={() => setGodsEyeMode(godsEyeMode === ge.id ? null : ge.id)}
                  className={`px-3 py-1 text-left font-mono text-[10px] transition-all ${godsEyeMode === ge.id ? 'bg-purple-500/20 text-purple-300' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}
                >{ge.label}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Overlays - positioned to not overlap */}
        <CountryDashboard />
        <TrackingHUD />
        <ImageryPanel />
        <LayerToggles />
        <VesselTypeFilter />
        <IntelAI />
        <ThreatAlerts />

        {/* Category tab bar */}
        <div className="absolute bottom-20 left-0 right-0 z-[1000]">
          <div className="flex items-center gap-1 px-4 overflow-x-auto scrollbar-hide">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => setCategory(key as any)}
                className={`whitespace-nowrap px-2.5 py-1 rounded font-mono text-[9px] tracking-wider transition-all border ${
                  category === key ? 'bg-intel-cyan/20 text-intel-cyan border-intel-cyan/30' : 'bg-gray-900/60 text-gray-600 border-gray-800/30 hover:text-gray-400 hover:bg-gray-800/40'
                }`}
              >{label}</button>
            ))}
          </div>
        </div>

        {/* Status bar */}
        <div className="absolute bottom-14 left-4 z-[1000] font-mono text-[10px] flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${loading ? 'bg-intel-amber animate-pulse' : satellites.length > 0 ? 'bg-intel-green' : 'bg-intel-red'}`} />
            <span className="text-gray-500">
              {loading ? 'FETCHING TLE...' : error ? `ERROR: ${error}` : `${satellites.length.toLocaleString()} OBJECTS · LIVE SGP4 PROPAGATION`}
            </span>
          </div>
          <span className="text-gray-700">|</span>
          <span className="text-gray-600">MULTI-SOURCE OSINT</span>
        </div>

        {/* World-main overlay panel: additive, does not replace existing map/features */}
        {worldOverlayOpen && (
          <div
            className={`absolute z-[1003] right-3 bottom-20 border border-cyan-500/30 bg-black/80 shadow-2xl backdrop-blur-sm ${worldOverlayMinimized ? 'w-[260px]' : 'w-[48vw] max-w-[900px] min-w-[360px]'} rounded-md overflow-hidden`}
          >
            <div className="flex items-center justify-between px-2 py-1 border-b border-cyan-500/20 bg-cyan-950/30">
              <div className="font-mono text-[10px] tracking-wider text-cyan-300">
                WORLD-MAIN LIVE OVERLAY · PARALLEL MODE
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setWorldOverlayMinimized((v) => !v)}
                  className="px-2 py-0.5 text-[10px] rounded border border-gray-700/70 bg-gray-900/80 text-gray-300 hover:text-cyan-300"
                >
                  {worldOverlayMinimized ? 'EXPAND' : 'MIN'}
                </button>
                <button
                  onClick={() => setWorldOverlayOpen(false)}
                  className="px-2 py-0.5 text-[10px] rounded border border-gray-700/70 bg-gray-900/80 text-gray-300 hover:text-red-300"
                >
                  CLOSE
                </button>
              </div>
            </div>
            {!worldOverlayMinimized && (
              <div className="h-[46vh] bg-black/90">
                <iframe
                  title="world-main-overlay"
                  src={worldOverlaySrc}
                  className="h-full w-full border-0"
                />
              </div>
            )}
          </div>
        )}

        <Timeline />
        <div className="scan-line" />
      </main>
    </div>
  )
}
