import type { GIBSLayer } from './types'

function getGIBSDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 2)
  return d.toISOString().split('T')[0]
}

function getNDVIDate(): string {
  const d = new Date()
  d.setDate(d.getDate() - 10)
  const y = d.getFullYear()
  const m0 = new Date(y, 0, 1)
  const doy = Math.floor((d.getTime() - m0.getTime()) / 86400000) + 1
  const p = Math.floor((doy - 1) / 8) * 8 + 1
  const r = new Date(m0.getTime() + (p - 1) * 86400000)
  return r.toISOString().split('T')[0]
}

export const GIBS_LAYERS: GIBSLayer[] = [
  { id: 'modis_terra', name: 'MODIS Terra True Color', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${getGIBSDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, resolution: '250m', updateRate: 'Daily', maxZoom: 9 },
  { id: 'modis_aqua', name: 'MODIS Aqua True Color', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/${getGIBSDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, resolution: '250m', updateRate: 'Daily', maxZoom: 9 },
  { id: 'viirs_snpp', name: 'VIIRS SNPP True Color', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${getGIBSDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, resolution: '250m', updateRate: 'Daily', maxZoom: 9 },
  { id: 'viirs_noaa20', name: 'VIIRS NOAA-20 True Color', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${getGIBSDate()}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, resolution: '250m', updateRate: 'Daily', maxZoom: 9 },
  { id: 'viirs_night', name: 'VIIRS Night Lights (2012)', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-04-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg', resolution: '500m', updateRate: 'Static', maxZoom: 8 },
  { id: 'dnb', name: 'VIIRS Day/Night Band', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_ENCC/default/${getGIBSDate()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, resolution: '750m', updateRate: 'Daily', maxZoom: 8 },
  { id: 'fires', name: 'Active Fires (MODIS)', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Thermal_Anomalies_Day/default/${getGIBSDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, resolution: '1km', updateRate: 'Daily', maxZoom: 7 },
  { id: 'fires_viirs', name: 'Active Fires (VIIRS)', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/${getGIBSDate()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, resolution: '375m', updateRate: 'Daily', maxZoom: 8 },
  { id: 'snow', name: 'Snow Cover (MODIS)', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/${getGIBSDate()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`, resolution: '500m', updateRate: 'Daily', maxZoom: 8 },
  { id: 'sst', name: 'Sea Surface Temp', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L2_SST_Day/default/${getGIBSDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, resolution: '1km', updateRate: 'Daily', maxZoom: 7 },
  { id: 'chlor', name: 'Chlorophyll Concentration', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Chlorophyll_A/default/${getGIBSDate()}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`, resolution: '4km', updateRate: 'Monthly', maxZoom: 7 },
  { id: 'aod', name: 'Aerosol Optical Depth', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Aerosol_Optical_Depth_3km/default/${getGIBSDate()}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, resolution: '3km', updateRate: 'Daily', maxZoom: 6 },
  { id: 'co', name: 'Carbon Monoxide (AIRS)', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day/default/${getGIBSDate()}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, resolution: '45km', updateRate: 'Daily', maxZoom: 6 },
  { id: 'dust', name: 'Dust Score (AIRS)', url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/AIRS_L2_Dust_Score_Ocean_Day/default/${getGIBSDate()}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`, resolution: '45km', updateRate: 'Daily', maxZoom: 6 },
  { id: 'blue_marble', name: 'Blue Marble (Monthly)', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-09-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg', resolution: '500m', updateRate: 'Monthly', maxZoom: 8 },
]

export { getNDVIDate, getGIBSDate }
