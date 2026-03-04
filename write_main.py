"""Helper: writes main.py with the full multi-source implementation."""
import os

CODE = r'''"""
Global Ship & Satellite Tracker - Multi-Source Edition
Sources:
  * AISStream.io       - real-time global AIS WebSocket
  * BarentsWatch       - Norwegian Gov free REST (no key)
  * ShipXplorer.com    - best-effort public endpoint scraping
  * ShipInfo.net       - best-effort public endpoint scraping
  * AISHub             - community re-broadcast (no key tier)
  * CelesTrak          - extended satellite TLE tracking
"""

import json
import asyncio
import math
import logging
from datetime import datetime
from typing import Dict, List, Any

import httpx
import websockets
import requests
from sgp4.api import Satrec, jday

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
logger = logging.getLogger("uvicorn.error")

app = FastAPI(title="Global Ship Tracker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

ship_registry:      Dict[str, Dict[str, Any]] = {}
ship_paths:         Dict[str, List[Dict[str, float]]] = {}
satellite_registry: Dict[str, Dict[str, Any]] = {}
MAX_PATH_LENGTH = 15

API_KEY        = "8b9d8625829bd9614947be967c141babc5931e79"
AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream"

clients: Dict[WebSocket, asyncio.Queue] = {}

source_status: Dict[str, str] = {
    "aisstream":    "CONNECTING",
    "barentswatch": "IDLE",
    "shipxplorer":  "IDLE",
    "shipinfo":     "IDLE",
    "aishub":       "IDLE",
    "satellites":   "IDLE",
}


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

async def broadcast(message: str):
    dead = []
    for ws, q in clients.items():
        try:
            if q.qsize() > 80:
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await q.put(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.pop(ws, None)


async def broadcast_status():
    await broadcast(json.dumps({"type": "source_status", **source_status}))


async def _client_writer(ws: WebSocket, q: asyncio.Queue):
    try:
        while True:
            msg = await q.get()
            await ws.send_text(msg)
            q.task_done()
    except Exception:
        pass
    finally:
        clients.pop(ws, None)


def get_ship_type_label(type_id: int) -> str:
    if type_id == 30: return "Fishing"
    if 31 <= type_id <= 32: return "Tug / Tow"
    if 35 <= type_id <= 36: return "Military / Law Enforcement"
    if 40 <= type_id <= 49: return "High Speed Craft"
    if type_id == 52: return "Tug"
    if type_id == 55: return "Military / Law Enforcement"
    if 60 <= type_id <= 69: return "Passenger / Cruise"
    if 70 <= type_id <= 79: return "Cargo / Container"
    if 80 <= type_id <= 89: return "Tanker"
    if type_id == 50: return "Pilot Vessel"
    if type_id == 51: return "Search and Rescue"
    if type_id >= 90: return "Other / Special"
    return "Unknown Vessel"


def _upsert_ship(mmsi: str, lat: float, lon: float, speed: float = 0.0,
                 course: float = 0.0, name: str = "IDENTIFYING...",
                 ship_type: str = "Unknown Vessel",
                 timestamp: str = "", source: str = "unknown"):
    if mmsi not in ship_registry:
        ship_registry[mmsi] = {
            "mmsi": mmsi, "name": name, "type": ship_type,
            "lat": lat, "lon": lon, "speed": speed, "course": course,
            "last_update": timestamp, "path": [], "source": source,
        }
    else:
        rec = ship_registry[mmsi]
        rec.update({"lat": lat, "lon": lon, "speed": speed,
                    "course": course, "last_update": timestamp, "source": source})
        if name != "IDENTIFYING...":
            rec["name"] = name
        if ship_type != "Unknown Vessel":
            rec["type"] = ship_type

    if mmsi not in ship_paths:
        ship_paths[mmsi] = []
    pp = ship_paths[mmsi]
    if not pp or abs(pp[-1]["lat"] - lat) > 0.0001 or abs(pp[-1]["lon"] - lon) > 0.0001:
        pp.append({"lat": lat, "lon": lon})
        if len(pp) > MAX_PATH_LENGTH:
            pp.pop(0)
    ship_registry[mmsi]["path"] = pp
    return ship_registry[mmsi]


# ---------------------------------------------------------------------------
# SOURCE 1 – AISStream.io  (real-time global WebSocket, uses your API key)
# ---------------------------------------------------------------------------

async def aisstream_worker():
    logger.info("AISStream worker starting...")
    while True:
        try:
            async with websockets.connect(
                AIS_STREAM_URL, ping_interval=30, open_timeout=60
            ) as ws:
                subscribe_msg = {
                    "APIKey": API_KEY,
                    "BoundingBoxes": [
                        [[-90, -180], [-45, -90]], [[-90, -90], [-45, 0]],
                        [[-90, 0],   [-45,  90]], [[-90, 90],  [-45, 180]],
                        [[-45, -180], [0,  -90]], [[-45, -90], [0,    0]],
                        [[-45, 0],   [0,   90]], [[-45,  90], [0,   180]],
                        [[0, -180],  [45,  -90]], [[0,  -90], [45,    0]],
                        [[0, 0],     [45,   90]], [[0,   90], [45,  180]],
                        [[45, -180], [90,  -90]], [[45, -90], [90,    0]],
                        [[45, 0],    [90,   90]], [[45,  90], [90,  180]],
                    ],
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }
                await ws.send(json.dumps(subscribe_msg))
                source_status["aisstream"] = "LIVE"
                await broadcast_status()
                logger.info("AISStream connected & subscribed")

                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                        mmsi = str(msg.get("MetaData", {}).get("MMSI", ""))
                        if not mmsi:
                            continue
                        msg_type = msg.get("MessageType")
                        ts = msg.get("MetaData", {}).get(
                            "time_utc", datetime.utcnow().isoformat()
                        )
                        if msg_type == "ShipStaticData":
                            sd = msg["Message"]["ShipStaticData"]
                            if mmsi in ship_registry:
                                ship_registry[mmsi]["name"] = (
                                    sd.get("Name", "").strip()
                                    or ship_registry[mmsi]["name"]
                                )
                                ship_registry[mmsi]["type"] = get_ship_type_label(
                                    sd.get("Type", 0)
                                )
                        elif msg_type == "PositionReport":
                            pr = msg["Message"]["PositionReport"]
                            rec = _upsert_ship(
                                mmsi,
                                pr.get("Latitude", 0.0),
                                pr.get("Longitude", 0.0),
                                pr.get("Sog", 0.0),
                                pr.get("Cog", 0.0),
                                timestamp=ts,
                                source="AISStream",
                            )
                            await broadcast(json.dumps(rec))
                    except Exception as e:
                        logger.debug(f"AISStream parse: {e}")

        except Exception as e:
            source_status["aisstream"] = "RECONNECTING"
            logger.warning(f"AISStream error: {e}")
            await asyncio.sleep(5)


# ---------------------------------------------------------------------------
# SOURCE 2 – BarentsWatch  (Norwegian Government open AIS, no key)
# ---------------------------------------------------------------------------

BARENTSWATCH_URL = "https://live.ais.barentswatch.no/v1/latest/combined"


async def barentswatch_worker():
    logger.info("BarentsWatch worker starting...")
    async with httpx.AsyncClient(
        timeout=30,
        headers={
            "Accept": "application/json",
            "User-Agent": "ShipTracker/2.0 (educational; open data)",
        },
    ) as client:
        while True:
            try:
                r = await client.get(BARENTSWATCH_URL)
                if r.status_code == 200:
                    ships = r.json()
                    count = 0
                    for s in ships:
                        mmsi = str(s.get("mmsi", ""))
                        lat  = s.get("lat") or s.get("latitude")
                        lon  = s.get("lon") or s.get("longitude")
                        if not mmsi or lat is None or lon is None:
                            continue
                        rec = _upsert_ship(
                            mmsi, float(lat), float(lon),
                            float(s.get("speedOverGround", 0.0)),
                            float(s.get("courseOverGround", 0.0)),
                            name=(s.get("name") or "IDENTIFYING...").strip(),
                            ship_type=get_ship_type_label(int(s.get("shipType", 0))),
                            timestamp=datetime.utcnow().isoformat(),
                            source="BarentsWatch/NO",
                        )
                        await broadcast(json.dumps(rec))
                        count += 1
                    source_status["barentswatch"] = f"LIVE ({count})"
                    await broadcast_status()
                    logger.info(f"BarentsWatch: {count} ships")
                else:
                    source_status["barentswatch"] = f"HTTP {r.status_code}"
            except Exception as e:
                source_status["barentswatch"] = "ERROR"
                logger.warning(f"BarentsWatch error: {e}")
            await asyncio.sleep(45)


# ---------------------------------------------------------------------------
# SOURCE 4 – ShipXplorer.com  (public endpoint scraping)
# ---------------------------------------------------------------------------

SX_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Referer": "https://www.shipxplorer.com/",
    "X-Requested-With": "XMLHttpRequest",
}

SX_ENDPOINTS = [
    "https://www.shipxplorer.com/api/vi/signals/newest?limit=500",
    "https://www.shipxplorer.com/api/vi/signals/cluster?zoom=3&lat=0&lon=0",
    "https://www.shipxplorer.com/js/shipmapdata.json",
    "https://www.shipxplorer.com/map/data?zoom=2&lat=0&lon=0",
]


async def shipxplorer_worker():
    logger.info("ShipXplorer worker starting...")
    async with httpx.AsyncClient(
        timeout=20, headers=SX_HEADERS, follow_redirects=True
    ) as client:
        while True:
            found = False
            for url in SX_ENDPOINTS:
                try:
                    r = await client.get(url)
                    if r.status_code != 200:
                        continue
                    try:
                        data = r.json()
                    except Exception:
                        continue
                    items = (
                        data
                        if isinstance(data, list)
                        else (
                            data.get("ships")
                            or data.get("data")
                            or data.get("vessels")
                            or data.get("results")
                            or []
                        )
                    )
                    count = 0
                    for item in items:
                        mmsi = str(item.get("mmsi") or item.get("MMSI") or "")
                        lat  = item.get("lat") or item.get("latitude") or item.get("LAT")
                        lon  = item.get("lon") or item.get("longitude") or item.get("LON")
                        if not mmsi or lat is None or lon is None:
                            continue
                        try:
                            lat, lon = float(lat), float(lon)
                            if lat == 0.0 and lon == 0.0:
                                continue
                            rec = _upsert_ship(
                                mmsi, lat, lon,
                                float(item.get("speed") or item.get("sog") or 0.0),
                                float(item.get("course") or item.get("cog") or 0.0),
                                name=str(
                                    item.get("name") or item.get("NAME") or "IDENTIFYING..."
                                ).strip(),
                                timestamp=datetime.utcnow().isoformat(),
                                source="ShipXplorer",
                            )
                            await broadcast(json.dumps(rec))
                            count += 1
                        except Exception:
                            pass
                    if count:
                        source_status["shipxplorer"] = f"LIVE ({count})"
                        await broadcast_status()
                        logger.info(f"ShipXplorer: {count} ships from {url}")
                        found = True
                        break
                except Exception as e:
                    logger.debug(f"ShipXplorer {url}: {e}")
            if not found:
                source_status["shipxplorer"] = "NO DATA"
            await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# SOURCE 5 – ShipInfo.net  (public endpoint scraping)
# ---------------------------------------------------------------------------

SI_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Referer": "https://shipinfo.net/",
}

SI_ENDPOINTS = [
    "https://shipinfo.net/api/v1/ships/positions?limit=500",
    "https://shipinfo.net/api/vessels?format=json&limit=500",
    "https://shipinfo.net/map/data",
    "https://shipinfo.net/ais/data?zoom=3&lat=0&lon=0",
    "https://www.shipinfo.net/api/v1/vessels?limit=500",
]


async def shipinfo_worker():
    logger.info("ShipInfo worker starting...")
    async with httpx.AsyncClient(
        timeout=20, headers=SI_HEADERS, follow_redirects=True
    ) as client:
        while True:
            found = False
            for url in SI_ENDPOINTS:
                try:
                    r = await client.get(url)
                    if r.status_code != 200:
                        continue
                    try:
                        data = r.json()
                    except Exception:
                        continue
                    items = (
                        data
                        if isinstance(data, list)
                        else (
                            data.get("ships")
                            or data.get("data")
                            or data.get("vessels")
                            or data.get("results")
                            or []
                        )
                    )
                    count = 0
                    for item in items:
                        mmsi = str(item.get("mmsi") or item.get("MMSI") or "")
                        lat  = item.get("lat") or item.get("latitude")
                        lon  = item.get("lon") or item.get("longitude")
                        if not mmsi or lat is None or lon is None:
                            continue
                        try:
                            rec = _upsert_ship(
                                mmsi, float(lat), float(lon),
                                float(item.get("speed") or item.get("sog") or 0.0),
                                float(item.get("course") or item.get("cog") or 0.0),
                                name=str(
                                    item.get("name") or item.get("shipName") or "IDENTIFYING..."
                                ).strip(),
                                timestamp=datetime.utcnow().isoformat(),
                                source="ShipInfo",
                            )
                            await broadcast(json.dumps(rec))
                            count += 1
                        except Exception:
                            pass
                    if count:
                        source_status["shipinfo"] = f"LIVE ({count})"
                        await broadcast_status()
                        logger.info(f"ShipInfo: {count} ships")
                        found = True
                        break
                except Exception as e:
                    logger.debug(f"ShipInfo {url}: {e}")
            if not found:
                source_status["shipinfo"] = "NO DATA"
            await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# SOURCE 6 – AISHub community network  (free tier, no key needed for read)
# ---------------------------------------------------------------------------

AISHUB_URL = (
    "https://data.aishub.net/ws.php"
    "?username=AH_3868855"
    "&format=1&output=json&compress=0"
    "&latmin=-90&latmax=90&lonmin=-180&lonmax=180"
)


async def aishub_worker():
    logger.info("AISHub worker starting...")
    async with httpx.AsyncClient(
        timeout=30,
        headers={"User-Agent": "ShipTracker/2.0", "Accept": "application/json"},
    ) as client:
        while True:
            try:
                r = await client.get(AISHUB_URL)
                if r.status_code == 200:
                    payload = r.json()
                    ships = []
                    if (
                        isinstance(payload, list)
                        and len(payload) >= 2
                        and isinstance(payload[1], list)
                        and not payload[0].get("ERROR", True)
                    ):
                        ships = payload[1]
                    count = 0
                    for s in ships:
                        mmsi = str(s.get("MMSI", ""))
                        lat  = s.get("LATITUDE")
                        lon  = s.get("LONGITUDE")
                        if not mmsi or lat is None or lon is None:
                            continue
                        try:
                            rec = _upsert_ship(
                                mmsi, float(lat), float(lon),
                                float(s.get("SOG", 0.0)),
                                float(s.get("COG", 0.0)),
                                name=str(s.get("NAME", "IDENTIFYING...")).strip(),
                                ship_type=get_ship_type_label(int(s.get("SHIPTYPE", 0))),
                                timestamp=datetime.utcnow().isoformat(),
                                source="AISHub",
                            )
                            await broadcast(json.dumps(rec))
                            count += 1
                        except Exception:
                            pass
                    source_status["aishub"] = f"LIVE ({count})" if count else "NO DATA"
                    await broadcast_status()
                    logger.info(f"AISHub: {count} ships")
                else:
                    source_status["aishub"] = f"HTTP {r.status_code}"
            except Exception as e:
                source_status["aishub"] = "ERROR"
                logger.warning(f"AISHub error: {e}")
            await asyncio.sleep(60)


# ---------------------------------------------------------------------------
# SOURCE 7 – CelesTrak  (extended satellite TLE groups)
# ---------------------------------------------------------------------------

TLE_SOURCES = [
    ("stations", "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle"),
    ("science",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle"),
    ("weather",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=tle"),
    ("earthobs", "https://celestrak.org/NORAD/elements/gp.php?GROUP=earth-obs&FORMAT=tle"),
    ("amateur",  "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle"),
    ("gps",      "https://celestrak.org/NORAD/elements/gp.php?GROUP=gps-ops&FORMAT=tle"),
]


async def satellite_worker():
    logger.info("Satellite worker starting...")
    satellites: list = []

    def fetch_tles():
        nonlocal satellites
        all_lines: list = []
        for group, url in TLE_SOURCES:
            try:
                r = requests.get(url, timeout=15)
                if r.status_code == 200:
                    all_lines.extend(r.text.strip().splitlines())
            except Exception as e:
                logger.warning(f"TLE {group}: {e}")
        sats = []
        for i in range(0, len(all_lines) - 2, 3):
            name  = all_lines[i].strip()
            line1 = all_lines[i + 1].strip()
            line2 = all_lines[i + 2].strip()
            if not (line1.startswith("1 ") and line2.startswith("2 ")):
                continue
            try:
                sats.append({"name": name, "satrec": Satrec.twoline2rv(line1, line2)})
            except Exception:
                pass
        satellites = sats
        logger.info(f"Satellite: tracking {len(sats)} objects")

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, fetch_tles)
    source_status["satellites"] = f"LIVE ({len(satellites)})"
    await broadcast_status()

    counter = 0
    while True:
        try:
            now = datetime.utcnow()
            jd, fr = jday(
                now.year, now.month, now.day,
                now.hour, now.minute,
                now.second + now.microsecond / 1e6,
            )
            for sat in satellites:
                try:
                    e, r_vec, _ = sat["satrec"].sgp4(jd, fr)
                    if e != 0:
                        continue
                    x, y, z = r_vec
                    gmst    = sat["satrec"].gsto
                    lon_rad = math.atan2(y, x) - gmst
                    lon_rad = (lon_rad + math.pi) % (2 * math.pi) - math.pi
                    lat_rad = math.atan2(z, math.sqrt(x * x + y * y))
                    alt_km  = math.sqrt(x * x + y * y + z * z) - 6371.0
                    sat_id  = sat["name"]
                    satellite_registry[sat_id] = {
                        "id": sat_id, "name": sat_id, "type": "SATELLITE",
                        "lat": math.degrees(lat_rad),
                        "lon": math.degrees(lon_rad),
                        "alt": alt_km,
                        "last_update": now.isoformat(),
                        "source": "CelesTrak",
                    }
                    await broadcast(json.dumps(satellite_registry[sat_id]))
                except Exception:
                    pass
            await asyncio.sleep(5)
            counter += 1
            if counter >= 720:   # refresh TLEs every ~1 hour
                await loop.run_in_executor(None, fetch_tles)
                source_status["satellites"] = f"LIVE ({len(satellites)})"
                await broadcast_status()
                counter = 0
        except Exception as e:
            logger.error(f"Satellite error: {e}")
            await asyncio.sleep(30)


# ---------------------------------------------------------------------------
# Registry cleanup
# ---------------------------------------------------------------------------

async def cleanup_worker():
    while True:
        try:
            if len(ship_registry) > 8000:
                keys = sorted(
                    ship_registry,
                    key=lambda k: ship_registry[k].get("last_update", ""),
                )
                for k in keys[:2000]:
                    ship_registry.pop(k, None)
                    ship_paths.pop(k, None)
        except Exception as e:
            logger.error(f"Cleanup: {e}")
        await asyncio.sleep(300)


# ---------------------------------------------------------------------------
# FastAPI endpoints
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup():
    asyncio.create_task(aisstream_worker())
    asyncio.create_task(barentswatch_worker())
    asyncio.create_task(shipxplorer_worker())
    asyncio.create_task(shipinfo_worker())
    asyncio.create_task(aishub_worker())
    asyncio.create_task(satellite_worker())
    asyncio.create_task(cleanup_worker())
    logger.info("All 6 data-source workers started.")


@app.get("/api/status")
async def get_status():
    return {
        "ships":      len(ship_registry),
        "satellites": len(satellite_registry),
        "clients":    len(clients),
        "sources":    source_status,
    }


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    q = asyncio.Queue()
    clients[websocket] = q
    writer = asyncio.create_task(_client_writer(websocket, q))

    # Burst recent ships to new client
    for mmsi in list(ship_registry.keys())[-300:]:
        await q.put(json.dumps(ship_registry[mmsi]))
    await q.put(json.dumps({"type": "source_status", **source_status}))

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.pop(websocket, None)
        writer.cancel()


app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
'''

dest = os.path.join(os.path.dirname(__file__), "main.py")
with open(dest, "w", encoding="utf-8") as f:
    f.write(CODE.lstrip())
print(f"Wrote {len(CODE)} chars to {dest}")
