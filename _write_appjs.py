import pathlib

js = r"""// === Map setup ===
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    center: [20, 0],
    zoom: 3,
    minZoom: 2,
    worldCopyJump: true,
});

map.on('mousemove', (e) => {
    document.getElementById('mouse-lat').innerText = e.latlng.lat.toFixed(4);
    document.getElementById('mouse-lon').innerText = e.latlng.lng.toFixed(4);
});

L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19 }
).addTo(map);

L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png',
    { subdomains: 'abcd', maxZoom: 20 }
).addTo(map);

// === State ===
const shipMarkers      = new Map();
const shipPaths        = new Map();
const shipDataStore    = new Map();
const satelliteMarkers = new Map();
const satrecMap        = new Map();
let   satPropInterval  = null;
let   currentFilter    = 'all';
let   selectedShipMMSI = null;

// === Icons ===
const getIcon = (type, course, isSelected = false) => {
    if (type === 'SATELLITE') {
        const sz   = isSelected ? 28 : 18;
        const glow = isSelected
            ? 'filter:drop-shadow(0 0 8px #b39ddb);'
            : 'filter:drop-shadow(0 0 3px #7c4dff88);';
        const ring = isSelected
            ? '<circle cx="12" cy="12" r="7" fill="none" stroke="#ce93d8" stroke-width=".5" opacity=".4"/>'
            : '';
        return L.divIcon({
            html: `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" style="${glow}">
                <rect x="9" y="9" width="6" height="6" rx="1" fill="#1a0628" stroke="#ce93d8" stroke-width="1.5"/>
                <line x1="12" y1="2"  x2="12" y2="8"  stroke="#ce93d8" stroke-width="1.2"/>
                <line x1="12" y1="16" x2="12" y2="22" stroke="#ce93d8" stroke-width="1.2"/>
                <rect x="2"  y="10" width="6" height="4" rx=".5" fill="#ce93d844" stroke="#ce93d8" stroke-width="1"/>
                <rect x="16" y="10" width="6" height="4" rx=".5" fill="#ce93d844" stroke="#ce93d8" stroke-width="1"/>
                <circle cx="12" cy="12" r="2.5" fill="#ce93d8" opacity=".9"/>
                ${ring}
            </svg>`,
            className:  'sat-icon',
            iconSize:   [sz, sz],
            iconAnchor: [sz / 2, sz / 2],
        });
    }

    let color = '#4daafc';
    const t = (type || '').toLowerCase();
    if      (t.includes('military') || t.includes('law'))          color = '#ff4b2b';
    else if (t.includes('passenger') || t.includes('cruise'))     color = '#ffc837';
    else if (t.includes('tanker'))                                 color = '#a8ff78';
    else if (t.includes('cargo') || t.includes('container'))      color = '#00f2fe';
    else if (t.includes('fishing'))                                color = '#bf5af2';
    else if (t.includes('tug') || t.includes('pilot'))            color = '#ff9f0a';

    const scale = isSelected ? 1.8 : 1.2;
    const glow  = isSelected ? `filter:drop-shadow(0 0 10px ${color});` : '';
    return L.divIcon({
        html: `<svg width="40" height="40" viewBox="0 0 40 40" fill="none"
                style="transform:rotate(${course}deg) scale(${scale});${glow}transition:transform 1.2s cubic-bezier(0,0,0,1);">
            <path d="M20 5 L24 12 L24 32 L20 35 L16 32 L16 12 Z"
                  fill="${color}" fill-opacity=".9" stroke="white" stroke-width=".5"/>
            <path d="M18 12 L22 12 L21 20 L19 20 Z" fill="white" fill-opacity=".4"/>
            <circle cx="20" cy="28" r="1.5" fill="white" fill-opacity=".6"/>
        </svg>`,
        className:  'ship-icon',
        iconSize:   [40, 40],
        iconAnchor: [20, 20],
    });
};

// === Filter ===
const shouldShow = (type) => {
    if (currentFilter === 'all') return true;
    return (type || '').toLowerCase().includes(currentFilter.toLowerCase());
};

const toggleFilter = (filter) => {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const match = (filter === 'all' && btn.innerText.includes('ALL'))
                   || btn.innerText.toUpperCase().includes(filter.toUpperCase());
        btn.classList.toggle('active', match);
    });
    shipMarkers.forEach((marker, id) => {
        const d = shipDataStore.get(id);
        marker.setOpacity(d && shouldShow(d.type) ? 1 : 0);
    });
    satelliteMarkers.forEach((marker, id) => {
        const d = shipDataStore.get(id);
        marker.setOpacity(d && shouldShow(d.type) ? 1 : 0);
    });
};

// === Place / update marker ===
const updateShip = (data) => {
    const { mmsi, id, name, lat, lon, speed, course, type } = data;
    const shipId = mmsi || id;
    if (!shipId || lat == null || lon == null) return;

    shipDataStore.set(shipId, data);
    const isSelected = selectedShipMMSI === shipId;
    const opacity    = shouldShow(type) ? 1 : 0;

    if (type === 'SATELLITE') {
        if (satelliteMarkers.has(shipId)) {
            satelliteMarkers.get(shipId)
                .setLatLng([lat, lon])
                .setIcon(getIcon(type, 0, isSelected));
        } else {
            const m = L.marker([lat, lon], { icon: getIcon(type, 0, isSelected), opacity })
                .on('click', (e) => { L.DomEvent.stopPropagation(e); selectShip(shipId); })
                .addTo(map);
            satelliteMarkers.set(shipId, m);
        }
        satelliteMarkers.get(shipId).setOpacity(opacity);
        document.getElementById('sat-count').innerText = satelliteMarkers.size;
    } else {
        if (shipMarkers.has(shipId)) {
            shipMarkers.get(shipId)
                .setLatLng([lat, lon])
                .setIcon(getIcon(type, course, isSelected));
        } else {
            const m = L.marker([lat, lon], { icon: getIcon(type, course, isSelected), opacity })
                .on('click', (e) => { L.DomEvent.stopPropagation(e); selectShip(shipId); })
                .addTo(map);
            shipMarkers.set(shipId, m);
        }
        shipMarkers.get(shipId).setOpacity(opacity);
        if (isSelected) updatePathDisplay(shipId);
    }

    document.getElementById('target-count').innerText = shipMarkers.size + satelliteMarkers.size;
};

// === TLE ingestion ===
const ingestTLEs = (tles) => {
    if (!tles || !tles.length) return;
    let ok = 0;
    for (const t of tles) {
        try {
            const satrec = satellite.twoline2satrec(t.line1, t.line2);
            satrecMap.set(t.name, satrec);
            if (!shipDataStore.has(t.name)) {
                shipDataStore.set(t.name, {
                    id: t.name, name: t.name, type: 'SATELLITE',
                    lat: 0, lon: 0, alt: 0, speed: 0,
                    group: t.group || '', source: 'CelesTrak',
                });
            }
            ok++;
        } catch (e) { /* bad TLE — skip */ }
    }
    console.log('[TLE] Ingested ' + ok + '/' + tles.length + ' satrecs. Total: ' + satrecMap.size);

    if (!satPropInterval) {
        satPropInterval = setInterval(propagateAll, 2000);
        console.log('[TLE] Propagation loop started');
    }

    document.getElementById('sat-toast').style.display = 'none';

    const badge = document.getElementById('src-satellites');
    if (badge) {
        badge.innerText   = 'LIVE (' + satrecMap.size + ')';
        badge.className   = 'src-badge live';
    }
};

// === SGP4 propagation ===
const propagateAll = () => {
    const now  = new Date();
    const gmst = satellite.gstime(now);

    for (const [name, satrec] of satrecMap) {
        try {
            const pv = satellite.propagate(satrec, now);
            if (!pv || !pv.position) continue;

            const geo = satellite.eciToGeodetic(pv.position, gmst);
            const lat = satellite.degreesLat(geo.latitude);
            const lon = satellite.degreesLong(geo.longitude);
            const alt = geo.height;
            const spd = pv.velocity
                ? Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2)
                : 7.66;

            const ex = shipDataStore.get(name) || {};
            updateShip({
                ...ex, id: name, name, type: 'SATELLITE',
                lat, lon,
                alt:   +alt.toFixed(1),
                speed: +spd.toFixed(3),
                last_update: now.toISOString(),
            });
        } catch (e) { /* decayed / bad TLE */ }
    }
};

// === sat_batch from server ===
const handleSatBatch = (sats) => {
    for (const s of sats) updateShip(s);
};

// === Fallback TLE fetch if server TLEs don't arrive within 15s ===
const fetchTLEsFallback = async () => {
    if (satrecMap.size > 0) return;
    console.warn('[TLE] Server push not received — fetching directly');

    const toast = document.getElementById('sat-toast');
    toast.innerText      = '\u2B23 FETCHING SATELLITE CATALOG (FALLBACK)...';
    toast.style.display  = 'block';

    const URLS = [
        'https://corsproxy.io/?https://celestrak.org/pub/TLE/active.txt',
        'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://celestrak.org/pub/TLE/active.txt'),
        'https://thingproxy.freeboard.io/fetch/https://celestrak.org/pub/TLE/active.txt',
    ];

    for (const url of URLS) {
        try {
            const ctrl = new AbortController();
            const tid  = setTimeout(() => ctrl.abort(), 14000);
            const r    = await fetch(url, { signal: ctrl.signal });
            clearTimeout(tid);
            if (!r.ok) continue;
            const text  = await r.text();
            const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
            const tles  = [];
            for (let i = 0; i + 2 < lines.length; i += 3) {
                const n = lines[i], l1 = lines[i + 1], l2 = lines[i + 2];
                if (l1.startsWith('1 ') && l2.startsWith('2 '))
                    tles.push({ name: n, line1: l1, line2: l2, group: 'Active' });
            }
            if (tles.length) {
                console.log('[TLE] Fallback loaded ' + tles.length + ' TLEs from ' + url);
                ingestTLEs(tles);
                return;
            }
        } catch (e) {
            console.warn('[TLE] Fallback failed:', url, e.message);
        }
    }

    toast.innerText = '\u26A0 SATELLITE CATALOG UNAVAILABLE';
    setTimeout(() => { toast.style.display = 'none'; }, 4000);
};

setTimeout(fetchTLEsFallback, 15000);

// === WebSocket ===
const connectWS = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(protocol + '//' + window.location.host + '/ws');

    ws.onopen = () => {
        console.log('[WS] Connected');
        const toast = document.getElementById('sat-toast');
        toast.innerText     = '\u2B23 LOADING SATELLITE CATALOG...';
        toast.style.display = 'block';
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'source_status') { updateSourcePanel(data); return; }
            if (data.type === 'tle_catalog')   { ingestTLEs(data.tles);  return; }
            if (data.type === 'sat_batch')      { handleSatBatch(data.sats); return; }
            updateShip(data);
        } catch (e) {
            console.warn('[WS] Parse error:', e);
        }
    };

    ws.onclose = () => { setTimeout(connectWS, 2000); };
    ws.onerror = () => ws.close();
};

// === Path display ===
const updatePathDisplay = (shipId) => {
    const data = shipDataStore.get(shipId);
    if (!data) return;
    const { lat, lon, speed, course, path } = data;
    if (shipPaths.has(shipId)) map.removeLayer(shipPaths.get(shipId));
    const latlngs = (path || []).map(p => [p.lat, p.lon]);
    if ((speed || 0) > 1) {
        [30, 60, 120, 240].forEach(min =>
            latlngs.push(predictPath(lat, lon, speed, course, min)));
    }
    if (latlngs.length < 2) return;
    const line = L.polyline(latlngs, {
        color: '#4daafc', weight: 2, opacity: 0.5, dashArray: '8,12', lineCap: 'round',
    }).addTo(map);
    shipPaths.set(shipId, line);
};

const predictPath = (lat, lon, speed, course, minutes) => {
    const R    = 6371;
    const d    = (speed || 0) * 1.852 * (minutes / 60);
    const brng = (course || 0) * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d / R) +
        Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1),
        Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
};

// === Selection ===
const selectShip = (id) => {
    const oldId = selectedShipMMSI;
    selectedShipMMSI = id;

    if (oldId) {
        const od = shipDataStore.get(oldId);
        const om = shipMarkers.get(oldId) || satelliteMarkers.get(oldId);
        if (od && om) om.setIcon(getIcon(od.type, od.course || 0, false));
        if (shipPaths.has(oldId)) {
            map.removeLayer(shipPaths.get(oldId));
            shipPaths.delete(oldId);
        }
    }

    const data   = shipDataStore.get(id);
    if (!data) return;
    const marker = shipMarkers.get(id) || satelliteMarkers.get(id);
    if (marker) marker.setIcon(getIcon(data.type, data.course || 0, true));

    map.flyTo([data.lat, data.lon], data.type === 'SATELLITE' ? 4 : 10, {
        animate: true, duration: 1.5, easeLinearity: 0.25,
    });

    showDetails(id);
    if (data.type !== 'SATELLITE') updatePathDisplay(id);
};

const showDetails = (id) => {
    const data = shipDataStore.get(id);
    if (!data) return;
    const isSat = data.type === 'SATELLITE';

    document.getElementById('detail-name').innerText   = data.name   || 'UNKNOWN TARGET';
    document.getElementById('detail-mmsi').innerText   = data.mmsi   || data.id || id;
    document.getElementById('detail-type').innerText   = data.type   || '\u2014';
    document.getElementById('detail-source').innerText = data.source || 'AISStream';
    document.getElementById('detail-pos').innerText    =
        (+data.lat).toFixed(4) + '\u00b0 , ' + (+data.lon).toFixed(4) + '\u00b0';
    document.getElementById('detail-speed').innerText = isSat
        ? (+data.speed || 0).toFixed(2) + ' km/s'
        : (+data.speed || 0).toFixed(1) + ' kn';
    document.getElementById('detail-course').innerText = isSat
        ? (data.group || '\u2014')
        : (+data.course || 0).toFixed(0) + '\u00b0 TRUE';
    document.getElementById('detail-alt').innerText = isSat && data.alt != null
        ? (+data.alt).toFixed(0) + ' km'
        : '\u2014';
    document.getElementById('ship-details').style.display = 'block';
};

const closeDetails = () => {
    if (selectedShipMMSI) {
        if (shipPaths.has(selectedShipMMSI)) {
            map.removeLayer(shipPaths.get(selectedShipMMSI));
            shipPaths.delete(selectedShipMMSI);
        }
        const d = shipDataStore.get(selectedShipMMSI);
        const m = shipMarkers.get(selectedShipMMSI) || satelliteMarkers.get(selectedShipMMSI);
        if (d && m) m.setIcon(getIcon(d.type, d.course || 0, false));
    }
    selectedShipMMSI = null;
    document.getElementById('ship-details').style.display = 'none';
};

map.on('click', () => closeDetails());

// === Source status panel ===
const updateSourcePanel = (status) => {
    const idMap = {
        aisstream:    'src-aisstream',
        digitraffic:  'src-digitraffic',
        barentswatch: 'src-barentswatch',
        shipxplorer:  'src-shipxplorer',
        shipinfo:     'src-shipinfo',
        aishub:       'src-aishub',
        satellites:   'src-satellites',
    };
    for (const [key, elId] of Object.entries(idMap)) {
        const el  = document.getElementById(elId);
        const val = status[key];
        if (!el || val == null) continue;
        el.innerText = val;
        el.className = 'src-badge ' + (
            val.startsWith('LIVE')       ? 'live'         :
            val === 'IDLE'               ? 'idle'         :
            val.includes('ERROR') || val.includes('HTTP 4') || val.includes('HTTP 5')
                                         ? 'error'        :
            val.includes('RECONNECTING') || val.includes('CONNECTING')
                                         ? 'reconnecting' :
            val === 'NO DATA' || val.includes('UNAVAILABLE')
                                         ? 'nodata'       : 'idle'
        );
    }
};

// === Boot ===
connectWS();
"""

pathlib.Path(r"c:\Users\KIIT\Downloads\ship\ui3\app.js").write_text(js, encoding="utf-8")
print("app.js written:", len(js), "chars")
