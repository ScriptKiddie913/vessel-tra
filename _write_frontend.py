"""Write the new expanded frontend HTML."""
import os

HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>SAT-INTEL | Satellite Intelligence Platform</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet"/>
<style>
:root{--cyan:#00e5ff;--green:#00ff88;--red:#ff3d3d;--amber:#ffab00;--purple:#b388ff;--bg:#060a14;--panel:#0a0e1a;--border:rgba(255,255,255,.06)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;background:var(--bg);color:#e0e0e0;font-family:'JetBrains Mono',monospace}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:4px}
.app{display:flex;height:100vh;width:100vw;overflow:hidden}
.sidebar{width:340px;height:100%;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow:hidden;z-index:1001}
.main{flex:1;position:relative;overflow:hidden}
.sidebar-header{padding:14px 16px;border-bottom:1px solid var(--border)}
.sidebar-header h1{font-size:14px;font-weight:700;letter-spacing:.2em;color:#fff;display:flex;align-items:center;gap:8px}
.sidebar-header h1::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
.sidebar-header p{font-size:10px;color:#555;margin-top:4px}
.sidebar-header .src-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.sidebar-header .src-tag{font-size:8px;padding:2px 6px;border-radius:3px;background:rgba(0,229,255,.08);color:var(--cyan);border:1px solid rgba(0,229,255,.15)}
.sidebar-header .src-tag.live{background:rgba(0,255,136,.08);color:var(--green);border-color:rgba(0,255,136,.15)}
.sidebar-header .src-tag.warn{background:rgba(255,61,61,.08);color:var(--red);border-color:rgba(255,61,61,.15)}
.cat-tabs{display:flex;flex-wrap:wrap;gap:3px;padding:10px;border-bottom:1px solid var(--border);max-height:90px;overflow-y:auto}
.cat-btn{padding:3px 7px;border-radius:3px;font-size:9px;font-family:inherit;letter-spacing:.06em;background:transparent;color:#555;border:1px solid transparent;cursor:pointer;transition:.2s}
.cat-btn.active{background:rgba(0,229,255,.12);color:var(--cyan);border-color:rgba(0,229,255,.3)}
.cat-btn:hover{color:#999}
.country-bar{display:flex;flex-wrap:wrap;gap:3px;padding:10px;border-bottom:1px solid var(--border)}
.country-btn{padding:3px 7px;border-radius:3px;font-size:9px;font-family:inherit;background:transparent;color:#555;border:1px solid transparent;cursor:pointer;transition:.2s}
.country-btn.active{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)}
.search-box{padding:10px;border-bottom:1px solid var(--border)}
.search-box input{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:7px 12px;font-size:11px;font-family:inherit;color:#fff;outline:none;transition:.2s}
.search-box input:focus{border-color:rgba(0,229,255,.5)}
.search-box input::placeholder{color:#444}
.search-count{font-size:10px;color:#555;margin-top:5px}
.sat-list{flex:1;overflow-y:auto}
.sat-item{width:100%;padding:8px 14px;text-align:left;border:none;background:transparent;border-bottom:1px solid rgba(255,255,255,.02);cursor:pointer;font-family:inherit;transition:.15s;display:block}
.sat-item:hover{background:rgba(255,255,255,.03)}
.sat-item.locked{background:rgba(0,229,255,.08);border-left:2px solid var(--cyan)}
.sat-item .name{color:#fff;font-size:11px;display:flex;align-items:center;gap:6px}
.sat-item .name::before{content:'';width:5px;height:5px;border-radius:50%;background:rgba(0,255,136,.4);flex-shrink:0}
.sat-item.locked .name::before{background:var(--cyan);animation:pulse 1.5s infinite}
.sat-item .meta{color:#555;font-size:9px;margin-top:2px;padding-left:11px}
.leaflet-container{background:var(--bg)!important;font-family:'JetBrains Mono',monospace!important}
.leaflet-control-attribution{background:rgba(0,0,0,.6)!important;color:#555!important;font-size:9px!important;font-family:inherit!important}
.leaflet-control-zoom a{background:rgba(10,14,26,.9)!important;color:var(--cyan)!important;border:1px solid rgba(0,229,255,.2)!important;font-family:inherit!important}
.leaflet-control-zoom a:hover{background:rgba(0,229,255,.15)!important}
.leaflet-popup-content-wrapper{background:transparent!important;border-radius:0!important;box-shadow:none!important;padding:0!important}
.leaflet-popup-content{margin:0!important}
.leaflet-popup-tip{background:rgba(10,14,26,.95)!important}
.leaflet-popup-close-button{color:#666!important;font-size:16px!important}
.leaflet-popup-close-button:hover{color:var(--red)!important}
.sat-icon,.vessel-icon,.flight-icon,.event-icon{background:none!important;border:none!important}
.hud{position:absolute;top:16px;right:16px;width:290px;background:rgba(0,0,0,.88);backdrop-filter:blur(12px);border:1px solid rgba(0,229,255,.2);border-radius:8px;font-size:11px;z-index:1000;display:none;overflow:hidden}
.hud.open{display:block}
.hud-header{display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(0,229,255,.08);border-bottom:1px solid rgba(0,229,255,.15)}
.hud-header span{color:var(--cyan);font-size:10px;font-weight:700;letter-spacing:.2em}
.hud-close{margin-left:auto;background:none;border:none;color:#555;cursor:pointer;font-size:16px;font-family:inherit}
.hud-close:hover{color:var(--red)}
.hud-name{padding:12px 16px 8px;border-bottom:1px solid rgba(255,255,255,.04)}
.hud-name .sat-n{font-size:13px;font-weight:700;color:#fff}
.hud-name .sat-o{font-size:10px;color:#555;margin-top:2px}
.hud-grid{padding:12px 16px;display:flex;flex-direction:column;gap:6px}
.hud-row{display:flex;justify-content:space-between;align-items:center}
.hud-row .lbl{color:#555;font-size:10px}
.hud-row .val{color:#bbb;font-size:11px;font-variant-numeric:tabular-nums}
.hud-row .val.hl{color:var(--cyan)}
.hud-progress{padding:0 16px 12px}
.hud-progress .bar-label{display:flex;justify-content:space-between;font-size:9px;color:#555;margin-bottom:4px}
.hud-progress .bar{height:3px;background:#1a1a2e;border-radius:4px;overflow:hidden}
.hud-progress .bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--cyan),var(--green));transition:width 1s}
.country-dash{position:absolute;top:16px;left:16px;width:250px;background:rgba(0,0,0,.88);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:8px;z-index:1000;font-size:10px;overflow:hidden}
.country-dash-header{padding:10px 16px;border-bottom:1px solid var(--border);color:var(--cyan);font-weight:700;letter-spacing:.15em;font-size:10px}
.country-dash-body{padding:10px 12px;max-height:320px;overflow-y:auto}
.cd-row{margin-bottom:5px}
.cd-row .cd-label{display:flex;justify-content:space-between;color:#888;margin-bottom:2px}
.cd-row .cd-label .cd-cnt{color:#bbb;font-variant-numeric:tabular-nums}
.cd-row .cd-bar{height:3px;background:rgba(255,255,255,.04);border-radius:2px;overflow:hidden}
.cd-row .cd-bar-fill{height:100%;border-radius:2px;opacity:.7;transition:width .5s}
.country-dash-footer{padding:8px 16px;border-top:1px solid var(--border);color:#444;font-size:9px}
.imagery-toggle{position:absolute;top:16px;right:320px;z-index:1000}
.imagery-btn{padding:8px 12px;border-radius:8px;font-size:10px;font-family:inherit;background:rgba(0,0,0,.7);color:#888;border:1px solid var(--border);cursor:pointer;letter-spacing:.08em;transition:.2s}
.imagery-btn.active{background:rgba(179,136,255,.15);color:var(--purple);border-color:rgba(179,136,255,.3)}
.imagery-dropdown{margin-top:8px;width:260px;background:rgba(0,0,0,.92);backdrop-filter:blur(12px);border:1px solid var(--border);border-radius:8px;overflow:hidden;display:none;max-height:420px;overflow-y:auto}
.imagery-dropdown.open{display:block}
.imagery-dropdown-header{padding:10px 16px;border-bottom:1px solid var(--border);color:var(--purple);font-size:10px;font-weight:700;letter-spacing:.15em}
.imagery-option{display:block;width:100%;padding:7px 12px;background:transparent;border:none;text-align:left;cursor:pointer;font-family:inherit;transition:.15s}
.imagery-option:hover{background:rgba(255,255,255,.04)}
.imagery-option.active{background:rgba(179,136,255,.12);color:var(--purple)}
.imagery-option .io-name{font-size:10px;font-weight:700;color:inherit}
.imagery-option .io-meta{font-size:9px;color:#555;margin-top:2px}
.layer-toggles{position:absolute;bottom:70px;right:16px;z-index:1000;display:flex;flex-direction:column;gap:3px}
.layer-toggle{padding:5px 10px;border-radius:4px;font-size:9px;font-family:inherit;letter-spacing:.08em;background:rgba(0,0,0,.5);color:#555;border:1px solid transparent;cursor:pointer;display:flex;align-items:center;gap:6px;transition:.2s}
.layer-toggle.on{border-color:rgba(0,229,255,.25)}
.timeline{position:absolute;bottom:0;left:340px;right:0;background:rgba(0,0,0,.92);backdrop-filter:blur(12px);border-top:1px solid var(--border);z-index:1000;display:flex;align-items:center;gap:12px;padding:8px 16px}
.tl-controls{display:flex;align-items:center;gap:6px}
.tl-btn{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,229,255,.25);background:rgba(0,229,255,.08);color:var(--cyan);cursor:pointer;font-size:12px;font-family:inherit;transition:.2s}
.tl-btn:hover{background:rgba(0,229,255,.2)}
.tl-btn.playing{background:rgba(255,61,61,.12);border-color:rgba(255,61,61,.3);color:var(--red)}
.tl-skip{background:none;border:none;color:#555;cursor:pointer;font-size:14px;font-family:inherit}
.tl-skip:hover{color:#fff}
.tl-label{min-width:80px;font-size:11px;font-weight:700;letter-spacing:.1em}
.tl-label.live{color:var(--green)}.tl-label.past{color:var(--amber)}.tl-label.future{color:var(--cyan)}
.tl-slider{flex:1;display:flex;align-items:center;gap:6px}
.tl-slider span{font-size:9px;color:#555}
.tl-slider input[type=range]{flex:1;-webkit-appearance:none;appearance:none;height:4px;background:#1a1a2e;border-radius:4px;outline:none;cursor:pointer}
.tl-slider input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:var(--cyan);cursor:pointer;box-shadow:0 0 8px rgba(0,229,255,.4)}
.tl-quick{display:flex;gap:4px}
.tl-qbtn{padding:3px 7px;border-radius:4px;font-size:9px;font-family:inherit;background:transparent;color:#555;border:none;cursor:pointer;transition:.2s}
.tl-qbtn.active{background:rgba(0,229,255,.15);color:var(--cyan)}.tl-qbtn:hover{color:#999}
.status-bar{position:absolute;bottom:52px;left:360px;font-size:10px;color:#444;z-index:1000;display:flex;align-items:center;gap:8px}
.status-dot{width:5px;height:5px;border-radius:50%;background:var(--green)}
.status-dot.loading{background:var(--amber);animation:pulse 1s infinite}
.status-dot.error{background:var(--red)}
.stats-panel{position:absolute;bottom:52px;right:16px;z-index:1000;display:flex;gap:12px;font-size:9px;color:#555}
.stat-item{display:flex;align-items:center;gap:4px}
.stat-item .stat-val{color:var(--cyan);font-weight:600;font-variant-numeric:tabular-nums}
.scan-line{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(0,229,255,.15),transparent);animation:scanmove 4s linear infinite;pointer-events:none;z-index:9999}
@keyframes scanmove{0%{top:0}100%{top:100%}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-header">
      <h1>SAT-INTEL</h1>
      <p id="objCount">Loading...</p>
      <div class="src-tags">
        <span class="src-tag live">CelesTrak TLE</span>
        <span class="src-tag live">USGS Quakes</span>
        <span class="src-tag live">NASA EONET</span>
        <span class="src-tag">NASA GIBS</span>
        <span class="src-tag">ESRI Imagery</span>
        <span class="src-tag warn">GPS Jamming</span>
        <span class="src-tag">ADS-B</span>
        <span class="src-tag">AIS Marine</span>
      </div>
    </div>
    <div class="cat-tabs" id="catTabs"></div>
    <div class="country-bar" id="countryBar"></div>
    <div class="search-box">
      <input id="searchInput" placeholder="Search name, NORAD ID, or country..."/>
      <div class="search-count" id="searchCount"></div>
    </div>
    <div class="sat-list" id="satList"></div>
  </div>
  <div class="main">
    <div id="map" style="width:100%;height:100%"></div>
    <div class="country-dash" id="countryDash">
      <div class="country-dash-header">&#x1F4CA; NATION INTELLIGENCE</div>
      <div class="country-dash-body" id="countryDashBody"></div>
      <div class="country-dash-footer" id="countryDashFooter"></div>
    </div>
    <div class="hud" id="hud">
      <div class="hud-header"><span>&#x1F3AF; TRACKING LOCKED</span><button class="hud-close" id="hudClose">&times;</button></div>
      <div class="hud-name"><div class="sat-n" id="hudName"></div><div class="sat-o" id="hudOwner"></div></div>
      <div class="hud-grid" id="hudGrid"></div>
      <div class="hud-progress"><div class="bar-label"><span>ORBIT PROGRESS</span><span id="hudPct"></span></div><div class="bar"><div class="bar-fill" id="hudBar"></div></div></div>
    </div>
    <div class="imagery-toggle" id="imageryToggle">
      <button class="imagery-btn" id="imageryBtn">&#x1F6F0; NASA GIBS</button>
      <div class="imagery-dropdown" id="imageryDropdown"></div>
    </div>
    <div class="layer-toggles" id="layerToggles"></div>
    <div class="status-bar" id="statusBar"><div class="status-dot loading" id="statusDot"></div><span id="statusText">INITIALIZING...</span></div>
    <div class="stats-panel" id="statsPanel"></div>
    <div class="timeline">
      <div class="tl-controls">
        <button class="tl-skip" id="tlBack" title="T-60">&#x23EE;</button>
        <button class="tl-btn" id="tlPlay">&#x25B6;</button>
        <button class="tl-skip" id="tlFwd" title="T+60">&#x23ED;</button>
      </div>
      <div class="tl-label live" id="tlLabel">LIVE</div>
      <div class="tl-slider"><span>T-60</span><input type="range" id="tlSlider" min="-60" max="60" value="0"/><span>T+60</span></div>
      <div class="tl-quick" id="tlQuick"></div>
    </div>
    <div class="scan-line"></div>
  </div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/satellite.js@5.0.0/dist/satellite.min.js"></script>
<script>
(function(){
"use strict";
"""

# Write in parts to avoid issues
target = r"c:\Users\KIIT\Downloads\sat-track-main\sat-track-main\static\index.html"
f = open(target, "w", encoding="utf-8")
f.write(HTML)
f.close()
print("Part 1 written OK:", os.path.getsize(target), "bytes")
