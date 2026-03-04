import json
import asyncio
import math
import pathlib
import requests
import time
import websockets
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import logging
from typing import List, Dict, Any
from datetime import datetime
from sgp4.api import Satrec, jday

# Configure logging
logger = logging.getLogger("uvicorn.error")

BASE_DIR = pathlib.Path(__file__).parent

# In-memory storage
ship_registry: Dict[str, Dict[str, Any]] = {}
ship_paths: Dict[str, List[Dict[str, float]]] = {}
MAX_PATH_LENGTH = 15

API_KEY = "8b9d8625829bd9614947be967c141babc5931e79"
AIS_STREAM_URL = "wss://stream.aisstream.io/v0/stream"

# Connected frontend clients with their own message queues to prevent race conditions
clients: Dict[WebSocket, asyncio.Queue] = {}

async def broadcast_to_clients(message: str):
    """Safely broadcast messages to all connected clients via their queues."""
    disconnected_clients = []
    for client, queue in clients.items():
        try:
            # If queue is too full, drop oldest messages to keep it live
            if queue.qsize() > 50:
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            await queue.put(message)
        except Exception:
            disconnected_clients.append(client)
    
    for client in disconnected_clients:
        if client in clients:
            del clients[client]

async def client_writer(websocket: WebSocket, queue: asyncio.Queue):
    """Background task to send messages from a client's queue."""
    try:
        while True:
            message = await queue.get()
            await websocket.send_text(message)
            queue.task_done()
    except Exception:
        pass
    finally:
        if websocket in clients:
            del clients[websocket]

def get_ship_type_label(type_id: int) -> str:
    """Map AIS ShipType ID to human-readable label."""
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

# Satellite tracking storage
satellite_registry: Dict[str, Dict[str, Any]] = {}

async def update_satellites():
    """Fetch TLE data and update satellite positions periodically."""
    # Major satellite catalogs from CelesTrak
    tle_urls = [
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=science&FORMAT=tle", # Science sats (Sentinel etc)
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle" # Space stations (ISS etc)
    ]
    
    tles = []
    for url in tle_urls:
        try:
            r = requests.get(url, timeout=10)
            if r.status_code == 200:
                tles.extend(r.text.strip().split("\n"))
        except Exception as e:
            logger.error(f"Error fetching TLE from {url}: {e}")
            
    satellites = []
    # Parse TLE into Satrec objects
    for i in range(0, len(tles) - 2, 3):
        name = tles[i].strip()
        line1 = tles[i+1].strip()
        line2 = tles[i+2].strip()
        try:
            sat = Satrec.twoline2rv(line1, line2)
            satellites.append({"name": name, "satrec": sat})
        except:
            continue

    print(f"DEBUG: Tracking {len(satellites)} satellites...")
    
    while True:
        try:
            now = datetime.utcnow()
            # Julian date for SGP4
            jd, fr = jday(now.year, now.month, now.day, now.hour, now.minute, now.second + now.microsecond/1e6)
            
            for sat_info in satellites:
                e, r, v = sat_info["satrec"].sgp4(jd, fr)
                if e == 0:
                    # Convert TEME to ECEF (simplified)
                    # For a more accurate conversion, use skyfield, but for visualization this is okay
                    # Approximation: 
                    import math
                    # This is a very rough TEME to Lat/Lon conversion
                    # For visualization in a "Satellite Intel" app, this is acceptable
                    gmst = sat_info["satrec"].gsto # Greenwich Sidereal Time approximation
                    
                    # More accurate Lat/Lon calculation from TEME (TEME -> Geodetic)
                    x, y, z = r
                    lon = math.atan2(y, x) - gmst
                    # Normalize lon to [-pi, pi]
                    lon = (lon + math.pi) % (2 * math.pi) - math.pi
                    
                    hyp = math.sqrt(x*x + y*y)
                    lat = math.atan2(z, hyp)
                    
                    lat_deg = math.degrees(lat)
                    lon_deg = math.degrees(lon)
                    alt_km = math.sqrt(x*x + y*y + z*z) - 6371 # Distance - Earth radius
                    
                    sat_id = sat_info["name"]
                    satellite_registry[sat_id] = {
                        "id": sat_id,
                        "name": sat_info["name"],
                        "type": "SATELLITE",
                        "lat": lat_deg,
                        "lon": lon_deg,
                        "alt": alt_km,
                        "last_update": now.isoformat()
                    }
                    
                    # Broadcast to clients
                    await broadcast_to_clients(json.dumps(satellite_registry[sat_id]))
            
            await asyncio.sleep(5) # Update satellite positions every 5s
        except Exception as e:
            logger.error(f"Satellite tracking error: {e}")
            await asyncio.sleep(30)

async def cleanup_registry():
    """Remove ships that haven't been updated for 30 minutes."""
    while True:
        try:
            if len(ship_registry) > 5000:
                # Remove oldest 1000 ships based on last_update
                sorted_keys = sorted(ship_registry.keys(), key=lambda k: ship_registry[k].get('last_update', ''))
                for k in sorted_keys[:1000]:
                    del ship_registry[k]
                    if k in ship_paths: del ship_paths[k]
            await asyncio.sleep(600)
        except Exception as e:
            logger.error(f"Cleanup error: {e}")
            await asyncio.sleep(60)

async def ais_stream_worker():
    """Connect to AISStream and broadcast to all connected clients."""
    print("DEBUG: Starting AISStream worker...")
    while True:
        try:
            print(f"DEBUG: Connecting to {AIS_STREAM_URL}...")
            # Increase open_timeout for slower connections
            async with websockets.connect(AIS_STREAM_URL, ping_interval=30, open_timeout=60) as websocket:
                # Subscribe with multiple optimized grids
                # Splitting the world into 8 zones for better stream reliability
                subscribe_msg = {
                    "APIKey": API_KEY,
                    "BoundingBoxes": [
                        [[-90, -180], [-45, -90]], [[-90, -90], [-45, 0]], [[-90, 0], [-45, 90]], [[-90, 90], [-45, 180]],
                        [[-45, -180], [0, -90]], [[-45, -90], [0, 0]], [[-45, 0], [0, 90]], [[-45, 90], [0, 180]],
                        [[0, -180], [45, -90]], [[0, -90], [45, 0]], [[0, 0], [45, 90]], [[0, 90], [45, 180]],
                        [[45, -180], [90, -90]], [[45, -90], [90, 0]], [[45, 0], [90, 90]], [[45, 90], [90, 180]]
                    ],
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
                }
                await websocket.send(json.dumps(subscribe_msg))
                print("DEBUG: Subscribed to AISStream successfully")

                async for message in websocket:
                    try:
                        msg_json = json.loads(message)
                        mmsi = str(msg_json.get("MetaData", {}).get("MMSI", ""))
                        if not mmsi: continue

                        msg_type = msg_json.get("MessageType")
                        
                        if mmsi not in ship_registry:
                            ship_registry[mmsi] = {
                                "mmsi": mmsi,
                                "name": "IDENTIFYING...",
                                "type": "Unknown Vessel",
                                "lat": 0.0,
                                "lon": 0.0,
                                "speed": 0.0,
                                "course": 0.0,
                                "last_update": "",
                                "path": []
                            }

                        if msg_type == "ShipStaticData":
                            static_data = msg_json["Message"]["ShipStaticData"]
                            ship_registry[mmsi]["name"] = static_data.get("Name", "IDENTIFIED").strip()
                            type_id = static_data.get("Type", 0)
                            ship_registry[mmsi]["type"] = get_ship_type_label(type_id)

                        elif msg_type == "PositionReport":
                            pos_report = msg_json["Message"]["PositionReport"]
                            lat = pos_report.get("Latitude", 0.0)
                            lon = pos_report.get("Longitude", 0.0)
                            speed = pos_report.get("Sog", 0.0)
                            course = pos_report.get("Cog", 0.0)
                            
                            ship_registry[mmsi].update({
                                "lat": lat,
                                "lon": lon,
                                "speed": speed,
                                "course": course,
                                "last_update": msg_json["MetaData"].get("time_utc", "")
                            })

                            if mmsi not in ship_paths:
                                ship_paths[mmsi] = []
                            
                            new_pos = {"lat": lat, "lon": lon}
                            # Only add to path if moved significantly
                            if not ship_paths[mmsi] or (abs(ship_paths[mmsi][-1]["lat"] - lat) > 0.0001 or abs(ship_paths[mmsi][-1]["lon"] - lon) > 0.0001):
                                ship_paths[mmsi].append(new_pos)
                                if len(ship_paths[mmsi]) > MAX_PATH_LENGTH:
                                    ship_paths[mmsi].pop(0)
                            
                            ship_registry[mmsi]["path"] = ship_paths[mmsi]

                            # Safely broadcast
                            await broadcast_to_clients(json.dumps(ship_registry[mmsi]))

                    except Exception as e:
                        logger.error(f"Error processing message: {e}")
                        continue

        except Exception as e:
            logger.error(f"AISStream connection error: {e}")
            await asyncio.sleep(5)

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(ais_stream_worker())
    asyncio.create_task(cleanup_registry())
    asyncio.create_task(update_satellites())
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    queue = asyncio.Queue()
    clients[websocket] = queue
    
    # Start the client writer task
    writer_task = asyncio.create_task(client_writer(websocket, queue))
    
    # Send recent ships from registry
    for mmsi in list(ship_registry.keys())[-200:]:
        await queue.put(json.dumps(ship_registry[mmsi]))
        
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in clients:
            del clients[websocket]
        writer_task.cancel()

app.mount("/", StaticFiles(directory=str(BASE_DIR / "static"), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
