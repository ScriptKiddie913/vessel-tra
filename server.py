"""Global Ship & Satellite Tracker v3 - Multi-Source Edition"""
import json, asyncio, math, logging, requests, pathlib
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, List, Any

import httpx, websockets
from sgp4.api import Satrec, jday
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

logger = logging.getLogger("uvicorn.error")

BASE_DIR = pathlib.Path(__file__).parent

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
    m = str(mmsi)[:3]
    return MID.get(m, "")

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(aisstream_worker())
    asyncio.create_task(barentswatch_worker())
    asyncio.create_task(aishub_worker())
    asyncio.create_task(shipxplorer_worker())
    asyncio.create_task(shipinfo_worker())
    asyncio.create_task(satellite_worker())
    asyncio.create_task(cleanup_worker())
    yield

app = FastAPI(title="Ship & Satellite Tracker v3", lifespan=lifespan)
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

# ─── Helpers ─────────────────────────────────────────────────────────────────

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

# ─── AISStream (global – 20 bounding boxes including Indian Ocean & Asia) ────

async def aisstream_worker():
    logger.info("AISStream worker starting")
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=30, open_timeout=60) as ws:
                await ws.send(json.dumps({
                    "APIKey": API_KEY,
                    "BoundingBoxes": [
                        # 4 × 4 global grid
                        [[-90, -180], [-45, -90]], [[-90, -90], [-45, 0]],
                        [[-90,    0], [-45,  90]], [[-90,  90], [-45, 180]],
                        [[-45, -180], [  0, -90]], [[-45, -90], [  0,   0]],
                        [[-45,    0], [  0,  90]], [[-45,  90], [  0, 180]],
                        [[  0, -180], [ 45, -90]], [[  0, -90], [ 45,   0]],
                        [[  0,    0], [ 45,  90]], [[  0,  90], [ 45, 180]],
                        [[ 45, -180], [ 90, -90]], [[ 45, -90], [ 90,   0]],
                        [[ 45,    0], [ 90,  90]], [[ 45,  90], [ 90, 180]],
                        # Extra focus boxes – Indian Ocean / Bay of Bengal / South China Sea
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

# ─── BarentsWatch ─────────────────────────────────────────────────────────────

async def barentswatch_worker():
    hdrs = {"Accept": "application/json", "User-Agent": "ShipTracker/3.0"}
    bw_urls = [
        "https://live.ais.barentswatch.no/v1/latest/combined",
        "https://live.ais.barentswatch.no/v1/combined",
        "https://apis.kystverket.no/ais-beta/v1/boundingbox?topleftlat=82&topleftlon=-5&bottomrightlat=50&bottomrightlon=35&modelType=Simple",
    ]
    async with httpx.AsyncClient(timeout=30, headers=hdrs) as c:
        while True:
            for bw_url in bw_urls:
              try:
                r = await c.get(bw_url)
                if r.status_code == 200:
                    data = r.json()
                    rows = data if isinstance(data, list) else data.get("vessels") or data.get("data") or []
                    cnt = 0
                    for s in rows:
                        m  = str(s.get("mmsi", ""))
                        la = s.get("lat") or s.get("latitude")
                        lo = s.get("lon") or s.get("longitude")
                        if not m or la is None: continue
                        rec = upsert(m, la, lo,
                                     s.get("speedOverGround") or s.get("sog") or 0,
                                     s.get("courseOverGround") or s.get("cog") or 0,
                                     name=(s.get("name") or s.get("shipname") or "IDENTIFYING...").strip(),
                                     stype=ship_type(s.get("shipType") or s.get("ship_type") or 0),
                                     ts=datetime.utcnow().isoformat(), src="BarentsWatch")
                        if rec: await broadcast(json.dumps(rec)); cnt += 1
                    source_status["barentswatch"] = f"LIVE ({cnt})"
                    await bcast_status()
                    break
                else:
                    source_status["barentswatch"] = f"HTTP {r.status_code}"
              except Exception as e:
                source_status["barentswatch"] = "ERROR"
                logger.warning(f"BarentsWatch {bw_url}: {e}")
            await asyncio.sleep(45)

# ─── AISHub ───────────────────────────────────────────────────────────────────

async def aishub_worker():
    url = ("https://data.aishub.net/ws.php"
           "?username=AH_3868855&format=1&output=json&compress=0"
           "&latmin=-90&latmax=90&lonmin=-180&lonmax=180")
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "ShipTracker/3.0"}) as c:
        while True:
            try:
                r = await c.get(url)
                if r.status_code == 200:
                    payload = r.json(); ships = []
                    if isinstance(payload, list) and len(payload) >= 2 and not payload[0].get("ERROR", True):
                        ships = payload[1]
                    cnt = 0
                    for s in ships:
                        m  = str(s.get("MMSI", ""))
                        la = s.get("LATITUDE"); lo = s.get("LONGITUDE")
                        if not m or la is None: continue
                        rec = upsert(m, la, lo, s.get("SOG", 0), s.get("COG", 0),
                                     name=str(s.get("NAME", "IDENTIFYING...")).strip(),
                                     stype=ship_type(s.get("SHIPTYPE", 0)),
                                     ts=datetime.utcnow().isoformat(), src="AISHub")
                        if rec: await broadcast(json.dumps(rec)); cnt += 1
                    source_status["aishub"] = f"LIVE ({cnt})" if cnt else "NO DATA"
                    await bcast_status()
                else:
                    source_status["aishub"] = f"HTTP {r.status_code}"
            except Exception as e:
                source_status["aishub"] = "ERROR"
                logger.warning(f"AISHub: {e}")
            await asyncio.sleep(60)

# ─── ShipXplorer ──────────────────────────────────────────────────────────────

async def shipxplorer_worker():
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.shipxplorer.com/", "Accept": "application/json"}
    urls = ["https://www.shipxplorer.com/api/vi/signals/newest?limit=500",
            "https://www.shipxplorer.com/map/data?zoom=2&lat=0&lon=0"]
    async with httpx.AsyncClient(timeout=20, headers=hdrs, follow_redirects=True) as c:
        while True:
            found = False
            for url in urls:
                try:
                    r = await c.get(url)
                    if r.status_code != 200: continue
                    try: data = r.json()
                    except: continue
                    items = (data if isinstance(data, list)
                             else data.get("ships") or data.get("data") or data.get("vessels") or [])
                    cnt = 0
                    for item in items:
                        m  = str(item.get("mmsi") or item.get("MMSI") or "")
                        la = item.get("lat") or item.get("latitude")
                        lo = item.get("lon") or item.get("longitude")
                        if not m or la is None: continue
                        rec = upsert(m, la, lo,
                                     item.get("speed") or item.get("sog") or 0,
                                     item.get("course") or item.get("cog") or 0,
                                     name=str(item.get("name") or "IDENTIFYING...").strip(),
                                     ts=datetime.utcnow().isoformat(), src="ShipXplorer")
                        if rec: await broadcast(json.dumps(rec)); cnt += 1
                    if cnt:
                        source_status["shipxplorer"] = f"LIVE ({cnt})"
                        await bcast_status(); found = True; break
                except Exception as e: logger.debug(f"ShipXplorer {url}: {e}")
            if not found: source_status["shipxplorer"] = "NO DATA"
            await asyncio.sleep(60)

# ─── ShipInfo ─────────────────────────────────────────────────────────────────

async def shipinfo_worker():
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://shipinfo.net/", "Accept": "application/json"}
    urls = ["https://shipinfo.net/api/v1/ships/positions?limit=500",
            "https://shipinfo.net/api/vessels?format=json&limit=500"]
    async with httpx.AsyncClient(timeout=20, headers=hdrs, follow_redirects=True) as c:
        while True:
            found = False
            for url in urls:
                try:
                    r = await c.get(url)
                    if r.status_code != 200: continue
                    try: data = r.json()
                    except: continue
                    items = (data if isinstance(data, list)
                             else data.get("ships") or data.get("data") or [])
                    cnt = 0
                    for item in items:
                        m  = str(item.get("mmsi") or "")
                        la = item.get("lat") or item.get("latitude")
                        lo = item.get("lon") or item.get("longitude")
                        if not m or la is None: continue
                        rec = upsert(m, la, lo,
                                     item.get("speed") or 0, item.get("course") or 0,
                                     name=str(item.get("name") or "IDENTIFYING...").strip(),
                                     ts=datetime.utcnow().isoformat(), src="ShipInfo")
                        if rec: await broadcast(json.dumps(rec)); cnt += 1
                    if cnt:
                        source_status["shipinfo"] = f"LIVE ({cnt})"
                        await bcast_status(); found = True; break
                except Exception as e: logger.debug(f"ShipInfo {url}: {e}")
            if not found: source_status["shipinfo"] = "NO DATA"
            await asyncio.sleep(60)

# ─── Satellite TLE + propagation ──────────────────────────────────────────────

TLE_SOURCES = [
    ("Active",    "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle"),
    ("Stations",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"),
    ("Starlink",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle"),
    ("GPS",       "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle"),
    ("GLONASS",   "https://celestrak.org/NORAD/elements/gp.php?GROUP=glo-ops&FORMAT=tle"),
    ("Galileo",   "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle"),
    ("Beidou",    "https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=tle"),
    ("Weather",   "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle"),
    ("EarthObs",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=earth-obs&FORMAT=tle"),
    ("Amateur",   "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle"),
]

async def satellite_worker():
    global tle_catalog
    loop = asyncio.get_event_loop()

    def fetch_tles():
        sats = []
        for grp, url in TLE_SOURCES:
            try:
                r = requests.get(url, timeout=15)
                if r.status_code != 200: continue
                lines = [l.strip() for l in r.text.strip().splitlines() if l.strip()]
                for i in range(0, len(lines) - 2, 3):
                    n, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
                    if not (l1.startswith("1 ") and l2.startswith("2 ")): continue
                    try: Satrec.twoline2rv(l1, l2); sats.append({"name": n, "line1": l1, "line2": l2, "group": grp})
                    except: pass
            except Exception as e: logger.warning(f"TLE {grp}: {e}")
        return sats

    catalog = []
    while not catalog:
        catalog = await loop.run_in_executor(None, fetch_tles)
        if not catalog:
            logger.warning("No TLEs fetched, retrying in 60s…")
            await asyncio.sleep(60)
    # Deduplicate by name
    seen = set(); deduped = []
    for s in catalog:
        if s["name"] not in seen: seen.add(s["name"]); deduped.append(s)
    tle_catalog = deduped
    logger.info(f"Loaded {len(tle_catalog)} unique TLEs")
    source_status["satellites"] = f"LIVE ({len(tle_catalog)})"
    await bcast_status()
    await broadcast(json.dumps({"type": "tle_catalog", "tles": tle_catalog}))
    # Also push ISS live position from open-notify as supplemental
    asyncio.create_task(iss_live_worker())

    ticker = 0
    while True:
        await asyncio.sleep(5)
        ticker += 1
        now = datetime.utcnow()
        jd, fr = jday(now.year, now.month, now.day,
                      now.hour, now.minute, now.second + now.microsecond / 1e6)
        for sat in tle_catalog[:2000]:  # cap per-tick to bound broadcast volume
            try:
                satrec = Satrec.twoline2rv(sat["line1"], sat["line2"])
                e, r_v, _ = satrec.sgp4(jd, fr)
                if e != 0: continue
                x, y, z = r_v
                # Compute GMST at current time (not at satellite epoch)
                d = jd + fr - 2451545.0  # days since J2000.0
                gmst = math.radians((280.46061837 + 360.98564736629 * d) % 360)
                lon_r = math.atan2(y, x) - gmst
                lon_r = (lon_r + math.pi) % (2 * math.pi) - math.pi
                lat_r = math.atan2(z, math.sqrt(x * x + y * y))
                alt   = math.sqrt(x * x + y * y + z * z) - 6371.0
                satellite_registry[sat["name"]] = {
                    "id": sat["name"], "name": sat["name"], "type": "SATELLITE",
                    "lat": math.degrees(lat_r), "lon": math.degrees(lon_r),
                    "alt": round(alt, 1), "speed": round(math.sqrt(x*x+y*y+z*z) * 0.001, 2),
                    "group": sat.get("group", ""), "source": "CelesTrak",
                    "last_update": now.isoformat(),
                }
                await broadcast(json.dumps(satellite_registry[sat["name"]]))
            except: pass

        # Refresh TLE catalog every hour (~720 × 5s ticks)
        if ticker >= 720:
            new_cat = await loop.run_in_executor(None, fetch_tles)
            if new_cat:
                seen2 = set(); deduped2 = []
                for s in new_cat:
                    if s["name"] not in seen2: seen2.add(s["name"]); deduped2.append(s)
                tle_catalog = deduped2
            source_status["satellites"] = f"LIVE ({len(tle_catalog)})"
            await bcast_status()
            await broadcast(json.dumps({"type": "tle_catalog", "tles": tle_catalog}))
            ticker = 0

# ─── ISS live position (open-notify) ────────────────────────────────────────
async def iss_live_worker():
    async with httpx.AsyncClient(timeout=10) as c:
        while True:
            try:
                r = await c.get("https://api.open-notify.org/iss-now.json")
                if r.status_code == 200:
                    d = r.json()
                    pos = d.get("iss_position", {})
                    la = float(pos.get("latitude", 0))
                    lo = float(pos.get("longitude", 0))
                    satellite_registry["ISS (ZARYA)"] = {
                        "id": "ISS (ZARYA)", "name": "ISS (ZARYA)",
                        "type": "SATELLITE", "lat": la, "lon": lo,
                        "alt": 408.0, "speed": 7.66,
                        "group": "Stations", "source": "OpenNotify",
                        "country": "International",
                        "last_update": datetime.utcnow().isoformat(),
                    }
                    await broadcast(json.dumps(satellite_registry["ISS (ZARYA)"]))
            except: pass
            await asyncio.sleep(5)

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

# ─── App lifecycle is handled via lifespan context manager above ─────────────

# ─── API endpoints ────────────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {
        "ships": len(ship_registry),
        "satellites": len(satellite_registry),
        "clients": len(clients),
        "sources": source_status,
    }

@app.get("/api/ships")
async def api_ships():
    ships = list(ship_registry.values())
    return {"count": len(ships), "ships": ships[-1000:]}

@app.get("/api/satellites")
async def api_satellites():
    sats = list(satellite_registry.values())
    return {"count": len(sats), "satellites": sats[:500]}

@app.get("/api/tles")
async def api_tles():
    global tle_catalog
    if not tle_catalog:
        # Background worker hasn't populated the catalog yet (e.g. Vercel cold-start).
        # Fetch a single TLE source synchronously so callers always get data.
        try:
            loop = asyncio.get_running_loop()
            def _fetch():
                sats = []
                try:
                    r = requests.get(
                        "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
                        timeout=15,
                    )
                    if r.status_code == 200:
                        lines = [l.strip() for l in r.text.strip().splitlines() if l.strip()]
                        for i in range(0, len(lines) - 2, 3):
                            n, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
                            if l1.startswith("1 ") and l2.startswith("2 "):
                                try:
                                    Satrec.twoline2rv(l1, l2)  # validate TLE before adding
                                    sats.append({"name": n, "line1": l1, "line2": l2, "group": "Active"})
                                except Exception:
                                    pass
                except Exception as e:
                    logger.warning(f"api/tles on-demand fetch: {e}")
                return sats
            fetched = await loop.run_in_executor(None, _fetch)
            if fetched:
                tle_catalog = fetched
                source_status["satellites"] = f"LIVE ({len(tle_catalog)})"
        except Exception as e:
            logger.warning(f"api/tles on-demand fetch failed: {e}")
    return {"tles": tle_catalog}

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    q = asyncio.Queue()
    clients[ws] = q
    w = asyncio.create_task(writer_task(ws, q))
    # Send cached data immediately
    for mmsi in list(ship_registry.keys())[-500:]:
        await q.put(json.dumps(ship_registry[mmsi]))
    for sid in list(satellite_registry.keys())[:300]:
        await q.put(json.dumps(satellite_registry[sid]))
    await q.put(json.dumps({"type": "source_status", **source_status}))
    if tle_catalog:
        await q.put(json.dumps({"type": "tle_catalog", "tles": tle_catalog}))
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect: pass
    finally:
        clients.pop(ws, None); w.cancel()

app.mount("/", StaticFiles(directory=str(BASE_DIR / "ui3"), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8002, reload=False)
