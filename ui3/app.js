/* MARITIME OSINT v4 - Ship & Satellite Tracker
   satellite.js SGP4 | orbital ground tracks | country flags | track-lock */

const map = L.map('map', { center:[20,10], zoom:3, zoomControl:true, preferCanvas:true, tap:false });
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution:'&copy; Carto &copy; OSM', subdomains:'abcd', maxZoom:19
}).addTo(map);

const registry={}, markers={}, pathLines={}, orbitLines={}, labelDivs={}, satrecMap={};
let activeFilter='ALL', listSearch='', showShips=true, showSats=true;
let showPaths=true, showLabels=true, showCountry=false, showOrbits=false;
let selectedId=null, trackingId=null, msgCount=0, msgRate=0, satInterval=null;

// ── World-main satellite algorithm: group colors, REST layer state ────────────
const SAT_WM_COLORS = {
  STARLINK:'#60a5fa', GPS:'#4ade80', MILITARY:'#f87171', WEATHER:'#fb923c',
  STATION:'#facc15', ONEWEB:'#4fc3f7', GALILEO:'#c084fc', GLONASS:'#f472b6',
  BEIDOU:'#fbbf24', AMATEUR:'#a3e635', DEBRIS:'#94a3b8', DEFAULT:'#a78bfa',
};
// Country colors for badge overlay
const COUNTRY_COLORS = {
  USA:'#60a5fa', Russia:'#f87171', EU:'#c084fc', China:'#fbbf24',
  Japan:'#fb923c', India:'#4ade80', UK:'#4fc3f7', International:'#facc15',
  Israel:'#94a3b8','South Korea':'#e879f9','Canada':'#22d3ee',
};
let satGroupLayer = null;       // L.layerGroup for REST-loaded sat group
let currentSatGroup = 'active'; // currently selected group
let satGroupData = null;        // last REST response
let satGroupLoading = false;

const layers={
  ships:  L.layerGroup().addTo(map),
  sats:   L.layerGroup().addTo(map),
  paths:  L.layerGroup().addTo(map),
  orbits: L.layerGroup(),
  labels: L.layerGroup().addTo(map),
};

const pendingUpdates=new Map();
let flushScheduled=false;

const REGIONS={
  europe:       {center:[55,10],  zoom:5},
  india:        {center:[15,72],  zoom:5},
  bay_bengal:   {center:[15,90],  zoom:5},
  south_china:  {center:[15,115], zoom:5},
  persian_gulf: {center:[26,54],  zoom:6},
  malacca:      {center:[3,102],  zoom:6},
  med:          {center:[37,18],  zoom:5},
  us_east:      {center:[38,-72], zoom:5},
  suez:         {center:[30,32.5],zoom:7},
};

const TYPE_COLORS={
  Cargo:'#42a5f5', Tanker:'#ff7043', Passenger:'#ab47bc',
  Fishing:'#ffca28', Military:'#ef5350', Tug:'#78909c',
  'High Speed':'#26c6da', Pilot:'#66bb6a', SAR:'#ff80ab',
  SATELLITE:'#ce93d8', Unknown:'#455a64',
};
function typeColor(t){ return TYPE_COLORS[t]||'#455a64'; }

function satCountry(name,group){
  const n=(name||'').toUpperCase();
  if(n.includes('STARLINK'))   return 'USA';
  if(n.includes('ONEWEB'))     return 'UK';
  if(n.includes('ISS')||n.includes('ZARYA')||n.includes('ZVEZDA')) return 'International';
  if(n.startsWith('GOES')||n.startsWith('NOAA')||n.startsWith('GPS')||n.startsWith('IRIDIUM')) return 'USA';
  if(n.startsWith('COSMOS')||n.startsWith('GLONASS')||n.startsWith('MOLNIYA')||n.startsWith('METEOR')||n.startsWith('ELEKTRO')) return 'Russia';
  if(n.startsWith('GALILEO')||n.startsWith('ENVISAT')||n.startsWith('SENTINEL')) return 'EU';
  if(n.startsWith('BEIDOU')||n.startsWith('CZ-')||n.startsWith('YAOGAN')) return 'China';
  if(n.startsWith('HIMAWARI')||n.startsWith('MTSAT')) return 'Japan';
  if(n.startsWith('INSAT')||n.startsWith('GSAT')||n.startsWith('CARTOSAT')||n.startsWith('RISAT')) return 'India';
  if(n.startsWith('INTELSAT')) return 'International';
  return '';
}

function buildShipIcon(type,course,selected){
  const c=typeColor(type), sz=selected?22:16, rot=(course||0)-90;
  const glow=selected?`filter:drop-shadow(0 0 6px ${c});`:`filter:drop-shadow(0 0 2px ${c}66);`;
  const k=type.replace(/\W/g,'');
  return L.divIcon({className:'',
    html:`<div style="width:${sz}px;height:${sz}px;transform:rotate(${rot}deg);${glow}">
      <svg viewBox="0 0 24 24" width="${sz}" height="${sz}">
        <defs><radialGradient id="rg${k}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${c}" stop-opacity=".95"/>
          <stop offset="100%" stop-color="${c}" stop-opacity=".2"/>
        </radialGradient></defs>
        <polygon points="12,2 20,19 12,15 4,19" fill="url(#rg${k})" stroke="${c}" stroke-width="${selected?1.8:1}"/>
      </svg></div>`,
    iconSize:[sz,sz], iconAnchor:[sz/2,sz/2]});
}

function buildSatIcon(group,selected){
  const sz=selected?20:14, body=group==='Starlink'?'#80cbc4':group==='GPS'?'#fff176':'#ce93d8';
  const glow=selected?6:3;
  return L.divIcon({className:'',
    html:`<div style="width:${sz}px;height:${sz}px;filter:drop-shadow(0 0 ${glow}px #b39ddb)">
      <svg viewBox="0 0 24 24" width="${sz}" height="${sz}">
        <rect x="9" y="9" width="6" height="6" rx="1" fill="#1a0628" stroke="${body}" stroke-width="1.5"/>
        <line x1="12" y1="2" x2="12" y2="8" stroke="${body}" stroke-width="1.2"/>
        <line x1="12" y1="16" x2="12" y2="22" stroke="${body}" stroke-width="1.2"/>
        <rect x="2" y="10" width="6" height="4" rx=".5" fill="${body}44" stroke="${body}" stroke-width="1"/>
        <rect x="16" y="10" width="6" height="4" rx=".5" fill="${body}44" stroke="${body}" stroke-width="1"/>
        <circle cx="12" cy="12" r="2.5" fill="${body}" opacity=".9"/>
        ${selected?`<circle cx="12" cy="12" r="7" fill="none" stroke="${body}" stroke-width=".4" opacity=".4"/>`:''}
      </svg></div>`,
    iconSize:[sz,sz], iconAnchor:[sz/2,sz/2]});
}

function computeGroundTrack(satrec,minutes){
  minutes=minutes||95;
  const segs=[], coords=[];
  let prevLon=null;
  const now=new Date();
  for(let i=0;i<=minutes;i+=2){
    try{
      const t=new Date(now.getTime()+i*60000);
      const pv=satellite.propagate(satrec,t);
      if(!pv||!pv.position) continue;
      const gmst=satellite.gstime(t);
      const geo=satellite.eciToGeodetic(pv.position,gmst);
      const lat=satellite.degreesLat(geo.latitude);
      const lon=satellite.degreesLong(geo.longitude);
      if(prevLon!==null&&Math.abs(lon-prevLon)>180){
        if(coords.length) segs.push(coords.slice());
        coords.length=0;
      }
      coords.push([lat,lon]);
      prevLon=lon;
    }catch(e){}
  }
  if(coords.length) segs.push(coords);
  return segs;
}

function drawOrbit(id,satrec,isSelected){
  if(orbitLines[id]){ orbitLines[id].forEach(l=>layers.orbits.removeLayer(l)); delete orbitLines[id]; }
  if(!showOrbits&&!isSelected) return;
  const segs=computeGroundTrack(satrec);
  const col=isSelected?'#b39ddb':'#6c3fff55', w=isSelected?1.5:0.6;
  orbitLines[id]=segs.map(s=>
    L.polyline(s,{color:col,weight:w,dashArray:isSelected?null:'4 6',interactive:false}).addTo(layers.orbits)
  );
}

function renderTarget(data){
  const id=data.id||data.mmsi; if(!id) return;
  const isSat=data.type==='SATELLITE';
  registry[id]=Object.assign({},registry[id]||{},data);
  const d=registry[id];
  const visible=shouldShow(d);
  const layer=isSat?layers.sats:layers.ships;
  if(!visible){
    if(markers[id])  { layer.removeLayer(markers[id]);       delete markers[id]; }
    if(pathLines[id]){ layers.paths.removeLayer(pathLines[id]);  delete pathLines[id]; }
    if(labelDivs[id]){ layers.labels.removeLayer(labelDivs[id]); delete labelDivs[id]; }
    return;
  }
  const ll=[d.lat,d.lon];
  const icon=isSat?buildSatIcon(d.group,id===selectedId):buildShipIcon(d.type||'Unknown',d.course,id===selectedId);
  if(markers[id]) markers[id].setLatLng(ll).setIcon(icon);
  else markers[id]=L.marker(ll,{icon,zIndexOffset:isSat?500:0}).on('click',()=>selectTarget(id)).addTo(layer);

  if(labelDivs[id]){ layers.labels.removeLayer(labelDivs[id]); delete labelDivs[id]; }
  const wantLabel=(showCountry&&d.country)||(showLabels&&!isSat&&d.name&&d.name!=='IDENTIFYING...');
  if(wantLabel){
    const flag=(showCountry&&d.country)?countryFlag(d.country)+' ':'';
    const nm=(showLabels&&d.name&&d.name!=='IDENTIFYING...')?d.name.slice(0,14):'';
    const line=(flag+nm).trim();
    if(line){
      labelDivs[id]=L.marker(ll,{icon:L.divIcon({className:'',
        html:`<div style="color:#00e5ffbb;background:#060c1477;padding:1px 4px;border-radius:2px;font-size:8px;letter-spacing:.5px;white-space:nowrap;pointer-events:none">${line}</div>`,
        iconAnchor:[-8,5]}),interactive:false}).addTo(layers.labels);
    }
  }
  if(!isSat&&showPaths&&d.path&&d.path.length>1){
    const pts=d.path.map(p=>[p.lat,p.lon]);
    if(pathLines[id]) pathLines[id].setLatLngs(pts);
    else pathLines[id]=L.polyline(pts,{color:typeColor(d.type),weight:1.2,opacity:.5}).addTo(layers.paths);
  }
  if(isSat&&satrecMap[id]) drawOrbit(id,satrecMap[id],id===selectedId);
  if(id===trackingId) map.panTo(ll,{animate:true,duration:.5});
  if(id===selectedId) refreshPanel(id);
}

function shouldShow(d){
  if(!d) return false;
  const isSat=d.type==='SATELLITE';
  if(isSat&&!showSats) return false;
  if(!isSat&&!showShips) return false;
  if(activeFilter==='SATELLITE'&&!isSat) return false;
  if(activeFilter!=='ALL'&&activeFilter!=='SATELLITE'&&d.type!==activeFilter) return false;
  return true;
}

function scheduleBatch(){
  if(flushScheduled) return;
  flushScheduled=true;
  requestAnimationFrame(()=>{
    const items=[...pendingUpdates.values()];
    pendingUpdates.clear(); flushScheduled=false;
    // Process in chunks of 200 per frame to keep UI smooth
    const CHUNK=200;
    if(items.length<=CHUNK){
      items.forEach(renderTarget);
      updateTelemetry(); updateSidebar();
    } else {
      let idx=0;
      function processChunk(){
        const end=Math.min(idx+CHUNK,items.length);
        for(;idx<end;idx++) renderTarget(items[idx]);
        if(idx<items.length) requestAnimationFrame(processChunk);
        else{ updateTelemetry(); updateSidebar(); }
      }
      processChunk();
    }
  });
}

let ws,reconnectTimer;
function connectWS(){
  const proto=location.protocol==='https:'?'wss':'ws';
  ws=new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen=()=>{
    document.getElementById('ws-dot').className='on';
    document.getElementById('ws-lbl').textContent='CONNECTED';
    clearTimeout(reconnectTimer);
  };
  ws.onmessage=e=>{
    msgCount++;
    try{
      const d=JSON.parse(e.data);
      if(d.type==='source_status'){ updateSources(d); return; }
      if(d.type==='tle_catalog')  { ingestTLEs(d.tles); return; }
      // sat_batch: array of server-propagated satellite positions
      if(d.type==='sat_batch'){
        for(const s of d.sats){
          s.country=s.country||satCountry(s.name,s.group);
          pendingUpdates.set(s.id,s);
        }
        scheduleBatch(); return;
      }
      const id=d.id||d.mmsi; if(!id) return;
      if(d.type==='SATELLITE') d.country=d.country||satCountry(d.name,d.group);
      pendingUpdates.set(id,d); scheduleBatch();
    }catch(ex){}
  };
  ws.onclose=()=>{
    document.getElementById('ws-dot').className='';
    document.getElementById('ws-lbl').textContent='DISCONNECTED';
    reconnectTimer=setTimeout(connectWS,3000);
  };
  ws.onerror=()=>ws.close();
}

function ingestTLEs(tles){
  if(!tles||!tles.length) return;
  // Guard: satellite.js might not be loaded yet
  if(typeof satellite==='undefined'){
    setTimeout(()=>ingestTLEs(tles),500);
    return;
  }
  let ok=0;
  for(const t of tles){
    try{
      satrecMap[t.name]=satellite.twoline2satrec(t.line1,t.line2);
      if(!registry[t.name]) registry[t.name]={};
      registry[t.name].country=satCountry(t.name,t.group);
      ok++;
    }catch(ex){}
  }
  if(ok>0) console.log('satellite.js satrecs accumulated:',Object.keys(satrecMap).length);
  // Auto-enable SAT layer when TLEs arrive
  if(!showSats){
    showSats=true;
    layers.sats.addTo(map);
    const satBtn=document.querySelector('[onclick*=\'sats\']');
    if(satBtn){ satBtn.classList.add('on'); satBtn.classList.remove('loading'); }
  }
  if(!satInterval) satInterval=setInterval(propagateAll,2000);
  setTimeout(propagateAll,100);
  if(showOrbits) Object.keys(satrecMap).forEach(n=>drawOrbit(n,satrecMap[n],n===selectedId));
  // Update satellite LED
  const total=Object.keys(satrecMap).length;
  const satLed=document.getElementById('led-satellites');
  if(satLed) satLed.className='led live';
  const satVal=document.getElementById('val-satellites');
  if(satVal) satVal.textContent='LIVE ('+total+')';
  const satLoad=document.getElementById('sat-loading');
  if(satLoad) satLoad.className=(total<100)?'':'hidden';
}

function propagateAll(){
  if(!showSats) return;
  if(typeof satellite==='undefined') return; // satellite.js not ready
  const now=new Date(), gmst=satellite.gstime(now);
  for(const[name,sr] of Object.entries(satrecMap)){
    try{
      const pv=satellite.propagate(sr,now);
      if(!pv||!pv.position) continue;
      const geo=satellite.eciToGeodetic(pv.position,gmst);
      const lat=satellite.degreesLat(geo.latitude);
      const lon=satellite.degreesLong(geo.longitude);
      const v=pv.velocity;
      const spd=v?Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z):7.66;
      const ex=registry[name]||{};
      pendingUpdates.set(name,Object.assign({},ex,{
        id:name,name,type:'SATELLITE',lat,lon,alt:geo.height,
        speed:+spd.toFixed(3),last_update:now.toISOString(),
        country:ex.country||satCountry(name,ex.group||''),
      }));
    }catch(ex){}
  }
  scheduleBatch();
}

function parseTLEText(text, group){
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const tles = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check if current line is a valid TLE Line 1
    if (line.startsWith('1 ') && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (nextLine.startsWith('2 ')) {
        // We found a TLE pair. Does it have a name?
        // If the previous line didn't start with '1' or '2', it's likely the name.
        let name = "UNKNOWN";
        if (i > 0) {
          const prevLine = lines[i - 1];
          if (!prevLine.startsWith('1 ') && !prevLine.startsWith('2 ')) {
            name = prevLine;
          }
        }
        // If no name found above, use the NORAD ID from line 1 (columns 3-7)
        if (name === "UNKNOWN") {
          name = "SAT-" + line.substring(2, 7).trim();
        }

        tles.push({
          name: name,
          line1: line,
          line2: nextLine,
          group: group || 'Active'
        });
        i++; // skip nextLine
      }
    }
  }
  return tles;
}

async function fetchTLEsWithFallback(){
  // Show loading state
  const satBtn=document.getElementById('btn-sats');
  if(satBtn) satBtn.classList.add('loading');
  const satLoad=document.getElementById('sat-loading');
  if(satLoad) satLoad.className='';
  const satVal=document.getElementById('val-satellites');
  if(satVal) satVal.textContent='FETCHING...';

  // Wait for satellite.js if needed
  let waitSatLib=0;
  while(typeof satellite==='undefined'&&waitSatLib<20){
    await new Promise(r=>setTimeout(r,500));
    waitSatLib++;
  }
  if(typeof satellite==='undefined'){
    console.error('satellite.js failed to load!');
    if(satVal) satVal.textContent='CDN FAILED';
    if(satLoad) satLoad.className='hidden';
    return;
  }

  const SOURCES=[
    // CelesTrak active (full ~6000 sats)
    ['https://celestrak.org/pub/TLE/active.txt','Active'],
    // CelesTrak via corsproxy
    ['https://corsproxy.io/?https://celestrak.org/pub/TLE/active.txt','Active'],
    // allorigins proxy
    ['https://api.allorigins.win/raw?url='+encodeURIComponent('https://celestrak.org/pub/TLE/active.txt'),'Active'],
    // thingproxy
    ['https://thingproxy.freeboard.io/fetch/https://celestrak.org/pub/TLE/active.txt','Active'],
    // Stations only (fallback, just ISS+CSS+handful)
    ['https://corsproxy.io/?https://celestrak.org/pub/TLE/stations.txt','Stations'],
    // N2YO recent sats (no auth needed for basic public list)
    ['https://api.n2yo.com/rest/v1/satellite/above/0/0/0/70/0/&apiKey=','Active'],
  ];

  for(const [url,grp] of SOURCES){
    try{
      const ctrl=new AbortController();
      const tid=setTimeout(()=>ctrl.abort(),14000);
      const r=await fetch(url,{signal:ctrl.signal});
      clearTimeout(tid);
      if(!r.ok) continue;
      const text=await r.text();
      // N2YO returns JSON
      if(url.includes('n2yo')){
        try{
          const j=JSON.parse(text);
          const tles=(j.above||[]).map(s=>({
            name:s.satname,
            line1:s.satlat?null:s.tle_line1,  // skip if no TLE lines
            line2:s.tle_line2,
            group:'Active'
          })).filter(s=>s.line1&&s.line2);
          if(tles.length){ ingestTLEs(tles); return; }
        }catch(ex){}
        continue;
      }
      const tles=parseTLEText(text,grp);
      if(tles.length>=3){
        console.log('TLE OK:',url,'→',tles.length);
        ingestTLEs(tles);
        if(satBtn) satBtn.classList.remove('loading');
        return;
      }
    }catch(ex){ console.warn('TLE fail:',url,ex.message); }
  }

  // SatNOGS last resort
  try{
    const r=await fetch('https://db.satnogs.org/api/tle/?format=json&limit=300');
    if(r.ok){
      const j=await r.json();
      const tles=j.filter(e=>e.tle1&&e.tle2).map(e=>({name:e.sat_name||String(e.norad_cat_id),line1:e.tle1,line2:e.tle2,group:'SatNOGS'}));
      if(tles.length){ ingestTLEs(tles); console.log('SatNOGS:',tles.length); }
    }
  }catch(ex){ console.warn('SatNOGS:',ex.message); }

  if(satBtn) satBtn.classList.remove('loading');
  if(satLoad) satLoad.className='hidden';
}

async function fetchISSLive(){
  // wheretheiss.at is CORS-friendly, try it first
  const sources=[
    async ()=>{
      const r=await fetch('https://api.wheretheiss.at/v1/satellites/25544');
      const d=await r.json();
      return {lat:d.latitude,lon:d.longitude,alt:d.altitude,speed:d.velocity/3600,name:'ISS (ZARYA)',source:'wheretheiss.at'};
    },
    async ()=>{
      const r=await fetch('https://api.open-notify.org/iss-now.json');
      const d=await r.json();
      return {lat:+d.iss_position.latitude,lon:+d.iss_position.longitude,alt:408,speed:7.66,name:'ISS (ZARYA)',source:'open-notify'};
    },
  ];
  for(const src of sources){
    try{
      const pos=await src();
      const obj=Object.assign({
        id:'ISS (ZARYA)',type:'SATELLITE',group:'Stations',country:'International',
        last_update:new Date().toISOString(),
      },pos);
      pendingUpdates.set(obj.id,obj);
      scheduleBatch();
      return;
    }catch(ex){}
  }
}

// Boot: start ISS live immediately and fetch TLEs right away
// Wait for DOM to be ready before starting everything
window.addEventListener('load', () => {
    fetchISSLive();
    setInterval(fetchISSLive, 5000);
    // Show loading indicator immediately for satellites
    (() => {
        const satLoad = document.getElementById('sat-loading');
        if (satLoad) satLoad.className = '';
        const satVal = document.getElementById('val-satellites');
        if (satVal) satVal.textContent = 'LOADING...';
        const satBtn = document.getElementById('btn-sats');
        if (satBtn) satBtn.classList.add('loading');
        // Show satellite group selector (sats visible by default)
        const sgSec = document.getElementById('sat-grp-sec');
        if (sgSec) sgSec.style.display = '';
    })();
    // Start WebSocket
    connectWS();
    // Fetch TLEs: try server first (2s), then client fallback
    setTimeout(() => { if (Object.keys(satrecMap).length < 2) fetchTLEsWithFallback(); }, 2000);
    // Load satellite group from REST API (world-main algorithm)
    setTimeout(() => { loadSatelliteGroup(currentSatGroup).then(d => { if(d) renderSatGroupLayer(); }); }, 3000);
});

function selectTarget(id){
  const prev=selectedId; selectedId=id;
  if(prev&&registry[prev]) renderTarget(registry[prev]);
  if(registry[id]) renderTarget(registry[id]);
  const d=registry[id];
  if(d&&d.type==='SATELLITE'&&satrecMap[id]){
    if(!map.hasLayer(layers.orbits)) layers.orbits.addTo(map);
    drawOrbit(id,satrecMap[id],true);
  }
  if(prev&&prev!==id&&satrecMap[prev]) drawOrbit(prev,satrecMap[prev],false);
  showPanel(id);
  document.querySelectorAll('.vi').forEach(el=>el.classList.toggle('sel',el.dataset.id===id));
}

function closePanel(){
  document.getElementById('no-sel').style.display='';
  document.getElementById('tgt-detail').style.display='none';
  const cl=document.getElementById('country-line'); if(cl) cl.remove();
  if(selectedId&&registry[selectedId]) renderTarget(registry[selectedId]);
  if(selectedId&&satrecMap[selectedId]) drawOrbit(selectedId,satrecMap[selectedId],false);
  selectedId=null;
  if(trackingId) stopTrack();
}

function showPanel(id){
  document.getElementById('no-sel').style.display='none';
  document.getElementById('tgt-detail').style.display='';
  refreshPanel(id);
}

function refreshPanel(id){
  const d=registry[id]; if(!d) return;
  const isSat=d.type==='SATELLITE';
  document.getElementById('tc-name').textContent=d.name||id;
  const badge=document.getElementById('tc-badge');
  badge.textContent=d.type||'Unknown'; badge.className='badge'+(isSat?' sat':'');
  document.getElementById('tc-mmsi').textContent=d.mmsi||d.id||id;
  document.getElementById('tc-src').textContent=d.source||'—';
  document.getElementById('tc-lat').textContent=d.lat!=null?(+d.lat).toFixed(4)+'°':'—';
  document.getElementById('tc-lon').textContent=d.lon!=null?(+d.lon).toFixed(4)+'°':'—';
  document.getElementById('tc-spd').textContent=d.speed!=null?(+d.speed).toFixed(1)+(isSat?' km/s':' kn'):'—';
  document.getElementById('tc-crs').textContent=d.course!=null?(+d.course).toFixed(0)+'°':'—';
  document.getElementById('tc-time').textContent=d.last_update?d.last_update.replace('T',' ').slice(0,19)+' UTC':'—';
  document.getElementById('alt-row').style.display=isSat?'':'none';
  document.getElementById('grp-row').style.display=isSat?'':'none';
  if(isSat){
    document.getElementById('tc-alt').textContent=d.alt!=null?(+d.alt).toFixed(0)+' km':(d.alt_km!=null?(+d.alt_km).toFixed(0)+' km':'—');
    document.getElementById('tc-grp').textContent=d.group||currentSatGroup||'—';
  }
  // ── World-main orbital data rows ──────────────────────────────────────────
  const noradRow=document.getElementById('norad-row');
  const incRow=document.getElementById('inc-row');
  const periodRow=document.getElementById('period-row');
  const countryRow=document.getElementById('country-row');
  if(noradRow){ noradRow.style.display=(isSat&&d.norad)?'':'none'; if(d.norad) document.getElementById('tc-norad').textContent=d.norad; }
  if(incRow){   incRow.style.display=(isSat&&d.inc!=null)?'':'none'; if(d.inc!=null) document.getElementById('tc-inc').textContent=(+d.inc).toFixed(2)+'°'; }
  if(periodRow){ periodRow.style.display=(isSat&&d.period_min!=null)?'':'none'; if(d.period_min!=null) document.getElementById('tc-period').textContent=(+d.period_min).toFixed(1)+' min'; }
  if(countryRow){ const cval=d.country||''; countryRow.style.display=(cval&&isSat)?'':'none'; if(cval) document.getElementById('tc-country').textContent=countryFlag(cval)+' '+cval; }
  // ── Country flag line under name ──────────────────────────────────────────
  const ex=document.getElementById('country-line'); if(ex) ex.remove();
  if(d.country){
    const cl=document.createElement('div');
    cl.id='country-line';
    const cc=COUNTRY_COLORS[d.country]||'#ffd740';
    cl.style.cssText=`font-size:10px;color:${cc};letter-spacing:1px;margin-top:2px`;
    cl.textContent=countryFlag(d.country)+' '+d.country;
    document.getElementById('tc-name').insertAdjacentElement('afterend',cl);
  }
  const pb=document.getElementById('tc-path-dots'); pb.innerHTML='';
  if(d.path&&d.path.length) d.path.forEach((_,i)=>{
    const dot=document.createElement('div'); dot.className='pd';
    if(i===d.path.length-1) dot.style.opacity='1';
    pb.appendChild(dot);
  });
  const tb=document.getElementById('track-btn');
  if(id===trackingId){ tb.textContent='⬛ STOP TRACKING'; tb.className='on'; }
  else               { tb.textContent='▶ LOCK TRACK';    tb.className=''; }
}

function toggleTrack(){
  if(trackingId===selectedId){ stopTrack(); return; }
  trackingId=selectedId;
  const tb=document.getElementById('track-btn');
  tb.textContent='⬛ STOP TRACKING'; tb.className='on';
  const tc=document.getElementById('track-cell'); if(tc) tc.style.display='';
  const d=registry[trackingId];
  const tv=document.getElementById('tv-track');
  if(tv) tv.textContent=d?(d.name||trackingId).toString().slice(0,10):trackingId;
  if(d) map.flyTo([d.lat,d.lon],Math.max(map.getZoom(),6),{duration:1});
}
function stopTrack(){
  trackingId=null;
  const tb=document.getElementById('track-btn');
  if(tb){ tb.textContent='▶ LOCK TRACK'; tb.className=''; }
  const tc=document.getElementById('track-cell'); if(tc) tc.style.display='none';
}

const FLAG_MAP={
  USA:'🇺🇸',UK:'🇬🇧',Russia:'🇷🇺',China:'🇨🇳',Japan:'🇯🇵',EU:'🇪🇺','EU (ESA)':'🇪🇺',
  India:'🇮🇳',Germany:'🇩🇪',France:'🇫🇷',Spain:'🇪🇸',Italy:'🇮🇹',Norway:'🇳🇴',
  Denmark:'🇩🇰',Sweden:'🇸🇪',Finland:'🇫🇮',Netherlands:'🇳🇱',Greece:'🇬🇷',
  Turkey:'🇹🇷',Ukraine:'🇺🇦',Poland:'🇵🇱',Brazil:'🇧🇷',Australia:'🇦🇺',
  Canada:'🇨🇦','South Korea':'🇰🇷',Singapore:'🇸🇬',Malaysia:'🇲🇾',Indonesia:'🇮🇩',
  Philippines:'🇵🇭',Thailand:'🇹🇭',Vietnam:'🇻🇳',Bangladesh:'🇧🇩','Sri Lanka':'🇱🇰',
  Pakistan:'🇵🇰',Iran:'🇮🇷','Saudi Arabia':'🇸🇦',UAE:'🇦🇪',Kuwait:'🇰🇼',
  Qatar:'🇶🇦',Bahrain:'🇧🇭',Oman:'🇴🇲',Panama:'🇵🇦',Liberia:'🇱🇷',Bahamas:'🇧🇸',
  Malta:'🇲🇹',Cyprus:'🇨🇾','Marshall Is.':'🇲🇭',Egypt:'🇪🇬',Morocco:'🇲🇦',
  'South Africa':'🇿🇦',Nigeria:'🇳🇬',Kenya:'🇰🇪',Argentina:'🇦🇷',Mexico:'🇲🇽',
  Chile:'🇨🇱',Colombia:'🇨🇴',International:'🌐',
};
function countryFlag(c){ return FLAG_MAP[c]||'🏳'; }

// ══════════════════════════════════════════════════════════════════════════════
// WORLD-MAIN SATELLITE GROUP ALGORITHM
// Source: world-main(7)/static/app.js — loadSatellites / renderSatellitesLayer
// Enhanced: SGP4-propagated positions, full orbital params, country detection
// ══════════════════════════════════════════════════════════════════════════════

function _satWmColor(name, group){
  const n=(name||'').toUpperCase();
  if(n.includes('STARLINK'))                                     return SAT_WM_COLORS.STARLINK;
  if(n.includes('GPS')||n.includes('NAVSTAR'))                   return SAT_WM_COLORS.GPS;
  if(n.includes('GLONASS'))                                      return SAT_WM_COLORS.GLONASS;
  if(n.includes('GALILEO'))                                      return SAT_WM_COLORS.GALILEO;
  if(n.includes('BEIDOU')||n.includes('COMPASS'))                return SAT_WM_COLORS.BEIDOU;
  if(n.includes('NROL')||n.startsWith('USA ')||n.includes('MILITARY')||n.includes('AEHF')||n.includes('MILSTAR')) return SAT_WM_COLORS.MILITARY;
  if(n.includes('NOAA')||n.includes('GOES')||n.includes('METEOR')||n.includes('FENGYUN')||n.includes('HIMAWARI')) return SAT_WM_COLORS.WEATHER;
  if(n.includes('ISS')||n.includes('ZARYA')||n.includes('STATION')||n.includes('TIANGONG')) return SAT_WM_COLORS.STATION;
  if(n.includes('ONEWEB'))                                       return SAT_WM_COLORS.ONEWEB;
  if(group==='amateur')                                          return SAT_WM_COLORS.AMATEUR;
  if(group==='debris')                                           return SAT_WM_COLORS.DEBRIS;
  return SAT_WM_COLORS.DEFAULT;
}

function _satWmCountry(name){
  const n=(name||'').toUpperCase();
  if(n.includes('STARLINK')||['GPS IIR','GPS IIF','GPS III','NAVSTAR','GOES ','NOAA ','AQUA','TERRA','IRIDIUM','LANDSAT','WGS ','MILSTAR','AEHF','SBIRS'].some(x=>n.includes(x))||n.startsWith('USA ')) return 'USA';
  if(['COSMOS','GLONASS','MOLNIYA','METEOR-','ELEKTRO','RESURS','GONETS'].some(x=>n.includes(x))) return 'Russia';
  if(['GALILEO','ENVISAT','SENTINEL','METEOSAT','PROBA','SPOT '].some(x=>n.includes(x))) return 'EU';
  if(['BEIDOU','YAOGAN','FENGYUN','TIANGONG','TIANHE','SHENZHOU','GAOFEN'].some(x=>n.includes(x))) return 'China';
  if(['HIMAWARI','MTSAT','DAICHI','ALOS','QZSS','MICHIBIKI'].some(x=>n.includes(x))) return 'Japan';
  if(['INSAT','GSAT','CARTOSAT','RISAT','RESOURCESAT','ASTROSAT','IRNSS'].some(x=>n.includes(x))) return 'India';
  if(n.includes('ONEWEB')) return 'UK';
  if(['ISS','ZARYA','ZVEZDA','UNITY','DESTINY','HARMONY'].some(x=>n.includes(x))) return 'International';
  if(['INTELSAT','EUTELSAT','INMARSAT','SES-'].some(x=>n.includes(x))) return 'International';
  if(['AMOS','OFEK','OFEQ','TECSAR'].some(x=>n.includes(x))) return 'Israel';
  if(['RADARSAT','CASSIOPE','SCISAT'].some(x=>n.includes(x))) return 'Canada';
  if(['KOMPSAT','ARIRANG'].some(x=>n.includes(x))) return 'South Korea';
  return '';
}

async function loadSatelliteGroup(group){
  if(satGroupLoading) return null;
  satGroupLoading=true;
  const satLoad=document.getElementById('sat-loading');
  const satVal=document.getElementById('val-satellites');
  if(satLoad) satLoad.className='';
  if(satVal) satVal.textContent='FETCHING '+group.toUpperCase()+'...';
  try{
    const [tleRes, issRes] = await Promise.allSettled([
      fetch(`/api/satellites/tle?group=${group}`).then(r=>r.ok?r.json():null),
      fetch('/api/satellites/iss').then(r=>r.ok?r.json():null),
    ]);
    const tleData = tleRes.status==='fulfilled' ? tleRes.value : null;
    const issData = issRes.status==='fulfilled' ? issRes.value : null;
    const sats = tleData ? tleData.satellites : [];
    satGroupData = { sats, iss:issData, group };
    if(satVal) satVal.textContent=`LIVE (${sats.length}+1)`;
    const satLed=document.getElementById('led-satellites'); if(satLed) satLed.className='led live';
    if(satLoad) satLoad.className='hidden';
    return satGroupData;
  }catch(e){
    console.warn('loadSatelliteGroup error:',e);
    if(satVal) satVal.textContent='ERR';
    if(satLoad) satLoad.className='hidden';
    return null;
  }finally{
    satGroupLoading=false;
  }
}

function renderSatGroupLayer(){
  // Remove previous REST layer from layers.sats (not map directly)
  if(satGroupLayer){ layers.sats.removeLayer(satGroupLayer); satGroupLayer=null; }
  const data=satGroupData;
  if(!data||!showSats) return;

  const grp=L.layerGroup();

  // ISS — special highlight (🛸 from world-main)
  if(data.iss&&data.iss.lat!=null){
    const id='ISS (ZARYA)';
    const ex=registry[id]||{};
    const issEntry=Object.assign({},ex,{
      id,name:id,type:'SATELLITE',group:'Stations',country:'International',
      lat:+data.iss.lat,lon:+data.iss.lon,alt:408,source:data.iss.source||'Open Notify',
      last_update:new Date().toISOString(),
    });
    registry[id]=issEntry;
    const issIcon=L.divIcon({
      html:`<div style="font-size:18px;line-height:1;filter:drop-shadow(0 0 6px #facc15)" title="ISS">🛸</div>`,
      className:'',iconSize:[20,20],iconAnchor:[10,10]
    });
    const issM=L.marker([data.iss.lat,data.iss.lon],{icon:issIcon,zIndexOffset:1000});
    issM.bindPopup(buildSatPopup(issEntry));
    issM.on('click',()=>selectTarget(id));
    grp.addLayer(issM);
  }

  // All other satellites
  (data.sats||[]).forEach(s=>{
    if(s.lat==null||s.lon==null) return;
    const satId=s.name;
    const country=s.country||_satWmCountry(s.name);
    const col=_satWmColor(s.name,data.group);
    // Merge into registry so selectTarget / refreshPanel can display full orbital data
    registry[satId]=Object.assign(registry[satId]||{},{
      id:satId,name:s.name,type:'SATELLITE',
      lat:s.lat,lon:s.lon,alt:s.alt_km,alt_km:s.alt_km,
      group:data.group,source:'CelesTrak',country,
      norad:s.norad,inc:s.inc,period_min:s.period_min,
      last_update:new Date().toISOString(),
    });
    const icon=L.divIcon({
      html:`<div style="width:8px;height:8px;border-radius:50%;background:${col};box-shadow:0 0 5px ${col}88;"></div>`,
      className:'',iconSize:[8,8],iconAnchor:[4,4]
    });
    const m=L.marker([s.lat,s.lon],{icon,zIndexOffset:500});
    m.bindPopup(buildSatPopup(registry[satId]));
    m.on('click',()=>selectTarget(satId));
    grp.addLayer(m);
  });

  satGroupLayer=grp;
  // Add as child of layers.sats so showSats toggle automatically hides it
  layers.sats.addLayer(satGroupLayer);
  updateSidebar();
}

function buildSatPopup(d){
  const country=d.country||'';
  const flag=country?(FLAG_MAP[country]||'🏳')+' '+country:'';
  const col=_satWmColor(d.name,d.group||'');
  const cCountryColor=COUNTRY_COLORS[country]||'#a78bfa';
  return `<div style="font-family:'Courier New',monospace;font-size:11px;min-width:200px">
    <div style="color:${col};font-size:13px;font-weight:bold;letter-spacing:1px;margin-bottom:4px">🛰 ${d.name||'Unknown'}</div>
    ${flag?`<div style="color:${cCountryColor};font-size:10px;margin-bottom:4px">${flag}</div>`:''}
    ${d.norad?`<div><span style="color:#455a64">NORAD:</span> <b>${d.norad}</b></div>`:''}
    ${d.inc!=null?`<div><span style="color:#455a64">Inclination:</span> ${(+d.inc).toFixed(2)}°</div>`:''}
    ${(d.alt!=null||d.alt_km!=null)?`<div><span style="color:#455a64">Altitude:</span> ${Math.round(d.alt||d.alt_km)} km</div>`:''}
    ${d.period_min!=null?`<div><span style="color:#455a64">Period:</span> ${(+d.period_min).toFixed(1)} min</div>`:''}
    <div><span style="color:#455a64">Pos:</span> ${(+d.lat).toFixed(3)}°, ${(+d.lon).toFixed(3)}°</div>
    <div style="color:#2a3f50;font-size:9px;margin-top:4px">Source: CelesTrak · SGP4 propagated</div>
  </div>`;
}

async function setSatGroup(group, btn){
  currentSatGroup=group;
  // Update button styles
  document.querySelectorAll('[id^="sg-"]').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  // Ensure SAT layer is visible
  if(!showSats){
    showSats=true; layers.sats.addTo(map);
    const b=document.getElementById('btn-sats'); if(b) b.classList.add('on');
  }
  const data=await loadSatelliteGroup(group);
  if(data) renderSatGroupLayer();
}

async function loadAllShips(){
  try{
    const r=await fetch('/api/ships');
    if(!r.ok) return;
    const data=await r.json();
    (data.ships||[]).forEach(d=>{
      if(d.lat==null||d.lon==null) return;
      const id=d.id||d.mmsi; if(!id) return;
      registry[id]=d;
      pendingUpdates.set(id,d);
    });
    scheduleBatch();
    console.log('loadAllShips: loaded',data.count,'ships');
  }catch(ex){ console.warn('loadAllShips failed:',ex); }
}

function toggleLayer(what,btn){
  if(what==='ships'){
    showShips=!showShips;
    showShips?layers.ships.addTo(map):map.removeLayer(layers.ships);
    if(showShips) loadAllShips();
  }else if(what==='sats'){
    showSats=!showSats;
    showSats?layers.sats.addTo(map):map.removeLayer(layers.sats);
    if(showSats&&Object.keys(satrecMap).length) setTimeout(propagateAll,100);
    // Show/hide world-main satellite group selector
    const sgSec=document.getElementById('sat-grp-sec');
    if(sgSec) sgSec.style.display=showSats?'':'none';
    if(showSats){
      // Load group data if not yet loaded; satGroupLayer lives inside layers.sats
      if(satGroupData) renderSatGroupLayer();
      else loadSatelliteGroup(currentSatGroup).then(d=>{ if(d) renderSatGroupLayer(); });
    }
    // No explicit hide needed: map.removeLayer(layers.sats) hides satGroupLayer too
  }else if(what==='paths'){
    showPaths=!showPaths;
    showPaths?layers.paths.addTo(map):map.removeLayer(layers.paths);
  }else if(what==='labels'){
    showLabels=!showLabels;
    showLabels?layers.labels.addTo(map):map.removeLayer(layers.labels);
    Object.keys(registry).forEach(id=>{ if(registry[id]) pendingUpdates.set(id,registry[id]); });
    scheduleBatch();
  }else if(what==='orbits'){
    showOrbits=!showOrbits;
    if(showOrbits){
      layers.orbits.addTo(map);
      Object.keys(satrecMap).forEach(n=>drawOrbit(n,satrecMap[n],n===selectedId));
    }else{
      Object.keys(orbitLines).forEach(k=>{ orbitLines[k].forEach(l=>layers.orbits.removeLayer(l)); delete orbitLines[k]; });
      map.removeLayer(layers.orbits);
    }
  }else if(what==='country'){
    showCountry=!showCountry;
    Object.keys(registry).forEach(id=>{ if(registry[id]) pendingUpdates.set(id,registry[id]); });
    scheduleBatch();
  }
  if(btn) btn.classList.toggle('on');
}

function setFilter(f,btn){
  activeFilter=f;
  document.querySelectorAll('.f-btn').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  Object.entries(registry).forEach(([id,d])=>{
    if(!d||d.lat==null) return;
    const isSat=d.type==='SATELLITE', layer=isSat?layers.sats:layers.ships;
    const vis=shouldShow(d);
    if(markers[id]){
      if(vis&&!layer.hasLayer(markers[id]))  layer.addLayer(markers[id]);
      if(!vis&&layer.hasLayer(markers[id]))  layer.removeLayer(markers[id]);
    }
  });
  updateSidebar();
}

function searchTargets(q){ listSearch=q; updateSidebar(); }
function filterList(q){ listSearch=q; updateSidebar(); }

function focusRegion(val){
  if(!val||!REGIONS[val]) return;
  const r=REGIONS[val]; map.flyTo(r.center,r.zoom,{duration:1.5});
}

let sidebarTimer=null;
function updateSidebar(){ clearTimeout(sidebarTimer); sidebarTimer=setTimeout(_doSidebar,200); }
function _doSidebar(){
  const el=document.getElementById('vessel-list'); if(!el) return;
  const q=(listSearch||'').toLowerCase();
  const items=Object.values(registry)
    .filter(d=>d&&d.lat!=null&&shouldShow(d))
    .filter(d=>!q||(d.name||'').toLowerCase().includes(q)||String(d.mmsi||d.id||'').toLowerCase().includes(q))
    .sort((a,b)=>(b.last_update||'')>(a.last_update||'')?1:-1)
    .slice(0,200);
  // Use DocumentFragment for smooth DOM update
  const frag=document.createDocumentFragment();
  items.forEach(d=>{
    const id=d.id||d.mmsi, col=typeColor(d.type);
    const flag=(d.country&&showCountry)?countryFlag(d.country)+' ':'';
    const div=document.createElement('div');
    div.className='vi'+(id===selectedId?' sel':'');
    div.dataset.id=id;
    div.onclick=()=>selectTarget(id);
    div.innerHTML=`<div class="vi-nm" style="color:${col}">${flag}${(d.name||id).toString().slice(0,22)}</div>`+
      `<div class="vi-mt">${d.type||'?'} &middot; ${d.source||'\u2014'}${d.country?' &middot; '+d.country:''}</div>`;
    frag.appendChild(div);
  });
  el.innerHTML='';
  el.appendChild(frag);
}

function updateSources(status){
  const keys=['aisstream','barentswatch','aishub','shipxplorer','shipinfo','satellites'];
  let live=0;
  for(const k of keys){
    const v=status[k]||'IDLE';
    const el=document.getElementById('val-'+k);
    const led=document.getElementById('led-'+k);
    if(el) el.textContent=v;
    if(led){
      const isLive=v.startsWith('LIVE');
      const isErr=v.includes('ERROR')||v.includes('HTTP 4')||v.includes('HTTP 5')||v.includes('CDN FAILED');
      const isConn=v.includes('CONNECTING')||v.includes('RECONNECTING')||v.includes('FETCHING')||v.includes('LOADING');
      const isNeutral=v.includes('UNAVAILABLE')||v.includes('IDLE')||v.includes('DNS')||v.includes('NO DATA')||v.includes('SVR-DNS');
      led.className='led'+(isLive?' live':isErr?' err':isConn?' conn':isNeutral?' neutral':'');
      if(isLive) live++;
    }
  }
  const s=document.getElementById('tv-srcs'); if(s) s.textContent=live+'/6';
}

function updateTelemetry(){
  const ships=Object.values(registry).filter(d=>d&&d.type!=='SATELLITE').length;
  const sats=Object.values(registry).filter(d=>d&&d.type==='SATELLITE').length;
  const tvs=document.getElementById('tv-ships');  if(tvs)  tvs.textContent=ships;
  const tvt=document.getElementById('tv-sats');   if(tvt)  tvt.textContent=sats;
  const tgt=document.getElementById('tgt-num');   if(tgt)  tgt.textContent=ships+sats;
  const tvr=document.getElementById('tv-rate');   if(tvr)  tvr.textContent=msgRate;
}

setInterval(()=>{
  const n=new Date();
  const h=String(n.getUTCHours()).padStart(2,'0');
  const m=String(n.getUTCMinutes()).padStart(2,'0');
  const s=String(n.getUTCSeconds()).padStart(2,'0');
  const el=document.getElementById('clock'); if(el) el.textContent=`${h}:${m}:${s} UTC`;
  msgRate=msgCount; msgCount=0;
},1000);

map.on('move',()=>{
  const c=map.getCenter();
  const ce=document.getElementById('tv-center'); if(ce) ce.textContent=`${c.lat.toFixed(1)}° ${c.lng.toFixed(1)}°`;
  const ze=document.getElementById('tv-zoom');   if(ze) ze.textContent=map.getZoom();
});

updateTelemetry();

window.toggleLayer=toggleLayer; window.setFilter=setFilter;
window.focusRegion=focusRegion; window.searchTargets=searchTargets;
window.filterList=filterList;   window.selectTarget=selectTarget;
window.closePanel=closePanel;   window.toggleTrack=toggleTrack;
window.setSatGroup=setSatGroup;
