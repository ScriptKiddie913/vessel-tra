import pathlib

html = """\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Global Ship Tracker | Palantir AI Style</title>
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
        body,html{margin:0;padding:0;height:100%;font-family:'Inter',-apple-system,sans-serif;background:#0d0e12;color:#e0e0e0;overflow:hidden}
        #map{height:100%;width:100%;background:#0b0c10}
        .hud{position:absolute;top:20px;left:50%;transform:translateX(-50%);padding:10px 25px;background:rgba(18,20,26,0.7);backdrop-filter:blur(20px);border:1px solid rgba(77,170,252,0.4);border-radius:50px;z-index:1000;display:flex;align-items:center;gap:25px;box-shadow:0 10px 40px rgba(0,0,0,0.6)}
        .hud-item{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:#4daafc;text-transform:uppercase;letter-spacing:1.5px}
        .filters{position:absolute;bottom:30px;left:30px;display:flex;flex-direction:column;gap:10px;z-index:1000}
        .filter-btn{background:rgba(18,20,26,0.8);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,0.1);color:#888;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;transition:all 0.3s;display:flex;align-items:center;gap:8px}
        .filter-btn:hover{background:rgba(77,170,252,0.1);border-color:rgba(77,170,252,0.4);color:#fff}
        .filter-btn.active{background:rgba(77,170,252,0.2);border-color:#4daafc;color:#fff;box-shadow:0 0 15px rgba(77,170,252,0.3)}
        .filter-dot{width:8px;height:8px;border-radius:50%}
        .ship-details{position:absolute;bottom:30px;right:30px;width:320px;background:rgba(18,20,26,0.9);backdrop-filter:blur(25px);border:1px solid rgba(77,170,252,0.5);border-radius:12px;z-index:1000;padding:24px;display:none;box-shadow:0 0 50px rgba(0,0,0,0.9);animation:slideUp 0.4s cubic-bezier(0.16,1,0.3,1)}
        @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        .detail-row{display:flex;justify-content:space-between;margin-bottom:14px;font-size:12px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:10px}
        .detail-label{color:#888;text-transform:uppercase;font-size:9px;letter-spacing:1px}
        .detail-value{color:#fff;font-weight:700;font-family:'Courier New',monospace}
        .status-dot{width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;box-shadow:0 0 12px #4caf50}
        .pulse{animation:pulse-animation 2s infinite}
        @keyframes pulse-animation{0%{transform:scale(0.9);box-shadow:0 0 0 0 rgba(76,175,80,0.7)}70%{transform:scale(1);box-shadow:0 0 0 12px rgba(76,175,80,0)}100%{transform:scale(0.9);box-shadow:0 0 0 0 rgba(76,175,80,0)}}
        .leaflet-marker-icon{transition:transform 1.2s linear,opacity 0.5s ease;will-change:transform}
        .map-overlay{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:500;background-image:linear-gradient(rgba(77,170,252,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(77,170,252,0.05) 1px,transparent 1px);background-size:100px 100px}
        .scanning-line{position:absolute;top:0;left:0;width:100%;height:3px;background:linear-gradient(90deg,transparent,rgba(77,170,252,0.4),transparent);z-index:501;animation:scan 15s linear infinite;pointer-events:none;opacity:0.5}
        @keyframes scan{0%{top:-5%}100%{top:105%}}
        #sat-toast{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(18,20,26,0.9);border:1px solid rgba(77,170,252,0.4);border-radius:8px;padding:10px 20px;font-size:11px;color:#4daafc;letter-spacing:1px;z-index:2000;display:none;font-weight:700}
        .source-panel{position:absolute;top:80px;right:20px;z-index:1000;background:rgba(18,20,26,0.85);backdrop-filter:blur(16px);border:1px solid rgba(77,170,252,0.3);border-radius:10px;padding:14px 18px;min-width:220px;box-shadow:0 8px 32px rgba(0,0,0,0.6)}
        .source-panel h4{margin:0 0 10px 0;font-size:9px;letter-spacing:2px;color:#4daafc;text-transform:uppercase;font-weight:800}
        .src-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:7px;font-size:10px}
        .src-name{color:#aaa;text-transform:uppercase;letter-spacing:1px;font-weight:600}
        .src-badge{font-family:'Courier New',monospace;font-size:9px;padding:2px 7px;border-radius:4px;font-weight:700}
        .src-badge.live        {background:rgba(76,175,80,0.2);  color:#4caf50;border:1px solid #4caf50}
        .src-badge.idle        {background:rgba(150,150,150,0.1);color:#666;   border:1px solid #444}
        .src-badge.error       {background:rgba(255,75,43,0.15); color:#ff4b2b;border:1px solid #ff4b2b}
        .src-badge.nodata      {background:rgba(255,200,0,0.1);  color:#ffc837;border:1px solid #ffc837}
        .src-badge.reconnecting{background:rgba(255,200,0,0.1);  color:#ffc837;border:1px solid #ffc837}
    </style>
</head>
<body>
    <div class="map-overlay"></div>
    <div class="scanning-line"></div>
    <div id="map"></div>
    <div id="sat-toast">&#x2B23; LOADING SATELLITE CATALOG...</div>

    <div class="hud">
        <div class="hud-item">
            <span class="status-dot pulse"></span>
            SAT_INTEL: ACTIVE
        </div>
        <div class="hud-item" style="border-left:1px solid rgba(255,255,255,0.1);padding-left:25px">
            TARGETS: <span id="target-count" style="font-family:monospace;font-size:16px">0</span>
        </div>
        <div class="hud-item" style="border-left:1px solid rgba(255,255,255,0.1);padding-left:25px;color:#888;font-size:11px">
            SATS: <span id="sat-count" style="font-family:monospace">0</span>
            &nbsp;|&nbsp;
            LAT: <span id="mouse-lat">0.0000</span>
            LON: <span id="mouse-lon">0.0000</span>
        </div>
    </div>

    <div class="source-panel">
        <h4>&#x25CF; Data Sources</h4>
        <div class="src-row"><span class="src-name">AISStream</span>     <span class="src-badge idle" id="src-aisstream">CONNECTING</span></div>
        <div class="src-row"><span class="src-name">Digitraffic/FI</span><span class="src-badge idle" id="src-digitraffic">IDLE</span></div>
        <div class="src-row"><span class="src-name">BarentsWatch/NO</span><span class="src-badge idle" id="src-barentswatch">IDLE</span></div>
        <div class="src-row"><span class="src-name">ShipXplorer</span>   <span class="src-badge idle" id="src-shipxplorer">IDLE</span></div>
        <div class="src-row"><span class="src-name">ShipInfo.net</span>  <span class="src-badge idle" id="src-shipinfo">IDLE</span></div>
        <div class="src-row"><span class="src-name">AISHub</span>        <span class="src-badge idle" id="src-aishub">IDLE</span></div>
        <div class="src-row"><span class="src-name">Satellites</span>    <span class="src-badge idle" id="src-satellites">IDLE</span></div>
    </div>

    <div class="filters">
        <button class="filter-btn active" onclick="toggleFilter('all')">
            <span class="filter-dot" style="background:#fff"></span> ALL UNITS
        </button>
        <button class="filter-btn" onclick="toggleFilter('Military')">
            <span class="filter-dot" style="background:#ff4b2b"></span> MILITARY
        </button>
        <button class="filter-btn" onclick="toggleFilter('Cargo')">
            <span class="filter-dot" style="background:#00f2fe"></span> CARGO
        </button>
        <button class="filter-btn" onclick="toggleFilter('Tanker')">
            <span class="filter-dot" style="background:#a8ff78"></span> TANKER
        </button>
        <button class="filter-btn" onclick="toggleFilter('Passenger')">
            <span class="filter-dot" style="background:#ffc837"></span> PASSENGER
        </button>
        <button class="filter-btn" onclick="toggleFilter('Fishing')">
            <span class="filter-dot" style="background:#bf5af2"></span> FISHING
        </button>
        <button class="filter-btn" onclick="toggleFilter('SATELLITE')">
            <span class="filter-dot" style="background:#fff;box-shadow:0 0 10px #fff"></span> SATELLITES
        </button>
    </div>

    <div class="ship-details" id="ship-details">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
            <div>
                <div style="font-size:10px;color:#4daafc;letter-spacing:3px;margin-bottom:6px;font-weight:800">TARGET IDENTIFIED</div>
                <h2 id="detail-name" style="margin:0;font-size:22px;color:#fff;letter-spacing:1.5px;text-transform:uppercase">VESSEL NAME</h2>
            </div>
            <button onclick="closeDetails()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#888;cursor:pointer;font-size:20px;border-radius:6px;width:32px;height:32px;display:flex;align-items:center;justify-content:center">&times;</button>
        </div>
        <div class="detail-row"><span class="detail-label">MMSI / ID</span>      <span class="detail-value" id="detail-mmsi">-</span></div>
        <div class="detail-row"><span class="detail-label">Vessel Class</span>   <span class="detail-value" id="detail-type">-</span></div>
        <div class="detail-row"><span class="detail-label">Velocity</span>       <span class="detail-value" id="detail-speed">-</span></div>
        <div class="detail-row"><span class="detail-label">Bearing / Group</span><span class="detail-value" id="detail-course">-</span></div>
        <div class="detail-row"><span class="detail-label">Altitude</span>       <span class="detail-value" id="detail-alt">-</span></div>
        <div class="detail-row"><span class="detail-label">Geospatial</span>     <span class="detail-value" id="detail-pos">-</span></div>
        <div class="detail-row"><span class="detail-label">Source</span>         <span class="detail-value" id="detail-source" style="color:#4daafc">-</span></div>
        <div style="margin-top:20px;font-size:10px;color:#4daafc;font-weight:700;border:1px solid rgba(77,170,252,0.4);padding:12px;border-radius:8px;background:rgba(77,170,252,0.08);text-align:center;letter-spacing:1px">
            [ PREDICTIVE_VECTOR_ACTIVE ]
        </div>
    </div>

    <!-- satellite.js MUST load before app.js — without this all TLE math crashes silently -->
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/satellite.js/4.1.3/satellite.min.js"></script>
    <script src="app.js"></script>
</body>
</html>
"""

pathlib.Path(r"c:\Users\KIIT\Downloads\ship\ui3\index.html").write_text(html, encoding="utf-8")
print("index.html written:", len(html), "chars")
