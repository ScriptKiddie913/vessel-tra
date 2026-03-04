"""
Vercel serverless entry point.
NOTE: WebSocket (/ws) and background workers are NOT available on Vercel serverless.
For real-time tracking, deploy server.py on a persistent host (Render/Railway/Fly.io)
and point the frontend's WS_URL to that host.
REST endpoints /api/status and /api/tles work fine here.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

app = FastAPI(title="Ship & Satellite Tracker – Vercel API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/status")
async def api_status():
    return {
        "ships": 0,
        "satellites": 0,
        "clients": 0,
        "note": "Live data requires the persistent uvicorn server. "
                "Deploy server.py on Render/Railway for full functionality.",
        "sources": {
            "aisstream": "SERVERLESS – no persistent connection",
            "satellites": "Use client-side TLE fetch (auto-starts after 15s)",
        }
    }

@app.get("/api/tles")
async def api_tles():
    """Return empty — client fetches TLEs directly from Celestrak via CORS proxy."""
    return {"tles": []}

# Vercel handler
handler = Mangum(app, lifespan="off")
