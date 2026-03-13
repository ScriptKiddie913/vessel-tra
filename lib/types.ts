export interface TLESatellite {
  name: string
  line1: string
  line2: string
  noradId: string
}

export interface SatellitePosition {
  lat: number
  lng: number
  alt: number
  velocity: number
}

export interface SatelliteWithPosition extends TLESatellite {
  position: SatellitePosition | null
  ownerCode: string
  ownerName: string
  orbitType: string
  category: string
}

export interface CountryInfo {
  code: string
  name: string
  flag: string
  count: number
  color: string
}

export interface JammingZone {
  id: string
  name: string
  center: [number, number]
  radiusKm: number
  type: string
  severity: 'high' | 'medium' | 'low'
  active: boolean
  source?: string
}

export interface GIBSLayer {
  id: string
  name: string
  url: string
  resolution: string
  updateRate: string
  maxZoom: number
}

export interface AISVessel {
  id: string
  name: string
  type: string
  lat: number
  lng: number
  course: number
  speed: number
  flag: string
}

export interface ADSBFlight {
  id: string
  callsign: string
  type: string
  path: [number, number][]
  diverted: boolean
}

export interface GroundStation {
  name: string
  lat: number
  lng: number
  type: 'launch' | 'sigint' | 'radar' | 'dsn'
  flag: string
}

export interface Quake {
  id: string
  mag: number
  place: string
  time: number
  lng: number
  lat: number
  depth: number
  tsunami?: number
}

export interface EONETEvent {
  id: string
  title: string
  category: string
  lng: number
  lat: number
  date: string | null
}

export interface GodsEyeMode {
  id: string
  label: string
  desc: string
}

export type SatCategory =
  | 'active' | 'stations' | 'starlink' | 'oneweb' | 'iridium' | 'globalstar'
  | 'orbcomm' | 'weather' | 'noaa' | 'goes' | 'gps' | 'glonass' | 'galileo'
  | 'beidou' | 'gnss' | 'military' | 'science' | 'resource' | 'geo' | 'amateur'
  | 'cubesat' | 'planet' | 'spire' | 'radar' | 'intelsat' | 'ses' | 'telesat'
  | 'tdrss' | 'sarsat' | 'molniya' | 'education' | 'engineering' | 'geodetic'
  | 'visual' | 'tle-new' | 'debris' | 'argos' | 'dmc' | 'satnogs' | 'x-comm'
