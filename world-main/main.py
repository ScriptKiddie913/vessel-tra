"""
WorldMonitor Local — FastAPI/Uvicorn geopolitical intelligence dashboard.
All data sourced from free, keyless public endpoints.
Run: uvicorn main:app --reload --port 8080
"""

import asyncio
import csv
import io
import json
import math
import os
import pathlib
import tempfile
import time
import xml.etree.ElementTree as ET
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

# ── Deployment environment detection ──────────────────────────────────────────
# VERCEL=1 is automatically set by the Vercel runtime; VERCEL_ENV is also set.
IS_VERCEL: bool = bool(os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"))
if IS_VERCEL:
    print("[Env] Running on Vercel — DB/ship-polling/AI-chat disabled")

# aiosqlite is only needed locally (SQLite ship DB). Guard the import so a
# build failure on Vercel (which never uses the DB) doesn't crash the whole app.
try:
    import aiosqlite
    _AIOSQLITE_OK = True
except ImportError:
    aiosqlite = None  # type: ignore[assignment]
    _AIOSQLITE_OK = False

from static_data import (
    NUCLEAR_FACILITIES,
    STRATEGIC_WATERWAYS,
    APT_GROUPS,
    CONFLICT_ZONES,
    INTEL_HOTSPOTS,
    MILITARY_BASES,
    GAMMA_IRRADIATORS,
    PORTS,
    PIPELINES,
)

import httpx
from fastapi import FastAPI, HTTPException, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ──────────────────────────────────────────────────────────────
# │ SQLite Ship Database
# │ File:  ships.db (auto-created next to main.py)
# │ Table: vessels — one row per MMSI, updated in-place every poll cycle
# ──────────────────────────────────────────────────────────────
_WM_DATA_DIR = pathlib.Path(os.environ.get("APPDATA", tempfile.gettempdir())) / "worldmonitor"
_WM_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = str(_WM_DATA_DIR / "ships.db")

_CREATE_VESSELS_SQL = """
CREATE TABLE IF NOT EXISTS vessels (
    mmsi        TEXT PRIMARY KEY,
    name        TEXT,
    lat         REAL,
    lon         REAL,
    cog         REAL,
    sog         REAL,
    heading     REAL,
    type        INTEGER,
    type_name   TEXT,
    category    TEXT,
    navstat     TEXT,
    imo         TEXT,
    callsign    TEXT,
    dest        TEXT,
    draught     REAL,
    flag        TEXT,
    source      TEXT,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_vessels_lat_lon ON vessels(lat, lon);
CREATE INDEX IF NOT EXISTS idx_vessels_updated ON vessels(updated_at);
"""

# Shared DB connection (opened at startup, closed at shutdown)
_db: Optional[Any] = None  # aiosqlite.Connection when open, None otherwise

# Stats updated by the background poller
_ship_poll_stats: Dict[str, Any] = {
    "last_poll": None,
    "last_count": 0,
    "last_source": "none",
    "poll_errors": [],
    "total_polls": 0,
}


async def _db_init() -> None:
    """Open SQLite connection and create schema."""
    global _db
    if not _AIOSQLITE_OK:
        print("[ShipDB] aiosqlite not available — ship DB disabled")
        return
    _db = await aiosqlite.connect(DB_PATH, check_same_thread=False)
    await _db.executescript(_CREATE_VESSELS_SQL)
    await _db.commit()
    print(f"[ShipDB] Opened {DB_PATH}")


async def _db_upsert_vessels(vessels: list, source: str) -> int:
    """Upsert a list of normalised vessel dicts into the DB. Returns count upserted."""
    if not vessels or _db is None:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        (
            str(v["mmsi"]),
            v.get("name", ""),
            v["lat"],
            v["lon"],
            v.get("cog"),
            v.get("sog"),
            v.get("heading"),
            v.get("type", 0),
            v.get("type_name", ""),
            v.get("category", "other"),
            v.get("navstat", ""),
            str(v.get("imo") or ""),
            v.get("callsign", ""),
            v.get("dest", ""),
            v.get("draught"),
            v.get("flag", ""),
            source,
            now,
        )
        for v in vessels
        if v.get("lat") is not None and v.get("lon") is not None
    ]
    await _db.executemany(
        """
        INSERT INTO vessels
            (mmsi,name,lat,lon,cog,sog,heading,type,type_name,category,navstat,
             imo,callsign,dest,draught,flag,source,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(mmsi) DO UPDATE SET
            name=excluded.name, lat=excluded.lat, lon=excluded.lon,
            cog=excluded.cog, sog=excluded.sog, heading=excluded.heading,
            type=excluded.type, type_name=excluded.type_name,
            category=excluded.category, navstat=excluded.navstat,
            imo=excluded.imo, callsign=excluded.callsign,
            dest=excluded.dest, draught=excluded.draught,
            flag=excluded.flag, source=excluded.source, updated_at=excluded.updated_at
        """,
        rows,
    )
    await _db.commit()
    return len(rows)


async def _db_query_vessels(
    latmin: float, latmax: float, lonmin: float, lonmax: float, limit: int = 3000
) -> list:
    """Query vessels from DB within bbox, stale entries (>10 min) excluded."""
    if _db is None:
        return []
    cutoff = datetime.now(timezone.utc).isoformat()  # always compare as ISO string
    # Exclude vessels not updated in last 10 minutes
    async with _db.execute(
        """
        SELECT mmsi,name,lat,lon,cog,sog,heading,type,type_name,category,navstat,
               imo,callsign,dest,draught,flag,source,updated_at
        FROM vessels
        WHERE lat BETWEEN ? AND ?
          AND lon BETWEEN ? AND ?
          AND updated_at >= datetime('now', '-10 minutes')
        ORDER BY COALESCE(sog, 0) DESC
        LIMIT ?
        """,
        (latmin, latmax, lonmin, lonmax, limit),
    ) as cur:
        rows = await cur.fetchall()
    cols = ("mmsi","name","lat","lon","cog","sog","heading","type","type_name",
            "category","navstat","imo","callsign","dest","draught","flag","source","updated_at")
    return [dict(zip(cols, r)) for r in rows]


async def _db_total_count() -> int:
    """Return total live vessel count (updated in last 10 min)."""
    if _db is None:
        return 0
    async with _db.execute(
        "SELECT COUNT(*) FROM vessels WHERE updated_at >= datetime('now', '-10 minutes')"
    ) as cur:
        row = await cur.fetchone()
    return row[0] if row else 0


# ──────────────────────────────────────────────────────────────
# Background ship poller — runs every 45 s, fetches global AIS, upserts to DB
# ──────────────────────────────────────────────────────────────
SHIP_POLL_INTERVAL = 45   # seconds between global fetches


async def _ship_background_poller() -> None:
    """Infinite loop: fetch all live AIS every SHIP_POLL_INTERVAL seconds."""
    print("[ShipPoller] Background poller started")
    await asyncio.sleep(2)   # let server finish booting before first fetch
    while True:
        t0 = time.monotonic()
        vessels: list = []
        source = "none"
        errors: list = []

        # Try Digitraffic first (global, no key, ~15k ships)
        try:
            vessels = await _ships_digitraffic(-90, 90, -180, 180)
            if vessels:
                source = "Digitraffic"
        except Exception as e:
            errors.append(f"Digitraffic: {e}")

        # Norwegian EEZ via Kystverket TCP
        if not vessels:
            try:
                vessels = await _ships_kystverket_tcp(-90, 90, -180, 180, read_secs=8.0)
                if vessels:
                    source = "Kystverket/TCP"
            except Exception as e:
                errors.append(f"Kystverket: {e}")

        # aisstream.io WebSocket (global key built-in)
        if not vessels:
            try:
                vessels = await _ships_aisstream(-90, 90, -180, 180, read_secs=9.0)
                if vessels:
                    source = "aisstream.io"
            except Exception as e:
                errors.append(f"aisstream.io: {e}")

        if vessels:
            n = await _db_upsert_vessels(vessels, source)
            _ship_poll_stats["last_count"] = n
            _ship_poll_stats["last_source"] = source
            _ship_poll_stats["poll_errors"] = []
            print(f"[ShipPoller] Upserted {n} vessels from {source} in {time.monotonic()-t0:.1f}s")
        else:
            _ship_poll_stats["poll_errors"] = errors
            print(f"[ShipPoller] No vessels fetched. Errors: {errors}")

        _ship_poll_stats["last_poll"] = datetime.now(timezone.utc).isoformat()
        _ship_poll_stats["total_polls"] = _ship_poll_stats["total_polls"] + 1

        elapsed = time.monotonic() - t0
        await asyncio.sleep(max(SHIP_POLL_INTERVAL - elapsed, 5))


# ──────────────────────────────────────────────────────────────
# App bootstrap (lifespan handles startup + shutdown cleanly)
# ──────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── startup ──
    if IS_VERCEL:
        # Vercel serverless: skip SQLite and background poller entirely
        print("[Startup] Vercel mode — skipping DB and ship poller")
        yield
        return
    await _db_init()
    poller = asyncio.create_task(_ship_background_poller())
    aviation_poller = asyncio.create_task(_aviation_background_poller())
    print("[Startup] Ship and Aviation background pollers running")
    yield
    # ── shutdown ──
    poller.cancel()
    aviation_poller.cancel()
    try:
        await asyncio.gather(poller, aviation_poller, return_exceptions=True)
    except asyncio.CancelledError:
        pass
    if _db:
        await _db.close()
    print("[Shutdown] DB closed")


app = FastAPI(title="WorldMonitor Local", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory TTL cache: {key: {"data": ..., "expires": timestamp}}
_cache: Dict[str, Dict[str, Any]] = {}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (WorldMonitor-Local/1.0; +https://github.com/worldmonitor)",
    "Accept": "application/json, text/html, */*",
}


def cache_get(key: str) -> Optional[Any]:
    entry = _cache.get(key)
    if entry and entry["expires"] > time.time():
        return entry["data"]
    return None


def cache_set(key: str, data: Any, ttl: int = 300) -> None:
    _cache[key] = {"data": data, "expires": time.time() + ttl}


async def fetch_json(url: str, ttl: int = 300, timeout: float = 10.0, extra_headers: dict | None = None) -> Any:
    cached = cache_get(url)
    if cached is not None:
        return cached
    merged = {**HEADERS, **(extra_headers or {})}
    async with httpx.AsyncClient(headers=merged, follow_redirects=True, timeout=timeout) as client:
        r = await client.get(url)
        r.raise_for_status()
        data = r.json()
    cache_set(url, data, ttl)
    return data


async def fetch_text(url: str, ttl: int = 300, timeout: float = 10.0) -> str:
    cached = cache_get(url)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=timeout) as client:
        r = await client.get(url)
        r.raise_for_status()
        text = r.text
    cache_set(url, text, ttl)
    return text


# ──────────────────────────────────────────────────────────────
# Health
# ──────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/api/env")
async def env_info():
    """Returns deployment environment flags — used by the frontend to adapt UI."""
    return {
        "vercel": IS_VERCEL,
        "ai_enabled": not IS_VERCEL,
        "ships_enabled": not IS_VERCEL,
        "deployment": "vercel" if IS_VERCEL else "local",
    }


# ──────────────────────────────────────────────────────────────
# 1. EARTHQUAKES — USGS GeoJSON
# ──────────────────────────────────────────────────────────────
@app.get("/api/earthquakes")
async def earthquakes(window: str = "day"):
    """
    window: hour | day | week
    Returns GeoJSON FeatureCollection of M4.5+ earthquakes.
    """
    urls = {
        "hour": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
        "day":  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
        "week": "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
    }
    url = urls.get(window, urls["day"])
    print(f"Fetching EQ data from: {url}")
    try:
        data = await fetch_json(url, ttl=180)
        features = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            geo = f.get("geometry", {})
            if not geo or not geo.get("coordinates"):
                continue
            lon, lat, depth = geo["coordinates"]
            mag = p.get("mag", 0) or 0
            severity = "critical" if mag >= 7 else "high" if mag >= 6 else "medium" if mag >= 5 else "low"
            features.append({
                "id": f.get("id"),
                "lat": lat,
                "lon": lon,
                "depth_km": round(depth, 1) if depth else 0,
                "magnitude": round(mag, 1),
                "place": p.get("place", "Unknown"),
                "time": p.get("time"),
                "time_iso": datetime.fromtimestamp(p["time"] / 1000, tz=timezone.utc).isoformat() if p.get("time") else None,
                "type": p.get("type", "earthquake"),
                "url": p.get("url"),
                "severity": severity,
            })
        features.sort(key=lambda x: x["magnitude"], reverse=True)
        print(f"Found {len(features)} EQ events")
        return {"source": "USGS", "count": len(features), "window": window, "events": features}
    except Exception as e:
        print(f"USGS EQ fetch failed: {e}")
        raise HTTPException(502, f"USGS fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 2. NATURAL DISASTERS — NASA EONET
# ──────────────────────────────────────────────────────────────
@app.get("/api/disasters")
async def disasters():
    """NASA EONET v3 — open events, last 30 days."""
    url = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=200"
    try:
        data = await fetch_json(url, ttl=600)
        events = []
        for ev in data.get("events", []):
            cats = [c.get("title", "") for c in ev.get("categories", [])]
            geoms = ev.get("geometry", [])
            if not geoms:
                continue
            latest = geoms[-1]
            coords = latest.get("coordinates")
            if not coords:
                continue
            geo_type = latest.get("type", "Point")
            if geo_type == "Point":
                lon, lat = coords[0], coords[1]
            elif geo_type == "Polygon":
                ring = coords[0]
                lons = [p[0] for p in ring]
                lats = [p[1] for p in ring]
                lon = sum(lons) / len(lons)
                lat = sum(lats) / len(lats)
            else:
                continue

            category_id = ev.get("categories", [{}])[0].get("id", "other")
            severity_map = {
                "wildfires": "high",
                "severeStorms": "high",
                "earthquakes": "critical",
                "volcanoes": "high",
                "floods": "medium",
                "landslides": "medium",
                "seaLakeIce": "low",
                "snow": "low",
                "drought": "medium",
                "dustHaze": "low",
                "manmade": "medium",
            }
            events.append({
                "id": ev.get("id"),
                "title": ev.get("title"),
                "categories": cats,
                "category_id": category_id,
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "date": latest.get("date"),
                "source_url": ev.get("sources", [{}])[0].get("url"),
                "severity": severity_map.get(category_id, "medium"),
            })
        return {"source": "NASA EONET", "count": len(events), "events": events}
    except Exception as e:
        raise HTTPException(502, f"EONET fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 3. WILDFIRES — NASA FIRMS CSV with EONET fallback
# ──────────────────────────────────────────────────────────────
@app.get("/api/fires")
async def fires():
    """
    Active fire detections.
    Primary: NASA FIRMS VIIRS NRT (no-key CSV).
    Fallback: NASA EONET wildfires category.
    """
    # ── Primary: FIRMS VIIRS SNPP 24 h (no API key required) ──
    firms_urls = [
        "https://firms.modaps.eosdis.nasa.gov/active_fire/suomi-npp-viirs-c2/text/SUOMI_VIIRS_C2_Global_24h.csv",
        "https://firms.modaps.eosdis.nasa.gov/active_fire/noaa-viirs-c2/text/NOAA_VIIRS_C2_Global_24h.csv",
        "https://firms.modaps.eosdis.nasa.gov/active_fire/c6/text/MODIS_C6_Global_24h.csv",
    ]
    for url in firms_urls:
        try:
            text = await fetch_text(url, ttl=600, timeout=20.0)
            if not text.strip() or "<!DOCTYPE" in text[:100]:
                continue
            reader = csv.DictReader(io.StringIO(text))
            rows = []
            for i, row in enumerate(reader):
                if i >= 2000:
                    break
                try:
                    lat  = float(row.get("latitude") or row.get("lat", 0))
                    lon  = float(row.get("longitude") or row.get("lon", 0))
                    bright = float(row.get("bright_ti4") or row.get("brightness") or 0)
                    frp  = float(row.get("frp", 0))
                    severity = "critical" if frp > 100 else "high" if frp > 30 else "medium"
                    rows.append({
                        "lat": lat, "lon": lon,
                        "brightness": round(bright, 1),
                        "frp": round(frp, 1),
                        "acq_date": row.get("acq_date", ""),
                        "acq_time": row.get("acq_time", ""),
                        "satellite": row.get("satellite", "VIIRS"),
                        "confidence": row.get("confidence", ""),
                        "severity": severity,
                    })
                except (ValueError, KeyError):
                    continue
            if rows:
                return {"source": "NASA FIRMS", "count": len(rows), "fires": rows}
        except Exception:
            continue

    # ── Fallback: NASA EONET wildfires ──
    try:
        eonet_url = "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&days=30&limit=500"
        data = await fetch_json(eonet_url, ttl=1800, timeout=15.0)
        rows = []
        for ev in data.get("events", []):
            geo = (ev.get("geometry") or [{}])
            point = geo[-1] if geo else {}
            coords = point.get("coordinates", [])
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
            rows.append({
                "lat": lat, "lon": lon,
                "brightness": 0,
                "frp": 50,  # synthetic FRP for display
                "acq_date": point.get("date", "")[:10],
                "acq_time": "",
                "satellite": "EONET",
                "confidence": "nominal",
                "severity": "high",
            })
        return {"source": "NASA EONET Wildfires", "count": len(rows), "fires": rows}
    except Exception as e:
        raise HTTPException(502, f"All fire sources failed: {e}")


# ──────────────────────────────────────────────────────────────
# 4. AVIATION — OpenSky Network (public, rate-limited)
# ──────────────────────────────────────────────────────────────
@app.get("/api/aviation")
async def aviation(bbox: str = ""):
    """
    Global flight states. Serves from background-poller cache when fresh.
    bbox parameter (minLat,maxLat,minLon,maxLon) optionally filters results.
    """
    global _aviation_states, _aviation_states_ts
    bbox_parts = None
    if bbox:
        p = bbox.split(",")
        if len(p) == 4:
            try:
                bbox_parts = [float(p[0]), float(p[1]), float(p[2]), float(p[3])]
            except Exception:
                bbox_parts = None

    # ── Fast path: serve from background poller cache when fresh ──
    if _aviation_states and (time.time() - _aviation_states_ts) < 90:
        aircraft = _aviation_states
        if bbox_parts:
            aircraft = [
                ac for ac in aircraft
                if bbox_parts[0] <= ac["lat"] <= bbox_parts[1]
                and bbox_parts[2] <= ac["lon"] <= bbox_parts[3]
            ]
        return {"source": "cache", "count": len(aircraft), "aircraft": aircraft[:20000]}

    # ── Cold cache: fetch via adsb.lol /v2/all (worldwide) ──
    try:
        d = await fetch_json("https://api.adsb.lol/v2/all", ttl=55, timeout=20.0)
        all_ac = _normalise_adsb_aircraft(d.get("ac", []) or [])
    except Exception as e:
        print(f"[AV] adsb.lol /v2/all failed ({e}), falling back to 9-point coverage")
        _COVER_PTS = [
            (40, -100, 3000), (50,  10, 3000), (35,  78, 3000),  # N.America, Europe, India/S.Asia
            (30, 120, 3000), (-25, 135, 3000), (-15, 25, 3000),   # E.Asia, Australia, Africa
            (-15, -55, 3000), (15, 50, 3000),  (60, 60, 3000),    # S.America, Arabian, Russia/C.Asia
        ]
        async def _fp(lat, lon, r):
            try:
                d2 = await fetch_json(f"https://api.adsb.lol/v2/point/{lat}/{lon}/{r}", ttl=55, timeout=12.0)
                return _normalise_adsb_aircraft(d2.get("ac", []) or [])
            except Exception as e2:
                print(f"[AV] point({lat},{lon}) failed: {e2}")
                return []
        results = await asyncio.gather(*[_fp(*p) for p in _COVER_PTS])
        seen2: set = set(); all_ac = []
        for r2 in results:
            for ac in r2:
                if ac["icao"] not in seen2:
                    seen2.add(ac["icao"]); all_ac.append(ac)
    if all_ac:
        _aviation_states = all_ac[:25000]; _aviation_states_ts = time.time()
        aircraft = all_ac
        if bbox_parts:
            aircraft = [
                ac for ac in aircraft
                if bbox_parts[0] <= ac["lat"] <= bbox_parts[1]
                and bbox_parts[2] <= ac["lon"] <= bbox_parts[3]
            ]
        print(f"[AV] cold-fetch {len(all_ac)} aircraft via adsb.lol")
        return {"source": "adsb.lol", "count": len(aircraft), "aircraft": aircraft[:20000]}

    raise HTTPException(502, "All aviation sources failed")


@app.get("/api/adsb_military")
async def adsb_military():
    """
    Fetch military aircraft from adsb.one (reliable alternative to adsb.fi).
    Returns up to 500 military aircraft.
    """
    # Try adsb.lol (primary) then adsb.one (fallback)
    mil_data = None
    _mil_urls = [
        "https://api.adsb.lol/v2/mil",
        "https://api.airplanes.live/v2/mil",
        "https://api.adsb.one/v2/mil",
        "https://api.adsb.fi/v1/military",
    ]
    for _url in _mil_urls:
        try:
            mil_data = await fetch_json(_url, ttl=120)
            if mil_data.get("ac"):
                print(f"[MIL-AIR] Fetched from {_url}")
                break
        except Exception as _e:
            print(f"[MIL-AIR] {_url} failed: {_e}")
    url = "(tried multiple sources)"
    try:
        data = mil_data or {}
        aircraft_raw = data.get("ac", []) or []
        aircraft = []
        for ac in aircraft_raw[:600]: # Fetch slightly more
            lat = ac.get("lat")
            lon = ac.get("lon")
            if lat is None or lon is None:
                continue
            
            aircraft.append({
                "icao": ac.get("hex"),
                "callsign": (ac.get("flight") or "").strip() or ac.get("hex"),
                "registration": ac.get("r"),
                "type": ac.get("t"),
                "desc": ac.get("desc"),
                "country": ac.get("ownOp") or ac.get("country"),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "altitude_ft": ac.get("alt_baro") or ac.get("alt_geom"),
                "velocity_kts": ac.get("gs"),
                "heading": ac.get("track") or ac.get("mag_heading"),
                "squawk": ac.get("squawk"),
                "is_mil": True
            })
        print(f"[MIL-AIR] Fetched {len(aircraft)} military aircraft from adsb.one")
        return {"source": "ADSB.one (Military)", "count": len(aircraft), "aircraft": aircraft}
    except Exception as e:
        print(f"[MIL-AIR] adsb.one fetch failed: {e}. Trying adsb.fi mirror...")
        try:
            url_alt = "https://api.adsb.fi/v2/mil"
            data = await fetch_json(url_alt, ttl=45)
            aircraft_raw = data.get("ac", []) or []
            aircraft = []
            for ac in aircraft_raw[:600]:
                lat = ac.get("lat")
                lon = ac.get("lon")
                if lat is None or lon is None: continue
                aircraft.append({
                    "icao": ac.get("hex"),
                    "callsign": (ac.get("flight") or "").strip() or ac.get("hex"),
                    "registration": ac.get("r"),
                    "type": ac.get("t"),
                    "desc": ac.get("desc"),
                    "country": ac.get("ownOp") or ac.get("country"),
                    "lat": round(lat, 5),
                    "lon": round(lon, 5),
                    "altitude_ft": ac.get("alt_baro") or ac.get("alt_geom"),
                    "velocity_kts": ac.get("gs"),
                    "heading": ac.get("track") or ac.get("mag_heading"),
                    "squawk": ac.get("squawk"),
                    "is_mil": True
                })
            return {"source": "ADSB.fi (Mirror)", "count": len(aircraft), "aircraft": aircraft}
        except Exception as e2:
            print(f"[MIL-AIR] Mirror fetch failed: {e2}")
            return {"source": "None", "count": 0, "aircraft": [], "error": str(e2)}


@app.get("/api/osm_roads")
async def osm_roads(bbox: str):
    """
    Fetch major roads from OSM Overpass API for the given bbox.
    bbox format: minLat,minLon,maxLat,maxLon
    """
    try:
        # Validate bbox
        parts = bbox.split(",")
        if len(parts) != 4:
            return {"ways": [], "error": "Invalid bbox format"}
        
        # Overpass bbox is (minLat, minLon, maxLat, maxLon)
        # We'll fetch primary, secondary, and tertiary roads
        query = f"""
        [out:json][timeout:25];
        (
          way["highway"~"motorway|trunk|primary|secondary"]({bbox});
        );
        out body;
        >;
        out skel qt;
        """
        url = "https://overpass-api.de/api/interpreter"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, data={"data": query})
            resp.raise_for_status()
            data = resp.json()
        
        # Process into simple line segments
        elements = data.get("elements", [])
        nodes = {e["id"]: (e["lat"], e["lon"]) for e in elements if e["type"] == "node"}
        ways = []
        for e in elements:
            if e["type"] == "way":
                way_nodes = [nodes[nid] for nid in e["nodes"] if nid in nodes]
                if len(way_nodes) > 1:
                    ways.append(way_nodes)
        
        print(f"OSM Roads: found {len(ways)} ways for bbox {bbox}")
        return {"ways": ways}
    except Exception as e:
        print(f"OSM Overpass error: {e}")
        return {"ways": [], "error": str(e)}


# ── Global State for Aviation WebSocket ──────────────────────────────────────
_aviation_states: List[Dict[str, Any]] = []   # Normalised aircraft objects
_aviation_states_ts: float = 0.0              # Unix timestamp of last successful update
_aviation_active_connections: Set[WebSocket] = set()

def _normalise_adsb_aircraft(ac_list: list) -> list:
    """Convert ADSB.one / ADSB.fi 'ac' array items to normalised dicts."""
    out = []
    for ac in ac_list:
        lat = ac.get("lat"); lon = ac.get("lon")
        if lat is None or lon is None:
            continue
        out.append({
            "icao":        ac.get("hex"),
            "callsign":    (ac.get("flight") or "").strip() or ac.get("hex", ""),
            "lat":         round(lat, 4),
            "lon":         round(lon, 4),
            "altitude_m":  round((ac.get("alt_geom") or 0) * 0.3048, 0) if ac.get("alt_geom") else 0,
            "velocity_ms": round((ac.get("gs") or 0) * 0.514444, 1) if ac.get("gs") else 0,
            "heading":     round(ac.get("track") or 0, 0),
            "on_ground":   bool(ac.get("onground")),
        })
    return out

def _normalise_opensky_states(states: list) -> list:
    """Convert OpenSky raw state vectors to normalised dicts."""
    out = []
    for s in states:
        if not s or len(s) < 11:
            continue
        lon = s[5]; lat = s[6]
        if lon is None or lat is None:
            continue
        out.append({
            "icao":        s[0],
            "callsign":    (s[1] or "").strip() or s[0],
            "lat":         round(lat, 4),
            "lon":         round(lon, 4),
            "altitude_m":  round(s[7] or 0, 0),
            "velocity_ms": round(s[9] or 0, 1),
            "heading":     round(s[10] or 0, 0),
            "on_ground":   bool(s[8]),
        })
    return out

async def _adsb_point_fetch(lat: float, lon: float, radius: int, timeout: float = 15.0) -> list:
    """Fetch one /v2/point query from adsb.lol directly (bypasses TTL cache for poller freshness)."""
    url = f"https://api.adsb.lol/v2/point/{lat}/{lon}/{radius}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=timeout) as client:
            r = await client.get(url)
            r.raise_for_status()
            d = r.json()
        aircraft = _normalise_adsb_aircraft(d.get("ac", []) or [])
        cache_set(url, d, 55)
        return aircraft
    except httpx.HTTPStatusError as e:
        print(f"[AviationPoller] point({lat},{lon}) HTTP {e.response.status_code}")
        return []
    except httpx.TimeoutException:
        print(f"[AviationPoller] point({lat},{lon}) timed out")
        return []
    except Exception as e:
        print(f"[AviationPoller] point({lat},{lon}) failed: {type(e).__name__}: {str(e)[:80]}")
        return []


async def _adsb_all_fetch(timeout: float = 25.0) -> list:
    """Fetch ALL aircraft worldwide from adsb.lol /v2/all in a single request."""
    url = "https://api.adsb.lol/v2/all"
    try:
        async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=timeout) as client:
            r = await client.get(url)
            r.raise_for_status()
            d = r.json()
        aircraft = _normalise_adsb_aircraft(d.get("ac", []) or [])
        cache_set(url, d, 55)
        return aircraft
    except httpx.HTTPStatusError as e:
        print(f"[AviationPoller] /v2/all HTTP {e.response.status_code}")
        return []
    except httpx.TimeoutException:
        print(f"[AviationPoller] /v2/all timed out")
        return []
    except Exception as e:
        print(f"[AviationPoller] /v2/all failed: {type(e).__name__}: {str(e)[:80]}")
        return []


async def _aviation_background_poller() -> None:
    """Infinite loop: fetch live flight states every 60 s and keep the cache warm.
    Source priority: adsb.lol (3-point global coverage) → OpenSky fallback.
    """
    global _aviation_states, _aviation_states_ts
    # Small startup delay so the server finishes booting before first heavy fetch
    await asyncio.sleep(10)
    print("[AviationPoller] Background poller started")
    while True:
        aircraft: list = []
        seen_icao: set = set()

        # Try /v2/all first (single worldwide fetch), fall back to 9-point coverage
        aircraft = await _adsb_all_fetch()
        if aircraft:
            seen_icao.update(ac["icao"] for ac in aircraft)
            print(f"[AviationPoller] {len(aircraft)} aircraft from adsb.lol (/v2/all global)")
        else:
            # Fallback: 9 coverage points spanning all continents
            _POLL_PTS = [
                (40, -100, 3000), (50,  10, 3000), (35,  78, 3000),  # N.America, Europe, India
                (30, 120, 3000), (-25, 135, 3000), (-15, 25, 3000),   # E.Asia, Australia, Africa
                (-15, -55, 3000), (15, 50, 3000),  (60, 60, 3000),    # S.America, Arabian, Russia
            ]
            pt_results = await asyncio.gather(*[_adsb_point_fetch(lat, lon, r) for lat, lon, r in _POLL_PTS])
            for ac_list in pt_results:
                for ac in ac_list:
                    if ac["icao"] not in seen_icao:
                        seen_icao.add(ac["icao"])
                        aircraft.append(ac)
            if not aircraft:
                # Final fallback: OpenSky global
                try:
                    data = await fetch_json("https://opensky-network.org/api/states/all", ttl=55, timeout=15.0)
                    aircraft = _normalise_opensky_states(data.get("states", []) or [])
                    if aircraft:
                        print(f"[AviationPoller] {len(aircraft)} aircraft from OpenSky")
                except Exception as e:
                    print(f"[AviationPoller] OpenSky fallback failed: {type(e).__name__}: {str(e)[:60]}")
            else:
                print(f"[AviationPoller] {len(aircraft)} aircraft from adsb.lol (9-region fallback)")

        if aircraft:
            _aviation_states    = aircraft[:25000]
            _aviation_states_ts = time.time()

        # Poll every 60 s
        await asyncio.sleep(60)

@app.websocket("/ws/aviation")
async def aviation_websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _aviation_active_connections.add(websocket)
    try:
        # Send cached data immediately so the client doesn't wait for the next poll
        if _aviation_states:
            await websocket.send_json({"type": "aviation_update", "aircraft": _aviation_states})

        while True:
            # Keep connection alive; client may send bbox for future server-side filtering
            await websocket.receive_text()
    except WebSocketDisconnect:
        _aviation_active_connections.discard(websocket)
    except Exception:
        _aviation_active_connections.discard(websocket)

@app.get("/api/gtfs/stops")
async def gtfs_stops(feed_url: str, limit: int = 3000):
    """
    Parse GTFS Schedule ZIP feed (stops.txt) and return stops with coords and names.
    Requires a direct URL to a GTFS ZIP (e.g., agency feed link).
    """
    if not feed_url:
        raise HTTPException(400, "Missing required 'feed_url' query parameter")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(feed_url, follow_redirects=True)
            r.raise_for_status()
            data = r.content
        import zipfile
        zf = zipfile.ZipFile(io.BytesIO(data))
        names = zf.namelist()
        if "stops.txt" not in names:
            # some feeds use uppercase
            stops_name = next((n for n in names if n.lower().endswith("stops.txt")), None)
            if not stops_name:
                raise HTTPException(502, "GTFS feed missing stops.txt")
        else:
            stops_name = "stops.txt"
        f = zf.open(stops_name)
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", newline=""))
        stops = []
        for i, row in enumerate(reader):
            if i >= limit:
                break
            try:
                lat = float(row.get("stop_lat"))
                lon = float(row.get("stop_lon"))
                if math.isnan(lat) or math.isnan(lon):
                    continue
            except Exception:
                continue
            stops.append({
                "id": row.get("stop_id"),
                "name": (row.get("stop_name") or "").strip(),
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "code": row.get("stop_code"),
                "desc": row.get("stop_desc"),
            })
        return {"source": "GTFS", "count": len(stops), "stops": stops}
    except Exception as e:
        raise HTTPException(502, f"GTFS fetch/parse failed: {e}")


# ──────────────────────────────────────────────────────────────
# 5. NEWS — RSS Aggregation
# ──────────────────────────────────────────────────────────────
RSS_FEEDS = {
    "reuters_world": "https://feeds.reuters.com/reuters/worldNews",
    "bbc_world":     "https://feeds.bbci.co.uk/news/world/rss.xml",
    "aljazeera":     "https://www.aljazeera.com/xml/rss/all.xml",
    "nyt_world":     "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "guardian_world":"https://www.theguardian.com/world/rss",
    "france24_en":   "https://www.france24.com/en/rss",
    "dw_world":      "https://rss.dw.com/rdf/rss-en-world",
}

THREAT_KEYWORDS = {
    "critical": ["war", "invasion", "nuclear", "airstrike", "missile strike", "coup", "genocide", "catastrophe", "explosion", "collapse"],
    "high": ["conflict", "attack", "military", "troops", "sanctions", "protest", "crisis", "bombed", "casualties", "killed", "ceasefire"],
    "medium": ["tension", "warning", "diplomatic", "threat", "arrested", "detained", "earthquake", "flood", "fire", "evacuation"],
    "low": ["talks", "negotiations", "election", "summit", "agreement", "deal"],
}

def classify_headline(text: str) -> dict:
    tl = text.lower()
    for sev, words in THREAT_KEYWORDS.items():
        for w in words:
            if w in tl:
                return {"severity": sev, "keyword": w}
    return {"severity": "info", "keyword": None}

def parse_rss(xml_text: str, source_name: str) -> list:
    items = []
    try:
        root = ET.fromstring(xml_text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        # RSS 2.0
        for item in root.findall(".//item")[:15]:
            title = (item.findtext("title") or "").strip()
            link  = (item.findtext("link") or "").strip()
            desc  = (item.findtext("description") or "").strip()
            pub   = (item.findtext("pubDate") or "").strip()
            if not title:
                continue
            cls = classify_headline(title + " " + desc)
            items.append({
                "title": title,
                "link": link,
                "description": desc[:300] if desc else "",
                "published": pub,
                "source": source_name,
                "severity": cls["severity"],
                "trigger_keyword": cls["keyword"],
            })
        # Atom feed fallback
        if not items:
            for entry in root.findall("atom:entry", ns)[:15]:
                title = (entry.findtext("atom:title", namespaces=ns) or "").strip()
                link_el = entry.find("atom:link", ns)
                link = link_el.get("href", "") if link_el is not None else ""
                summary = (entry.findtext("atom:summary", namespaces=ns) or "").strip()
                updated = (entry.findtext("atom:updated", namespaces=ns) or "").strip()
                if not title:
                    continue
                cls = classify_headline(title + " " + summary)
                items.append({
                    "title": title,
                    "link": link,
                    "description": summary[:300],
                    "published": updated,
                    "source": source_name,
                    "severity": cls["severity"],
                    "trigger_keyword": cls["keyword"],
                })
    except ET.ParseError:
        pass
    return items


@app.get("/api/news")
async def news(category: str = "all"):
    """Aggregate world news from multiple public RSS feeds."""
    cached = cache_get(f"news_{category}")
    if cached:
        return cached

    async def fetch_feed(name: str, url: str):
        try:
            text = await fetch_text(url, ttl=300)
            return parse_rss(text, name)
        except Exception:
            return []

    tasks = [fetch_feed(n, u) for n, u in RSS_FEEDS.items()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_items = []
    for r in results:
        if isinstance(r, list):
            all_items.extend(r)

    # Sort: critical first, then by order
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    all_items.sort(key=lambda x: sev_order.get(x["severity"], 5))

    result = {
        "total": len(all_items),
        "sources_count": len(RSS_FEEDS),
        "items": all_items[:200],
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    cache_set(f"news_{category}", result, 300)
    return result


# ──────────────────────────────────────────────────────────────
# 6. CYBER THREATS — Abuse.ch
# ──────────────────────────────────────────────────────────────
@app.get("/api/threats/feodo")
async def threats_feodo():
    """Feodo Tracker botnet C&C IPs (CSV)."""
    url = "https://feodotracker.abuse.ch/downloads/ipblocklist.csv"
    try:
        text = await fetch_text(url, ttl=1800)
        lines = [l for l in text.splitlines() if l and not l.startswith("#")]
        iocs = []
        for line in lines[:200]:
            parts = line.split(",")
            if len(parts) >= 2:
                iocs.append({"ip": parts[0].strip(), "port": parts[1].strip() if len(parts) > 1 else "",
                              "type": "c2_server", "severity": "critical"})
        return {"source": "Feodo Tracker", "count": len(iocs), "iocs": iocs}
    except Exception as e:
        raise HTTPException(502, f"Feodo fetch failed: {e}")


@app.get("/api/threats/ransomware")
async def threats_ransomware():
    """Recent ransomware victims from ransomware.live."""
    url = "https://api.ransomware.live/recentvictims"
    try:
        data = await fetch_json(url, ttl=900)
        victims = []
        for v in (data if isinstance(data, list) else data.get("data", []))[:100]:
            victims.append({
                "victim": v.get("victim") or v.get("company") or v.get("name", "Unknown"),
                "group": v.get("group") or v.get("gang", "Unknown"),
                "country": v.get("country", ""),
                "sector": v.get("activity") or v.get("sector", ""),
                "date": v.get("discovered") or v.get("date", ""),
                "severity": "critical",
                "type": "ransomware",
            })
        return {"source": "ransomware.live", "count": len(victims), "victims": victims}
    except Exception as e:
        raise HTTPException(502, f"Ransomware.live fetch failed: {e}")


@app.get("/api/threats/urlhaus")
async def threats_urlhaus():
    """URLhaus recent malware distribution URLs."""
    url = "https://urlhaus.abuse.ch/downloads/csv_recent/"
    try:
        text = await fetch_text(url, ttl=1800)
        lines = [l for l in text.splitlines() if l and not l.startswith("#")]
        urls_list = []
        for line in lines[:100]:
            parts = line.split('","')
            if len(parts) >= 5:
                entry_url = parts[2].strip('"') if len(parts) > 2 else ""
                status = parts[3].strip('"') if len(parts) > 3 else "unknown"
                tag = parts[5].strip('"') if len(parts) > 5 else ""
                urls_list.append({
                    "url": entry_url[:200],
                    "status": status,
                    "threat": tag,
                    "type": "malware_host",
                    "severity": "high",
                })
        return {"source": "URLhaus", "count": len(urls_list), "urls": urls_list}
    except Exception as e:
        raise HTTPException(502, f"URLhaus fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 7. MARKETS — Yahoo Finance (unofficial) + CoinGecko + Fear&Greed
# ──────────────────────────────────────────────────────────────
MARKET_TICKERS = {
    "S&P 500": "^GSPC",
    "NASDAQ": "^IXIC",
    "Dow Jones": "^DJI",
    "Gold": "GC=F",
    "Crude Oil WTI": "CL=F",
    "Brent Crude": "BZ=F",
    "EUR/USD": "EURUSD=X",
    "USD/JPY": "JPY=X",
    "10Y Treasury": "^TNX",
    "VIX": "^VIX",
    "BTC-USD": "BTC-USD",
    "ETH-USD": "ETH-USD",
}


@app.get("/api/markets/quotes")
async def market_quotes():
    """Yahoo Finance quote snapshots for key tickers."""
    results = []
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=12.0) as client:
        for name, ticker in MARKET_TICKERS.items():
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
            cached = cache_get(f"yf_{ticker}")
            if cached:
                results.append(cached)
                continue
            try:
                r = await client.get(url)
                if r.status_code != 200:
                    continue
                d = r.json()
                meta = d.get("chart", {}).get("result", [{}])[0].get("meta", {})
                price = meta.get("regularMarketPrice") or meta.get("chartPreviousClose", 0)
                prev  = meta.get("chartPreviousClose") or meta.get("previousClose", price)
                change_pct = ((price - prev) / prev * 100) if prev else 0
                entry = {
                    "name": name,
                    "ticker": ticker,
                    "price": round(price, 4),
                    "change_pct": round(change_pct, 2),
                    "currency": meta.get("currency", "USD"),
                    "exchange": meta.get("exchangeName", ""),
                    "direction": "up" if change_pct > 0 else "down" if change_pct < 0 else "flat",
                }
                cache_set(f"yf_{ticker}", entry, 300)
                results.append(entry)
                await asyncio.sleep(0.15)
            except Exception:
                continue
    return {"source": "Yahoo Finance", "count": len(results), "quotes": results}


@app.get("/api/markets/crypto")
async def market_crypto():
    """CoinGecko market data (no API key, free tier)."""
    url = (
        "https://api.coingecko.com/api/v3/coins/markets"
        "?vs_currency=usd&order=market_cap_desc&per_page=20&page=1"
        "&sparkline=false&price_change_percentage=24h,7d"
    )
    try:
        data = await fetch_json(url, ttl=300)
        coins = []
        for c in data:
            coins.append({
                "id": c.get("id"),
                "symbol": c.get("symbol", "").upper(),
                "name": c.get("name"),
                "price": c.get("current_price"),
                "market_cap": c.get("market_cap"),
                "change_24h": round(c.get("price_change_percentage_24h") or 0, 2),
                "change_7d": round(c.get("price_change_percentage_7d_in_currency") or 0, 2),
                "volume_24h": c.get("total_volume"),
                "rank": c.get("market_cap_rank"),
                "direction": "up" if (c.get("price_change_percentage_24h") or 0) > 0 else "down",
            })
        return {"source": "CoinGecko", "count": len(coins), "coins": coins}
    except Exception as e:
        raise HTTPException(502, f"CoinGecko fetch failed: {e}")


@app.get("/api/markets/fear-greed")
async def fear_greed():
    """Alternative.me Crypto Fear & Greed Index."""
    url = "https://api.alternative.me/fng/?limit=7"
    try:
        data = await fetch_json(url, ttl=3600)
        items = data.get("data", [])
        if not items:
            raise HTTPException(502, "No F&G data")
        current = items[0]
        value = int(current.get("value", 50))
        label = current.get("value_classification", "Neutral")
        sentiment = "extreme_greed" if value >= 75 else "greed" if value >= 55 else "neutral" if value >= 45 else "fear" if value >= 25 else "extreme_fear"
        return {
            "source": "alternative.me",
            "value": value,
            "label": label,
            "sentiment": sentiment,
            "timestamp": current.get("timestamp"),
            "history": [{"value": int(d.get("value", 0)), "label": d.get("value_classification"), "timestamp": d.get("timestamp")} for d in items],
        }
    except Exception as e:
        raise HTTPException(502, f"Fear&Greed fetch failed: {e}")


@app.get("/api/markets/mempool")
async def mempool():
    """mempool.space Bitcoin fee estimates."""
    url = "https://mempool.space/api/v1/fees/recommended"
    try:
        data = await fetch_json(url, ttl=120)
        return {"source": "mempool.space", **data}
    except Exception as e:
        raise HTTPException(502, f"mempool fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 8. WEATHER — Open-Meteo (no key)
# ──────────────────────────────────────────────────────────────
CLIMATE_ZONES = [
    {"name": "Middle East / Hormuz", "lat": 26.5, "lon": 56.3},
    {"name": "Eastern Ukraine",       "lat": 49.0, "lon": 37.8},
    {"name": "Gaza Strip",            "lat": 31.4, "lon": 34.4},
    {"name": "Korean Peninsula",      "lat": 37.5, "lon": 127.0},
    {"name": "Taiwan Strait",         "lat": 24.8, "lon": 119.5},
    {"name": "Sahel / West Africa",   "lat": 13.5, "lon": 2.1},
    {"name": "Horn of Africa",        "lat": 5.1,  "lon": 41.9},
    {"name": "Kashmir",               "lat": 34.1, "lon": 74.8},
    {"name": "Xinjiang",              "lat": 40.0, "lon": 82.0},
    {"name": "Amazon Basin",          "lat": -3.1, "lon": -60.0},
]


@app.get("/api/climate")
async def climate():
    """Open-Meteo current weather for strategic hotspot zones."""
    async def fetch_zone(zone):
        url = (
            f"https://api.open-meteo.com/v1/forecast"
            f"?latitude={zone['lat']}&longitude={zone['lon']}"
            f"&current_weather=true&daily=temperature_2m_max,temperature_2m_min,precipitation_sum"
            f"&forecast_days=3&timezone=UTC"
        )
        try:
            data = await fetch_json(url, ttl=3600)
            cw = data.get("current_weather", {})
            daily = data.get("daily", {})
            temp_max = (daily.get("temperature_2m_max") or [None])[0]
            precip = (daily.get("precipitation_sum") or [None])[0]
            return {
                "zone": zone["name"],
                "lat": zone["lat"],
                "lon": zone["lon"],
                "temp_c": cw.get("temperature"),
                "windspeed": cw.get("windspeed"),
                "weathercode": cw.get("weathercode"),
                "is_day": cw.get("is_day"),
                "temp_max": temp_max,
                "precip_mm": precip,
                "anomaly": "extreme" if (temp_max or 0) > 42 or (precip or 0) > 80 else "normal",
            }
        except Exception:
            return {"zone": zone["name"], "lat": zone["lat"], "lon": zone["lon"], "error": True}

    tasks = [fetch_zone(z) for z in CLIMATE_ZONES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    zones = [r for r in results if isinstance(r, dict)]
    return {"source": "Open-Meteo", "count": len(zones), "zones": zones}


# ──────────────────────────────────────────────────────────────
# 9. WORLD BANK — GDP, population (no key)
# ──────────────────────────────────────────────────────────────
@app.get("/api/worldbank/gdp")
async def worldbank_gdp():
    """Top 30 countries by GDP from World Bank API."""
    url = (
        "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD"
        "?format=json&per_page=30&mrv=1&source=2"
    )
    try:
        data = await fetch_json(url, ttl=86400)
        if not isinstance(data, list) or len(data) < 2:
            raise HTTPException(502, "Unexpected World Bank response")
        rows = []
        for item in data[1] or []:
            if not item.get("value"):
                continue
            rows.append({
                "country": item.get("country", {}).get("value"),
                "iso2": item.get("countryiso3code"),
                "gdp_usd": item.get("value"),
                "year": item.get("date"),
            })
        rows.sort(key=lambda x: x["gdp_usd"] or 0, reverse=True)
        return {"source": "World Bank", "indicator": "GDP (USD)", "count": len(rows), "data": rows}
    except Exception as e:
        raise HTTPException(502, f"World Bank fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 10. GDELT — Latest events CSV
# ──────────────────────────────────────────────────────────────
@app.get("/api/gdelt/latest")
async def gdelt_latest():
    """Parse GDELT lastupdate.txt to get latest event export metadata."""
    url = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"
    try:
        text = await fetch_text(url, ttl=900)
        files = []
        for line in text.strip().splitlines():
            parts = line.split()
            if len(parts) >= 3:
                files.append({"size": parts[0], "hash": parts[1], "url": parts[2]})
        return {"source": "GDELT v2", "latest_files": files, "note": "Full export parsing disabled for performance. Files list above for direct use."}
    except Exception as e:
        raise HTTPException(502, f"GDELT fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 11. SPACE WEATHER — NOAA SWPC
# ──────────────────────────────────────────────────────────────
@app.get("/api/spaceweather")
async def spaceweather():
    """NOAA solar cycle indices."""
    url = "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"
    try:
        data = await fetch_json(url, ttl=3600)
        if not data:
            raise HTTPException(502, "No SWPC data")
        latest = data[-1] if isinstance(data, list) else data
        recent = data[-12:] if isinstance(data, list) else []
        return {
            "source": "NOAA SWPC",
            "latest": latest,
            "recent_months": recent,
            "note": "smoothed_ssn = Smoothed Sunspot Number (higher = more solar activity)",
        }
    except Exception as e:
        raise HTTPException(502, f"SWPC fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 12. SEISMOLOGY — EMSC
# ──────────────────────────────────────────────────────────────
@app.get("/api/seismology/emsc")
async def emsc():
    """EMSC European seismological event API (last 20 events)."""
    url = "https://www.seismicportal.eu/fdsnws/event/1/query?limit=20&format=json&minmag=4.0"
    try:
        data = await fetch_json(url, ttl=300)
        features = data.get("features", [])
        events = []
        for f in features:
            p = f.get("properties", {})
            geo = f.get("geometry", {})
            coords = geo.get("coordinates", [])
            events.append({
                "id": f.get("id"),
                "time": p.get("time"),
                "magnitude": p.get("mag"),
                "mag_type": p.get("magtype"),
                "depth_km": p.get("depth"),
                "region": p.get("flynn_region"),
                "lat": coords[1] if len(coords) > 1 else None,
                "lon": coords[0] if len(coords) > 0 else None,
                "source": "EMSC",
            })
        return {"source": "EMSC", "count": len(events), "events": events}
    except Exception as e:
        raise HTTPException(502, f"EMSC fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 13. BGP / ROUTING — BGPView
# ──────────────────────────────────────────────────────────────
@app.get("/api/bgp/asn/{asn}")
async def bgp_asn(asn: int):
    """BGPView ASN info (no key)."""
    url = f"https://api.bgpview.io/asn/{asn}"
    try:
        data = await fetch_json(url, ttl=3600)
        return {"source": "BGPView", "asn": asn, "data": data.get("data")}
    except Exception as e:
        raise HTTPException(502, f"BGPView fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 14. INFRASTRUCTURE — Static/Semi-static layers
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/cable-landing-points")
async def cable_landing_points():
    """TeleGeography cable landing points GeoJSON."""
    url = "https://raw.githubusercontent.com/telegeography/www.submarinecablemap.com/master/public/api/v3/landing-point/landing-point-geo.json"
    try:
        data = await fetch_json(url, ttl=86400)
        features = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            geo = f.get("geometry", {})
            coords = geo.get("coordinates", [])
            features.append({
                "id": p.get("id"),
                "name": p.get("name"),
                "country_code": p.get("country", {}).get("iso3166_1_alpha_2") if isinstance(p.get("country"), dict) else "",
                "lat": coords[1] if len(coords) > 1 else None,
                "lon": coords[0] if len(coords) > 0 else None,
                "cables": p.get("cables", []),
            })
        return {"source": "TeleGeography", "count": len(features), "points": features}
    except Exception as e:
        raise HTTPException(502, f"Landing points fetch failed: {e}")


@app.get("/api/infrastructure/power-plants")
async def power_plants(fuel: str = ""):
    """WRI Global Power Plant Database v1.3 (CSV subset)."""
    url = "https://wri-dataportal-prod.s3.amazonaws.com/manual/global_power_plant_database_v_1_3.csv"
    cached = cache_get(f"powerplants_{fuel}")
    if cached:
        return cached
    try:
        text = await fetch_text(url, ttl=86400, timeout=30.0)
        reader = csv.DictReader(io.StringIO(text))
        plants = []
        for row in reader:
            try:
                pf = row.get("primary_fuel", "")
                if fuel and pf.lower() != fuel.lower():
                    continue
                lat = float(row.get("latitude", 0) or 0)
                lon = float(row.get("longitude", 0) or 0)
                if lat == 0 and lon == 0:
                    continue
                cap = float(row.get("capacity_mw", 0) or 0)
                plants.append({
                    "name": row.get("name"),
                    "country": row.get("country_long"),
                    "iso3": row.get("country"),
                    "fuel": pf,
                    "capacity_mw": round(cap, 1),
                    "lat": lat,
                    "lon": lon,
                    "owner": row.get("owner"),
                    "year": row.get("commissioning_year"),
                })
                if len(plants) >= 5000:
                    break
            except (ValueError, KeyError):
                continue
        result = {"source": "WRI", "count": len(plants), "fuel_filter": fuel or "all", "plants": plants}
        cache_set(f"powerplants_{fuel}", result, 86400)
        return result
    except Exception as e:
        raise HTTPException(502, f"WRI fetch failed: {e}")


@app.get("/api/infrastructure/chokepoints")
async def chokepoints():
    """Static strategic maritime chokepoint data."""
    data = [
        {"id": "hormuz",    "name": "Strait of Hormuz",   "lat": 26.565, "lon": 56.490, "daily_barrels_M": 21, "risk": "high",   "region": "Middle East"},
        {"id": "malacca",   "name": "Strait of Malacca",  "lat": 2.500,  "lon": 101.000,"daily_barrels_M": 16, "risk": "medium", "region": "Asia"},
        {"id": "suez",      "name": "Suez Canal",         "lat": 30.672, "lon": 32.336, "daily_barrels_M": 5,  "risk": "high",   "region": "Middle East"},
        {"id": "bab",       "name": "Bab el-Mandeb",      "lat": 12.565, "lon": 43.396, "daily_barrels_M": 7,  "risk": "high",   "region": "Middle East"},
        {"id": "panama",    "name": "Panama Canal",       "lat": 9.382,  "lon": -79.919,"daily_barrels_M": 1,  "risk": "medium", "region": "Americas"},
        {"id": "taiwan",    "name": "Taiwan Strait",      "lat": 24.824, "lon": 119.526,"daily_barrels_M": 3,  "risk": "critical","region": "Asia"},
        {"id": "scs",       "name": "South China Sea",    "lat": 12.000, "lon": 113.000,"daily_barrels_M": 15, "risk": "high",   "region": "Asia"},
        {"id": "turkish",   "name": "Turkish Straits",    "lat": 41.119, "lon": 29.077, "daily_barrels_M": 3,  "risk": "medium", "region": "Europe"},
        {"id": "danish",    "name": "Danish Straits",     "lat": 57.200, "lon": 10.500, "daily_barrels_M": 2,  "risk": "low",    "region": "Europe"},
    ]
    return {"source": "static", "count": len(data), "chokepoints": data}


@app.get("/api/infrastructure/datacenters")
async def datacenters():
    """PeeringDB facilities (public API, no key)."""
    url = "https://www.peeringdb.com/api/fac?depth=1&limit=200"
    try:
        data = await fetch_json(url, ttl=86400, timeout=20.0)
        facs = []
        for f in (data.get("data") or []):
            facs.append({
                "id": f.get("id"),
                "name": f.get("name"),
                "city": f.get("city"),
                "country": f.get("country"),
                "lat": f.get("latitude"),
                "lon": f.get("longitude"),
                "org": f.get("org_id"),
                "website": f.get("website"),
            })
        facs_with_coords = [f for f in facs if f.get("lat") and f.get("lon")]
        return {"source": "PeeringDB", "count": len(facs_with_coords), "facilities": facs_with_coords}
    except Exception as e:
        raise HTTPException(502, f"PeeringDB fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 15. COUNTRY BOUNDARIES — Natural Earth GeoJSON
# ──────────────────────────────────────────────────────────────
@app.get("/api/geo/countries")
async def geo_countries():
    """Natural Earth 110m country boundaries GeoJSON — multiple CDN fallbacks."""
    # Try CDN mirrors in order of reliability
    _country_urls = [
        # jsDelivr CDN (fast, global)
        "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson",
        # Cloudfront/Mapbox CDN (very reliable)
        "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson",
        # GitHub raw fallback (may be slow)
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson",
    ]
    cached = cache_get("geo_countries")
    if cached:
        return cached
    data = None
    for url in _country_urls:
        try:
            data = await fetch_json(url, ttl=86400, timeout=25.0)
            if data and data.get("features"):
                break
        except Exception:
            continue
    if not data or not data.get("features"):
        raise HTTPException(502, "All country boundary sources failed")
    try:
        # Slim it down — only name, iso_a2, geometry
        slim_features = []
        for f in data.get("features", []):
            p = f.get("properties", {})
            slim_features.append({
                "type": "Feature",
                "properties": {
                    "name": p.get("NAME") or p.get("ADMIN"),
                    "iso_a2": p.get("ISO_A2"),
                    "iso_a3": p.get("ISO_A3"),
                    "pop_est": p.get("POP_EST"),
                    "gdp_md_est": p.get("GDP_MD"),
                    "continent": p.get("CONTINENT"),
                    "region": p.get("SUBREGION"),
                },
                "geometry": f.get("geometry"),
            })
        result = {"type": "FeatureCollection", "features": slim_features}
        cache_set("geo_countries", result, 86400)
        return result
    except Exception as e:
        raise HTTPException(502, f"NE countries processing failed: {e}")


# ──────────────────────────────────────────────────────────────
# WEATHER RADAR — RainViewer (free, no API key)
# ──────────────────────────────────────────────────────────────
@app.get("/api/weather/radar")
async def weather_radar():
    """Fetch latest RainViewer weather radar + satellite IR timestamps for tile overlay."""
    url = "https://api.rainviewer.com/public/weather-maps.json"
    try:
        data = await fetch_json(url, ttl=120, timeout=8.0)
        host = data.get("host", "https://tilecache.rainviewer.com")
        radar  = data.get("radar", {})
        past   = radar.get("past", [])
        nowcast = radar.get("nowcast", [])
        satellite = data.get("satellite", {})
        infrared  = satellite.get("infrared", [])
        # Use the path field (full sub-path) from the API — more reliable than timestamp alone
        latest_radar     = past[-1]     if past     else None
        latest_infrared  = infrared[-1] if infrared else None
        return {
            "source": "RainViewer",
            "host": host,
            "latest_timestamp": latest_radar["time"] if latest_radar else None,
            "latest_path":      latest_radar["path"] if latest_radar else None,
            "satellite_path":   latest_infrared["path"] if latest_infrared else None,
            "past": past[-6:] if past else [],
            "nowcast": nowcast[:3] if nowcast else [],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(502, f"RainViewer fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# 16. COMBINED SIGNAL AGGREGATOR
# ──────────────────────────────────────────────────────────────
@app.get("/api/signals")
async def signals():
    """Aggregate top signals across all data sources for the intelligence panel."""
    results = {}
    async def safe_fetch(key, coro):
        try:
            results[key] = await coro
        except Exception as e:
            results[key] = {"error": str(e)}

    await asyncio.gather(
        safe_fetch("earthquakes", earthquakes("day")),
        safe_fetch("disasters",   disasters()),
        safe_fetch("threats_rw",  threats_ransomware()),
        safe_fetch("spaceweather", spaceweather()),
    )

    signals_list = []

    # Top earthquakes
    for ev in (results.get("earthquakes") or {}).get("events", [])[:5]:
        signals_list.append({
            "type": "earthquake",
            "title": f"M{ev['magnitude']} — {ev['place']}",
            "severity": ev["severity"],
            "lat": ev["lat"], "lon": ev["lon"],
            "time": ev.get("time_iso"),
            "detail": f"Depth: {ev['depth_km']}km",
        })

    # Disasters
    for ev in (results.get("disasters") or {}).get("events", [])[:5]:
        signals_list.append({
            "type": ev.get("category_id", "disaster"),
            "title": ev["title"],
            "severity": ev["severity"],
            "lat": ev["lat"], "lon": ev["lon"],
            "time": ev.get("date"),
            "detail": ", ".join(ev.get("categories", [])),
        })

    # Ransomware
    for v in (results.get("threats_rw") or {}).get("victims", [])[:3]:
        signals_list.append({
            "type": "ransomware",
            "title": f"{v['group']} — {v['victim']}",
            "severity": "critical",
            "lat": None, "lon": None,
            "time": v.get("date"),
            "detail": f"Sector: {v.get('sector', 'Unknown')} | Country: {v.get('country', '?')}",
        })

    # Sort by severity
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    signals_list.sort(key=lambda x: sev_order.get(x["severity"], 5))

    return {
        "total_signals": len(signals_list),
        "signals": signals_list[:50],
        "data_quality": {k: "ok" if "error" not in results.get(k, {}) else "error" for k in results},
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Nuclear Facilities (static — IAEA + public domain)
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/nuclear")
async def nuclear_facilities(status: str = "", facility_type: str = ""):
    items = NUCLEAR_FACILITIES
    if status:
        items = [f for f in items if f.get("status") == status]
    if facility_type:
        items = [f for f in items if f.get("type") == facility_type]
    return {
        "source": "IAEA+NTI+static",
        "count": len(items),
        "facilities": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Military Bases (static — ASIAR/HKU + public domain)
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/military-bases")
async def military_bases(type: str = "", country: str = ""):
    items = MILITARY_BASES
    if type:
        items = [b for b in items if b.get("type") == type]
    if country:
        country_lower = country.lower()
        items = [b for b in items if country_lower in b.get("country", "").lower()]
    return {
        "source": "ASIAR/HKU+public-domain",
        "count": len(items),
        "bases": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Gamma Irradiators (static — IAEA DIIF database)
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/gamma-irradiators")
async def gamma_irradiators(country: str = ""):
    items = GAMMA_IRRADIATORS
    if country:
        country_lower = country.lower()
        items = [g for g in items if country_lower in g.get("country", "").lower()]
    return {
        "source": "IAEA-DIIF-static",
        "count": len(items),
        "irradiators": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Strategic Ports (static — public domain)
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/ports")
async def strategic_ports(port_type: str = "", country: str = ""):
    items = PORTS
    if port_type:
        items = [p for p in items if p.get("type") == port_type]
    if country:
        country_lower = country.lower()
        items = [p for p in items if country_lower in p.get("country", "").lower()]
    return {
        "source": "public-domain",
        "count": len(items),
        "ports": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Pipelines (static — Global Energy Monitor + EIA)
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/pipelines")
async def pipelines(pipeline_type: str = "", status: str = ""):
    items = PIPELINES
    if pipeline_type:
        items = [p for p in items if p.get("type") == pipeline_type]
    if status:
        items = [p for p in items if p.get("status") == status]
    return {
        "source": "Global-Energy-Monitor+EIA-static",
        "count": len(items),
        "pipelines": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Strategic Waterways (static)
# ──────────────────────────────────────────────────────────────
@app.get("/api/geo/waterways")
async def waterways():
    return {
        "source": "static",
        "count": len(STRATEGIC_WATERWAYS),
        "waterways": STRATEGIC_WATERWAYS,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Conflict Zones (static)
# ──────────────────────────────────────────────────────────────
@app.get("/api/geo/conflict-zones")
async def conflict_zones(intensity: str = ""):
    items = CONFLICT_ZONES
    if intensity:
        items = [c for c in items if c.get("intensity") == intensity]
    return {
        "source": "static",
        "count": len(items),
        "conflicts": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# Intel Hotspots (static)
# ──────────────────────────────────────────────────────────────
@app.get("/api/geo/hotspots")
async def intel_hotspots(min_score: int = 0):
    items = INTEL_HOTSPOTS
    if min_score:
        items = [h for h in items if h.get("escalationScore", 0) >= min_score]
    return {
        "source": "static",
        "count": len(items),
        "hotspots": items,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ──────────────────────────────────────────────────────────────
# APT Groups — fetched live from APTmap (andreacristaldi.github.io/APTmap)
# ──────────────────────────────────────────────────────────────
APTMAP_BASE = "https://andreacristaldi.github.io/APTmap"

_SEVERITY_CRITICAL = {"KP", "RU"}
_SEVERITY_HIGH     = {"CN", "IR", "US", "GB", "IL", "BY"}
_SEVERITY_MEDIUM   = {"IN", "PK", "VN", "KR", "SA", "EG", "TR"}


def _aptmap_severity(country: str, motivations: list) -> str:
    motiv_lower = " ".join(motivations).lower()
    if "sabotage" in motiv_lower or "destructive" in motiv_lower:
        return "critical"
    if country in _SEVERITY_CRITICAL:
        return "critical"
    if country in _SEVERITY_HIGH:
        return "high"
    if "financial" in motiv_lower:
        return "high"
    if country in _SEVERITY_MEDIUM:
        return "medium"
    return "medium" if country else "low"


def _aptmap_feature_to_group(f: dict) -> Optional[dict]:
    """Convert a GeoJSON Feature from APTmap apt.json into our internal format."""
    props = f.get("properties", {})
    geom  = f.get("geometry") or {}

    coords = geom.get("coordinates") or []
    lon = float(coords[0]) if len(coords) > 0 else 0.0
    lat = float(coords[1]) if len(coords) > 1 else 0.0

    name     = props.get("name") or ""
    aliases  = props.get("other-names") or []
    sponsor  = props.get("sponsor") or ""
    country  = (props.get("country") or "").strip()
    desc     = props.get("description") or ""
    motiv    = props.get("motivations") or []
    targets  = props.get("targets") or []
    tools    = props.get("tools") or []
    ttps_raw = props.get("TTP") or []
    first    = str(props.get("first-seen") or "")

    # Build aliases string
    alias_str = ", ".join(str(a) for a in aliases[:6]) if aliases else ""

    # Build targets string (list of country/sector strings)
    target_str = ", ".join(str(t) for t in targets[:8]) if targets else ""

    # Build TTPs string from tools names
    tool_names = []
    for t in tools[:8]:
        if isinstance(t, dict):
            tool_names.append(t.get("value") or "")
        elif isinstance(t, str):
            tool_names.append(t)
    ttp_ids = [x.get("techniqueID", "") for x in ttps_raw[:5] if isinstance(x, dict)]
    ttps_str = ", ".join(filter(None, tool_names[:5]))
    if ttp_ids:
        ttps_str += (" | " if ttps_str else "") + ", ".join(filter(None, ttp_ids[:5]))

    active_str = f"{first}–present" if first else "unknown"

    return {
        "id":          name,
        "name":        name,
        "aliases":     alias_str,
        "actor":       sponsor[:120] if sponsor else country,
        "lat":         round(lat, 5),
        "lon":         round(lon, 5),
        "target":      target_str,
        "ttps":        ttps_str,
        "active":      active_str,
        "severity":    _aptmap_severity(country, motiv),
        "description": (desc or "")[:400],
        "country":     country,
        "motivations": motiv,
        "source_url":  f"{APTMAP_BASE}/",
    }


@app.get("/api/geo/apt-groups")
async def apt_groups():
    """Fetch APT group data live from APTmap (andreacristaldi.github.io/APTmap)."""
    cached = cache_get("aptmap_groups")
    if cached:
        return cached

    url = f"{APTMAP_BASE}/apt.json"
    groups: List[dict] = []
    try:
        raw = await fetch_json(url, ttl=86400, timeout=20.0)
        features = raw.get("features") or []
        for f in features:
            try:
                g = _aptmap_feature_to_group(f)
                if g:
                    groups.append(g)
            except Exception:
                pass
    except Exception as e:
        # Graceful degradation — return empty list with error note
        result = {
            "source": "APTmap (fetch failed)",
            "count": 0,
            "groups": [],
            "error": str(e),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        return result

    result = {
        "source": f"APTmap — {APTMAP_BASE}",
        "count": len(groups),
        "groups": groups,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    cache_set("aptmap_groups", result, 86400)
    return result


# ──────────────────────────────────────────────────────────────
# Submarine Cables — TeleGeography open data
# ──────────────────────────────────────────────────────────────
@app.get("/api/infrastructure/cables")
async def submarine_cables():
    """TeleGeography SubmarineCableMap open GeoJSON data."""
    url = "https://submarinecablemap.com/api/v3/cable/cable-geo.json"
    try:
        data = await fetch_json(url, ttl=86400, timeout=30.0)
        cables = []
        for c in data.get("features", [])[:120]:  # cap at 120 cables
            props = c.get("properties", {})
            geom  = c.get("geometry", {})
            coords_raw = geom.get("coordinates", [])
            # MultiLineString or LineString
            if geom.get("type") == "MultiLineString":
                segments = coords_raw
            elif geom.get("type") == "LineString":
                segments = [coords_raw]
            else:
                segments = []
            # Thin segments — keep every 5th point
            thinned = []
            for seg in segments:
                thinned.append(seg[::5] if len(seg) > 20 else seg)
            cables.append({
                "id": props.get("id", ""),
                "name": props.get("name", "Unknown Cable"),
                "color": props.get("color", "#38bdf8"),
                "rfs": props.get("rfs"),
                "length": props.get("length"),
                "owners": props.get("owners", []),
                "landing_points": props.get("landing_points", []),
                "segments": thinned,
            })
        return {
            "source": "TeleGeography SubmarineCableMap",
            "count": len(cables),
            "cables": cables,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(502, f"Cables fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# Ransomware / Threat-actor live group data
# ──────────────────────────────────────────────────────────────
@app.get("/api/threats/ransomware-map")
async def ransomware_map():
    """Ransomware.live public API — active groups with country attribution."""
    try:
        groups_url = "https://api.ransomware.live/v2/groups"
        data = await fetch_json(groups_url, ttl=3600, timeout=15.0)
        # Country → lat/lon lookup (simplified)
        country_coords = {
            "Russia": (55.75, 37.62), "Ukraine": (50.45, 30.52), "China": (39.91, 116.39),
            "Iran": (35.69, 51.42), "North Korea": (39.02, 125.75), "Romania": (44.43, 26.1),
            "Belarus": (53.9, 27.57), "India": (28.63, 77.22), "Brazil": (15.77, -47.93),
            "USA": (38.9, -77.04), "Germany": (52.52, 13.4), "Netherlands": (52.08, 5.3),
            "Turkey": (39.93, 32.86), "Unknown": (0, 0),
        }
        out = []
        for g in (data if isinstance(data, list) else data.get("groups", [])):
            name = g.get("name") or g.get("group", "Unknown")
            country = g.get("country") or "Unknown"
            coords = country_coords.get(country, (0, 0))
            out.append({
                "name": name,
                "country": country,
                "lat": coords[0], "lon": coords[1],
                "active": g.get("active", True),
                "description": g.get("description", ""),
                "first_seen": g.get("first_seen", ""),
                "last_seen": g.get("last_seen", ""),
                "victims": g.get("victims", 0),
            })
        return {"source": "ransomware.live", "count": len(out), "groups": out}
    except Exception as e:
        # Static fallback
        return {
            "source": "static",
            "count": 8,
            "groups": [
                {"name": "LockBit", "country": "Russia", "lat": 55.75, "lon": 37.62, "active": True, "victims": 2000, "description": "Most prolific RaaS operation"},
                {"name": "ALPHV/BlackCat", "country": "Russia", "lat": 56.0, "lon": 38.0, "active": False, "victims": 500, "description": "Rust-based RaaS, FBI disrupted 2023"},
                {"name": "Cl0p", "country": "Ukraine", "lat": 50.1, "lon": 30.0, "active": True, "victims": 300, "description": "MOVEit campaign, FIN11 affiliated"},
                {"name": "RansomHub", "country": "Unknown", "lat": 0, "lon": 0, "active": True, "victims": 200, "description": "LockBit successor"},
                {"name": "Lazarus/Andariel", "country": "North Korea", "lat": 39.02, "lon": 125.75, "active": True, "victims": 150, "description": "DPRK state-sponsored ransomware"},
                {"name": "SamSam", "country": "Iran", "lat": 35.69, "lon": 51.42, "active": False, "victims": 200, "description": "Iranian threat actor disrupted 2018"},
                {"name": "Play", "country": "Russia", "lat": 55.5, "lon": 37.0, "active": True, "victims": 300, "description": "Double-extortion RaaS"},
                {"name": "8Base", "country": "Unknown", "lat": 1.0, "lon": 1.0, "active": True, "victims": 350, "description": "Phobos-based RaaS group"},
            ]
        }


# ──────────────────────────────────────────────────────────────
# AI — Ollama Qwen3 proxy (natural language → map commands)
# ──────────────────────────────────────────────────────────────
@app.post("/api/ai/chat")
async def ai_chat(payload: dict):
    """
    Intelligent AI analyst.  Tries Ollama first, falls back to built-in NLP.
    Returns {reply, actions, source} where actions drive the map.
    """
    # Disable AI chat on Vercel (no persistent process / Ollama unavailable)
    if IS_VERCEL:
        return {
            "reply": "⚠️ AI Analyst is disabled in the Vercel deployment (requires local Ollama or server process). Run locally with `uvicorn main:app` for full AI capabilities.",
            "actions": [],
            "source": "disabled",
        }
    messages  = payload.get("messages", [])
    context   = payload.get("context", "")
    model     = payload.get("model", "qwen3:latest")
    user_text = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")

    # ── Rich system prompt ────────────────────────────────────────────────────
    # Fetch live DB ship count to inject into system prompt
    _live_ship_count = await _db_total_count()
    _poll_src = _ship_poll_stats.get("last_source", "unknown")
    _last_poll = _ship_poll_stats.get("last_poll", "never")

    SYSTEM = f"""You are SoTaNik, an elite AI surveillance analyst embedded in a real-time geopolitical intelligence dashboard called SoTaNik_AI Surveillance.

Current live data state (as of right now):
- Maritime database: {_live_ship_count:,} vessels in local SQLite DB (source: {_poll_src}, last updated: {_last_poll})
- Ship data is polled every 45 seconds globally and stored in ships.db — you have real positional awareness
- All positions are real AIS transponder data — no simulated vessels

Your capabilities:
- Full knowledge of global geopolitics, military conflicts, cyber threats, APT groups, ransomware gangs
- Real-time maritime awareness: live vessel counts, positions, types (cargo, tanker, passenger, military, fishing)
- Real-time data awareness: earthquakes, wildfires, disasters, aviation, nuclear sites, military bases, pipelines, undersea cables, maritime chokepoints (Suez, Hormuz, Malacca, Bab-el-Mandeb, Bosphorus), satellites, conflict zones
- Intelligence analysis: threat actor attribution, TTPs, country profiles, shipping lane disruptions, naval movements
- Can correlate maritime traffic with geopolitical events (sanctions evasion, shadow fleet, naval exercises)

CRITICAL: You MUST respond with ONLY valid JSON — no markdown fences, no preamble:
{{"reply": "Your detailed analytical response here", "actions": [...]}}

Action types:
- {{"type": "flyTo", "lat": 35.6, "lon": 51.4, "zoom": 6}}
- {{"type": "toggleLayer", "layer": "LAYERNAME"}}  — layers: earthquakes, fires, disasters, aviation, nuclear, military, pipelines, ports, cables, waterways, hotspots, conflicts, gamma, apt, ransomwareMap, satellites, ships, chokepoints
- {{"type": "showPanel", "panel": "threats"|"news"|"markets"|"map"}}
- {{"type": "filterRegion", "region": "europe"|"mena"|"asia"|"americas"|"africa"}}

Rules:
1. Always include "reply" with 3-5 sentences of authoritative analysis
2. Reference specific live data where relevant (vessel counts, chokepoints, active tensions)
3. Always flyTo correct coordinates for any location query
4. For maritime queries: enable ships layer, fly to relevant chokepoint/region
5. For threat actor queries: enable apt layer, fly to origin country capital
6. Cross-reference shipping patterns with geopolitical context when relevant
7. Use intelligence-analyst tone: specific, confident, data-driven
8. Never leave actions as null — use [] if no map action needed"""

    full_messages = [{"role": "system", "content": SYSTEM}]
    if context:
        full_messages.append({"role": "system", "content": f"Live dashboard context: {context}"})
    full_messages.extend(messages)

    # ── Try Ollama ────────────────────────────────────────────────────────────
    ollama_reply = None
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.post(
                "http://127.0.0.1:11434/api/chat",
                json={"model": model, "messages": full_messages, "stream": False},
            )
            r.raise_for_status()
            raw_content = r.json().get("message", {}).get("content", "")
            # Strip markdown fences if present
            clean = raw_content.strip()
            if clean.startswith("```"):
                clean = "\n".join(clean.split("\n")[1:])
                clean = clean.rstrip("`").strip()
            parsed = json.loads(clean)
            return {
                "reply":   parsed.get("reply", clean),
                "actions": parsed.get("actions", []),
                "source":  "ollama",
            }
    except Exception:
        pass  # Fall through to built-in intelligence

    # ── Built-in intelligence layer (no external deps) ────────────────────────
    result = _builtin_ai(user_text, context)
    return result


# Geo coordinates for known entities
_GEO = {
    # Countries
    "russia":("Russia",55.75,37.61,5),"china":("China",35.86,104.19,4),
    "usa":("USA",38.89,-77.03,4),"united states":("USA",38.89,-77.03,4),
    "ukraine":("Ukraine",50.45,30.52,5),"iran":("Iran",35.68,51.42,5),
    "israel":("Israel",31.77,35.21,7),"north korea":("North Korea",39.02,125.75,6),
    "pakistan":("Pakistan",33.72,73.06,5),"india":("India",20.59,78.96,4),
    "taiwan":("Taiwan",23.69,120.96,7),"syria":("Syria",33.51,36.29,6),
    "iraq":("Iraq",33.34,44.40,6),"afghanistan":("Afghanistan",33.93,67.70,5),
    "yemen":("Yemen",15.55,48.51,5),"somalia":("Somalia",5.15,46.20,5),
    "libya":("Libya",26.33,17.23,5),"sudan":("Sudan",12.86,30.22,5),
    "nigeria":("Nigeria",9.08,8.67,5),"ethiopia":("Ethiopia",9.14,40.49,5),
    "brazil":("Brazil",-14.23,-51.92,4),"mexico":("Mexico",23.63,-102.55,5),
    "germany":("Germany",51.16,10.45,5),"france":("France",46.22,2.21,5),
    "uk":("UK",55.37,-3.43,5),"united kingdom":("UK",55.37,-3.43,5),
    "japan":("Japan",36.20,138.25,5),"south korea":("South Korea",35.90,127.76,5),
    "saudi arabia":("Saudi Arabia",23.88,45.07,5),"turkey":("Turkey",38.96,35.24,5),
    "egypt":("Egypt",26.82,30.80,5),"malaysia":("Malaysia",4.21,108.09,5),
    "indonesia":("Indonesia",-0.78,113.92,4),"philippines":("Philippines",12.87,121.77,4),
    "vietnam":("Vietnam",14.05,108.27,5),"myanmar":("Myanmar",21.91,95.95,5),
    "venezuela":("Venezuela",6.42,-66.58,5),"colombia":("Colombia",4.57,-74.29,5),
    # Regions
    "europe":("Europe",52.00,14.00,4),"asia":("Asia",30.00,105.00,3),
    "middle east":("Middle East",27.00,43.00,5),"africa":("Africa",5.00,20.00,3),
    "south america":("South America",-15.00,-55.00,3),"north america":("North America",45.00,-95.00,3),
    "southeast asia":("SE Asia",5.00,105.00,4),"east asia":("East Asia",35.00,115.00,4),
    "central asia":("Central Asia",45.00,65.00,4),
    # Strategic locations
    "suez canal":("Suez Canal",30.60,32.35,8),"strait of hormuz":("Strait of Hormuz",26.60,56.50,8),
    "south china sea":("South China Sea",12.00,114.00,5),
    "black sea":("Black Sea",42.50,33.50,6),"persian gulf":("Persian Gulf",26.00,52.00,6),
    "red sea":("Red Sea",20.00,38.00,5),"mediterranean":("Mediterranean",35.00,18.00,5),
    "arctic":("Arctic",80.00,0.00,3),"ukraine front":("Ukraine Front",48.50,33.50,6),
    "gaza":("Gaza",31.35,34.45,10),"taiwan strait":("Taiwan Strait",24.50,119.50,7),
    # Cities
    "moscow":("Moscow",55.75,37.61,8),"beijing":("Beijing",39.91,116.39,8),
    "washington":("Washington DC",38.89,-77.03,9),"kyiv":("Kyiv",50.45,30.52,9),
    "tehran":("Tehran",35.68,51.42,9),"tel aviv":("Tel Aviv",32.08,34.78,10),
    "pyongyang":("Pyongyang",39.02,125.75,10),"tokyo":("Tokyo",35.68,139.69,9),
}

# Threat actor database
_THREAT_ACTORS = {
    "lazarus":("North Korean APT — Lazarus Group (HIDDEN COBRA). Linked to DPRK Reconnaissance General Bureau. Known for financial theft, cryptocurrency heists ($3B+), ransomware (WannaCry), Sony Pictures hack.",39.02,125.75),
    "apt28":("Russian APT28 (Fancy Bear / Sofacy). GRU Unit 26165. Known for election interference (2016 US, French, German), phishing campaigns, aviation sector attacks.",55.75,37.61),
    "apt29":("Russian APT29 (Cozy Bear). SVR Foreign Intelligence. Known for SolarWinds supply chain attack, COVID-19 vaccine research theft, US government intrusions.",55.75,37.61),
    "sandworm":("Russian Sandworm (GRU Unit 74455). Responsible for NotPetya ($10B global damage), Ukraine power grid attacks (2015, 2016), Olympic Destroyer.",55.75,37.61),
    "apt41":("Chinese APT41 (Double Dragon). Dual espionage and financially motivated. Targets healthcare, telecoms, video games. Also known as Winnti.",35.86,104.19),
    "apt1":("Chinese APT1 (Comment Crew / PLA Unit 61398). Stole 6.5TB of data, ~141 companies across 20 industries over 7 years.",35.86,104.19),
    "equation group":("NSA-linked Equation Group. Most sophisticated APT known. Created precursors to Stuxnet. Known for QUANTUM insertion, disk firmware implants.",38.89,-77.03),
    "lockbit":("LockBit — Most prolific ransomware gang 2022–2024. RaaS model. 2,000+ victims globally. Infrastructure dismantled by Operation Cronos (Feb 2024) but reformed.",55.00,37.00),
    "blackcat":("ALPHV/BlackCat — Rust-based RaaS. Targeted MGM Resorts, Change Healthcare ($22M ransom). FBI seized infrastructure Dec 2023.",55.00,37.00),
    "clop":("Cl0p — Russian-linked ransomware. MOVEit Transfer exploitation (2023) — 2,600+ organizations, 83M+ individuals. Healthcare focus.",55.00,37.00),
    "scattered spider":("Scattered Spider (UNC3944). English-speaking social engineering specialists. Defeated MGM, Caesars MFA. Teen threat actors, US/UK based.",38.89,-77.03),
}


def _builtin_ai(user_text: str, context: str) -> dict:
    """Rule-based intelligence layer — always available, no external deps."""
    import re
    q = user_text.lower().strip()
    actions: list = []
    reply = ""

    # ── Threat actor lookup ───────────────────────────────────────────────────
    for actor, (desc, lat, lon) in _THREAT_ACTORS.items():
        if actor in q:
            reply = f"🔍 **{actor.upper()}** — {desc}"
            actions = [
                {"type": "toggleLayer", "layer": "apt"},
                {"type": "flyTo", "lat": lat, "lon": lon, "zoom": 6},
            ]
            if "ransomware" in actor or actor in ("lockbit","blackcat","clop","scattered spider"):
                actions.append({"type": "toggleLayer", "layer": "ransomwareMap"})
            return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Ships / maritime queries ──────────────────────────────────────────────
    if any(w in q for w in ["ship","vessel","ais","maritime","fleet","cargo","tanker","ferry","navy","port","harbor"]):
        actions.append({"type": "toggleLayer", "layer": "ships"})
        for loc, (name, lat, lon, zoom) in _GEO.items():
            if loc in q:
                actions.append({"type": "flyTo", "lat": lat, "lon": lon, "zoom": zoom})
                reply = f"🚢 Enabling maritime traffic layer. Showing vessels near **{name}**. Ship data is sourced from AISHub AIS transponders covering commercial shipping lanes, tankers, passenger ferries and cargo vessels in this region."
                break
        if not reply:
            reply = "🚢 Enabling global maritime traffic layer. Live AIS positions of cargo ships 🚢, tankers 🛢, passenger vessels 🛳, military ships ⚓, fishing boats 🎣 and service vessels are now visible. Click any vessel for MMSI, destination, speed and heading data."
        actions.append({"type": "toggleLayer", "layer": "ports"})
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Satellite queries ─────────────────────────────────────────────────────
    if any(w in q for w in ["satellite","iss","orbit","starlink","gps satellite","space station","celestrak"]):
        actions.append({"type": "toggleLayer", "layer": "satellites"})
        if "iss" in q or "space station" in q:
            reply = "🛸 Tracking the ISS (International Space Station). It orbits at ~408 km altitude, completing 15.5 orbits per day at 7.66 km/s. Current real-time position is shown via Open Notify API."
        elif "starlink" in q:
            reply = "🛰 Displaying Starlink constellation — SpaceX's LEO broadband network. Currently 5,400+ active satellites in ~550km orbit. Provides global internet coverage including to Ukraine conflict zones."
        elif "gps" in q:
            reply = "🛰 GPS satellite constellation visible — 31 operational satellites maintained by US Space Force in MEO (20,200 km). Provides global positioning accuracy of ~1–3 meters."
        else:
            reply = "🛰 Enabling satellite tracking layer. Showing CelesTrak-sourced orbital objects including ISS 🛸, GPS constellation, Starlink, weather satellites and military reconnaissance assets. Positions are estimated from TLE data."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Nuclear queries ───────────────────────────────────────────────────────
    if any(w in q for w in ["nuclear","nuke","atomic","reactor","enrichment","uranium","plutonium","warhead","missile"]):
        actions.append({"type": "toggleLayer", "layer": "nuclear"})
        if "iran" in q:
            actions.append({"type": "flyTo", "lat": 32.43, "lon": 53.68, "zoom": 6})
            reply = "☢️ Iran's nuclear program: Key sites include Natanz (enrichment, ~60% U-235 enrichment reported), Fordow (buried enrichment facility), Arak (IR-40 heavy water reactor), and Bushehr (operational power reactor). IAEA access has been significantly restricted since 2021."
        elif "north korea" in q or "dprk" in q:
            actions.append({"type": "flyTo", "lat": 40.72, "lon": 129.07, "zoom": 7})
            reply = "☢️ DPRK nuclear capability: Estimated 40–50 warheads as of 2024. Yongbyon Nuclear Scientific Research Centre remains the primary facility. 6+ intercontinental ballistic missile (ICBM) types tested. Reprocessing capacity ~6kg plutonium/year."
        elif "russia" in q:
            actions.append({"type": "flyTo", "lat": 55.75, "lon": 37.61, "zoom": 5})
            reply = "☢️ Russia holds the world's largest nuclear arsenal: ~5,580 warheads (1,674 deployed). Strategic forces include RS-28 Sarmat ICBMs, Bulava SLBMs (Borei-class submarines), and Tu-160 strategic bombers. Tactical nuclear doctrine actively updated."
        else:
            reply = "☢️ Enabling nuclear facilities layer. Displays power reactors, enrichment plants, research reactors, and suspected weapons facilities globally. Data sourced from IAEA, NTI, and public intelligence assessments."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Conflict / war queries ────────────────────────────────────────────────
    if any(w in q for w in ["war","conflict","battle","fighting","attack","army","military operation","occupation","troops"]):
        actions.append({"type": "toggleLayer", "layer": "conflicts"})
        actions.append({"type": "toggleLayer", "layer": "military"})
        if "ukraine" in q or "russia" in q:
            actions.append({"type": "flyTo", "lat": 48.5, "lon": 33.5, "zoom": 6})
            reply = "⚔️ Russia-Ukraine War (Feb 2022–present): Active frontline spans ~1,000 km. Key contested areas: Kherson, Zaporizhzhia, Donetsk, Luhansk oblasts. Russia controls ~18% of Ukraine territory. War has caused 200,000+ military casualties (est.) and 10M+ displaced. NATO Article 5 tripwire concerns remain elevated."
        elif "gaza" in q or "israel" in q or "hamas" in q:
            actions.append({"type": "flyTo", "lat": 31.35, "lon": 34.45, "zoom": 9})
            reply = "⚔️ Israel-Gaza conflict (Oct 2023–present): IDF ground and air operations following Hamas Oct 7 attack (1,200 Israeli killed, 250 hostages). Gaza civilian death toll exceeds 40,000. Regional escalation risk: Hezbollah (Lebanon), Houthi (Yemen), Iran proxies."
        elif "sudan" in q:
            actions.append({"type": "flyTo", "lat": 15.50, "lon": 32.55, "zoom": 6})
            reply = "⚔️ Sudan civil war (Apr 2023–present): SAF vs RSF paramilitary conflict. 8M+ displaced — world's largest displacement crisis. Darfur facing genocide conditions. Khartoum divided. No credible ceasefire process."
        else:
            reply = "⚔️ Enabling active conflict zones and military bases layer. Shows ongoing armed conflicts, frontlines, and military installations worldwide tracked via ACLED, UCDP, and open-source intelligence."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Cyber/APT/ransomware queries ──────────────────────────────────────────
    if any(w in q for w in ["cyber","apt","hacker","ransomware","malware","phishing","c2","command and control","breach","intrusion"]):
        actions.append({"type": "toggleLayer", "layer": "apt"})
        if "ransomware" in q:
            actions.append({"type": "toggleLayer", "layer": "ransomwareMap"})
            reply = "🛡️ Ransomware threat landscape: LockBit (most prolific, 2,000+ victims), ALPHV/BlackCat (healthcare focus), Cl0p (MOVEit exploitation, 83M+ individuals), RansomHub (emerging). RaaS model dominates — affiliates conduct attacks, core team provides infrastructure. Average ransom demand: $1.5M (2024)."
        elif "china" in q or "apt41" in q or "apt1" in q:
            actions.append({"type": "flyTo", "lat": 35.86, "lon": 104.19, "zoom": 5})
            reply = "🇨🇳 Chinese APT ecosystem: APT41 (espionage + financial), APT1/Comment Crew (industrial espionage), Volt Typhoon (critical infrastructure pre-positioning), Salt Typhoon (telecom compromise — US carrier networks breached 2024). MSS and PLA Unit 61398 primary sponsors."
        elif "russia" in q:
            actions.append({"type": "flyTo", "lat": 55.75, "lon": 37.61, "zoom": 5})
            reply = "🇷🇺 Russian offensive cyber: APT28/Fancy Bear (GRU, espionage), APT29/Cozy Bear (SVR, SolarWinds), Sandworm (GRU, destructive — NotPetya, power grid attacks), Turla (FSB, decades of espionage). Ukraine conflict has intensified cyberwar operations significantly."
        else:
            reply = "🔴 Enabling global APT activity layer. Showing nation-state threat actor geolocations, C2 infrastructure, and active campaign indicators. Sources: APTmap, AbuseCH Feodo, URLhaus."
        actions.append({"type": "showPanel", "panel": "threats"})
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Earthquake / natural disaster queries ─────────────────────────────────
    if any(w in q for w in ["earthquake","seismic","quake","tremor","magnitude"]):
        actions.append({"type": "toggleLayer", "layer": "earthquakes"})
        reply = "🌍 Enabling seismic monitoring layer. Real-time earthquake data from USGS. Magnitude thresholds: M2.5+ (all regions), M1.0+ (US). Color coding: 🟢 Low (M<3), 🟡 Moderate (M3–5), 🔴 High (M5–7), ⬛ Major (M7+)."
        for loc, (name, lat, lon, zoom) in _GEO.items():
            if loc in q:
                actions.append({"type": "flyTo", "lat": lat, "lon": lon, "zoom": zoom})
                reply = f"🌍 Seismic activity near {name}: monitoring active. USGS reports all M2.5+ events within 24h. This region sits on {_seismic_context(loc)}."
                break
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Wildfire queries ──────────────────────────────────────────────────────
    if any(w in q for w in ["fire","wildfire","blaze","burn","forest fire"]):
        actions.append({"type": "toggleLayer", "layer": "fires"})
        reply = "🔥 FIRMS wildfire layer enabled. NASA FIRMS VIIRS/MODIS satellite fire detection — 375m resolution, 3-hour latency. Shows active fire hotspots globally."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Location/region flyTo queries ─────────────────────────────────────────
    for loc, (name, lat, lon, zoom) in _GEO.items():
        if loc in q:
            actions.append({"type": "flyTo", "lat": lat, "lon": lon, "zoom": zoom})
            # Add contextually relevant layers
            if any(w in q for w in ["show","display","watch","monitor","zoom","go to","look at","where is","find"]):
                reply = f"📍 Flying to **{name}**. This geopolitical area is actively monitored across all intelligence layers. Enable specific overlays to view conflicts, infrastructure, cyber threats, or environmental events."
            else:
                reply = f"📍 Navigating to **{name}**."
            return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Infrastructure queries ────────────────────────────────────────────────
    if any(w in q for w in ["pipeline","gas","oil","energy"]):
        actions.append({"type": "toggleLayer", "layer": "pipelines"})
        reply = "🛢️ Energy infrastructure layer enabled. Shows major oil pipelines, natural gas pipelines, and critical energy corridors. Key chokepoints: Strait of Hormuz (17M bbl/day), Bab-el-Mandeb (6M bbl/day)."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    if any(w in q for w in ["cable","undersea","submarine cable","internet"]):
        actions.append({"type": "toggleLayer", "layer": "cables"})
        reply = "🌊 Undersea cable infrastructure layer enabled. 485+ active submarine cables carry 95% of intercontinental internet traffic. Key vulnerability zones: Red Sea (Houthi interference), Taiwan Strait, Arctic routes."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    if any(w in q for w in ["chokepoint","strait","channel","passage","bosphorus","hormuz","malacca"]):
        actions.append({"type": "toggleLayer", "layer": "chokepoints"})
        reply = "⚓ Strategic maritime chokepoints layer enabled. Key choke points: Strait of Hormuz (40% seaborne oil), Strait of Malacca (1/3 global trade), Bab-el-Mandeb (Red Sea gateway), Bosphorus/Dardanelles (Russian naval access)."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Market / financial queries ────────────────────────────────────────────
    if any(w in q for w in ["market","stock","crypto","bitcoin","oil price","gold","sanction","economy"]):
        actions.append({"type": "showPanel", "panel": "markets"})
        reply = "📊 Opening market intelligence dashboard. Live feeds: major indices (S&P 500, FTSE, Nikkei, DAX), commodities (WTI crude, Brent, gold, gas), FX rates, and crypto markets. Data sources: Yahoo Finance, CoinGecko."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── News queries ──────────────────────────────────────────────────────────
    if any(w in q for w in ["news","headline","latest","recent","what happened","update","brief"]):
        actions.append({"type": "showPanel", "panel": "news"})
        reply = "📡 Opening global news intelligence feed. Aggregating sources: Reuters, BBC, Al Jazeera, The Guardian, AP, DW, Aljazeera. Filtered for geopolitical significance. Stories ranked by severity and recency."
        return {"reply": reply, "actions": actions, "source": "builtin"}

    # ── Status / help queries ─────────────────────────────────────────────────
    if any(w in q for w in ["help","what can","capabilities","commands","what do","how to"]):
        reply = """🧠 **SoTaNik AI Surveillance — Capabilities:**

**Map Layers:** Ask me to show earthquakes 🌍, wildfires 🔥, conflicts ⚔️, nuclear sites ☢️, military bases 🎯, ships 🚢, satellites 🛰, APT groups 🔴, ransomware 🏴‍☠️, pipelines 🛢, undersea cables 🌊, ports ⚓, and more.

**Intelligence Queries:** Ask about specific countries, threat actors (LockBit, APT28, Lazarus), ongoing conflicts, cybersecurity incidents, or geopolitical situations.

**Navigation:** "Zoom to Ukraine", "Show me the South China Sea", "Where is Strait of Hormuz"

**Analysis:** "What is the cyber threat from Russia?", "Tell me about DPRK nuclear capability", "Explain the Red Sea crisis"

**Data:** "Show me the news", "Open markets dashboard", "Track ships near Suez" """
        return {"reply": reply, "actions": [], "source": "builtin"}

    # ── Default context-aware response ───────────────────────────────────────
    reply = f"🧠 I'm analysing your query: \"{user_text}\". I can help you visualise geopolitical intelligence, track threats, monitor conflicts, ships, satellites, and analyse threat actors. Try asking: \"show conflicts in Middle East\", \"track ships near Suez\", \"show APT groups linked to Russia\", or \"zoom to Taiwan Strait\"."
    return {"reply": reply, "actions": [], "source": "builtin"}


def _seismic_context(loc: str) -> str:
    contexts = {
        "japan": "the seismically active Pacific Ring of Fire (Eurasian/Pacific/Philippine plate boundaries)",
        "turkey": "the North Anatolian Fault — one of the world's most seismically active strike-slip faults",
        "iran": "the convergence of Arabian and Eurasian plates — the Alborz and Zagros mountain systems",
        "indonesia": "the Sunda megathrust (Ring of Fire) — site of the 2004 M9.1 Indian Ocean earthquake",
        "usa": "a tectonically diverse zone — San Andreas (California), Cascadia subduction zone (Pacific NW)",
        "chile": "the Nazca-South American subduction zone — most seismically active zone on Earth",
        "china": "multiple fault systems: Tibetan Plateau collision, North China Craton faults",
        "new zealand": "the Alpine Fault and Hikurangi subduction zone (Pacific/Australian plates)",
    }
    return contexts.get(loc, "an active tectonic zone — monitor USGS for M5+ events")


# ──────────────────────────────────────────────────────────────
# Markets — Global indices via Stooq (no key, fast)
# ──────────────────────────────────────────────────────────────
@app.get("/api/markets/global")
async def markets_global():
    """Global market snapshot: major indices + commodities + FX from multiple sources."""
    # Use Yahoo Finance v8 which still works without a key
    SYMBOLS = {
        # US
        "S&P 500": "^GSPC", "NASDAQ": "^IXIC", "Dow Jones": "^DJI", "Russell 2000": "^RUT",
        # Europe
        "FTSE 100": "^FTSE", "DAX": "^GDAXI", "CAC 40": "^FCHI", "Euro Stoxx 50": "^STOXX50E",
        # Asia
        "Nikkei 225": "^N225", "Hang Seng": "^HSI", "Shanghai Comp": "000001.SS", "KOSPI": "^KS11",
        # Commodities
        "Gold": "GC=F", "Silver": "SI=F", "Crude Oil WTI": "CL=F", "Brent Crude": "BZ=F",
        "Natural Gas": "NG=F", "Copper": "HG=F", "Wheat": "ZW=F", "Corn": "ZC=F",
        # FX
        "EUR/USD": "EURUSD=X", "USD/JPY": "JPY=X", "GBP/USD": "GBPUSD=X",
        "USD/CNY": "CNY=X", "USD/RUB": "RUB=X", "DXY": "DX-Y.NYB",
        # Rates
        "10Y UST": "^TNX", "2Y UST": "^IRX", "VIX": "^VIX",
    }
    results = []
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=20.0) as client:
        for name, ticker in SYMBOLS.items():
            cached = cache_get(f"mktg_{ticker}")
            if cached:
                results.append(cached)
                continue
            try:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1d&range=5d"
                )
                if r.status_code != 200:
                    continue
                d = r.json()
                meta = d.get("chart", {}).get("result", [{}])[0].get("meta", {})
                price = meta.get("regularMarketPrice") or meta.get("chartPreviousClose") or 0
                prev  = meta.get("chartPreviousClose") or meta.get("previousClose") or price
                chg   = ((price - prev) / prev * 100) if prev else 0
                # Classify
                cat = ("indices" if ticker.startswith("^") or ticker.endswith(".SS") or ticker == "^KS11"
                       else "commodities" if ticker.endswith("=F")
                       else "fx" if "USD" in ticker or "=X" in ticker or "=Y" in ticker
                       else "rates")
                entry = {
                    "name": name, "ticker": ticker, "price": round(price, 4),
                    "change_pct": round(chg, 2), "currency": meta.get("currency", "USD"),
                    "exchange": meta.get("exchangeName", ""),
                    "direction": "up" if chg > 0 else "down" if chg < 0 else "flat",
                    "category": cat,
                }
                cache_set(f"mktg_{ticker}", entry, 300)
                results.append(entry)
                await asyncio.sleep(0.08)
            except Exception:
                continue
    return {"source": "Yahoo Finance", "count": len(results), "quotes": results,
            "generated_at": datetime.now(timezone.utc).isoformat()}


# ──────────────────────────────────────────────────────────────
# BLOOMBERG TERMINAL — Extended Market Data Endpoints
# ──────────────────────────────────────────────────────────────

@app.get("/api/markets/stock/{ticker}")
async def stock_detail(ticker: str):
    """Full real-time stock quote: price, pre/post market, OHLCV, 52-wk, volume."""
    t = ticker.upper().replace("-", "=")
    url = f"https://query2.finance.yahoo.com/v7/finance/quote?symbols={t}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=10) as c:
            r = await c.get(url)
        data = r.json()
        result = data.get("quoteResponse", {}).get("result", [])
        if not result:
            raise HTTPException(404, f"Ticker {ticker} not found")
        q = result[0]
        price = q.get("regularMarketPrice", 0)
        prev  = q.get("regularMarketPreviousClose", price) or price
        chg_pct = ((price - prev) / prev * 100) if prev else 0
        return {
            "ticker": q.get("symbol"),
            "name": q.get("longName") or q.get("shortName", ticker),
            "price": price,
            "change": round(q.get("regularMarketChange", 0), 4),
            "change_pct": round(chg_pct, 2),
            "open": q.get("regularMarketOpen"),
            "high": q.get("regularMarketDayHigh"),
            "low": q.get("regularMarketDayLow"),
            "prev_close": prev,
            "volume": q.get("regularMarketVolume"),
            "avg_volume": q.get("averageDailyVolume3Month"),
            "market_cap": q.get("marketCap"),
            "pe_ratio": q.get("trailingPE"),
            "forward_pe": q.get("forwardPE"),
            "eps": q.get("epsTrailingTwelveMonths"),
            "dividend_yield": q.get("dividendYield"),
            "beta": q.get("beta"),
            "week52_high": q.get("fiftyTwoWeekHigh"),
            "week52_low": q.get("fiftyTwoWeekLow"),
            "pre_market_price": q.get("preMarketPrice"),
            "pre_market_change_pct": round(q.get("preMarketChangePercent", 0), 2),
            "post_market_price": q.get("postMarketPrice"),
            "post_market_change_pct": round(q.get("postMarketChangePercent", 0), 2),
            "market_state": q.get("marketState", "CLOSED"),
            "exchange": q.get("fullExchangeName", ""),
            "currency": q.get("currency", "USD"),
            "direction": "up" if chg_pct > 0 else "down" if chg_pct < 0 else "flat",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Stock detail failed: {e}")


@app.get("/api/markets/fundamentals/{ticker}")
async def stock_fundamentals(ticker: str):
    """Full fundamentals: financials, key stats, analyst targets, earnings."""
    t = ticker.upper()
    modules = "financialData,defaultKeyStatistics,summaryDetail,earningsHistory,recommendationTrend"
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{t}?modules={modules}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15) as c:
            r = await c.get(url)
        data = r.json().get("quoteSummary", {}).get("result", [{}])[0]
        fd = data.get("financialData", {})
        ks = data.get("defaultKeyStatistics", {})
        sd = data.get("summaryDetail", {})
        rt = data.get("recommendationTrend", {}).get("trend", [{}])
        latest_trend = rt[0] if rt else {}

        def _v(obj, key):
            val = obj.get(key)
            if isinstance(val, dict): return val.get("raw")
            return val

        return {
            "ticker": t,
            "current_price":        _v(fd, "currentPrice"),
            "target_high":          _v(fd, "targetHighPrice"),
            "target_low":           _v(fd, "targetLowPrice"),
            "target_mean":          _v(fd, "targetMeanPrice"),
            "recommendation":       fd.get("recommendationKey", "—"),
            "analyst_count":        _v(fd, "numberOfAnalystOpinions"),
            "revenue":              _v(fd, "totalRevenue"),
            "gross_profit":         _v(fd, "grossProfits"),
            "free_cashflow":        _v(fd, "freeCashflow"),
            "ebitda":               _v(fd, "ebitda"),
            "roe":                  _v(fd, "returnOnEquity"),
            "roa":                  _v(fd, "returnOnAssets"),
            "debt_to_equity":       _v(fd, "debtToEquity"),
            "gross_margin":         _v(fd, "grossMargins"),
            "profit_margin":        _v(fd, "profitMargins"),
            "trailing_eps":         _v(ks, "trailingEps"),
            "forward_eps":          _v(ks, "forwardEps"),
            "trailing_pe":          _v(ks, "trailingPE") or _v(sd, "trailingPE"),
            "forward_pe":           _v(ks, "forwardPE"),
            "peg_ratio":            _v(ks, "pegRatio"),
            "beta":                 _v(ks, "beta"),
            "short_ratio":          _v(ks, "shortRatio"),
            "short_pct_float":      _v(ks, "shortPercentOfFloat"),
            "shares_short":         _v(ks, "sharesShort"),
            "insider_pct":          _v(ks, "heldPercentInsiders"),
            "institution_pct":      _v(ks, "heldPercentInstitutions"),
            "market_cap":           _v(ks, "marketCap") or _v(sd, "marketCap"),
            "enterprise_value":     _v(ks, "enterpriseValue"),
            "dividend_yield":       _v(sd, "dividendYield"),
            "payout_ratio":         _v(sd, "payoutRatio"),
            "trend_buy":            latest_trend.get("strongBuy", 0),
            "trend_hold":           latest_trend.get("hold", 0),
            "trend_sell":           latest_trend.get("sell", 0) + latest_trend.get("strongSell", 0),
        }
    except Exception as e:
        raise HTTPException(502, f"Fundamentals failed: {e}")


@app.get("/api/markets/options/{ticker}")
async def stock_options(ticker: str):
    """Options chain: calls + puts nearest expiry."""
    t = ticker.upper()
    url = f"https://query2.finance.yahoo.com/v7/finance/options/{t}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15) as c:
            r = await c.get(url)
        chain = r.json().get("optionChain", {}).get("result", [{}])[0]
        opts  = chain.get("options", [{}])[0]
        def _clean(lst):
            out = []
            for o in (lst or [])[:20]:
                out.append({
                    "strike": o.get("strike"),
                    "last":   o.get("lastPrice"),
                    "bid":    o.get("bid"),
                    "ask":    o.get("ask"),
                    "volume": o.get("volume"),
                    "oi":     o.get("openInterest"),
                    "iv":     round(o.get("impliedVolatility", 0) * 100, 1),
                    "itm":    o.get("inTheMoney", False),
                    "chg":    round(o.get("percentChange", 0), 2),
                })
            return out
        return {
            "ticker": t,
            "expiry_dates": chain.get("expirationDates", []),
            "strikes":      chain.get("strikes", []),
            "calls":        _clean(opts.get("calls", [])),
            "puts":         _clean(opts.get("puts", [])),
        }
    except Exception as e:
        raise HTTPException(502, f"Options fetch failed: {e}")


@app.get("/api/markets/analyst/{ticker}")
async def analyst_ratings(ticker: str):
    """Analyst upgrades/downgrades + institutional ownership + insider transactions."""
    t = ticker.upper()
    modules = "upgradeDowngradeHistory,institutionOwnership,insiderTransactions"
    url = f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{t}?modules={modules}"
    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=15) as c:
            r = await c.get(url)
        data = r.json().get("quoteSummary", {}).get("result", [{}])[0]
        upgrades = [
            {"date": h.get("epochGradeDate"), "firm": h.get("firm"),
             "from": h.get("fromGrade"), "to": h.get("toGrade"), "action": h.get("action")}
            for h in (data.get("upgradeDowngradeHistory", {}).get("history") or [])[:20]
        ]
        institutions = [
            {"name": o.get("organization"), "pct": round((o.get("pctHeld") or 0) * 100, 2),
             "shares": o.get("position"), "value": o.get("value")}
            for o in (data.get("institutionOwnership", {}).get("ownershipList") or [])[:10]
        ]
        insiders = [
            {"name": t.get("filerName"), "text": t.get("transactionText"),
             "shares": t.get("shares"), "value": t.get("value"),
             "date": t.get("startDate", {}).get("raw") if isinstance(t.get("startDate"), dict) else t.get("startDate")}
            for t in (data.get("insiderTransactions", {}).get("transactions") or [])[:10]
        ]
        return {"ticker": t, "upgrades": upgrades, "institutions": institutions, "insiders": insiders}
    except Exception as e:
        raise HTTPException(502, f"Analyst data failed: {e}")


@app.get("/api/markets/binance")
async def binance_tickers():
    """Binance top perpetual-traded pairs: price, 24h stats, volume."""
    PAIRS = [
        "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
        "ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","MATICUSDT",
        "LINKUSDT","LTCUSDT","UNIUSDT","ATOMUSDT","NEARUSDT",
        "APTUSDT","ARBUSDT","OPUSDT","SUIUSDT","PEPEUSDT",
    ]
    results = []
    try:
        symbols_param = "%5B" + "%2C".join(f'%22{p}%22' for p in PAIRS) + "%5D"
        url = f"https://api.binance.com/api/v3/ticker/24hr?symbols={symbols_param}"
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(url)
        for q in r.json():
            chg = float(q.get("priceChangePercent", 0))
            results.append({
                "symbol":     q["symbol"],
                "price":      float(q["lastPrice"]),
                "change_pct": round(chg, 2),
                "high":       float(q["highPrice"]),
                "low":        float(q["lowPrice"]),
                "volume":     float(q["volume"]),
                "quote_vol":  float(q["quoteVolume"]),
                "trades":     int(q["count"]),
                "bid":        float(q["bidPrice"]),
                "ask":        float(q["askPrice"]),
                "direction":  "up" if chg > 0 else "down" if chg < 0 else "flat",
            })
    except Exception as e:
        raise HTTPException(502, f"Binance fetch failed: {e}")
    return {"source": "Binance", "count": len(results), "tickers": results}


@app.get("/api/markets/forex")
async def forex_rates():
    """Frankfurter ECB-backed exchange rates. No key required."""
    url = "https://api.frankfurter.dev/v1/latest?base=USD"
    try:
        data = await fetch_json(url, ttl=1800)
        rates = data.get("rates", {})
        items = [{"pair": f"USD/{k}", "rate": v, "base": "USD", "quote": k}
                 for k, v in sorted(rates.items())]
        return {"source": "Frankfurter / ECB", "base": "USD",
                "date": data.get("date"), "rates": items}
    except Exception as e:
        raise HTTPException(502, f"Forex fetch failed: {e}")


@app.get("/api/markets/treasury")
async def treasury_yields():
    """US Treasury yield curve (1M–30Y) from TreasuryDirect XML."""
    year = datetime.now(timezone.utc).year
    url  = (f"https://home.treasury.gov/resource-center/data-chart-center/"
            f"interest-rates/pages/xml?data=daily_treasury_yield_curve"
            f"&field_tdr_date_value={year}")
    cached = cache_get("treasury_yields")
    if cached:
        return cached
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, headers={"User-Agent": "Mozilla/5.0"})
        root = ET.fromstring(r.text)
        ns = {"d": "http://schemas.microsoft.com/ado/2007/08/dataservices",
              "m": "http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"}
        entries = root.findall(".//{http://www.w3.org/2005/Atom}entry")
        # Take most recent entry
        yields = {}
        latest_date = ""
        for entry in reversed(entries):
            props = entry.find(".//{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}properties")
            if props is None:
                continue
            date_el = props.find("d:NEW_DATE", ns)
            if date_el is not None and date_el.text:
                latest_date = date_el.text[:10]
            KEYS = {"BC_1MONTH":"1M","BC_2MONTH":"2M","BC_3MONTH":"3M",
                    "BC_6MONTH":"6M","BC_1YEAR":"1Y","BC_2YEAR":"2Y",
                    "BC_3YEAR":"3Y","BC_5YEAR":"5Y","BC_7YEAR":"7Y",
                    "BC_10YEAR":"10Y","BC_20YEAR":"20Y","BC_30YEAR":"30Y"}
            for xml_key, label in KEYS.items():
                el = props.find(f"d:{xml_key}", ns)
                if el is not None and el.text:
                    try:
                        yields[label] = float(el.text)
                    except ValueError:
                        pass
            if yields:
                break
        result = {"source": "US Treasury", "date": latest_date, "yields": yields}
        cache_set("treasury_yields", result, 3600)
        return result
    except Exception as e:
        raise HTTPException(502, f"Treasury yields failed: {e}")


@app.get("/api/markets/debt")
async def national_debt():
    """US national debt from FiscalData Treasury API."""
    url = ("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
           "v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=3")
    try:
        data = await fetch_json(url, ttl=43200)
        rows = data.get("data", [])
        if not rows:
            raise HTTPException(502, "No debt data")
        latest = rows[0]
        return {
            "source": "FiscalData / Treasury",
            "date": latest.get("record_date"),
            "total_debt": float(latest.get("tot_pub_debt_out_amt", 0)),
            "debt_public": float(latest.get("debt_held_public_amt", 0)),
            "debt_intragovt": float(latest.get("intragov_hold_amt", 0)),
        }
    except Exception as e:
        raise HTTPException(502, f"National debt failed: {e}")


@app.get("/api/markets/sec-filings")
async def sec_filings():
    """SEC EDGAR live RSS: recent 8-K (material events) and Form 4 (insider trades)."""
    feeds = {
        "8-K":  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=20&output=atom",
        "13D":  "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=13D&dateb=&owner=include&count=10&output=atom",
        "Form4": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=10&output=atom",
    }
    all_filings = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    async with httpx.AsyncClient(headers={"User-Agent": "worldmonitor/1.0 admin@example.com"}, timeout=15) as client:
        for ftype, url in feeds.items():
            try:
                r = await client.get(url)
                root = ET.fromstring(r.text)
                for entry in root.findall("atom:entry", ns)[:10]:
                    title_el   = entry.find("atom:title", ns)
                    updated_el = entry.find("atom:updated", ns)
                    link_el    = entry.find("atom:link", ns)
                    summ_el    = entry.find("atom:summary", ns)
                    all_filings.append({
                        "type":    ftype,
                        "title":   title_el.text if title_el is not None else "",
                        "updated": updated_el.text if updated_el is not None else "",
                        "url":     link_el.get("href", "") if link_el is not None else "",
                        "summary": (summ_el.text or "")[:200] if summ_el is not None else "",
                    })
            except Exception:
                continue
    all_filings.sort(key=lambda x: x.get("updated", ""), reverse=True)
    return {"source": "SEC EDGAR", "count": len(all_filings), "filings": all_filings}


@app.get("/api/markets/btc-chain")
async def btc_onchain():
    """Bitcoin on-chain stats from Blockchain.info — hashrate, difficulty, mempool."""
    try:
        stats = await fetch_json("https://blockchain.info/stats?format=json", ttl=300)
        ticker_data = await fetch_json("https://blockchain.info/ticker", ttl=120)
        usd = ticker_data.get("USD", {})
        return {
            "source": "Blockchain.info",
            "price_usd":      usd.get("last"),
            "buy":            usd.get("buy"),
            "sell":           usd.get("sell"),
            "hash_rate":      stats.get("hash_rate"),
            "difficulty":     stats.get("difficulty"),
            "blocks_mined":   stats.get("n_blocks_mined"),
            "btc_mined":      stats.get("n_btc_mined"),
            "minutes_between_blocks": stats.get("minutes_between_blocks"),
            "mempool_size":   stats.get("mempool_size"),
            "unconfirmed_count": stats.get("n_tx"),
            "total_btc_sent": stats.get("total_btc_sent"),
            "trade_volume_usd": stats.get("trade_volume_usd"),
        }
    except Exception as e:
        raise HTTPException(502, f"BTC chain stats failed: {e}")


@app.get("/api/markets/crypto-global")
async def crypto_global():
    """CoinGecko global crypto market summary."""
    try:
        data = await fetch_json("https://api.coingecko.com/api/v3/global", ttl=300)
        d = data.get("data", {})
        return {
            "source": "CoinGecko",
            "total_market_cap_usd": d.get("total_market_cap", {}).get("usd"),
            "total_volume_usd":     d.get("total_volume", {}).get("usd"),
            "btc_dominance":        round(d.get("market_cap_percentage", {}).get("btc", 0), 2),
            "eth_dominance":        round(d.get("market_cap_percentage", {}).get("eth", 0), 2),
            "change_24h_pct":       round(d.get("market_cap_change_percentage_24h_usd", 0), 2),
            "active_cryptos":       d.get("active_cryptocurrencies"),
            "markets":              d.get("markets"),
        }
    except Exception as e:
        raise HTTPException(502, f"Crypto global failed: {e}")


# ──────────────────────────────────────────────────────────────
# BLOOMBERG TERMINAL — OHLCV History / Candlestick Data
# ──────────────────────────────────────────────────────────────

@app.get("/api/markets/history/{ticker}")
async def stock_history(ticker: str, interval: str = "1d", range: str = "3mo"):
    """OHLCV candlestick data from Yahoo Finance v8. Returns TradingView-compatible format."""
    t = ticker.upper()
    allowed_intervals = {"1m","5m","15m","30m","1h","4h","1d","1wk","1mo"}
    allowed_ranges    = {"1d","5d","1mo","3mo","6mo","1y","2y","5y","10y","ytd","max"}
    iv = interval if interval in allowed_intervals else "1d"
    rv = range    if range    in allowed_ranges    else "3mo"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?interval={iv}&range={rv}"
    try:
        data = await fetch_json(url, ttl=60)
        result = data.get("chart", {}).get("result", [])
        if not result:
            raise HTTPException(404, f"No chart data for {ticker}")
        r = result[0]
        timestamps = r.get("timestamp", [])
        indicators = r.get("indicators", {})
        quote      = indicators.get("quote", [{}])[0]
        opens      = quote.get("open",  [])
        highs      = quote.get("high",  [])
        lows       = quote.get("low",   [])
        closes     = quote.get("close", [])
        volumes    = quote.get("volume",[])
        candles = []
        for i, ts in enumerate(timestamps):
            o = opens[i]  if i < len(opens)  else None
            h = highs[i]  if i < len(highs)  else None
            l = lows[i]   if i < len(lows)   else None
            c = closes[i] if i < len(closes) else None
            v = volumes[i]if i < len(volumes)else None
            if None not in (o, h, l, c):
                candles.append({
                    "time":   ts,
                    "open":   round(float(o), 4),
                    "high":   round(float(h), 4),
                    "low":    round(float(l), 4),
                    "close":  round(float(c), 4),
                    "volume": int(v) if v is not None else 0,
                })
        meta = r.get("meta", {})
        return {
            "ticker":    t,
            "interval":  iv,
            "range":     rv,
            "currency":  meta.get("currency", "USD"),
            "exchange":  meta.get("exchangeName", ""),
            "candles":   candles,
            "count":     len(candles),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"History fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# BLOOMBERG TERMINAL — NSE India (National Stock Exchange)
# Uses browser header spoofing + session cookie grab to bypass anti-bot.
# ──────────────────────────────────────────────────────────────

_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer":         "https://www.nseindia.com/",
    "X-Requested-With": "XMLHttpRequest",
}

async def _nse_fetch(path: str, ttl: int = 30) -> Any:
    """Fetch from NSE API with session cookie grab + browser headers."""
    cached = cache_get(f"nse:{path}")
    if cached is not None:
        return cached
    async with httpx.AsyncClient(headers=_NSE_HEADERS, follow_redirects=True, timeout=12) as s:
        # Warm up session (grab cookies) then fetch the API endpoint
        await s.get("https://www.nseindia.com/")
        r = await s.get(f"https://www.nseindia.com{path}")
        r.raise_for_status()
        data = r.json()
    cache_set(f"nse:{path}", data, ttl)
    return data


@app.get("/api/markets/nse/{symbol}")
async def nse_quote(symbol: str):
    """Live NSE India equity quote via public NSE API (no key required)."""
    sym = symbol.upper()
    try:
        data = await _nse_fetch(f"/api/quote-equity?symbol={sym}")
        pd_  = data.get("priceInfo", {})
        info = data.get("info", {})
        meta = data.get("metadata", {})
        last = pd_.get("lastPrice", 0) or 0
        prev = pd_.get("previousClose", last) or last
        chg_pct = ((last - prev) / prev * 100) if prev else 0
        return {
            "symbol":     sym,
            "name":       info.get("companyName", sym),
            "series":     meta.get("series", "EQ"),
            "isin":       info.get("isin", ""),
            "price":      last,
            "prev_close": prev,
            "change":     round(last - prev, 2),
            "change_pct": round(chg_pct, 2),
            "open":       pd_.get("open"),
            "high":       pd_.get("intraDayHighLow", {}).get("max"),
            "low":        pd_.get("intraDayHighLow", {}).get("min"),
            "week52_high": pd_.get("weekHighLow", {}).get("max"),
            "week52_low":  pd_.get("weekHighLow", {}).get("min"),
            "volume":     data.get("preOpenMarket", {}).get("totalTradedVolume"),
            "market_cap": meta.get("pdSectorPe"),
            "pe_ratio":   meta.get("pdSectorPe"),
            "sector":     meta.get("industry", ""),
            "direction":  "up" if chg_pct > 0 else "down" if chg_pct < 0 else "flat",
            "source":     "NSE India",
            "currency":   "INR",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"NSE quote failed for {symbol}: {e}")


@app.get("/api/markets/nse/index/{index}")
async def nse_index(index: str = "NIFTY 50"):
    """NSE index chart data (NIFTY 50, NIFTY BANK, etc.)."""
    idx = index.upper().replace("-", " ")
    encoded = idx.replace(" ", "%20")
    try:
        data = await _nse_fetch(f"/api/chart-databyindex?index={encoded}", ttl=60)
        raw = data.get("grapthData") or data.get("graphData") or data.get("data") or []
        candles = []
        for row in raw:
            if isinstance(row, list) and len(row) >= 2:
                ts_ms, price = row[0], row[1]
                candles.append({"time": int(ts_ms // 1000), "value": price})
        return {"index": idx, "candles": candles, "count": len(candles), "source": "NSE India"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"NSE index data failed: {e}")


# ──────────────────────────────────────────────────────────────
# BLOOMBERG TERMINAL — Per-stock news from Yahoo Finance RSS
# ──────────────────────────────────────────────────────────────

@app.get("/api/markets/stock-news/{ticker}")
async def stock_news(ticker: str):
    """Recent news headlines for a specific ticker from Yahoo Finance."""
    t = ticker.upper()
    url = f"https://query1.finance.yahoo.com/v1/finance/search?q={t}&newsCount=20&quotesCount=0&enableFuzzyQuery=false"
    try:
        data = await fetch_json(url, ttl=300)
        news_items = data.get("news", [])
        items = []
        for n in news_items[:20]:
            items.append({
                "title":     n.get("title", ""),
                "publisher": n.get("publisher", ""),
                "link":      n.get("link", ""),
                "published": n.get("providerPublishTime", 0),
                "thumbnail": (n.get("thumbnail") or {}).get("resolutions", [{}])[0].get("url", ""),
            })
        return {"ticker": t, "count": len(items), "news": items}
    except Exception as e:
        raise HTTPException(502, f"Stock news failed: {e}")


# ──────────────────────────────────────────────────────────────
# BLOOMBERG TERMINAL — Sector Heatmap
# ──────────────────────────────────────────────────────────────

_SECTOR_ETFS = {
    "Technology":          "XLK",
    "Healthcare":          "XLV",
    "Financials":          "XLF",
    "Consumer Disc.":      "XLY",
    "Industrials":         "XLI",
    "Communication Svcs":  "XLC",
    "Consumer Staples":    "XLP",
    "Energy":              "XLE",
    "Utilities":           "XLU",
    "Real Estate":         "XLRE",
    "Materials":           "XLB",
}

@app.get("/api/markets/sector-heatmap")
async def sector_heatmap():
    """US sector ETF performance heatmap (S&P 500 SPDR ETFs, no API key)."""
    symbols = list(_SECTOR_ETFS.values())
    results = []
    try:
        symbols_param = "%5B" + "%2C".join(f'%22{s}%22' for s in symbols) + "%5D"
        url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={','.join(symbols)}"
        data = await fetch_json(url, ttl=300)
        quotes = data.get("quoteResponse", {}).get("result", [])
        sym_map = {q["symbol"]: q for q in quotes}
        for sector, etf in _SECTOR_ETFS.items():
            q = sym_map.get(etf, {})
            price = q.get("regularMarketPrice", 0) or 0
            prev  = q.get("regularMarketPreviousClose", price) or price
            chg_pct = round(((price - prev) / prev * 100) if prev else 0, 2)
            results.append({
                "sector":     sector,
                "etf":        etf,
                "price":      price,
                "change_pct": chg_pct,
                "direction":  "up" if chg_pct > 0 else "down" if chg_pct < 0 else "flat",
            })
        results.sort(key=lambda x: x["change_pct"], reverse=True)
    except Exception as e:
        raise HTTPException(502, f"Sector heatmap failed: {e}")
    return {"source": "Yahoo Finance / SPDR ETFs", "sectors": results}


# ──────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────
# Ships — Multi-source live AIS  (no mock / no auth required)
# Sources tried in order:
#   1. Digitraffic Finland REST — Baltic/global, 18k+ ships, no key
#   2. Kystverket TCP NMEA     — Norwegian EEZ, open govt (needs pyais)
#   3. aisstream.io WS         — Global, free key via AISSTREAM_API_KEY env var
# ──────────────────────────────────────────────────────────────
_SHIP_TYPE_NAMES: Dict[int, str] = {
    0:"Unknown", 20:"WIG", 21:"WIG — Hazcat A", 30:"Fishing", 31:"Towing",
    32:"Towing >200m", 33:"Dredging", 34:"Diving", 35:"Military", 36:"Sailing",
    37:"Pleasure", 40:"HSC", 50:"Pilot", 51:"SAR", 52:"Tug", 53:"Port Tender",
    54:"Anti-pollution", 55:"Law Enforcement", 60:"Passenger", 70:"Cargo",
    71:"Cargo — Hazcat A", 72:"Cargo — Hazcat B", 73:"Cargo — Hazcat C",
    74:"Cargo — Hazcat D", 80:"Tanker", 81:"Tanker — Hazcat A",
    82:"Tanker — Hazcat B", 83:"Tanker — Hazcat C", 84:"Tanker — Hazcat D",
    90:"Other",
}
_NAVSTAT_NAMES: Dict[int, str] = {
    0:"Underway (engine)", 1:"At anchor", 2:"Not in command",
    3:"Restricted maneuverability", 4:"Constrained by draught",
    5:"Moored", 6:"Aground", 7:"Engaged in fishing", 8:"Underway (sail)",
    15:"Undefined",
}


def _ship_category(t: int) -> str:
    if t in range(60, 70): return "passenger"
    if t in range(70, 80): return "cargo"
    if t in range(80, 90): return "tanker"
    if t == 35:            return "military"
    if t == 50:            return "pilot"
    if t == 30:            return "fishing"
    if t in (51, 52, 53, 54, 55): return "service"
    if t in (36, 37):      return "pleasure"
    return "other"


def _norm_v(mmsi: Any, name: Any, lat: Any, lon: Any, cog: Any, sog: Any,
            heading: Any, vtype: Any, navstat: Any,
            imo: Any = None, callsign: str = "",
            dest: str = "", draught: Any = None,
            flag: str = "", vtime: str = "") -> dict:
    """Normalise raw AIS fields into unified vessel dict."""
    t   = int(vtype or 0)
    sog_f = float(sog or 0)
    if sog_f >= 102.4: sog_f = 0.0
    cog_f = float(cog or 0) % 360
    hdg_f = float(heading or cog_f)
    if hdg_f == 511 or hdg_f > 511: hdg_f = cog_f
    return {
        "mmsi":      mmsi,
        "name":      (str(name or "")).strip() or f"MMSI {mmsi}",
        "lat":       round(float(lat), 5),
        "lon":       round(float(lon), 5),
        "cog":       round(cog_f, 1),
        "sog":       round(sog_f, 1),
        "heading":   round(hdg_f, 1),
        "type":      t,
        "type_name": _SHIP_TYPE_NAMES.get((t // 10) * 10, f"Type {t}"),
        "category":  _ship_category(t),
        "navstat":   _NAVSTAT_NAMES.get(int(navstat or 0), "?"),
        "imo":       imo,
        "callsign":  str(callsign or ""),
        "dest":      str(dest or ""),
        "draught":   draught,
        "flag":      str(flag or ""),
        "time":      str(vtime or ""),
    }


async def _ships_digitraffic(latmin: float, latmax: float,
                             lonmin: float, lonmax: float) -> list:
    """Finland Digitraffic AIS — Finnish Transport Infrastructure Agency.
    No API key, no registration. Returns 15 000+ moving ships globally.
    Merges two endpoints:
      GET /api/ais/v1/locations — Point GeoJSON of current positions
      GET /api/ais/v1/vessels  — metadata (name, type, IMO, callsign)
    Docs: https://www.digitraffic.fi/en/marine/
    """
    hdrs = {"Digitraffic-User": "WorldMonitor/1.0"}

    # Fetch positions and metadata concurrently
    pos_data, meta_data = await asyncio.gather(
        fetch_json("https://meri.digitraffic.fi/api/ais/v1/locations",
                   ttl=30, timeout=20.0, extra_headers=hdrs),
        fetch_json("https://meri.digitraffic.fi/api/ais/v1/vessels",
                   ttl=120, timeout=20.0, extra_headers=hdrs),
        return_exceptions=True,
    )

    # Build MMSI → metadata lookup
    meta: dict = {}
    if isinstance(meta_data, list):
        for v in meta_data:
            if isinstance(v, dict) and v.get("mmsi"):
                meta[v["mmsi"]] = v

    features = (pos_data.get("features") or []) if isinstance(pos_data, dict) else []
    vessels: list = []
    for f in features:
        if not isinstance(f, dict):
            continue
        mmsi   = f.get("mmsi")
        props  = f.get("properties") or {}
        coords = ((f.get("geometry") or {}).get("coordinates") or [])
        if len(coords) < 2 or not mmsi:
            continue
        lon_v, lat_v = float(coords[0]), float(coords[1])
        # Apply bbox filter
        if not (latmin <= lat_v <= latmax and lonmin <= lon_v <= lonmax):
            continue
        m = meta.get(mmsi, {})
        try:
            vessels.append(_norm_v(
                mmsi=mmsi,
                name=(m.get("name") or "").strip(),
                lat=lat_v, lon=lon_v,
                cog=props.get("cog", 0),
                sog=props.get("sog", 0),
                heading=props.get("heading", 511),
                vtype=m.get("type", 0),
                navstat=props.get("navStat", 15),
                imo=m.get("imo"),
                callsign=(m.get("callSign") or "").strip(),
                dest=(m.get("destination") or "").strip(),
                draught=m.get("draught"),
                vtime=str(props.get("timestampExternal", "")),
            ))
        except Exception:
            continue
    return vessels


async def _ships_kystverket_tcp(latmin: float, latmax: float,
                                lonmin: float, lonmax: float,
                                read_secs: float = 6.0) -> list:
    """Kystverket raw NMEA-0183 TCP stream — government operated, NLOD licence.
    TCP: 153.44.253.27:5631 — covers Norwegian Economic Zone.
    Requires: pip install pyais"""
    try:
        from pyais import decode as ais_decode  # type: ignore
    except ImportError:
        raise RuntimeError("pyais not installed — run: pip install pyais")

    vessels: dict = {}  # mmsi -> dict  (deduplicate)
    buffer = b""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection("153.44.253.27", 5631),
            timeout=8.0,
        )
    except (asyncio.TimeoutError, OSError) as e:
        raise RuntimeError(f"Kystverket TCP connect failed: {e}")

    deadline = asyncio.get_event_loop().time() + read_secs
    try:
        while asyncio.get_event_loop().time() < deadline:
            try:
                chunk = await asyncio.wait_for(reader.read(4096), timeout=2.0)
            except asyncio.TimeoutError:
                break
            if not chunk:
                break
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                raw = line.strip()
                if not raw.startswith(b"!AIVDM") and not raw.startswith(b"!AIVDO"):
                    continue
                try:
                    msg = ais_decode(raw)
                    d   = msg.asdict()
                    mmsi = d.get("mmsi")
                    lat  = d.get("lat") or d.get("latitude")
                    lon  = d.get("lon") or d.get("longitude")
                    if mmsi and lat is not None and lon is not None:
                        if not (latmin <= lat <= latmax and lonmin <= lon <= lonmax):
                            continue
                        vessels[mmsi] = _norm_v(
                            mmsi=mmsi,
                            name=(d.get("shipname") or d.get("name") or "").strip(),
                            lat=lat, lon=lon,
                            cog=d.get("course") or d.get("cog") or 0,
                            sog=d.get("speed") or d.get("sog") or 0,
                            heading=d.get("heading", 511),
                            vtype=d.get("ship_type") or d.get("type_of_ship_and_cargo") or 0,
                            navstat=d.get("status", 15),
                            callsign=(d.get("callsign") or "").strip(),
                            dest=(d.get("destination") or "").strip(),
                        )
                except Exception:
                    continue
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass
    return list(vessels.values())


async def _ships_aisstream(latmin: float, latmax: float,
                           lonmin: float, lonmax: float,
                           read_secs: float = 6.0) -> list:
    """aisstream.io — global WebSocket AIS stream (free API key via GitHub login).
    Free key: https://aisstream.io  (no credit card, 30 sec GitHub OAuth)
    Set env var AISSTREAM_API_KEY=<your_key> before launching uvicorn.
    Requires: pip install websockets"""
    import os
    api_key = os.environ.get("AISSTREAM_API_KEY", "").strip()
    # Built-in key — works for personal/development use
    if not api_key:
        api_key = "8b9d8625829bd9614947be967c141babc5931e79"
    if not api_key:
        raise RuntimeError(
            "AISSTREAM_API_KEY not set — get a free key at https://aisstream.io "
            "(GitHub login, no credit card) then set the env var."
        )
    try:
        import websockets  # type: ignore
    except ImportError:
        raise RuntimeError("websockets not installed — run: pip install websockets")

    vessels: dict = {}  # mmsi -> dict  (deduplicate)
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": [[[latmin, lonmin], [latmax, lonmax]]],
        "FilterMessageTypes": ["PositionReport"],
    }
    try:
        async with websockets.connect(
            "wss://stream.aisstream.io/v0/stream",
            open_timeout=10,
            close_timeout=5,
        ) as ws:
            await ws.send(json.dumps(subscription))
            deadline = asyncio.get_event_loop().time() + read_secs
            while asyncio.get_event_loop().time() < deadline:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                except asyncio.TimeoutError:
                    break
                try:
                    obj  = json.loads(raw)
                    if obj.get("MessageType") != "PositionReport":
                        continue
                    meta = obj.get("MetaData", {})
                    pr   = obj.get("Message", {}).get("PositionReport", {})
                    mmsi = meta.get("MMSI") or pr.get("UserID")
                    lat  = meta.get("latitude") or pr.get("Latitude")
                    lon  = meta.get("longitude") or pr.get("Longitude")
                    if mmsi and lat is not None and lon is not None:
                        vessels[mmsi] = _norm_v(
                            mmsi=mmsi,
                            name=(meta.get("ShipName") or "").strip(),
                            lat=lat, lon=lon,
                            cog=pr.get("CourseOverGround", 0),
                            sog=pr.get("SpeedOverGround", 0),
                            heading=pr.get("TrueHeading", 511),
                            vtype=0,
                            navstat=pr.get("NavigationalStatus", 15),
                            vtime=meta.get("time_utc", ""),
                        )
                except Exception:
                    continue
    except Exception as e:
        raise RuntimeError(f"aisstream.io WebSocket error: {e}")

    return list(vessels.values())


@app.get("/api/ais/ships")
async def ais_ships(  # noqa: C901
    latmin: float = -90, latmax: float = 90,
    lonmin: float = -180, lonmax: float = 180,
    zoom: int = 5,
):
    """Multi-source live AIS — real data only, no mock fallback.

    Source priority:
      1. Digitraffic Finland — Baltic/global, 15k+ moving ships, no key needed
      2. Kystverket TCP      — Norwegian EEZ raw NMEA, no key (needs pyais)
      3. aisstream.io WS     — Global, free key (set AISSTREAM_API_KEY env var)

    zoom: Leaflet zoom level from the client — controls vessel count cap:
      < 5  → max 300  (world overview, dots only)
      5-6  → max 700
      7-8  → max 1500
      9+   → max 3000 (zoomed in, full detail)
    """
    vessels: list = []
    source: str = "none"
    errors: list = []

    # ── 1. Digitraffic Finland (Baltic + global, no key required)
    try:
        vessels = await _ships_digitraffic(latmin, latmax, lonmin, lonmax)
        if vessels:
            source = "Digitraffic"
    except Exception as e:
        errors.append(f"Digitraffic: {e}")

    # ── 2. Kystverket TCP NMEA (Norwegian EEZ, open government, no key)
    if not vessels:
        try:
            vessels = await _ships_kystverket_tcp(latmin, latmax, lonmin, lonmax)
            if vessels:
                source = "Kystverket/TCP"
        except Exception as e:
            errors.append(f"Kystverket-TCP: {e}")

    # ── 3. aisstream.io WebSocket (global — AISSTREAM_API_KEY env var or built-in)
    if not vessels:
        try:
            vessels = await _ships_aisstream(latmin, latmax, lonmin, lonmax)
            if vessels:
                source = "aisstream.io"
        except Exception as e:
            errors.append(f"aisstream.io: {e}")

    # ── Upsert whatever we just fetched to keep the DB warm ──
    if vessels:
        asyncio.create_task(_db_upsert_vessels(vessels, source))

    # ── Read back from DB (always-fresh, bbox-filtered) ──
    max_v = 300 if zoom < 5 else 700 if zoom < 7 else 1500 if zoom < 9 else 3000
    db_vessels = await _db_query_vessels(latmin, latmax, lonmin, lonmax, limit=max_v)

    # Fall back to freshly-fetched list if DB not yet populated
    if not db_vessels and vessels:
        vessels.sort(key=lambda v: v.get("sog", 0.0), reverse=True)
        db_vessels = vessels[:max_v]
        final_source = source
    else:
        final_source = "DB/" + (db_vessels[0].get("source", source) if db_vessels else source)

    total_in_db = await _db_total_count()

    return {
        "source":       final_source,
        "count":        len(db_vessels),
        "total_in_db":  total_in_db,
        "zoom":         zoom,
        "meta":         _ship_poll_stats,
        "vessels":      db_vessels,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "errors":       errors if errors and not db_vessels else [],
    }


@app.get("/api/ais/ships/stats")
async def ais_ships_stats():
    """Returns live ship DB statistics for the AI panel."""
    total = await _db_total_count()
    return {
        "total_live": total,
        "last_poll":   _ship_poll_stats["last_poll"],
        "last_source": _ship_poll_stats["last_source"],
        "total_polls": _ship_poll_stats["total_polls"],
        "db_path":     DB_PATH,
    }

# ── Nothing below this line belongs to ais_ships ──

# ──────────────────────────────────────────────────────────────
# CelesTrak — Satellite TLEs (no key required)
# ──────────────────────────────────────────────────────────────
def _parse_tle(raw: str) -> list:
    """Parse 3LE (title + 2 lines) or 2LE blocks from raw TLE text."""
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    sats = []
    i = 0
    while i < len(lines):
        # 3LE format: name, line1, line2
        if (i + 2 < len(lines)
                and lines[i+1].startswith("1 ")
                and lines[i+2].startswith("2 ")):
            name  = lines[i]
            line1 = lines[i+1]
            line2 = lines[i+2]
            try:
                # Parse basic orbital params from TLE
                inc   = float(line2[8:16].strip())
                raan  = float(line2[17:25].strip())
                ecc   = float("0." + line2[26:33].strip())
                argp  = float(line2[34:42].strip())
                ma    = float(line2[43:51].strip())
                mm    = float(line2[52:63].strip())   # mean motion (rev/day)
                norad = int(line2[2:7].strip())
                # Very rough current lat/lon estimate using mean anomaly
                # (simplified: not real SGP4 propagation)
                true_lon = (raan + argp + ma) % 360
                lat_est  = math.sin(math.radians(true_lon)) * inc
                lon_est  = (true_lon + 180) % 360 - 180
                # altitude estimate km: (86400/mm)^(2/3) * 6371 - 6371
                period_min = 1440 / mm
                alt_km = round(((period_min / 84.4) ** (2/3) * 6371) - 6371, 0)
                sats.append({
                    "name": name, "norad": norad,
                    "lat": round(lat_est, 2), "lon": round(lon_est, 2),
                    "alt_km": alt_km, "inc": inc, "period_min": round(period_min, 1),
                    "line1": line1, "line2": line2,
                })
            except Exception:
                pass
            i += 3
        else:
            i += 1
    return sats

@app.get("/api/satellites/tle")
async def satellites_tle(group: str = "active"):
    """CelesTrak TLE data for satellite groups."""
    allowed = {
        "active": "active", "starlink": "starlink",
        "gps": "gps-ops",   "military": "military",
        "stations": "stations", "weather": "weather",
        "debris": "1982-092",
    }
    grp = allowed.get(group, "active")
    url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={grp}&FORMAT=tle"
    try:
        raw = await fetch_text(url, ttl=3600)
        sats = _parse_tle(raw)
        # For large groups (active=~10k), cap at 500 for performance
        if len(sats) > 500:
            import random
            sats = random.sample(sats, 500)
        return {
            "source": f"CelesTrak ({group})",
            "count": len(sats),
            "satellites": sats,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(502, f"CelesTrak TLE fetch failed: {e}")

@app.get("/api/satellites/iss")
async def iss_position():
    """Real-time ISS position from Open Notify."""
    try:
        data = await fetch_json("http://api.open-notify.org/iss-now.json", ttl=10)
        pos = data.get("iss_position", {})
        return {
            "source": "Open Notify",
            "lat": float(pos.get("latitude", 0)),
            "lon": float(pos.get("longitude", 0)),
            "timestamp": data.get("timestamp"),
        }
    except Exception as e:
        raise HTTPException(502, f"ISS fetch failed: {e}")


# ──────────────────────────────────────────────────────────────
# APT full detail — fetched live from APTmap (andreacristaldi.github.io/APTmap)
# ──────────────────────────────────────────────────────────────
_APT_REL_CACHE: Optional[dict] = None


async def _load_apt_rel() -> dict:
    """Fetch and index apt_rel.json from the live APTmap site."""
    global _APT_REL_CACHE
    if _APT_REL_CACHE is not None:
        return _APT_REL_CACHE

    url = f"{APTMAP_BASE}/apt_rel.json"
    try:
        data = await fetch_json(url, ttl=86400, timeout=20.0)
    except Exception:
        _APT_REL_CACHE = {}
        return _APT_REL_CACHE

    from collections import defaultdict
    nodes_by_id = {n["id"]: n for n in data.get("nodes", [])}
    fwd: dict = defaultdict(list)
    for lnk in data.get("links", []):
        fwd[lnk["source"]].append(lnk["target"])

    index: dict = {}
    for node in data.get("nodes", []):
        if node.get("group") != "APT":
            continue
        nid    = node["id"]
        country: Optional[str] = None
        tools:  list = []
        ttps:   list = []
        for t in fwd.get(nid, []):
            n = nodes_by_id.get(t)
            if not n:
                continue
            g = n.get("group", "")
            if g == "Country":
                country = n["name"]
            elif g == "Tool":
                tools.append({"name": n["name"], "desc": (n.get("description") or "")[:200]})
            elif g == "TTP":
                ttps.append(n["name"])
        name_key = (
            node["name"].lower()
            .replace(" ", "").replace("/", "").replace("-", "")
        )
        index[name_key] = {
            "name":        node["name"],
            "description": node.get("description", ""),
            "color":       node.get("color", "#ffd700"),
            "country":     country,
            "tools":       tools[:20],
            "ttps":        ttps[:20],
        }

    _APT_REL_CACHE = index
    return index


@app.get("/api/threats/apt-detail")
async def apt_detail(name: str = ""):
    """Full detail for a single APT group — sourced from APTmap live data."""
    idx = await _load_apt_rel()
    key = name.lower().replace(" ", "").replace("/", "").replace("-", "")
    if key in idx:
        return {"found": True, "group": idx[key]}
    matches = [v for k, v in idx.items() if key in k or k in key]
    if matches:
        return {"found": True, "group": matches[0]}
    return {"found": False, "available": sorted([v["name"] for v in idx.values()])[:50]}


@app.get("/api/threats/apt-list")
async def apt_list_full():
    """All APT group names + countries — sourced from APTmap live data."""
    idx = await _load_apt_rel()
    result = [{"name": v["name"], "country": v["country"], "color": v["color"]} for v in idx.values()]
    result.sort(key=lambda x: x["name"])
    return {"count": len(result), "groups": result}


# ──────────────────────────────────────────────────────────────
# Static files — serve the frontend
# Use an absolute path so it resolves correctly on Vercel (cwd is not
# guaranteed to equal the project root inside the serverless runtime).
# ──────────────────────────────────────────────────────────────
_STATIC_DIR = pathlib.Path(__file__).parent / "static"
if _STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="static")
else:
    print(f"[Warning] Static dir not found at {_STATIC_DIR} — frontend will not be served")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
