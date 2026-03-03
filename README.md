# NAVTRACK (Vercel-ready)

Leaflet-based vessel tracker with a Next.js backend proxy endpoint (`/api/ships`).

## Features
- Full-screen NAVTRACK map UI in `public/map.html`.
- Backend attempts public unauthenticated sources: MyShipTracking, VesselFinder, Datalastic.
- Source merge + MMSI de-duplication.
- Automatic fallback simulation feed when providers are blocked/unavailable.
- Vercel deployable out of the box.

## Run
```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy on Vercel
1. Import repo into Vercel.
2. Framework preset: **Next.js**.
3. Deploy (no environment variables required).

## Note on live data
No API keys are required by this project. Public upstream providers may block unauthenticated/server-origin traffic, so the app degrades gracefully to a simulated feed to keep the interface fully usable.
