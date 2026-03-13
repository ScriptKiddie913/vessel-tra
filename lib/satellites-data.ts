import type { SatCategory } from './types'

const BASE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP='
const FMT = '&FORMAT=tle'

export const TLE_URLS: Record<SatCategory, string> = {
  active: `${BASE}active${FMT}`,
  stations: `${BASE}stations${FMT}`,
  starlink: `${BASE}starlink${FMT}`,
  oneweb: `${BASE}oneweb${FMT}`,
  iridium: `${BASE}iridium${FMT}`,
  globalstar: `${BASE}globalstar${FMT}`,
  orbcomm: `${BASE}orbcomm${FMT}`,
  weather: `${BASE}weather${FMT}`,
  noaa: `${BASE}noaa${FMT}`,
  goes: `${BASE}goes${FMT}`,
  gps: `${BASE}gps-ops${FMT}`,
  glonass: `${BASE}glo-ops${FMT}`,
  galileo: `${BASE}galileo${FMT}`,
  beidou: `${BASE}beidou${FMT}`,
  gnss: `${BASE}gnss${FMT}`,
  military: `${BASE}military${FMT}`,
  science: `${BASE}science${FMT}`,
  resource: `${BASE}resource${FMT}`,
  geo: `${BASE}geo${FMT}`,
  amateur: `${BASE}amateur${FMT}`,
  cubesat: `${BASE}cubesat${FMT}`,
  planet: `${BASE}planet${FMT}`,
  spire: `${BASE}spire${FMT}`,
  radar: `${BASE}radar${FMT}`,
  intelsat: `${BASE}intelsat${FMT}`,
  ses: `${BASE}ses${FMT}`,
  telesat: `${BASE}telesat${FMT}`,
  tdrss: `${BASE}tdrss${FMT}`,
  sarsat: `${BASE}sarsat${FMT}`,
  molniya: `${BASE}molniya${FMT}`,
  education: `${BASE}education${FMT}`,
  engineering: `${BASE}engineering${FMT}`,
  geodetic: `${BASE}geodetic${FMT}`,
  visual: `${BASE}visual${FMT}`,
  'tle-new': `${BASE}tle-new${FMT}`,
  debris: `${BASE}cosmos-2251-debris${FMT}`,
  argos: `${BASE}argos${FMT}`,
  dmc: `${BASE}dmc${FMT}`,
  satnogs: `${BASE}satnogs${FMT}`,
  'x-comm': `${BASE}x-comm${FMT}`,
}

export const CATEGORY_LABELS: Record<SatCategory, string> = {
  active: 'ALL', stations: 'STATIONS', starlink: 'STARLINK', oneweb: 'ONEWEB',
  iridium: 'IRIDIUM', globalstar: 'GLOBALSTAR', orbcomm: 'ORBCOMM', weather: 'WEATHER',
  noaa: 'NOAA', goes: 'GOES', gps: 'GPS', glonass: 'GLONASS', galileo: 'GALILEO',
  beidou: 'BEIDOU', gnss: 'GNSS ALL', military: 'MILITARY', science: 'SCIENCE',
  resource: 'EARTH OBS', geo: 'GEO BELT', amateur: 'AMATEUR', cubesat: 'CUBESAT',
  planet: 'PLANET', spire: 'SPIRE', radar: 'RADAR', intelsat: 'INTELSAT', ses: 'SES',
  telesat: 'TELESAT', tdrss: 'TDRSS', sarsat: 'SARSAT', molniya: 'MOLNIYA',
  education: 'EDU', engineering: 'ENGR', geodetic: 'GEODETIC', visual: 'VISUAL',
  'tle-new': 'NEW LAUNCHES', debris: 'DEBRIS', argos: 'ARGOS', dmc: 'DMC',
  satnogs: 'SATNOGS', 'x-comm': 'X-COMM',
}

// Curated multi-nation satellites — always available as fallback
export const CURATED_SATELLITES = [
  // USA
  { name: 'ISS (ZARYA)', noradId: '25544', ownerCode: 'US', category: 'stations' },
  { name: 'TDRS 13', noradId: '49035', ownerCode: 'US', category: 'communication' },
  { name: 'GPS BIIF-12', noradId: '41328', ownerCode: 'US', category: 'gps' },
  { name: 'NROL-82', noradId: '48500', ownerCode: 'US', category: 'military' },
  // China
  { name: 'BEIDOU-3 M23', noradId: '49808', ownerCode: 'CN', category: 'gps' },
  { name: 'YAOGAN-35A', noradId: '51838', ownerCode: 'CN', category: 'military' },
  { name: 'TIANGONG', noradId: '54216', ownerCode: 'CN', category: 'stations' },
  // Russia
  { name: 'GLONASS-M 58', noradId: '43508', ownerCode: 'RU', category: 'gps' },
  { name: 'COSMOS 2558', noradId: '53328', ownerCode: 'RU', category: 'military' },
  // Europe
  { name: 'GALILEO-FOC FM23', noradId: '48859', ownerCode: 'EU', category: 'gps' },
  { name: 'SENTINEL-2A', noradId: '40697', ownerCode: 'EU', category: 'resource' },
  { name: 'METOP-C', noradId: '43689', ownerCode: 'EU', category: 'weather' },
  // Israel
  { name: 'EROS-C', noradId: '53086', ownerCode: 'IL', category: 'military' },
  { name: 'OFEQ-16', noradId: '49464', ownerCode: 'IL', category: 'military' },
  // France
  { name: 'PLEIADES NEO 3', noradId: '48903', ownerCode: 'FR', category: 'resource' },
  { name: 'CSO-2', noradId: '48259', ownerCode: 'FR', category: 'military' },
  // Germany
  { name: 'SARAH-1', noradId: '56194', ownerCode: 'DE', category: 'military' },
  { name: 'ENMAP', noradId: '52319', ownerCode: 'DE', category: 'science' },
  // South Korea
  { name: 'KOMPSAT-6', noradId: '57251', ownerCode: 'KR', category: 'resource' },
  { name: 'ANASIS-II', noradId: '45830', ownerCode: 'KR', category: 'military' },
  // India
  { name: 'CARTOSAT-3', noradId: '44804', ownerCode: 'IN', category: 'resource' },
  { name: 'GSAT-30', noradId: '45026', ownerCode: 'IN', category: 'communication' },
  { name: 'IRNSS-1I', noradId: '43286', ownerCode: 'IN', category: 'gps' },
  // Turkey
  { name: 'TURKSAT 5B', noradId: '51162', ownerCode: 'TR', category: 'communication' },
  { name: 'GOKTURK-2', noradId: '39030', ownerCode: 'TR', category: 'resource' },
]
