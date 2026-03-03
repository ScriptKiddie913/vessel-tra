# NAVTRACK (Vercel-ready)

Leaflet-based vessel tracker with a Next.js backend endpoint (`/api/ships`).

## Provider strategy implemented
- **AISstream (primary live stream):** server-side websocket ingestion from `wss://stream.aisstream.io/v0/stream` (requires free key, no card).
- **MarineTraffic tile feed (no key):** proxied fetch to `get_data_json_4` tile endpoint.
- **Datalastic (optional):** enabled only when `DATALASTIC_API_KEY` is set.

## Required env vars
- `AISSTREAM_API_KEY` (required for live push stream)
- `DATALASTIC_API_KEY` (optional)

## Features
- Full-screen NAVTRACK map UI in `public/map.html`.
- Runtime source health/count panel (AIS / MT / DL).
- Ship normalization + merge/dedup by MMSI.
- Vessel-only filtering (drops non-vessel MMSI ranges and aircraft-like labels).
- Graceful simulation fallback if no provider currently returns data.
- Vercel deployable Next.js app.

## Run
```bash
npm install
AISSTREAM_API_KEY=your_key npm run dev
```

Open http://localhost:3000

## Deploy on Vercel
1. Import repo in Vercel.
2. Framework: **Next.js**.
3. Add env var `AISSTREAM_API_KEY`.
4. Deploy.

## API output
`/api/ships` returns:
- `ships`: merged vessel list
- `meta.sources`: per-source status + counts
- `meta.noKeyReachable`: currently reachable no-key sources
- `meta.aisstream`: websocket diagnostics (`connected`, `shipCacheSize`, `lastMessageAt`)
