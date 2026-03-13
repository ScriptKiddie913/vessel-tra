export type WorldMainLayerId =
  | 'earthquakes'
  | 'fires'
  | 'disasters'
  | 'aviation'
  | 'adsbMilitary'
  | 'vehicleFlow'
  | 'transit'
  | 'traffic'
  | 'cables'
  | 'chokepoints'
  | 'nuclear'
  | 'datacenters'
  | 'boundaries'
  | 'military'
  | 'pipelines'
  | 'ports'
  | 'waterways'
  | 'hotspots'
  | 'conflicts'
  | 'gamma'
  | 'apt'
  | 'ransomwareMap'
  | 'satellites'
  | 'ships'
  | 'breachesMap'
  | 'weather'
  | 'cloud'
  | 'heatmapFires'
  | 'heatmapEQ'

export interface WorldMainLayerFilterDef {
  id: WorldMainLayerId
  label: string
  endpoints: string[]
  integrated: boolean
}

export const WORLD_MAIN_LAYER_FILTERS: WorldMainLayerFilterDef[] = [
  { id: 'earthquakes', label: 'EQ', endpoints: ['/api/earthquakes?window=day'], integrated: true },
  { id: 'fires', label: 'Fires', endpoints: ['/api/fires'], integrated: true },
  { id: 'disasters', label: 'Events', endpoints: ['/api/disasters'], integrated: true },
  { id: 'aviation', label: 'Aviation', endpoints: ['/api/aviation'], integrated: true },
  { id: 'adsbMilitary', label: 'Mil-Air', endpoints: ['/api/adsb_military'], integrated: false },
  { id: 'vehicleFlow', label: 'Vehicle Flow', endpoints: ['/api/osm_roads'], integrated: false },
  { id: 'transit', label: 'Transit', endpoints: ['/api/gtfs/stops'], integrated: false },
  { id: 'traffic', label: 'Traffic', endpoints: ['/api/osm_roads'], integrated: false },
  { id: 'cables', label: 'Cables', endpoints: ['/api/infrastructure/cables'], integrated: false },
  { id: 'chokepoints', label: 'Chokepoints', endpoints: ['/api/infrastructure/chokepoints'], integrated: false },
  { id: 'nuclear', label: 'Nuclear', endpoints: ['/api/infrastructure/nuclear'], integrated: false },
  { id: 'datacenters', label: 'Datacenters', endpoints: ['/api/infrastructure/datacenters'], integrated: false },
  { id: 'boundaries', label: 'Boundaries', endpoints: ['/api/geo/countries'], integrated: false },
  { id: 'military', label: 'Bases', endpoints: ['/api/infrastructure/military-bases'], integrated: false },
  { id: 'pipelines', label: 'Pipelines', endpoints: ['/api/infrastructure/pipelines'], integrated: false },
  { id: 'ports', label: 'Ports', endpoints: ['/api/infrastructure/ports'], integrated: false },
  { id: 'waterways', label: 'Waterways', endpoints: ['/api/geo/waterways'], integrated: false },
  { id: 'hotspots', label: 'Hotspots', endpoints: ['/api/geo/hotspots'], integrated: false },
  { id: 'conflicts', label: 'Conflicts', endpoints: ['/api/geo/conflict-zones'], integrated: false },
  { id: 'gamma', label: 'Gamma', endpoints: ['/api/infrastructure/gamma-irradiators'], integrated: false },
  { id: 'apt', label: 'APT', endpoints: ['/api/geo/apt-groups'], integrated: false },
  { id: 'ransomwareMap', label: 'Ransomware', endpoints: ['/api/threats/ransomware-map'], integrated: false },
  { id: 'satellites', label: 'Satellites', endpoints: ['/api/satellites/tle?group=active', '/api/satellites/iss'], integrated: true },
  { id: 'ships', label: 'Ships', endpoints: ['/api/ais/ships?bbox=-180,-90,180,90&limit=500', '/api/ais/ships/stats'], integrated: true },
  { id: 'breachesMap', label: 'Breaches', endpoints: ['/api/threats/urlhaus'], integrated: false },
  { id: 'weather', label: 'Weather Radar', endpoints: ['/api/weather/radar'], integrated: true },
  { id: 'cloud', label: 'Cloud/IR', endpoints: ['/api/weather/radar'], integrated: false },
  { id: 'heatmapFires', label: 'Heatmap Fires', endpoints: ['/api/fires'], integrated: false },
  { id: 'heatmapEQ', label: 'Heatmap EQ', endpoints: ['/api/earthquakes?window=day'], integrated: false },
]

export interface WorldMainIntelFilterDef {
  id: string
  group: 'news' | 'markets' | 'cyber'
  label: string
  endpoints: string[]
}

export const WORLD_MAIN_INTEL_FILTERS: WorldMainIntelFilterDef[] = [
  { id: 'news-all', group: 'news', label: 'News: All', endpoints: ['/api/news'] },
  { id: 'news-critical', group: 'news', label: 'News: Critical', endpoints: ['/api/news'] },
  { id: 'news-high', group: 'news', label: 'News: High', endpoints: ['/api/news'] },
  { id: 'news-medium', group: 'news', label: 'News: Medium', endpoints: ['/api/news'] },
  { id: 'markets-all', group: 'markets', label: 'Markets: All', endpoints: ['/api/markets/quotes', '/api/markets/crypto', '/api/markets/fear-greed'] },
  { id: 'markets-indices', group: 'markets', label: 'Markets: Indices', endpoints: ['/api/markets/quotes'] },
  { id: 'markets-crypto', group: 'markets', label: 'Markets: Crypto', endpoints: ['/api/markets/crypto'] },
  { id: 'markets-commodities', group: 'markets', label: 'Markets: Commodities', endpoints: ['/api/markets/quotes'] },
  { id: 'markets-fear-greed', group: 'markets', label: 'Markets: Fear/Greed', endpoints: ['/api/markets/fear-greed'] },
  { id: 'cyber-ransomware', group: 'cyber', label: 'Cyber: Ransomware', endpoints: ['/api/threats/ransomware'] },
  { id: 'cyber-c2', group: 'cyber', label: 'Cyber: C2', endpoints: ['/api/threats/feodo'] },
]
