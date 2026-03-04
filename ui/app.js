/* ── Global Ship & Satellite Tracker v3 ── */
"use strict";

// ── Configuration ─────────────────────────────────────────────────────────────
const WS_HOST = location.host;
const REGIONS = {
  europe:      { lat: 56, lon: 3, zoom: 5 },
  india:       { lat: 15, lon: 72, zoom: 5 },
  bay_bengal:  { lat: 15, lon: 88, zoom: 5 },
  south_china: { lat: 14, lon: 114, zoom: 5 },
  persian_gulf:{ lat: 26, lon: 53, zoom: 6 },
  malacca:     { lat: 3,  lon: 102, zoom: 7 },
  med:         { lat: 38, lon: 16, zoom: 5 },
  us_east:     { lat: 37, lon: -73, zoom: 5 },
  suez:        { lat: 30, lon: 32.5, zoom: 7 },
};

// ── State ─────────────────────────────────────────────────────────────────────
let registry    = {};         // id → data
let markers     = {};         // id → L.Marker
let pathLines   = {};         // id → L.Polyline
let selectedId  = null;
let trackingId  = null;
let activeFilter= "ALL";
let showShips   = true;
let showSats    = true;       // off by default (toggle via SAT button)
let showPaths   = true;
let showLabels  = true;
let tleCatalog  = [];
let msgCount    = 0;
let msgRate     = 0;
let listFilterQ = "";
let ws          = null;
let wsRecoTimer = null;
const pending   = new Map();
let rafId       = null;

// ── Map init ──────────────────────────────────────────────────────────────────
const map = L.map("map", {
  center: [20, 0], zoom: 3,
  zoomControl: true, attributionControl: true,
}).setView([20, 0], 3);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution: "CartoDB",
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// ── Clock ─────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const utc = now.toUTCString().split(" ");
  document.getElementById("clock").textContent =
    `${utc[4]} UTC ${now.toLocaleDateString("en",{month:"2-digit",day:"2-digit",year:"numeric"})}`;
}
setInterval(updateClock, 1000);
updateClock();

// Message rate counter
setInterval(() => {
  msgRate = msgCount; msgCount = 0;
  document.getElementById("tv-rate").textContent = msgRate;
}, 1000);

// Map telemetry
map.on("move zoom", () => {
  const c = map.getCenter();
  document.getElementById("tv-center").textContent =
    `${c.lat.toFixed(2)}° ${c.lng.toFixed(2)}°`;
  document.getElementById("tv-zoom").textContent = map.getZoom();
});

// ── Icon builder ──────────────────────────────────────────────────────────────
const TYPE_COLORS = {
  "Cargo":     "#42a5f5", "Tanker":   "#ff7043", "Passenger": "#ab47bc",
  "Fishing":   "#ffca28", "Military": "#ef5350", "Tug":       "#78909c",
  "High Speed":"#26c6da", "Pilot":    "#66bb6a", "SAR":       "#ff80ab",
  "SATELLITE": "#ce93d8", "Unknown":  "#455a64",
};

function getColor(type) {
  return TYPE_COLORS[type] || TYPE_COLORS["Unknown"];
}

function buildShipSVG(color, course, selected, size = 18) {
  const glow = selected ? `filter="url(#gw)"` : "";
  const sc   = selected ? "1.3" : "1";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-12 -12 24 24" style="transform:rotate(${course}deg);overflow:visible">
    <defs>
      <radialGradient id="bg${color.replace('#','')}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${color}" stop-opacity=".25"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </radialGradient>
      ${selected ? `<filter id="gw" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="2.5" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>` : ""}
    </defs>
    <circle cx="0" cy="0" r="10" fill="url(#bg${color.replace('#','')})"/>
    <polygon points="0,-8 5,6 0,3 -5,6" fill="${color}" ${glow}
      stroke="${selected ? '#fff' : 'none'}" stroke-width="${selected ? .8 : 0}"
      transform="scale(${sc})"/>
  </svg>`;
}

function buildSatSVG(color, selected) {
  const glow = selected
    ? "0 0 10px #ce93d8, 0 0 22px #7c4dff"
    : "0 0 5px #ce93d888";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" style="filter:drop-shadow(${glow});overflow:visible">
    <rect x="10" y="10" width="4" height="4" rx=".5" fill="${color}" opacity=".95"/>
    <line x1="12" y1="2" x2="12" y2="9"  stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12" y1="15" x2="12" y2="22" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="2" y1="12" x2="9" y2="12"  stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="15" y1="12" x2="22" y2="12" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/>
    <rect x="3" y="10" width="5" height="4" rx=".5" fill="#7c4dff" opacity=".6"/>
    <rect x="16" y="10" width="5" height="4" rx=".5" fill="#7c4dff" opacity=".6"/>
    ${selected ? `<circle cx="12" cy="12" r="8" fill="none" stroke="#ce93d8" stroke-width=".5" opacity=".5"/>` : ""}
  </svg>`;
}

function makeIcon(data, selected = false) {
  const isSat = data.type === "SATELLITE";
  const color = getColor(data.type);
  const svg   = isSat
    ? buildSatSVG(color, selected)
    : buildShipSVG(color, data.course || 0, selected);
  const sz = isSat ? [22, 22] : [18, 18];
  return L.divIcon({
    html: svg,
    iconSize: sz,
    iconAnchor: [sz[0] / 2, sz[1] / 2],
    className: "",
  });
}

// ── Visibility check ──────────────────────────────────────────────────────────
function isVisible(d) {
  if (d.type === "SATELLITE") return showSats && (activeFilter === "ALL" || activeFilter === "SATELLITE");
  if (!showShips) return false;
  if (activeFilter === "ALL" || activeFilter === "SATELLITE") return activeFilter === "ALL";
  return d.type === activeFilter;
}

function shouldShowFilter(d) {
  if (activeFilter === "ALL") return d.type !== "SATELLITE" ? showShips : showSats;
  if (activeFilter === "SATELLITE") return showSats && d.type === "SATELLITE";
  return showShips && d.type === activeFilter;
}

function visible(d) {
  if (d.type === "SATELLITE") return showSats && (activeFilter === "ALL" || activeFilter === "SATELLITE");
  if (!showShips) return false;
  return activeFilter === "ALL" || activeFilter === d.type;
}

// ── Render target ─────────────────────────────────────────────────────────────
function renderTarget(d) {
  const id = d.id || d.mmsi;
  if (!id) return;

  registry[id] = d;
  msgCount++;

  const vis = visible(d);
  const lat = parseFloat(d.lat), lon = parseFloat(d.lon);
  if (isNaN(lat) || isNaN(lon)) return;

  if (markers[id]) {
    if (!vis) {
      map.removeLayer(markers[id]);
      if (pathLines[id]) map.removeLayer(pathLines[id]);
      return;
    }
    // Update existing marker
    markers[id].setLatLng([lat, lon]);
    if (markers[id].getIcon) {
      // rotate ship icon via CSS (cheaper than rebuilding SVG)
      const ico = markers[id]._icon;
      if (ico && id !== selectedId) {
        const svg = ico.querySelector("svg");
        if (svg && d.type !== "SATELLITE")
          svg.style.transform = `rotate(${d.course || 0}deg)`;
      }
    }
    if (selectedId === id) {
      markers[id].setIcon(makeIcon(d, true));
      showPanel(id);
    }
    updatePath(id);
    if (trackingId === id) map.panTo([lat, lon], { animate: false });
  } else {
    if (!vis) return;
    const m = L.marker([lat, lon], {
      icon: makeIcon(d, false),
      zIndexOffset: d.type === "SATELLITE" ? 500 : 0,
    });
    if (showLabels && d.name && d.name !== "IDENTIFYING...") {
      m.bindTooltip(d.name, {
        permanent: true, direction: "right",
        className: "ship-label",
        offset: [6, 0],
      });
    }
    m.on("click", () => selectTarget(id));
    m.addTo(map);
    markers[id] = m;
    updatePath(id);
  }
}

// ── Paths ─────────────────────────────────────────────────────────────────────
function updatePath(id) {
  const d = registry[id];
  if (!d || !showPaths || !d.path || d.path.length < 2) {
    if (pathLines[id]) { map.removeLayer(pathLines[id]); delete pathLines[id]; }
    return;
  }
  const pts = d.path.map(p => [p.lat, p.lon]);
  const color = getColor(d.type);
  if (pathLines[id]) {
    pathLines[id].setLatLngs(pts);
  } else {
    pathLines[id] = L.polyline(pts, {
      color, weight: 1.5, opacity: 0.5, dashArray: "4 4",
    }).addTo(map);
  }
}

// ── Batch flush ───────────────────────────────────────────────────────────────
function scheduleFlush() {
  if (!rafId) rafId = requestAnimationFrame(flush);
}

function flush() {
  rafId = null;
  const batch = [...pending.values()]; pending.clear();
  batch.forEach(renderTarget);
  // Update counts
  const ships = Object.values(registry).filter(d => d.type !== "SATELLITE").length;
  const sats  = Object.values(registry).filter(d => d.type === "SATELLITE").length;
  document.getElementById("tgt-num").textContent  = ships + sats;
  document.getElementById("tv-ships").textContent = ships;
  document.getElementById("tv-sats").textContent  = sats;
  refreshList();
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  clearTimeout(wsRecoTimer);
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${WS_HOST}/ws`);
  ws.onopen = () => {
    document.getElementById("ws-dot").classList.add("on");
    document.getElementById("ws-lbl").textContent = "LIVE";
  };
  ws.onmessage = e => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === "source_status") { updateSources(d); return; }
      if (d.type === "tle_catalog")   { tleCatalog = d.tles; return; }
      const id = d.id || d.mmsi;
      if (id) { pending.set(id, d); scheduleFlush(); }
    } catch (er) { console.debug(er); }
  };
  ws.onclose = ws.onerror = () => {
    document.getElementById("ws-dot").classList.remove("on");
    document.getElementById("ws-lbl").textContent = "RECONNECTING";
    wsRecoTimer = setTimeout(connectWS, 4000);
  };
}
connectWS();

// ── Source status ─────────────────────────────────────────────────────────────
const SRC_KEYS = ["aisstream","barentswatch","aishub","shipxplorer","shipinfo","satellites"];
function updateSources(data) {
  let live = 0;
  SRC_KEYS.forEach(k => {
    const v = data[k] || "IDLE";
    const led = document.getElementById(`led-${k}`);
    const val = document.getElementById(`val-${k}`);
    if (val) val.textContent = v;
    if (led) {
      led.classList.remove("live","err","conn");
      if (v.startsWith("LIVE"))        { led.classList.add("live"); live++; }
      else if (v === "CONNECTING" ||
               v === "RECONNECTING")   led.classList.add("conn");
      else if (v === "ERROR" ||
               v.startsWith("HTTP"))   led.classList.add("err");
    }
  });
  document.getElementById("tv-srcs").textContent = `${live}/6`;
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function selectTarget(id) {
  if (selectedId && markers[selectedId]) {
    markers[selectedId].setIcon(makeIcon(registry[selectedId], false));
  }
  selectedId = id;
  if (markers[id]) markers[id].setIcon(makeIcon(registry[id], true));
  showPanel(id);
}

function showPanel(id) {
  const d = registry[id];
  if (!d) return;
  document.getElementById("no-sel").style.display = "none";
  document.getElementById("tgt-detail").style.display = "block";
  const isSat = d.type === "SATELLITE";
  document.getElementById("tc-name").textContent  = d.name || "---";
  const badge = document.getElementById("tc-badge");
  badge.textContent = d.type || "---";
  badge.className   = "badge" + (isSat ? " sat" : "");
  document.getElementById("tc-mmsi").textContent  = d.mmsi || d.id || "---";
  document.getElementById("tc-src").textContent   = d.source || "---";
  document.getElementById("tc-lat").textContent   = typeof d.lat === "number" ? d.lat.toFixed(4) + "°" : "---";
  document.getElementById("tc-lon").textContent   = typeof d.lon === "number" ? d.lon.toFixed(4) + "°" : "---";
  document.getElementById("tc-spd").textContent   = d.speed != null ? `${parseFloat(d.speed).toFixed(1)} kn` : "---";
  document.getElementById("tc-crs").textContent   = d.course != null ? `${parseFloat(d.course).toFixed(0)}°` : "---";

  const altRow = document.getElementById("alt-row");
  const grpRow = document.getElementById("grp-row");
  if (isSat) {
    altRow.style.display = "block";
    grpRow.style.display = "block";
    document.getElementById("tc-alt").textContent = d.alt != null ? `${d.alt} km` : "---";
    document.getElementById("tc-grp").textContent = d.group || "---";
  } else {
    altRow.style.display = "none";
    grpRow.style.display = "none";
  }
  document.getElementById("tc-time").textContent = d.last_update
    ? new Date(d.last_update).toUTCString().replace("GMT","UTC")
    : "---";

  // Path dots
  const dotBar = document.getElementById("tc-path-dots");
  dotBar.innerHTML = "";
  if (d.path && d.path.length) {
    d.path.forEach(() => { const el = document.createElement("div"); el.className = "pd"; dotBar.appendChild(el); });
  }

  // Track button state
  const tb = document.getElementById("track-btn");
  if (trackingId === id) {
    tb.classList.add("on");
    tb.textContent = "⏹ STOP TRACKING";
  } else {
    tb.classList.remove("on");
    tb.textContent = "▶ LOCK TRACK";
  }
  document.getElementById("rp-body").scrollTop = 0;
}

function closePanel() {
  if (selectedId && markers[selectedId]) {
    markers[selectedId].setIcon(makeIcon(registry[selectedId], false));
  }
  selectedId  = null;
  if (trackingId) stopTracking();
  document.getElementById("no-sel").style.display = "flex";
  document.getElementById("tgt-detail").style.display = "none";
}

// ── Track-lock ────────────────────────────────────────────────────────────────
function toggleTrack() {
  if (!selectedId) return;
  if (trackingId === selectedId) { stopTracking(); return; }
  trackingId = selectedId;
  const tb = document.getElementById("track-btn");
  tb.classList.add("on"); tb.textContent = "⏹ STOP TRACKING";
  document.getElementById("track-cell").style.display = "flex";
  document.getElementById("tv-track").textContent =
    (registry[selectedId]?.name || selectedId).substring(0, 10);
  // fly to immediately
  const d = registry[selectedId];
  if (d) map.flyTo([d.lat, d.lon], Math.max(map.getZoom(), 6));
}

function stopTracking() {
  trackingId = null;
  const tb = document.getElementById("track-btn");
  tb.classList.remove("on"); tb.textContent = "▶ LOCK TRACK";
  document.getElementById("track-cell").style.display = "none";
}

// ── Layers ────────────────────────────────────────────────────────────────────
function toggleLayer(layer, btn) {
  if (layer === "ships") {
    showShips = !showShips;
    btn.classList.toggle("on", showShips);
    Object.entries(registry).forEach(([id, d]) => {
      if (d.type !== "SATELLITE") {
        if (showShips && visible(d)) { if (!markers[id]) renderTarget(d); }
        else if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
      }
    });
  } else if (layer === "sats") {
    showSats = !showSats;
    btn.classList.toggle("on", showSats);
    Object.entries(registry).forEach(([id, d]) => {
      if (d.type === "SATELLITE") {
        if (showSats && visible(d)) { if (!markers[id]) renderTarget(d); }
        else if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
      }
    });
  } else if (layer === "paths") {
    showPaths = !showPaths;
    btn.classList.toggle("on", showPaths);
    if (!showPaths)
      Object.keys(pathLines).forEach(id => { map.removeLayer(pathLines[id]); delete pathLines[id]; });
    else
      Object.keys(registry).forEach(id => updatePath(id));
  } else if (layer === "labels") {
    showLabels = !showLabels;
    btn.classList.toggle("on", showLabels);
    Object.entries(markers).forEach(([id, m]) => {
      if (showLabels && registry[id]?.name && registry[id].name !== "IDENTIFYING...")
        m.bindTooltip(registry[id].name, { permanent: true, direction: "right", className: "ship-label", offset: [6, 0] });
      else m.unbindTooltip?.();
    });
  }
}

// ── Filter ────────────────────────────────────────────────────────────────────
function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll(".f-btn").forEach(b => b.classList.remove("on"));
  btn.classList.add("on");
  // Re-render all
  Object.keys(markers).forEach(id => {
    map.removeLayer(markers[id]); delete markers[id];
    if (pathLines[id]) { map.removeLayer(pathLines[id]); delete pathLines[id]; }
  });
  Object.values(registry).forEach(renderTarget);
}

// ── Region focus ──────────────────────────────────────────────────────────────
function focusRegion(key) {
  if (!key) { map.setView([20, 0], 3); return; }
  const r = REGIONS[key];
  if (r) map.flyTo([r.lat, r.lon], r.zoom);
}

// ── Search ────────────────────────────────────────────────────────────────────
function searchTargets(q) {
  const lq = q.toLowerCase();
  if (!lq) {
    Object.values(registry).forEach(renderTarget);
    return;
  }
  Object.entries(registry).forEach(([id, d]) => {
    const hit = (d.name && d.name.toLowerCase().includes(lq)) ||
                (d.mmsi && String(d.mmsi).includes(lq)) ||
                (d.id   && String(d.id).toLowerCase().includes(lq));
    if (hit) renderTarget(d);
    else if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
  });
}

// ── Vessel list ───────────────────────────────────────────────────────────────
let listRafId = null;
function refreshList() {
  if (listRafId) return;
  listRafId = requestAnimationFrame(() => {
    listRafId = null;
    const q   = listFilterQ.toLowerCase();
    const all = Object.values(registry)
      .filter(d => {
        if (!visible(d)) return false;
        if (!q) return true;
        return (d.name && d.name.toLowerCase().includes(q)) ||
               (d.mmsi && String(d.mmsi).includes(q));
      })
      .sort((a, b) => (b.speed || 0) - (a.speed || 0))
      .slice(0, 80);

    const ul = document.getElementById("vessel-list");
    // Reconcile DOM minimally
    const existing = ul.querySelectorAll(".vi");
    const needed = new Set(all.map(d => d.id || d.mmsi));
    existing.forEach(el => { if (!needed.has(el.dataset.id)) el.remove(); });

    all.forEach(d => {
      const id = d.id || d.mmsi;
      let el = ul.querySelector(`.vi[data-id="${id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "vi";
        el.dataset.id = id;
        el.innerHTML = `<div class="vi-nm">${d.name || "IDENTIFYING..."}</div>
          <div class="vi-mt">${d.mmsi || d.id} · ${d.type || "?"} · ${d.source || "?"}</div>`;
        el.onclick = () => { selectTarget(id); if (markers[id]) map.panTo([d.lat, d.lon]); };
        ul.appendChild(el);
      } else {
        el.querySelector(".vi-nm").textContent = d.name || "IDENTIFYING...";
        el.querySelector(".vi-mt").textContent = `${d.mmsi || d.id} · ${d.type || "?"} · ${(d.speed || 0).toFixed(1)} kn`;
      }
      el.classList.toggle("sel", id === selectedId);
    });
  });
}

function filterList(q) { listFilterQ = q; refreshList(); }

// ── Leaflet tooltip style injection ──────────────────────────────────────────
const style = document.createElement("style");
style.textContent = `
.ship-label {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  color: #b0bec5 !important;
  font-family: 'Courier New', monospace !important;
  font-size: 9px !important;
  letter-spacing: .5px !important;
  white-space: nowrap !important;
  text-shadow: 0 0 4px #000 !important;
  padding: 0 !important;
}
.ship-label::before { display: none !important; }
`;
document.head.appendChild(style);
