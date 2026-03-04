// Map setup
const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    center: [20, 0],
    zoom: 3,
    minZoom: 2,
    worldCopyJump: true,
    fadeAnimation: true,
    markerZoomAnimation: true
});

// Update mouse coordinates in HUD
map.on('mousemove', (e) => {
    document.getElementById('mouse-lat').innerText = e.latlng.lat.toFixed(4);
    document.getElementById('mouse-lon').innerText = e.latlng.lng.toFixed(4);
});

// Satellite Tile Layer (Esri World Imagery) - No API Key required
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
}).addTo(map);

// Add a dark overlay for that "Palantir" look
const darkOverlay = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20
}).addTo(map);

// Store for ship markers and paths
const shipMarkers = new Map();
const shipPaths = new Map();
const shipDataStore = new Map();
const satelliteMarkers = new Map();
let currentFilter = 'all';

// Icons for different ship types - More detailed ship shapes
const getIcon = (type, course, isSelected = false) => {
    if (type === 'SATELLITE') {
        const glow = isSelected ? `filter: drop-shadow(0 0 10px #fff);` : '';
        const svgIcon = `
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="${glow} transition: transform 0.5s ease;">
                <rect x="15" y="15" width="10" height="10" fill="white" fill-opacity="0.8"/>
                <rect x="5" y="18" width="10" height="4" fill="#4daafc" fill-opacity="0.6"/>
                <rect x="25" y="18" width="10" height="4" fill="#4daafc" fill-opacity="0.6"/>
                <path d="M20 10 L20 15 M20 25 L20 30" stroke="white" stroke-width="1"/>
            </svg>
        `;
        return L.divIcon({
            html: svgIcon,
            className: 'sat-icon',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
    }

    let color = '#4daafc'; // Default
    const t = type.toLowerCase();
    
    if (t.includes('military') || t.includes('warship') || t.includes('law')) color = '#ff4b2b';
    else if (t.includes('passenger') || t.includes('cruise') || t.includes('ferry')) color = '#ffc837';
    else if (t.includes('tanker')) color = '#a8ff78';
    else if (t.includes('cargo') || t.includes('container')) color = '#00f2fe';
    else if (t.includes('fishing')) color = '#bf5af2';
    else if (t.includes('tug') || t.includes('pilot')) color = '#ff9f0a';

    const scale = isSelected ? 1.8 : 1.2;
    const glow = isSelected ? `filter: drop-shadow(0 0 10px ${color});` : '';
    
    // Detailed ship silhouette
    const svgIcon = `
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: rotate(${course}deg) scale(${scale}); ${glow} transition: transform 1.2s cubic-bezier(0,0,0,1);">
            <path d="M20 5 L24 12 L24 32 L20 35 L16 32 L16 12 Z" fill="${color}" fill-opacity="0.9" stroke="white" stroke-width="0.5"/>
            <path d="M18 12 L22 12 L21 20 L19 20 Z" fill="white" fill-opacity="0.4"/>
            <circle cx="20" cy="28" r="1.5" fill="white" fill-opacity="0.6"/>
        </svg>
    `;
    
    return L.divIcon({
        html: svgIcon,
        className: 'ship-icon',
        iconSize: [40, 40],
        iconAnchor: [20, 20]
    });
};

// Filtering logic
const toggleFilter = (filter) => {
    currentFilter = filter;
    
    // Update button styles
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.innerText.includes(filter.toUpperCase()) || (filter === 'all' && btn.innerText.includes('ALL'))) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Apply filter to existing markers
    shipMarkers.forEach((marker, mmsi) => {
        const data = shipDataStore.get(mmsi);
        const isVisible = shouldShow(data.type);
        marker.getElement()?.style.setProperty('display', isVisible ? 'block' : 'none');
        marker.setOpacity(isVisible ? 1 : 0);
    });

    satelliteMarkers.forEach((marker, id) => {
        const data = shipDataStore.get(id);
        const isVisible = shouldShow(data.type);
        marker.getElement()?.style.setProperty('display', isVisible ? 'block' : 'none');
        marker.setOpacity(isVisible ? 1 : 0);
    });
};

const shouldShow = (type) => {
    if (currentFilter === 'all') return true;
    return type.toLowerCase().includes(currentFilter.toLowerCase());
};

// WebSocket setup
const connectWS = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'source_status') {
            updateSourcePanel(data);
        } else {
            updateShip(data);
        }
    };

    ws.onclose = () => setTimeout(connectWS, 2000);
};

let selectedShipMMSI = null;

const updateShip = (data) => {
    const { mmsi, id, name, lat, lon, speed, course, type, path, alt } = data;
    const shipId = mmsi || id;

    if (!shipId) return;

    shipDataStore.set(shipId, data);
    document.getElementById('target-count').innerText = shipMarkers.size + satelliteMarkers.size;

    const isSelected = selectedShipMMSI === shipId;
    const isVisible = shouldShow(type);

    if (type === 'SATELLITE') {
        if (satelliteMarkers.has(shipId)) {
            const marker = satelliteMarkers.get(shipId);
            marker.setLatLng([lat, lon]);
            marker.setIcon(getIcon(type, 0, isSelected));
            const el = marker.getElement();
            if (el) el.style.display = isVisible ? 'block' : 'none';
        } else {
            const marker = L.marker([lat, lon], {
                icon: getIcon(type, 0, isSelected),
                opacity: isVisible ? 1 : 0
            }).addTo(map);
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                selectShip(shipId);
            });
            satelliteMarkers.set(shipId, marker);
        }
        return;
    }

    if (shipMarkers.has(shipId)) {
        const marker = shipMarkers.get(shipId);
        // Leaflet's setLatLng is smooth enough when coupled with CSS transition on the icon
        marker.setLatLng([lat, lon]);
        marker.setIcon(getIcon(type, course, isSelected));
        
        const el = marker.getElement();
        if (el) {
            el.style.display = isVisible ? 'block' : 'none';
        }
    } else {
        const marker = L.marker([lat, lon], {
            icon: getIcon(type, course, isSelected),
            opacity: isVisible ? 1 : 0
        }).addTo(map);
        
        const el = marker.getElement();
        if (el && !isVisible) el.style.display = 'none';

        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            selectShip(shipId);
        });
        shipMarkers.set(shipId, marker);
    }

    if (isSelected) updatePathDisplay(shipId);
};

// ... (rest of the functions remain mostly same but updated for style)

const updatePathDisplay = (shipId) => {
    const data = shipDataStore.get(shipId);
    if (!data) return;
    const { lat, lon, speed, course, path } = data;
    
    if (shipPaths.has(shipId)) map.removeLayer(shipPaths.get(shipId));

    const latlngs = path.map(p => [p.lat, p.lon]);
    if (speed > 1) {
        // Extended prediction points
        [30, 60, 120, 240].forEach(min => {
            latlngs.push(predictPath(lat, lon, speed, course, min));
        });
    }
    
    const pathLine = L.polyline(latlngs, {
        color: '#4daafc',
        weight: 2,
        opacity: 0.5,
        dashArray: '8, 12',
        lineCap: 'round'
    }).addTo(map);
    shipPaths.set(shipId, pathLine);
};

const selectShip = (id) => {
    const oldId = selectedShipMMSI;
    selectedShipMMSI = id;
    
    // Reset old marker
    if (oldId) {
        const oldData = shipDataStore.get(oldId);
        if (oldData) {
            const oldMarker = shipMarkers.get(oldId) || satelliteMarkers.get(oldId);
            if (oldMarker) oldMarker.setIcon(getIcon(oldData.type, oldData.course || 0, false));
        }
        if (shipPaths.has(oldId)) {
            map.removeLayer(shipPaths.get(oldId));
            shipPaths.delete(oldId);
        }
    }

    const data = shipDataStore.get(id);
    if (!data) return;

    const marker = shipMarkers.get(id) || satelliteMarkers.get(id);
    if (marker) marker.setIcon(getIcon(data.type, data.course || 0, true));
    
    // Smooth zoom and pan
    map.flyTo([data.lat, data.lon], 12, {
        animate: true,
        duration: 1.5,
        easeLinearity: 0.25
    });
    
    showDetails(id);
    if (data.type !== 'SATELLITE') updatePathDisplay(id);
};

// ... (predictPath, showDetails, closeDetails remain same as before but let's re-add them for completeness)

const predictPath = (lat, lon, speed, course, minutes) => {
    const R = 6371;
    const d = (speed * 1.852 * (minutes / 60));
    const brng = course * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
};

const showDetails = (id) => {
    const data = shipDataStore.get(id);
    if (!data) return;

    document.getElementById('detail-name').innerText = data.name || 'UNKNOWN TARGET';
    document.getElementById('detail-mmsi').innerText = data.mmsi || data.id;
    document.getElementById('detail-type').innerText = data.type;
    
    if (data.type === 'SATELLITE') {
        document.getElementById('detail-speed').innerText = `ALT: ${data.alt.toFixed(1)} KM`;
        document.getElementById('detail-course').innerText = `NORAD ID: ${data.id}`;
    } else {
        document.getElementById('detail-speed').innerText = `${data.speed.toFixed(1)} KNOTS`;
        document.getElementById('detail-course').innerText = `${data.course.toFixed(0)}° TRUE`;
    }
    
    document.getElementById('detail-pos').innerText = `${data.lat.toFixed(4)}N, ${data.lon.toFixed(4)}E`;
    document.getElementById('detail-source').innerText = data.source || 'AISStream';
    document.getElementById('ship-details').style.display = 'block';
};

// Source panel updater
const updateSourcePanel = (status) => {
    const srcKeys = {
        aisstream:    'src-aisstream',
        digitraffic:  'src-digitraffic',
        barentswatch: 'src-barentswatch',
        shipxplorer:  'src-shipxplorer',
        shipinfo:     'src-shipinfo',
        aishub:       'src-aishub',
        satellites:   'src-satellites',
    };
    for (const [key, elId] of Object.entries(srcKeys)) {
        const el = document.getElementById(elId);
        if (!el || !status[key]) continue;
        const val = status[key];
        el.innerText = val;
        el.className = 'src-badge ' + (
            val.startsWith('LIVE')         ? 'live' :
            val === 'IDLE'                 ? 'idle' :
            val === 'ERROR'                ? 'error' :
            val === 'RECONNECTING'         ? 'reconnecting' :
            val === 'NO DATA'              ? 'nodata' : 'idle'
        );
    }
};

const closeDetails = () => {
    if (selectedShipMMSI) {
        if (shipPaths.has(selectedShipMMSI)) {
            map.removeLayer(shipPaths.get(selectedShipMMSI));
            shipPaths.delete(selectedShipMMSI);
        }
        const data = shipDataStore.get(selectedShipMMSI);
        const marker = shipMarkers.get(selectedShipMMSI) || satelliteMarkers.get(selectedShipMMSI);
        if (data && marker) {
            marker.setIcon(getIcon(data.type, data.course || 0, false));
        }
    }
    selectedShipMMSI = null;
    document.getElementById('ship-details').style.display = 'none';
};

map.on('click', () => closeDetails());
connectWS();
