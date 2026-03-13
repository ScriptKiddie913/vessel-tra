"""
SAT-INTEL — Satellite Intelligence Platform
Python backend served by uvicorn. Proxies CelesTrak TLE data, real AIS ship tracking, and serves the static frontend.
"""

import time
import asyncio
import json
import math
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx

try:
    import websockets
    HAS_WS = True
except ImportError:
    HAS_WS = False

logger = logging.getLogger("uvicorn.error")

# ---------------------------------------------------------------------------
# AIS Ship Tracking — Global State
# ---------------------------------------------------------------------------
ship_registry: Dict[str, Dict[str, Any]] = {}
ship_paths: Dict[str, List[Dict]] = {}
MAX_PATH = 20
AIS_API_KEY = "8b9d8625829bd9614947be967c141babc5931e79"
AIS_WS_URL = "wss://stream.aisstream.io/v0/stream"
ship_source_status: Dict[str, str] = {
    "aisstream": "CONNECTING", "barentswatch": "IDLE",
    "aishub": "IDLE", "shipxplorer": "IDLE", "shipinfo": "IDLE",
}

# ─── MID → Country lookup (MMSI first-3-digits) ──────────────────────────────
MID: Dict[str, str] = {
    "201":"Albania","203":"Austria","204":"Azores","205":"Belgium",
    "209":"Cyprus","211":"Germany","219":"Denmark","220":"Denmark",
    "224":"Spain","225":"Spain","226":"France","227":"France","228":"France",
    "230":"Finland","231":"Faroe Is.","232":"UK","233":"UK","234":"UK","235":"UK",
    "237":"Greece","238":"Croatia","239":"Greece","240":"Greece","241":"Greece",
    "242":"Morocco","244":"Netherlands","245":"Netherlands","247":"Italy",
    "248":"Malta","249":"Malta","250":"Ireland","251":"Iceland",
    "255":"Madeira","256":"Malta","257":"Norway","258":"Norway","259":"Norway",
    "261":"Poland","263":"Portugal","264":"Romania","265":"Sweden","266":"Sweden",
    "269":"Switzerland","270":"Czech Rep.","271":"Turkey","272":"Ukraine","273":"Russia",
    "275":"Latvia","276":"Estonia","277":"Lithuania","278":"Slovenia",
    "301":"Anguilla","303":"Alaska","304":"Antigua","308":"Bahamas","309":"Bahamas",
    "311":"Bahamas","312":"Belize","314":"Barbados","316":"Canada","319":"Cayman Is.",
    "321":"Costa Rica","323":"Cuba","325":"Dominica","327":"Dominican Rep.",
    "330":"Grenada","331":"Greenland","332":"Guatemala","334":"Honduras",
    "336":"Haiti","338":"USA","339":"Jamaica","345":"Mexico","350":"Nicaragua",
    "351":"Panama","352":"Panama","353":"Panama","354":"Panama","355":"Panama",
    "356":"Panama","357":"Panama","358":"Puerto Rico","362":"Trinidad",
    "366":"USA","367":"USA","368":"USA","369":"USA","370":"Panama",
    "371":"Panama","372":"Panama","373":"Panama","374":"Panama",
    "375":"St Vincent","401":"Afghanistan","403":"Saudi Arabia","405":"Bangladesh",
    "408":"Bahrain","412":"China","413":"China","414":"China","416":"Taiwan",
    "422":"Iran","425":"Iraq","428":"Israel","431":"Japan","432":"Japan",
    "436":"Kazakhstan","438":"Jordan","440":"South Korea","441":"South Korea",
    "445":"DPR Korea","447":"Kuwait","450":"Lebanon","453":"Macao",
    "455":"Maldives","457":"Mongolia","461":"Oman","463":"Pakistan",
    "466":"Qatar","468":"Syria","470":"UAE","471":"UAE","477":"Hong Kong",
    "501":"Antarctica","503":"Australia","506":"Myanmar","508":"Brunei",
    "510":"Micronesia","512":"New Zealand","514":"Cambodia",
    "516":"Christmas Is.","518":"Cook Is.","520":"Fiji","525":"Indonesia",
    "533":"Malaysia","538":"Marshall Is.","542":"Niue","544":"Papua NG",
    "548":"Philippines","553":"Solomon Is.","557":"Samoa","559":"Singapore",
    "563":"Singapore","564":"Singapore","565":"Singapore","567":"Thailand",
    "570":"Tonga","574":"Vietnam","576":"Vanuatu",
    "601":"South Africa","603":"Angola","605":"Algeria","613":"Cameroon",
    "616":"Comoros","617":"Cabo Verde","619":"Ivory Coast","622":"Egypt",
    "624":"Ethiopia","626":"Gabon","627":"Ghana","632":"Guinea",
    "634":"Kenya","636":"Liberia","637":"Liberia","642":"Libya",
    "645":"Mauritius","647":"Madagascar","649":"Mali","650":"Mozambique",
    "654":"Mauritania","656":"Niger","657":"Nigeria","659":"Namibia",
    "662":"Sudan","663":"Senegal","664":"Seychelles","666":"Somalia",
    "667":"Sierra Leone","672":"Tunisia","674":"Tanzania","675":"Uganda",
    "676":"DR Congo","678":"Zimbabwe","679":"Zambia",
    "701":"Argentina","710":"Brazil","720":"Bolivia","725":"Chile",
    "730":"Colombia","735":"Ecuador","745":"Guiana","750":"Guyana",
    "755":"Paraguay","760":"Peru","765":"Suriname","770":"Uruguay","775":"Venezuela",
}

def mmsi_country(mmsi: str) -> str:
    return MID.get(str(mmsi)[:3], "")

def ship_type_name(tid) -> str:
    t = int(tid or 0)
    if t == 30: return "Fishing"
    if t in (31, 32): return "Tug"
    if t in (35, 36, 55): return "Military"
    if 40 <= t <= 49: return "High Speed"
    if t == 52: return "Tug"
    if 60 <= t <= 69: return "Passenger"
    if 70 <= t <= 79: return "Cargo"
    if 80 <= t <= 89: return "Tanker"
    if t == 51: return "SAR"
    return "Unknown"

def upsert_ship(mmsi, lat, lon, spd=0., crs=0., name="IDENTIFYING...", stype="Unknown", ts="", src=""):
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
        if stype != "Unknown": r["type"] = stype
    if mmsi not in ship_paths: ship_paths[mmsi] = []
    pp = ship_paths[mmsi]
    if not pp or abs(pp[-1]["lat"] - lat) > 0.0001 or abs(pp[-1]["lon"] - lon) > 0.0001:
        pp.append({"lat": lat, "lon": lon})
        if len(pp) > MAX_PATH: pp.pop(0)
    ship_registry[mmsi]["path"] = pp
    return ship_registry[mmsi]

# ---------------------------------------------------------------------------
# AIS Background Workers
# ---------------------------------------------------------------------------
async def aisstream_worker():
    if not HAS_WS:
        logger.warning("websockets not installed — AISStream disabled")
        ship_source_status["aisstream"] = "NO WS LIB"
        return
    logger.info("AISStream worker starting")
    while True:
        try:
            async with websockets.connect(AIS_WS_URL, ping_interval=30, open_timeout=60) as ws:
                await ws.send(json.dumps({
                    "APIKey": AIS_API_KEY,
                    "BoundingBoxes": [
                        [[-90, -180], [-45, -90]], [[-90, -90], [-45, 0]],
                        [[-90, 0], [-45, 90]], [[-90, 90], [-45, 180]],
                        [[-45, -180], [0, -90]], [[-45, -90], [0, 0]],
                        [[-45, 0], [0, 90]], [[-45, 90], [0, 180]],
                        [[0, -180], [45, -90]], [[0, -90], [45, 0]],
                        [[0, 0], [45, 90]], [[0, 90], [45, 180]],
                        [[45, -180], [90, -90]], [[45, -90], [90, 0]],
                        [[45, 0], [90, 90]], [[45, 90], [90, 180]],
                    ],
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }))
                ship_source_status["aisstream"] = "LIVE"
                logger.info("AISStream connected")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        mmsi = str(msg.get("MetaData", {}).get("MMSI", ""))
                        if not mmsi: continue
                        ts = msg.get("MetaData", {}).get("time_utc", datetime.utcnow().isoformat())
                        mt = msg.get("MessageType")
                        if mt == "ShipStaticData":
                            sd = msg["Message"]["ShipStaticData"]
                            if mmsi in ship_registry:
                                ship_registry[mmsi]["name"] = sd.get("Name", "").strip() or ship_registry[mmsi]["name"]
                                ship_registry[mmsi]["type"] = ship_type_name(sd.get("Type", 0))
                        elif mt == "PositionReport":
                            pr = msg["Message"]["PositionReport"]
                            upsert_ship(mmsi, pr.get("Latitude"), pr.get("Longitude"),
                                        pr.get("Sog", 0), pr.get("Cog", 0), ts=ts, src="AISStream")
                    except Exception as e:
                        logger.debug(f"AIS parse: {e}")
        except Exception as e:
            ship_source_status["aisstream"] = "RECONNECTING"
            logger.warning(f"AISStream: {e}")
            await asyncio.sleep(10)

async def barentswatch_worker():
    hdrs = {"Accept": "application/json", "User-Agent": "SatIntel/1.0"}
    bw_urls = [
        "https://live.ais.barentswatch.no/v1/latest/combined",
        "https://live.ais.barentswatch.no/v1/combined",
    ]
    async with httpx.AsyncClient(timeout=30, headers=hdrs) as c:
        while True:
            for url in bw_urls:
                try:
                    r = await c.get(url)
                    if r.status_code == 200:
                        data = r.json()
                        rows = data if isinstance(data, list) else data.get("vessels") or data.get("data") or []
                        cnt = 0
                        for s in rows:
                            m = str(s.get("mmsi", ""))
                            la = s.get("lat") or s.get("latitude")
                            lo = s.get("lon") or s.get("longitude")
                            if not m or la is None: continue
                            upsert_ship(m, la, lo,
                                        s.get("speedOverGround") or s.get("sog") or 0,
                                        s.get("courseOverGround") or s.get("cog") or 0,
                                        name=(s.get("name") or s.get("shipname") or "IDENTIFYING...").strip(),
                                        stype=ship_type_name(s.get("shipType") or s.get("ship_type") or 0),
                                        ts=datetime.utcnow().isoformat(), src="BarentsWatch")
                            cnt += 1
                        ship_source_status["barentswatch"] = f"LIVE ({cnt})"
                        break
                    else:
                        ship_source_status["barentswatch"] = f"HTTP {r.status_code}"
                except Exception as e:
                    ship_source_status["barentswatch"] = "ERROR"
                    logger.warning(f"BarentsWatch {url}: {e}")
            await asyncio.sleep(45)

async def aishub_worker():
    url = ("https://data.aishub.net/ws.php"
           "?username=AH_3868855&format=1&output=json&compress=0"
           "&latmin=-90&latmax=90&lonmin=-180&lonmax=180")
    async with httpx.AsyncClient(timeout=30, headers={"User-Agent": "SatIntel/1.0"}) as c:
        while True:
            try:
                r = await c.get(url)
                if r.status_code == 200:
                    payload = r.json()
                    ships = []
                    if isinstance(payload, list) and len(payload) >= 2 and not payload[0].get("ERROR", True):
                        ships = payload[1]
                    cnt = 0
                    for s in ships:
                        m = str(s.get("MMSI", ""))
                        la = s.get("LATITUDE"); lo = s.get("LONGITUDE")
                        if not m or la is None: continue
                        upsert_ship(m, la, lo, s.get("SOG", 0), s.get("COG", 0),
                                    name=str(s.get("NAME", "IDENTIFYING...")).strip(),
                                    stype=ship_type_name(s.get("SHIPTYPE", 0)),
                                    ts=datetime.utcnow().isoformat(), src="AISHub")
                        cnt += 1
                    ship_source_status["aishub"] = f"LIVE ({cnt})" if cnt else "NO DATA"
                else:
                    ship_source_status["aishub"] = f"HTTP {r.status_code}"
            except Exception as e:
                ship_source_status["aishub"] = "ERROR"
                logger.warning(f"AISHub: {e}")
            await asyncio.sleep(60)

async def shipxplorer_worker():
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://www.shipxplorer.com/", "Accept": "application/json"}
    urls = ["https://www.shipxplorer.com/api/vi/signals/newest?limit=500",
            "https://www.shipxplorer.com/map/data?zoom=2&lat=0&lon=0"]
    async with httpx.AsyncClient(timeout=20, headers=hdrs, follow_redirects=True) as c:
        while True:
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
                        m = str(item.get("mmsi") or item.get("MMSI") or "")
                        la = item.get("lat") or item.get("latitude")
                        lo = item.get("lon") or item.get("longitude")
                        if not m or la is None: continue
                        upsert_ship(m, la, lo,
                                    item.get("speed") or item.get("sog") or 0,
                                    item.get("course") or item.get("cog") or 0,
                                    name=str(item.get("name") or "IDENTIFYING...").strip(),
                                    ts=datetime.utcnow().isoformat(), src="ShipXplorer")
                        cnt += 1
                    if cnt:
                        ship_source_status["shipxplorer"] = f"LIVE ({cnt})"
                        break
                except Exception as e:
                    logger.debug(f"ShipXplorer {url}: {e}")
            await asyncio.sleep(60)

async def shipinfo_worker():
    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Referer": "https://shipinfo.net/", "Accept": "application/json"}
    urls = ["https://shipinfo.net/api/v1/ships/positions?limit=500",
            "https://shipinfo.net/api/vessels?format=json&limit=500"]
    async with httpx.AsyncClient(timeout=20, headers=hdrs, follow_redirects=True) as c:
        while True:
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
                        m = str(item.get("mmsi") or "")
                        la = item.get("lat") or item.get("latitude")
                        lo = item.get("lon") or item.get("longitude")
                        if not m or la is None: continue
                        upsert_ship(m, la, lo,
                                    item.get("speed") or 0, item.get("course") or 0,
                                    name=str(item.get("name") or "IDENTIFYING...").strip(),
                                    ts=datetime.utcnow().isoformat(), src="ShipInfo")
                        cnt += 1
                    if cnt:
                        ship_source_status["shipinfo"] = f"LIVE ({cnt})"
                        break
                except Exception as e:
                    logger.debug(f"ShipInfo {url}: {e}")
            await asyncio.sleep(60)

async def ship_cleanup_worker():
    while True:
        try:
            if len(ship_registry) > 10000:
                keys = sorted(ship_registry, key=lambda k: ship_registry[k].get("last_update", ""))
                for k in keys[:3000]:
                    ship_registry.pop(k, None)
                    ship_paths.pop(k, None)
        except Exception as e:
            logger.error(f"Ship cleanup: {e}")
        await asyncio.sleep(300)

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(aisstream_worker())
    asyncio.create_task(barentswatch_worker())
    asyncio.create_task(aishub_worker())
    asyncio.create_task(shipxplorer_worker())
    asyncio.create_task(shipinfo_worker())
    asyncio.create_task(ship_cleanup_worker())
    yield

app = FastAPI(title="SAT-INTEL", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory cache
# ---------------------------------------------------------------------------
_cache: dict[str, dict] = {}
TLE_TTL = 300        # 5 min
SATCAT_TTL = 86400   # 24 h
EVENT_TTL = 600      # 10 min

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "text/plain, */*",
}

# ---------------------------------------------------------------------------
# CelesTrak TLE sources — 25+ categories
# ---------------------------------------------------------------------------
TLE_URLS: dict[str, str] = {
    "active":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
    "starlink":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle",
    "stations":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
    "weather":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle",
    "gps":          "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle",
    "military":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=military&FORMAT=tle",
    "science":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle",
    "resource":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle",
    "geo":          "https://celestrak.org/NORAD/elements/gp.php?GROUP=geo&FORMAT=tle",
    "iridium":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-NEXT&FORMAT=tle",
    "oneweb":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=oneweb&FORMAT=tle",
    "globalstar":   "https://celestrak.org/NORAD/elements/gp.php?GROUP=globalstar&FORMAT=tle",
    "amateur":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle",
    "cubesat":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=cubesat&FORMAT=tle",
    "planet":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=planet&FORMAT=tle",
    "spire":        "https://celestrak.org/NORAD/elements/gp.php?GROUP=spire&FORMAT=tle",
    "geodetic":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=geodetic&FORMAT=tle",
    "engineering":  "https://celestrak.org/NORAD/elements/gp.php?GROUP=engineering&FORMAT=tle",
    "education":    "https://celestrak.org/NORAD/elements/gp.php?GROUP=education&FORMAT=tle",
    "radar":        "https://celestrak.org/NORAD/elements/gp.php?GROUP=radar&FORMAT=tle",
    "orbcomm":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=orbcomm&FORMAT=tle",
    "ses":          "https://celestrak.org/NORAD/elements/gp.php?GROUP=ses&FORMAT=tle",
    "intelsat":     "https://celestrak.org/NORAD/elements/gp.php?GROUP=intelsat&FORMAT=tle",
    "telesat":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=telesat&FORMAT=tle",
    "beidou":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=beidou&FORMAT=tle",
    "glonass":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=glonass-operational&FORMAT=tle",
    "galileo":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=galileo&FORMAT=tle",
    "visual":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle",
    "tle-new":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=tle-new&FORMAT=tle",
    "debris":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=tle",
    "sarsat":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=sarsat&FORMAT=tle",
    "dmc":          "https://celestrak.org/NORAD/elements/gp.php?GROUP=dmc&FORMAT=tle",
    "argos":        "https://celestrak.org/NORAD/elements/gp.php?GROUP=argos&FORMAT=tle",
    "x-comm":       "https://celestrak.org/NORAD/elements/gp.php?GROUP=x-comm&FORMAT=tle",
    "gnss":         "https://celestrak.org/NORAD/elements/gp.php?GROUP=gnss&FORMAT=tle",
    "satnogs":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=satnogs&FORMAT=tle",
    "tdrss":        "https://celestrak.org/NORAD/elements/gp.php?GROUP=tdrss&FORMAT=tle",
    "molniya":      "https://celestrak.org/NORAD/elements/gp.php?GROUP=molniya&FORMAT=tle",
    "noaa":         "https://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=tle",
    "goes":         "https://celestrak.org/NORAD/elements/gp.php?GROUP=goes&FORMAT=tle",
}

TLE_FALLBACK: dict[str, str] = {}
for _cat, _url in TLE_URLS.items():
    _fb = _url.replace("gp.php?GROUP=", "").replace("&FORMAT=tle", ".txt")
    TLE_FALLBACK[_cat] = _fb

ALLOWED_CATEGORIES = set(TLE_URLS.keys())

# Hardcoded fallback TLE for 80+ essential satellites from all nations
FALLBACK_TLE = """ISS (ZARYA)
1 25544U 98067A   25060.50000000  .00016717  00000-0  10270-3 0  9001
2 25544  51.6400 208.0000 0007417  35.5000 324.5000 15.49560000400001
CSS (TIANHE)
1 48274U 21035A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 48274  41.4700 280.0000 0003200  30.0000 330.0000 15.62000000400001
HUBBLE
1 20580U 90037B   25060.50000000  .00000800  00000-0  40000-4 0  9001
2 20580  28.4700  50.0000 0002700  80.0000 280.0000 15.09200000400001
NOAA 20 (JPSS-1)
1 43013U 17073A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 43013  98.7400 100.0000 0001500 110.0000 250.0000 14.19500000400001
NOAA 19
1 33591U 09005A   25060.50000000  .00000080  00000-0  60000-4 0  9001
2 33591  99.1900   5.0000 0014000 120.0000 240.0000 14.12400000400001
NOAA 18
1 28654U 05018A   25060.50000000  .00000050  00000-0  40000-4 0  9001
2 28654  98.7300  70.0000 0014000 150.0000 210.0000 14.11500000400001
TERRA
1 25994U 99068A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 25994  98.2100  95.0000 0001200 105.0000 255.0000 14.57100000400001
AQUA
1 27424U 02022A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 27424  98.2100  95.0000 0001300 100.0000 260.0000 14.57100000400001
AURA
1 28376U 04026A   25060.50000000  .00000080  00000-0  50000-4 0  9001
2 28376  98.2100  90.0000 0001500  95.0000 265.0000 14.57100000400001
LANDSAT 9
1 49260U 21088A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 49260  98.2200  50.0000 0001400  90.0000 270.0000 14.57100000400001
LANDSAT 8
1 39084U 13008A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 39084  98.2100  55.0000 0001300  92.0000 268.0000 14.57100000400001
SUOMI NPP
1 37849U 11061A   25060.50000000  .00000090  00000-0  50000-4 0  9001
2 37849  98.7300  95.0000 0001500 110.0000 250.0000 14.19400000400001
GOES 16
1 41866U 16071A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 41866   0.0400 270.0000 0001000  10.0000 350.0000  1.00270000400001
GOES 18
1 51850U 22021A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 51850   0.0300 265.0000 0001200   8.0000 352.0000  1.00270000400001
METEOSAT 11
1 40732U 15034A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 40732   0.0500   5.0000 0001500  15.0000 345.0000  1.00270000400001
GPS BIIR-2 (PRN 13)
1 24876U 97035A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 24876  55.7200 200.0000 0040000 250.0000 110.0000  2.00560000400001
GPS BIIF-12 (PRN 09)
1 41019U 15062A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 41019  55.0000 140.0000 0020000 200.0000 160.0000  2.00560000400001
GPS III-1 (PRN 04)
1 43873U 18109A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 43873  55.0500 170.0000 0010000 180.0000 180.0000  2.00560000400001
GLONASS-M 743
1 40001U 14032A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 40001  64.9000 300.0000 0010000  45.0000 315.0000  2.13100000400001
GLONASS-K1 802
1 41330U 16008A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 41330  64.8000 340.0000 0015000  50.0000 310.0000  2.13100000400001
BEIDOU-3 M1
1 43001U 17069A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 43001  55.0000 240.0000 0005000 260.0000 100.0000  1.86230000400001
BEIDOU-3 M17
1 44204U 19023A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 44204  55.1000 280.0000 0005000 240.0000 120.0000  1.86230000400001
BEIDOU-3 IGSO-1
1 43539U 18062A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 43539  55.0000 120.0000 0750000 270.0000  80.0000  1.00270000400001
GALILEO-FM10 (E15)
1 40890U 15045A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 40890  56.1000 200.0000 0003000 300.0000  60.0000  1.70470000400001
GALILEO-FM22 (E30)
1 43564U 18060D   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 43564  56.0000 160.0000 0003500 280.0000  80.0000  1.70470000400001
IRNSS-1A (NAVIC)
1 39199U 13034A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 39199  27.0000  40.0000 0020000  10.0000 350.0000  1.00270000400001
IRNSS-1B (NAVIC)
1 39635U 14012A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 39635  31.0000  65.0000 0020000 350.0000  10.0000  1.00270000400001
QZSS-1 (MICHIBIKI)
1 37158U 10045A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 37158  41.0000 135.0000 0750000 270.0000  80.0000  1.00270000400001
STARLINK-1007
1 44713U 19074A   25060.50000000  .00010000  00000-0  70000-4 0  9001
2 44713  53.0500 150.0000 0001400  90.0000 270.0000 15.05500000400001
STARLINK-1130
1 44914U 20006B   25060.50000000  .00010000  00000-0  70000-4 0  9001
2 44914  53.0000 200.0000 0001500  80.0000 280.0000 15.05500000400001
STARLINK-2305
1 48050U 21024A   25060.50000000  .00010000  00000-0  70000-4 0  9001
2 48050  53.0500 100.0000 0001300 120.0000 240.0000 15.05500000400001
STARLINK-30001 (V2 MINI)
1 55650U 23028A   25060.50000000  .00012000  00000-0  80000-4 0  9001
2 55650  43.0000 250.0000 0001400  70.0000 290.0000 15.05500000400001
ONEWEB-0012
1 44057U 19010A   25060.50000000  .00002000  00000-0  30000-4 0  9001
2 44057  87.9000 300.0000 0002000  60.0000 300.0000 13.15000000400001
ONEWEB-0320
1 48838U 21049A   25060.50000000  .00002000  00000-0  30000-4 0  9001
2 48838  87.9000  50.0000 0002000  80.0000 280.0000 13.15000000400001
IRIDIUM 106
1 42803U 17039A   25060.50000000  .00000100  00000-0  30000-4 0  9001
2 42803  86.4000  70.0000 0002000 100.0000 260.0000 14.34200000400001
IRIDIUM 148
1 43571U 18061D   25060.50000000  .00000100  00000-0  30000-4 0  9001
2 43571  86.4000 130.0000 0002000  90.0000 270.0000 14.34200000400001
GLOBALSTAR FM15
1 25163U 98008C   25060.50000000  .00000200  00000-0  25000-4 0  9001
2 25163  52.0000 180.0000 0010000 140.0000 220.0000 12.62000000400001
ORBCOMM FM116
1 41183U 15078A   25060.50000000  .00000200  00000-0  25000-4 0  9001
2 41183  47.0000 220.0000 0010000 160.0000 200.0000 14.32000000400001
COSMOS 2542 (INSPECTOR)
1 44797U 19079A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 44797  65.0000 300.0000 0012000  45.0000 315.0000 14.50000000400001
COSMOS 2558
1 53328U 22089A   25060.50000000  .00000200  00000-0  16000-4 0  9001
2 53328  97.3000  90.0000 0008000  80.0000 280.0000 15.20000000400001
COSMOS 2560
1 54500U 22167A   25060.50000000  .00000200  00000-0  16000-4 0  9001
2 54500  97.5000 100.0000 0007000  70.0000 290.0000 15.18000000400001
USA 326 (NROL-87)
1 51582U 22009A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 51582  97.4000  60.0000 0010000  85.0000 275.0000 15.18000000400001
USA 338 (NROL-68)
1 56110U 23054A   25060.50000000  .00000100  00000-0  12000-4 0  9001
2 56110  63.4000 320.0000 0600000 270.0000  80.0000  2.00560000400001
USA 314 (KH-11)
1 49943U 21117A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 49943  97.4000  50.0000 0001500  80.0000 280.0000 15.18000000400001
YAOGAN 30D
1 43613U 18071D   25060.50000000  .00000400  00000-0  20000-4 0  9001
2 43613  35.0000 250.0000 0015000  60.0000 300.0000 14.95000000400001
YAOGAN 35A
1 51838U 22024A   25060.50000000  .00000300  00000-0  18000-4 0  9001
2 51838  35.0000 240.0000 0010000  55.0000 305.0000 14.95000000400001
YAOGAN 39
1 57690U 23136A   25060.50000000  .00000300  00000-0  18000-4 0  9001
2 57690  63.4000 160.0000 0100000  90.0000 270.0000 13.40000000400001
GAOFEN 11-03
1 52256U 22042A   25060.50000000  .00000300  00000-0  18000-4 0  9001
2 52256  97.4000  70.0000 0008000  75.0000 285.0000 15.18000000400001
JILIN-1 01
1 40892U 15046A   25060.50000000  .00000400  00000-0  20000-4 0  9001
2 40892  97.5000  80.0000 0010000  85.0000 275.0000 15.10000000400001
FENGYUN 4A
1 41882U 16073A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 41882   0.0500 105.0000 0001000  15.0000 345.0000  1.00270000400001
TIANLIAN I-05
1 49013U 21078A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 49013   1.0000  80.0000 0010000  20.0000 340.0000  1.00270000400001
CARTOSAT-3
1 44804U 19089A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 44804  97.4000  60.0000 0010000  85.0000 275.0000 14.85000000400001
RISAT-2BR1
1 44643U 19077A   25060.50000000  .00000300  00000-0  17000-4 0  9001
2 44643  36.9000 220.0000 0010000  70.0000 290.0000 15.05000000400001
GSAT-30 (INSAT-4F)
1 45026U 20002A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 45026   0.0500  83.0000 0001000  10.0000 350.0000  1.00270000400001
EOS-01 (RISAT-2BR2)
1 47168U 20089A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 47168  37.0000 230.0000 0010000  65.0000 295.0000 15.05000000400001
ASTROSAT
1 40930U 15052A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 40930   6.0000  30.0000 0010000  20.0000 340.0000 14.65000000400001
OCEANSAT-3 (EOS-06)
1 54361U 22158A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 54361  98.3000  85.0000 0001500 100.0000 260.0000 14.19400000400001
SENTINEL-2A
1 40697U 15028A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 40697  98.5700  80.0000 0001200 100.0000 260.0000 14.30800000400001
SENTINEL-2B
1 42063U 17013A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 42063  98.5700  85.0000 0001200  95.0000 265.0000 14.30800000400001
SENTINEL-1A
1 39634U 14016A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 39634  98.1800  75.0000 0001500  90.0000 270.0000 14.59200000400001
COPERNICUS SENTINEL-6A
1 46984U 20084A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 46984  66.0400 120.0000 0001200  80.0000 280.0000 12.81200000400001
METOP-C
1 43689U 18087A   25060.50000000  .00000080  00000-0  50000-4 0  9001
2 43689  98.7000  95.0000 0001500 115.0000 245.0000 14.21000000400001
ENVISAT
1 27386U 02009A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 27386  98.3000  80.0000 0001200  90.0000 270.0000 14.38000000400001
PLEIADES NEO 3
1 48905U 21044A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 48905  98.2000  50.0000 0001300  85.0000 275.0000 14.57000000400001
CSO-1 (COMPOSANTE SPATIALE)
1 43838U 18099A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 43838  97.5000  60.0000 0010000  80.0000 280.0000 15.18000000400001
CSO-2
1 50258U 21118A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 50258  97.9000  65.0000 0010000  75.0000 285.0000 14.50000000400001
SPOT 7
1 40053U 14020A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 40053  98.2000  55.0000 0001500  80.0000 280.0000 14.57000000400001
SAR-LUPE 5
1 32764U 08010A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 32764  98.2000  60.0000 0010000  85.0000 275.0000 14.95000000400001
SARAH-1
1 51520U 22002A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 51520  97.8000  55.0000 0010000  80.0000 280.0000 15.10000000400001
KOMPSAT-5
1 39227U 13042A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 39227  97.5000  50.0000 0015000  85.0000 275.0000 15.14000000400001
ANASIS-II (425SAT)
1 45918U 20043A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 45918   0.1000 128.0000 0001000  10.0000 350.0000  1.00270000400001
GOKTURK-2
1 39030U 13007A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 39030  97.9000  60.0000 0010000  85.0000 275.0000 14.95000000400001
TURKSAT 5A
1 47514U 21010A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 47514   0.1000  31.0000 0001000  10.0000 350.0000  1.00270000400001
OFEQ 16
1 47990U 21023A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 47990 142.0000 240.0000 0010000  80.0000 280.0000 15.18000000400001
EROS-C1
1 53098U 22076A   25060.50000000  .00000200  00000-0  15000-4 0  9001
2 53098  97.5000  55.0000 0010000  85.0000 275.0000 15.08000000400001
PLANET DOVE (FLOCK 4P-1)
1 46846U 20073A   25060.50000000  .00000400  00000-0  20000-4 0  9001
2 46846  97.5000 200.0000 0010000 100.0000 260.0000 15.18000000400001
PLANET DOVE (FLOCK 4V-24)
1 52769U 22057F   25060.50000000  .00000400  00000-0  20000-4 0  9001
2 52769  97.5000 190.0000 0010000  95.0000 265.0000 15.18000000400001
PLANET SKYSAT-19
1 47504U 21006T   25060.50000000  .00000300  00000-0  18000-4 0  9001
2 47504  97.5000 180.0000 0010000  90.0000 270.0000 14.97000000400001
SPIRE LEMUR-2-110
1 49397U 21079A   25060.50000000  .00000400  00000-0  20000-4 0  9001
2 49397  97.5000 170.0000 0010000  85.0000 275.0000 15.20000000400001
TDRS 13
1 44540U 19038A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 44540   0.1000 275.0000 0001000  10.0000 350.0000  1.00270000400001
ELEKTRO-L 3
1 47719U 21016A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 47719   0.1000  76.0000 0001000  10.0000 350.0000  1.00270000400001
HIMAWARI 9
1 41836U 16064A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 41836   0.0500 140.0000 0001000  10.0000 350.0000  1.00270000400001
ALOS-2 (DAICHI-2)
1 39766U 14029A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 39766  97.9000  50.0000 0001500  80.0000 280.0000 14.77000000400001
TELSTAR 18V (APSTAR 5C)
1 43611U 18070A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 43611   0.1000 138.0000 0001000  10.0000 350.0000  1.00270000400001
SES-17
1 50114U 21098A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 50114   0.1000 293.0000 0001000  10.0000 350.0000  1.00270000400001
INTELSAT 40e
1 53813U 22109A   25060.50000000  .00000010  00000-0  10000-4 0  9001
2 53813   0.1000 317.0000 0001000  10.0000 350.0000  1.00270000400001
PROGRESS MS-25
1 58310U 23198A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 58310  51.6400 210.0000 0005000  40.0000 320.0000 15.49500000400001
SOYUZ MS-26
1 60068U 24168A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 60068  51.6400 205.0000 0005000  35.0000 325.0000 15.49500000400001
CREW DRAGON ENDURANCE
1 60340U 24200A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 60340  51.6400 200.0000 0005000  30.0000 330.0000 15.49500000400001
SHENZHOU 19
1 61100U 24182A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 61100  41.4700 275.0000 0004000  25.0000 335.0000 15.62000000400001
WENTIAN (CSS MODULE)
1 53239U 22082A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 53239  41.4700 278.0000 0003500  28.0000 332.0000 15.62000000400001
MENGTIAN (CSS MODULE)
1 54216U 22143A   25060.50000000  .00020000  00000-0  23000-3 0  9001
2 54216  41.4700 279.0000 0003500  29.0000 331.0000 15.62000000400001
HAYABUSA2
1 40319U 14076A   25060.50000000  .00000050  00000-0  30000-4 0  9001
2 40319  10.0000 200.0000 0500000 180.0000 180.0000  0.70000000400001
AEOLUS (WIND LIDAR)
1 43600U 18066A   25060.50000000  .00000100  00000-0  20000-4 0  9001
2 43600  96.7000  90.0000 0001500 105.0000 255.0000 15.18000000400001"""


def _parse_tle(raw: str) -> list[dict]:
    lines = [l.strip() for l in raw.strip().splitlines() if l.strip()]
    sats = []
    i = 0
    while i + 2 < len(lines):
        name = lines[i]
        l1 = lines[i + 1]
        l2 = lines[i + 2]
        if l1.startswith("1 ") and l2.startswith("2 "):
            sats.append({
                "name": name,
                "line1": l1,
                "line2": l2,
                "noradId": l1[2:7].strip(),
            })
            i += 3
        else:
            i += 1
    return sats


# Category keywords for fallback filtering
_CAT_KEYWORDS: dict[str, list[str]] = {
    "weather": ["NOAA", "GOES", "METEOSAT", "METOP", "FENGYUN", "HIMAWARI", "ELEKTRO", "SUOMI", "JPSS"],
    "military": ["COSMOS", "USA ", "NROL", "YAOGAN", "GAOFEN", "OFEQ", "EROS", "CSO-", "SAR-LUPE", "SARAH", "GOKTURK", "ANASIS"],
    "stations": ["ISS", "CSS", "TIANHE", "WENTIAN", "MENGTIAN", "SHENZHOU", "SOYUZ", "PROGRESS", "CREW DRAGON"],
    "starlink": ["STARLINK"],
    "gps": ["GPS ", "NAVSTAR"],
    "glonass": ["GLONASS"],
    "galileo": ["GALILEO"],
    "beidou": ["BEIDOU"],
    "gnss": ["GPS ", "GLONASS", "GALILEO", "BEIDOU", "IRNSS", "NAVIC", "QZSS"],
    "science": ["HUBBLE", "ASTROSAT", "AURA", "TERRA", "AQUA", "HAYABUSA", "AEOLUS"],
    "resource": ["LANDSAT", "SENTINEL", "COPERNICUS", "OCEANSAT", "CARTOSAT", "RISAT", "EOS-", "SPOT", "PLEIADES"],
    "geo": ["GOES", "METEOSAT", "HIMAWARI", "FENGYUN 4", "ELEKTRO", "GSAT", "TURKSAT", "SES-", "INTELSAT", "TELSTAR", "TDRS", "TIANLIAN"],
    "iridium": ["IRIDIUM"],
    "oneweb": ["ONEWEB"],
    "globalstar": ["GLOBALSTAR"],
    "amateur": ["AMATEUR"],
    "cubesat": ["FLOCK", "LEMUR", "DOVE"],
    "planet": ["PLANET", "FLOCK", "SKYSAT", "DOVE"],
    "spire": ["SPIRE", "LEMUR"],
    "radar": ["RADARSAT", "SAR-LUPE", "SARAH", "RISAT", "COSMO"],
    "intelsat": ["INTELSAT"],
    "ses": ["SES-"],
    "telesat": ["TELESAT"],
    "tdrss": ["TDRS"],
    "sarsat": ["SARSAT"],
    "molniya": ["MOLNIYA"],
    "education": ["EDUCATION"],
    "engineering": ["ENGINEERING"],
    "geodetic": ["GEODETIC"],
    "visual": ["ISS", "CSS", "HUBBLE", "STARLINK"],
    "tle-new": ["STARLINK-30", "V2 MINI"],
    "debris": ["DEBRIS", "COSMOS 2251"],
    "noaa": ["NOAA"],
    "goes": ["GOES"],
}

def _filter_fallback_by_category(sats: list[dict], category: str) -> list[dict]:
    keywords = _CAT_KEYWORDS.get(category, [])
    if not keywords:
        return sats  # Unknown category — return all
    filtered = []
    for s in sats:
        name_upper = s["name"].upper()
        if any(kw in name_upper for kw in keywords):
            filtered.append(s)
    return filtered if filtered else sats  # If no matches, return all as fallback


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/tle")
async def get_tle(category: str = Query("active")):
    if category not in ALLOWED_CATEGORIES:
        return JSONResponse({"error": "Unknown category"}, status_code=400)

    key = f"tle_{category}"
    cached = _cache.get(key)
    if cached and time.time() - cached["ts"] < TLE_TTL:
        return JSONResponse(cached["data"])

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/plain, */*",
    }
    urls_to_try = [TLE_URLS[category], TLE_FALLBACK[category]]
    last_err = None
    for url in urls_to_try:
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
            sats = _parse_tle(resp.text)
            payload = {"satellites": sats, "count": len(sats), "category": category, "ts": time.time()}
            _cache[key] = {"data": payload, "ts": time.time()}
            return JSONResponse(payload)
        except Exception as exc:
            last_err = exc
            continue
    if cached:
        return JSONResponse(cached["data"])
    # Use hardcoded fallback TLE, filtered by category
    sats = _parse_tle(FALLBACK_TLE)
    if category != "active":
        sats = _filter_fallback_by_category(sats, category)
    payload = {"satellites": sats, "count": len(sats), "category": category, "ts": time.time(), "fallback": True}
    return JSONResponse(payload)


@app.get("/api/multi-tle")
async def get_multi_tle(categories: str = Query("stations,weather,gps,military,science,resource")):
    """Fetch multiple TLE categories at once, merge results."""
    cats = [c.strip() for c in categories.split(",") if c.strip() in ALLOWED_CATEGORIES]
    if not cats:
        return JSONResponse({"error": "No valid categories"}, status_code=400)

    all_sats = []
    seen = set()
    for cat in cats:
        key = f"tle_{cat}"
        cached = _cache.get(key)
        if cached and time.time() - cached["ts"] < TLE_TTL:
            for s in cached["data"].get("satellites", []):
                if s["noradId"] not in seen:
                    s["_cat"] = cat
                    all_sats.append(s)
                    seen.add(s["noradId"])
            continue
        urls_to_try = [TLE_URLS[cat], TLE_FALLBACK[cat]]
        for url in urls_to_try:
            try:
                async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                    resp = await client.get(url, headers=_HEADERS)
                    resp.raise_for_status()
                sats = _parse_tle(resp.text)
                payload = {"satellites": sats, "count": len(sats), "category": cat, "ts": time.time()}
                _cache[key] = {"data": payload, "ts": time.time()}
                for s in sats:
                    if s["noradId"] not in seen:
                        s["_cat"] = cat
                        all_sats.append(s)
                        seen.add(s["noradId"])
                break
            except Exception:
                continue
    if not all_sats:
        sats = _parse_tle(FALLBACK_TLE)
        for s in sats:
            s["_cat"] = "fallback"
        all_sats = sats
    return JSONResponse({
        "satellites": all_sats,
        "count": len(all_sats),
        "categories": cats,
        "ts": time.time(),
        "fallback": len(all_sats) > 0 and all_sats[0].get("_cat") == "fallback",
    })


@app.get("/api/quakes")
async def get_quakes():
    """Proxy USGS earthquake feed — free, no API key."""
    cached = _cache.get("quakes")
    if cached and time.time() - cached["ts"] < EVENT_TTL:
        return JSONResponse(cached["data"])
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
                headers=_HEADERS,
            )
            resp.raise_for_status()
        data = resp.json()
        features = []
        for f in data.get("features", [])[:200]:
            p = f.get("properties", {})
            g = f.get("geometry", {})
            coords = g.get("coordinates", [0, 0, 0])
            features.append({
                "id": f.get("id"),
                "mag": p.get("mag"),
                "place": p.get("place"),
                "time": p.get("time"),
                "lng": coords[0],
                "lat": coords[1],
                "depth": coords[2],
                "tsunami": p.get("tsunami"),
            })
        payload = {"quakes": features, "count": len(features), "ts": time.time()}
        _cache["quakes"] = {"data": payload, "ts": time.time()}
        return JSONResponse(payload)
    except Exception as exc:
        return JSONResponse({"quakes": [], "count": 0, "error": str(exc)})


@app.get("/api/events")
async def get_events():
    """Proxy NASA EONET natural events — free, no API key."""
    cached = _cache.get("events")
    if cached and time.time() - cached["ts"] < EVENT_TTL:
        return JSONResponse(cached["data"])
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=80",
                headers=_HEADERS,
            )
            resp.raise_for_status()
        data = resp.json()
        events = []
        for ev in data.get("events", []):
            geom = ev.get("geometry", [{}])
            coords = geom[-1].get("coordinates", [0, 0]) if geom else [0, 0]
            events.append({
                "id": ev.get("id"),
                "title": ev.get("title"),
                "categories": [c.get("title") for c in ev.get("categories", [])],
                "lng": coords[0],
                "lat": coords[1],
                "date": geom[-1].get("date") if geom else None,
            })
        payload = {"events": events, "count": len(events), "ts": time.time()}
        _cache["events"] = {"data": payload, "ts": time.time()}
        return JSONResponse(payload)
    except Exception as exc:
        return JSONResponse({"events": [], "count": 0, "error": str(exc)})


@app.get("/api/ships")
async def get_ships():
    """Return live AIS ship data from all sources."""
    ships = list(ship_registry.values())
    return JSONResponse({
        "ships": ships[-1000:],
        "count": len(ships),
        "sources": ship_source_status,
        "ts": time.time(),
    })

@app.get("/api/ship-status")
async def get_ship_status():
    return JSONResponse({
        "total": len(ship_registry),
        "sources": ship_source_status,
    })

@app.get("/api/stac-search")
async def stac_search(
    bbox: str = Query(...),
    limit: int = Query(5),
    max_cloud: int = Query(20),
):
    """Proxy Element84 Earth Search STAC for Sentinel-2 scenes. No API key needed."""
    try:
        parts = [float(x) for x in bbox.split(",")]
        if len(parts) != 4:
            return JSONResponse({"error": "bbox must be w,s,e,n"}, status_code=400)
    except ValueError:
        return JSONResponse({"error": "Invalid bbox"}, status_code=400)

    body = {
        "collections": ["sentinel-2-l2a"],
        "bbox": parts,
        "limit": min(limit, 10),
        "query": {
            "eo:cloud_cover": {"lte": max_cloud}
        },
        "fields": {
            "include": ["id", "properties.datetime", "properties.eo:cloud_cover",
                        "assets.visual", "assets.B04", "assets.B08", "assets.B03",
                        "assets.B02", "bbox", "geometry"],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://earth-search.aws.element84.com/v1/search",
                json=body,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
            resp.raise_for_status()
        return JSONResponse(resp.json())
    except Exception as exc:
        return JSONResponse({"error": str(exc), "features": []}, status_code=502)

@app.get("/api/satellites")
async def get_satellites(country: str = Query(None)):
    cached = _cache.get("satcat")
    if cached and time.time() - cached["ts"] < SATCAT_TTL:
        rows = cached["data"]
    else:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
                resp = await client.get(
                    "https://celestrak.org/pub/satcat.csv",
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "text/csv, */*",
                    },
                )
                resp.raise_for_status()
            rows = resp.text.split("\n")[1:]  # skip header
            _cache["satcat"] = {"data": rows, "ts": time.time()}
        except Exception:
            return JSONResponse({"error": "Failed to fetch SATCAT"}, status_code=502)

    satellites = []
    for row in rows:
        cols = row.split(",")
        if len(cols) < 13:
            continue
        name = cols[0].strip()
        noradId = cols[2].strip() if len(cols) > 2 else ""
        if not name or not noradId:
            continue
        satellites.append({
            "name": name,
            "noradId": noradId,
            "ownerCode": cols[5].strip() if len(cols) > 5 else "",
            "launchDate": cols[6].strip() if len(cols) > 6 else "",
            "apogee": cols[11].strip() if len(cols) > 11 else "",
            "perigee": cols[12].strip() if len(cols) > 12 else "",
        })

    if country:
        cu = country.upper()
        satellites = [s for s in satellites if s["ownerCode"] == cu or cu in s.get("ownerCode", "")]

    country_counts: dict[str, int] = {}
    for s in satellites:
        c = s.get("ownerCode") or "UNK"
        country_counts[c] = country_counts.get(c, 0) + 1

    return JSONResponse({
        "satellites": satellites[:500],
        "total": len(satellites),
        "countryCounts": country_counts,
    })


# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
static_dir = Path(__file__).parent / "static"
static_dir.mkdir(exist_ok=True)


@app.get("/")
async def root():
    return FileResponse(static_dir / "index.html")


app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# ---------------------------------------------------------------------------
# Entry-point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8008, reload=True)
