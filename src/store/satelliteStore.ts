import { create } from 'zustand'
import type { TLESatellite, SatCategory, Quake, EONETEvent, AISVessel } from '@/lib/types'

export interface LiveFlight {
  icao24: string
  callsign: string
  lat: number
  lng: number
  alt: number
  velocity: number
  heading: number
  onGround: boolean
  origin: string
  isMilitary?: boolean
}

export interface FireHotspot {
  lat: number; lng: number; brightness: number; confidence: string; frp: number; date: string
}

export interface LightningStrike {
  lat: number; lng: number; time: number; energy: number
}

export interface AirQualityStation {
  lat: number; lng: number; aqi: number; station: string; time: string
}

export interface ShodanDevice {
  ip: string; port: number; org: string; product: string; os: string
  lat: number; lng: number; country: string; city: string; isp: string
  vulns: string[]; transport: string
}

export interface RadiationSensor {
  lat: number; lng: number; value: number; unit: string; station: string; time: string
}

export interface IntelEvent {
  id: string; title: string; summary?: string; category: string;
  lat: number; lng: number; location_name?: string; country?: string;
  source_url?: string; source_name?: string; event_time: string;
  severity: string; tags?: string[];
}

interface SatelliteStore {
  satellites: TLESatellite[]
  category: SatCategory
  lockedId: string | null
  searchQuery: string
  countryFilter: string | null
  showOrbits: boolean
  showCoverage: boolean
  showJamming: boolean
  showFlights: boolean
  showVessels: boolean
  showSatellites: boolean
  showStations: boolean
  showQuakes: boolean
  showEvents: boolean
  showFires: boolean
  showLightning: boolean
  showAirQuality: boolean
  showShodan: boolean
  showRadiation: boolean
  showWeather: boolean
  activeImageryLayer: string | null
  godsEyeMode: string | null
  timelineOffset: number
  isPlaying: boolean
  countryCounts: Record<string, number>
  sidebarCollapsed: boolean
  quakes: Quake[]
  events: EONETEvent[]
  liveVessels: AISVessel[]
  multiSourceVessels: AISVessel[]
  liveFlights: LiveFlight[]
  vesselTypeFilters: Record<string, boolean>
  fires: FireHotspot[]
  lightning: LightningStrike[]
  airQuality: AirQualityStation[]
  shodanDevices: ShodanDevice[]
  radiation: RadiationSensor[]
  intelEvents: IntelEvent[]

  setSatellites: (sats: TLESatellite[]) => void
  setCategory: (cat: SatCategory) => void
  setLockedId: (id: string | null) => void
  toggleLock: (id: string) => void
  setSearch: (q: string) => void
  setCountryFilter: (code: string | null) => void
  toggleOrbits: () => void
  toggleCoverage: () => void
  toggleJamming: () => void
  toggleFlights: () => void
  toggleVessels: () => void
  toggleSatellites: () => void
  toggleStations: () => void
  toggleQuakes: () => void
  toggleEvents: () => void
  toggleFires: () => void
  toggleLightning: () => void
  toggleAirQuality: () => void
  toggleShodan: () => void
  toggleRadiation: () => void
  toggleWeather: () => void
  setImageryLayer: (id: string | null) => void
  setGodsEyeMode: (id: string | null) => void
  setTimelineOffset: (offset: number) => void
  setIsPlaying: (p: boolean) => void
  setCountryCounts: (c: Record<string, number>) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  setQuakes: (q: Quake[]) => void
  setEvents: (e: EONETEvent[]) => void
  setLiveVessels: (v: AISVessel[]) => void
  setMultiSourceVessels: (v: AISVessel[]) => void
  setLiveFlights: (f: LiveFlight[]) => void
  toggleVesselTypeFilter: (type: string) => void
  setFires: (f: FireHotspot[]) => void
  setLightning: (l: LightningStrike[]) => void
  setAirQuality: (a: AirQualityStation[]) => void
  setShodanDevices: (d: ShodanDevice[]) => void
  setRadiation: (r: RadiationSensor[]) => void
  setIntelEvents: (e: IntelEvent[]) => void
}

export const useSatelliteStore = create<SatelliteStore>()((set) => ({
  satellites: [],
  category: 'active' as SatCategory,
  lockedId: null,
  searchQuery: '',
  countryFilter: null,
  showOrbits: true,
  showCoverage: true,
  showJamming: true,
  showFlights: true,
  showVessels: true,
  showSatellites: true,
  showStations: true,
  showQuakes: true,
  showEvents: true,
  showFires: false,
  showLightning: false,
  showAirQuality: false,
  showShodan: false,
  showRadiation: false,
  showWeather: false,
  activeImageryLayer: null,
  godsEyeMode: null,
  timelineOffset: 0,
  isPlaying: false,
  countryCounts: {} as Record<string, number>,
  sidebarCollapsed: false,
  quakes: [] as Quake[],
  events: [] as EONETEvent[],
  liveVessels: [] as AISVessel[],
  multiSourceVessels: [] as AISVessel[],
  liveFlights: [] as LiveFlight[],
  vesselTypeFilters: {
    military: true, cargo: true, tanker: true, passenger: true,
    fishing: true, tug: true, 'high speed': true, sar: true,
    research: true, pilot: true, unknown: true,
  } as Record<string, boolean>,
  fires: [] as FireHotspot[],
  lightning: [] as LightningStrike[],
  airQuality: [] as AirQualityStation[],
  shodanDevices: [] as ShodanDevice[],
  radiation: [] as RadiationSensor[],
  intelEvents: [] as IntelEvent[],

  setSatellites: (sats: TLESatellite[]) => set({ satellites: sats }),
  setCategory: (cat: SatCategory) => set({ category: cat }),
  setLockedId: (id: string | null) => set({ lockedId: id }),
  toggleLock: (id: string) =>
    set((s) => ({ lockedId: s.lockedId === id ? null : id })),
  setSearch: (q: string) => set({ searchQuery: q }),
  setCountryFilter: (code: string | null) =>
    set((s) => ({ countryFilter: s.countryFilter === code ? null : code })),
  toggleOrbits: () => set((s) => ({ showOrbits: !s.showOrbits })),
  toggleCoverage: () => set((s) => ({ showCoverage: !s.showCoverage })),
  toggleJamming: () => set((s) => ({ showJamming: !s.showJamming })),
  toggleFlights: () => set((s) => ({ showFlights: !s.showFlights })),
  toggleVessels: () => set((s) => ({ showVessels: !s.showVessels })),
  toggleSatellites: () => set((s) => ({ showSatellites: !s.showSatellites })),
  toggleStations: () => set((s) => ({ showStations: !s.showStations })),
  toggleQuakes: () => set((s) => ({ showQuakes: !s.showQuakes })),
  toggleEvents: () => set((s) => ({ showEvents: !s.showEvents })),
  toggleFires: () => set((s) => ({ showFires: !s.showFires })),
  toggleLightning: () => set((s) => ({ showLightning: !s.showLightning })),
  toggleAirQuality: () => set((s) => ({ showAirQuality: !s.showAirQuality })),
  toggleShodan: () => set((s) => ({ showShodan: !s.showShodan })),
  toggleRadiation: () => set((s) => ({ showRadiation: !s.showRadiation })),
  toggleWeather: () => set((s) => ({ showWeather: !s.showWeather })),
  setImageryLayer: (id: string | null) =>
    set((s) => ({ activeImageryLayer: s.activeImageryLayer === id ? null : id })),
  setGodsEyeMode: (id: string | null) =>
    set((s) => ({ godsEyeMode: s.godsEyeMode === id ? null : id })),
  setTimelineOffset: (offset: number) => set({ timelineOffset: offset }),
  setIsPlaying: (p: boolean) => set({ isPlaying: p }),
  setCountryCounts: (c: Record<string, number>) => set({ countryCounts: c }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
  setQuakes: (q: Quake[]) => set({ quakes: q }),
  setEvents: (e: EONETEvent[]) => set({ events: e }),
  setLiveVessels: (v: AISVessel[]) => set({ liveVessels: v }),
  setMultiSourceVessels: (v: AISVessel[]) => set({ multiSourceVessels: v }),
  setLiveFlights: (f: LiveFlight[]) => set({ liveFlights: f }),
  toggleVesselTypeFilter: (type: string) =>
    set((s) => ({
      vesselTypeFilters: { ...s.vesselTypeFilters, [type]: !s.vesselTypeFilters[type] },
    })),
  setFires: (f: FireHotspot[]) => set({ fires: f }),
  setLightning: (l: LightningStrike[]) => set({ lightning: l }),
  setAirQuality: (a: AirQualityStation[]) => set({ airQuality: a }),
  setShodanDevices: (d: ShodanDevice[]) => set({ shodanDevices: d }),
  setRadiation: (r: RadiationSensor[]) => set({ radiation: r }),
  setIntelEvents: (e: IntelEvent[]) => set({ intelEvents: e }),
}))
