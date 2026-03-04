"""Global Ship & Satellite Tracker v3 - Multi-Source Edition
Fixes applied vs original:
  1. GMST calculation corrected (was using satrec.gsto = epoch-only GMST → wrong positions)
  2. Server-side propagation now covers ALL loaded TLEs (was capped at [:600])
  3. Satellite updates batched efficiently (one broadcast per tick vs one-per-sat)
  4. All TLE source groups active (10 catalogs → deduped)
  5. ISS live-position worker (wheretheiss.at + open-notify fallback)
  6. All ship sources active: AISStream, Barentswatch, AISHub, ShipXplorer, ShipInfo
"""
import json, asyncio, math, logging, requests
from datetime import datetime
from typing import Dict, List, Any
from urllib.parse import quote as url_quote

import httpx, websockets
from sgp4.api import Satrec, jday
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("uvicorn.error")
app = FastAPI(title="Ship & Satellite Tracker v3")

# ─── MID → Country lookup (MMSI first-3-digits) ──────────────────────────────
MID: Dict[str, str] = {
    "201":"Albania","202":"Andorra","203":"Austria","204":"Azores (PT)",
    "205":"Belgium","206":"Belarus","207":"Bulgaria","208":"Vatican",
    "209":"Cyprus","210":"Cyprus","211":"Germany","212":"Cyprus",
    "213":"Georgia","214":"Moldova","215":"Malta","216":"Armenia",
    "218":"Germany","219":"Denmark","220":"Denmark","224":"Spain",
    "225":"Spain","226":"France","227":"France","228":"France",
    "229":"Malta","230":"Finland","231":"Faroe Is.","232":"UK",
    "233":"UK","234":"UK","235":"UK","236":"Gibraltar",
    "237":"Greece","238":"Croatia","239":"Greece","240":"Greece",
    "241":"Greece","242":"Morocco","243":"Hungary","244":"Netherlands",
    "245":"Netherlands","246":"Netherlands","247":"Italy","248":"Malta",
    "249":"Malta","250":"Ireland","251":"Iceland","252":"Liechtenstein",
    "253":"Luxembourg","254":"Monaco","255":"Madeira (PT)","256":"Malta",
    "257":"Norway","258":"Norway","259":"Norway","261":"Poland",
    "262":"Montenegro","263":"Portugal","264":"Romania","265":"Sweden",
    "266":"Sweden","267":"Slovakia","268":"San Marino","269":"Switzerland",
    "270":"Czech Rep.","271":"Turkey","272":"Ukraine","273":"Russia",
    "274":"Macedonia","275":"Latvia","276":"Estonia","277":"Lithuania",
    "278":"Slovenia","279":"Serbia","301":"Anguilla","303":"Alaska (US)",
    "304":"Antigua","305":"Antigua","306":"Netherlands Ant.","307":"Aruba",
    "308":"Bahamas","309":"Bahamas","310":"Bermuda","311":"Bahamas",
    "312":"Belize","314":"Barbados","316":"Canada","319":"Cayman Is.",
    "321":"Costa Rica","323":"Cuba","325":"Dominica","327":"Dominican Rep.",
    "329":"Guadeloupe","330":"Grenada","331":"Greenland","332":"Guatemala",
    "334":"Honduras","336":"Haiti","338":"USA","339":"Jamaica",
    "341":"St Kitts","343":"St Lucia","345":"Mexico","347":"Martinique",
    "348":"Montserrat","350":"Nicaragua","351":"Panama","352":"Panama",
    "353":"Panama","354":"Panama","355":"Panama","356":"Panama",
    "357":"Panama","358":"Puerto Rico","359":"El Salvador","361":"St Pierre",
    "362":"Trinidad","364":"Turks & Caicos","366":"USA","367":"USA",
    "368":"USA","369":"USA","370":"Panama","371":"Panama",
    "372":"Panama","373":"Panama","374":"Panama","375":"St Vincent",
    "376":"St Vincent","377":"St Vincent","378":"BVI","379":"USVI",
    "401":"Afghanistan","403":"Saudi Arabia","405":"Bangladesh",
    "408":"Bahrain","410":"Bhutan","412":"China","413":"China",
    "414":"China","416":"Taiwan","422":"Iran","423":"Azerbaijan",
    "425":"Iraq","428":"Israel","431":"Japan","432":"Japan",
    "434":"Turkmenistan","436":"Kazakhstan","438":"Jordan","440":"South Korea",
    "441":"South Korea","443":"Palestine","445":"DPR Korea","447":"Kuwait",
    "450":"Lebanon","451":"Kyrgyzstan","453":"Macao","455":"Maldives",
    "457":"Mongolia","459":"Nepal","461":"Oman","463":"Pakistan",
    "466":"Qatar","468":"Syria","470":"UAE","471":"UAE",
    "472":"Tajikistan","473":"Yemen","477":"Hong Kong","478":"Bosnia",
    "501":"Antarctica","503":"Australia","506":"Myanmar","508":"Brunei",
    "510":"Micronesia","511":"Palau","512":"New Zealand","514":"Cambodia",
    "515":"Cambodia","516":"Christmas Is.","518":"Cook Is.","520":"Fiji",
    "523":"Cocos Is.","525":"Indonesia","529":"Kiribati","531":"Laos",
    "533":"Malaysia","536":"N. Mariana Is.","538":"Marshall Is.",
    "540":"Nauru","542":"Niue","544":"Papua NG","546":"Fr. Polynesia",
    "548":"Philippines","553":"Solomon Is.","555":"American Samoa",
    "557":"Samoa","559":"Singapore","561":"Sri Lanka","563":"Singapore",
    "564":"Singapore","565":"Singapore","566":"Singapore","567":"Thailand",
    "570":"Tonga","572":"Tuvalu","574":"Vietnam","576":"Vanuatu",
    "577":"Vanuatu","578":"Wallis & Futuna","601":"South Africa",
    "603":"Angola","605":"Algeria","607":"St Paul Is.","608":"Ascension Is.",
    "609":"Burundi","610":"Benin","611":"Botswana","612":"Cent. Afr. Rep.",
    "613":"Cameroon","615":"Congo","616":"Comoros","617":"Cabo Verde",
    "618":"Antarctica","619":"Ivory Coast","621":"Djibouti","622":"Egypt",
    "624":"Ethiopia","625":"Eritrea","626":"Gabon","627":"Ghana",
    "629":"Gambia","630":"Guinea-Bissau","631":"Eq. Guinea","632":"Guinea",
    "633":"Burkina Faso","634":"Kenya","635":"Antarctica","636":"Liberia",
    "637":"Liberia","638":"South Sudan","642":"Libya","644":"Lesotho",
    "645":"Mauritius","647":"Madagascar","649":"Mali","650":"Mozambique",
    "654":"Mauritania","655":"Malawi","656":"Niger","657":"Nigeria",
    "659":"Namibia","660":"Reunion","661":"Rwanda","662":"Sudan",
    "663":"Senegal","664":"Seychelles","665":"St Helena","666":"Somalia",
    "667":"Sierra Leone","668":"Sao Tome","669":"Swaziland","670":"Chad",
    "671":"Togo","672":"Tunisia","674":"Tanzania","675":"Uganda",
    "676":"DR Congo","677":"Tanzania","678":"Zimbabwe","679":"Zambia",
    "701":"Argentina","710":"Brazil","720":"Bolivia","725":"Chile",
    "730":"Colombia","735":"Ecuador","740":"Falkland Is.","745":"Guiana (FR)",
    "750":"Guyana","755":"Paraguay","760":"Peru","765":"Suriname",
    "770":"Uruguay","775":"Venezuela",
}

def mmsi_country(mmsi: str) -> str:
    return MID.get(str(mmsi)[:3], "")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

ship_registry:      Dict[str, Dict[str, Any]] = {}
ship_paths:         Dict[str, List[Dict]]      = {}
satellite_registry: Dict[str, Dict[str, Any]] = {}
MAX_PATH = 20
API_KEY  = "8b9d8625829bd9614947be967c141babc5931e79"
WS_URL   = "wss://stream.aisstream.io/v0/stream"
clients:  Dict[WebSocket, asyncio.Queue] = {}
tle_catalog: List[Dict] = []
source_status: Dict[str, str] = {
    "aisstream": "CONNECTING", "barentswatch": "IDLE",
    "aishub": "IDLE", "shipxplorer": "IDLE",
    "shipinfo": "IDLE", "satellites": "IDLE",
}


# ─── GMST FIX: compute accurate Greenwich Mean Sidereal Time ─────────────────
# The original code used satrec.gsto which is GMST at TLE *epoch* only.
# This caused every satellite's lon to drift by hours × Earth's rotation rate.

def compute_gmst(jd: float, fr: float) -> float:
    """Accurate GMST in radians for the given Julian date + fraction.
    Uses the IAU 1982 formula (same as used inside sgp4 itself).
    """
    tut1 = (jd + fr - 2451545.0) / 36525.0
    gmst = (-6.2e-6 * tut1**3
            + 0.093104 * tut1**2
            + (876600.0 * 3600.0 + 8640184.812866) * tut1
            + 67310.54841)
    gmst_rad = math.fmod(gmst * math.pi / 43200.0, 2.0 * math.pi)
    if gmst_rad < 0:
        gmst_rad += 2.0 * math.pi
    return gmst_rad


def teme_to_geodetic(r_vec, gmst: float):
    """Convert TEME position vector (km) to (lat_deg, lon_deg, alt_km)."""
    x, y, z = r_vec
    lon_rad = math.atan2(y, x) - gmst
    # Normalise to [-π, π]
    lon_rad = (lon_rad + math.pi) % (2.0 * math.pi) - math.pi
    hyp = math.sqrt(x * x + y * y)
    lat_rad = math.atan2(z, hyp)
    alt_km  = math.sqrt(x * x + y * y + z * z) - 6371.0
    return math.degrees(lat_rad), math.degrees(lon_rad), alt_km


# ─── Broadcasting ────────────────────────────────────────────────────────────

async def broadcast(msg: str):
    dead = []
    for ws, q in list(clients.items()):
        try:
            if q.qsize() > 150:
                try: q.get_nowait()
                except: pass
            await q.put(msg)
        except: dead.append(ws)
    for ws in dead: clients.pop(ws, None)

async def bcast_status():
    await broadcast(json.dumps({"type": "source_status", **source_status}))

async def writer_task(ws: WebSocket, q: asyncio.Queue):
    try:
        while True:
            m = await q.get(); await ws.send_text(m); q.task_done()
    except: pass
    finally: clients.pop(ws, None)


# ─── Ship helpers ─────────────────────────────────────────────────────────────

def ship_type(tid) -> str:
    t = int(tid or 0)
    if t == 30: return "Fishing"
    if t in (31, 32): return "Tug"
    if t in (35, 36): return "Military"
    if 40 <= t <= 49: return "High Speed"
    if t == 52: return "Tug"
    if t == 55: return "Military"
    if 60 <= t <= 69: return "Passenger"
    if 70 <= t <= 79: return "Cargo"
    if 80 <= t <= 89: return "Tanker"
    if t == 50: return "Pilot"
    if t == 51: return "SAR"
    return "Unknown"

def upsert(mmsi, lat, lon, spd=0., crs=0., name="IDENTIFYING...", stype="Unknown", ts="", src=""):
    if not mmsi or lat is None or lon is None: return None
    try: lat, lon, spd, crs = float(lat), float(lon), float(spd), float(crs)
    except: return None
    if lat == 0 and lon == 0: return None

    country = mmsi_country(mmsi)
    if mmsi not in ship_registry:
        ship_registry[mmsi] = {
            "mmsi": mmsi, "name": name, "type": stype,
            "lat": lat, "lon": lon, "speed": spd, "course": crs,
            "last_update": ts, "path": [], "source": src, "country": country,
        }
    else:
        r = ship_registry[mmsi]
        r.update({"lat": lat, "lon": lon, "speed": spd, "course": crs,
                  "last_update": ts, "source": src, "country": country})
        if name != "IDENTIFYING...": r["name"] = name
        if stype != "Unknown":       r["type"] = stype

    if mmsi not in ship_paths: ship_paths[mmsi] = []
    pp = ship_paths[mmsi]
    if not pp or abs(pp[-1]["lat"] - lat) > 0.0001 or abs(pp[-1]["lon"] - lon) > 0.0001:
        pp.append({"lat": lat, "lon": lon})
        if len(pp) > MAX_PATH: pp.pop(0)
    ship_registry[mmsi]["path"] = pp
    return ship_registry[mmsi]


# ─── AISStream (global WebSocket with 20 bounding boxes) ─────────────────────

async def aisstream_worker():
    logger.info("AISStream worker starting")
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=30, open_timeout=60) as ws:
                await ws.send(json.dumps({
                    "APIKey": API_KEY,
                    "BoundingBoxes": [
                        # 4×4 global grid
                        [[-90, -180], [-45, -90]], [[-90, -90], [-45, 0]],
                        [[-90,    0], [-45,  90]], [[-90,  90], [-45, 180]],
                        [[-45, -180], [  0, -90]], [[-45, -90], [  0,   0]],
                        [[-45,    0], [  0,  90]], [[-45,  90], [  0, 180]],
                        [[  0, -180], [ 45, -90]], [[  0, -90], [ 45,   0]],
                        [[  0,    0], [ 45,  90]], [[  0,  90], [ 45, 180]],
                        [[ 45, -180], [ 90, -90]], [[ 45, -90], [ 90,   0]],
                        [[ 45,    0], [ 90,  90]], [[ 45,  90], [ 90, 180]],
                        # Focus: Indian Ocean / Bay of Bengal / South China Sea
                        [[  0,   60], [ 30, 100]], [[  0,  100], [ 25, 130]],
                        [[-10,   40], [ 10,  80]], [[ -5,   95], [ 20, 120]],
                    ],
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }))
                source_status["aisstream"] = "LIVE"
                await bcast_status()
                logger.info("AISStream connected")
                async for raw in ws:
                    try:
                        msg  = json.loads(raw)
                        mmsi = str(msg.get("MetaData", {}).get("MMSI", ""))
                        if not mmsi: continue
                        ts   = msg.get("MetaData", {}).get("time_utc", datetime.utcnow().isoformat())
                        mt   = msg.get("MessageType")
                        if mt == "ShipStaticData":
                            sd = msg["Message"]["ShipStaticData"]
                            if mmsi in ship_registry:
                                ship_registry[mmsi]["name"] = sd.get("Name", "").strip() or ship_registry[mmsi]["name"]
                                ship_registry[mmsi]["type"] = ship_type(sd.get("Type", 0))
                        elif mt == "PositionReport":
                            pr  = msg["Message"]["PositionReport"]
                            rec = upsert(mmsi, pr.get("Latitude"), pr.get("Longitude"),
                                         pr.get("Sog", 0), pr.get("Cog", 0), ts=ts, src="AISStream")
                            if rec: await broadcast(json.dumps(rec))
                    except Exception as e: logger.debug(f"AIS parse: {e}")
        except Exception as e:
            source_status["aisstream"] = "RECONNECTING"
            logger.warning(f"AISStream: {e}")
            await asyncio.sleep(5)


# ─── Barentswatch / Kystverket supplemental AIS ──────────────────────────────

async def barentswatch_worker():
    hdrs = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    ENDPOINTS = [
        ("https://kystdatahuset.no/ws/online/getCombinedStatsToJson/", "Kystverket"),
        ("https://ais.kystverket.no/ais.php?lat1=50&lat2=82&lon1=-5&lon2=35", "Kystverket"),
        ("http://www.openais.gr/map/ajax.php?mode=vessels", "OpenAIS"),
        ("https://api.vtexplorer.com/vessels?userkey=demo&imo=9619907&format=json", "VTExplorer"),
    ]
    async with httpx.AsyncClient(timeout=25, headers=hdrs, follow_redirects=True) as c:
        while True:
            found = False
            for url, src_name in ENDPOINTS:
                try:
                    r = await c.get(url)
                    if r.status_code not in (200, 206): continue
                    ct = r.headers.get("content-type", "")
                    if "json" not in ct and not r.text.strip().startswith(("[", "{")): continue
                    try: data = r.json()
                    except: continue
                    if isinstance(data, dict) and "data" in data: data = data["data"]
                    recs = _parse_generic_vessels(data, src_name)
                    if recs:
                        for rec in recs: await broadcast(json.dumps(rec))
                        source_status["barentswatch"] = f"LIVE ({len(recs)}) [{src_name}]"
                        await bcast_status(); found = True; break
                except Exception as e:
                    logger.debug(f"Barentswatch {src_name}: {e}")
            if not found:
                source_status["barentswatch"] = "UNAVAILABLE"
                await bcast_status()
            await asyncio.sleep(90)


# ─── AISHub community network ─────────────────────────────────────────────────

async def aishub_worker():
    BASE = "https://data.aishub.net/ws.php"
    URLS = [
        f"{BASE}?username=AH_3868855&format=1&output=json&compress=0&latmin=-90&latmax=90&lonmin=-180&lonmax=180",
        f"{BASE}?username=AH_3868855&format=1&output=json&compress=0",
        f"http://data.aishub.net/ws.php?username=AH_3868855&format=1&output=json&compress=0",
    ]
    async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                  headers={"User-Agent": "ShipTracker/3.0"}) as c:
        while True:
            found = False
            for url in URLS:
                try:
                    r = await c.get(url)
                    if r.status_code != 200:
                        source_status["aishub"] = f"HTTP {r.status_code}"; await bcast_status(); continue
                    payload = r.json()
                    ships = []
                    if isinstance(payload, list):
                        if len(payload) >= 2:
                            meta = payload[0] if isinstance(payload[0], dict) else {}
                            if not meta.get("ERROR", False):
                                raw = payload[1]
                                ships = raw if isinstance(raw, list) else []
                            else:
                                source_status["aishub"] = str(meta.get("ERROR", "ERR"))[:40]
                                await bcast_status(); continue
                        elif len(payload) >= 1 and isinstance(payload[0], dict) and "MMSI" in payload[0]:
                            ships = payload
                    elif isinstance(payload, dict):
                        ships = payload.get("vessels") or payload.get("data") or []
                    cnt = 0
                    for s in ships:
                        m  = str(s.get("MMSI") or s.get("mmsi") or "")
                        la = s.get("LATITUDE") or s.get("lat")
                        lo = s.get("LONGITUDE") or s.get("lon")
                        if not m or la is None: continue
                        rec = upsert(m, la, lo,
                                     s.get("SOG") or s.get("sog") or 0,
                                     s.get("COG") or s.get("cog") or 0,
                                     name=str(s.get("NAME") or s.get("name") or "IDENTIFYING...").strip(),
                                     stype=ship_type(s.get("SHIPTYPE") or s.get("shipType") or 0),
                                     ts=datetime.utcnow().isoformat(), src="AISHub")
                        if rec: await broadcast(json.dumps(rec)); cnt += 1
                    if cnt:
                        source_status["aishub"] = f"LIVE ({cnt})"
                        await bcast_status(); found = True; break
                    else:
                        source_status["aishub"] = "NO DATA"
                except Exception as e:
                    source_status["aishub"] = f"ERR: {str(e)[:35]}"
                    logger.warning(f"AISHub {url}: {e}")
            if not found: await bcast_status()
            await asyncio.sleep(60)


# ─── ShipXplorer / NOAA supplemental ─────────────────────────────────────────

async def shipxplorer_worker():
    hdrs = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    ENDPOINTS = [
        ("https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/AIS_2023_Annual_Summary"
         "/FeatureServer/0/query?where=1%3D1&outFields=MMSI,LON,LAT,SOG,COG,VesselName,VesselType"
         "&resultRecordCount=200&f=json&orderByFields=BaseDateTime+DESC", "NOAA-AIS"),
        ("https://www.cruisemapper.com/api/ships?id=all&zoom=2&left=-180&bottom=-90&right=180&top=90", "CruiseMapper"),
        ("https://api.shipfinder.co/v2/vessels?apikey=free&bbox=-90,-180,90,180&limit=200", "ShipFinder"),
    ]
    async with httpx.AsyncClient(timeout=25, headers=hdrs, follow_redirects=True) as c:
        while True:
            found = False
            for url, src_name in ENDPOINTS:
                try:
                    r = await c.get(url)
                    if r.status_code not in (200, 206): continue
                    try: data = r.json()
                    except: continue
                    if src_name == "NOAA-AIS" and isinstance(data, dict) and "features" in data:
                        flat = []
                        for f in data["features"]:
                            a = f.get("attributes", {})
                            flat.append({
                                "mmsi": str(a.get("MMSI", "")),
                                "lat": a.get("LAT"), "lon": a.get("LON"),
                                "sog": a.get("SOG", 0), "cog": a.get("COG", 0),
                                "name": str(a.get("VesselName", "IDENTIFYING...")).strip(),
                                "type": a.get("VesselType", 0),
                            })
                        data = flat
                    recs = _parse_generic_vessels(data, src_name)
                    if recs:
                        for rec in recs: await broadcast(json.dumps(rec))
                        source_status["shipxplorer"] = f"LIVE ({len(recs)}) [{src_name}]"
                        await bcast_status(); found = True; break
                except Exception as e:
                    logger.debug(f"ShipXplorer {src_name}: {e}")
            if not found:
                source_status["shipxplorer"] = "UNAVAILABLE"
                await bcast_status()
            await asyncio.sleep(90)


# ─── ShipInfo / OpenSeaMap / HELCOM supplemental ─────────────────────────────

async def shipinfo_worker():
    hdrs = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    }
    ENDPOINTS = [
        # HELCOM AISVIEW – Baltic Sea open AIS (genuinely public)
        ("https://aisview.helcom.fi/geoserver/ais/ows?service=WFS&version=1.0.0&request=GetFeature"
         "&typeName=ais:aispositions&outputFormat=application%2Fjson&maxFeatures=500", "HELCOM"),
        ("https://www.openseamap.org/vessel/getVessels.php?lat1=-90&lat2=90&lon1=-180&lon2=180", "OpenSeaMap"),
        ("https://www.portalis.gr/api/vessels?bbox=30,10,47,42&format=json", "Portalis"),
    ]
    async with httpx.AsyncClient(timeout=25, headers=hdrs, follow_redirects=True) as c:
        while True:
            found = False
            for url, src_name in ENDPOINTS:
                try:
                    r = await c.get(url)
                    if r.status_code not in (200, 206): continue
                    try: data = r.json()
                    except: continue
                    if src_name == "HELCOM" and isinstance(data, dict) and "features" in data:
                        flat = []
                        for f in data["features"]:
                            p = f.get("properties", {})
                            g = f.get("geometry", {}).get("coordinates", [])
                            flat.append({
                                "mmsi": str(p.get("mmsi", "")),
                                "lat": g[1] if len(g) >= 2 else p.get("lat"),
                                "lon": g[0] if len(g) >= 2 else p.get("lon"),
                                "sog": p.get("sog", 0), "cog": p.get("cog", 0),
                                "name": str(p.get("name") or "IDENTIFYING...").strip(),
                                "type": p.get("shiptype", 0),
                            })
                        data = flat
                    recs = _parse_generic_vessels(data, src_name)
                    if recs:
                        for rec in recs: await broadcast(json.dumps(rec))
                        source_status["shipinfo"] = f"LIVE ({len(recs)}) [{src_name}]"
                        await bcast_status(); found = True; break
                except Exception as e:
                    logger.debug(f"ShipInfo {src_name}: {e}")
            if not found:
                source_status["shipinfo"] = "UNAVAILABLE"
                await bcast_status()
            await asyncio.sleep(90)


def _parse_generic_vessels(data, src):
    items = (data if isinstance(data, list)
             else data.get("vessels") or data.get("data") or
             data.get("results") or data.get("rows") or [])
    results = []
    for s in items:
        m  = str(s.get("mmsi") or s.get("MMSI") or "")
        la = (s.get("lat") or s.get("latitude") or s.get("LAT") or
              s.get("lastlatitude") or s.get("LATITUDE"))
        lo = (s.get("lon") or s.get("longitude") or s.get("LON") or
              s.get("lastlongitude") or s.get("LONGITUDE"))
        if not m or la is None: continue
        rec = upsert(m, la, lo,
            s.get("sog") or s.get("speed") or s.get("SOG") or 0,
            s.get("cog") or s.get("course") or s.get("COG") or 0,
            name=str(s.get("name") or s.get("NAME") or s.get("shipname") or "IDENTIFYING...").strip(),
            stype=ship_type(s.get("type") or s.get("shipType") or s.get("ship_type") or
                            s.get("TYPE") or s.get("SHIPTYPE") or 0),
            ts=datetime.utcnow().isoformat(), src=src)
        if rec: results.append(rec)
    return results


# ─── Satellite TLE sources (10 catalogs, deduplicated) ───────────────────────

TLE_SOURCES = [
    # active.txt covers ~6 000 objects across all the sub-catalogs below,
    # so we try it first; if it succeeds we skip the rest to avoid duplicates.
    ("ALL_ACTIVE",  "https://celestrak.org/pub/TLE/active.txt"),
    ("Stations",    "https://celestrak.org/pub/TLE/stations.txt"),
    ("Starlink",    "https://celestrak.org/pub/TLE/starlink.txt"),
    ("GPS",         "https://celestrak.org/pub/TLE/gps-ops.txt"),
    ("GLONASS",     "https://celestrak.org/pub/TLE/glo-ops.txt"),
    ("Galileo",     "https://celestrak.org/pub/TLE/galileo.txt"),
    ("Beidou",      "https://celestrak.org/pub/TLE/beidou.txt"),
    ("Weather",     "https://celestrak.org/pub/TLE/weather.txt"),
    ("EarthObs",    "https://celestrak.org/pub/TLE/earth-obs.txt"),
    ("Amateur",     "https://celestrak.org/pub/TLE/amateur.txt"),
    ("Science",     "https://celestrak.org/pub/TLE/science.txt"),
    ("OneWeb",      "https://celestrak.org/pub/TLE/oneweb.txt"),
]

# CORS proxy fallbacks for server-side fetch
TLE_PROXIES = [
    "",                                        # direct (works on Render/Railway/Fly)
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
    "https://thingproxy.freeboard.io/fetch/",
]

async def _fetch_tle(client: httpx.AsyncClient, url: str) -> str | None:
    for proxy in TLE_PROXIES:
        try:
            req = (proxy + url_quote(url, safe="")) if proxy.endswith("url=") else (proxy + url)
            r = await client.get(req, timeout=25)
            if r.status_code == 200 and len(r.text) > 100:
                return r.text
        except Exception as e:
            logger.debug(f"TLE fetch {proxy or 'direct'} {url}: {e}")
    return None

async def _load_tles() -> list:
    sats = []
    async with httpx.AsyncClient(timeout=25, headers={"User-Agent": "SatTracker/3.0"}) as c:
        for grp, url in TLE_SOURCES:
            text = await _fetch_tle(c, url)
            if not text:
                logger.warning(f"TLE {grp}: all fetch attempts failed"); continue
            lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
            for i in range(0, len(lines) - 2, 3):
                n, l1, l2 = lines[i], lines[i+1], lines[i+2]
                if not (l1.startswith("1 ") and l2.startswith("2 ")): continue
                try:
                    Satrec.twoline2rv(l1, l2)                  # validate
                    sats.append({"name": n, "line1": l1, "line2": l2, "group": grp})
                except: pass
            # active.txt already contains all sub-catalogs – skip the rest
            if grp == "ALL_ACTIVE" and len(sats) > 100:
                logger.info(f"TLE active.txt loaded {len(sats)} sats; skipping sub-catalogs")
                break
    # Deduplicate by name
    seen, deduped = set(), []
    for s in sats:
        if s["name"] not in seen:
            seen.add(s["name"]); deduped.append(s)
    return deduped

async def _push_catalog(catalog):
    CHUNK = 500
    for i in range(0, len(catalog), CHUNK):
        chunk = catalog[i:i+CHUNK]
        await broadcast(json.dumps({
            "type": "tle_catalog",
            "tles": chunk,
            "chunk": i // CHUNK,
            "total": math.ceil(len(catalog) / CHUNK),
        }))
        await asyncio.sleep(0.05)


# ─── ISS live position (real API, not propagated) ────────────────────────────

async def iss_live_worker():
    """Highest-accuracy ISS position from wheretheiss.at (5 s cadence)."""
    async with httpx.AsyncClient(timeout=10) as c:
        while True:
            pos = None
            try:
                r = await c.get("https://api.wheretheiss.at/v1/satellites/25544")
                if r.status_code == 200:
                    d = r.json()
                    pos = {
                        "lat":    float(d.get("latitude", 0)),
                        "lon":    float(d.get("longitude", 0)),
                        "alt":    float(d.get("altitude", 408)),
                        "speed":  round(float(d.get("velocity", 27580)) / 3600, 3),
                        "source": "wheretheiss.at",
                    }
            except: pass
            if pos is None:
                try:
                    r = await c.get("https://api.open-notify.org/iss-now.json")
                    if r.status_code == 200:
                        d = r.json(); p = d.get("iss_position", {})
                        pos = {
                            "lat": float(p.get("latitude", 0)),
                            "lon": float(p.get("longitude", 0)),
                            "alt": 408.0, "speed": 7.66,
                            "source": "OpenNotify",
                        }
                except: pass
            if pos:
                entry = {
                    "id": "ISS (ZARYA)", "name": "ISS (ZARYA)", "type": "SATELLITE",
                    **pos, "group": "Stations", "country": "International",
                    "last_update": datetime.utcnow().isoformat(),
                }
                satellite_registry["ISS (ZARYA)"] = entry
                await broadcast(json.dumps(entry))
            await asyncio.sleep(5)


# ─── Main satellite worker ───────────────────────────────────────────────────
# FIX: propagates ALL loaded TLEs (original code had [:600] cap).
# FIX: uses compute_gmst() for current-time GMST (original used satrec.gsto = epoch-only).

async def satellite_worker():
    global tle_catalog

    catalog = await _load_tles()
    tle_catalog = catalog
    logger.info(f"Satellite worker: {len(tle_catalog)} unique TLEs loaded")
    source_status["satellites"] = (f"LIVE ({len(tle_catalog)})"
                                   if tle_catalog else "SVR-DNS-FAIL (browser fetching)")
    await bcast_status()
    if tle_catalog:
        await _push_catalog(tle_catalog)

    # Start the live ISS tracker as a sub-task
    asyncio.create_task(iss_live_worker())

    ticker = 0
    while True:
        await asyncio.sleep(5)
        ticker += 1

        # Retry TLE load every 5 min if empty
        if not tle_catalog:
            if ticker % 60 == 0:
                catalog = await _load_tles()
                if catalog:
                    tle_catalog = catalog
                    source_status["satellites"] = f"LIVE ({len(tle_catalog)})"
                    await bcast_status()
                    await _push_catalog(tle_catalog)
            continue

        # Compute positions for ALL satellites (no [:600] cap)
        now = datetime.utcnow()
        jd, fr = jday(now.year, now.month, now.day,
                      now.hour, now.minute, now.second + now.microsecond / 1e6)
        gmst = compute_gmst(jd, fr)   # ← FIXED: accurate current-time GMST

        updates = []
        for sat in tle_catalog:
            try:
                satrec = Satrec.twoline2rv(sat["line1"], sat["line2"])
                e, r_vec, v_vec = satrec.sgp4(jd, fr)
                if e != 0: continue                   # propagation error (decayed / bad TLE)
                lat, lon, alt = teme_to_geodetic(r_vec, gmst)  # ← FIXED
                spd = math.sqrt(v_vec[0]**2 + v_vec[1]**2 + v_vec[2]**2) if v_vec else 7.66
                entry = {
                    "id":   sat["name"], "name": sat["name"], "type": "SATELLITE",
                    "lat":  round(lat, 4),
                    "lon":  round(lon, 4),
                    "alt":  round(alt, 1),
                    "speed": round(spd, 3),
                    "group": sat.get("group", ""), "source": "CelesTrak",
                    "last_update": now.isoformat(),
                }
                satellite_registry[sat["name"]] = entry
                updates.append(entry)
            except: pass

        # Batch broadcast (one message per tick, not one per satellite)
        if updates:
            await broadcast(json.dumps({"type": "sat_batch", "sats": updates}))

        # Refresh TLE catalog every hour (720 × 5 s ticks)
        if ticker >= 720:
            catalog = await _load_tles()
            if catalog:
                tle_catalog = catalog
                source_status["satellites"] = f"LIVE ({len(catalog)})"
                await bcast_status()
                await _push_catalog(tle_catalog)
            ticker = 0


# ─── Cleanup ─────────────────────────────────────────────────────────────────

async def cleanup_worker():
    while True:
        try:
            if len(ship_registry) > 12000:
                keys = sorted(ship_registry, key=lambda k: ship_registry[k].get("last_update", ""))
                for k in keys[:3000]:
                    ship_registry.pop(k, None); ship_paths.pop(k, None)
        except Exception as e: logger.error(f"Cleanup: {e}")
        await asyncio.sleep(300)


# ─── App lifecycle ────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    asyncio.create_task(aisstream_worker())
    asyncio.create_task(barentswatch_worker())
    asyncio.create_task(aishub_worker())
    asyncio.create_task(shipxplorer_worker())
    asyncio.create_task(shipinfo_worker())
    asyncio.create_task(satellite_worker())    # ← also spawns iss_live_worker inside
    asyncio.create_task(cleanup_worker())
    logger.info("All 7 workers started (6 data sources + cleanup)")


# ─── REST endpoints ───────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {
        "ships":      len(ship_registry),
        "satellites": len(satellite_registry),
        "clients":    len(clients),
        "sources":    source_status,
    }

@app.get("/api/tles")
async def api_tles():
    """Return the full TLE catalog (for clients that missed the WS push)."""
    return {"tles": tle_catalog, "count": len(tle_catalog)}


# ─── World-Main satellite algorithm: country, TLE parsing, REST endpoints ─────

def _sat_country(name: str) -> str:
    """Determine the operating country of a satellite from its name."""
    n = name.upper()
    if any(x in n for x in ['STARLINK', 'GPS IIR', 'GPS IIF', 'GPS III', 'NAVSTAR',
                             'GOES', 'NOAA', 'AQUA', 'TERRA', 'IRIDIUM', 'LANDSAT',
                             'TDRS', 'GPS BIIR', 'GPS BIIF', 'WGS ', 'MILSTAR', 'AEHF',
                             'SBIRS', 'DSP ', 'USA ']):
        return 'USA'
    if any(x in n for x in ['COSMOS', 'GLONASS', 'MOLNIYA', 'METEOR-', 'ELEKTRO',
                             'RESURS', 'GONETS', 'BARS-', 'LUCH']):
        return 'Russia'
    if any(x in n for x in ['GALILEO', 'ENVISAT', 'SENTINEL', 'METEOSAT',
                             'PROBA', 'SPOT ', 'PLEIADES', 'MICROSCOPE']):
        return 'EU'
    if any(x in n for x in ['BEIDOU', 'YAOGAN', 'FENGYUN', 'TIANGONG', 'TIANHE',
                             'SHENZHOU', 'CZ-', 'SHIJIAN', 'GAOFEN', 'ZIYUAN']):
        return 'China'
    if any(x in n for x in ['HIMAWARI', 'MTSAT', 'DAICHI', 'ALOS', 'HAYABUSA',
                             'QZSS', 'MICHIBIKI']):
        return 'Japan'
    if any(x in n for x in ['INSAT', 'GSAT', 'CARTOSAT', 'RISAT', 'RESOURCESAT',
                             'ASTROSAT', 'IRNSS', 'NAVIC']):
        return 'India'
    if any(x in n for x in ['ONEWEB',]):
        return 'UK'
    if any(x in n for x in ['ISS', 'ZARYA', 'ZVEZDA', 'UNITY', 'DESTINY', 'HARMONY']):
        return 'International'
    if any(x in n for x in ['INTELSAT', 'EUTELSAT', 'INMARSAT', 'SES-']):
        return 'International'
    if any(x in n for x in ['O3B', 'AMAZONAS']):
        return 'International'
    if any(x in n for x in ['AMOS', 'OFEK', 'TECSAR', 'OFEQ']):
        return 'Israel'
    if any(x in n for x in ['RADARSAT', 'CASSIOPE', 'SCISAT']):
        return 'Canada'
    if any(x in n for x in ['ASNARO', 'KOMPSAT', 'ARIRANG']):
        return 'South Korea'
    return ''


def _parse_tle_wm(raw: str) -> list:
    """Parse 3LE blocks and compute accurate positions via SGP4 (world-main algorithm, SGP4 enhanced).
    Returns orbital parameters: norad, inc, raan, ecc, argp, ma, mm, alt_km, period_min, country.
    """
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    sats = []
    now = datetime.utcnow()
    jd, fr = jday(now.year, now.month, now.day,
                  now.hour, now.minute, now.second + now.microsecond / 1e6)
    gmst = compute_gmst(jd, fr)
    i = 0
    while i < len(lines):
        if (i + 2 < len(lines)
                and lines[i+1].startswith("1 ")
                and lines[i+2].startswith("2 ")):
            name  = lines[i]
            line1 = lines[i+1]
            line2 = lines[i+2]
            try:
                inc        = float(line2[8:16].strip())
                raan       = float(line2[17:25].strip())
                ecc        = float("0." + line2[26:33].strip())
                argp       = float(line2[34:42].strip())
                ma         = float(line2[43:51].strip())
                mm         = float(line2[52:63].strip())
                norad      = int(line2[2:7].strip())
                period_min = round(1440.0 / mm, 1)
                alt_km     = round(((period_min / 84.4) ** (2.0/3.0) * 6371.0) - 6371.0, 1)
                # SGP4 propagation for accurate position
                satrec = Satrec.twoline2rv(line1, line2)
                e, r_vec, v_vec = satrec.sgp4(jd, fr)
                if e != 0:
                    i += 3
                    continue
                lat, lon, alt = teme_to_geodetic(r_vec, gmst)
                country = _sat_country(name)
                sats.append({
                    "name": name, "norad": norad,
                    "lat": round(lat, 4), "lon": round(lon, 4),
                    "alt_km": round(alt, 1),
                    "inc": round(inc, 2),
                    "period_min": period_min,
                    "country": country,
                    "line1": line1, "line2": line2,
                })
            except Exception:
                pass
            i += 3
        elif (i + 1 < len(lines)
              and lines[i].startswith("1 ")
              and lines[i+1].startswith("2 ")):
            # 2LE (no name line)
            line1 = lines[i]; line2 = lines[i+1]
            try:
                norad      = int(line2[2:7].strip())
                mm         = float(line2[52:63].strip())
                inc        = float(line2[8:16].strip())
                period_min = round(1440.0 / mm, 1)
                alt_km     = round(((period_min / 84.4) ** (2.0/3.0) * 6371.0) - 6371.0, 1)
                satrec = Satrec.twoline2rv(line1, line2)
                e, r_vec, v_vec = satrec.sgp4(jd, fr)
                if e != 0:
                    i += 2
                    continue
                lat, lon, alt = teme_to_geodetic(r_vec, gmst)
                name = f"SAT-{norad}"
                sats.append({
                    "name": name, "norad": norad,
                    "lat": round(lat, 4), "lon": round(lon, 4),
                    "alt_km": round(alt, 1), "inc": round(inc, 2),
                    "period_min": period_min, "country": "",
                    "line1": line1, "line2": line2,
                })
            except Exception:
                pass
            i += 2
        else:
            i += 1
    return sats


# Allowed CelesTrak groups (from world-main algorithm)
_TLE_GROUPS: Dict[str, str] = {
    "active":   "active",
    "starlink": "starlink",
    "gps":      "gps-ops",
    "military": "military",
    "stations": "stations",
    "weather":  "weather",
    "debris":   "1982-092",
    "amateur":  "amateur",
    "oneweb":   "oneweb",
    "galileo":  "galileo",
    "beidou":   "beidou",
    "glonass":  "glo-ops",
}


# Per-group TLE cache: group -> (monotonic_time, sats_list)
import time as _time
_group_tle_cache: Dict[str, tuple] = {}


@app.get("/api/ships")
async def api_ships():
    """Return all ships from the in-memory registry (for bulk load on button click)."""
    return {"ships": list(ship_registry.values()), "count": len(ship_registry)}


@app.get("/api/satellites/tle")
async def satellites_tle_rest(group: str = "active"):
    """CelesTrak TLE data with SGP4-propagated positions (world-main algorithm).
    For 'active' group uses in-memory satellite_registry (instant).
    Other groups fetch CelesTrak with a 5-minute per-group cache.
    """
    # ── Fast path: use pre-propagated in-memory data for 'active' ──────────
    if group == "active" and tle_catalog and satellite_registry:
        sats = []
        for cat_entry in tle_catalog:
            name = cat_entry["name"]
            reg = satellite_registry.get(name)
            if not reg:
                continue
            try:
                line2 = cat_entry["line2"]
                norad      = int(line2[2:7].strip())
                inc        = float(line2[8:16].strip())
                mm         = float(line2[52:63].strip())
                period_min = round(1440.0 / mm, 1)
                sats.append({
                    "name":       name,
                    "norad":      norad,
                    "lat":        reg["lat"],
                    "lon":        reg["lon"],
                    "alt_km":     reg.get("alt", reg.get("alt_km", 0)),
                    "inc":        round(inc, 2),
                    "period_min": period_min,
                    "country":    _sat_country(name),
                })
            except Exception:
                pass
        if sats:
            if len(sats) > 800:
                import random
                sats = random.sample(sats, 800)
            return {
                "source": "CelesTrak (active/live)",
                "count":  len(sats),
                "satellites": sats,
                "generated_at": datetime.utcnow().isoformat(),
            }

    # ── Cached path for other groups (5-minute TTL) ─────────────────────────
    cached = _group_tle_cache.get(group)
    if cached and (_time.monotonic() - cached[0]) < 300:
        sats = cached[1]
        return {
            "source": f"CelesTrak ({group}/cached)",
            "count": len(sats),
            "satellites": sats,
            "generated_at": datetime.utcnow().isoformat(),
        }

    # ── Fallback: use satellite_registry positions for 'active' even without tle_catalog ──
    if group == "active" and satellite_registry:
        sats = []
        for name, reg in satellite_registry.items():
            if reg.get("lat") is None: continue
            sats.append({
                "name":       name,
                "norad":      None,
                "lat":        reg["lat"],
                "lon":        reg["lon"],
                "alt_km":     reg.get("alt", reg.get("alt_km", 0)),
                "inc":        None,
                "period_min": None,
                "country":    _sat_country(name),
            })
        if sats:
            if len(sats) > 800:
                import random
                sats = random.sample(sats, 800)
            return {
                "source": "SGP4/live (no TLE catalog)",
                "count": len(sats),
                "satellites": sats,
                "generated_at": datetime.utcnow().isoformat(),
            }

    # ── Fetch from CelesTrak (reduced timeout so it fails fast) ─────────────
    grp = _TLE_GROUPS.get(group, "active")
    urls = [
        f"https://celestrak.org/pub/TLE/{grp}.txt",
        f"https://corsproxy.io/?https://celestrak.org/pub/TLE/{grp}.txt",
        f"https://api.allorigins.win/raw?url=https://celestrak.org/pub/TLE/{grp}.txt",
    ]
    raw = None
    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "SatTracker/3.0"}) as c:
        for u in urls:
            try:
                r = await c.get(u)
                if r.status_code == 200 and len(r.text) > 100:
                    raw = r.text
                    break
            except Exception:
                pass
    if not raw:
        raise HTTPException(status_code=503, detail=f"Satellite data unavailable for group: {group}")
    sats = _parse_tle_wm(raw)
    if len(sats) > 800:
        import random
        sats = random.sample(sats, 800)
    _group_tle_cache[group] = (_time.monotonic(), sats)
    return {
        "source": f"CelesTrak ({group})",
        "count": len(sats),
        "satellites": sats,
        "generated_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/satellites/iss")
async def iss_position_rest():
    """Real-time ISS position (world-main algorithm with SGP4 fallback)."""
    async with httpx.AsyncClient(timeout=10) as c:
        for url in [
            "https://api.wheretheiss.at/v1/satellites/25544",
            "http://api.open-notify.org/iss-now.json",
        ]:
            try:
                r = await c.get(url)
                if r.status_code == 200:
                    d = r.json()
                    if "latitude" in d:
                        return {"source": "wheretheiss.at",
                                "lat": float(d["latitude"]), "lon": float(d["longitude"])}
                    elif "iss_position" in d:
                        p = d["iss_position"]
                        return {"source": "Open Notify",
                                "lat": float(p["latitude"]), "lon": float(p["longitude"])}
            except Exception:
                pass
    # Final fallback: use satellite_registry from WS worker
    iss = satellite_registry.get("ISS (ZARYA)")
    if iss:
        return {"source": "SGP4", "lat": iss["lat"], "lon": iss["lon"]}
    raise HTTPException(status_code=502, detail="ISS position unavailable")


# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    q = asyncio.Queue()
    clients[ws] = q
    w = asyncio.create_task(writer_task(ws, q))

    # Burst cached data to new client immediately
    for mmsi in list(ship_registry.keys())[-500:]:
        await q.put(json.dumps(ship_registry[mmsi]))
    for sid in list(satellite_registry.keys())[:300]:
        await q.put(json.dumps(satellite_registry[sid]))
    await q.put(json.dumps({"type": "source_status", **source_status}))

    # Push full TLE catalog in 500-sat chunks
    CHUNK = 500
    for i in range(0, len(tle_catalog), CHUNK):
        chunk = tle_catalog[i:i+CHUNK]
        await q.put(json.dumps({
            "type": "tle_catalog",
            "tles": chunk,
            "chunk": i // CHUNK,
            "total": math.ceil(len(tle_catalog) / CHUNK) if tle_catalog else 1,
        }))

    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally:
        clients.pop(ws, None); w.cancel()


app.mount("/", StaticFiles(directory="ui3", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8002, reload=False)