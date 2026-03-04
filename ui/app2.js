/* MARITIME OSINT - Global Ship & Satellite Tracker v4
   Track-lock | Orbital ground tracks | Country flags | satellite.js propagation
   =========================================================================== */

// Map init
const map = L.map('map', {
  center: [20, 10], zoom: 3,
  zoomControl: true, preferCanvas: true, tap: false,
});
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; Carto &copy; OSM', subdomains: 'abcd', maxZoom: 19,
}).addTo(map);

// State
const registry   = {};
const markers    = {};
const pathLines  = {};
const orbitLines = {};
const labelDivs  = {};
const satrecMap  = {};

let activeFilter = 'ALL';
let listSearch   = '';
let showShips    = true;
let showSats     = false;
let showPaths    = true;
let showLabels   = true;
let showCountry  = false;
let showOrbits   = false;
let selectedId   = null;
let trackingId   = null;
let msgCount = 0, msgRate = 0;
let satInterval  = null;

const layers = {
  ships:  L.layerGroup().addTo(map),
  sats:   L.layerGroup(),
  paths:  L.layerGroup().addTo(map),
  orbits: L.layerGroup(),
  labels: L.layerGroup().addTo(map),
};

const pendingUpdates = new Map();
let flushScheduled = false;

// Region presets
const REGIONS = {
  europe:       { center: [55, 10],    zoom: 5 },
  india:        { center: [15, 72],    zoom: 5 },
  bay_bengal:   { center: [15, 90],    zoom: 5 },
  south_china:  { center: [15, 115],   zoom: 5 },
  persian_gulf: { center: [26, 54],    zoom: 6 },
  malacca:      { center: [3, 102],    zoom: 6 },
  med:          { center: [37, 18],    zoom: 5 },
  us_east:      { center: [38, -72],   zoom: 5 },
  suez:         { center: [30, 32.5],  zoom: 7 },
};

// Type colors
const TYPE_COLORS = {
  Cargo: '#42a5f5', Tanker: '#ff7043', Passenger: '#ab47bc',
  Fishing: '#ffca28', Military: '#ef5350', Tug: '#78909c',
  'High Speed': '#26c6da', Pilot: '#66bb6a', SAR: '#ff80ab',
  SATELLITE: '#ce93d8', Unknown: '#455a64',
};
function typeColor(t) { return TYPE_COLORS[t] || '#455a64'; }

// Country heuristic for satellites
function satCountry(name, group) {
  const n = (name || '').toUpperCase();
  if (n.includes('STARLINK'))   return 'USA';
  if (n.includes('ONEWEB'))     return 'UK';
  if (n.includes('ISS') || n.includes('ZARYA') || n.includes('ZVEZDA')) return 'International';
  if (n.startsWith('GOES') || n.startsWith('NOAA') || n.startsWith('GPS') || n.startsWith('IRIDIUM')) return 'USA';
  if (n.startsWith('COSMOS') || n.startsWith('GLONASS') || n.startsWith('MOLNIYA') || n.startsWith('METEOR') || n.startsWith('ELEKTRO')) return 'Russia';
  if (n.startsWith('GALILEO') || n.startsWith('ENVISAT') || n.startsWith('SENTINEL') || n.startsWith('ERS')) return 'EU';
  if (n.startsWith('BEIDOU') || n.startsWith('CZ-') || n.startsWith('YAOGAN') || n.startsWith('SHIJIAN')) return 'China';
  if (n.startsWith('HIMAWARI') || n.startsWith('MTSAT')) return 'Japan';
  if (n.startsWith('INSAT') || n.startsWith('GSAT') || n.startsWith('CARTOSAT') || n.startsWith('RISAT')) return 'India';
  if (n.startsWith('INTELSAT')) return 'International';
  return '';
}

// Icons
function buildShipIcon(type, course, selected) {
  const c  = typeColor(type);
  const sz = selected ? 22 : 16;
  const rot = (course || 0) - 90;
  const glow = selected
    ? `filter:drop-shadow(0 0 6px ${c});`
    : `filter:drop-shadow(0 0 2px ${c}66);`;
  const k = type.replace(/\W/g, '');
  return L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;transform:rotate(${rot}deg);${glow}">
      <svg viewBox="0 0 24 24" width="${sz}" height="${sz}">
        <defs><radialGradient id="rg${k}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${c}" stop-opacity=".95"/>
          <stop offset="100%" stop-color="${c}" stop-opacity=".2"/>
        </radialGradient></defs>
        <polygon points="12,2 20,19 12,15 4,19"
          fill="url(#rg${k})" stroke="${c}" stroke-width="${selected ? 1.8 : 1}"/>
      </svg></div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  });
}

function buildSatIcon(group, selected) {
  const sz = selected ? 20 : 14;
  const body = group === 'Starlink' ? '#80cbc4' : group === 'GPS' ? '#fff176' : '#ce93d8';
  const glow = selected ? 6 : 3;
  return L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;filter:drop-shadow(0 0 ${glow}px #b39ddb)">
      <svg viewBox="0 0 24 24" width="${sz}" height="${sz}">
        <rect x="9" y="9" width="6" height="6" rx="1" fill="#1a0628" stroke="${body}" stroke-width="1.5"/>
        <line x1="12" y1="2" x2="12" y2="8" stroke="${body}" stroke-width="1.2"/>
        <line x1="12" y1="16" x2="12" y2="22" stroke="${body}" stroke-width="1.2"/>
        <rect x="2" y="10" width="6" height="4" rx=".5" fill="${body}44" stroke="${body}" stroke-width="1"/>
        <rect x="16" y="10" width="6" height="4" rx=".5" fill="${body}44" stroke="${body}" stroke-width="1"/>
        <circle cx="12" cy="12" r="2.5" fill="${body}" opacity=".9"/>
        ${selected ? `<circle cx="12" cy="12" r="7" fill="none" stroke="${body}" stroke-width=".4" opacity=".4"/>` : ''}
      </svg></div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  });
}

// Orbital ground track computation
function computeGroundTrack(satrec, minutes) {
  minutes = minutes || 95;
  const segs = [], coords = [];
  let prevLon = null;
  const now = new Date();
  for (let i = 0; i <= minutes; i += 2) {
    try {
      const t   = new Date(now.getTime() + i * 60000);
      const pv  = satellite.propagate(satrec, t);
      if (!pv || !pv.position) continue;
      const gmst = satellite.gstime(t);
      const geo  = satellite.eciToGeodetic(pv.position, gmst);
      const lat  = satellite.degreesLat(geo.latitude);
      const lon  = satellite.degreesLong(geo.longitude);
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        if (coords.length) segs.push(coords.slice());
        coords.length = 0;
      }
      coords.push([lat, lon]);
      prevLon = lon;
    } catch (e) {}
  }
  if (coords.length) segs.push(coords);
  return segs;
}

function drawOrbit(id, satrec, isSelected) {
  if (orbitLines[id]) {
    orbitLines[id].forEach(function(l) { layers.orbits.removeLayer(l); });
    delete orbitLines[id];
  }
  if (!showOrbits && !isSelected) return;
  const segs = computeGroundTrack(satrec);
  const col  = isSelected ? '#b39ddb' : '#6c3fff55';
  const w    = isSelected ? 1.5 : 0.6;
  orbitLines[id] = segs.map(function(s) {
    return L.polyline(s, { color: col, weight: w, dashArray: isSelected ? null : '4 6', interactive: false })
      .addTo(layers.orbits);
  });
}

// Render a vessel or satellite
function renderTarget(data) {
  const id = data.id || data.mmsi;
  if (!id) return;
  const isSat = data.type === 'SATELLITE';
  registry[id] = Object.assign({}, registry[id] || {}, data);
  const d = registry[id];
  const visible = shouldShow(d);
  const layer = isSat ? layers.sats : layers.ships;

  if (!visible) {
    if (markers[id])   { layer.removeLayer(markers[id]);       delete markers[id]; }
    if (pathLines[id]) { layers.paths.removeLayer(pathLines[id]);  delete pathLines[id]; }
    if (labelDivs[id]) { layers.labels.removeLayer(labelDivs[id]); delete labelDivs[id]; }
    return;
  }

  const ll   = [d.lat, d.lon];
  const icon = isSat
    ? buildSatIcon(d.group, id === selectedId)
    : buildShipIcon(d.type || 'Unknown', d.course, id === selectedId);

  if (markers[id]) {
    markers[id].setLatLng(ll).setIcon(icon);
  } else {
    markers[id] = L.marker(ll, { icon: icon, zIndexOffset: isSat ? 500 : 0 })
      .on('click', function() { selectTarget(id); }).addTo(layer);
  }

  // Label
  if (labelDivs[id]) { layers.labels.removeLayer(labelDivs[id]); delete labelDivs[id]; }
  const wantLabel = (showCountry && d.country) || (showLabels && !isSat && d.name && d.name !== 'IDENTIFYING...');
  if (wantLabel) {
    const flag    = (showCountry && d.country) ? countryFlag(d.country) + ' ' : '';
    const nameStr = (showLabels && d.name && d.name !== 'IDENTIFYING...') ? d.name.slice(0, 14) : '';
    const line    = (flag + nameStr).trim();
    if (line) {
      labelDivs[id] = L.marker(ll, {
        icon: L.divIcon({
          className: '',
          html: '<div style="color:#00e5ffbb;background:#060c1477;padding:1px 4px;border-radius:2px;font-size:8px;letter-spacing:.5px;white-space:nowrap;pointer-events:none">' + line + '</div>',
          iconAnchor: [-8, 5],
        }),
        interactive: false,
      }).addTo(layers.labels);
    }
  }

  // Path trail for ships
  if (!isSat && showPaths && d.path && d.path.length > 1) {
    const pts = d.path.map(function(p) { return [p.lat, p.lon]; });
    if (pathLines[id]) pathLines[id].setLatLngs(pts);
    else pathLines[id] = L.polyline(pts, { color: typeColor(d.type), weight: 1.2, opacity: 0.5 }).addTo(layers.paths);
  }

  // Orbit for satellites
  if (isSat && satrecMap[id]) drawOrbit(id, satrecMap[id], id === selectedId);

  // Track-lock pan
  if (id === trackingId) map.panTo(ll, { animate: true, duration: 0.5 });

  // Refresh side panel if selected
  if (id === selectedId) refreshPanel(id);
}

function shouldShow(d) {
  if (!d) return false;
  const isSat = d.type === 'SATELLITE';
  if (isSat  && !showSats)  return false;
  if (!isSat && !showShips) return false;
  if (activeFilter === 'SATELLITE' && !isSat)  return false;
  if (activeFilter !== 'ALL' && activeFilter !== 'SATELLITE' && d.type !== activeFilter) return false;
  return true;
}

// Batched render flush
function scheduleBatch() {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(function() {
    const items = Array.from(pendingUpdates.values());
    pendingUpdates.clear();
    flushScheduled = false;
    items.forEach(renderTarget);
    updateTelemetry();
    updateSidebar();
  });
}

// WebSocket
var ws, reconnectTimer;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + '/ws');
  ws.onopen = function() {
    document.getElementById('ws-dot').className = 'on';
    document.getElementById('ws-lbl').textContent = 'CONNECTED';
    clearTimeout(reconnectTimer);
  };
  ws.onmessage = function(e) {
    msgCount++;
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'source_status') { updateSources(d); return; }
      if (d.type === 'tle_catalog')   { ingestTLEs(d.tles); return; }
      const id = d.id || d.mmsi;
      if (!id) return;
      if (d.type === 'SATELLITE') d.country = d.country || satCountry(d.name, d.group);
      pendingUpdates.set(id, d);
      scheduleBatch();
    } catch (ex) {}
  };
  ws.onclose = function() {
    document.getElementById('ws-dot').className = '';
    document.getElementById('ws-lbl').textContent = 'DISCONNECTED';
    reconnectTimer = setTimeout(connectWS, 3000);
  };
  ws.onerror = function() { ws.close(); };
}

// TLE ingestion via satellite.js
function ingestTLEs(tles) {
  if (!tles || !tles.length) return;
  var ok = 0;
  for (var i = 0; i < tles.length; i++) {
    var t = tles[i];
    try {
      satrecMap[t.name] = satellite.twoline2satrec(t.line1, t.line2);
      if (!registry[t.name]) registry[t.name] = {};
      registry[t.name].country = satCountry(t.name, t.group);
      ok++;
    } catch (ex) {}
  }
  console.log('satellite.js satrecs:', ok);
  if (!satInterval) satInterval = setInterval(propagateAll, 2000);
  if (showOrbits) {
    Object.keys(satrecMap).forEach(function(n) {
      drawOrbit(n, satrecMap[n], n === selectedId);
    });
  }
}

// Client-side SGP4 propagation loop (runs every 2s)
function propagateAll() {
  if (!showSats) return;
  const now  = new Date();
  const gmst = satellite.gstime(now);
  Object.keys(satrecMap).forEach(function(name) {
    try {
      const sr = satrecMap[name];
      const pv = satellite.propagate(sr, now);
      if (!pv || !pv.position) return;
      const geo = satellite.eciToGeodetic(pv.position, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lon = satellite.degreesLong(geo.longitude);
      const v   = pv.velocity;
      const spd = v ? Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) : 7.66;
      const ex  = registry[name] || {};
      pendingUpdates.set(name, Object.assign({}, ex, {
        id: name, name: name, type: 'SATELLITE',
        lat: lat, lon: lon, alt: geo.height,
        speed: +spd.toFixed(3),
        last_update: now.toISOString(),
        country: ex.country || satCountry(name, ex.group || ''),
      }));
    } catch (ex) {}
  });
  scheduleBatch();
}

// Client-side TLE fallback
async function fetchSatellitesClientSide() {
  try {
    const r = await fetch('https://corsproxy.io/?https://celestrak.org/pub/TLE/active.txt');
    if (!r.ok) throw new Error(r.status);
    const text  = await r.text();
    const lines = text.trim().split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    const tles  = [];
    for (var i = 0; i + 2 < lines.length; i += 3) {
      const n = lines[i], l1 = lines[i + 1], l2 = lines[i + 2];
      if (l1.startsWith('1 ') && l2.startsWith('2 '))
        tles.push({ name: n, line1: l1, line2: l2, group: 'Active' });
    }
    if (tles.length) { ingestTLEs(tles); console.log('ClientTLE loaded:', tles.length); }
  } catch (ex) { console.warn('ClientTLE fallback failed:', ex); }
}
setTimeout(function() {
  if (!Object.keys(satrecMap).length) fetchSatellitesClientSide();
}, 15000);

// Selection
function selectTarget(id) {
  const prev = selectedId;
  selectedId = id;
  if (prev && registry[prev]) renderTarget(registry[prev]);
  if (registry[id]) renderTarget(registry[id]);
  const d = registry[id];
  if (d && d.type === 'SATELLITE' && satrecMap[id]) {
    if (!map.hasLayer(layers.orbits)) layers.orbits.addTo(map);
    drawOrbit(id, satrecMap[id], true);
  }
  if (prev && prev !== id && satrecMap[prev]) drawOrbit(prev, satrecMap[prev], false);
  showPanel(id);
  document.querySelectorAll('.vi').forEach(function(el) {
    el.classList.toggle('sel', el.dataset.id === id);
  });
}

function closePanel() {
  document.getElementById('no-sel').style.display = '';
  document.getElementById('tgt-detail').style.display = 'none';
  var cline = document.getElementById('country-line');
  if (cline) cline.remove();
  if (selectedId && registry[selectedId]) renderTarget(registry[selectedId]);
  if (selectedId && satrecMap[selectedId]) drawOrbit(selectedId, satrecMap[selectedId], false);
  selectedId = null;
  if (trackingId) stopTrack();
}

function showPanel(id) {
  document.getElementById('no-sel').style.display = 'none';
  document.getElementById('tgt-detail').style.display = '';
  refreshPanel(id);
}

function refreshPanel(id) {
  const d = registry[id];
  if (!d) return;
  const isSat = d.type === 'SATELLITE';
  document.getElementById('tc-name').textContent = d.name || id;
  const badge = document.getElementById('tc-badge');
  badge.textContent = d.type || 'Unknown';
  badge.className = 'badge' + (isSat ? ' sat' : '');
  document.getElementById('tc-mmsi').textContent  = d.mmsi || d.id || id;
  document.getElementById('tc-src').textContent   = d.source || '—';
  document.getElementById('tc-lat').textContent   = d.lat  != null ? (+d.lat).toFixed(4)  + '\u00b0' : '—';
  document.getElementById('tc-lon').textContent   = d.lon  != null ? (+d.lon).toFixed(4)  + '\u00b0' : '—';
  document.getElementById('tc-spd').textContent   = d.speed!= null ? (+d.speed).toFixed(1)+ (isSat ? ' km/s' : ' kn') : '—';
  document.getElementById('tc-crs').textContent   = d.course!= null? (+d.course).toFixed(0)+ '\u00b0' : '—';
  document.getElementById('tc-time').textContent  = d.last_update
    ? d.last_update.replace('T', ' ').slice(0, 19) + ' UTC' : '—';
  document.getElementById('alt-row').style.display = isSat ? '' : 'none';
  document.getElementById('grp-row').style.display = isSat ? '' : 'none';
  if (isSat) {
    document.getElementById('tc-alt').textContent = d.alt  != null ? (+d.alt).toFixed(0) + ' km' : '—';
    document.getElementById('tc-grp').textContent = d.group || '—';
  }
  // Country line under name
  var existing = document.getElementById('country-line');
  if (existing) existing.remove();
  if (d.country) {
    var line = document.createElement('div');
    line.id = 'country-line';
    line.style.cssText = 'font-size:10px;color:#ffd740;letter-spacing:1px;margin-top:2px';
    line.textContent = countryFlag(d.country) + ' ' + d.country;
    document.getElementById('tc-name').insertAdjacentElement('afterend', line);
  }
  // Path dots
  var pb = document.getElementById('tc-path-dots');
  pb.innerHTML = '';
  if (d.path && d.path.length) {
    d.path.forEach(function(_, i) {
      var dot = document.createElement('div');
      dot.className = 'pd';
      if (i === d.path.length - 1) dot.style.opacity = '1';
      pb.appendChild(dot);
    });
  }
  // Track button
  var tb = document.getElementById('track-btn');
  if (id === trackingId) { tb.textContent = '\u23f9 STOP TRACKING'; tb.className = 'on'; }
  else                   { tb.textContent = '\u25b6 LOCK TRACK';    tb.className = ''; }
}

// Track-lock
function toggleTrack() {
  if (trackingId === selectedId) { stopTrack(); return; }
  trackingId = selectedId;
  var tb = document.getElementById('track-btn');
  tb.textContent = '\u23f9 STOP TRACKING'; tb.className = 'on';
  var tc = document.getElementById('track-cell');
  if (tc) tc.style.display = '';
  var d = registry[trackingId];
  var tv = document.getElementById('tv-track');
  if (tv) tv.textContent = d ? (d.name || trackingId).toString().slice(0, 10) : trackingId;
  if (d) map.flyTo([d.lat, d.lon], Math.max(map.getZoom(), 6), { duration: 1 });
}
function stopTrack() {
  trackingId = null;
  var tb = document.getElementById('track-btn');
  if (tb) { tb.textContent = '\u25b6 LOCK TRACK'; tb.className = ''; }
  var tc = document.getElementById('track-cell');
  if (tc) tc.style.display = 'none';
}

// Country flags
const FLAG_MAP = {
  USA: '\ud83c\uddfa\ud83c\uddf8', UK: '\ud83c\uddec\ud83c\udde7',
  Russia: '\ud83c\uddf7\ud83c\uddfa', China: '\ud83c\udde8\ud83c\uddf3',
  Japan: '\ud83c\uddef\ud83c\uddf5', EU: '\ud83c\uddea\ud83c\uddfa',
  'EU (ESA)': '\ud83c\uddea\ud83c\uddfa', India: '\ud83c\uddee\ud83c\uddf3',
  Germany: '\ud83c\udde9\ud83c\uddea', France: '\ud83c\uddeb\ud83c\uddf7',
  Spain: '\ud83c\uddea\ud83c\uddf8', Italy: '\ud83c\uddee\ud83c\uddf9',
  Norway: '\ud83c\uddf3\ud83c\uddf4', Denmark: '\ud83c\udde9\ud83c\uddf0',
  Sweden: '\ud83c\uddf8\ud83c\uddea', Finland: '\ud83c\uddeb\ud83c\uddee',
  Netherlands: '\ud83c\uddf3\ud83c\uddf1', Greece: '\ud83c\uddec\ud83c\uddf7',
  Turkey: '\ud83c\uddf9\ud83c\uddf7', Ukraine: '\ud83c\uddfa\ud83c\udde6',
  Poland: '\ud83c\uddf5\ud83c\uddf1', Brazil: '\ud83c\udde7\ud83c\uddf7',
  Australia: '\ud83c\udde6\ud83c\uddfa', Canada: '\ud83c\udde8\ud83c\udde6',
  'South Korea': '\ud83c\uddf0\ud83c\uddf7', Singapore: '\ud83c\uddf8\ud83c\uddec',
  Malaysia: '\ud83c\uddf2\ud83c\uddfe', Indonesia: '\ud83c\uddee\ud83c\udde9',
  Philippines: '\ud83c\uddf5\ud83c\udded', Thailand: '\ud83c\uddf9\ud83c\udded',
  Vietnam: '\ud83c\uddfb\ud83c\uddf3', Bangladesh: '\ud83c\udde7\ud83c\udde9',
  'Sri Lanka': '\ud83c\uddf1\ud83c\uddf0', Pakistan: '\ud83c\uddf5\ud83c\uddf0',
  Iran: '\ud83c\uddee\ud83c\uddf7', 'Saudi Arabia': '\ud83c\uddf8\ud83c\udde6',
  UAE: '\ud83c\udde6\ud83c\uddea', Kuwait: '\ud83c\uddf0\ud83c\uddfc',
  Qatar: '\ud83c\uddf6\ud83c\udde6', Bahrain: '\ud83c\udde7\ud83c\udded',
  Oman: '\ud83c\uddf4\ud83c\uddf2', Panama: '\ud83c\uddf5\ud83c\udde6',
  Liberia: '\ud83c\uddf1\ud83c\uddf7', Bahamas: '\ud83c\udde7\ud83c\uddf8',
  Malta: '\ud83c\uddf2\ud83c\uddf9', Cyprus: '\ud83c\udde8\ud83c\uddfe',
  'Marshall Is.': '\ud83c\uddf2\ud83c\udded', Egypt: '\ud83c\uddea\ud83c\uddec',
  Morocco: '\ud83c\uddf2\ud83c\udde6', 'South Africa': '\ud83c\uddff\ud83c\udde6',
  Nigeria: '\ud83c\uddf3\ud83c\uddec', Kenya: '\ud83c\uddf0\ud83c\uddea',
  Argentina: '\ud83c\udde6\ud83c\uddf7', Mexico: '\ud83c\uddf2\ud83c\uddfd',
  Chile: '\ud83c\udde8\ud83c\uddf1', Colombia: '\ud83c\udde8\ud83c\uddf4',
  International: '\ud83c\udf0e',
};
function countryFlag(c) { return FLAG_MAP[c] || '\ud83c\udff3'; }

// Layer toggles
function toggleLayer(what, btn) {
  if (what === 'ships') {
    showShips = !showShips;
    showShips ? layers.ships.addTo(map) : map.removeLayer(layers.ships);
  } else if (what === 'sats') {
    showSats = !showSats;
    showSats ? layers.sats.addTo(map) : map.removeLayer(layers.sats);
    if (showSats && Object.keys(satrecMap).length) setTimeout(propagateAll, 100);
  } else if (what === 'paths') {
    showPaths = !showPaths;
    showPaths ? layers.paths.addTo(map) : map.removeLayer(layers.paths);
  } else if (what === 'labels') {
    showLabels = !showLabels;
    showLabels ? layers.labels.addTo(map) : map.removeLayer(layers.labels);
    Object.keys(registry).forEach(function(id) {
      if (registry[id]) pendingUpdates.set(id, registry[id]);
    });
    scheduleBatch();
  } else if (what === 'orbits') {
    showOrbits = !showOrbits;
    if (showOrbits) {
      layers.orbits.addTo(map);
      Object.keys(satrecMap).forEach(function(n) { drawOrbit(n, satrecMap[n], n === selectedId); });
    } else {
      Object.keys(orbitLines).forEach(function(k) {
        orbitLines[k].forEach(function(l) { layers.orbits.removeLayer(l); });
        delete orbitLines[k];
      });
      map.removeLayer(layers.orbits);
    }
  } else if (what === 'country') {
    showCountry = !showCountry;
    Object.keys(registry).forEach(function(id) {
      if (registry[id]) pendingUpdates.set(id, registry[id]);
    });
    scheduleBatch();
  }
  if (btn) btn.classList.toggle('on');
}

// Filter
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.f-btn').forEach(function(b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  Object.entries(registry).forEach(function(kv) {
    const id = kv[0], d = kv[1];
    if (!d || d.lat == null) return;
    const isSat = d.type === 'SATELLITE';
    const layer = isSat ? layers.sats : layers.ships;
    const vis = shouldShow(d);
    if (markers[id]) {
      if (vis && !layer.hasLayer(markers[id]))  layer.addLayer(markers[id]);
      if (!vis && layer.hasLayer(markers[id]))  layer.removeLayer(markers[id]);
    }
  });
  updateSidebar();
}

// Search / filter
function searchTargets(q) { listSearch = q; updateSidebar(); }
function filterList(q) { listSearch = q; updateSidebar(); }

// Region focus
function focusRegion(val) {
  if (!val || !REGIONS[val]) return;
  var r = REGIONS[val];
  map.flyTo(r.center, r.zoom, { duration: 1.5 });
}

// Sidebar vessel list
var sidebarTimer = null;
function updateSidebar() {
  clearTimeout(sidebarTimer);
  sidebarTimer = setTimeout(_doSidebar, 200);
}
function _doSidebar() {
  var el = document.getElementById('vessel-list');
  if (!el) return;
  var q = (listSearch || '').toLowerCase();
  var items = Object.values(registry)
    .filter(function(d) { return d && d.lat != null && shouldShow(d); })
    .filter(function(d) {
      if (!q) return true;
      return (d.name || '').toLowerCase().indexOf(q) >= 0 ||
             String(d.mmsi || d.id || '').toLowerCase().indexOf(q) >= 0;
    })
    .sort(function(a, b) {
      return (b.last_update || '') > (a.last_update || '') ? 1 : -1;
    })
    .slice(0, 200);
  el.innerHTML = items.map(function(d) {
    var id  = d.id || d.mmsi;
    var col = typeColor(d.type);
    var flag = (d.country && showCountry) ? countryFlag(d.country) + ' ' : '';
    var ids = String(id).replace(/'/g, "\\'");
    return '<div class="vi' + (id === selectedId ? ' sel' : '') + '" data-id="' + id + '" onclick="selectTarget(\'' + ids + '\')">'
      + '<div class="vi-nm" style="color:' + col + '">' + flag + (d.name || id).toString().slice(0, 22) + '</div>'
      + '<div class="vi-mt">' + (d.type || '?') + ' &middot; ' + (d.source || '—')
      + (d.country ? ' &middot; ' + d.country : '') + '</div>'
      + '</div>';
  }).join('');
}

// Source status LEDs
function updateSources(status) {
  var keys = ['aisstream', 'barentswatch', 'aishub', 'shipxplorer', 'shipinfo', 'satellites'];
  var live = 0;
  keys.forEach(function(k) {
    var v   = status[k] || 'IDLE';
    var el  = document.getElementById('val-' + k);
    var led = document.getElementById('led-' + k);
    if (el) el.textContent = v;
    if (led) {
      var isLive = v.indexOf('LIVE') === 0;
      var isErr  = v.indexOf('401') >= 0 || v.indexOf('ERROR') >= 0 || v.indexOf('HTTP 4') >= 0 || v.indexOf('HTTP 5') >= 0;
      var isConn = v.indexOf('CONNECTING') >= 0 || v.indexOf('RECONNECTING') >= 0;
      led.className = 'led' + (isLive ? ' live' : isErr ? ' err' : isConn ? ' conn' : '');
      if (isLive) live++;
    }
  });
  var srcs = document.getElementById('tv-srcs');
  if (srcs) srcs.textContent = live + '/6';
}

// Bottom telemetry
function updateTelemetry() {
  var ships = Object.values(registry).filter(function(d) { return d && d.type !== 'SATELLITE'; }).length;
  var sats  = Object.values(registry).filter(function(d) { return d && d.type === 'SATELLITE'; }).length;
  var tvs = document.getElementById('tv-ships');
  var tvsat = document.getElementById('tv-sats');
  var tgt = document.getElementById('tgt-num');
  if (tvs)  tvs.textContent  = ships;
  if (tvsat)tvsat.textContent = sats;
  if (tgt)  tgt.textContent  = ships + sats;
  var tvr = document.getElementById('tv-rate');
  if (tvr) tvr.textContent = msgRate;
}

// UTC clock
setInterval(function() {
  var n = new Date();
  var h = String(n.getUTCHours()).padStart(2, '0');
  var m = String(n.getUTCMinutes()).padStart(2, '0');
  var s = String(n.getUTCSeconds()).padStart(2, '0');
  var el = document.getElementById('clock');
  if (el) el.textContent = h + ':' + m + ':' + s + ' UTC';
  msgRate = msgCount; msgCount = 0;
}, 1000);

// Map move event
map.on('move', function() {
  var c  = map.getCenter();
  var ce = document.getElementById('tv-center');
  var ze = document.getElementById('tv-zoom');
  if (ce) ce.textContent = c.lat.toFixed(1) + '\u00b0 ' + c.lng.toFixed(1) + '\u00b0';
  if (ze) ze.textContent = map.getZoom();
});

// Boot
connectWS();
updateTelemetry();

// Expose to HTML onclick
window.toggleLayer   = toggleLayer;
window.setFilter     = setFilter;
window.focusRegion   = focusRegion;
window.searchTargets = searchTargets;
window.filterList    = filterList;
window.selectTarget  = selectTarget;
window.closePanel    = closePanel;
window.toggleTrack   = toggleTrack;
