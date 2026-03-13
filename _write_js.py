"""Write JavaScript portion of index.html."""
import os

JS = """
// CONFIG - 40 categories, 20 countries, 15 GIBS layers
var CATEGORIES = [
  {id:"active",label:"ALL ACTIVE"},{id:"stations",label:"STATIONS"},{id:"starlink",label:"STARLINK"},
  {id:"oneweb",label:"ONEWEB"},{id:"iridium",label:"IRIDIUM"},{id:"globalstar",label:"GLOBALSTAR"},
  {id:"orbcomm",label:"ORBCOMM"},{id:"weather",label:"WEATHER"},{id:"noaa",label:"NOAA"},
  {id:"goes",label:"GOES"},{id:"gps",label:"GPS"},{id:"glonass",label:"GLONASS"},
  {id:"galileo",label:"GALILEO"},{id:"beidou",label:"BEIDOU"},{id:"gnss",label:"GNSS ALL"},
  {id:"military",label:"MILITARY"},{id:"science",label:"SCIENCE"},{id:"resource",label:"EARTH OBS"},
  {id:"geo",label:"GEO BELT"},{id:"amateur",label:"AMATEUR"},{id:"cubesat",label:"CUBESAT"},
  {id:"planet",label:"PLANET"},{id:"spire",label:"SPIRE"},{id:"radar",label:"RADAR"},
  {id:"intelsat",label:"INTELSAT"},{id:"ses",label:"SES"},{id:"telesat",label:"TELESAT"},
  {id:"tdrss",label:"TDRSS"},{id:"sarsat",label:"SARSAT"},{id:"molniya",label:"MOLNIYA"},
  {id:"education",label:"EDU"},{id:"engineering",label:"ENGR"},{id:"geodetic",label:"GEODETIC"},
  {id:"visual",label:"VISUAL"},{id:"tle-new",label:"NEW LAUNCHES"},{id:"debris",label:"DEBRIS"},
  {id:"argos",label:"ARGOS"},{id:"dmc",label:"DMC"},{id:"satnogs",label:"SATNOGS"},
  {id:"x-comm",label:"X-COMM"}
];

var COUNTRIES = [
  {code:"US",name:"United States",flag:"\\u{1F1FA}\\u{1F1F8}",color:"#3b82f6"},
  {code:"CN",name:"China",flag:"\\u{1F1E8}\\u{1F1F3}",color:"#ef4444"},
  {code:"RU",name:"Russia",flag:"\\u{1F1F7}\\u{1F1FA}",color:"#f59e0b"},
  {code:"IN",name:"India",flag:"\\u{1F1EE}\\u{1F1F3}",color:"#f97316"},
  {code:"EU",name:"ESA / Europe",flag:"\\u{1F1EA}\\u{1F1FA}",color:"#06b6d4"},
  {code:"JP",name:"Japan / JAXA",flag:"\\u{1F1EF}\\u{1F1F5}",color:"#ec4899"},
  {code:"IL",name:"Israel",flag:"\\u{1F1EE}\\u{1F1F1}",color:"#0ea5e9"},
  {code:"FR",name:"France / CNES",flag:"\\u{1F1EB}\\u{1F1F7}",color:"#6366f1"},
  {code:"DE",name:"Germany / DLR",flag:"\\u{1F1E9}\\u{1F1EA}",color:"#84cc16"},
  {code:"KR",name:"South Korea",flag:"\\u{1F1F0}\\u{1F1F7}",color:"#a855f7"},
  {code:"TR",name:"Turkey",flag:"\\u{1F1F9}\\u{1F1F7}",color:"#e11d48"},
  {code:"UK",name:"United Kingdom",flag:"\\u{1F1EC}\\u{1F1E7}",color:"#8b5cf6"},
  {code:"BR",name:"Brazil / INPE",flag:"\\u{1F1E7}\\u{1F1F7}",color:"#22c55e"},
  {code:"CA",name:"Canada / CSA",flag:"\\u{1F1E8}\\u{1F1E6}",color:"#dc2626"},
  {code:"AU",name:"Australia",flag:"\\u{1F1E6}\\u{1F1FA}",color:"#0d9488"},
  {code:"IT",name:"Italy / ASI",flag:"\\u{1F1EE}\\u{1F1F9}",color:"#16a34a"},
  {code:"IR",name:"Iran",flag:"\\u{1F1EE}\\u{1F1F7}",color:"#b91c1c"},
  {code:"KP",name:"North Korea",flag:"\\u{1F1F0}\\u{1F1F5}",color:"#991b1b"},
  {code:"PK",name:"Pakistan",flag:"\\u{1F1F5}\\u{1F1F0}",color:"#15803d"},
  {code:"AE",name:"UAE",flag:"\\u{1F1E6}\\u{1F1EA}",color:"#c026d3"}
];

function gibsDate(){var d=new Date();d.setDate(d.getDate()-2);return d.toISOString().split("T")[0]}
var GD=gibsDate();
var GIBS_LAYERS = [
  {id:"modis_terra",name:"MODIS Terra True Color",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/"+GD+"/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",res:"250m",rate:"Daily",maxZ:9},
  {id:"modis_aqua",name:"MODIS Aqua True Color",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Aqua_CorrectedReflectance_TrueColor/default/"+GD+"/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",res:"250m",rate:"Daily",maxZ:9},
  {id:"viirs_snpp",name:"VIIRS SNPP True Color",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/"+GD+"/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",res:"250m",rate:"Daily",maxZ:9},
  {id:"viirs_noaa20",name:"VIIRS NOAA-20 True Color",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/"+GD+"/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",res:"250m",rate:"Daily",maxZ:9},
  {id:"viirs_night",name:"VIIRS Night Lights (2012)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/2012-04-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",res:"500m",rate:"Static",maxZ:8},
  {id:"dnb",name:"VIIRS Day/Night Band",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_DayNightBand_ENCC/default/"+GD+"/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",res:"750m",rate:"Daily",maxZ:8},
  {id:"fires",name:"Active Fires (MODIS)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Thermal_Anomalies_Day/default/"+GD+"/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",res:"1km",rate:"Daily",maxZ:7},
  {id:"fires_viirs",name:"Active Fires (VIIRS)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_Day/default/"+GD+"/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",res:"375m",rate:"Daily",maxZ:8},
  {id:"snow",name:"Snow Cover (MODIS)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/"+GD+"/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",res:"500m",rate:"Daily",maxZ:8},
  {id:"sst",name:"Sea Surface Temp",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_L2_SST_Day/default/"+GD+"/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",res:"1km",rate:"Daily",maxZ:7},
  {id:"chlor",name:"Chlorophyll Concentration",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Chlorophyll_A/default/"+GD+"/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",res:"4km",rate:"Monthly",maxZ:7},
  {id:"aod",name:"Aerosol Optical Depth",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Aerosol_Optical_Depth_3km/default/"+GD+"/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",res:"3km",rate:"Daily",maxZ:6},
  {id:"co",name:"Carbon Monoxide (AIRS)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/AIRS_L2_Carbon_Monoxide_500hPa_Volume_Mixing_Ratio_Day/default/"+GD+"/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",res:"45km",rate:"Daily",maxZ:6},
  {id:"dust",name:"Dust Score (AIRS)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/AIRS_L2_Dust_Score_Ocean_Day/default/"+GD+"/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png",res:"45km",rate:"Daily",maxZ:6},
  {id:"blue_marble",name:"Blue Marble (Monthly)",url:"https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-09-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",res:"500m",rate:"Monthly",maxZ:8}
];

var JAMMING_ZONES = [
  {id:"jam1",name:"Eastern Mediterranean",center:[35.0,34.0],rKm:350,type:"GPS/GNSS",severity:"high",source:"Russian EW"},
  {id:"jam2",name:"Black Sea / Crimea",center:[44.5,33.5],rKm:280,type:"GPS/GNSS",severity:"high",source:"Russian EW"},
  {id:"jam3",name:"Northern Norway / Kola",center:[69.0,33.0],rKm:200,type:"GPS",severity:"medium",source:"Russian EW"},
  {id:"jam4",name:"Baltic / Kaliningrad",center:[54.7,20.5],rKm:180,type:"GPS/GNSS",severity:"medium",source:"Russian EW"},
  {id:"jam5",name:"South China Sea (Spratly)",center:[10.0,114.0],rKm:300,type:"AIS/GPS",severity:"high",source:"PLA Navy"},
  {id:"jam6",name:"Northern Syria / Aleppo",center:[36.2,37.1],rKm:150,type:"GPS",severity:"high",source:"Multiple"},
  {id:"jam7",name:"Eastern Ukraine / Donbas",center:[48.0,38.5],rKm:250,type:"GPS/GNSS",severity:"high",source:"Russian EW"},
  {id:"jam8",name:"Persian Gulf / Strait of Hormuz",center:[26.5,56.0],rKm:200,type:"GPS/AIS",severity:"medium",source:"IRGC"},
  {id:"jam9",name:"Sea of Japan / Vladivostok",center:[43.0,132.0],rKm:150,type:"GPS",severity:"medium",source:"Russian Pacific Fleet"},
  {id:"jam10",name:"Taiwan Strait",center:[24.5,119.5],rKm:120,type:"GPS/AIS",severity:"medium",source:"PLA"},
  {id:"jam11",name:"Red Sea / Yemen Coast",center:[14.0,42.5],rKm:180,type:"GPS/AIS",severity:"high",source:"Houthi forces"},
  {id:"jam12",name:"North Korea / DMZ",center:[38.3,127.0],rKm:100,type:"GPS",severity:"medium",source:"KPA"}
];

var ADSB_FLIGHTS = [
  {id:"UAL234",cs:"UAL234",type:"commercial",path:[[40.64,-73.78],[41.5,-60],[45,-40],[48,-20],[50,-5],[51.47,-0.45]],div:false},
  {id:"THY718",cs:"THY718",type:"commercial",path:[[41.26,28.74],[40.5,30],[39,32],[37.5,35.5],[35,38],[33.8,35.5]],div:true},
  {id:"RSD401",cs:"RSD401",type:"military",path:[[55.97,37.41],[54,35],[52,33],[50,33.5],[48,34],[45,33.5]],div:false},
  {id:"SIA21",cs:"SIA21",type:"commercial",path:[[1.36,103.99],[5,100],[10,95],[15,88],[20,82],[25.25,55.36]],div:false},
  {id:"QFA7",cs:"QFA7",type:"commercial",path:[[-33.95,151.18],[-25,145],[-15,130],[-5,115],[5,100],[10,85]],div:false},
  {id:"FORTE12",cs:"FORTE12",type:"surveillance",path:[[38.75,-104.53],[38,-100],[37.5,-95],[38,-85],[39,-78],[38.95,-77.46]],div:false},
  {id:"AFR7",cs:"AFR7",type:"commercial",path:[[49.01,2.55],[48,5],[45,10],[40,20],[35,30],[33.94,35.49]],div:false},
  {id:"RRR8741",cs:"RRR8741",type:"military",path:[[59.80,30.26],[58,35],[55,40],[52,45],[50,50],[48,55]],div:false},
  {id:"UAVRQ4",cs:"RQ4B",type:"surveillance",path:[[38.17,-1.17],[37,5],[36,10],[35.5,15],[35.8,20],[36,25]],div:false},
  {id:"EJU322",cs:"EJU322",type:"commercial",path:[[51.15,-0.19],[51.5,2],[52,5],[52.5,7],[52.38,9.69]],div:true}
];

var AIS_VESSELS = [
  {id:"V001",name:"USS GERALD FORD (CVN-78)",type:"warship",lat:36.5,lng:14.5,course:90,speed:18,flag:"\\u{1F1FA}\\u{1F1F8}"},
  {id:"V002",name:"COSCO SHANGHAI",type:"cargo",lat:1.2,lng:103.8,course:270,speed:12,flag:"\\u{1F1E8}\\u{1F1F3}"},
  {id:"V003",name:"NORD STREAM TANKER",type:"tanker",lat:55.5,lng:15.0,course:180,speed:8,flag:"\\u{1F1F7}\\u{1F1FA}"},
  {id:"V004",name:"INS VIKRAMADITYA (R33)",type:"warship",lat:15.4,lng:73.8,course:240,speed:20,flag:"\\u{1F1EE}\\u{1F1F3}"},
  {id:"V005",name:"EVER GIVEN",type:"cargo",lat:30.0,lng:32.5,course:350,speed:10,flag:"\\u{1F1F5}\\u{1F1E6}"},
  {id:"V006",name:"USS NIMITZ (CVN-68)",type:"warship",lat:25.2,lng:55.3,course:120,speed:15,flag:"\\u{1F1FA}\\u{1F1F8}"},
  {id:"V007",name:"LIAONING (CV-16)",type:"warship",lat:18.5,lng:112.0,course:200,speed:16,flag:"\\u{1F1E8}\\u{1F1F3}"},
  {id:"V008",name:"HMS QUEEN ELIZABETH (R08)",type:"warship",lat:50.8,lng:-1.1,course:180,speed:12,flag:"\\u{1F1EC}\\u{1F1E7}"},
  {id:"V009",name:"JS IZUMO (DDH-183)",type:"warship",lat:34.0,lng:136.0,course:90,speed:14,flag:"\\u{1F1EF}\\u{1F1F5}"},
  {id:"V010",name:"CHARLES DE GAULLE (R91)",type:"warship",lat:43.1,lng:5.9,course:170,speed:18,flag:"\\u{1F1EB}\\u{1F1F7}"},
  {id:"V011",name:"MAERSK EINDHOVEN",type:"cargo",lat:-6.2,lng:106.8,course:310,speed:14,flag:"\\u{1F1E9}\\u{1F1F0}"},
  {id:"V012",name:"AKADEMIK CHERSKIY",type:"research",lat:54.5,lng:19.5,course:270,speed:6,flag:"\\u{1F1F7}\\u{1F1FA}"},
  {id:"V013",name:"MSC ANNA",type:"cargo",lat:31.2,lng:121.5,course:90,speed:16,flag:"\\u{1F1E8}\\u{1F1ED}"},
  {id:"V014",name:"CRUDE OIL TANKER (VLCC)",type:"tanker",lat:22.0,lng:60.0,course:240,speed:11,flag:"\\u{1F1F1}\\u{1F1F7}"},
  {id:"V015",name:"MYSTERY VESSEL (AIS OFF)",type:"unknown",lat:13.5,lng:42.0,course:0,speed:0,flag:"?"}
];

var GROUND_STATIONS = [
  {name:"Cape Canaveral SLC",lat:28.562,lng:-80.577,type:"launch",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Vandenberg SFB",lat:34.742,lng:-120.573,type:"launch",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Kennedy Space Center",lat:28.608,lng:-80.604,type:"launch",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Baikonur Cosmodrome",lat:45.965,lng:63.305,type:"launch",flag:"\\u{1F1F7}\\u{1F1FA}"},
  {name:"Vostochny Cosmodrome",lat:51.884,lng:128.334,type:"launch",flag:"\\u{1F1F7}\\u{1F1FA}"},
  {name:"Plesetsk Cosmodrome",lat:62.927,lng:40.577,type:"launch",flag:"\\u{1F1F7}\\u{1F1FA}"},
  {name:"Jiuquan SLC",lat:40.958,lng:100.291,type:"launch",flag:"\\u{1F1E8}\\u{1F1F3}"},
  {name:"Xichang SLC",lat:28.246,lng:102.027,type:"launch",flag:"\\u{1F1E8}\\u{1F1F3}"},
  {name:"Wenchang SLC",lat:19.614,lng:110.951,type:"launch",flag:"\\u{1F1E8}\\u{1F1F3}"},
  {name:"Satish Dhawan SHAR",lat:13.720,lng:80.230,type:"launch",flag:"\\u{1F1EE}\\u{1F1F3}"},
  {name:"Tanegashima Space Center",lat:30.400,lng:131.000,type:"launch",flag:"\\u{1F1EF}\\u{1F1F5}"},
  {name:"Guiana Space Centre",lat:5.232,lng:-52.769,type:"launch",flag:"\\u{1F1EA}\\u{1F1FA}"},
  {name:"Semnan Launch Site",lat:35.235,lng:53.921,type:"launch",flag:"\\u{1F1EE}\\u{1F1F7}"},
  {name:"Sohae SLS (DPRK)",lat:39.660,lng:124.705,type:"launch",flag:"\\u{1F1F0}\\u{1F1F5}"},
  {name:"Naro Space Center",lat:34.431,lng:127.536,type:"launch",flag:"\\u{1F1F0}\\u{1F1F7}"},
  {name:"Palmachim AFB",lat:31.897,lng:34.690,type:"launch",flag:"\\u{1F1EE}\\u{1F1F1}"},
  {name:"Pine Gap (SIGINT)",lat:-23.799,lng:133.737,type:"sigint",flag:"\\u{1F1E6}\\u{1F1FA}"},
  {name:"Menwith Hill (ECHELON)",lat:54.008,lng:-1.688,type:"sigint",flag:"\\u{1F1EC}\\u{1F1E7}"},
  {name:"Buckley SFB (Missile Warn)",lat:39.717,lng:-104.752,type:"sigint",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Diego Garcia (Naval)",lat:-7.316,lng:72.411,type:"sigint",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Thule Air Base (Radar)",lat:76.531,lng:-68.703,type:"radar",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Fylingdales (Radar)",lat:54.362,lng:-0.671,type:"radar",flag:"\\u{1F1EC}\\u{1F1E7}"},
  {name:"Goldstone DSN",lat:35.427,lng:-116.890,type:"dsn",flag:"\\u{1F1FA}\\u{1F1F8}"},
  {name:"Canberra DSN",lat:-35.402,lng:148.981,type:"dsn",flag:"\\u{1F1E6}\\u{1F1FA}"},
  {name:"Madrid DSN",lat:40.432,lng:-4.249,type:"dsn",flag:"\\u{1F1EA}\\u{1F1F8}"}
];

// STATE
var S = {
  satellites:[], category:"active", lockedId:null, search:"", countryFilter:null,
  showOrbits:true, showCoverage:true, showJamming:true, showFlights:true, showVessels:true,
  showStations:true, showQuakes:true, showEvents:true,
  activeImagery:null, timelineOffset:0, isPlaying:false, loading:false,
  quakes:[], events:[]
};

// PROPAGATION
var sat=window.satellite;
function getSatPos(l1,l2,d){try{var sr=sat.twoline2satrec(l1,l2);var pv=sat.propagate(sr,d||new Date());if(!pv.position||typeof pv.position==="boolean")return null;var g=sat.gstime(d||new Date());var gd=sat.eciToGeodetic(pv.position,g);var v=pv.velocity;return{lat:sat.degreesLat(gd.latitude),lng:sat.degreesLong(gd.longitude),alt:gd.height,vel:Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z)}}catch(e){return null}}

function getOrbitPath(l1,l2,n){n=n||180;try{var sr=sat.twoline2satrec(l1,l2);var p=(2*Math.PI)/sr.no;var now=Date.now();var pts=[];for(var i=0;i<=n;i++){var t=new Date(now+(i/n)*p*60000);var pv=sat.propagate(sr,t);if(!pv.position||typeof pv.position==="boolean")continue;var g=sat.gstime(t);var gd=sat.eciToGeodetic(pv.position,g);pts.push([sat.degreesLat(gd.latitude),sat.degreesLong(gd.longitude)])}return pts}catch(e){return[]}}

function getFootprint(la,lo,alt,pts){pts=pts||48;var R=6371,ha=Math.acos(R/(R+alt)),fp=[];for(var i=0;i<=pts;i++){var b=(i/pts)*2*Math.PI;var lr=Math.asin(Math.sin(la*Math.PI/180)*Math.cos(ha)+Math.cos(la*Math.PI/180)*Math.sin(ha)*Math.cos(b));var lgr=lo*Math.PI/180+Math.atan2(Math.sin(b)*Math.sin(ha)*Math.cos(la*Math.PI/180),Math.cos(ha)-Math.sin(la*Math.PI/180)*Math.sin(lr));fp.push([lr*180/Math.PI,lgr*180/Math.PI])}return fp}

function classOrbit(a){return a<2000?"LEO":a<35786?"MEO":a<=35800?"GEO":"HEO"}
function getPeriod(l1,l2){try{return(2*Math.PI)/sat.twoline2satrec(l1,l2).no}catch(e){return 90}}

function guessOwner(n){var u=n.toUpperCase();
if(u.includes("STARLINK")||u.includes("GPS ")||u.includes("TDRS")||u.includes("GOES ")||u.includes("NOAA")||u.includes("NROL")||u.includes("USA ")||u.includes("LANDSAT")||u.includes("TERRA")||u.includes("AQUA")||u.includes("AURA")||u.includes("SUOMI")||u.includes("GLOBALSTAR")||u.includes("ORBCOMM")||u.includes("IRIDIUM")) return "US";
if(u.includes("BEIDOU")||u.includes("YAOGAN")||u.includes("CZ-")||u.includes("TIANGONG")||u.includes("TIANHE")||u.includes("FENGYUN")||u.includes("GAOFEN")||u.includes("JILIN")||u.includes("SHIJIAN")||u.includes("WENTIAN")||u.includes("MENGTIAN")||u.includes("SHENZHOU")||u.includes("TIANLIAN")) return "CN";
if(u.includes("GLONASS")||u.includes("COSMOS")||u.includes("MOLNIYA")||u.includes("PROGRESS")||u.includes("SOYUZ")||u.includes("ELEKTRO")||u.includes("KANOPUS")||u.includes("LUCH")) return "RU";
if(u.includes("GALILEO")||u.includes("SENTINEL")||u.includes("METOP")||u.includes("MSG ")||u.includes("COPERNICUS")||u.includes("AEOLUS")||u.includes("SWARM")||u.includes("ENVISAT")) return "EU";
if(u.includes("IRNSS")||u.includes("GSAT")||u.includes("CARTOSAT")||u.includes("ASTROSAT")||u.includes("OCEANSAT")||u.includes("RISAT")||u.includes("EOS-")||u.includes("RESOURCESAT")) return "IN";
if(u.includes("QZSS")||u.includes("HIMAWARI")||u.includes("ALOS")||u.includes("HAYABUSA")||u.includes("GOSAT")) return "JP";
if(u.includes("KOMPSAT")||u.includes("KOREASAT")||u.includes("ANASIS")) return "KR";
if(u.includes("TURKSAT")||u.includes("GOKTURK")) return "TR";
if(u.includes("EROS")||u.includes("OFEQ")||u.includes("TECSAR")) return "IL";
if(u.includes("SPOT ")||u.includes("PLEIADES")||u.includes("CSO-")||u.includes("HELIOS")) return "FR";
if(u.includes("SARAH")||u.includes("ENMAP")||u.includes("SAR-LUPE")) return "DE";
if(u.includes("RADARSAT")||u.includes("SCISAT")) return "CA";
if(u.includes("COSMO-SKYMED")) return "IT";
if(u.includes("ONEWEB")) return "UK";
if(u.includes("PLANET")||u.includes("FLOCK")||u.includes("SKYSAT")||u.includes("SPIRE")||u.includes("LEMUR")) return "US";
if(u.includes("ISS")||u.includes("HUBBLE")) return "US";
return "US";}

function getCI(code){for(var i=0;i<COUNTRIES.length;i++)if(COUNTRIES[i].code===code)return COUNTRIES[i];return{code:code,name:code,flag:"\\u{1F30D}",color:"#6b7280"}}

// MAP SETUP
var map,markers={},orbitLines=[],coveragePolys=[],jammingCircles=[],jammingPulses=[],flightMarkers={},flightLines={},vesselMarkers={},stationMarkers=[],quakeMarkers=[],eventMarkers=[],imageryLayer=null;
var pulsePhase=0,pulseAnim=0;

function initMap(){
  map=L.map("map",{center:[20,0],zoom:3,minZoom:2,maxZoom:18,zoomControl:false,attributionControl:false,worldCopyJump:true});
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:18}).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",{maxZoom:18,opacity:0.5}).addTo(map);
  L.control.zoom({position:"bottomright"}).addTo(map);
  L.control.attribution({position:"bottomright",prefix:false}).addAttribution("ESRI | CelesTrak | NASA GIBS | USGS | EONET").addTo(map);
}

// ICONS
function satIcon(c,sz,lk){var g=lk?"filter:drop-shadow(0 0 6px "+c+");":"";var p=lk?'<circle cx="12" cy="12" r="10" fill="none" stroke="'+c+'" stroke-width="1" opacity="0.4"><animate attributeName="r" from="6" to="12" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite"/></circle>':'';return L.divIcon({className:"sat-icon",iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],html:'<svg viewBox="0 0 24 24" width="'+sz+'" height="'+sz+'" style="'+g+'"><circle cx="12" cy="12" r="'+(lk?6:3)+'" fill="'+c+'" opacity="'+(lk?1:0.9)+'"/>'+p+'</svg>'})}
function vesselIcon(t){var c={warship:"#ff3d3d",cargo:"#00ff88",tanker:"#ffab00",research:"#b388ff",unknown:"#888"}[t]||"#fff";return L.divIcon({className:"vessel-icon",iconSize:[20,20],iconAnchor:[10,10],html:'<svg viewBox="0 0 24 24" width="20" height="20"><polygon points="12,2 20,20 12,16 4,20" fill="'+c+'" opacity="0.85"/></svg>'})}
function flightIcon(div,mil){var c=div?"#ff3d3d":mil?"#ffab00":"#00e5ff";return L.divIcon({className:"flight-icon",iconSize:[16,16],iconAnchor:[8,8],html:'<svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" fill="'+c+'"/></svg>'})}
function gsIcon(t){var c={launch:"#00ff88",sigint:"#ff3d3d",radar:"#ffab00",dsn:"#b388ff"}[t]||"#888";return L.divIcon({className:"event-icon",iconSize:[12,12],iconAnchor:[6,6],html:'<svg viewBox="0 0 24 24" width="12" height="12"><rect x="6" y="6" width="12" height="12" fill="'+c+'" opacity="0.8" transform="rotate(45 12 12)"/></svg>'})}
function quakeIcon(mag){var r=Math.max(6,Math.min(20,mag*3));return L.divIcon({className:"event-icon",iconSize:[r*2,r*2],iconAnchor:[r,r],html:'<svg viewBox="0 0 40 40" width="'+(r*2)+'" height="'+(r*2)+'"><circle cx="20" cy="20" r="16" fill="#ff3d3d" opacity="0.3"/><circle cx="20" cy="20" r="8" fill="#ff3d3d" opacity="0.7"/><circle cx="20" cy="20" r="16" fill="none" stroke="#ff3d3d" stroke-width="1" opacity="0.5"><animate attributeName="r" from="8" to="18" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.5" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>'})}
function eonetIcon(){return L.divIcon({className:"event-icon",iconSize:[14,14],iconAnchor:[7,7],html:'<svg viewBox="0 0 24 24" width="14" height="14"><circle cx="12" cy="12" r="6" fill="#ffab00" opacity="0.8"/><circle cx="12" cy="12" r="10" fill="none" stroke="#ffab00" stroke-width="1" opacity="0.4"><animate attributeName="r" from="6" to="11" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" from="0.4" to="0" dur="2s" repeatCount="indefinite"/></circle></svg>'})}

// RENDER FUNCTIONS
function renderSatellites(){var now=new Date(Date.now()+S.timelineOffset*60000);var mx=Math.min(S.satellites.length,3000);
for(var i=0;i<mx;i++){var s=S.satellites[i];var pos=getSatPos(s.line1,s.line2,now);if(!pos||isNaN(pos.lat)||isNaN(pos.lng))continue;
var locked=s.noradId===S.lockedId;var oc=guessOwner(s.name);var oi=getCI(oc);var ot=classOrbit(pos.alt);
var m=markers[s.noradId];
if(!m){m=L.marker([pos.lat,pos.lng],{icon:satIcon(oi.color,locked?18:8,locked)});(function(ss){m.on("click",function(){toggleLock(ss.noradId)})})(s);m.addTo(map);markers[s.noradId]=m;m._wl=locked}
else{m.setLatLng([pos.lat,pos.lng]);if(locked!==m._wl){m.setIcon(satIcon(oi.color,locked?18:8,locked));m._wl=locked}}
m.unbindPopup();
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#e0e0e0;background:#0a0e1a;padding:10px 12px;border-radius:6px;border:1px solid rgba(0,229,255,.2);min-width:220px"><div style="color:#00e5ff;font-weight:bold;font-size:12px;margin-bottom:6px">'+s.name+'</div><div style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px"><span style="color:#666">NORAD</span><span>'+s.noradId+'</span><span style="color:#666">OWNER</span><span>'+oi.flag+' '+oi.name+'</span><span style="color:#666">ORBIT</span><span>'+ot+'</span><span style="color:#666">ALT</span><span>'+pos.alt.toFixed(1)+' km</span><span style="color:#666">VEL</span><span>'+pos.vel.toFixed(2)+' km/s</span><span style="color:#666">LAT</span><span>'+pos.lat.toFixed(4)+'</span><span style="color:#666">LNG</span><span>'+pos.lng.toFixed(4)+'</span></div></div>',{className:"intel-popup",maxWidth:320})}}

function clearOrbits(){orbitLines.forEach(function(l){map.removeLayer(l)});orbitLines=[]}
function clearCoverage(){coveragePolys.forEach(function(p){map.removeLayer(p)});coveragePolys=[]}

function renderLocked(){clearOrbits();clearCoverage();if(!S.lockedId)return;
var s=S.satellites.find(function(x){return x.noradId===S.lockedId});if(!s)return;
var now=new Date(Date.now()+S.timelineOffset*60000);var pos=getSatPos(s.line1,s.line2,now);if(!pos)return;
var oi=getCI(guessOwner(s.name));
if(S.showOrbits){var path=getOrbitPath(s.line1,s.line2,180);if(path.length>1){var segs=[[]];for(var i=1;i<path.length;i++){if(Math.abs(path[i][1]-path[i-1][1])>180)segs.push([]);segs[segs.length-1].push(path[i])}segs.forEach(function(seg){if(seg.length<2)return;orbitLines.push(L.polyline(seg,{color:oi.color,weight:1.5,opacity:0.6,dashArray:"4 4"}).addTo(map))})}}
if(S.showCoverage){var fp=getFootprint(pos.lat,pos.lng,pos.alt);if(fp.length>0)coveragePolys.push(L.polygon(fp,{color:oi.color,fillColor:oi.color,fillOpacity:0.06,weight:1,opacity:0.3}).addTo(map))}
map.setView([pos.lat,pos.lng],map.getZoom(),{animate:true})}

function renderJamming(){jammingCircles.forEach(function(c){map.removeLayer(c)});jammingPulses.forEach(function(c){map.removeLayer(c)});jammingCircles=[];jammingPulses=[];cancelAnimationFrame(pulseAnim);
if(!S.showJamming)return;var sc={high:"#ff3d3d",medium:"#ffab00",low:"#facc15"};
JAMMING_ZONES.forEach(function(z){var c=sc[z.severity];
var circle=L.circle(z.center,{radius:z.rKm*1000,color:c,fillColor:c,fillOpacity:0.08,weight:1.5,dashArray:"6 4"}).addTo(map);
circle.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:'+c+';font-weight:bold">'+z.type+' JAMMING</div><div>'+z.name+'</div><div>Radius: '+z.rKm+'km</div><div>Severity: '+z.severity.toUpperCase()+'</div><div style="color:#666;margin-top:4px">Source: '+z.source+'</div></div>',{className:"intel-popup"});
jammingCircles.push(circle);var pulse=L.circle(z.center,{radius:z.rKm*1000,color:c,fillColor:"transparent",weight:2,opacity:0}).addTo(map);jammingPulses.push(pulse)});
pulsePhase=0;function ap(){pulsePhase=(pulsePhase+0.02)%1;jammingPulses.forEach(function(p,i){var z=JAMMING_ZONES[i];if(!z)return;p.setRadius(z.rKm*1000*(0.6+pulsePhase*0.4));p.setStyle({opacity:0.5*(1-pulsePhase)})});pulseAnim=requestAnimationFrame(ap)}pulseAnim=requestAnimationFrame(ap)}

function renderFlights(){Object.keys(flightMarkers).forEach(function(k){map.removeLayer(flightMarkers[k])});Object.keys(flightLines).forEach(function(k){map.removeLayer(flightLines[k])});flightMarkers={};flightLines={};
if(!S.showFlights)return;
ADSB_FLIGHTS.forEach(function(f){var last=f.path[f.path.length-1];var mil=f.type==="military"||f.type==="surveillance";
var m=L.marker(last,{icon:flightIcon(f.div,mil)}).addTo(map);
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:'+(f.div?"#ff3d3d":mil?"#ffab00":"#00e5ff")+';font-weight:bold">'+f.cs+'</div><div>Type: '+f.type+'</div>'+(f.div?'<div style="color:#ff3d3d">DIVERTED</div>':'')+'</div>',{className:"intel-popup"});
flightMarkers[f.id]=m;flightLines[f.id]=L.polyline(f.path,{color:f.div?"#ff3d3d":mil?"#ffab00":"#00e5ff",weight:1.5,opacity:0.5,dashArray:f.div?"8 4":undefined}).addTo(map)})}

function renderVessels(){Object.keys(vesselMarkers).forEach(function(k){map.removeLayer(vesselMarkers[k])});vesselMarkers={};
if(!S.showVessels)return;
AIS_VESSELS.forEach(function(v){var m=L.marker([v.lat,v.lng],{icon:vesselIcon(v.type)}).addTo(map);
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:#00e5ff;font-weight:bold">'+v.flag+' '+v.name+'</div><div>Type: '+v.type+'</div><div>Course: '+v.course+' / Speed: '+v.speed+'kn</div></div>',{className:"intel-popup"});
vesselMarkers[v.id]=m})}

function renderStations(){stationMarkers.forEach(function(m){map.removeLayer(m)});stationMarkers=[];
if(!S.showStations)return;
var tc={launch:"#00ff88",sigint:"#ff3d3d",radar:"#ffab00",dsn:"#b388ff"};
GROUND_STATIONS.forEach(function(gs){var m=L.marker([gs.lat,gs.lng],{icon:gsIcon(gs.type)}).addTo(map);
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:'+(tc[gs.type]||"#888")+';font-weight:bold">'+gs.flag+' '+gs.name+'</div><div>Type: '+gs.type.toUpperCase()+'</div></div>',{className:"intel-popup"});
stationMarkers.push(m)})}

function renderQuakes(){quakeMarkers.forEach(function(m){map.removeLayer(m)});quakeMarkers=[];
if(!S.showQuakes||!S.quakes.length)return;
S.quakes.forEach(function(q){if(!q.lat||!q.lng)return;
var m=L.marker([q.lat,q.lng],{icon:quakeIcon(q.mag||2.5)}).addTo(map);
var dt=q.time?new Date(q.time).toISOString().replace("T"," ").slice(0,19):"--";
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:#ff3d3d;font-weight:bold">EARTHQUAKE M'+(q.mag?q.mag.toFixed(1):"?")+'</div><div>'+q.place+'</div><div>Depth: '+(q.depth||0).toFixed(1)+' km</div><div style="color:#666">'+dt+' UTC</div>'+(q.tsunami?'<div style="color:#ffab00">TSUNAMI WARNING</div>':'')+'</div>',{className:"intel-popup"});
quakeMarkers.push(m)})}

function renderEvents(){eventMarkers.forEach(function(m){map.removeLayer(m)});eventMarkers=[];
if(!S.showEvents||!S.events.length)return;
S.events.forEach(function(ev){if(!ev.lat||!ev.lng)return;
var m=L.marker([ev.lat,ev.lng],{icon:eonetIcon()}).addTo(map);
m.bindPopup('<div style="font-family:monospace;font-size:11px;color:#fff;background:#111;padding:10px;border-radius:4px"><div style="color:#ffab00;font-weight:bold">'+(ev.categories||[]).join(", ")+'</div><div>'+ev.title+'</div><div style="color:#666">'+(ev.date||"--")+'</div></div>',{className:"intel-popup"});
eventMarkers.push(m)})}

function updateImagery(){if(imageryLayer){map.removeLayer(imageryLayer);imageryLayer=null}if(!S.activeImagery)return;
var layer=GIBS_LAYERS.find(function(l){return l.id===S.activeImagery});if(layer)imageryLayer=L.tileLayer(layer.url,{maxZoom:layer.maxZ,opacity:0.7,attribution:"NASA GIBS"}).addTo(map)}

// UI BUILDERS
function buildCatTabs(){var el=document.getElementById("catTabs");el.innerHTML="";
CATEGORIES.forEach(function(cat){var btn=document.createElement("button");btn.className="cat-btn"+(S.category===cat.id?" active":"");btn.textContent=cat.label;btn.onclick=function(){S.category=cat.id;clearAllMarkers();fetchTLE();buildCatTabs()};el.appendChild(btn)})}

function buildCountryBar(){var el=document.getElementById("countryBar");el.innerHTML="";
COUNTRIES.forEach(function(c){var btn=document.createElement("button");btn.className="country-btn"+(S.countryFilter===c.code?" active":"");btn.textContent=c.flag+" "+c.code;btn.onclick=function(){S.countryFilter=S.countryFilter===c.code?null:c.code;buildCountryBar();renderSatList()};el.appendChild(btn)})}

function renderSatList(){var el=document.getElementById("satList");el.innerHTML="";
var q=S.search.toLowerCase();
var filtered=S.satellites.filter(function(s){var ms=!q||s.name.toLowerCase().includes(q)||s.noradId.includes(S.search);var mc=!S.countryFilter||guessOwner(s.name)===S.countryFilter;return ms&&mc});
document.getElementById("searchCount").textContent=filtered.length.toLocaleString()+" / "+S.satellites.length.toLocaleString()+" satellites";
var mx=Math.min(filtered.length,500);
for(var i=0;i<mx;i++){(function(s){var btn=document.createElement("button");btn.className="sat-item"+(s.noradId===S.lockedId?" locked":"");
btn.innerHTML='<div class="name">'+s.name+'</div><div class="meta">NORAD '+s.noradId+' / '+guessOwner(s.name)+'</div>';
btn.onclick=function(){toggleLock(s.noradId)};el.appendChild(btn)})(filtered[i])}
if(filtered.length>500){var more=document.createElement("div");more.style.cssText="text-align:center;color:#555;font-size:10px;padding:16px";more.textContent="+"+(filtered.length-500).toLocaleString()+" more";el.appendChild(more)}}

function renderCountryDash(){var counts={};S.satellites.forEach(function(s){var c=guessOwner(s.name);counts[c]=(counts[c]||0)+1});
var stats=COUNTRIES.map(function(c){return{code:c.code,flag:c.flag,color:c.color,count:counts[c.code]||0}}).filter(function(c){return c.count>0}).sort(function(a,b){return b.count-a.count});
var maxC=Math.max.apply(null,stats.map(function(s){return s.count}).concat([1]));
var body=document.getElementById("countryDashBody");body.innerHTML="";
stats.slice(0,20).forEach(function(c){body.innerHTML+='<div class="cd-row"><div class="cd-label"><span>'+c.flag+' '+c.code+'</span><span class="cd-cnt">'+c.count.toLocaleString()+'</span></div><div class="cd-bar"><div class="cd-bar-fill" style="width:'+(c.count/maxC*100)+'%;background:'+c.color+'"></div></div></div>'});
document.getElementById("countryDashFooter").textContent="TOTAL: "+S.satellites.length.toLocaleString()+" SATS | "+S.quakes.length+" QUAKES | "+S.events.length+" EVENTS"}

function updateHUD(){var hud=document.getElementById("hud");if(!S.lockedId){hud.classList.remove("open");return}
var s=S.satellites.find(function(x){return x.noradId===S.lockedId});if(!s){hud.classList.remove("open");return}
hud.classList.add("open");var now=new Date(Date.now()+S.timelineOffset*60000);var pos=getSatPos(s.line1,s.line2,now);if(!pos)return;
var oc=guessOwner(s.name),oi=getCI(oc),ot=classOrbit(pos.alt),period=getPeriod(s.line1,s.line2);
document.getElementById("hudName").textContent=s.name;document.getElementById("hudOwner").textContent=oi.flag+" "+oi.name;
document.getElementById("hudGrid").innerHTML=[R("NORAD ID",s.noradId),R("ORBIT",ot),R("LAT",pos.lat.toFixed(4)),R("LNG",pos.lng.toFixed(4)),R("ALT",pos.alt.toFixed(1)+" km",true),R("VEL",pos.vel.toFixed(2)+" km/s",true),R("PERIOD",period.toFixed(1)+" min")].join("");
var pct=((Date.now()%(period*60000))/(period*60000)*100);
document.getElementById("hudPct").textContent=pct.toFixed(0)+"%";document.getElementById("hudBar").style.width=pct+"%"}
function R(l,v,hl){return '<div class="hud-row"><span class="lbl">'+l+'</span><span class="val'+(hl?" hl":"")+'">'+v+'</span></div>'}

function buildImageryPanel(){var dd=document.getElementById("imageryDropdown");dd.innerHTML='<div class="imagery-dropdown-header">EARTH OBSERVATION ('+GIBS_LAYERS.length+' layers)</div>';
var base=document.createElement("button");base.className="imagery-option"+(!S.activeImagery?" active":"");
base.innerHTML='<div class="io-name">BASE MAP ONLY</div><div class="io-meta">ESRI World Imagery</div>';
base.onclick=function(){S.activeImagery=null;updateImagery();buildImageryPanel()};dd.appendChild(base);
GIBS_LAYERS.forEach(function(l){var btn=document.createElement("button");btn.className="imagery-option"+(S.activeImagery===l.id?" active":"");
btn.innerHTML='<div class="io-name">'+l.name+'</div><div class="io-meta">'+l.res+' / '+l.rate+'</div>';
btn.onclick=function(){S.activeImagery=S.activeImagery===l.id?null:l.id;updateImagery();buildImageryPanel()};dd.appendChild(btn)})}

function buildLayerToggles(){var el=document.getElementById("layerToggles");el.innerHTML="";
var layers=[
  {label:"ORBITS",key:"showOrbits",color:"var(--cyan)"},
  {label:"COVERAGE",key:"showCoverage",color:"var(--green)"},
  {label:"GPS JAM ("+JAMMING_ZONES.length+")",key:"showJamming",color:"var(--red)"},
  {label:"ADS-B ("+ADSB_FLIGHTS.length+")",key:"showFlights",color:"var(--cyan)"},
  {label:"AIS ("+AIS_VESSELS.length+")",key:"showVessels",color:"var(--amber)"},
  {label:"BASES ("+GROUND_STATIONS.length+")",key:"showStations",color:"var(--green)"},
  {label:"QUAKES ("+S.quakes.length+")",key:"showQuakes",color:"var(--red)"},
  {label:"EVENTS ("+S.events.length+")",key:"showEvents",color:"var(--amber)"}
];
layers.forEach(function(l){var btn=document.createElement("button");var on=S[l.key];
btn.className="layer-toggle"+(on?" on":"");btn.style.color=on?l.color:"#555";
btn.innerHTML=(on?"\\u{1F441}":"\\u{1F441}")+" "+l.label;
btn.onclick=function(){S[l.key]=!S[l.key];buildLayerToggles();
  if(l.key==="showJamming")renderJamming();if(l.key==="showFlights")renderFlights();
  if(l.key==="showVessels")renderVessels();if(l.key==="showStations")renderStations();
  if(l.key==="showQuakes")renderQuakes();if(l.key==="showEvents")renderEvents();
  if(l.key==="showOrbits"||l.key==="showCoverage")renderLocked()};
el.appendChild(btn)})}

function buildTimeline(){var qs=document.getElementById("tlQuick");qs.innerHTML="";
[-30,-15,0,15,30].forEach(function(t){var btn=document.createElement("button");btn.className="tl-qbtn"+(S.timelineOffset===t?" active":"");
btn.textContent=t===0?"NOW":(t>0?"+"+t:t);btn.onclick=function(){setTimeline(t)};qs.appendChild(btn)})}
function updateTlLabel(){var el=document.getElementById("tlLabel");var o=S.timelineOffset;
if(o===0){el.textContent="LIVE";el.className="tl-label live"}else{el.textContent="T"+(o>0?"+":"")+o+"m";el.className="tl-label "+(o<0?"past":"future")}}
function setTimeline(v){S.timelineOffset=v;S.isPlaying=false;document.getElementById("tlSlider").value=v;
document.getElementById("tlPlay").innerHTML="\\u25B6";document.getElementById("tlPlay").classList.remove("playing");
updateTlLabel();buildTimeline();renderSatellites();renderLocked();updateHUD()}

function toggleLock(id){S.lockedId=S.lockedId===id?null:id;renderSatList();renderLocked();updateHUD();
Object.keys(markers).forEach(function(nid){var m=markers[nid];var locked=nid===S.lockedId;
if(locked!==m._wl){var s=S.satellites.find(function(x){return x.noradId===nid});if(s){m.setIcon(satIcon(getCI(guessOwner(s.name)).color,locked?18:8,locked));m._wl=locked}}})}

function clearAllMarkers(){Object.keys(markers).forEach(function(k){map.removeLayer(markers[k])});markers={};clearOrbits();clearCoverage()}

function setStatus(loading,text){document.getElementById("statusDot").className="status-dot"+(loading?" loading":"");document.getElementById("statusText").textContent=text}

function updateStats(){var p=document.getElementById("statsPanel");
p.innerHTML='<div class="stat-item">SATS: <span class="stat-val">'+S.satellites.length.toLocaleString()+'</span></div>'
+'<div class="stat-item">CATS: <span class="stat-val">'+CATEGORIES.length+'</span></div>'
+'<div class="stat-item">JAM: <span class="stat-val">'+JAMMING_ZONES.length+'</span></div>'
+'<div class="stat-item">ADS-B: <span class="stat-val">'+ADSB_FLIGHTS.length+'</span></div>'
+'<div class="stat-item">AIS: <span class="stat-val">'+AIS_VESSELS.length+'</span></div>'
+'<div class="stat-item">BASES: <span class="stat-val">'+GROUND_STATIONS.length+'</span></div>'
+'<div class="stat-item">QUAKES: <span class="stat-val">'+S.quakes.length+'</span></div>'
+'<div class="stat-item">EVENTS: <span class="stat-val">'+S.events.length+'</span></div>'}

// DATA FETCHING
function fetchTLE(){S.loading=true;setStatus(true,"FETCHING TLE ["+S.category.toUpperCase()+"]...");
fetch("/api/tle?category="+encodeURIComponent(S.category))
.then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()})
.then(function(d){if(d.satellites&&d.satellites.length>0){S.satellites=d.satellites;
document.getElementById("objCount").textContent=d.count.toLocaleString()+" OBJECTS TRACKED"+(d.fallback?" (FALLBACK)":"")+" \\u00B7 LIVE";
renderSatList();renderSatellites();renderCountryDash();buildLayerToggles();updateStats();
setStatus(false,d.count.toLocaleString()+" OBJECTS \\u00B7 "+S.category.toUpperCase()+" \\u00B7 SGP4 PROPAGATION"+(d.fallback?" (FALLBACK DATA)":""))}})
.catch(function(err){console.error("TLE fetch:",err);setStatus(false,"TLE ERROR: "+err.message);document.getElementById("statusDot").classList.add("error")})
.finally(function(){S.loading=false})}

function fetchQuakes(){fetch("/api/quakes").then(function(r){return r.json()}).then(function(d){
S.quakes=d.quakes||[];renderQuakes();buildLayerToggles();updateStats();renderCountryDash();
console.log("Loaded "+S.quakes.length+" earthquakes")}).catch(function(e){console.warn("Quakes:",e)})}

function fetchEvents(){fetch("/api/events").then(function(r){return r.json()}).then(function(d){
S.events=d.events||[];renderEvents();buildLayerToggles();updateStats();renderCountryDash();
console.log("Loaded "+S.events.length+" NASA EONET events")}).catch(function(e){console.warn("Events:",e)})}

// INIT
function init(){
  initMap();buildCatTabs();buildCountryBar();buildImageryPanel();buildLayerToggles();buildTimeline();updateTlLabel();updateStats();

  document.getElementById("searchInput").oninput=function(e){S.search=e.target.value;renderSatList()};
  document.getElementById("hudClose").onclick=function(){S.lockedId=null;renderSatList();renderLocked();updateHUD();
    Object.keys(markers).forEach(function(nid){var m=markers[nid];if(m._wl){var s=S.satellites.find(function(x){return x.noradId===nid});if(s){m.setIcon(satIcon(getCI(guessOwner(s.name)).color,8,false));m._wl=false}}})};
  document.getElementById("imageryBtn").onclick=function(){var dd=document.getElementById("imageryDropdown");dd.classList.toggle("open");document.getElementById("imageryBtn").classList.toggle("active",dd.classList.contains("open"))};
  document.getElementById("tlSlider").oninput=function(e){setTimeline(parseInt(e.target.value))};
  document.getElementById("tlBack").onclick=function(){setTimeline(-60)};
  document.getElementById("tlFwd").onclick=function(){setTimeline(60)};
  var playInt=null;
  document.getElementById("tlPlay").onclick=function(){S.isPlaying=!S.isPlaying;var btn=document.getElementById("tlPlay");
    if(S.isPlaying){btn.innerHTML="\\u23F8";btn.classList.add("playing");
      playInt=setInterval(function(){S.timelineOffset++;if(S.timelineOffset>60){S.timelineOffset=60;S.isPlaying=false;btn.innerHTML="\\u25B6";btn.classList.remove("playing");clearInterval(playInt);return}
        document.getElementById("tlSlider").value=S.timelineOffset;updateTlLabel();buildTimeline();renderSatellites();renderLocked();updateHUD()},500)}
    else{btn.innerHTML="\\u25B6";btn.classList.remove("playing");if(playInt)clearInterval(playInt)}};

  fetchTLE();fetchQuakes();fetchEvents();
  renderJamming();renderFlights();renderVessels();renderStations();

  setInterval(fetchTLE, 300000);
  setInterval(fetchQuakes, 600000);
  setInterval(fetchEvents, 600000);

  setInterval(function(){renderSatellites();updateHUD();
    if(S.lockedId&&S.showCoverage&&coveragePolys.length>0){
      var s=S.satellites.find(function(x){return x.noradId===S.lockedId});
      if(s){var now=new Date(Date.now()+S.timelineOffset*60000);var pos=getSatPos(s.line1,s.line2,now);
        if(pos){coveragePolys.forEach(function(p){p.setLatLngs(getFootprint(pos.lat,pos.lng,pos.alt))});map.setView([pos.lat,pos.lng],map.getZoom(),{animate:true})}}}
  },2000);
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
"""

FOOTER = "</script>\n</body>\n</html>"

target = r"c:\Users\KIIT\Downloads\sat-track-main\sat-track-main\static\index.html"
f = open(target, "a", encoding="utf-8")
f.write(JS)
f.write(FOOTER)
f.close()

import os
print(f"Written JS + footer. Total size: {os.path.getsize(target)} bytes")
