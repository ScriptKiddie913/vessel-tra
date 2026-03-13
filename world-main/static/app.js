/* ═══════════════════════════════════════════════════════════
   WorldMonitor Local — Frontend App
   Pure vanilla JS + Leaflet — no npm, no build tools
════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────────────────────
// Global state
// ──────────────────────────────────────────────────────────
const STATE = {
  view: 'map',
  newsFilter: 'all',
  marketsFilter: 'all',
  cyberFilter: 'ransomware',
  theme: localStorage.getItem('wm-theme') || 'dark',
  basemap: localStorage.getItem('wm-basemap') || 'dark',   // NEW: active base layer
  activeShader: null, // NEW: active map shader (crt, nvg, flir)
  layers: {
    earthquakes: true, fires: true, disasters: true,
    aviation: true,  cables: false, chokepoints: false,
    nuclear: false,   datacenters: false, boundaries: true,
    military: false,  pipelines: false, ports: false,
    waterways: false, hotspots: false,  conflicts: false,
    gamma: false,     apt: false,     ransomwareMap: false,
    satellites: false, ships: false,
    breachesMap: false,
    // NEW layers
    weather: false,      // RainViewer radar tiles
    cloud: false,        // RainViewer satellite IR (cloud cover / cyclones)
    adsbMilitary: false, // ADSB.fi military aircraft (off by default)
    vehicleFlow: false,  // OSM particle system
    transit: false,      // GTFS public transit stops
    heatmapFires: false, // Leaflet.heat fire hotspots
    heatmapEQ: false,    // Leaflet.heat earthquake density
  },
  data: {
    earthquakes: null, disasters: null, fires: null,
    news: null, markets: null, crypto: null, feargreed: null,
    ransomware: null, feodo: null, urlhaus: null,
    aviation: null, adsbMilitary: null, osmRoads: null, gtfsStops: null, cables: null, chokepoints: null,
    climate: null, spaceweather: null, datacenters: null,
    power_plants_nuclear: null,
    military: null, pipelines: null, ports: null,
    waterways: null, hotspots: null, conflicts: null,
    gamma: null, apt: null, ransomwareMap: null,
    satellites: null, ships: null,
    weatherRadar: null, // NEW
    breaches: null,     // Live data breaches from Supabase (table view)
    breachesMap: null,  // Live data breaches map layer
  },
  aiMessages: [],
  map: null,
  viewer3d: null, // NEW: Cesium viewer
  is3d: false,    // NEW: 3D mode flag
  mapLayers: {},
  baseLayers: {},   // NEW: holds all L.tileLayer base layer objects
  refreshTimers: {},
  vehicleFlowState: {
    animationId: null,
    canvas: null,
    particles: [],
    lastTime: 0
  },
  aviationWS: {
    socket: null,
    lastUpdate: 0,
    deckLayer: null,
    rawStates: [],
    interpolatedStates: [],
    predictionActive: true
  }
};

// ──────────────────────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────────────────────
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function setStatus(key, state) {
  const el = document.getElementById(`s-${key}`);
  if (!el) return;
  el.className = `status-dot ${state}`;
}

// ──────────────────────────────────────────────────────────
// Clock
// ──────────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const el = document.getElementById('header-time');
    if (el) {
      el.textContent = now.toUTCString().replace('GMT', 'UTC').split(' ').slice(0, 5).join(' ');
    }
  }
  tick();
  setInterval(tick, 1000);
}

// ──────────────────────────────────────────────────────────
// Theme
// ──────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  STATE.theme = theme;
  localStorage.setItem('wm-theme', theme);
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
  if (STATE.map) {
    STATE.map.eachLayer(l => {
      if (l._url) {
        l.options.className = 'leaflet-tile';
      }
    });
  }
}
function toggleTheme() {
  applyTheme(STATE.theme === 'dark' ? 'light' : 'dark');
}

// ──────────────────────────────────────────────────────────
// Map Shaders (CRT, NVG, FLIR)
// ──────────────────────────────────────────────────────────
function toggleShader(type) {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;

  // Remove all shader classes
  const shaders = ['crt', 'nvg', 'flir'];
  shaders.forEach(s => {
    mapContainer.classList.remove(`shader-${s}`);
    const btn = document.getElementById(`sh-${s}`);
    if (btn) btn.classList.remove('active');
  });

  // If selecting the same shader, just turn it off
  if (STATE.activeShader === type) {
    STATE.activeShader = null;
    toast(`Shader disabled`, 'info');
  } else {
    // Apply new shader
    STATE.activeShader = type;
    mapContainer.classList.add(`shader-${type}`);
    const btn = document.getElementById(`sh-${type}`);
    if (btn) btn.classList.add('active');
    toast(`Shader active: ${type.toUpperCase()}`, 'info');
  }
}

// ──────────────────────────────────────────────────────────
// Sidebar collapse / expand
// ──────────────────────────────────────────────────────────
const _sidebarState = { left: false, right: false }; // false = expanded

function toggleSidebar(side) {
  const el = document.getElementById(`sidebar-${side}`);
  const btn = document.getElementById(`toggle-${side}-ear`);
  if (!el) return;

  _sidebarState[side] = !_sidebarState[side];
  const collapsed = _sidebarState[side];

  el.classList.toggle('collapsed', collapsed);

  // Update the ear-button arrow direction
  if (btn) {
    if (side === 'left')  btn.textContent = collapsed ? '▶' : '◀';
    if (side === 'right') btn.textContent = collapsed ? '◀' : '▶';
    btn.title = `${collapsed ? 'Expand' : 'Collapse'} ${side} panel`;
  }

  // Re-invalidate Leaflet map size after transition
  setTimeout(() => { if (STATE.map) STATE.map.invalidateSize(); }, 250);
}

// ──────────────────────────────────────────────────────────
// Fullscreen / Cinema mode
// ──────────────────────────────────────────────────────────
function toggleFullscreen() {
  const btn = document.getElementById('fullscreen-btn');

  // Try native browser fullscreen api first
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {
      // Fallback: CSS cinema mode (hides header, fills viewport)
      document.body.classList.toggle('cinema-mode');
      const cm = document.body.classList.contains('cinema-mode');
      if (btn) btn.classList.toggle('active', cm);
      setTimeout(() => { if (STATE.map) STATE.map.invalidateSize(); }, 280);
    });
    if (btn) btn.classList.add('active');
  } else {
    document.exitFullscreen().catch(() => {});
    if (btn) btn.classList.remove('active');
  }
}

// Handle fullscreen change events (e.g. user presses Esc)
document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('fullscreen-btn');
  if (btn) btn.classList.toggle('active', !!document.fullscreenElement);
  setTimeout(() => { if (STATE.map) STATE.map.invalidateSize(); }, 280);
});
// ──────────────────────────────────────────────────────────
function toast(msg, type = 'info', ttl = 3500) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), ttl);
}

// ──────────────────────────────────────────────────────────
// Modal
// ──────────────────────────────────────────────────────────
function openModal(title, bodyHTML) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

// ──────────────────────────────────────────────────────────
// View switcher
// ──────────────────────────────────────────────────────────
function setView(v) {
  STATE.view = v;
  const views = ['news', 'markets', 'threats', 'infra', 'breaches'];
  const mapLayout = document.getElementById('main-layout');
  views.forEach(id => {
    const el = document.getElementById(`view-${id}`);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-view="${v}"]`);
  if (btn) btn.classList.add('active');

  if (v === 'map') {
    mapLayout.style.display = 'grid';
  } else {
    mapLayout.style.display = 'none';
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = 'flex';
    loadViewData(v);
  }
}

function loadViewData(v) {
  if (v === 'news')    renderNewsView();
  if (v === 'markets') { renderMarketsView(); renderBloombergTerminal(); loadMarketsAll(); }
  if (v === 'threats') renderThreatsView();
  if (v === 'infra')   renderInfraView();
  if (v === 'breaches') renderBreachesView();
}

function toggleIntelMenu() {
  const el = document.getElementById('intel-menu');
  if (!el) return;
  const show = el.style.display !== 'block';
  el.style.display = show ? 'block' : 'none';
  const btn = document.getElementById('intel-toggle');
  if (btn) btn.classList.toggle('active', show);
}

// ──────────────────────────────────────────────────────────
// 3D GLOBE (CesiumJS)
// ──────────────────────────────────────────────────────────
async function toggle3dMode() {
  const cesiumEl = document.getElementById('cesiumContainer');
  const mapEl = document.getElementById('map');
  const btn = document.getElementById('toggle-3d-btn');
  
  STATE.is3d = !STATE.is3d;
  
  if (STATE.is3d) {
    cesiumEl.style.display = 'block';
    mapEl.style.opacity = '0';
    if (btn) btn.classList.add('active');
    if (!STATE.viewer3d) {
      await init3dGlobe();
    } else {
      // Refresh flights if already initialized
      update3dFlights();
    }
    toast('3D Globe Mode Active', 'info');
  } else {
    cesiumEl.style.display = 'none';
    mapEl.style.opacity = '1';
    if (btn) btn.classList.remove('active');
    toast('Returned to 2D Map', 'info');
  }
}

async function init3dGlobe() {
  if (STATE.viewer3d) return;

  try {
    const viewer = new Cesium.Viewer('cesiumContainer', {
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      sceneModePicker: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      timeline: false,
      animation: false,
      fullscreenButton: false,
      scene3DOnly: true,
    });

    // Remove Cesium logo/credits for clean UI
    viewer._cesiumWidget._creditContainer.style.display = 'none';
    // Earth-like stylings
    viewer.scene.globe.enableLighting = true;
    viewer.scene.skyAtmosphere.hueShift = -0.2;
    viewer.scene.skyAtmosphere.saturationShift = 0.2;
    viewer.scene.skyAtmosphere.brightnessShift = 0.1;
    viewer.scene.globe.minimumBrightness = 0.03;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    
    STATE.viewer3d = viewer;
    
    // Apply initial basemap from 2D STATE
    await update3dBasemap(STATE.basemap || 'dark');

    // Sync view from 2D map if possible
    if (STATE.map) {
      const center = STATE.map.getCenter();
      const zoom = STATE.map.getZoom();
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(center.lng, center.lat, 20000000 / Math.pow(2, zoom - 1))
      });
    }

    // Initial flight render if layers are active
    if (STATE.layers.aviation) {
      // In WS mode, update3dFlights will be called from the WS message handler
      // but we can trigger an initial one if we have data
      if (STATE.aviationWS.interpolatedStates.length > 0) {
        update3dFlights();
      }
    }
    if (STATE.layers.adsbMilitary) {
      update3dFlights();
    }
  } catch (err) {
    console.error('Cesium initialization failed:', err);
    toast('3D Globe failed to initialize', 'err');
    STATE.is3d = false;
    document.getElementById('cesiumContainer').style.display = 'none';
    document.getElementById('map').style.opacity = '1';
    if (document.getElementById('toggle-3d-btn')) document.getElementById('toggle-3d-btn').classList.remove('active');
  }
}

// ──────────────────────────────────────────────────────────
// 3D FLIGHT RENDERING (CesiumJS)
// ──────────────────────────────────────────────────────────
// Cache for plane icons to improve performance
const _planeIconCache = {};

function createPlaneIcon(color) {
  if (_planeIconCache[color]) return _planeIconCache[color];
  
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '24px serif';
  ctx.fillText('✈', 16, 16);
  
  const dataUrl = canvas.toDataURL();
  _planeIconCache[color] = dataUrl;
  return dataUrl;
}

function update3dFlights() {
  if (!STATE.viewer3d) return;
  
  const viewer = STATE.viewer3d;
  const entities = viewer.entities;
  
  // Create a set of current flight IDs to keep
  const currentFlightIds = new Set();
  const planes = [];
  
  if (STATE.layers.aviation) {
    // Normal aviation uses WebSocket + Deck.gl
    if (STATE.aviationWS.interpolatedStates.length > 0) {
      STATE.aviationWS.interpolatedStates.forEach(ac => {
        const id = `civ-${ac.icao || ac.callsign || Math.random()}`;
        planes.push({...ac, color: ac.on_ground ? '#4ade80' : '#38bdf8', id: id, altitude_m: ac.alt});
      });
    }
  }
  if (STATE.layers.adsbMilitary && STATE.data.adsbMilitary) {
    (STATE.data.adsbMilitary.aircraft || []).forEach(ac => {
      const id = `mil-${ac.icao || ac.callsign || Math.random()}`;
      planes.push({...ac, color: '#ff3b3b', is_mil: true, id: id});
    });
  }

  planes.forEach(ac => {
    if (!ac.lat || !ac.lon) return;
    const id = ac.id;
    currentFlightIds.add(id);
    
    // Altitude in meters (ensure it's not below 0)
    const rawAlt = ac.altitude_m || (ac.altitude_ft * 0.3048) || 0;
    const alt = Math.max(0, rawAlt);
    const position = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt + 150);
    const entity = entities.getById(id);
    
    // Detailed label for military
    const labelText = ac.is_mil 
      ? `⚔ ${ac.callsign || ac.icao || 'UNKNOWN'} [${ac.type || 'MIL'}]`
      : `✈ ${ac.callsign || ac.icao || 'UNKNOWN'}`;

    if (entity) {
      entity.position = position;
      if (entity.billboard) {
        entity.billboard.rotation = Cesium.Math.toRadians(ac.heading || 0);
      }
      if (entity.label) {
        entity.label.text = labelText;
      }
    } else {
      // Add new entity
      entities.add({
        id: id,
        position: position,
        billboard: {
          image: createPlaneIcon(ac.color),
          width: ac.is_mil ? 28 : 22,
          height: ac.is_mil ? 28 : 22,
          rotation: Cesium.Math.toRadians(ac.heading || 0),
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY, 
        },
        label: {
          text: labelText,
          font: ac.is_mil ? 'bold 12px monospace' : '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(ac.color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, 24),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000),
        },
        description: ac.is_mil 
          ? `<div class="popup-content">
               <h4 style="color:#ff3b3b">⚔ MILITARY AIRCRAFT</h4>
               <p><strong>Callsign:</strong> ${ac.callsign || '—'}</p>
               <p><strong>Type:</strong> ${ac.type || '—'} (${ac.desc || '—'})</p>
               <p><strong>Country:</strong> ${ac.country || '—'}</p>
               <p><strong>Altitude:</strong> ${Math.round(ac.altitude_ft || (ac.altitude_m / 0.3048) || 0).toLocaleString()} ft</p>
               <p><strong>Speed:</strong> ${ac.velocity_kts || '—'} kts</p>
             </div>`
          : `<div class="popup-content">
               <h4>✈ CIVILIAN FLIGHT</h4>
               <p><strong>Callsign:</strong> ${ac.callsign || '—'}</p>
               <p><strong>Operator:</strong> ${ac.country || '—'}</p>
               <p><strong>Altitude:</strong> ${Math.round(ac.altitude_m || (ac.altitude_ft * 0.3048) || 0).toLocaleString()} m</p>
             </div>`
      });
    }
  });

  // Batch remove stale entities
  const entitiesToRemove = [];
  for (let i = 0; i < entities.values.length; i++) {
    const entity = entities.values[i];
    if (entity.id && (entity.id.startsWith('civ-') || entity.id.startsWith('mil-'))) {
      if (!currentFlightIds.has(entity.id)) {
        entitiesToRemove.push(entity);
      }
    }
  }
  entitiesToRemove.forEach(e => entities.remove(e));
}

// ──────────────────────────────────────────────────────────
// Leaflet Map init
// ──────────────────────────────────────────────────────────
function initMap() {
  const map = L.map('map', {
    center: [20, 10],
    zoom: 3,
    zoomControl: false,
    attributionControl: true,
    // Globe-style: world wraps infinitely when panning east/west
    worldCopyJump: true,
    // Allow zoom out to show the full world
    minZoom: 2,
    maxZoom: 18,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  STATE.map = map;

  // Apply saved (or default) basemap — handled by switchBasemap()
  switchBasemap(STATE.basemap || 'dark');

  // Coords display
  map.on('mousemove', e => {
    const el = document.getElementById('map-stats-coords');
    if (el) {
      const lat = e.latlng.lat.toFixed(3);
      const lon = e.latlng.lng.toFixed(3);
      const ns = lat >= 0 ? 'N' : 'S';
      const ew = lon >= 0 ? 'E' : 'W';
      el.textContent = `${Math.abs(lat)}° ${ns}, ${Math.abs(lon)}° ${ew}`;
    }
  });
  map.on('zoomend', () => {
    const el = document.getElementById('map-stats-zoom');
    if (el) el.textContent = `Z${map.getZoom()}`;
  });

  // Ships layer: auto-reload when zoom changes or map is panned.
  // Debounced so rapid zoom/pan only triggers one fetch.
  // Smaller bbox at higher zoom → backend returns denser local coverage.
  let _shipsReloadTimer = null;
  map.on('zoomend moveend', () => {
    if (!STATE.layers.ships) return;
    clearTimeout(_shipsReloadTimer);
    _shipsReloadTimer = setTimeout(() => {
      loadShips().then(renderShipsLayer);
    }, 700);
  });
  let _avReloadTimer = null;
  map.on('zoomend moveend', () => {
    if (!STATE.layers.aviation && !STATE.layers.adsbMilitary) return;
    clearTimeout(_avReloadTimer);
    _avReloadTimer = setTimeout(_avDraw, 100);
  });
}

// ──────────────────────────────────────────────────────────
// Basemap definitions + switcher
// ──────────────────────────────────────────────────────────
const BASEMAP_DEFS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
    sub: 'abcd',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© <a href="https://www.esri.com/">Esri</a> — Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP',
  },
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  terrain: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attr: '© <a href="https://www.esri.com/">Esri</a>, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan',
  },
  hybrid: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri',
    overlay: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  google_street: {
    url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
    attr: '© Google Maps',
  },
  google_satellite: {
    url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    attr: '© Google Maps',
  },
  google_traffic: {
    url: 'https://mt1.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}',
    attr: '© Google Maps',
  },
};

function switchBasemap(name) {
  if (!STATE.map) return;
  // Remove current base + any hybrid label overlay
  if (STATE.baseLayers._base)          { STATE.map.removeLayer(STATE.baseLayers._base);         }
  if (STATE.baseLayers._hybridLabels)  { STATE.map.removeLayer(STATE.baseLayers._hybridLabels); }
  delete STATE.baseLayers._base;
  delete STATE.baseLayers._hybridLabels;

  const def = BASEMAP_DEFS[name] || BASEMAP_DEFS.dark;
  const opts = { attribution: def.attr, maxZoom: 19, zIndex: 1 };
  if (def.sub) opts.subdomains = def.sub;

  const base = L.tileLayer(def.url, opts);
  base.addTo(STATE.map);
  STATE.baseLayers._base = base;
  // Send base tile behind all data layers
  if (base.getPane) {
    const p = base.getPane();
    if (p && p.style) p.style.zIndex = 1;
  }

  if (def.overlay) {
    const labels = L.tileLayer(def.overlay, { attribution: '', maxZoom: 19, zIndex: 2, opacity: 0.9 });
    labels.addTo(STATE.map);
    STATE.baseLayers._hybridLabels = labels;
  }

  // Update button highlights
  document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById('bm-' + name);
  if (btn) btn.classList.add('active');

  STATE.basemap = name;
  localStorage.setItem('wm-basemap', name);
  
  // Re-apply to 3D globe if active
  if (STATE.viewer3d) {
    update3dBasemap(name);
  }
}

async function update3dBasemap(name) {
  if (!STATE.viewer3d) return;
  const def = BASEMAP_DEFS[name] || BASEMAP_DEFS.dark;
  const viewer = STATE.viewer3d;
  
  // Clear all imagery layers
  viewer.imageryLayers.removeAll();
  
  // Add base layer
  const url = def.url.replace('{s}', (def.sub || 'a')[0])
                   .replace('{z}', '{z}')
                   .replace('{x}', '{x}')
                   .replace('{y}', '{y}')
                   .replace('{r}', '');
                   
  const baseProvider = new Cesium.UrlTemplateImageryProvider({
    url: url,
    credit: def.attr,
    subdomains: def.sub || 'abc',
    maximumLevel: 19
  });
  viewer.imageryLayers.addImageryProvider(baseProvider);
  
  // Add overlay/borders if any
  if (def.overlay) {
    const overlayUrl = def.overlay.replace('{z}', '{z}').replace('{x}', '{x}').replace('{y}', '{y}');
    const overlayProvider = new Cesium.UrlTemplateImageryProvider({
      url: overlayUrl,
      maximumLevel: 19
    });
    viewer.imageryLayers.addImageryProvider(overlayProvider);
  } else {
    // Default borders if not a hybrid map
    try {
      const esriBorders = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'
      );
      viewer.imageryLayers.addImageryProvider(esriBorders);
    } catch (e) { console.error("Failed to load default 3D borders", e); }
  }
}

// ──────────────────────────────────────────────────────────
// Map layer management
// ──────────────────────────────────────────────────────────
function toggleLayer(name) {
  STATE.layers[name] = !STATE.layers[name];
  const btn = document.getElementById(`layer-${name}`);
  if (btn) btn.classList.toggle('active', STATE.layers[name]);

  if (!STATE.layers[name]) {
    clearMapLayer(name);
    return;
  }
  // Load layer data on demand
  switch (name) {
    case 'earthquakes': renderEQLayer(); break;
    case 'fires':       renderFireLayer(); break;
    case 'disasters':   renderDisasterLayer(); break;
    case 'aviation':    
      initAviationPolling();
      break;
    case 'adsbMilitary':
      if (_aviationPollActive) {
        if (_aviationPollTimer) { clearTimeout(_aviationPollTimer); _aviationPollTimer = null; }
        _avPoll();
      } else {
        initAviationPolling();
      }
      break;
    case 'vehicleFlow': loadOsmRoads().then(renderVehicleFlowLayer); break;
    case 'transit':     loadGtfsStops().then(renderGtfsLayer); break;
    case 'traffic':     renderTrafficOverlay(); break;
    case 'cables':      loadCables().then(renderCablesLayer); break;
    case 'chokepoints': loadChokepoints().then(renderChokepointsLayer); break;
    case 'nuclear':     loadNuclear().then(renderNuclearLayer); break;
    case 'datacenters': loadDatacenters().then(renderDatacentersLayer); break;
    case 'boundaries':  loadCountries().then(renderBoundariesLayer); break;
    case 'military':    loadMilitaryBases().then(renderMilitaryLayer); break;
    case 'pipelines':   loadPipelines().then(renderPipelinesLayer); break;
    case 'ports':       loadPorts().then(renderPortsLayer); break;
    case 'waterways':   loadWaterways().then(renderWaterwaysLayer); break;
    case 'hotspots':    loadHotspots().then(renderHotspotsLayer); break;
    case 'conflicts':   loadConflicts().then(renderConflictsLayer); break;
    case 'gamma':       loadGamma().then(renderGammaLayer); break;
    case 'apt':         loadApt().then(renderAptLayer); break;
    case 'ransomwareMap': loadRansomwareMap().then(renderRansomwareLayer); break;
    case 'satellites':  loadSatellites().then(renderSatellitesLayer); break;
    case 'ships':       loadShips().then(renderShipsLayer); break;
    // NEW layers
    case 'weather':      loadWeatherRadar().then(renderWeatherLayer); break;
    case 'cloud':        loadWeatherRadar().then(renderCloudLayer); break;
    case 'heatmapFires': renderHeatmapFiresLayer(); break;
    case 'heatmapEQ':    renderHeatmapEQLayer();    break;
    case 'breachesMap':
      if (STATE.data.breaches) {
        STATE.data.breachesMap = STATE.data.breaches;
        renderBreachesMapLayer();
      } else {
        fetchLeakRecords().then(data => { STATE.data.breachesMap = data; renderBreachesMapLayer(); });
      }
      break;
  }
}

function clearMapLayer(name) {
  if (STATE.mapLayers[name]) {
    if (typeof STATE.mapLayers[name].remove === 'function') {
      STATE.mapLayers[name].remove();
    } else {
      STATE.map.removeLayer(STATE.mapLayers[name]);
    }
    delete STATE.mapLayers[name];
  }

  // Stop aviation polling; destroy canvas when both layers are off
  if (name === 'aviation' || name === 'adsbMilitary') {
    if (!STATE.layers.aviation && !STATE.layers.adsbMilitary) {
      stopAviationPolling();
      _aviationPollActive = false;
    } else {
      _avDraw(); // redraw with the remaining active layer's data
    }
    if (name === 'aviation' && STATE.aviationWS?.deckLayer) {
      STATE.map.removeLayer(STATE.aviationWS.deckLayer);
      STATE.aviationWS.deckLayer = null;
    }
  }
  
  // Clear 3D entities if applicable
  if (STATE.viewer3d && (name === 'aviation' || name === 'adsbMilitary')) {
    const prefix = name === 'aviation' ? 'civ-' : 'mil-';
    const entities = STATE.viewer3d.entities;
    const toRemove = [];
    for (let i = 0; i < entities.values.length; i++) {
      const e = entities.values[i];
      if (e.id.startsWith(prefix)) toRemove.push(e);
    }
    toRemove.forEach(e => entities.remove(e));
  }
}

// ──────────────────────────────────────────────────────────
// Region presets
// ──────────────────────────────────────────────────────────
const REGIONS = {
  world:    { center: [20,  10],   zoom: 3 },
  mena:     { center: [27,  43],   zoom: 5 },
  europe:   { center: [52,  14],   zoom: 5 },
  asia:     { center: [25, 100],   zoom: 4 },
  americas: { center: [15, -85],   zoom: 3 },
  africa:   { center: [5,   20],   zoom: 4 },
};
function flyToRegion(r) {
  const reg = REGIONS[r];
  if (!reg || !STATE.map) return;
  STATE.map.flyTo(reg.center, reg.zoom, { duration: 1.2 });
}

// ──────────────────────────────────────────────────────────
// Severity → colour helpers
// ──────────────────────────────────────────────────────────
const SEV_COLOR = {
  critical: '#ff2a2a', high: '#ff8800', medium: '#f59e0b',
  low: '#22d3ee', info: '#6b7280',
};
function sevColor(s) { return SEV_COLOR[s] || SEV_COLOR.info; }

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  } catch (e) { return '—'; }
}

function circleIcon(color, size = 10, opacity = 0.85) {
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};
           border:1.5px solid rgba(255,255,255,0.3);opacity:${opacity};
           box-shadow:0 0 6px ${color}88;"></div>`,
    className: '', iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
}

function pulseIcon(color) {
  return L.divIcon({
    html: `<div class="pulse-marker" style="
      width:12px;height:12px;border-radius:50%;background:${color};
      border:2px solid rgba(255,255,255,0.4);
      box-shadow:0 0 0 0 ${color}88;
      animation:pulse-ring 1.8s ease infinite;
    "></div>
    <style>
      @keyframes pulse-ring {
        0%{box-shadow:0 0 0 0 ${color}88}
        70%{box-shadow:0 0 0 10px rgba(0,0,0,0)}
        100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}
      }
    </style>`,
    className: '', iconSize: [12, 12], iconAnchor: [6, 6],
  });
}

// ──────────────────────────────────────────────────────────
// EARTHQUAKES
// ──────────────────────────────────────────────────────────
async function loadEarthquakes() {
  setStatus('eq', 'loading');
  try {
    const win = document.getElementById('eq-window')?.value || 'day';
    const data = await api(`/api/earthquakes?window=${win}`);
    STATE.data.earthquakes = data;
    renderEQList(data);
    if (STATE.layers.earthquakes) renderEQLayer();
    setStatus('eq', 'ok');
    const el = document.getElementById('map-stats-eq');
    if (el) el.textContent = `EQ: ${data.count}`;
  } catch (e) {
    setStatus('eq', 'err');
    toast('Earthquake feed error', 'err');
    document.getElementById('eq-list').innerHTML = `<div class="empty-state">Failed to load</div>`;
  }
}

function renderEQList(data) {
  const el = document.getElementById('eq-list');
  const badge = document.getElementById('eq-count');
  if (!el) return;
  const items = data.events.slice(0, 20);
  if (badge) { badge.textContent = data.count; badge.className = 'panel-badge has-data'; }
  el.innerHTML = items.map(e => `
    <div class="eq-item" onclick="flyToEQ(${e.lat},${e.lon},${e.magnitude})">
      <div class="item-row">
        <span class="mag-badge mag-${e.severity}">M${e.magnitude}</span>
        <span class="item-title">${escHtml(e.place)}</span>
      </div>
      <div class="item-meta">${timeAgo(e.time)} · depth ${e.depth_km}km</div>
    </div>
  `).join('') || '<div class="empty-state">No earthquakes</div>';
}

function flyToEQ(lat, lon, mag) {
  if (!STATE.map) return;
  STATE.map.flyTo([lat, lon], Math.max(5, Math.min(8, mag + 2)), { duration: 1 });
}

function renderEQLayer() {
  clearMapLayer('earthquakes');
  if (!STATE.data.earthquakes || !STATE.data.earthquakes.events) {
    console.warn('No EQ data to render');
    return;
  }
  const group = L.markerClusterGroup({ maxClusterRadius: 40, disableClusteringAtZoom: 7 });
  STATE.data.earthquakes.events.forEach(e => {
    const color = sevColor(e.severity);
    const size = Math.max(6, Math.min(22, e.magnitude * 2.5));
    const marker = L.circleMarker([e.lat, e.lon], {
      radius: size / 2,
      fillColor: color, color: 'rgba(255,255,255,0.25)',
      weight: 1, fillOpacity: 0.8,
    });
    marker.bindPopup(`
      <div class="popup-content">
        <h4>🌍 Earthquake M${e.magnitude}</h4>
        <p>${escHtml(e.place)}</p>
        <p class="popup-sev sev-${e.severity}">● ${e.severity.toUpperCase()}</p>
        <p>Depth: ${e.depth_km} km | ${timeAgo(e.time)}</p>
        ${e.url ? `<p><a href="${e.url}" target="_blank" style="color:#38bdf8">USGS Details →</a></p>` : ''}
      </div>
    `);
    group.addLayer(marker);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.earthquakes = group;
  console.log(`Rendered ${STATE.data.earthquakes.events.length} EQ events`);
}

// ──────────────────────────────────────────────────────────
// DISASTERS
// ──────────────────────────────────────────────────────────
async function loadDisasters() {
  try {
    const data = await api('/api/disasters');
    STATE.data.disasters = data;
    renderDisasterList(data);
    if (STATE.layers.disasters) renderDisasterLayer();
    const badge = document.getElementById('disaster-count');
    if (badge) { badge.textContent = data.count; badge.className = 'panel-badge has-data'; }
  } catch (e) {
    document.getElementById('disaster-list').innerHTML = `<div class="empty-state">Failed to load</div>`;
  }
}

function renderDisasterList(data) {
  const el = document.getElementById('disaster-list');
  if (!el) return;
  const ICONS = { wildfires: '🔥', severeStorms: '🌪', earthquakes: '🌍', volcanoes: '🌋', floods: '🌊', landslides: '⛰', seaLakeIce: '🧊', drought: '☀️', manmade: '🏭' };
  el.innerHTML = data.events.slice(0, 20).map(e => `
    <div class="disaster-item" onclick="flyTo(${e.lat},${e.lon})">
      <div class="item-row">
        <span class="sev-badge ${e.severity}">${e.severity.toUpperCase()}</span>
        <span class="item-title">${ICONS[e.category_id] || '⚠'} ${escHtml(e.title)}</span>
      </div>
      <div class="item-meta">${e.categories.join(', ')} · ${timeAgo(e.date)}</div>
    </div>
  `).join('') || '<div class="empty-state">No active events</div>';
}

function renderDisasterLayer() {
  clearMapLayer('disasters');
  if (!STATE.data.disasters) return;
  const group = L.markerClusterGroup({ maxClusterRadius: 50 });
  const ICONS = { wildfires: '🔥', severeStorms: '🌪', earthquakes: '🌍', volcanoes: '🌋', floods: '🌊' };
  STATE.data.disasters.events.forEach(e => {
    const icon = ICONS[e.category_id] || '⚠';
    const marker = L.marker([e.lat, e.lon], {
      icon: L.divIcon({
        html: `<div style="font-size:16px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.8))">${icon}</div>`,
        className: '', iconSize: [16, 16], iconAnchor: [8, 8],
      })
    });
    marker.bindPopup(`
      <div class="popup-content">
        <h4>${icon} ${escHtml(e.title)}</h4>
        <p class="popup-sev sev-${e.severity}">● ${e.severity.toUpperCase()}</p>
        <p>${e.categories.join(', ')}</p>
        <p>${timeAgo(e.date)}</p>
        ${e.source_url ? `<p><a href="${e.source_url}" target="_blank" style="color:#38bdf8">Source →</a></p>` : ''}
      </div>
    `);
    group.addLayer(marker);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.disasters = group;
}

// ──────────────────────────────────────────────────────────
// WILDFIRES
// ──────────────────────────────────────────────────────────
async function loadFires() {
  try {
    const data = await api('/api/fires');
    STATE.data.fires = data;
    const badge = document.getElementById('fire-count');
    if (badge) { badge.textContent = data.count; badge.className = 'panel-badge has-data'; }
    renderFireList(data);
    if (STATE.layers.fires) renderFireLayer();
    const el = document.getElementById('map-stats-fires');
    if (el) el.textContent = `Fires: ${data.count}`;
  } catch (e) {
    document.getElementById('fire-list').innerHTML = `<div class="empty-state">Failed to load</div>`;
  }
}

function renderFireList(data) {
  const el = document.getElementById('fire-list');
  if (!el) return;
  const top = [...data.fires].sort((a,b) => b.frp - a.frp).slice(0, 20);
  el.innerHTML = top.map(f => `
    <div class="fire-item" onclick="flyTo(${f.lat},${f.lon})">
      <div class="item-row">
        <span class="sev-badge ${f.severity}">${f.severity.toUpperCase()}</span>
        <span class="item-title">🔥 ${f.lat.toFixed(2)}°, ${f.lon.toFixed(2)}°</span>
      </div>
      <div class="item-meta">FRP: ${f.frp} MW/sr · Brightness: ${f.brightness}K · ${f.acq_date} ${f.satellite}</div>
    </div>
  `).join('') || '<div class="empty-state">No fire data</div>';
}

function renderFireLayer() {
  clearMapLayer('fires');
  if (!STATE.data.fires) return;
  const group = L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 8 });
  STATE.data.fires.fires.forEach(f => {
    const opacity = Math.min(0.95, 0.4 + f.frp / 200);
    const size = Math.max(4, Math.min(14, f.frp / 20 + 5));
    const m = L.circleMarker([f.lat, f.lon], {
      radius: size, fillColor: '#ff5500',
      color: '#ff2200', weight: 0.5, fillOpacity: opacity,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🔥 Wildfire Detection</h4>
        <p>${f.lat.toFixed(3)}°, ${f.lon.toFixed(3)}°</p>
        <p>FRP: ${f.frp} MW/sr · Brightness: ${f.brightness} K</p>
        <p>${f.acq_date} — ${f.satellite} (conf: ${f.confidence})</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.fires = group;
}

// ──────────────────────────────────────────────────────────
// REAL-TIME AVIATION — react-flight-tracker method
// Mirrors react-flight-tracker-master approach:
//   • adsb.lol backend (no API key / user ID required)
//   • Structured state vectors, altitude-based colour gradient
//   • Canvas plane icons rotated by heading (true_track)
//   • Dead-reckoning smooth movement between 15 s polls
//   • Click popup: ICAO, callsign, altitude ft/m, speed kts, heading
// ──────────────────────────────────────────────────────────

// ── Helpers (ported from react-flight-tracker/helpers/aircraftDataFunctions) ──

// Colour by altitude: 0 m = bright green → 6 000 m = yellow → 12 000+ m = red
function _avGetColor(altM, onGround, isMil) {
  if (onGround) return '#9ca3af';  // grey
  if (isMil)    return '#ff4444';  // red
  const pct = Math.max(0, Math.min(1, (altM || 0) / 12000));
  let r, g;
  if (pct < 0.5) { r = Math.round(pct * 2 * 255); g = 255; }
  else           { r = 255; g = Math.round(255 - (pct - 0.5) * 2 * 255); }
  return `rgb(${r},${g},30)`;
}

// Rotation: use true track for cruise; 0° (nose up) for takeoff/landing icons
function _avGetRotation(heading, vertRate, altM) {
  if (altM < 1000 && Math.abs(vertRate || 0) > 0.5) return 0;
  return heading || 0;
}

// Flight phase
function _avGetStatus(onGround, vertRate, altM) {
  if (onGround) return 'on_ground';
  if (altM < 1000 && (vertRate || 0) >  0.5) return 'takeoff';
  if (altM < 1000 && (vertRate || 0) < -0.5) return 'landing';
  return 'cruise';
}

// ── Module state ──
let _aviationPollTimer  = null;
let _aviationPollActive = false;
let _avCanvas  = null;
let _avCtx     = null;
let _avPlanes  = [];   // planes rendered this frame — used for click hit-test
let _avBaseData = [];  // normalised civil aircraft from last fetch
let _avMilData  = [];  // normalised military aircraft from last fetch

// ── Data fetcher — fires both civil + military in parallel ──
async function _avFetchAll() {
  const [civR, milR] = await Promise.allSettled([
    STATE.layers.aviation     ? fetch('/api/aviation').then(r => r.json())       : Promise.resolve(null),
    STATE.layers.adsbMilitary ? fetch('/api/adsb_military').then(r => r.json()) : Promise.resolve(null),
  ]);
  const now = Date.now();

  if (civR.status === 'fulfilled' && civR.value?.aircraft?.length) {
    _avBaseData = civR.value.aircraft.map(ac => ({
      icao:     ac.icao,
      callsign: (ac.callsign || ac.icao || '').trim(),
      country:  ac.country  || '',
      lat: ac.lat, lon: ac.lon,
      altM:     ac.altitude_m    || 0,
      velMs:    ac.velocity_ms   || 0,
      velKmh:   Math.round((ac.velocity_ms || 0) * 3.6),
      heading:  ac.heading       || 0,
      vertRate: ac.vertical_rate || 0,
      onGround: !!ac.on_ground,
      isMil:    false,
      _bLat: ac.lat, _bLon: ac.lon, _bHead: ac.heading || 0, _bTime: now,
    }));
  }

  if (milR.status === 'fulfilled' && milR.value?.aircraft?.length) {
    _avMilData = milR.value.aircraft.map(ac => {
      const altM  = ac.altitude_m  != null ? ac.altitude_m  : (ac.altitude_ft  || 0) / 3.28084;
      const velMs = ac.velocity_ms != null ? ac.velocity_ms : (ac.velocity_kts || 0) * 0.514444;
      return {
        icao:     ac.icao,
        callsign: (ac.callsign || ac.icao || '').trim(),
        country:  ac.country || '',
        lat: ac.lat, lon: ac.lon,
        altM, velMs, velKmh: Math.round(velMs * 3.6),
        heading:  ac.heading       || 0,
        vertRate: ac.vertical_rate || 0,
        onGround: !!ac.on_ground,
        isMil:    true,
        squawk:   ac.squawk || '',
        _bLat: ac.lat, _bLon: ac.lon, _bHead: ac.heading || 0, _bTime: now,
      };
    });
  }

  // Keep legacy STATE fields in sync (update3dFlights reads these)
  STATE.data.aviation     = { aircraft: _avBaseData };
  STATE.data.adsbMilitary = { aircraft: _avMilData  };
  if (STATE.aviationWS)
    STATE.aviationWS.interpolatedStates = _avBaseData.map(ac => ({ ...ac, alt: ac.altM }));

  const total = _avBaseData.length + _avMilData.length;
  const el = document.getElementById('map-stats-av');
  if (el) el.textContent = `Aircraft: ${total}`;
  setStatus('av', 'ok');
  console.log(`[AV] ${_avBaseData.length} civil + ${_avMilData.length} military`);
}

// ── Dead-reckoning: predict position at draw time without mutating stored data ──
function _avDR(ac) {
  if (ac.onGround || !ac.velMs || !ac._bTime) return { lat: ac.lat, lon: ac.lon };
  const dt = (Date.now() - ac._bTime) / 1000;
  if (dt <= 0 || dt > 60) return { lat: ac.lat, lon: ac.lon };
  const dist   = ac.velMs * dt;
  const rad    = (ac._bHead * Math.PI) / 180;
  const cosLat = Math.cos((ac._bLat * Math.PI) / 180) || 0.0001;
  return {
    lat: ac._bLat + (dist * Math.cos(rad)) / 111320,
    lon: ac._bLon + (dist * Math.sin(rad)) / (111320 * cosLat),
  };
}

// ── Canvas lifecycle ──
function _avInitCanvas() {
  if (_avCanvas && _avCanvas.isConnected) return;
  const old = document.getElementById('av-canvas');
  if (old) old.remove();
  _avCanvas = null; _avCtx = null;
  if (!STATE.map) return;
  const container = STATE.map.getContainer();
  const cv = document.createElement('canvas');
  cv.id = 'av-canvas';
  Object.assign(cv.style, { position: 'absolute', top: '0', left: '0',
                             pointerEvents: 'none', zIndex: '620' });
  container.appendChild(cv);
  _avCanvas = cv;
  _avCtx    = cv.getContext('2d');
  function resize() {
    const sz = STATE.map.getSize();
    cv.width = sz.x; cv.height = sz.y;
    cv.style.width = sz.x + 'px'; cv.style.height = sz.y + 'px';
  }
  resize();
  STATE.map.on('zoomend viewreset resize', resize);
  STATE.map.off('click', _avHandleClick);
  STATE.map.on('click',  _avHandleClick);
}

function _avDestroyCanvas() {
  if (STATE.map) STATE.map.off('click', _avHandleClick);
  if (_avCanvas) { _avCanvas.remove(); _avCanvas = null; _avCtx = null; }
  _avPlanes = [];
}

// ── Plane silhouette: nose pointing up, centred on origin ──
function _avDrawShape(ctx, sz, status) {
  if (status === 'takeoff' || status === 'landing') {
    // Arrow-head for climb/descent (mirrors react-flight-tracker takeoff icon)
    ctx.beginPath();
    ctx.moveTo(0, -sz);
    ctx.lineTo( sz * 0.55,  sz * 0.35);
    ctx.lineTo( 0,          sz * 0.05);
    ctx.lineTo(-sz * 0.55,  sz * 0.35);
    ctx.closePath(); ctx.fill();
    return;
  }
  // Fuselage
  ctx.beginPath();
  ctx.moveTo( 0,           -sz);
  ctx.lineTo( sz * 0.18,    sz * 0.45);
  ctx.lineTo( 0,            sz * 0.30);
  ctx.lineTo(-sz * 0.18,    sz * 0.45);
  ctx.closePath(); ctx.fill();
  // Left wing
  ctx.beginPath();
  ctx.moveTo(-sz * 0.08,  0);
  ctx.lineTo(-sz * 0.95,  sz * 0.15);
  ctx.lineTo(-sz * 0.70,  sz * 0.38);
  ctx.lineTo(-sz * 0.08,  sz * 0.25);
  ctx.closePath(); ctx.fill();
  // Right wing
  ctx.beginPath();
  ctx.moveTo( sz * 0.08,  0);
  ctx.lineTo( sz * 0.95,  sz * 0.15);
  ctx.lineTo( sz * 0.70,  sz * 0.38);
  ctx.lineTo( sz * 0.08,  sz * 0.25);
  ctx.closePath(); ctx.fill();
  // Tail fins
  ctx.beginPath();
  ctx.moveTo(-sz * 0.08,  sz * 0.40);
  ctx.lineTo(-sz * 0.42,  sz * 0.80);
  ctx.lineTo(-sz * 0.08,  sz * 0.70);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo( sz * 0.08,  sz * 0.40);
  ctx.lineTo( sz * 0.42,  sz * 0.80);
  ctx.lineTo( sz * 0.08,  sz * 0.70);
  ctx.closePath(); ctx.fill();
}

// ── Main canvas draw ──
function _avDraw() {
  if (!_avCanvas || !STATE.map) return;
  const ctx = _avCtx;
  const W = _avCanvas.width, H = _avCanvas.height;
  ctx.clearRect(0, 0, W, H);

  const zoom      = STATE.map.getZoom();
  const sz        = zoom < 4 ? 3 : zoom < 6 ? 5 : zoom < 8 ? 7 : zoom < 10 ? 9 : 12;
  const showLabel = zoom >= 9;
  const pad       = sz + 6;

  const planes = [];
  if (STATE.layers.aviation)     _avBaseData.forEach(ac => planes.push(ac));
  if (STATE.layers.adsbMilitary) _avMilData.forEach(ac  => planes.push(ac));
  _avPlanes = planes;
  if (!planes.length) return;

  if (showLabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; }

  for (const ac of planes) {
    if (ac.lat == null || ac.lon == null) continue;
    const pos = _avDR(ac);
    const pt  = STATE.map.latLngToContainerPoint([pos.lat, pos.lon]);
    if (pt.x < -pad || pt.y < -pad || pt.x > W + pad || pt.y > H + pad) continue;
    ac._drawLat = pos.lat; ac._drawLon = pos.lon;

    const status = _avGetStatus(ac.onGround, ac.vertRate, ac.altM);
    const color  = _avGetColor(ac.altM, ac.onGround, ac.isMil);
    const rot    = _avGetRotation(ac.heading, ac.vertRate, ac.altM);

    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(rot * Math.PI / 180);
    ctx.fillStyle = color;
    if (ac.isMil) { ctx.shadowBlur = 6; ctx.shadowColor = '#ff4444'; }
    _avDrawShape(ctx, sz, status);
    ctx.shadowBlur = 0;
    ctx.restore();

    if (showLabel) {
      const label = ac.callsign || ac.icao || '?';
      ctx.font        = `${zoom >= 11 ? 10 : 8}px monospace`;
      ctx.lineWidth   = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.fillStyle   = color;
      ctx.strokeText(label, pt.x, pt.y + sz + 2);
      ctx.fillText(label,   pt.x, pt.y + sz + 2);
    }
  }
}

// ── Dead-reckoning animation loop ──
function _avDRLoop() {
  if (!_aviationPollActive) return;
  _avDraw();
  requestAnimationFrame(_avDRLoop);
}

// ── Click handler — opens popup with react-flight-tracker style data panel ──
function _avHandleClick(e) {
  if (!_avCanvas || !STATE.map || !_avPlanes.length) return;
  const cp   = e.containerPoint || (() => {
    const r = _avCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  })();
  const zoom = STATE.map.getZoom();
  const hitR = Math.max(16, zoom * 2);
  let best = null, bestD = hitR;

  for (const ac of _avPlanes) {
    if (ac.lat == null) continue;
    const pt = STATE.map.latLngToContainerPoint([ac._drawLat ?? ac.lat, ac._drawLon ?? ac.lon]);
    const d  = Math.hypot(pt.x - cp.x, pt.y - cp.y);
    if (d < bestD) { bestD = d; best = ac; }
  }
  if (!best) return;

  const altFt     = Math.round(best.altM * 3.28084);
  const spdKts    = Math.round(best.velMs * 1.94384);
  const hdg       = Math.round(best.heading || 0);
  const statusTxt = best.onGround                             ? '🟢 On Ground'
    : (best.altM < 1000 && best.vertRate >  0.5)             ? '🛫 Taking Off'
    : (best.altM < 1000 && best.vertRate < -0.5)             ? '🛬 Landing'
    : '🔵 En Route';
  const link      = `https://globe.adsbexchange.com/?icao=${(best.icao || '').toLowerCase()}`;
  const titleCol  = best.isMil ? '#ff4444' : _avGetColor(best.altM, best.onGround, false);
  const titleIcon = best.isMil ? '⚔ MILITARY' : '✈';

  L.popup({ maxWidth: 320 })
    .setLatLng([best.lat, best.lon])
    .setContent(`<div style="font-family:monospace;min-width:230px">
      <div style="color:${titleCol};font-size:13px;font-weight:bold;margin-bottom:6px">${titleIcon} ${best.callsign || best.icao}</div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;line-height:1.8">
        <tr><td style="color:#aaa;padding-right:10px">ICAO</td><td>${best.icao || '—'}</td></tr>
        <tr><td style="color:#aaa">Country</td><td>${best.country || '—'}</td></tr>
        <tr><td style="color:#aaa">Altitude</td><td>${altFt.toLocaleString()} ft&nbsp;(${Math.round(best.altM)} m)</td></tr>
        <tr><td style="color:#aaa">Speed</td><td>${spdKts} kts&nbsp;(${best.velKmh} km/h)</td></tr>
        <tr><td style="color:#aaa">Heading</td><td>${hdg}°</td></tr>
        <tr><td style="color:#aaa">Status</td><td>${statusTxt}</td></tr>
        ${best.squawk ? `<tr><td style="color:#aaa">Squawk</td><td>${best.squawk}</td></tr>` : ''}
      </table>
      <div style="margin-top:8px"><a href="${link}" target="_blank"
        style="color:${titleCol};font-size:11px">Track on ADSBExchange ↗</a></div>
    </div>`)
    .openOn(STATE.map);
}

// ── 15 s polling loop ──
async function _avPoll() {
  if (!STATE.layers.aviation && !STATE.layers.adsbMilitary) {
    _aviationPollTimer  = null;
    _aviationPollActive = false;
    return;
  }
  setStatus('av', 'loading');
  try {
    await _avFetchAll();
    _avInitCanvas();
    _avDraw();
    if (STATE.is3d) update3dFlights();
  } catch (err) {
    setStatus('av', 'err');
    console.error('[AV] poll error:', err);
  }
  if (STATE.layers.aviation || STATE.layers.adsbMilitary)
    _aviationPollTimer = setTimeout(_avPoll, 15000);
}

function initAviationPolling() {
  if (_aviationPollActive) return;
  _aviationPollActive = true;
  _avInitCanvas();
  _avPoll();
  requestAnimationFrame(_avDRLoop);
}

function stopAviationPolling() {
  _aviationPollActive = false;
  if (_aviationPollTimer) { clearTimeout(_aviationPollTimer); _aviationPollTimer = null; }
  if (!STATE.layers.aviation && !STATE.layers.adsbMilitary) {
    _avDestroyCanvas();
    _avBaseData = []; _avMilData = [];
  } else {
    _avDraw();
  }
}

// Compatibility wrappers — called by clearMapLayer remove handlers and renderXxxLayer
function renderAviationLayer()     { _avInitCanvas(); _avDraw(); if (STATE.is3d) update3dFlights(); STATE.mapLayers.aviation     = { remove: () => { _avBaseData = []; _avDraw(); } }; }
function renderAdsbMilitaryLayer() { _avInitCanvas(); _avDraw(); if (STATE.is3d) update3dFlights(); STATE.mapLayers.adsbMilitary = { remove: () => { _avMilData  = []; _avDraw(); } }; }

// ──────────────────────────────────────────────────────────
// OSM VEHICLE FLOW (Particle System)
// ──────────────────────────────────────────────────────────
async function loadOsmRoads() {
  if (!STATE.map) return;
  const b = STATE.map.getBounds();
  // Overpass needs (minLat, minLon, maxLat, maxLon)
  const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
  
  setStatus('av', 'loading'); // Re-use AV status for simplicity or add new
  try {
    const data = await api(`/api/osm_roads?bbox=${bbox}`);
    STATE.data.osmRoads = data;
    setStatus('av', 'ok');
    return data;
  } catch (e) {
    setStatus('av', 'err');
    return null;
  }
}

function renderVehicleFlowLayer() {
  clearMapLayer('vehicleFlow');
  if (STATE.vehicleFlowState.animationId) {
    cancelAnimationFrame(STATE.vehicleFlowState.animationId);
    STATE.vehicleFlowState.animationId = null;
  }
  
  if (!STATE.data.osmRoads || !STATE.data.osmRoads.ways.length) return;

  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '1000';
  
  const pane = STATE.map.getPane('overlayPane');
  pane.appendChild(canvas);
  STATE.vehicleFlowState.canvas = canvas;
  
  const particles = [];
  const ways = STATE.data.osmRoads.ways;
  
  // Create particles for each way
  ways.forEach(way => {
    // Each way is an array of [lat, lon]
    const numParticles = Math.max(1, Math.floor(way.length / 2));
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        way: way,
        progress: Math.random(), // 0 to 1 along the way
        speed: 0.001 + Math.random() * 0.003,
        color: Math.random() > 0.5 ? '#ffffff' : '#ffcc00'
      });
    }
  });
  
  STATE.vehicleFlowState.particles = particles;
  
  function updateCanvas() {
    const size = STATE.map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    
    // Position the canvas correctly over the map
    const origin = STATE.map.getPixelOrigin();
    const panePos = L.DomUtil.getPosition(pane);
    canvas.style.transform = `translate3d(${-panePos.x}px, ${-panePos.y}px, 0)`;
  }
  
  function animate(time) {
    if (!STATE.layers.vehicleFlow) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const zoom = STATE.map.getZoom();
    const radius = Math.max(1, zoom - 10);
    
    STATE.vehicleFlowState.particles.forEach(p => {
      p.progress += p.speed;
      if (p.progress >= 1) p.progress = 0;
      
      // Interpolate position along way
      const way = p.way;
      const totalPoints = way.length - 1;
      const segmentIndex = Math.floor(p.progress * totalPoints);
      const segmentProgress = (p.progress * totalPoints) % 1;
      
      const p1 = way[segmentIndex];
      const p2 = way[segmentIndex + 1];
      
      if (!p1 || !p2) return;
      
      const lat = p1[0] + (p2[0] - p1[0]) * segmentProgress;
      const lon = p1[1] + (p2[1] - p1[1]) * segmentProgress;
      
      const point = STATE.map.latLngToContainerPoint([lat, lon]);
      
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.shadowBlur = radius * 2;
      ctx.shadowColor = p.color;
      ctx.fill();
    });
    
    STATE.vehicleFlowState.animationId = requestAnimationFrame(animate);
  }
  
  updateCanvas();
  STATE.map.on('move zoom viewreset', updateCanvas);
  
  STATE.vehicleFlowState.animationId = requestAnimationFrame(animate);
  
  // Custom clear function for this layer
  STATE.mapLayers.vehicleFlow = {
    remove: () => {
      if (STATE.vehicleFlowState.animationId) {
        cancelAnimationFrame(STATE.vehicleFlowState.animationId);
      }
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      STATE.map.off('move zoom viewreset', updateCanvas);
    }
  };
}

// ──────────────────────────────────────────────────────────
// GTFS — Public Transit Stops
// ──────────────────────────────────────────────────────────
async function loadGtfsStops() {
  let feedUrl = localStorage.getItem('wm-gtfs-url') || 'https://transitfeeds.com/p/mta/79/latest/download';
  try {
    const url = `/api/gtfs/stops?feed_url=${encodeURIComponent(feedUrl)}`;
    const data = await api(url);
    STATE.data.gtfsStops = data;
    toast(`GTFS stops loaded: ${data.count}`, 'info');
    return data;
  } catch (e) {
    // Fallback: prompt if default fails
    feedUrl = window.prompt('Enter GTFS ZIP feed URL:', feedUrl);
    if (feedUrl) {
      localStorage.setItem('wm-gtfs-url', feedUrl);
      return loadGtfsStops();
    }
    return null;
  }
}

function renderGtfsLayer() {
  clearMapLayer('transit');
  if (!STATE.data.gtfsStops || !STATE.data.gtfsStops.stops) return;
  const cluster = L.markerClusterGroup({
    maxClusterRadius: 30,
    disableClusteringAtZoom: 15,
    spiderfyOnMaxZoom: true,
  });
  STATE.data.gtfsStops.stops.forEach(st => {
    if (!st.lat || !st.lon) return;
    const icon = L.divIcon({
      html: `<div style="
        font-size:14px; line-height:1; color:#10b981;
        filter:drop-shadow(0 1px 2px rgba(0,0,0,0.7));
      ">🚌</div>`,
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const m = L.marker([st.lat, st.lon], { icon });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🚌 ${st.name || st.id}</h4>
        <p>ID: ${st.id || '—'} · Code: ${st.code || '—'}</p>
        ${st.desc ? `<p>${st.desc}</p>` : ''}
      </div>
    `);
    cluster.addLayer(m);
  });
  STATE.map.addLayer(cluster);
  STATE.mapLayers.transit = cluster;
}

// ──────────────────────────────────────────────────────────
// UNDERSEA CABLES
// ──────────────────────────────────────────────────────────
async function loadCables() {
  try {
    const data = await api('/api/infrastructure/cables');
    STATE.data.cables = data;
    return data;
  } catch (e) { return null; }
}

function renderCablesLayer() {
  clearMapLayer('cables');
  if (!STATE.data.cables) return;
  const group = L.layerGroup();
  STATE.data.cables.cables.forEach(cable => {
    const segs = cable.segments || [];
    if (!segs.length) return;
    const color = cable.color || '#00d9ff';
    // TeleGeography coords = [lon, lat] — swap to Leaflet [lat, lon]
    segs.forEach(seg => {
      if (!seg || seg.length < 2) return;
      try {
        const latlngs = seg.map(pt => [pt[1], pt[0]]);
        const line = L.polyline(latlngs, {
          color, weight: 1.8, opacity: 0.65, smoothFactor: 1.5,
        });
        const owners = (cable.owners || []).join(', ') || 'Unknown';
        line.bindPopup(`
          <div class="popup-content">
            <h4>🌊 ${escHtml(cable.name)}</h4>
            <p><strong>RFS:</strong> ${cable.rfs || '—'}</p>
            <p><strong>Length:</strong> ${cable.length || '—'}</p>
            <p><strong>Owners:</strong> ${escHtml(owners.slice(0, 120))}</p>
          </div>
        `);
        group.addLayer(line);
      } catch (e) {}
    });
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.cables = group;
}

// ──────────────────────────────────────────────────────────
// CHOKEPOINTS
// ──────────────────────────────────────────────────────────
async function loadChokepoints() {
  try {
    const data = await api('/api/infrastructure/chokepoints');
    STATE.data.chokepoints = data;
    return data;
  } catch (e) { return null; }
}

function renderChokepointsLayer() {
  clearMapLayer('chokepoints');
  if (!STATE.data.chokepoints) return;
  const group = L.layerGroup();
  STATE.data.chokepoints.chokepoints.forEach(c => {
    const color = sevColor(c.risk);
    const m = L.circleMarker([c.lat, c.lon], {
      radius: 12, fillColor: color,
      color: color, weight: 2, fillOpacity: 0.25,
    });
    const icon = L.marker([c.lat, c.lon], {
      icon: L.divIcon({
        html: `<div style="font-family:monospace;font-size:9px;font-weight:900;color:${color};
               background:rgba(0,0,0,0.8);border:1px solid ${color};padding:2px 4px;
               border-radius:3px;white-space:nowrap;letter-spacing:0.3px;">⚓ ${c.name}</div>`,
        className: '', iconAnchor: [0, 0],
      })
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>⚓ ${escHtml(c.name)}</h4>
        <p>Daily oil transit: <b>${c.daily_barrels_M}M bbl/day</b></p>
        <p>Region: ${c.region}</p>
        <p class="popup-sev sev-${c.risk}">Risk: ${c.risk.toUpperCase()}</p>
      </div>
    `);
    group.addLayer(m);
    group.addLayer(icon);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.chokepoints = group;
}

// ──────────────────────────────────────────────────────────
// NUCLEAR FACILITIES (static — IAEA+NTI curated list)
// ──────────────────────────────────────────────────────────
async function loadNuclear() {
  try {
    const data = await api('/api/infrastructure/nuclear');
    STATE.data.power_plants_nuclear = data;
    return data;
  } catch (e) { return null; }
}

function renderNuclearLayer() {
  clearMapLayer('nuclear');
  if (!STATE.data.power_plants_nuclear) return;
  const group = L.layerGroup();
  const colorMap = { weapons: '#ff4d4d', enrichment: '#fbbf24', plant: '#a3e635' };
  const symbolMap = { weapons: '☢', enrichment: '⚗', plant: '⚡' };
  STATE.data.power_plants_nuclear.facilities.forEach(p => {
    const color = colorMap[p.type] || '#a3e635';
    const symbol = symbolMap[p.type] || '☢';
    const m = L.circleMarker([p.lat, p.lon], {
      radius: p.type === 'weapons' ? 7 : 5,
      fillColor: color,
      color: '#111', weight: 1.5, fillOpacity: 0.85,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>${symbol} ${escHtml(p.name)}</h4>
        <p><strong>Type:</strong> ${p.type} | <strong>Status:</strong> ${p.status}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.nuclear = group;
}

// ──────────────────────────────────────────────────────────
// DATACENTERS
// ──────────────────────────────────────────────────────────
async function loadDatacenters() {
  try {
    const data = await api('/api/infrastructure/datacenters');
    STATE.data.datacenters = data;
    return data;
  } catch (e) { return null; }
}

function renderDatacentersLayer() {
  clearMapLayer('datacenters');
  if (!STATE.data.datacenters) return;
  const group = L.layerGroup();
  STATE.data.datacenters.facilities.forEach(f => {
    const m = L.circleMarker([f.lat, f.lon], {
      radius: 4, fillColor: '#818cf8',
      color: '#6366f1', weight: 1, fillOpacity: 0.7,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🖥 ${escHtml(f.name)}</h4>
        <p>${f.city}, ${f.country}</p>
        ${f.website ? `<p><a href="${f.website}" target="_blank" style="color:#38bdf8">${f.website}</a></p>` : ''}
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.datacenters = group;
}

// ──────────────────────────────────────────────────────────
// COUNTRY BOUNDARIES (with CDN fallback chain)
// ──────────────────────────────────────────────────────────
async function loadCountries() {
  try {
    // Primary: proxied via our backend (handles CDN fallback chain server-side)
    const data = await api('/api/geo/countries');
    return data;
  } catch (e) {
    // Direct fallback if backend endpoint fails
    const cdnUrls = [
      'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson',
      'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
    ];
    for (const url of cdnUrls) {
      try {
        const r = await fetch(url);
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    return null;
  }
}

function renderBoundariesLayer(data) {
  clearMapLayer('boundaries');
  if (!data) return;
  const layer = L.geoJSON(data, {
    pane: 'overlayPane',
    style: {
      fillColor: 'transparent',
      color: '#2a4a6a',
      weight: 0.8,
      opacity: 0.6,
    },
    onEachFeature(feature, layer) {
      const p = feature.properties || {};
      layer.on('click', () => {
        openModal(`🌍 ${p.name || 'Country'}`, `
          <div class="modal-detail-row">
            <span class="modal-detail-label">Name</span>
            <span class="modal-detail-value">${escHtml(p.name || '')}</span>
          </div>
          <div class="modal-detail-row">
            <span class="modal-detail-label">ISO</span>
            <span class="modal-detail-value">${p.iso_a2 || ''} / ${p.iso_a3 || ''}</span>
          </div>
          <div class="modal-detail-row">
            <span class="modal-detail-label">Continent</span>
            <span class="modal-detail-value">${p.continent || ''}</span>
          </div>
          <div class="modal-detail-row">
            <span class="modal-detail-label">Region</span>
            <span class="modal-detail-value">${p.region || ''}</span>
          </div>
          <div class="modal-detail-row">
            <span class="modal-detail-label">Population</span>
            <span class="modal-detail-value">${p.pop_est ? Number(p.pop_est).toLocaleString() : '—'}</span>
          </div>
          <div class="modal-detail-row">
            <span class="modal-detail-label">GDP (est.)</span>
            <span class="modal-detail-value">${p.gdp_md_est ? '$' + (p.gdp_md_est/1000).toFixed(1) + 'B' : '—'}</span>
          </div>
        `);
      });
      layer.on('mouseover', function(e) {
        this.setStyle({ color: '#38bdf8', weight: 1.5, opacity: 0.9 });
      });
      layer.on('mouseout', function(e) {
        this.setStyle({ color: '#2a4a6a', weight: 0.8, opacity: 0.6 });
      });
    }
  });
  STATE.map.addLayer(layer);
  STATE.mapLayers.boundaries = layer;
}

// ──────────────────────────────────────────────────────────
// NEWS
// ──────────────────────────────────────────────────────────
async function loadNews() {
  setStatus('news', 'loading');
  try {
    const data = await api('/api/news');
    STATE.data.news = data;
    setStatus('news', 'ok');
    renderNewsSidebar(data);
    const badge = document.getElementById('news-count');
    if (badge) { badge.textContent = data.total; badge.className = 'panel-badge has-data'; }
  } catch (e) {
    setStatus('news', 'err');
    document.getElementById('news-list').innerHTML = `<div class="empty-state">Failed to load</div>`;
  }
}

const SOURCE_LABELS = {
  reuters_world: 'REUTERS', bbc_world: 'BBC', aljazeera: 'AJ',
  nyt_world: 'NYT', guardian_world: 'GUARDIAN', france24_en: 'F24', dw_world: 'DW',
};

function renderNewsSidebar(data) {
  const el = document.getElementById('news-list');
  if (!el) return;
  let items = data.items;
  if (STATE.newsFilter !== 'all') {
    items = items.filter(i => i.severity === STATE.newsFilter);
  }
  el.innerHTML = items.slice(0, 50).map(item => `
    <a href="${item.link || '#'}" target="_blank" class="news-item">
      <div class="item-row">
        <span class="sev-badge ${item.severity}">${item.severity.toUpperCase()}</span>
        <span class="news-source-badge">${SOURCE_LABELS[item.source] || item.source.toUpperCase()}</span>
      </div>
      <div class="item-title">${escHtml(item.title)}</div>
      <div class="item-meta">${item.published ? timeAgoStr(item.published) : ''}</div>
    </a>
  `).join('') || '<div class="empty-state">No items</div>';
}

function filterNews(f) {
  STATE.newsFilter = f;
  document.querySelectorAll('#panel-news .filter-btn').forEach(b =>
    b.classList.toggle('active', b.onclick?.toString().includes(`'${f}'`))
  );
  if (STATE.data.news) renderNewsSidebar(STATE.data.news);
  // Update filter button state
  document.querySelectorAll('#panel-news .filter-btn').forEach(b => {
    b.classList.remove('active');
    if (b.getAttribute('onclick').includes(`'${f}'`)) b.classList.add('active');
  });
}

// ──────────────────────────────────────────────────────────
// MARKETS
// ──────────────────────────────────────────────────────────
async function loadMarkets() {
  setStatus('markets', 'loading');
  try {
    const [quotes, crypto, fg] = await Promise.allSettled([
      api('/api/markets/quotes'),
      api('/api/markets/crypto'),
      api('/api/markets/fear-greed'),
    ]);
    if (quotes.status === 'fulfilled') STATE.data.markets = quotes.value;
    if (crypto.status === 'fulfilled') STATE.data.crypto = crypto.value;
    if (fg.status === 'fulfilled')     STATE.data.feargreed = fg.value;
    setStatus('markets', 'ok');
    renderMarketsSidebar();
    renderFearGreed();
    const badge = document.getElementById('markets-badge');
    if (badge && STATE.data.markets) {
      badge.textContent = STATE.data.markets.count;
      badge.className = 'panel-badge has-data';
    }
  } catch (e) {
    setStatus('markets', 'err');
  }
}

function renderMarketsSidebar() {
  const el = document.getElementById('markets-list');
  if (!el || !STATE.data.markets) return;
  let items = STATE.data.markets.quotes;
  if (STATE.marketsFilter === 'indices') items = items.filter(i => !['BTC-USD','ETH-USD'].includes(i.ticker) && !i.ticker.includes('=X') && !(i.ticker.endsWith('=F')));
  if (STATE.marketsFilter === 'crypto')  items = items.filter(i => ['BTC-USD','ETH-USD'].includes(i.ticker));
  if (STATE.marketsFilter === 'commodities') items = items.filter(i => i.ticker.endsWith('=F'));
  el.innerHTML = items.map(q => `
    <div class="market-item">
      <div style="display:flex;flex-direction:column;flex:1;gap:1px">
        <span class="market-name">${escHtml(q.name)}</span>
        <span class="market-ticker">${q.ticker}</span>
      </div>
      <span class="market-price">${formatPrice(q.price, q.currency)}</span>
      <span class="market-change ${q.direction}">${q.change_pct > 0 ? '+' : ''}${q.change_pct}%</span>
    </div>
  `).join('') || '<div class="empty-state">No data</div>';
}

function filterMarkets(f) {
  STATE.marketsFilter = f;
  document.querySelectorAll('#panel-markets .filter-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${f}'`));
  });
  renderMarketsSidebar();
}

function renderFearGreed() {
  const el = document.getElementById('fear-greed-panel');
  if (!el || !STATE.data.feargreed) return;
  const fg = STATE.data.feargreed;
  const cls = sentimentClass(fg.sentiment);
  el.innerHTML = `
    <div class="fg-meter">
      <div class="fg-number ${cls}">${fg.value}</div>
      <div class="fg-label ${cls}">${fg.label.toUpperCase()}</div>
      <div class="fg-bar-track" style="width:100%">
        <div class="fg-bar-fill" style="width:${fg.value}%;background:${sentimentColor(fg.sentiment)}"></div>
      </div>
      <div style="display:flex;justify-content:space-between;width:100%;margin-top:2px;">
        <span style="font-family:monospace;font-size:9px;color:var(--sev-critical)">Fear</span>
        <span style="font-family:monospace;font-size:9px;color:var(--accent-cyan)">Greed</span>
      </div>
    </div>
  `;
}

function sentimentClass(s) {
  return { extreme_fear: 'fg-extreme-fear', fear: 'fg-fear', neutral: 'fg-neutral', greed: 'fg-greed', extreme_greed: 'fg-extreme-greed' }[s] || 'fg-neutral';
}
function sentimentColor(s) {
  return { extreme_fear: '#ff2a2a', fear: '#ff8800', neutral: '#f59e0b', greed: '#10b981', extreme_greed: '#00d4ff' }[s] || '#6b7280';
}

// ──────────────────────────────────────────────────────────
// CYBER THREATS
// ──────────────────────────────────────────────────────────
async function loadThreats() {
  setStatus('threats', 'loading');
  try {
    const [rw, feodo] = await Promise.allSettled([
      api('/api/threats/ransomware'),
      api('/api/threats/feodo'),
    ]);
    if (rw.status === 'fulfilled')    STATE.data.ransomware = rw.value;
    if (feodo.status === 'fulfilled') STATE.data.feodo = feodo.value;
    setStatus('threats', 'ok');
    renderCyberSidebar();
    const badge = document.getElementById('cyber-count');
    if (badge && STATE.data.ransomware) {
      badge.textContent = STATE.data.ransomware.count + (STATE.data.feodo?.count || 0);
      badge.className = 'panel-badge has-data';
    }
  } catch (e) {
    setStatus('threats', 'err');
  }
}

function renderCyberSidebar() {
  const el = document.getElementById('cyber-list');
  if (!el) return;
  if (STATE.cyberFilter === 'ransomware' && STATE.data.ransomware) {
    el.innerHTML = STATE.data.ransomware.victims.slice(0, 20).map(v => `
      <div class="threat-item">
        <div class="threat-group rw-group-link" onclick="showRansomwareGroupDetail('${escAttr(v.group)}')" style="cursor:pointer">${escHtml(v.group)} <span style="font-size:10px;opacity:0.6">↗</span></div>
        <div class="threat-victim">${escHtml(v.victim)}</div>
        <div class="threat-meta">${v.country ? `🌍 ${v.country}` : ''} ${v.sector ? `· ${v.sector}` : ''} ${v.date ? `· ${v.date.slice(0, 10)}` : ''}</div>
      </div>
    `).join('') || '<div class="empty-state">No data</div>';
  } else if (STATE.cyberFilter === 'c2' && STATE.data.feodo) {
    el.innerHTML = STATE.data.feodo.iocs.slice(0, 20).map(i => `
      <div class="threat-item">
        <div class="threat-ip">${escHtml(i.ip)}${i.port ? ':' + i.port : ''}</div>
        <div class="threat-meta">C2 Server · ${i.type}</div>
      </div>
    `).join('') || '<div class="empty-state">No data</div>';
  } else {
    el.innerHTML = '<div class="empty-state">Select a category</div>';
  }
}

function filterCyber(f) {
  STATE.cyberFilter = f;
  document.querySelectorAll('#panel-infra + .panel .filter-btn, .sidebar-right .panel .filter-btn').forEach(b => {});
  document.querySelectorAll('.sidebar-right .panel:last-child .filter-btn').forEach(b => {
    b.classList.toggle('active', b.getAttribute('onclick').includes(`'${f}'`));
  });
  renderCyberSidebar();
}

// ──────────────────────────────────────────────────────────
// RANSOMWARE GROUP DETAIL MODAL
// ──────────────────────────────────────────────────────────
async function showRansomwareGroupDetail(name) {
  if (!name) return;

  let modal = document.getElementById('rw-group-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'rw-group-modal';
    modal.className = 'rw-modal-overlay';
    modal.innerHTML = `
      <div class="rw-modal-box">
        <div class="rw-modal-header">
          <span id="rw-modal-title">Loading…</span>
          <button class="rw-modal-close" onclick="document.getElementById('rw-group-modal').style.display='none'">✕</button>
        </div>
        <div id="rw-modal-body" class="rw-modal-body"><div class="loading-pulse">Fetching group data…</div></div>
      </div>
    `;
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  document.getElementById('rw-modal-title').textContent = '🏴‍☠️ ' + name;

  const victims  = STATE.data.ransomware ? STATE.data.ransomware.victims.filter(v => v.group === name) : [];
  const countries = [...new Set(victims.map(v => v.country).filter(Boolean))];
  const sectors   = [...new Set(victims.map(v => v.sector).filter(Boolean))];

  let aptDetail = null;
  try { aptDetail = await api(`/api/threats/apt-detail?name=${encodeURIComponent(name)}`); } catch (_) {}

  const body = document.getElementById('rw-modal-body');
  body.innerHTML = `
    <div class="rw-detail-section">
      <h3 style="color:var(--sev-critical);margin:0 0 8px">📊 Activity Summary</h3>
      <div class="rw-stat-row">
        <span class="rw-stat"><strong>${victims.length}</strong> Victims</span>
        <span class="rw-stat"><strong>${countries.length}</strong> Countries</span>
        <span class="rw-stat"><strong>${sectors.length}</strong> Sectors</span>
      </div>
    </div>
    ${countries.length ? `<div class="rw-detail-section">
      <h4 style="color:var(--text-muted);margin:0 0 6px">🌍 Target Countries</h4>
      <div class="rw-tag-list">${countries.slice(0,20).map(c => `<span class="rw-tag">${escHtml(c)}</span>`).join('')}</div>
    </div>` : ''}
    ${sectors.length ? `<div class="rw-detail-section">
      <h4 style="color:var(--text-muted);margin:0 0 6px">🏭 Target Sectors</h4>
      <div class="rw-tag-list">${sectors.slice(0,15).map(s => `<span class="rw-tag rw-tag-sector">${escHtml(s)}</span>`).join('')}</div>
    </div>` : ''}
    ${aptDetail && aptDetail.group ? `<div class="rw-detail-section">
      <h4 style="color:var(--accent-blue);margin:0 0 6px">🔍 Threat Intelligence</h4>
      ${aptDetail.group.country ? `<p><strong>Origin:</strong> ${escHtml(aptDetail.group.country)}</p>` : ''}
      ${aptDetail.group.motivation ? `<p><strong>Motivation:</strong> ${escHtml(aptDetail.group.motivation)}</p>` : ''}
      ${aptDetail.group.description ? `<p style="color:var(--text-secondary);font-size:12px;line-height:1.5">${escHtml(aptDetail.group.description)}</p>` : ''}
      ${aptDetail.group.aliases && aptDetail.group.aliases.length ? `<p><strong>Also known as:</strong> ${aptDetail.group.aliases.map(a => `<span class="rw-tag">${escHtml(a)}</span>`).join(' ')}</p>` : ''}
    </div>` : ''}
    <div class="rw-detail-section">
      <h4 style="color:var(--text-muted);margin:0 0 6px">📋 Recent Victims (${Math.min(victims.length,20)} of ${victims.length})</h4>
      <table class="threats-full-table" style="font-size:11px">
        <thead><tr><th>Victim</th><th>Country</th><th>Sector</th><th>Date</th></tr></thead>
        <tbody>${victims.slice(0,20).map(v => `
          <tr>
            <td style="color:var(--text-primary)">${escHtml(v.victim)}</td>
            <td>${v.country || '—'}</td>
            <td style="color:var(--text-muted)">${v.sector || '—'}</td>
            <td>${v.date ? v.date.slice(0,10) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ──────────────────────────────────────────────────────────
// SIGNALS AGGREGATION
// ──────────────────────────────────────────────────────────
async function loadSignals() {
  try {
    const data = await api('/api/signals');
    renderSignalsList(data);
    const badge = document.getElementById('signals-count');
    if (badge) { badge.textContent = data.total_signals; badge.className = 'panel-badge has-data'; }
  } catch (e) {
    document.getElementById('signals-list').innerHTML = `<div class="empty-state">Failed to load</div>`;
  }
}

function renderSignalsList(data) {
  const el = document.getElementById('signals-list');
  if (!el) return;
  const TYPE_ICON = {
    earthquake: '🌍', wildfires: '🔥', severeStorms: '🌪',
    volcanoes: '🌋', floods: '🌊', ransomware: '🏴‍☠️',
    disaster: '⚠', floods: '🌊',
  };
  el.innerHTML = data.signals.slice(0, 25).map(s => `
    <div class="signal-item" onclick="${s.lat ? `flyTo(${s.lat},${s.lon})` : "''"}">
      <div class="item-row">
        <span class="sev-badge ${s.severity}">${s.severity.toUpperCase()}</span>
        <span class="item-title">${TYPE_ICON[s.type] || '⚡'} ${escHtml(s.title)}</span>
      </div>
      <div class="item-meta">${escHtml(s.detail || '')} ${s.time ? '· ' + timeAgo(s.time) : ''}</div>
    </div>
  `).join('') || '<div class="empty-state">No signals</div>';
}

// ──────────────────────────────────────────────────────────
// FULL VIEW RENDERS
// ──────────────────────────────────────────────────────────
function renderNewsView() {
  const grid = document.getElementById('news-grid-full');
  const countEl = document.getElementById('news-view-count');
  if (!grid || !STATE.data.news) {
    if (grid) grid.innerHTML = '<div class="loading-pulse">Loading news…</div>';
    return;
  }
  const items = STATE.data.news.items;
  if (countEl) countEl.textContent = items.length;
  grid.innerHTML = items.map(item => `
    <a href="${item.link || '#'}" target="_blank" class="news-card sev-${item.severity}">
      <div class="item-row" style="gap:6px">
        <span class="sev-badge ${item.severity}">${item.severity.toUpperCase()}</span>
        <span class="news-source-badge">${SOURCE_LABELS[item.source] || item.source.toUpperCase()}</span>
      </div>
      <div class="news-card-title">${escHtml(item.title)}</div>
      ${item.description ? `<div class="news-card-desc">${escHtml(item.description)}</div>` : ''}
      <div class="news-card-footer">
        <span class="news-card-source">${SOURCE_LABELS[item.source] || item.source}</span>
        <span class="news-card-time">${item.published ? timeAgoStr(item.published) : ''}</span>
      </div>
    </a>
  `).join('');
}

function renderMarketsView() {
  // Quotes table
  const tblQ = document.getElementById('markets-table-quotes');
  if (tblQ && STATE.data.markets) {
    tblQ.innerHTML = `<table class="markets-table">
      <thead><tr><th>Name</th><th>Ticker</th><th>Price</th><th>24h %</th></tr></thead>
      <tbody>${STATE.data.markets.quotes.map(q => `
        <tr>
          <td>${escHtml(q.name)}</td>
          <td class="ticker">${q.ticker}</td>
          <td class="price">${formatPrice(q.price, q.currency)}</td>
          <td class="chg ${q.direction}">${q.change_pct > 0 ? '+' : ''}${q.change_pct}%</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }
  // Crypto table
  const tblC = document.getElementById('markets-table-crypto');
  if (tblC && STATE.data.crypto) {
    tblC.innerHTML = `<table class="markets-table">
      <thead><tr><th>Coin</th><th>Price</th><th>24h</th><th>7d</th><th>MC</th></tr></thead>
      <tbody>${STATE.data.crypto.coins.map(c => `
        <tr>
          <td><b>${c.symbol}</b> <small style="color:var(--text-muted)">#${c.rank}</small></td>
          <td class="price">$${c.price?.toLocaleString()}</td>
          <td class="chg ${c.direction}">${c.change_24h > 0 ? '+' : ''}${c.change_24h}%</td>
          <td class="chg ${c.change_7d >= 0 ? 'up' : 'down'}">${c.change_7d > 0 ? '+' : ''}${c.change_7d}%</td>
          <td style="font-family:monospace;font-size:10px;color:var(--text-muted)">${fmtBig(c.market_cap)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }
  // Sentiment
  const sent = document.getElementById('markets-sentiment');
  if (sent) {
    const fg = STATE.data.feargreed;
    sent.innerHTML = `
      ${fg ? `
        <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:12px;">
          <div style="font-family:monospace;font-size:11px;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px">CRYPTO FEAR & GREED</div>
          <div class="fg-meter">
            <div class="fg-number ${sentimentClass(fg.sentiment)}" style="font-size:42px">${fg.value}</div>
            <div class="fg-label ${sentimentClass(fg.sentiment)}">${fg.label.toUpperCase()}</div>
            <div class="fg-bar-track" style="width:100%;margin-top:8px">
              <div class="fg-bar-fill" style="width:${fg.value}%;background:${sentimentColor(fg.sentiment)}"></div>
            </div>
          </div>
        </div>
      ` : ''}
      <div style="background:var(--bg-panel);border:1px solid var(--border);border-radius:8px;padding:12px;">
        <div style="font-family:monospace;font-size:11px;color:var(--text-muted);letter-spacing:1px;margin-bottom:8px">7-DAY F&G HISTORY</div>
        <div style="display:flex;gap:4px;align-items:flex-end;height:40px">
          ${(fg?.history || []).slice(0,7).reverse().map(h => `
            <div style="flex:1;background:${sentimentColor(sentimentClassInv(h.label))};height:${h.value/100*40}px;border-radius:2px;min-height:3px" title="${h.label}: ${h.value}"></div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

function sentimentClassInv(label) {
  if (!label) return 'neutral';
  const l = label.toLowerCase();
  if (l.includes('extreme fear')) return 'extreme_fear';
  if (l.includes('fear')) return 'fear';
  if (l.includes('extreme greed')) return 'extreme_greed';
  if (l.includes('greed')) return 'greed';
  return 'neutral';
}

async function renderThreatsView() {
  // Try to load urlhaus if not loaded
  if (!STATE.data.urlhaus) {
    try {
      STATE.data.urlhaus = await api('/api/threats/urlhaus');
    } catch (e) {}
  }

  // Ransomware
  const rw = document.getElementById('threats-ransomware-full');
  if (rw && STATE.data.ransomware) {
    rw.innerHTML = `<table class="threats-full-table">
      <thead><tr><th>Group</th><th>Victim</th><th>Country</th><th>Sector</th><th>Date</th></tr></thead>
      <tbody>${STATE.data.ransomware.victims.slice(0, 50).map(v => `
        <tr>
          <td style="color:var(--sev-critical);font-weight:700;cursor:pointer;text-decoration:underline dotted" onclick="showRansomwareGroupDetail('${escAttr(v.group)}')" title="Click for details">${escHtml(v.group)}</td>
          <td style="color:var(--text-primary)">${escHtml(v.victim)}</td>
          <td>${v.country || '—'}</td>
          <td style="color:var(--text-muted)">${v.sector || '—'}</td>
          <td>${v.date ? v.date.slice(0,10) : '—'}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  // Feodo C2
  const feodo = document.getElementById('threats-feodo-full');
  if (feodo && STATE.data.feodo) {
    feodo.innerHTML = `<table class="threats-full-table">
      <thead><tr><th>IP</th><th>Port</th><th>Type</th></tr></thead>
      <tbody>${STATE.data.feodo.iocs.slice(0, 50).map(i => `
        <tr>
          <td style="color:var(--sev-high)">${escHtml(i.ip)}</td>
          <td>${i.port || '—'}</td>
          <td style="color:var(--text-muted)">${i.type}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  // URLhaus
  const uh = document.getElementById('threats-urlhaus-full');
  if (uh && STATE.data.urlhaus) {
    uh.innerHTML = `<table class="threats-full-table">
      <thead><tr><th>URL</th><th>Status</th><th>Threat</th></tr></thead>
      <tbody>${STATE.data.urlhaus.urls.slice(0, 50).map(u => `
        <tr>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sev-medium)">${escHtml(u.url)}</td>
          <td>${u.status}</td>
          <td style="color:var(--text-muted)">${u.threat || '—'}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  // APT Group Search — load from APTmap if not cached
  const aptLoading = document.getElementById('apt-loading');
  if (!STATE.data.aptGroups) {
    try {
      STATE.data.aptGroups = await api('/api/geo/apt-groups');
    } catch (e) {
      if (aptLoading) aptLoading.textContent = '⚠ Failed to load APT data';
    }
  }
  if (STATE.data.aptGroups) {
    if (aptLoading) aptLoading.remove();
    const q = (document.getElementById('apt-search-input') || {}).value || '';
    renderAptResults(STATE.data.aptGroups.groups || [], q);
  }
}

// ── APT Search helpers ─────────────────────────────────────────
function filterAptGroups(query) {
  if (!STATE.data.aptGroups) return;
  renderAptResults(STATE.data.aptGroups.groups || [], query);
}

function renderAptResults(groups, query) {
  const el = document.getElementById('apt-results');
  const countEl = document.getElementById('apt-search-count');
  if (!el) return;
  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? groups.filter(g =>
        (g.name      || '').toLowerCase().includes(q) ||
        (g.aliases   || '').toLowerCase().includes(q) ||
        (g.country   || '').toLowerCase().includes(q) ||
        (g.actor     || '').toLowerCase().includes(q) ||
        (g.description || '').toLowerCase().includes(q))
    : groups;

  if (countEl) {
    countEl.textContent = q
      ? `${filtered.length} / ${groups.length} groups`
      : `${groups.length} groups`;
  }

  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state">No APT groups match "${escHtml(q)}"</div>`;
    return;
  }
  el.innerHTML = filtered.slice(0, 120).map(g => {
    const sevClass = `sev-${g.severity || 'medium'}`;
    const flag = g.country ? `<span class="apt-item-country">${escHtml(g.country)}</span>` : '';
    return `<div class="apt-item" onclick="showAptGroupDetail('${escAttr(g.name)}')">
      <div class="apt-item-header">
        <span class="apt-item-name">${escHtml(g.name)}</span>
        <span class="apt-item-sev ${sevClass}">${(g.severity||'?').toUpperCase()}</span>
      </div>
      <div class="apt-item-meta">
        ${flag}
        ${g.aliases ? `<span class="apt-item-alias" title="Aliases">${escHtml(g.aliases.split(',')[0].trim())}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function showAptGroupDetail(name) {
  if (!STATE.data.aptGroups) return;
  const g = (STATE.data.aptGroups.groups || []).find(x => x.name === name);
  if (!g) return;

  const sevClass = `sev-${g.severity || 'medium'}`;
  const sevLabel = (g.severity || '?').toUpperCase();

  const rows = [
    ['Name',         escHtml(g.name)],
    ['Aliases',      g.aliases  ? escHtml(g.aliases)  : '—'],
    ['Sponsor/Actor',g.actor    ? escHtml(g.actor)    : '—'],
    ['Country',      g.country  ? escHtml(g.country)  : '—'],
    ['Active Since', g.active   ? escHtml(g.active)   : '—'],
    ['Targets',      g.target   ? escHtml(g.target)   : '—'],
    ['Tools / TTPs', g.ttps     ? escHtml(g.ttps)     : '—'],
    ['Motivations',  g.motivations && g.motivations.length
                       ? escHtml(g.motivations.join(', '))
                       : '—'],
    ['Severity',     `<span class="${sevClass}" style="font-weight:700">${sevLabel}</span>`],
  ].map(([label, value]) => `
    <div class="modal-detail-row">
      <span class="modal-detail-label">${label}</span>
      <span class="modal-detail-value">${value}</span>
    </div>`).join('');

  const desc = g.description
    ? `<div style="margin-top:12px;padding:10px;background:var(--bg-secondary);border-radius:6px;font-size:12px;color:var(--text-secondary);line-height:1.6">${escHtml(g.description)}</div>`
    : '';

  const mapLink = (g.lat || g.lon)
    ? `<div style="margin-top:8px">
        <button class="modal-action-btn" onclick="closeModal();setView('map');flyTo(${g.lat},${g.lon},5)">
          🗺 Show on Map
        </button>
        <button class="modal-action-btn" onclick="closeModal();setView('map');toggleLayerOn('apt')">
          🎯 Enable APT Layer
        </button>
       </div>`
    : '';

  const srcLink = g.source_url
    ? `<div style="margin-top:6px;font-size:10px;color:var(--text-muted)">
        Source: <a href="${escHtml(g.source_url)}" target="_blank" rel="noopener" style="color:var(--accent-blue)">${escHtml(g.source_url)}</a>
       </div>`
    : '';

  openModal(
    `🎯 ${escHtml(g.name)} — APT Intelligence`,
    rows + desc + mapLink + srcLink
  );
}

function toggleLayerOn(layerId) {
  if (!STATE.layers[layerId]) toggleLayer(layerId);
}


async function renderInfraView() {
  // Chokepoints
  if (!STATE.data.chokepoints) await loadChokepoints();
  const choke = document.getElementById('infra-chokepoints');
  if (choke && STATE.data.chokepoints) {
    choke.innerHTML = STATE.data.chokepoints.chokepoints.map(c => `
      <div class="chokepoint-card">
        <div class="chokepoint-name">⚓ ${escHtml(c.name)}</div>
        <div class="chokepoint-meta">
          <span>${c.daily_barrels_M}M bbl/day</span>
          <span>${c.region}</span>
          <span class="sev-badge ${c.risk}">${c.risk.toUpperCase()}</span>
        </div>
      </div>
    `).join('');
  }

  // Cables list
  if (!STATE.data.cables) await loadCables();
  const cables = document.getElementById('infra-cables');
  if (cables && STATE.data.cables) {
    cables.innerHTML = `<table class="infra-table">
      <thead><tr><th>#</th><th>Cable Name</th></tr></thead>
      <tbody>${STATE.data.cables.cables.slice(0, 30).map((c, i) => `
        <tr><td style="color:var(--text-muted)">${i+1}</td><td>${escHtml(c.name || '—')}</td></tr>
      `).join('')}</tbody>
    </table>
    <div style="font-family:monospace;font-size:10px;color:var(--text-muted);padding:8px;text-align:center">
      Total: ${STATE.data.cables.count} cables · Source: TeleGeography
    </div>`;
  }

  // Datacenters
  if (!STATE.data.datacenters) await loadDatacenters();
  const dcs = document.getElementById('infra-datacenters');
  if (dcs && STATE.data.datacenters) {
    dcs.innerHTML = `<table class="infra-table">
      <thead><tr><th>Name</th><th>City</th><th>Country</th></tr></thead>
      <tbody>${STATE.data.datacenters.facilities.slice(0, 30).map(f => `
        <tr>
          <td>${escHtml(f.name)}</td>
          <td style="color:var(--text-muted)">${f.city || '—'}</td>
          <td style="font-family:monospace;font-size:10px;color:var(--accent-blue)">${f.country || '—'}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  // Space weather
  const sw = document.getElementById('infra-spaceweather');
  if (sw) {
    try {
      if (!STATE.data.spaceweather) STATE.data.spaceweather = await api('/api/spaceweather');
      const latest = STATE.data.spaceweather.latest;
      sw.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="chokepoint-card">
            <div class="chokepoint-name">☀ Solar Cycle Data (Latest)</div>
            <div class="chokepoint-meta">
              <span>SSN: ${latest.ssn || latest.smoothed_ssn || '—'}</span>
              <span>Radio Flux: ${latest.radio_flux || latest['10.7cm'] || '—'}</span>
              <span>Date: ${latest.time_tag || latest.date || '—'}</span>
            </div>
          </div>
          <div style="font-family:monospace;font-size:10px;color:var(--text-muted);padding:4px">
            Higher SSN = greater solar activity, aurora activity, potential satellite disruptions
          </div>
        </div>
      `;
    } catch (e) {
      sw.innerHTML = `<div class="empty-state">Space weather unavailable</div>`;
    }
  }

  // Climate zones
  const climate = document.getElementById('infra-climate');
  if (climate) {
    try {
      if (!STATE.data.climate) STATE.data.climate = await api('/api/climate');
      climate.innerHTML = STATE.data.climate.zones.map(z => `
        <div class="climate-item">
          <div style="display:flex;align-items:center;gap:6px">
            <div class="climate-zone">${z.zone}</div>
            <span class="climate-anomaly ${z.anomaly}">${z.anomaly.toUpperCase()}</span>
          </div>
          <div class="climate-meta">
            🌡 ${z.temp_c}°C · 💨 ${z.windspeed} km/h · 🌧 ${z.precip_mm ?? '—'} mm
          </div>
        </div>
      `).join('');
    } catch (e) {
      climate.innerHTML = `<div class="empty-state">Climate data unavailable</div>`;
    }
  }
}

// ──────────────────────────────────────────────────────────
// Breaches view — live data from Supabase
// ──────────────────────────────────────────────────────────
const SUPABASE_URL  = 'https://pjhqpefqmvcnlierfwvz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqaHFwZWZxbXZjbmxpZXJmd3Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDUzNzIsImV4cCI6MjA4Nzc4MTM3Mn0.bG_x3zw2iNNn3-UYvS9C0hk5R9iHP2JYRmOeRwdhGSk';

let _supabaseClient = null;
function getSupabaseClient() {
  if (!_supabaseClient) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      throw new Error('Supabase client library not loaded');
    }
    _supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  }
  return _supabaseClient;
}

// Parse PostGIS EWKB hex-encoded geography/geometry column → { lat, lng }
function parseLeakLocation(item) {
  // Prefer plain numeric lat/lng fields if present
  if (item.latitude != null && item.longitude != null) {
    const la = parseFloat(item.latitude), lo = parseFloat(item.longitude);
    if (!isNaN(la) && !isNaN(lo)) return { lat: la, lng: lo };
  }
  // Parse hex-encoded EWKB (PostGIS geography column returned by Supabase REST)
  const loc = item.location;
  if (!loc || typeof loc !== 'string') return { lat: null, lng: null };
  try {
    const isLE = loc.substring(0, 2) === '01';
    const typeBytes = loc.substring(2, 10).match(/../g).map(b => parseInt(b, 16));
    const wkbType = isLE
      ? (typeBytes[0] | (typeBytes[1] << 8) | (typeBytes[2] << 16) | (typeBytes[3] << 24)) >>> 0
      : ((typeBytes[0] << 24) | (typeBytes[1] << 16) | (typeBytes[2] << 8) | typeBytes[3]) >>> 0;
    const xOff = (wkbType & 0x20000000) ? 18 : 10; // SRID prefix adds 8 hex chars = 4 bytes
    const readF64 = (off) => {
      const b = loc.substring(off, off + 16).match(/../g).map(h => parseInt(h, 16));
      if (isLE) b.reverse();
      return new DataView(new Uint8Array(b).buffer).getFloat64(0);
    };
    return { lng: readF64(xOff), lat: readF64(xOff + 16) };
  } catch {
    return { lat: null, lng: null };
  }
}

async function fetchLeakRecords() {
  const client = getSupabaseClient();
  const PAGE = 1000;
  let all = [], from = 0;
  while (true) {
    const { data, error } = await client
      .from('leaks')
      .select('*')
      .order('date', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all.map(item => {
    const { lat, lng } = parseLeakLocation(item);
    return { ...item, lat, lng };
  });
}

async function renderBreachesView(force = false) {
  const content = document.getElementById('breaches-content');
  const lastUpdated = document.getElementById('breaches-last-updated');
  if (!content) return;

  if (!force && STATE.data.breaches) {
    renderBreachesTable(STATE.data.breaches);
    return;
  }

  content.innerHTML = '<div class="loading-pulse">Fetching live breach records…</div>';
  try {
    STATE.data.breaches = await fetchLeakRecords();
    if (lastUpdated) lastUpdated.textContent = `Updated: ${new Date().toUTCString()}`;
    renderBreachesTable(STATE.data.breaches);
  } catch (e) {
    console.error('Breaches fetch error:', e);
    content.innerHTML = `<div class="empty-state">⚠ Unable to load breach data. Please try again later.</div>`;
  }
}

function renderBreachesTable(records) {
  const content = document.getElementById('breaches-content');
  if (!content) return;
  if (!records || records.length === 0) {
    content.innerHTML = '<div class="empty-state">No breach records found.</div>';
    return;
  }
  content.innerHTML = `
    <div class="threats-grid">
      <div class="threat-col" style="grid-column:1/-1">
        <h3 class="threat-h3">🔓 RECENT DATA BREACHES (${records.length})</h3>
        <table class="threats-full-table">
          <thead>
            <tr>
              <th>Leak / Organisation</th>
              <th>Group</th>
              <th>Date</th>
              <th>Details</th>
              <th>Coordinates</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr>
                <td style="color:var(--sev-critical);font-weight:700">${escHtml(r.leak || '—')}</td>
                <td style="color:var(--sev-high)">${escHtml(r.group || '—')}</td>
                <td style="color:var(--text-muted)">${r.date ? String(r.date).slice(0, 10) : '—'}</td>
                <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(r.data || '—')}</td>
                <td style="font-family:var(--font-mono);font-size:10px;color:var(--accent-blue)">
                  ${r.lat !== null && r.lng !== null
                    ? `<span style="cursor:pointer;text-decoration:underline dotted" onclick="setView('map');flyTo(${r.lat},${r.lng},6)" title="Show on map">${Number(r.lat).toFixed(3)}, ${Number(r.lng).toFixed(3)}</span>`
                    : '—'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ──────────────────────────────────────────────────────────
// Utility
// ──────────────────────────────────────────────────────────
function flyTo(lat, lon, zoom = 6) {
  if (!STATE.map) return;
  STATE.map.flyTo([lat, lon], zoom, { duration: 1 });
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatPrice(price, currency) {
  if (price === undefined || price === null) return '—';
  const p = Number(price);
  if (isNaN(p)) return '—';
  const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥' }[currency] || '';
  if (p >= 10000) return sym + p.toLocaleString('en', { maximumFractionDigits: 0 });
  if (p >= 100)   return sym + p.toLocaleString('en', { maximumFractionDigits: 2 });
  if (p >= 1)     return sym + p.toLocaleString('en', { maximumFractionDigits: 4 });
  return sym + p.toLocaleString('en', { maximumFractionDigits: 6 });
}

function fmtBig(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n/1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n/1e9).toFixed(1) + 'B';
  if (n >= 1e6)  return '$' + (n/1e6).toFixed(1) + 'M';
  return '$' + n.toLocaleString();
}

function timeAgo(ts) {
  if (!ts) return '';
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  const diff = Date.now() - ms;
  if (diff < 60000) return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}

function timeAgoStr(str) {
  if (!str) return '';
  try { return timeAgo(new Date(str).getTime()); }
  catch { return str; }
}

// ──────────────────────────────────────────────────────────
// Refresh all
// ──────────────────────────────────────────────────────────
async function refreshAll() {
  toast('Refreshing all data…', 'info', 2000);
  await Promise.allSettled([
    loadSignals(),
    loadEarthquakes(),
    loadDisasters(),
    loadFires(),
    loadNews(),
    loadMarkets(),
    loadThreats(),
  ]);
  toast('Data refreshed', 'ok', 2000);
}

// ──────────────────────────────────────────────────────────
// Auto-refresh schedule
// ──────────────────────────────────────────────────────────
function scheduleRefresh() {
  setInterval(loadEarthquakes, 3 * 60 * 1000);   // every 3 min
  setInterval(loadFires,       10 * 60 * 1000);  // every 10 min
  setInterval(loadDisasters,   10 * 60 * 1000);  // every 10 min
  setInterval(loadNews,        5 * 60 * 1000);   // every 5 min
  setInterval(loadMarkets,     5 * 60 * 1000);   // every 5 min
  setInterval(loadThreats,     15 * 60 * 1000);  // every 15 min
  setInterval(loadSignals,     5 * 60 * 1000);   // every 5 min
  setInterval(() => {
    if (STATE.layers.adsbMilitary) loadAdsbMilitary();
  }, 45 * 1000); // every 45s for military aviation
}

// ──────────────────────────────────────────────────────────
// MILITARY BASES
// ──────────────────────────────────────────────────────────
async function loadMilitaryBases() {
  try {
    const data = await api('/api/infrastructure/military-bases');
    STATE.data.military = data;
    return data;
  } catch (e) { return null; }
}

function renderMilitaryLayer() {
  clearMapLayer('military');
  if (!STATE.data.military) return;
  const group = L.layerGroup();
  const typeColor = {
    'china': '#ef4444', 'russia': '#f97316', 'us-nato': '#3b82f6',
    'uk': '#8b5cf6', 'france': '#06b6d4', 'india': '#f59e0b',
    'italy': '#84cc16', 'uae': '#10b981', 'us-domestic': '#60a5fa',
  };
  STATE.data.military.bases.forEach(b => {
    const color = typeColor[b.type] || '#94a3b8';
    const icon = L.divIcon({
      html: `<div style="width:10px;height:10px;background:${color};border:2px solid #fff;transform:rotate(45deg);"></div>`,
      iconSize: [10, 10], iconAnchor: [5, 5], className: '',
    });
    const m = L.marker([b.lat, b.lon], { icon });
    m.bindPopup(`
      <div class="popup-content">
        <h4>⚔ ${escHtml(b.name)}</h4>
        <p><strong>Country:</strong> ${escHtml(b.country)}</p>
        <p><strong>Operator:</strong> ${escHtml(b.type.toUpperCase())} — ${escHtml(b.arm || '')}</p>
        <p><strong>Status:</strong> ${b.status}</p>
        ${b.description ? `<p>${escHtml(b.description)}</p>` : ''}
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.military = group;
}

// ──────────────────────────────────────────────────────────
// PIPELINES
// ──────────────────────────────────────────────────────────
async function loadPipelines() {
  try {
    const data = await api('/api/infrastructure/pipelines');
    STATE.data.pipelines = data;
    return data;
  } catch (e) { return null; }
}

function renderPipelinesLayer() {
  clearMapLayer('pipelines');
  if (!STATE.data.pipelines) return;
  const group = L.layerGroup();
  STATE.data.pipelines.pipelines.forEach(p => {
    const latlngs = p.points.map(pt => [pt[1], pt[0]]);
    const color = p.type === 'oil' ? '#f97316' : '#34d399';
    const line = L.polyline(latlngs, {
      color, weight: 2.5, opacity: 0.8,
      dashArray: p.status !== 'operating' ? '6,4' : null,
    });
    line.bindPopup(`
      <div class="popup-content">
        <h4>${p.type === 'oil' ? '🛢' : '🔥'} ${escHtml(p.name)}</h4>
        <p><strong>Type:</strong> ${p.type} | <strong>Status:</strong> ${p.status}</p>
        <p><strong>Capacity:</strong> ${p.capacity}</p>
        <p><strong>Length:</strong> ${p.length}</p>
        <p><strong>Operator:</strong> ${escHtml(p.operator)}</p>
        <p><strong>Countries:</strong> ${(p.countries || []).join(', ')}</p>
      </div>
    `);
    group.addLayer(line);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.pipelines = group;
}

// ──────────────────────────────────────────────────────────
// PORTS
// ──────────────────────────────────────────────────────────
async function loadPorts() {
  try {
    const data = await api('/api/infrastructure/ports');
    STATE.data.ports = data;
    return data;
  } catch (e) { return null; }
}

function renderPortsLayer() {
  clearMapLayer('ports');
  if (!STATE.data.ports) return;
  const group = L.layerGroup();
  const typeColor = {
    container: '#38bdf8', oil: '#fb923c', lng: '#4ade80',
    naval: '#f43f5e', mixed: '#a78bfa', bulk: '#fbbf24',
  };
  STATE.data.ports.ports.forEach(p => {
    const color = typeColor[p.type] || '#94a3b8';
    const m = L.circleMarker([p.lat, p.lon], {
      radius: p.rank && p.rank <= 10 ? 7 : 5,
      fillColor: color, color: '#fff', weight: 1.5, fillOpacity: 0.85,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>⚓ ${escHtml(p.name)}</h4>
        <p><strong>Country:</strong> ${escHtml(p.country)} | <strong>Type:</strong> ${p.type}</p>
        ${p.rank ? `<p><strong>Rank:</strong> #${p.rank}</p>` : ''}
        <p>${escHtml(p.note)}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.ports = group;
}

// ──────────────────────────────────────────────────────────
// STRATEGIC WATERWAYS
// ──────────────────────────────────────────────────────────
async function loadWaterways() {
  try {
    const data = await api('/api/geo/waterways');
    STATE.data.waterways = data;
    return data;
  } catch (e) { return null; }
}

function renderWaterwaysLayer() {
  clearMapLayer('waterways');
  if (!STATE.data.waterways) return;
  const group = L.layerGroup();
  STATE.data.waterways.waterways.forEach(w => {
    const icon = L.divIcon({
      html: `<div style="background:#0ea5e9;color:#fff;padding:2px 5px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;">${escHtml(w.name)}</div>`,
      iconAnchor: [0, 0], className: '',
    });
    const m = L.marker([w.lat, w.lon], { icon });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🌊 ${escHtml(w.name)}</h4>
        <p>${escHtml(w.description)}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.waterways = group;
}

// ──────────────────────────────────────────────────────────
// INTEL HOTSPOTS
// ──────────────────────────────────────────────────────────
async function loadHotspots() {
  try {
    const data = await api('/api/geo/hotspots');
    STATE.data.hotspots = data;
    return data;
  } catch (e) { return null; }
}

function renderHotspotsLayer() {
  clearMapLayer('hotspots');
  if (!STATE.data.hotspots) return;
  const group = L.layerGroup();
  STATE.data.hotspots.hotspots.forEach(h => {
    const score = h.escalationScore || 1;
    const radius = 6 + score * 2;
    const color = score >= 5 ? '#ef4444' : score >= 4 ? '#f97316' : score >= 3 ? '#fbbf24' : '#34d399';
    const m = L.circleMarker([h.lat, h.lon], {
      radius, fillColor: color, color: '#fff', weight: 1, fillOpacity: 0.75,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🔥 ${escHtml(h.name)} — ${escHtml(h.subtext || '')}</h4>
        <p><strong>Escalation Score:</strong> ${score}/5</p>
        <p>${escHtml(h.description || '')}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.hotspots = group;
}

// ──────────────────────────────────────────────────────────
// CONFLICT ZONES
// ──────────────────────────────────────────────────────────
async function loadConflicts() {
  try {
    const data = await api('/api/geo/conflict-zones');
    STATE.data.conflicts = data;
    return data;
  } catch (e) { return null; }
}

function renderConflictsLayer() {
  clearMapLayer('conflicts');
  if (!STATE.data.conflicts) return;
  const group = L.layerGroup();
  STATE.data.conflicts.conflicts.forEach(c => {
    const color = c.intensity === 'high' ? '#ef444480' : '#f9731660';
    if (c.coords && c.coords.length >= 2) {
      const latlngs = c.coords.map(p => [p[0], p[1]]);
      const poly = L.polygon(latlngs, {
        color: c.intensity === 'high' ? '#ef4444' : '#f97316',
        fillColor: color, fillOpacity: 0.25, weight: 2,
      });
      poly.bindPopup(`
        <div class="popup-content">
          <h4>⚔ ${escHtml(c.name)}</h4>
          <p><strong>Intensity:</strong> ${c.intensity}</p>
          <p><strong>Parties:</strong> ${(c.parties || []).join(' vs ')}</p>
          <p><strong>Casualties:</strong> ${c.casualties}</p>
          <p>${escHtml(c.description)}</p>
        </div>
      `);
      group.addLayer(poly);
    }
    const cm = L.circleMarker(c.center, {
      radius: 8, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 0.9,
    });
    cm.bindPopup(`<div class="popup-content"><h4>⚔ ${escHtml(c.name)}</h4><p>${escHtml(c.description)}</p></div>`);
    group.addLayer(cm);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.conflicts = group;
}

// ──────────────────────────────────────────────────────────
// GAMMA IRRADIATORS (IAEA DIIF)
// ──────────────────────────────────────────────────────────
async function loadGamma() {
  try {
    const data = await api('/api/infrastructure/gamma-irradiators');
    STATE.data.gamma = data;
    return data;
  } catch (e) { return null; }
}

function renderGammaLayer() {
  clearMapLayer('gamma');
  if (!STATE.data.gamma) return;
  const group = L.layerGroup();
  STATE.data.gamma.irradiators.forEach(g => {
    const m = L.circleMarker([g.lat, g.lon], {
      radius: 4, fillColor: '#e879f9', color: '#a21caf', weight: 1, fillOpacity: 0.8,
    });
    m.bindPopup(`
      <div class="popup-content">
        <h4>☢ Gamma Irradiator</h4>
        <p><strong>City:</strong> ${escHtml(g.city)}</p>
        <p><strong>Country:</strong> ${escHtml(g.country)}</p>
        <p><em>Source: IAEA DIIF Database</em></p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.gamma = group;
}

// ──────────────────────────────────────────────────────────
// APT GROUPS
// ──────────────────────────────────────────────────────────
async function loadApt() {
  try {
    const data = await api('/api/geo/apt-groups');
    STATE.data.apt = data;
    return data;
  } catch (e) { return null; }
}

function renderAptLayer() {
  clearMapLayer('apt');
  if (!STATE.data.apt) return;
  const group = L.layerGroup();
  const sevColor = { critical: '#ef4444', high: '#f97316', medium: '#fbbf24', low: '#34d399' };
  STATE.data.apt.groups.forEach(g => {
    if (!g.lat || !g.lon || (g.lat === 0 && g.lon === 0)) return;
    // Jitter overlapping pts slightly
    const jlat = g.lat + (Math.random() - 0.5) * 0.4;
    const jlon = g.lon + (Math.random() - 0.5) * 0.4;
    const sc = sevColor[g.severity] || '#818cf8';
    const icon = L.divIcon({
      html: `<div style="background:#0f0a2e;border:1.5px solid ${sc};color:${sc};padding:2px 5px;border-radius:3px;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 0 6px ${sc}88;">${escHtml(g.id)}</div>`,
      iconAnchor: [0, 0], className: '',
    });
    const m = L.marker([jlat, jlon], { icon });
    const activeTag = g.active === false ? '<span style="color:#ef4444">⬛ DISRUPTED</span>' : '<span style="color:#4ade80">▶ ACTIVE</span>';
    m.bindPopup(`
      <div class="popup-content" style="min-width:260px">
        <h4 style="color:${sc}">💻 ${escHtml(g.name)}</h4>
        <p>${activeTag} | Severity: <strong style="color:${sc}">${(g.severity||'').toUpperCase()}</strong></p>
        <p><strong>Actor:</strong> ${escHtml(g.actor)}</p>
        <p><strong>Aliases:</strong> <em>${escHtml(g.aliases)}</em></p>
        <p><strong>Targets:</strong> ${escHtml(g.target)}</p>
        <p><strong>TTPs:</strong> ${escHtml(g.ttps)}</p>
        <p><strong>Active:</strong> ${escHtml(g.active)}</p>
        <p style="color:#94a3b8;font-size:11px">${escHtml(g.description)}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.apt = group;
}

// ──────────────────────────────────────────────────────────
// RANSOMWARE MAP LAYER
// ──────────────────────────────────────────────────────────
async function loadRansomwareMap() {
  try {
    const data = await api('/api/threats/ransomware-map');
    STATE.data.ransomwareMap = data;
    return data;
  } catch (e) { return null; }
}

function renderRansomwareLayer() {
  if (STATE.mapLayers.ransomwareMap) {
    STATE.map.removeLayer(STATE.mapLayers.ransomwareMap);
    delete STATE.mapLayers.ransomwareMap;
  }
  if (!STATE.data.ransomwareMap) return;
  const group = L.layerGroup();
  STATE.data.ransomwareMap.groups.forEach(g => {
    if (!g.lat || !g.lon || (g.lat === 0 && g.lon === 0)) return;
    const icon = L.divIcon({
      html: `<div style="background:#18181b;border:1.5px solid #ef4444;color:#ef4444;padding:2px 5px;border-radius:3px;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 0 6px #ef444488;">🏴‍☠️ ${escHtml(g.name)}</div>`,
      iconAnchor: [0, 0], className: '',
    });
    const m = L.marker([g.lat + (Math.random()-0.5)*0.6, g.lon + (Math.random()-0.5)*0.6], { icon });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🏴‍☠️ ${escHtml(g.name)}</h4>
        <p><strong>Country:</strong> ${escHtml(g.country)}</p>
        <p><strong>Status:</strong> ${g.active ? '<span style="color:#4ade80">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</p>
        <p><strong>Victims:</strong> ${g.victims || '—'}</p>
        <p>${escHtml(g.description)}</p>
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.ransomwareMap = group;
}

// ──────────────────────────────────────────────────────────
// BREACHES MAP LAYER — Live data from Supabase
// ──────────────────────────────────────────────────────────
function renderBreachesMapLayer() {
  if (STATE.mapLayers.breachesMap) {
    STATE.map.removeLayer(STATE.mapLayers.breachesMap);
    delete STATE.mapLayers.breachesMap;
  }
  const records = STATE.data.breachesMap;
  if (!records || records.length === 0) return;
  const group = L.layerGroup();
  let plotted = 0;
  records.forEach(r => {
    if (r.lat === null || r.lat === undefined || r.lng === null || r.lng === undefined) return;
    const lat = parseFloat(r.lat), lng = parseFloat(r.lng);
    if (isNaN(lat) || isNaN(lng)) return;
    plotted++;
    const label = (r.leak || '?').substring(0, 28);
    const icon = L.divIcon({
      html: `<div style="background:#0f0f14;border:1.5px solid #a855f7;color:#a855f7;padding:2px 6px;border-radius:4px;font-size:9px;font-weight:700;white-space:nowrap;box-shadow:0 0 8px #a855f7aa;letter-spacing:0.02em;">🔓 ${escHtml(label)}</div>`,
      iconAnchor: [0, 0], className: '',
    });
    const dateStr = r.date
      ? new Date(r.date).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '—';
    const m = L.marker([lat, lng], { icon });
    m.bindPopup(`
      <div class="popup-content" style="min-width:200px">
        <h4 style="color:#a855f7;margin-bottom:6px">🔓 ${escHtml(r.leak || '—')}</h4>
        <p><strong>Group / Threat Actor:</strong> ${escHtml(r.group || '—')}</p>
        <p><strong>Date:</strong> ${escHtml(dateStr)}</p>
        <p><strong>Coordinates:</strong> ${lat.toFixed(4)}°, ${lng.toFixed(4)}°</p>
        ${r.data ? `<p style="margin-top:4px;font-size:11px;color:#94a3b8">${escHtml(r.data)}</p>` : ''}
      </div>
    `);
    group.addLayer(m);
  });
  STATE.map.addLayer(group);
  STATE.mapLayers.breachesMap = group;
  if (plotted > 0) toast(`🔓 ${plotted} breach locations loaded`, 'info', 3000);
}

// Called by the BREACHES nav button — switches to map and shows breach pins
async function showBreachesOnMap() {
  setView('map');
  // Ensure the breachesMap layer state is on
  STATE.layers.breachesMap = true;
  const btn = document.getElementById('layer-breachesMap');
  if (btn) btn.classList.add('active');
  if (STATE.data.breaches && STATE.data.breaches.length > 0) {
    STATE.data.breachesMap = STATE.data.breaches;
    renderBreachesMapLayer();
  } else {
    toast('Fetching breach locations…', 'info', 2000);
    try {
      const data = await fetchLeakRecords();
      STATE.data.breaches = data;
      STATE.data.breachesMap = data;
      renderBreachesMapLayer();
    } catch (e) {
      console.error('showBreachesOnMap error:', e);
      toast('Failed to load breach data', 'error', 4000);
    }
  }
}

// ──────────────────────────────────────────────────────────
async function loadSatellites(group = 'active') {
  if (STATE.data.satellites && STATE.data.satellites._group === group) return STATE.data.satellites;
  try {
    const [tleData, issData] = await Promise.allSettled([
      api(`/api/satellites/tle?group=${group}`),
      api('/api/satellites/iss'),
    ]);
    const sats = tleData.status === 'fulfilled' ? tleData.value.satellites : [];
    const iss  = issData.status  === 'fulfilled' ? issData.value  : null;
    STATE.data.satellites = { sats, iss, _group: group };
  } catch (e) {
    STATE.data.satellites = { sats: [], iss: null, _group: group };
  }
  return STATE.data.satellites;
}

function renderSatellitesLayer() {
  clearMapLayer('satellites');
  const data = STATE.data.satellites;
  if (!data || !STATE.layers.satellites) return;

  const group = L.layerGroup();

  // ISS — special highlight
  if (data.iss && data.iss.lat != null && data.iss.lon != null) {
    const issIcon = L.divIcon({
      html: `<div class="sat-icon sat-iss" title="ISS">🛸</div>`,
      className: '', iconSize: [24, 24], iconAnchor: [12, 12],
    });
    const issM = L.marker([data.iss.lat, data.iss.lon], { icon: issIcon });
    issM.bindPopup(`
      <div class="popup-content">
        <h4>🛸 International Space Station</h4>
        <p><strong>Lat:</strong> ${Number(data.iss.lat).toFixed(4)}</p>
        <p><strong>Lon:</strong> ${Number(data.iss.lon).toFixed(4)}</p>
        <p><strong>Alt:</strong> ~400 km</p>
        <p style="color:var(--accent-blue);font-size:10px">Real-time position via Open Notify</p>
      </div>
    `);
    group.addLayer(issM);
  }

  // Other satellites
  const SAT_COLORS = {
    'STARLINK':  '#60a5fa',
    'GPS':       '#4ade80',
    'MILITARY':  '#f87171',
    'WEATHER':   '#fb923c',
    'STATION':   '#facc15',
    'DEFAULT':   '#a78bfa',
  };

  (data.sats || []).forEach(s => {
    if (s.lat == null || s.lon == null) return;
    const nm = (s.name || '').toUpperCase();
    let col = SAT_COLORS.DEFAULT;
    if (nm.includes('STARLINK')) col = SAT_COLORS.STARLINK;
    else if (nm.includes('GPS'))  col = SAT_COLORS.GPS;
    else if (nm.includes('NROL') || nm.includes('USA ') || nm.includes('MILITARY')) col = SAT_COLORS.MILITARY;
    else if (nm.includes('NOAA') || nm.includes('METEOR') || nm.includes('GOES')) col = SAT_COLORS.WEATHER;
    else if (nm.includes('ISS') || nm.includes('STATION')) col = SAT_COLORS.STATION;

    const icon = L.divIcon({
      html: `<div class="sat-dot" style="background:${col};box-shadow:0 0 4px ${col}88;"></div>`,
      className: '', iconSize: [8, 8], iconAnchor: [4, 4],
    });
    const m = L.marker([s.lat, s.lon], { icon });
    m.bindPopup(`
      <div class="popup-content">
        <h4>🛰 ${escHtml(s.name || 'Unknown')}</h4>
        <p><strong>NORAD:</strong> ${s.norad || '—'}</p>
        <p><strong>Inclination:</strong> ${s.inc != null ? Number(s.inc).toFixed(2) + '°' : '—'}</p>
        <p><strong>Altitude:</strong> ${s.alt_km != null ? Math.round(s.alt_km) + ' km' : '—'}</p>
        <p><strong>Period:</strong> ${s.period_min != null ? Number(s.period_min).toFixed(1) + ' min' : '—'}</p>
        <p><strong>Est Pos:</strong> ${Number(s.lat).toFixed(3)}, ${Number(s.lon).toFixed(3)}</p>
        <p style="color:var(--text-muted);font-size:10px">Source: CelesTrak · position estimated</p>
      </div>
    `);
    group.addLayer(m);
  });

  STATE.map.addLayer(group);
  STATE.mapLayers.satellites = group;

  toast(`Satellites: ISS + ${(data.sats || []).length} objects`, 'ok', 2000);
}

// ──────────────────────────────────────────────────────────
// SHIPS / AIS LAYER
// ──────────────────────────────────────────────────────────

// Shared canvas renderer — all circle markers batch onto one GPU canvas,
// dramatically cutting DOM nodes and repaints.
const _shipsCanvas = L.canvas({ padding: 0.5 });

// Mutex: prevents overlapping fetches when the user pans/zooms rapidly.
let _shipsFetching = false;

async function loadShips() {
  if (_shipsFetching) return STATE.data.ships || { vessels: [], count: 0 };
  _shipsFetching = true;
  const btn = document.getElementById('layer-ships');
  if (btn) btn.setAttribute('data-loading', '1');
  const bounds = STATE.map ? STATE.map.getBounds() : null;
  const zoom   = STATE.map ? Math.round(STATE.map.getZoom()) : 5;
  const params = bounds
    ? `latmin=${bounds.getSouth().toFixed(2)}&latmax=${bounds.getNorth().toFixed(2)}` +
      `&lonmin=${bounds.getWest().toFixed(2)}&lonmax=${bounds.getEast().toFixed(2)}&zoom=${zoom}`
    : `zoom=${zoom}`;
  try {
    const data = await api(`/api/ais/ships?${params}`);
    STATE.data.ships = data;
  } catch (e) {
    STATE.data.ships = { vessels: [], count: 0, error: String(e) };
  } finally {
    _shipsFetching = false;
    if (btn) btn.removeAttribute('data-loading');
  }
  return STATE.data.ships;
}

function renderShipsLayer() {
  clearMapLayer('ships');
  const data = STATE.data.ships;
  if (!data || !STATE.layers.ships) return;

  const zoom    = STATE.map ? STATE.map.getZoom() : 5;
  const vessels = data.vessels || [];

  // Category → colour map only (no emoji — faster, no font rendering)
  const SHIP_COLOR = {
    passenger: '#60a5fa', cargo:    '#a3e635', tanker:   '#f97316',
    military:  '#ef4444', fishing:  '#facc15', pilot:    '#e879f9',
    service:   '#22d3ee', pleasure: '#c084fc', other:    '#94a3b8',
  };

  const group = L.layerGroup();

  if (zoom < 10) {
    // ── Canvas circle markers — GPU-batch, handles 3 000+ ships smoothly ──
    // All markers share the single _shipsCanvas renderer (one <canvas> element)
    const radius = zoom < 5 ? 2 : zoom < 7 ? 3 : 4;
    vessels.forEach(s => {
      if (s.lat == null || s.lon == null) return;
      const color = SHIP_COLOR[s.category] || SHIP_COLOR.other;
      const m = L.circleMarker([s.lat, s.lon], {
        renderer:    _shipsCanvas,
        radius,
        fillColor:   color,
        fillOpacity: 0.88,
        color:       'rgba(0,0,0,0.3)',
        weight:      0.8,
      });
      const sog = s.sog != null ? `${Number(s.sog).toFixed(1)} kts` : '—';
      const hdg = Number(s.heading || s.cog || 0).toFixed(0);
      m.bindPopup(
        `<div class="popup-content">` +
        `<h4>🚢 ${escHtml(s.name || 'Unknown Vessel')}</h4>` +
        `<p><strong>MMSI:</strong> ${s.mmsi || '—'} &nbsp;·&nbsp; <strong>Type:</strong> ${escHtml(s.type_name || s.category || '—')}</p>` +
        `<p><strong>Speed:</strong> ${sog} &nbsp;·&nbsp; <strong>Hdg:</strong> ${hdg}°</p>` +
        `<p><strong>Status:</strong> ${escHtml(s.navstat || '—')}</p>` +
        `<p><strong>Dest:</strong> ${escHtml(s.dest || '—')}</p>` +
        `</div>`,
        { maxWidth: 260 }
      );
      group.addLayer(m);
    });
  } else {
    // ── High-zoom (≥10): directional arrow + name label ────────────────────
    vessels.forEach(s => {
      if (s.lat == null || s.lon == null) return;
      const color = SHIP_COLOR[s.category] || SHIP_COLOR.other;
      const hdg   = Number(s.heading) || Number(s.cog) || 0;
      const sog   = s.sog != null ? `${Number(s.sog).toFixed(1)} kts` : '—';
      const short = s.name ? (s.name.length > 14 ? s.name.slice(0, 13) + '…' : s.name) : '';
      const icon  = L.divIcon({
        html: `<div class="ship-icon-hi" style="--sc:${color}">` +
              `<div class="ship-hi-arrow" style="transform:rotate(${hdg}deg)">▲</div>` +
              (short ? `<span class="ship-hi-label">${escHtml(short)}</span>` : '') +
              `</div>`,
        className: '', iconSize: [22, 26], iconAnchor: [11, 13],
      });
      const m = L.marker([s.lat, s.lon], { icon });
      m.bindPopup(
        `<div class="popup-content">` +
        `<h4>🚢 ${escHtml(s.name || 'Unknown Vessel')}</h4>` +
        `<p><strong>MMSI:</strong> ${s.mmsi || '—'}</p>` +
        `<p><strong>Type:</strong> ${escHtml(s.type_name || s.category || '—')}</p>` +
        `<p><strong>Speed:</strong> ${sog} &nbsp;·&nbsp; <strong>Heading:</strong> ${hdg}°</p>` +
        `<p><strong>Status:</strong> ${escHtml(s.navstat || '—')}</p>` +
        `<p><strong>Destination:</strong> ${escHtml(s.dest || '—')}</p>` +
        `<p><strong>IMO:</strong> ${s.imo || '—'} &nbsp;·&nbsp; <strong>Call:</strong> ${escHtml(s.callsign || '—')}</p>` +
        `<p style="color:var(--text-muted);font-size:10px">Source: ${escHtml(data.source || 'AIS')} · Z${zoom}</p>` +
        `</div>`,
        { maxWidth: 280 }
      );
      group.addLayer(m);
    });
  }

  STATE.map.addLayer(group);
  STATE.mapLayers.ships = group;

  const cnt = vessels.length;
  if (cnt === 0) {
    const hint = (data.errors || []).join(' | ') || 'All AIS sources offline';
    toast(`⚓ No ships — ${hint.length > 80 ? hint.slice(0, 80) + '…' : hint}. Set AISSTREAM_API_KEY for global AIS.`, 'warn', 6000);
  } else {
    toast(`⚓ ${cnt} vessels · ${escHtml(data.source || 'AIS')} · Z${zoom}`, 'ok', 2500);
  }
}

// ──────────────────────────────────────────────────────────
// WEATHER RADAR LAYER — RainViewer (free, no API key)
// ──────────────────────────────────────────────────────────
async function loadWeatherRadar() {
  // Return cached data if still fresh (< 2 min)
  if (STATE.data.weatherRadar && STATE.data.weatherRadar._fetched && Date.now() - STATE.data.weatherRadar._fetched < 120000) {
    return STATE.data.weatherRadar;
  }
  try {
    const data = await api('/api/weather/radar');
    data._fetched = Date.now();
    STATE.data.weatherRadar = data;
    return data;
  } catch (e) {
    // Direct fallback: fetch RainViewer from browser
    try {
      const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      if (r.ok) {
        const d = await r.json();
        const past     = (d.radar || {}).past || [];
        const infrared = ((d.satellite || {}).infrared) || [];
        const latest   = past.length ? past[past.length - 1] : null;
        const latestIR = infrared.length ? infrared[infrared.length - 1] : null;
        STATE.data.weatherRadar = {
          host:             d.host || 'https://tilecache.rainviewer.com',
          latest_timestamp: latest ? latest.time : null,
          latest_path:      latest ? latest.path : null,
          satellite_path:   latestIR ? latestIR.path : null,
          _fetched: Date.now(),
        };
      }
    } catch (_) {}
    return STATE.data.weatherRadar;
  }
}

function renderWeatherLayer() {
  clearMapLayer('weather');
  const d = STATE.data.weatherRadar;
  if (!d) { toast('Weather radar: fetch failed', 'warn', 3000); return; }
  // Prefer path-based URL; fall back to timestamp-based for compatibility
  const host = d.host || 'https://tilecache.rainviewer.com';
  let tilePath = d.latest_path || null;
  if (!tilePath && d.latest_timestamp) {
    tilePath = '/v2/radar/' + d.latest_timestamp;
  }
  if (!tilePath) { toast('Weather radar: no timestamp available', 'warn', 3000); return; }
  const url = host + tilePath + '/512/{z}/{x}/{y}/4/1_1.png';
  const layer = L.tileLayer(url, {
    opacity:     0.65,
    maxZoom:     15,
    attribution: 'Weather © <a href="https://rainviewer.com">RainViewer</a>',
  });
  STATE.map.addLayer(layer);
  STATE.mapLayers.weather = layer;
  toast('🌧 Weather radar active (RainViewer)', 'ok', 2500);
}

function renderCloudLayer() {
  clearMapLayer('cloud');
  const d = STATE.data.weatherRadar;
  if (!d) { toast('Cloud layer: fetch failed', 'warn', 3000); return; }
  const host = d.host || 'https://tilecache.rainviewer.com';
  const satPath = d.satellite_path || null;
  if (!satPath) { toast('Cloud/satellite IR: no data available', 'warn', 3000); return; }
  // Satellite infrared tiles: 0/0 = grayscale no smooth
  const url = host + satPath + '/512/{z}/{x}/{y}/0/0.png';
  const layer = L.tileLayer(url, {
    opacity:     0.55,
    maxZoom:     12,
    attribution: 'Satellite IR © <a href="https://rainviewer.com">RainViewer</a>',
  });
  STATE.map.addLayer(layer);
  STATE.mapLayers.cloud = layer;
  toast('☁ Cloud/satellite IR active — cyclones & cloud cover visible', 'ok', 3000);
}

function renderTrafficOverlay() {
  clearMapLayer('traffic');
  const url = 'https://mt1.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}';
  const layer = L.tileLayer(url, {
    opacity: 0.65,
    maxZoom: 19,
    attribution: 'Traffic © Google',
  });
  STATE.map.addLayer(layer);
  STATE.mapLayers.traffic = layer;
  toast('🚥 Google Traffic overlay active', 'ok', 2500);
}

// ──────────────────────────────────────────────────────────
// HEATMAP LAYERS  — Leaflet.heat plugin
// Renders fire detections and earthquake density as smooth heatmaps
// rather than thousands of individual circle markers.
// ──────────────────────────────────────────────────────────
function renderHeatmapFiresLayer() {
  clearMapLayer('heatmapFires');
  if (!STATE.data.fires || !STATE.data.fires.fires) {
    toast('Load Fire data first (🔥 button)', 'warn', 3000);
    return;
  }
  const pts = STATE.data.fires.fires.map(f => [
    f.lat, f.lon,
    Math.min(1.0, 0.1 + (f.frp || 10) / 200),  // intensity 0.1–1.0
  ]);
  if (!pts.length) return;
  const heat = L.heatLayer(pts, {
    radius:  20,
    blur:    15,
    maxZoom: 10,
    max:     1.0,
    gradient: { 0.2: '#fbbf24', 0.5: '#f97316', 0.8: '#ef4444', 1.0: '#ffffff' },
  });
  STATE.map.addLayer(heat);
  STATE.mapLayers.heatmapFires = heat;
  toast(`🔥 Fire heatmap: ${pts.length} detections`, 'ok', 2000);
}

function renderHeatmapEQLayer() {
  clearMapLayer('heatmapEQ');
  if (!STATE.data.earthquakes || !STATE.data.earthquakes.events) {
    toast('Load Earthquake data first (🌍 button)', 'warn', 3000);
    return;
  }
  const pts = STATE.data.earthquakes.events.map(e => [
    e.lat, e.lon,
    Math.min(1.0, (e.magnitude || 1) / 9),  // normalise M0–9 to 0–1
  ]);
  if (!pts.length) return;
  const heat = L.heatLayer(pts, {
    radius:  25,
    blur:    20,
    maxZoom: 8,
    max:     1.0,
    gradient: { 0.2: '#22d3ee', 0.5: '#f59e0b', 0.8: '#ef4444', 1.0: '#ffffff' },
  });
  STATE.map.addLayer(heat);
  STATE.mapLayers.heatmapEQ = heat;
  toast(`🌍 EQ heatmap: ${pts.length} events`, 'ok', 2000);
}

// ──────────────────────────────────────────────────────────
// AI CHAT — Qwen3 via Ollama at localhost:11434
// ──────────────────────────────────────────────────────────
async function aiSendFromInput() {
  const inp = document.getElementById('ai-chat-input');
  if (inp && inp.value.trim()) aiSendMessage(inp.value);
}

function aiQuick(text) {
  const inp = document.getElementById('ai-chat-input');
  if (inp) inp.value = text;
  aiSendMessage(text);
}

function toggleAiPanel() {
  const panel = document.getElementById('ai-floating-panel');
  const fab   = document.getElementById('ai-fab');
  const icon  = document.getElementById('ai-fab-icon');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (fab) fab.classList.toggle('ai-fab-open', !isOpen);
  if (icon) icon.textContent = isOpen ? '🛰' : '✕';
  if (!isOpen) {
    renderAiChat();
    const inp = document.getElementById('ai-chat-input');
    if (inp) setTimeout(() => inp.focus(), 80);
  }
}

async function aiSendMessage(userText) {
  if (!userText.trim()) return;
  const chatEl = document.getElementById('ai-chat-messages');
  const inputEl = document.getElementById('ai-chat-input');
  if (inputEl) inputEl.value = '';

  // Append user message
  STATE.aiMessages.push({ role: 'user', content: userText });
  renderAiChat();

  // Loading indicator
  const loadId = 'ai-loading-' + Date.now();
  if (chatEl) chatEl.insertAdjacentHTML('beforeend',
    `<div id="${loadId}" class="ai-msg ai-thinking"><span class="ai-dot"></span><span class="ai-dot"></span><span class="ai-dot"></span></div>`);
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

  // Build context about current map state
  const activeLayers = Object.entries(STATE.layers).filter(([,v]) => v).map(([k]) => k).join(', ');
  const zoom = STATE.map ? STATE.map.getZoom() : 3;
  const center = STATE.map ? `${STATE.map.getCenter().lat.toFixed(2)},${STATE.map.getCenter().lng.toFixed(2)}` : 'unknown';
  // Fetch live DB ship stats for enhanced AI context
  let shipContext = '';
  try {
    const stats = await fetch('/api/ais/ships/stats').then(r => r.json());
    shipContext = ` | Ship DB: ${stats.total_live} live vessels (${stats.last_source}, polled ${stats.total_polls}x)`;
  } catch (_) {}
  const context = `Active layers: [${activeLayers}] | Map: Z${zoom} @ ${center}${shipContext}`;

  try {
    const r = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: STATE.aiMessages,
        context,
        model: 'qwen3-coder:480b-cloud',
      }),
    });
    const data = await r.json();
    const reply = data.reply || data.error || 'No response';
    STATE.aiMessages.push({ role: 'assistant', content: reply });

    // Execute any map actions the AI returned
    if (Array.isArray(data.actions)) {
      for (const action of data.actions) {
        try {
          if (action.type === 'flyTo' && action.lat != null && action.lon != null) {
            STATE.map?.flyTo([action.lat, action.lon], action.zoom || 6, { duration: 1.5 });
          } else if (action.type === 'toggleLayer') {
            const layerName = action.layer;
            if (layerName && STATE.layers[layerName] === false) toggleLayer(layerName);
          } else if (action.type === 'showFilter' || action.type === 'filterRegion') {
            const layerName = action.layer;
            if (layerName && !STATE.layers[layerName]) toggleLayer(layerName);
          } else if (action.type === 'showPanel') {
            const p = action.panel;
            if (p === 'news' || p === 'markets' || p === 'threats') setView(p);
            else if (p === 'map') setView('map');
          }
        } catch (ex) {}
      }
    }
    // Show source badge
    const badge = document.getElementById('ai-source-badge');
    if (badge) {
      badge.textContent = data.source === 'ollama' ? 'OLLAMA' : data.source === 'builtin' ? 'SOTANIK AI' : 'AI';
      badge.style.background = data.source === 'ollama' ? '#22c55e33' : '#3b82f633';
      badge.style.color = data.source === 'ollama' ? '#4ade80' : '#60a5fa';
    }
  } catch (e) {
    STATE.aiMessages.push({ role: 'assistant', content: `Error: ${e.message}` });
  }

  const loadEl = document.getElementById(loadId);
  if (loadEl) loadEl.remove();
  renderAiChat();
}

function renderAiChat() {
  const el = document.getElementById('ai-chat-messages');
  if (!el) return;
  el.innerHTML = STATE.aiMessages.map(m => {
    const isUser = m.role === 'user';
    // Lightweight markdown: **bold**, *italic*, line breaks, bullet lists
    let html = escHtml(m.content)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code style="background:#1e293b;padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
      .replace(/^\- (.+)$/gm, '▪ $1')
      .replace(/\n/g, '<br>');
    return `
      <div class="ai-msg ai-msg-${m.role}">
        <div class="ai-msg-inner">
          <span class="ai-role">${isUser ? '👤' : '🧠'}</span>
          <div class="ai-text">${html}</div>
        </div>
      </div>
    `;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

// ──────────────────────────────────────────────────────────
// BLOOMBERG TERMINAL — enhanced markets view
// ──────────────────────────────────────────────────────────
async function loadMarketsGlobal() {
  try {
    const data = await api('/api/markets/global');
    STATE.data.marketsGlobal = data;
    renderBloombergTerminal();
    return data;
  } catch (e) { return null; }
}

function renderBloombergTerminal() {
  const data = STATE.data.marketsGlobal;
  const cryptoData = STATE.data.crypto;
  const fgData = STATE.data.feargreed;

  // Ticker tape at top
  const tapeEl = document.getElementById('bb-ticker-tape');
  if (tapeEl && data) {
    const tickers = data.quotes.map(q => {
      const sign = q.change_pct >= 0 ? '+' : '';
      const col = q.change_pct >= 0 ? '#4ade80' : '#ef4444';
      return `<span class="tape-item"><span class="tape-name">${q.name}</span> <span class="tape-price">${q.price.toLocaleString()}</span> <span class="tape-chg" style="color:${col}">${sign}${q.change_pct}%</span></span>`;
    }).join('<span class="tape-sep">|</span>');
    tapeEl.innerHTML = tickers + tickers; // doubled for seamless scroll
  }

  // Main grid — split by category
  const categories = { indices: 'Global Indices', commodities: 'Commodities', fx: 'Forex / Rates', rates: 'Fixed Income' };
  const gridEl = document.getElementById('bb-main-grid');
  if (gridEl && data) {
    gridEl.innerHTML = Object.entries(categories).map(([cat, title]) => {
      const rows = data.quotes.filter(q => q.category === cat);
      if (!rows.length) return '';
      return `
        <div class="bb-section">
          <div class="bb-section-title">${title}</div>
          <table class="bb-table">
            <thead><tr><th>NAME</th><th>PRICE</th><th>CHG%</th><th>EXCH</th></tr></thead>
            <tbody>${rows.map(q => {
              const sign = q.change_pct >= 0 ? '+' : '';
              const cls = q.direction === 'up' ? 'bb-up' : q.direction === 'down' ? 'bb-down' : 'bb-flat';
              return `<tr class="${cls}"><td>${q.name}</td><td>${q.price.toLocaleString(undefined,{maximumFractionDigits:4})}</td><td>${sign}${q.change_pct}%</td><td>${q.exchange||'—'}</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;
    }).join('');
  }

  // Crypto table
  const cryptoEl = document.getElementById('bb-crypto-grid');
  if (cryptoEl && cryptoData) {
    cryptoEl.innerHTML = `
      <div class="bb-section-title">Top Crypto by Market Cap</div>
      <table class="bb-table">
        <thead><tr><th>#</th><th>COIN</th><th>PRICE</th><th>24H%</th><th>7D%</th><th>MCap</th></tr></thead>
        <tbody>${cryptoData.coins.slice(0,15).map(c => {
          const cls24 = c.change_24h >= 0 ? 'bb-up' : 'bb-down';
          const cls7  = c.change_7d >= 0 ? 'bb-up' : 'bb-down';
          const mcap = c.market_cap ? (c.market_cap/1e9).toFixed(1)+'B' : '—';
          return `<tr><td>${c.rank}</td><td>${c.symbol}</td><td>$${c.price?.toLocaleString(undefined,{maximumFractionDigits:2})}</td><td class="${cls24}">${c.change_24h>0?'+':''}${c.change_24h}%</td><td class="${cls7}">${c.change_7d>0?'+':''}${c.change_7d}%</td><td>${mcap}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  // Fear & Greed gauge
  const fgEl = document.getElementById('bb-fear-greed');
  if (fgEl && fgData) {
    const v = fgData.value;
    const fg_col = v>=75?'#4ade80':v>=55?'#86efac':v>=45?'#fbbf24':v>=25?'#fb923c':'#ef4444';
    fgEl.innerHTML = `
      <div class="bb-section-title">Crypto Fear & Greed</div>
      <div class="fg-gauge">
        <svg viewBox="0 0 200 110" style="width:100%;max-width:220px">
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#1e293b" stroke-width="18"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="${fg_col}" stroke-width="18"
                stroke-dasharray="${(v/100)*251} 251" stroke-linecap="round"/>
          <text x="100" y="90" text-anchor="middle" fill="${fg_col}" font-size="26" font-weight="700">${v}</text>
          <text x="100" y="108" text-anchor="middle" fill="#94a3b8" font-size="11">${fgData.label}</text>
        </svg>
      </div>
      <div class="fg-history">
        ${(fgData.history||[]).slice(0,7).map(h=>`<span class="fg-day" style="color:${parseInt(h.value)>=50?'#4ade80':'#ef4444'}">${h.value}<br><span style="font-size:9px">${new Date(h.timestamp*1000).toLocaleDateString('en',{weekday:'short'})}</span></span>`).join('')}
      </div>`;
  }

  // Mempool fees
  const mempoolEl = document.getElementById('bb-mempool-data');
  if (mempoolEl) {
    api('/api/markets/mempool').then(d => {
      if (!d) return;
      mempoolEl.innerHTML = `
        <table class="bb-table">
          <thead><tr><th>Priority</th><th>sat/vB</th></tr></thead>
          <tbody>
            <tr><td>⚡ Fastest</td><td style="color:#4ade80">${d.fastestFee}</td></tr>
            <tr><td>🚀 Half Hour</td><td style="color:#86efac">${d.halfHourFee}</td></tr>
            <tr><td>🐢 Hour</td><td style="color:#fbbf24">${d.hourFee}</td></tr>
            <tr><td>💤 Economy</td><td style="color:#94a3b8">${d.economyFee}</td></tr>
          </tbody>
        </table>`;
    }).catch(() => { mempoolEl.textContent = 'Unavailable'; });
  }
  const updEl = document.getElementById('markets-updated');
  if (updEl) updEl.textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ──────────────────────────────────────────────────────────
// BLOOMBERG TERMINAL — TAB SYSTEM
// ──────────────────────────────────────────────────────────
const BB_TABS = ['overview','stocks','india','crypto','forex','bonds','heatmap','macro','sec'];

function switchBBTab(tab) {
  BB_TABS.forEach(t => {
    const panel = document.getElementById('bbpanel-' + t);
    const btn   = document.getElementById('bbtab-' + t);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    if (btn) btn.classList.toggle('active', t === tab);
  });
  if (tab === 'crypto')  { loadBinance(); loadCryptoGlobal(); }
  if (tab === 'forex')   loadForex();
  if (tab === 'bonds')   { loadTreasury(); loadNationalDebt(); }
  if (tab === 'macro')   loadMacroTab();
  if (tab === 'sec')     loadSECFilings();
  if (tab === 'india')   loadIndiaTab();
  if (tab === 'heatmap') loadSectorHeatmap();
}

// ──────────────────────────────────────────────────────────
// STOCK SEARCH
// ──────────────────────────────────────────────────────────
let _bbCurrentTicker = '';

async function bbSearchStock() {
  const ticker = (document.getElementById('bb-stock-input')?.value || '').trim().toUpperCase();
  if (!ticker) return;
  _bbCurrentTicker = ticker;
  switchBBTab('stocks');
  const detEl = document.getElementById('bb-stock-detail');
  const funEl = document.getElementById('bb-fundamentals');
  const optEl = document.getElementById('bb-options');
  const anaEl = document.getElementById('bb-analyst');
  const insEl = document.getElementById('bb-institutions');
  const indEl = document.getElementById('bb-insiders');
  const newsEl= document.getElementById('bb-stock-news');
  if (detEl)  detEl.innerHTML  = '<div class="loading-pulse">Loading ' + ticker + '…</div>';
  if (funEl)  funEl.innerHTML  = '';
  if (optEl)  optEl.innerHTML  = '';
  if (anaEl)  anaEl.innerHTML  = '';
  if (insEl)  insEl.innerHTML  = '';
  if (indEl)  indEl.innerHTML  = '';
  if (newsEl) newsEl.innerHTML = '';

  const [det, fun, opt, ana] = await Promise.allSettled([
    api('/api/markets/stock/' + ticker),
    api('/api/markets/fundamentals/' + ticker),
    api('/api/markets/options/' + ticker),
    api('/api/markets/analyst/' + ticker),
  ]);
  if (det.status === 'fulfilled' && det.value && !det.value.error) renderStockDetail(det.value, detEl);
  else if (detEl) detEl.innerHTML = '<div class="bb-empty">No data for ' + ticker + '</div>';
  if (fun.status === 'fulfilled' && fun.value && !fun.value.error) renderFundamentals(fun.value, funEl);
  if (opt.status === 'fulfilled' && opt.value && !opt.value.error) renderOptionsChain(opt.value, optEl);
  if (ana.status === 'fulfilled' && ana.value && !ana.value.error) renderAnalyst(ana.value, anaEl, insEl, indEl);

  // Load chart and news in parallel
  bbLoadChart(ticker);
  loadStockNews(ticker, newsEl);
}

// Allow Enter key in stock input
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'bb-stock-input') {
    e.preventDefault();
    bbSearchStock();
  }
});

function fmt(n, d=2) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 1e12) return (n/1e12).toFixed(d) + 'T';
  if (Math.abs(n) >= 1e9)  return (n/1e9).toFixed(d) + 'B';
  if (Math.abs(n) >= 1e6)  return (n/1e6).toFixed(d) + 'M';
  return n.toLocaleString(undefined,{maximumFractionDigits:d});
}
function pct(n) { return n == null ? '—' : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }
function clr(n) { return n == null ? '' : n >= 0 ? 'color:#4ade80' : 'color:#ef4444'; }

function renderStockDetail(d, el) {
  if (!el) return;
  const chgCls = d.change_pct >= 0 ? 'bb-up' : 'bb-down';
  const pmColor = d.pre_market_change >= 0 ? '#4ade80' : '#ef4444';
  const afterColor = d.after_hours_change >= 0 ? '#4ade80' : '#ef4444';
  el.innerHTML = `
    <div class="bb-section">
      <div class="bb-section-title">${d.name} &nbsp;<span style="color:#94a3b8;font-size:0.8rem">${d.exchange}</span></div>
      <div class="bb-price-hero">
        <span class="bb-price-big">${d.currency} ${d.price?.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
        <span class="${chgCls}" style="font-size:1.1rem;margin-left:12px">${pct(d.change_pct)} (${pct(d.change_abs)})</span>
      </div>
      ${d.pre_market_price ? `<div style="font-size:0.82rem;color:#94a3b8">Pre-mkt <b style="color:${pmColor}">${d.pre_market_price} (${pct(d.pre_market_change)})</b></div>` : ''}
      ${d.after_hours_price ? `<div style="font-size:0.82rem;color:#94a3b8">After-hrs <b style="color:${afterColor}">${d.after_hours_price} (${pct(d.after_hours_change)})</b></div>` : ''}
      <table class="bb-table" style="margin-top:8px">
        <tr><th>Open</th><td>${fmt(d.open)}</td><th>Prev Close</th><td>${fmt(d.prev_close)}</td></tr>
        <tr><th>Day High</th><td>${fmt(d.day_high)}</td><th>Day Low</th><td>${fmt(d.day_low)}</td></tr>
        <tr><th>52W High</th><td>${fmt(d['52w_high'])}</td><th>52W Low</th><td>${fmt(d['52w_low'])}</td></tr>
        <tr><th>Volume</th><td>${fmt(d.volume,0)}</td><th>Avg Vol 3M</th><td>${fmt(d.avg_volume_3m,0)}</td></tr>
        <tr><th>Mkt Cap</th><td>${fmt(d.market_cap)}</td><th>Beta</th><td>${d.beta?.toFixed(2)||'—'}</td></tr>
        <tr><th>Sector</th><td>${d.sector||'—'}</td><th>Industry</th><td colspan="1">${d.industry||'—'}</td></tr>
      </table>
    </div>`;
}

function renderFundamentals(d, el) {
  if (!el) return;
  el.innerHTML = `
    <div class="bb-section">
      <div class="bb-section-title">📊 Fundamentals</div>
      <table class="bb-table">
        <tr><th>Revenue (TTM)</th><td>${fmt(d.revenue)}</td><th>Gross Profit</th><td>${fmt(d.gross_profit)}</td></tr>
        <tr><th>Free Cash Flow</th><td>${fmt(d.free_cashflow)}</td><th>Op. Margins</th><td>${d.operating_margins!=null?d.operating_margins.toFixed(1)+'%':'—'}</td></tr>
        <tr><th>P/E (Trailing)</th><td>${d.pe_trailing?.toFixed(2)||'—'}</td><th>P/E (Forward)</th><td>${d.pe_forward?.toFixed(2)||'—'}</td></tr>
        <tr><th>PEG Ratio</th><td>${d.peg?.toFixed(2)||'—'}</td><th>P/B Ratio</th><td>${d.pb?.toFixed(2)||'—'}</td></tr>
        <tr><th>EPS (TTM)</th><td>${d.eps?.toFixed(2)||'—'}</td><th>EPS Fwd</th><td>${d.eps_forward?.toFixed(2)||'—'}</td></tr>
        <tr><th>Dividend Yield</th><td>${d.dividend_yield!=null?(d.dividend_yield*100).toFixed(2)+'%':'—'}</td><th>Payout Ratio</th><td>${d.payout_ratio!=null?(d.payout_ratio*100).toFixed(1)+'%':'—'}</td></tr>
        <tr><th>ROE</th><td>${d.roe!=null?(d.roe*100).toFixed(1)+'%':'—'}</td><th>Debt/Equity</th><td>${d.debt_to_equity?.toFixed(2)||'—'}</td></tr>
        <tr><th>Short Float %</th><td>${d.short_percent!=null?(d.short_percent*100).toFixed(2)+'%':'—'}</td><th>Shares Short</th><td>${fmt(d.shares_short,0)}</td></tr>
        <tr><th>Analyst Rating</th><td colspan="3">${d.analyst_mean_target ? '<b style="color:#fbbf24">Mean target: $'+d.analyst_mean_target.toFixed(2)+'</b> ('+d.analyst_rating+')' : '—'}</td></tr>
      </table>
    </div>`;
}

function renderOptionsChain(d, el) {
  if (!el || !d.calls) return;
  const rowFn = r => `<tr><td>${r.strike}</td><td>${r.bid}</td><td>${r.ask}</td><td>${r.last}</td><td>${r.volume?.toLocaleString()||'—'}</td><td>${r.open_interest?.toLocaleString()||'—'}</td><td>${r.iv!=null?(r.iv*100).toFixed(1)+'%':'—'}</td><td>${r.expiration||d.expiration}</td></tr>`;
  const thead = '<thead><tr><th>Strike</th><th>Bid</th><th>Ask</th><th>Last</th><th>Vol</th><th>OI</th><th>IV</th><th>Exp</th></tr></thead>';
  el.innerHTML = `
    <div class="bb-section">
      <div class="bb-section-title">📜 Options Chain — ${d.symbol} (${d.count_expirations || ''} expirations)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div class="bb-options-header bb-up">CALLS</div>
          <table class="bb-table">${thead}<tbody>${(d.calls||[]).map(rowFn).join('')}</tbody></table>
        </div>
        <div>
          <div class="bb-options-header bb-down">PUTS</div>
          <table class="bb-table">${thead}<tbody>${(d.puts||[]).map(rowFn).join('')}</tbody></table>
        </div>
      </div>
    </div>`;
}

function renderAnalyst(d, anaEl, insEl, indEl) {
  if (anaEl && d.upgrades_downgrades) {
    const rows = d.upgrades_downgrades.slice(0,15).map(u =>
      `<tr><td>${u.date||'—'}</td><td>${u.firm}</td><td>${u.to_grade}</td><td style="${u.action==='upgrade'?'color:#4ade80':u.action==='downgrade'?'color:#ef4444':''}">${u.action||'—'}</td></tr>`
    ).join('');
    anaEl.innerHTML = `<div class="bb-section"><div class="bb-section-title">🔬 Analyst Ratings</div>
      <table class="bb-table"><thead><tr><th>Date</th><th>Firm</th><th>Grade</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (insEl && d.institutional_holders) {
    const rows = d.institutional_holders.slice(0,10).map(h =>
      `<tr><td>${h.holder}</td><td>${fmt(h.shares,0)}</td><td>${h.pct_out!=null?(h.pct_out*100).toFixed(2)+'%':'—'}</td><td>${h.date_reported||'—'}</td></tr>`
    ).join('');
    insEl.innerHTML = `<div class="bb-section"><div class="bb-section-title">🏦 Institutional Holders</div>
      <table class="bb-table"><thead><tr><th>Institution</th><th>Shares</th><th>% Out</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  if (indEl && d.insider_transactions) {
    const rows = d.insider_transactions.slice(0,10).map(t =>
      `<tr><td>${t.insider}</td><td>${t.title||'—'}</td><td style="${t.transaction==='Purchase'?'color:#4ade80':'color:#ef4444'}">${t.transaction||'—'}</td><td>${fmt(t.shares,0)}</td><td>${t.value!=null?'$'+fmt(t.value,0):'—'}</td></tr>`
    ).join('');
    indEl.innerHTML = `<div class="bb-section"><div class="bb-section-title">🕵 Insider Transactions</div>
      <table class="bb-table"><thead><tr><th>Insider</th><th>Title</th><th>Type</th><th>Shares</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
}

// ──────────────────────────────────────────────────────────
// CANDLESTICK CHART — TradingView Lightweight Charts
// ──────────────────────────────────────────────────────────
let _bbChart = null;
let _bbCandleSeries = null;
let _bbVolSeries = null;

function _initBBChart() {
  const container = document.getElementById('bb-chart-container');
  if (!container || typeof LightweightCharts === 'undefined') return false;
  if (_bbChart) {
    try { _bbChart.remove(); } catch(e) {}
    _bbChart = null; _bbCandleSeries = null; _bbVolSeries = null;
  }
  _bbChart = LightweightCharts.createChart(container, {
    width:  container.clientWidth || 700,
    height: 300,
    layout:      { background: { color: '#0f172a' }, textColor: '#94a3b8' },
    grid:        { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
    crosshair:   { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: '#334155' },
    timeScale:   { borderColor: '#334155', timeVisible: true, secondsVisible: false },
  });
  _bbCandleSeries = _bbChart.addCandlestickSeries({
    upColor: '#4ade80', downColor: '#ef4444',
    borderUpColor: '#4ade80', borderDownColor: '#ef4444',
    wickUpColor: '#4ade80', wickDownColor: '#ef4444',
  });
  // Resize chart when container resizes
  const ro = new ResizeObserver(() => {
    if (_bbChart && container.clientWidth > 0) {
      _bbChart.applyOptions({ width: container.clientWidth });
    }
  });
  ro.observe(container);
  return true;
}

async function bbLoadChart(tickerArg) {
  const ticker = tickerArg || _bbCurrentTicker;
  if (!ticker) return;
  _bbCurrentTicker = ticker;
  const interval = document.getElementById('bb-chart-interval')?.value || '1d';
  const range    = document.getElementById('bb-chart-range')?.value    || '3mo';
  const placeholder = document.getElementById('bb-chart-placeholder');
  if (placeholder) placeholder.style.display = 'none';
  const label = document.getElementById('bb-chart-ticker-label');
  if (label) label.textContent = ticker;

  if (!_initBBChart()) {
    if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'Chart library not loaded'; }
    return;
  }
  if (_bbCandleSeries) _bbCandleSeries.setData([]);

  try {
    const data = await api(`/api/markets/history/${ticker}?interval=${interval}&range=${range}`);
    if (!data || !data.candles || !data.candles.length) {
      if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'No chart data for ' + ticker; }
      return;
    }
    const candles = data.candles.map(c => ({
      time:  c.time,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }));
    _bbCandleSeries.setData(candles);
    _bbChart.timeScale().fitContent();
  } catch(e) {
    if (placeholder) { placeholder.style.display = ''; placeholder.textContent = 'Chart load failed: ' + e.message; }
  }
}

// ──────────────────────────────────────────────────────────
// STOCK NEWS
// ──────────────────────────────────────────────────────────
async function loadStockNews(ticker, el) {
  if (!el) return;
  el.innerHTML = '<div class="loading-pulse">Loading news for ' + ticker + '…</div>';
  const d = await api('/api/markets/stock-news/' + ticker).catch(() => null);
  if (!d || !d.news || !d.news.length) { el.innerHTML = ''; return; }
  const rows = d.news.slice(0, 10).map(n => {
    const ts = n.published ? new Date(n.published * 1000).toLocaleDateString('en', {month:'short',day:'numeric'}) : '';
    const thumb = n.thumbnail ? `<img src="${n.thumbnail}" style="width:48px;height:32px;object-fit:cover;border-radius:3px;flex-shrink:0" loading="lazy" onerror="this.style.display='none'">` : '';
    return `<div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #1e293b;align-items:flex-start">
      ${thumb}
      <div style="flex:1;min-width:0">
        <a href="${n.link||'#'}" target="_blank" rel="noopener" style="color:#e2e8f0;text-decoration:none;font-size:0.85rem;line-height:1.3;display:block">${escHtml(n.title)}</a>
        <span style="color:#64748b;font-size:0.75rem">${escHtml(n.publisher||'')} ${ts ? '· '+ts : ''}</span>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="bb-section"><div class="bb-section-title">📰 Latest News — ${ticker}</div><div style="padding:4px 0">${rows}</div></div>`;
}

// ──────────────────────────────────────────────────────────
// INDIA TAB — NSE India
// ──────────────────────────────────────────────────────────
let _niftyChart = null;
let _niftyLineSeries = null;

async function loadIndiaTab() {
  // Load NSE indices list
  const idxEl = document.getElementById('bb-nse-indices');
  if (idxEl) idxEl.innerHTML = '<div class="loading-pulse">Loading…</div>';
  // Load NIFTY 50 chart
  loadNiftyChart();
  // Populate a static list of popular NSE indices with Yahoo Finance fallback
  const NSE_YAHOO_MAP = [
    { name: 'NIFTY 50',         ticker: '^NSEI'  },
    { name: 'NIFTY Bank',       ticker: '^NSEBANK' },
    { name: 'NIFTY IT',         ticker: 'NIFTYIT.NS' },
    { name: 'SENSEX (BSE)',     ticker: '^BSESN' },
    { name: 'NIFTY Midcap 100', ticker: 'NIFTYMIDCAP100.NS' },
  ];
  const results = await Promise.allSettled(
    NSE_YAHOO_MAP.map(i => api('/api/markets/stock/' + i.ticker))
  );
  if (!idxEl) return;
  const rows = NSE_YAHOO_MAP.map((item, idx) => {
    const r = results[idx];
    if (r.status !== 'fulfilled' || !r.value || r.value.error) return `<tr><td>${item.name}</td><td colspan="3" style="color:#64748b">unavailable</td></tr>`;
    const d = r.value;
    const chg = d.change_pct ?? 0;
    const cls = chg >= 0 ? 'bb-up' : 'bb-down';
    return `<tr class="${cls}"><td>${item.name}</td><td>${(d.price||0).toLocaleString(undefined,{maximumFractionDigits:2})}</td><td>${chg>=0?'+':''}${chg}%</td><td style="color:#64748b;font-size:0.75rem">${d.exchange||''}</td></tr>`;
  }).join('');
  idxEl.innerHTML = `<table class="bb-table"><thead><tr><th>Index</th><th>Price</th><th>Chg%</th><th>Exch</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function loadNiftyChart() {
  const container = document.getElementById('bb-nifty-chart');
  if (!container || typeof LightweightCharts === 'undefined') return;
  container.innerHTML = '<div class="loading-pulse" style="padding:12px">Loading NIFTY 50…</div>';

  const data = await api('/api/markets/history/%5ENSEI?interval=1d&range=3mo').catch(() => null);
  if (!data || !data.candles || !data.candles.length) {
    container.innerHTML = '<div class="bb-empty">NIFTY 50 data unavailable</div>';
    return;
  }
  container.innerHTML = '';
  if (_niftyChart) { try { _niftyChart.remove(); } catch(e) {} }
  _niftyChart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 500, height: 220,
    layout:  { background: { color: '#0f172a' }, textColor: '#94a3b8' },
    grid:    { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
    rightPriceScale: { borderColor: '#334155' },
    timeScale: { borderColor: '#334155', timeVisible: true },
  });
  _niftyLineSeries = _niftyChart.addCandlestickSeries({
    upColor: '#4ade80', downColor: '#ef4444',
    borderUpColor: '#4ade80', borderDownColor: '#ef4444',
    wickUpColor: '#4ade80', wickDownColor: '#ef4444',
  });
  _niftyLineSeries.setData(data.candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
  _niftyChart.timeScale().fitContent();
  new ResizeObserver(() => { if (_niftyChart) _niftyChart.applyOptions({ width: container.clientWidth }); }).observe(container);
}

async function bbSearchNSE() {
  const sym = (document.getElementById('nse-symbol-input')?.value || '').trim().toUpperCase();
  if (!sym) return;
  const el = document.getElementById('bb-nse-quote');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading ' + sym + '…</div>';
  const d = await api('/api/markets/nse/' + sym).catch(() => null);
  if (!d || d.error) {
    if (el) el.innerHTML = '<div class="bb-empty">NSE data unavailable for ' + sym + ' — try Yahoo symbol (e.g. RELIANCE.NS) in main search</div>';
    return;
  }
  const chgCls = d.change_pct >= 0 ? 'bb-up' : 'bb-down';
  if (el) el.innerHTML = `
    <div class="bb-section">
      <div class="bb-section-title">${escHtml(d.name)} <span style="color:#64748b;font-size:0.8rem">NSE:${d.symbol} · ${d.series}</span></div>
      <div class="bb-price-hero">
        <span class="bb-price-big">₹${(d.price||0).toLocaleString(undefined,{maximumFractionDigits:2})}</span>
        <span class="${chgCls}" style="font-size:1.1rem;margin-left:12px">${d.change_pct>=0?'+':''}${d.change_pct}% (₹${d.change>=0?'+':''}${d.change})</span>
      </div>
      <table class="bb-table" style="margin-top:8px">
        <tr><th>Open</th><td>₹${d.open||'—'}</td><th>Prev Close</th><td>₹${d.prev_close||'—'}</td></tr>
        <tr><th>Day High</th><td>₹${d.high||'—'}</td><th>Day Low</th><td>₹${d.low||'—'}</td></tr>
        <tr><th>52W High</th><td>₹${d.week52_high||'—'}</td><th>52W Low</th><td>₹${d.week52_low||'—'}</td></tr>
        <tr><th>Sector</th><td colspan="3">${escHtml(d.sector||'—')}</td></tr>
      </table>
    </div>`;
}

// NSE input Enter key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'nse-symbol-input') {
    e.preventDefault();
    bbSearchNSE();
  }
});

// ──────────────────────────────────────────────────────────
// SECTOR HEATMAP
// ──────────────────────────────────────────────────────────
async function loadSectorHeatmap() {
  const el = document.getElementById('bb-sector-heatmap');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading sector data…</div>';
  const d = await api('/api/markets/sector-heatmap').catch(() => null);
  if (!d || !el) return;
  const cells = (d.sectors || []).map(s => {
    const abs = Math.abs(s.change_pct);
    const intensity = Math.min(1, abs / 3);  // 3% = max saturation
    const bg = s.direction === 'up'
      ? `rgba(74,222,128,${0.15 + intensity * 0.55})`
      : s.direction === 'down'
        ? `rgba(239,68,68,${0.15 + intensity * 0.55})`
        : 'rgba(100,116,139,0.2)';
    const textColor = abs > 1.5 ? '#fff' : '#e2e8f0';
    return `<div class="heatmap-cell" style="background:${bg};color:${textColor}">
      <div class="heatmap-sector">${s.sector}</div>
      <div class="heatmap-etf" style="font-size:0.7rem;color:rgba(255,255,255,0.6)">${s.etf}</div>
      <div class="heatmap-chg" style="font-size:1.05rem;font-weight:700">${s.change_pct>=0?'+':''}${s.change_pct}%</div>
      <div class="heatmap-price" style="font-size:0.75rem;opacity:0.7">$${(s.price||0).toFixed(2)}</div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="heatmap-grid">${cells}</div><div style="font-size:0.72rem;color:#64748b;margin-top:8px">Source: ${d.source} · Updated: ${new Date().toLocaleTimeString()}</div>`;
}

// ──────────────────────────────────────────────────────────
// CRYPTO TAB LOADERS
// ──────────────────────────────────────────────────────────
async function loadBinance() {
  const el = document.getElementById('bb-binance-grid');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading Binance…</div>';
  const d = await api('/api/markets/binance').catch(() => null);
  if (!d || !el) return;
  const rows = (d.pairs || []).map(p => {
    const chg = parseFloat(p.priceChangePercent);
    const cls = chg >= 0 ? 'bb-up' : 'bb-down';
    return `<tr class="${cls}"><td>${p.symbol}</td><td>${parseFloat(p.lastPrice).toLocaleString(undefined,{maximumFractionDigits:6})}</td><td>${chg>=0?'+':''}${chg.toFixed(2)}%</td><td>${fmt(parseFloat(p.quoteVolume),0)}</td><td>${parseFloat(p.highPrice).toLocaleString(undefined,{maximumFractionDigits:4})} / ${parseFloat(p.lowPrice).toLocaleString(undefined,{maximumFractionDigits:4})}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="bb-section"><div class="bb-section-title">🔶 Binance — Live 24h Stats</div>
    <table class="bb-table"><thead><tr><th>Pair</th><th>Price</th><th>24h%</th><th>Volume (USD)</th><th>High/Low</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function loadCryptoGlobal() {
  const el = document.getElementById('bb-crypto-global');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading…</div>';
  const d = await api('/api/markets/crypto-global').catch(() => null);
  if (!d || !el) return;
  const btcDom = d.btc_dominance?.toFixed(1) || '—';
  const ethDom = d.eth_dominance?.toFixed(1) || '—';
  el.innerHTML = `<div class="bb-section"><div class="bb-section-title">🌐 CoinGecko Global</div>
    <table class="bb-table">
      <tr><th>Total Mkt Cap</th><td>$${fmt(d.total_market_cap)}</td><th>24h Vol</th><td>$${fmt(d.total_volume)}</td></tr>
      <tr><th>BTC Dom.</th><td>${btcDom}%</td><th>ETH Dom.</th><td>${ethDom}%</td></tr>
      <tr><th>Active Coins</th><td>${(d.active_cryptocurrencies||0).toLocaleString()}</td><th>Exchanges</th><td>${(d.markets||0).toLocaleString()}</td></tr>
      <tr><th>24h Change</th><td colspan="3" style="color:${d.market_cap_change_24h>=0?'#4ade80':'#ef4444'}">${pct(d.market_cap_change_24h)}</td></tr>
    </table></div>`;
}

// ──────────────────────────────────────────────────────────
// FOREX
// ──────────────────────────────────────────────────────────
async function loadForex() {
  const el = document.getElementById('bb-forex-table');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading…</div>';
  const d = await api('/api/markets/forex').catch(() => null);
  if (!d || !el) return;
  const rates = Object.entries(d.rates || {}).sort((a,b) => a[0].localeCompare(b[0]));
  const rows = rates.map(([cur, rate]) =>
    `<tr><td><b>${cur}</b></td><td>${(1/rate).toFixed(6)}</td><td>${rate.toFixed(6)}</td></tr>`
  ).join('');
  el.innerHTML = `<div class="bb-section"><div class="bb-section-title">💱 FX Rates — Base USD (ECB/Frankfurter) — ${d.date||''}</div>
    <table class="bb-table"><thead><tr><th>Currency</th><th>1 USD = X</th><th>1 X = USD</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ──────────────────────────────────────────────────────────
// TREASURY / BONDS
// ──────────────────────────────────────────────────────────
async function loadTreasury() {
  const el = document.getElementById('bb-yield-curve');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading…</div>';
  const d = await api('/api/markets/treasury').catch(() => null);
  if (!d || !el) return;
  const curve = d.curve || d.yields || {};
  const maturities = ['1M','2M','3M','4M','6M','1Y','2Y','3Y','5Y','7Y','10Y','20Y','30Y'];
  const rows = maturities.filter(m => curve[m] != null).map(m => {
    const y = curve[m];
    const barWidth = Math.min(100, Math.round(y * 14));
    return `<tr><td>${m}</td><td><div class="yield-bar" style="width:${barWidth}%;background:#fbbf24;height:4px;border-radius:2px;display:inline-block;min-width:2px"></div></td><td style="color:#fbbf24">${y.toFixed(3)}%</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="bb-section"><div class="bb-section-title">🏦 US Treasury Yield Curve — ${d.date||''}</div>
    <table class="bb-table"><thead><tr><th>Maturity</th><th>Curve</th><th>Yield</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function loadNationalDebt() {
  const el = document.getElementById('bb-debt-data');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading…</div>';
  const d = await api('/api/markets/debt').catch(() => null);
  if (!d || !el) return;
  el.innerHTML = `
    <table class="bb-table">
      <tr><th>Total Debt</th><td style="color:#ef4444"><b>$${fmt(d.total_debt)}</b></td></tr>
      <tr><th>Held by Public</th><td>$${fmt(d.debt_held_public)}</td></tr>
      <tr><th>Intragovernmental</th><td>$${fmt(d.intragovernmental_debt)}</td></tr>
      <tr><th>As of</th><td>${d.date||'—'}</td></tr>
    </table>`;
  // Also update overview panel if present
  const ov = document.getElementById('bb-debt-panel');
  if (ov) {
    const tr = document.getElementById('bb-debt-data');
    if (tr) tr.innerHTML = el.innerHTML;
  }
}

// ──────────────────────────────────────────────────────────
// MACRO TAB
// ──────────────────────────────────────────────────────────
async function loadMacroTab() {
  const el = document.getElementById('bb-macro-grid');
  if (!el) return;
  el.innerHTML = '<div class="loading-pulse">Loading macro data…</div>';
  const [global, debt, btc, treasury] = await Promise.allSettled([
    api('/api/markets/global'),
    api('/api/markets/debt'),
    api('/api/markets/btc-chain'),
    api('/api/markets/treasury'),
  ]);
  let html = '';
  if (global.status==='fulfilled' && global.value?.quotes) {
    const rates = global.value.quotes.filter(q => q.category==='rates');
    if (rates.length) {
      html += `<div class="bb-section"><div class="bb-section-title">📈 Fixed Income</div>
        <table class="bb-table"><thead><tr><th>Name</th><th>Price</th><th>Chg%</th></tr></thead>
        <tbody>${rates.map(r=>`<tr class="${r.direction==='up'?'bb-up':r.direction==='down'?'bb-down':''}"><td>${r.name}</td><td>${r.price}</td><td>${pct(r.change_pct)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  }
  if (debt.status==='fulfilled' && debt.value) {
    const d = debt.value;
    html += `<div class="bb-section"><div class="bb-section-title">🇺🇸 US National Debt</div>
      <table class="bb-table">
        <tr><th>Total</th><td style="color:#ef4444">$${fmt(d.total_debt)}</td></tr>
        <tr><th>Public</th><td>$${fmt(d.debt_held_public)}</td></tr>
        <tr><th>IntraGovt</th><td>$${fmt(d.intragovernmental_debt)}</td></tr>
      </table></div>`;
  }
  if (btc.status==='fulfilled' && btc.value) {
    const b = btc.value;
    html += `<div class="bb-section"><div class="bb-section-title">⛓ BTC On-Chain</div>
      <table class="bb-table">
        <tr><th>Price (USD)</th><td>$${fmt(b.btc_usd)}</td></tr>
        <tr><th>Market Cap</th><td>$${fmt(b.market_cap_usd)}</td></tr>
        <tr><th>Hash Rate</th><td>${fmt(b.hash_rate_eh_s)} EH/s</td></tr>
        <tr><th>Difficulty</th><td>${fmt(b.difficulty)}</td></tr>
        <tr><th>Mempool (unconf.)</th><td>${(b.unconfirmed_txs||0).toLocaleString()}</td></tr>
        <tr><th>Total TXs (24h)</th><td>${(b.n_tx||0).toLocaleString()}</td></tr>
      </table></div>`;
  }
  el.innerHTML = html || '<div class="bb-empty">No macro data loaded</div>';
}

// ──────────────────────────────────────────────────────────
// BTC ON-CHAIN (OVERVIEW PANEL)
// ──────────────────────────────────────────────────────────
async function loadBTCChain() {
  const el = document.getElementById('bb-btcchain-data');
  if (!el) return;
  const d = await api('/api/markets/btc-chain').catch(() => null);
  if (!d) { el.textContent = 'Unavailable'; return; }
  el.innerHTML = `<table class="bb-table">
    <tr><th>BTC / USD</th><td style="color:#fbbf24">$${fmt(d.btc_usd)}</td></tr>
    <tr><th>Hash Rate</th><td>${fmt(d.hash_rate_eh_s)} EH/s</td></tr>
    <tr><th>Difficulty</th><td>${fmt(d.difficulty)}</td></tr>
    <tr><th>Unconf. TXs</th><td>${(d.unconfirmed_txs||0).toLocaleString()}</td></tr>
  </table>`;
}

// ──────────────────────────────────────────────────────────
// SEC FILINGS
// ──────────────────────────────────────────────────────────
async function loadSECFilings() {
  const el = document.getElementById('bb-sec-filings');
  if (el) el.innerHTML = '<div class="loading-pulse">Loading SEC EDGAR…</div>';
  const d = await api('/api/markets/sec-filings').catch(() => null);
  if (!d || !el) return;
  const filings = d.filings || d.items || [];
  if (!filings.length) { el.innerHTML = '<div class="bb-empty">No filings loaded</div>'; return; }
  const typeColor = { '8-K': '#fbbf24', 'SC 13D': '#38bdf8', '4': '#a78bfa', '13D': '#38bdf8' };
  const rows = filings.map(f => {
    const col = typeColor[f.type] || '#94a3b8';
    const href = f.link ? `<a href="${f.link}" target="_blank" style="color:#38bdf8;text-decoration:none">↗</a>` : '';
    return `<tr>
      <td><span style="color:${col};font-weight:600">${f.type||'?'}</span></td>
      <td>${f.company||f.issuer||'—'}</td>
      <td style="max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.title||'—'}</td>
      <td>${f.date||'—'}</td>
      <td>${href}</td>
    </tr>`;
  }).join('');
  el.innerHTML = `<table class="bb-table"><thead><tr><th>Type</th><th>Company</th><th>Title</th><th>Date</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ──────────────────────────────────────────────────────────
// OVERVIEW PANEL — load everything for overview
// ──────────────────────────────────────────────────────────
async function loadMarketsAll() {
  await Promise.allSettled([
    loadMarketsGlobal(),
    loadNationalDebt(),
    loadBTCChain(),
  ]);
}

// ──────────────────────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// Boot loading screen sequence
// ──────────────────────────────────────────────────────────
(function initBootScreen() {
  const BOOT_DURATION_MS = 5000;
  const BOOT_MESSAGES = [
    '[ OK ]  Initializing SoTaNik_AI core engine …',
    '[ OK ]  OSINT aggregation modules ONLINE',
    '[ OK ]  Geospatial intelligence layer loaded',
    '[ OK ]  SIGINT relay nodes synchronized',
    '[ OK ]  Threat-vector analysis pipeline READY',
    '[ OK ]  Satellite feed authentication … PASS',
    '[ OK ]  Global surveillance network ACTIVE',
    '[ OK ]  Data-fusion matrix calibrated',
    '[ OK ]  Encrypted comms channel established',
    '[ OK ]  SoTaNik_AI operational — all systems nominal',
  ];
  const STATUS_IDS  = ['bst-osint','bst-sigint','bst-geoint','bst-humint','bst-cyber'];
  const STATUS_DELAYS = [600, 1200, 1900, 2700, 3500]; // ms when each discipline comes online

  const screen   = document.getElementById('boot-screen');
  const fillEl   = document.getElementById('boot-progress-fill');
  const glowEl   = document.getElementById('boot-progress-glow');
  const pctEl    = document.getElementById('boot-progress-pct');
  const logLines = Array.from({length: 6}, (_, i) => document.getElementById('bl-' + i));

  if (!screen) return;

  let msgIdx = 0;
  let startTime = performance.now();

  // Progress ticker (rAF loop)
  function tick(now) {
    const elapsed = now - startTime;
    const pct = Math.min(100, (elapsed / BOOT_DURATION_MS) * 100);
    const pctStr = Math.floor(pct) + '%';
    if (fillEl) { fillEl.style.width = pctStr; }
    if (glowEl) { glowEl.style.width = pctStr; }
    if (pctEl)  { pctEl.textContent  = pctStr; }
    if (pct < 100) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Log message drip — spread messages evenly across the 5s window
  const msgInterval = (BOOT_DURATION_MS * 0.82) / BOOT_MESSAGES.length;
  BOOT_MESSAGES.forEach((msg, i) => {
    setTimeout(() => {
      const slot = logLines[msgIdx % logLines.length];
      if (slot) { slot.textContent = msg; slot.classList.add('visible'); }
      msgIdx++;
    }, 200 + i * msgInterval);
  });

  // Intelligence discipline status indicators
  STATUS_IDS.forEach((id, i) => {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.classList.add('online');
    }, STATUS_DELAYS[i]);
  });

  // Dismiss after BOOT_DURATION_MS
  setTimeout(() => {
    if (screen) {
      screen.classList.add('boot-fade-out');
      setTimeout(() => {
        screen.style.display = 'none';
      }, 850);
    }
  }, BOOT_DURATION_MS);
})();

document.addEventListener('DOMContentLoaded', async () => {
  // Apply saved theme
  applyTheme(STATE.theme);

  // Start clock
  startClock();

  // Init map
  initMap();

  // Initial data loads (parallel)
  toast('Loading intelligence feeds…', 'info', 2000);
  await Promise.allSettled([
    loadSignals(),
    loadEarthquakes(),
    loadDisasters(),
    loadFires(),
    loadNews(),
    loadMarkets(),
    loadThreats(),
    loadMarketsGlobal(),
    loadCountries().then(renderBoundariesLayer),
  ]);

  // AI chat input wiring (floating panel — keydown on input)
  document.addEventListener('keydown', e => {
    if (document.getElementById('ai-floating-panel')?.style.display !== 'none') {
      const inp = document.getElementById('ai-chat-input');
      if (inp && document.activeElement === inp && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        aiSendFromInput();
      }
    }
  });

  // Schedule auto-refresh
  scheduleRefresh();

  // Start OpenSky polling for public civil flights
  if (STATE.layers.aviation) {
    initAviationPolling();
  }

  toast('SoTaNik_AI Surveillance ready', 'ok', 2500);
});

// ──────────────────────────────────────────────────────────
// Global keyboard shortcuts
// ──────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  // Ignore when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'ArrowLeft':
    case '[':
      toggleSidebar('left');
      break;
    case 'ArrowRight':
    case ']':
      toggleSidebar('right');
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'Escape':
      if (document.body.classList.contains('cinema-mode')) {
        document.body.classList.remove('cinema-mode');
        const btn = document.getElementById('fullscreen-btn');
        if (btn) btn.classList.remove('active');
        setTimeout(() => { if (STATE.map) STATE.map.invalidateSize(); }, 280);
      }
      break;
  }
});
