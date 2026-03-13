import type { JammingZone, AISVessel, ADSBFlight, GroundStation, GodsEyeMode } from './types'

export const JAMMING_ZONES: JammingZone[] = [
  // India-relevant jamming zones
  { id: 'jam1', name: 'Ladakh / LAC', center: [34.5, 78.0], radiusKm: 200, type: 'GPS/BeiDou', severity: 'high', active: true, source: 'PLA Strategic Support Force' },
  { id: 'jam2', name: 'Aksai Chin', center: [35.0, 79.5], radiusKm: 250, type: 'GPS/GNSS', severity: 'high', active: true, source: 'PLA Western Theatre' },
  { id: 'jam3', name: 'Arunachal / McMahon Line', center: [28.0, 94.0], radiusKm: 180, type: 'GPS/GNSS', severity: 'high', active: true, source: 'PLA Eastern Theatre' },
  { id: 'jam4', name: 'LoC Kashmir', center: [34.0, 74.0], radiusKm: 120, type: 'GPS', severity: 'medium', active: true, source: 'Pakistan Army EW' },
  { id: 'jam5', name: 'South China Sea (Spratly)', center: [10.0, 114.0], radiusKm: 300, type: 'AIS/GPS', severity: 'high', active: true, source: 'PLA Navy' },
  { id: 'jam6', name: 'Gwadar / Makran Coast', center: [25.1, 62.3], radiusKm: 150, type: 'GPS/AIS', severity: 'medium', active: true, source: 'PLA Navy / Pakistan Navy' },
  { id: 'jam7', name: 'Eastern Mediterranean', center: [35.0, 34.0], radiusKm: 350, type: 'GPS/GNSS', severity: 'high', active: true, source: 'Russian EW' },
  { id: 'jam8', name: 'Black Sea / Crimea', center: [44.5, 33.5], radiusKm: 280, type: 'GPS/GNSS', severity: 'high', active: true, source: 'Russian EW' },
  { id: 'jam9', name: 'Strait of Hormuz', center: [26.5, 56.0], radiusKm: 200, type: 'GPS/AIS', severity: 'medium', active: true, source: 'IRGC' },
  { id: 'jam10', name: 'Taiwan Strait', center: [24.5, 119.5], radiusKm: 120, type: 'GPS/AIS', severity: 'medium', active: true, source: 'PLA' },
  { id: 'jam11', name: 'Red Sea / Yemen Coast', center: [14.0, 42.5], radiusKm: 180, type: 'GPS/AIS', severity: 'high', active: true, source: 'Houthi forces' },
  { id: 'jam12', name: 'Northern Syria', center: [36.2, 37.1], radiusKm: 150, type: 'GPS', severity: 'high', active: true, source: 'Multiple' },
  { id: 'jam13', name: 'Djibouti / PLA Base', center: [11.5, 43.1], radiusKm: 80, type: 'GPS', severity: 'medium', active: true, source: 'PLA Support Base' },
  { id: 'jam14', name: 'Coco Islands (Myanmar)', center: [14.1, 93.4], radiusKm: 60, type: 'SIGINT/GPS', severity: 'medium', active: true, source: 'Chinese SIGINT facility' },
]

export const ADSB_FLIGHTS: ADSBFlight[] = [
  { id: 'UAL234', callsign: 'UAL234', type: 'commercial', path: [[40.64, -73.78], [41.5, -60], [45, -40], [48, -20], [50, -5], [51.47, -0.45]], diverted: false },
  { id: 'THY718', callsign: 'THY718', type: 'commercial', path: [[41.26, 28.74], [40.5, 30], [39, 32], [37.5, 35.5], [35, 38], [33.8, 35.5]], diverted: true },
  { id: 'RSD401', callsign: 'RSD401', type: 'military', path: [[55.97, 37.41], [54, 35], [52, 33], [50, 33.5], [48, 34], [45, 33.5]], diverted: false },
  { id: 'SIA21', callsign: 'SIA21', type: 'commercial', path: [[1.36, 103.99], [5, 100], [10, 95], [15, 88], [20, 82], [25.25, 55.36]], diverted: false },
  { id: 'AIC101', callsign: 'AIC101', type: 'commercial', path: [[28.56, 77.08], [25, 72], [22, 68], [18, 63], [14, 58], [10, 55]], diverted: false },
  { id: 'IAF001', callsign: 'IAF-SUKHOI', type: 'military', path: [[34.0, 74.8], [33.5, 75.5], [33.0, 76.2], [32.5, 77.0], [32.0, 77.8]], diverted: false },
]

// All vessel data is now sourced LIVE from AISStream WebSocket — no demo/static data
export const AIS_VESSELS: AISVessel[] = []

export const GROUND_STATIONS: GroundStation[] = [
  // India
  { name: 'Satish Dhawan SHAR (ISRO)', lat: 13.720, lng: 80.230, type: 'launch', flag: '🇮🇳' },
  { name: 'ISTRAC Bangalore', lat: 12.970, lng: 77.594, type: 'dsn', flag: '🇮🇳' },
  { name: 'INS Kadamba (Karwar)', lat: 14.815, lng: 74.121, type: 'sigint', flag: '🇮🇳' },
  { name: 'Visakhapatnam Naval (ENC)', lat: 17.686, lng: 83.218, type: 'sigint', flag: '🇮🇳' },
  { name: 'Port Blair (ANC)', lat: 11.680, lng: 92.720, type: 'radar', flag: '🇮🇳' },
  { name: 'Leh Air Force Station', lat: 34.136, lng: 77.546, type: 'radar', flag: '🇮🇳' },
  { name: 'Ambala Air Force Station', lat: 30.370, lng: 76.817, type: 'radar', flag: '🇮🇳' },
  { name: 'IFC-IOR (Gurugram)', lat: 28.459, lng: 77.026, type: 'sigint', flag: '🇮🇳' },
  { name: 'NTRO HQ (Delhi)', lat: 28.620, lng: 77.220, type: 'sigint', flag: '🇮🇳' },
  { name: 'Tezpur Air Force Station', lat: 26.709, lng: 92.787, type: 'radar', flag: '🇮🇳' },
  { name: 'Thanjavur Air Force Station', lat: 10.722, lng: 79.101, type: 'radar', flag: '🇮🇳' },
  { name: 'INS Rajali (Arakkonam)', lat: 13.070, lng: 79.680, type: 'radar', flag: '🇮🇳' },

  // Adversary / Watch
  { name: 'Gwadar Port (CPEC)', lat: 25.126, lng: 62.325, type: 'sigint', flag: '🇵🇰' },
  { name: 'Hambantota Port (Chinese)', lat: 6.118, lng: 81.107, type: 'sigint', flag: '🇱🇰' },
  { name: 'PLA Djibouti Base', lat: 11.548, lng: 43.146, type: 'sigint', flag: '🇨🇳' },
  { name: 'Coco Islands (SIGINT)', lat: 14.100, lng: 93.365, type: 'sigint', flag: '🇲🇲' },

  // Other major
  { name: 'Cape Canaveral SLC', lat: 28.562, lng: -80.577, type: 'launch', flag: '🇺🇸' },
  { name: 'Baikonur Cosmodrome', lat: 45.965, lng: 63.305, type: 'launch', flag: '🇷🇺' },
  { name: 'Jiuquan SLC (China)', lat: 40.958, lng: 100.291, type: 'launch', flag: '🇨🇳' },
  { name: 'Wenchang SLC (China)', lat: 19.614, lng: 110.951, type: 'launch', flag: '🇨🇳' },
  { name: 'Diego Garcia (US Naval)', lat: -7.316, lng: 72.411, type: 'sigint', flag: '🇺🇸' },
  { name: 'Pine Gap (SIGINT)', lat: -23.799, lng: 133.737, type: 'sigint', flag: '🇦🇺' },
  { name: 'Sohae SLS (DPRK)', lat: 39.660, lng: 124.705, type: 'launch', flag: '🇰🇵' },
  { name: 'Semnan Launch Site (Iran)', lat: 35.235, lng: 53.921, type: 'launch', flag: '🇮🇷' },
]

export const GODS_EYE_MODES: GodsEyeMode[] = [
  { id: 's2hd', label: 'TRUE COLOR HD', desc: 'Sentinel-2 Cloudless 10m Resolution' },
  { id: 'ndvi', label: 'NDVI', desc: 'MODIS 8-Day Vegetation Index 250m' },
  { id: 'fires_hd', label: 'ACTIVE FIRES', desc: 'VIIRS 375m Thermal Anomalies' },
  { id: 'night_hd', label: 'NIGHT LIGHTS', desc: 'VIIRS Day/Night Band' },
]
