'use client'

import { useState } from 'react'
import { useSatelliteStore } from '@/src/store/satelliteStore'
import {
  ChevronDown, ChevronUp, Plane, Ship, Satellite, Radio, Radar,
  Anchor, Activity, Flame, Cloud, Zap, Globe, Shield, MessageSquare,
  Navigation, Swords, Package, Rocket, Wind, Car, Eye, Cpu,
  Bug, Smartphone, Thermometer, Train, Camera, Signal, Waves,
} from 'lucide-react'

interface IntelCategory {
  id: string
  label: string
  icon: React.ReactNode
  color: string
  storeKey?: string
  toggleKey?: string
  description: string
  sources: string[]
  hasData: boolean
}

export default function IntelligencePanel() {
  const store = useSatelliteStore()
  const [isOpen, setIsOpen] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  const categories: IntelCategory[] = [
    {
      id: 'flights', label: 'AIRCRAFT TRACKING', icon: <Plane size={11} />, color: '#aa44ff',
      storeKey: 'showFlights', toggleKey: 'toggleFlights',
      description: 'Live ADS-B aircraft positions, altitude, heading, speed',
      sources: ['OpenSky Network', 'ADS-B Exchange', 'ADS-B Fi', 'Airplanes Live'],
      hasData: true,
    },
    {
      id: 'vessels', label: 'SHIP / VESSEL TRACKING', icon: <Ship size={11} />, color: '#42a5f5',
      storeKey: 'showVessels', toggleKey: 'toggleVessels',
      description: 'AIS vessel positions, MMSI, speed, destination, cargo type',
      sources: ['AISStream', 'AISHub', 'MarineTraffic', 'VesselFinder'],
      hasData: true,
    },
    {
      id: 'satellites', label: 'SATELLITE TRACKING', icon: <Satellite size={11} />, color: '#00e5ff',
      storeKey: 'showSatellites', toggleKey: 'toggleSatellites',
      description: 'Satellite orbits, footprints, passes, types',
      sources: ['CelesTrak', 'Space-Track'],
      hasData: true,
    },
    {
      id: 'quakes', label: 'EARTHQUAKE MONITORING', icon: <Activity size={11} />, color: '#ff3d3d',
      storeKey: 'showQuakes', toggleKey: 'toggleQuakes',
      description: 'Real-time seismic events, magnitude, epicenter, depth',
      sources: ['USGS Earthquake API'],
      hasData: true,
    },
    {
      id: 'events', label: 'NATURAL EVENTS (EONET)', icon: <Globe size={11} />, color: '#ffee00',
      storeKey: 'showEvents', toggleKey: 'toggleEvents',
      description: 'Wildfires, storms, volcanoes, floods, ice events',
      sources: ['NASA EONET'],
      hasData: true,
    },
    {
      id: 'stations', label: 'GROUND STATIONS', icon: <Radar size={11} />, color: '#ff6600',
      storeKey: 'showStations', toggleKey: 'toggleStations',
      description: 'Launch sites, SIGINT, radar, DSN stations',
      sources: ['CelesTrak', 'OSINT DB'],
      hasData: true,
    },
    {
      id: 'fires', label: 'WILDFIRE MONITORING', icon: <Flame size={11} />, color: '#ff6600',
      storeKey: 'showFires', toggleKey: 'toggleFires',
      description: 'Active fire hotspots from MODIS/VIIRS thermal sensors',
      sources: ['NASA FIRMS'],
      hasData: true,
    },
    {
      id: 'lightning', label: 'LIGHTNING DETECTION', icon: <Zap size={11} />, color: '#ffdd00',
      storeKey: 'showLightning', toggleKey: 'toggleLightning',
      description: 'Real-time lightning strikes, storm intensity',
      sources: ['Blitzortung'],
      hasData: true,
    },
    {
      id: 'airquality', label: 'AIR POLLUTION', icon: <Wind size={11} />, color: '#8bc34a',
      storeKey: 'showAirQuality', toggleKey: 'toggleAirQuality',
      description: 'PM2.5 levels, air quality index, pollution hotspots',
      sources: ['World Air Quality Index (WAQI)'],
      hasData: true,
    },
    {
      id: 'shodan', label: 'SHODAN INTEL', icon: <Cpu size={11} />, color: '#e91e63',
      storeKey: 'showShodan', toggleKey: 'toggleShodan',
      description: 'Internet-connected devices, ICS/SCADA, vulnerabilities',
      sources: ['Shodan.io'],
      hasData: true,
    },
    {
      id: 'radiation', label: 'RADIATION SENSORS', icon: <Thermometer size={11} />, color: '#76ff03',
      storeKey: 'showRadiation', toggleKey: 'toggleRadiation',
      description: 'Environmental radiation monitoring stations',
      sources: ['Radioactive@Home'],
      hasData: true,
    },
    {
      id: 'weather', label: 'WEATHER RADAR', icon: <Cloud size={11} />, color: '#29b6f6',
      storeKey: 'showWeather', toggleKey: 'toggleWeather',
      description: 'Storms, hurricanes, rainfall radar, lightning strikes',
      sources: ['NOAA', 'OpenWeatherMap'],
      hasData: true,
    },
    {
      id: 'radio', label: 'RADIO SIGNAL MONITORING', icon: <Radio size={11} />, color: '#ff9800',
      description: 'Aviation radio, maritime radio, military frequencies',
      sources: ['WebSDR'],
      hasData: false,
    },
    {
      id: 'adsb_ground', label: 'ADS-B GROUND RADAR', icon: <Radar size={11} />, color: '#ab47bc',
      description: 'Flight paths, airport arrivals, aircraft ownership',
      sources: ['FlightAware'],
      hasData: false,
    },
    {
      id: 'ais_coastal', label: 'AIS COASTAL SENSORS', icon: <Anchor size={11} />, color: '#0097a7',
      description: 'Port arrival/departure, illegal ship activity',
      sources: ['Coast Guard AIS'],
      hasData: false,
    },
    {
      id: 'internet', label: 'INTERNET INFRASTRUCTURE', icon: <Globe size={11} />, color: '#f44336',
      description: 'Internet outages, BGP hijacks, traffic disruptions',
      sources: ['Cloudflare', 'RIPE Atlas', 'BGPStream'],
      hasData: false,
    },
    {
      id: 'cyber', label: 'CYBER ATTACK MONITORING', icon: <Shield size={11} />, color: '#d32f2f',
      description: 'Malware campaigns, botnet activity, DDoS attacks',
      sources: ['Honeypots', 'Threat Intel Feeds'],
      hasData: false,
    },
    {
      id: 'socmedia', label: 'SOCIAL MEDIA INTEL', icon: <MessageSquare size={11} />, color: '#1da1f2',
      description: 'Breaking events, protests, war zones, public sentiment',
      sources: ['Twitter/X', 'Reddit', 'Telegram', 'TikTok'],
      hasData: false,
    },
    {
      id: 'transit', label: 'PUBLIC TRANSIT', icon: <Train size={11} />, color: '#4caf50',
      description: 'Buses, trains, metro systems via GTFS',
      sources: ['GTFS Realtime Feeds'],
      hasData: false,
    },
    {
      id: 'military', label: 'MILITARY ACTIVITY', icon: <Swords size={11} />, color: '#ff1744',
      description: 'Military aircraft, naval fleets, exercises',
      sources: ['ADS-B', 'AIS', 'Satellite Imagery'],
      hasData: true, // piggybacks on flight/vessel military filtering
    },
    {
      id: 'shipping', label: 'GLOBAL SHIPPING TRADE', icon: <Package size={11} />, color: '#ff7043',
      description: 'Oil tankers, cargo shipping, port congestion',
      sources: ['AIS Data', 'MarineTraffic'],
      hasData: true, // uses vessel data
    },
    {
      id: 'space', label: 'SPACE LAUNCH MONITORING', icon: <Rocket size={11} />, color: '#e040fb',
      description: 'Rocket launches, trajectories, landings',
      sources: ['SpaceX', 'Launch Library'],
      hasData: false,
    },
    {
      id: 'traffic', label: 'GLOBAL TRAFFIC', icon: <Car size={11} />, color: '#ffc107',
      description: 'Road congestion, accidents, traffic flow',
      sources: ['GPS Fleets', 'Mobile Signals'],
      hasData: false,
    },
    {
      id: 'darkweb', label: 'DARK WEB MONITORING', icon: <Eye size={11} />, color: '#880e4f',
      description: 'Leaked databases, ransomware groups, marketplaces',
      sources: ['Onion Sites', 'Scraping Tools'],
      hasData: false,
    },
    {
      id: 'drones', label: 'DRONE DETECTION', icon: <Navigation size={11} />, color: '#00bfa5',
      description: 'Drone flights, IDs, locations via RF scanners',
      sources: ['RF Scanners', 'Remote ID'],
      hasData: false,
    },
    {
      id: 'wildlife', label: 'WILDLIFE TRACKING', icon: <Bug size={11} />, color: '#689f38',
      description: 'Migration patterns, tagged animals',
      sources: ['Satellite Collars', 'Ocean Buoys'],
      hasData: false,
    },
    {
      id: 'finance', label: 'FINANCIAL MARKETS', icon: <Activity size={11} />, color: '#ffd600',
      description: 'Stock markets, commodities, crypto transactions',
      sources: ['Public Blockchain', 'Stock Exchanges'],
      hasData: false,
    },
    {
      id: 'energy', label: 'ENERGY INFRASTRUCTURE', icon: <Zap size={11} />, color: '#ff9100',
      description: 'Power plants, pipelines, energy grid outages',
      sources: ['Public Energy Data'],
      hasData: false,
    },
    {
      id: 'cameras', label: 'PUBLIC CAMERA FEEDS', icon: <Camera size={11} />, color: '#b0bec5',
      description: 'City traffic, port, and airport cameras',
      sources: ['Public Webcams'],
      hasData: false,
    },
    {
      id: 'cellular', label: 'CELLULAR NETWORK MAP', icon: <Smartphone size={11} />, color: '#26c6da',
      description: 'Cell towers, signal coverage, carriers',
      sources: ['OpenCellID', 'Crowdsourced'],
      hasData: false,
    },
    {
      id: 'sensors', label: 'GLOBAL SENSOR NETWORKS', icon: <Waves size={11} />, color: '#00e676',
      description: 'Radiation, environmental, ocean buoy sensors',
      sources: ['Environmental Agencies'],
      hasData: false,
    },
    {
      id: 'gps', label: 'GPS PUBLIC ASSETS', icon: <Signal size={11} />, color: '#64ffda',
      description: 'Buses, trains, delivery fleets via GPS',
      sources: ['GTFS Transit Feeds'],
      hasData: false,
    },
  ]

  const activeCount = categories.filter(c => {
    if (!c.storeKey) return false
    return (store as any)[c.storeKey]
  }).length

  const handleToggle = (cat: IntelCategory) => {
    if (cat.toggleKey && (store as any)[cat.toggleKey]) {
      (store as any)[cat.toggleKey]()
    }
  }

  return (
    <div className="absolute top-14 left-3 z-[1001] font-mono" style={{ maxHeight: 'calc(100vh - 160px)' }}>
      <div className="bg-gray-900/95 border border-gray-700/50 rounded-lg overflow-hidden backdrop-blur-sm" style={{ width: 260 }}>
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-800/30 transition-colors border-b border-gray-800/50"
          onClick={() => setIsOpen(!isOpen)}
        >
          <Shield size={12} className="text-red-400" />
          <span className="text-[11px] text-gray-300 tracking-wider flex-1 font-bold">INTELLIGENCE PANEL</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">{activeCount} ACTIVE</span>
          {isOpen ? <ChevronUp size={12} className="text-gray-500" /> : <ChevronDown size={12} className="text-gray-500" />}
        </div>

        {isOpen && (
          <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            {categories.map((cat) => {
              const isActive = cat.storeKey ? (store as any)[cat.storeKey] : false
              const isExpanded = expandedSection === cat.id

              return (
                <div key={cat.id} className="border-b border-gray-800/30">
                  <div className="flex items-center">
                    {/* Toggle button */}
                    <button
                      onClick={() => handleToggle(cat)}
                      disabled={!cat.hasData}
                      className="flex items-center gap-1.5 px-2 py-1.5 flex-1 transition-all text-[9px] tracking-wider"
                      style={{
                        background: isActive ? `${cat.color}10` : 'transparent',
                        color: isActive ? cat.color : cat.hasData ? '#888' : '#444',
                        borderLeft: `2px solid ${isActive ? cat.color : 'transparent'}`,
                        opacity: cat.hasData ? 1 : 0.5,
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: isActive ? cat.color : '#333' }} />
                      <span className="flex-shrink-0">{cat.icon}</span>
                      <span className="truncate">{cat.label}</span>
                      {!cat.hasData && <span className="text-[7px] text-gray-600 ml-auto">SOON</span>}
                    </button>
                    {/* Expand info */}
                    <button
                      onClick={() => setExpandedSection(isExpanded ? null : cat.id)}
                      className="px-2 py-1.5 text-gray-600 hover:text-gray-400"
                    >
                      {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="px-3 pb-2 text-[8px] text-gray-500 space-y-1">
                      <div>{cat.description}</div>
                      <div className="flex flex-wrap gap-1">
                        {cat.sources.map(s => (
                          <span key={s} className="px-1 py-0.5 rounded bg-gray-800/50 text-gray-400">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
