import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

let flightCache: { data: any[]; timestamp: number } = { data: [], timestamp: 0 };
const CACHE_TTL = 12000;

const MILITARY_PREFIXES = [
  'RCH', 'REACH', 'JAKE', 'FORGE', 'EVAC', 'DUKE', 'KING', 'DOOM',
  'SWIFT', 'TOPCAT', 'SKULL', 'HAVOC', 'VIPER', 'COBRA', 'RAVEN',
  'HAWK', 'EAGLE', 'BOLT', 'FURY', 'RAGE', 'REAPER', 'ATLAS',
  'TITAN', 'GIANT', 'HEAVY', 'NAVY', 'ARMY', 'USAF', 'RAF',
  'IAF', 'GAF', 'FAF', 'BAF', 'PAF', 'CNV', 'RRR', 'MCM',
  'ASCOT', 'TARTAN', 'VIKING', 'SPAR', 'SAM', 'EXEC',
  'NCHO', 'NATO', 'FORTE', 'LAGR', 'HOMER',
];

const MILITARY_HEX_RANGES = [
  { start: 0xAE0000, end: 0xAFFFFF }, // US military
  { start: 0x43C000, end: 0x43CFFF }, // UK military
  { start: 0x3F0000, end: 0x3FFFFF }, // Germany military
  { start: 0x3A8000, end: 0x3AFFFF }, // France military
];

function classifyMilitary(callsign: string, hex: string, dbFlags?: number): boolean {
  if (dbFlags === 1) return true;
  const cs = (callsign || "").toUpperCase().trim();
  if (MILITARY_PREFIXES.some(p => cs.startsWith(p))) return true;
  const h = parseInt(hex, 16);
  if (!isNaN(h)) {
    for (const r of MILITARY_HEX_RANGES) {
      if (h >= r.start && h <= r.end) return true;
    }
  }
  return false;
}

interface Flight {
  icao24: string; callsign: string; origin: string;
  lat: number; lng: number; alt: number; velocity: number;
  heading: number; verticalRate: number; onGround: boolean;
  category: string; lastContact: number; source: string;
  isMilitary: boolean;
}

// ── Airplanes.live - multiple regional queries for global coverage ──
async function fetchAirplanesLive(): Promise<Flight[]> {
  // Query multiple strategic points to get global coverage
  const points = [
    { lat: 40, lon: -100, nm: 500 },  // North America
    { lat: 50, lon: 10, nm: 500 },     // Europe  
    { lat: 25, lon: 50, nm: 500 },     // Middle East
    { lat: 35, lon: 120, nm: 500 },    // East Asia
    { lat: -25, lon: 135, nm: 500 },   // Australia
    { lat: 10, lon: 80, nm: 500 },     // South Asia
    { lat: -10, lon: -50, nm: 500 },   // South America
    { lat: 60, lon: 40, nm: 500 },     // Russia/Nordic
    { lat: 5, lon: 25, nm: 500 },      // Africa
  ];

  const all: Flight[] = [];
  const results = await Promise.allSettled(
    points.map(p =>
      fetch(`https://api.airplanes.live/v2/point/${p.lat}/${p.lon}/${p.nm}`, {
        signal: AbortSignal.timeout(12000),
      }).then(r => r.ok ? r.json() : null)
    )
  );

  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value?.ac) continue;
    for (const a of result.value.ac) {
      if (a.lat == null || a.lon == null) continue;
      const callsign = (a.flight || a.r || a.hex || "").trim().toUpperCase();
      const hex = a.hex || "";
      all.push({
        icao24: hex,
        callsign,
        origin: a.ownOp || "Unknown",
        lat: a.lat,
        lng: a.lon,
        alt: a.alt_baro === "ground" ? 0 : (a.alt_baro || a.alt_geom || 0),
        velocity: (a.gs || 0) * 0.514444,
        heading: a.track || a.true_heading || 0,
        verticalRate: a.baro_rate ? a.baro_rate * 0.00508 : 0,
        onGround: a.alt_baro === "ground",
        category: a.t || "Unknown",
        lastContact: a.seen ? Math.floor(Date.now() / 1000 - a.seen) : 0,
        source: "airplaneslive",
        isMilitary: classifyMilitary(callsign, hex, a.dbFlags),
      });
    }
  }
  return all;
}

// ── ADS-B Fi military endpoint ──
async function fetchADSBFiMilitary(): Promise<Flight[]> {
  try {
    const res = await fetch("https://opendata.adsb.fi/api/v2/mil", {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const raw = await res.json();
    if (!raw?.aircraft) return [];
    return raw.aircraft
      .filter((a: any) => a.lat != null && a.lon != null)
      .map((a: any): Flight => ({
        icao24: a.hex || "",
        callsign: (a.flight || a.r || a.hex || "").trim().toUpperCase(),
        origin: a.ownOp || "Military",
        lat: a.lat,
        lng: a.lon,
        alt: a.alt_baro === "ground" ? 0 : (a.alt_baro || a.alt_geom || 0),
        velocity: (a.gs || 0) * 0.514444,
        heading: a.track || a.true_heading || 0,
        verticalRate: a.baro_rate ? a.baro_rate * 0.00508 : 0,
        onGround: a.alt_baro === "ground",
        category: a.t || "Military",
        lastContact: a.seen ? Math.floor(Date.now() / 1000 - a.seen) : 0,
        source: "adsbfi_mil",
        isMilitary: true,
      }));
  } catch { return []; }
}

// ── OpenSky (best-effort, often rate-limited) ──
async function fetchOpenSky(): Promise<Flight[]> {
  try {
    const res = await fetch("https://opensky-network.org/api/states/all", {
      headers: { "User-Agent": "SoTaNik-AI/2.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const raw = await res.json();
    if (!raw?.states) return [];
    return raw.states
      .filter((s: any[]) => s[5] != null && s[6] != null)
      .map((s: any[]): Flight => {
        const callsign = (s[1] || "").trim().toUpperCase() || s[0];
        const hex = s[0] || "";
        return {
          icao24: hex, callsign, origin: s[2] || "Unknown",
          lat: s[6], lng: s[5], alt: s[7] || s[13] || 0,
          velocity: s[9] || 0, heading: s[10] || 0,
          verticalRate: s[11] || 0, onGround: s[8] || false,
          category: "Unknown", lastContact: s[4] || 0,
          source: "opensky",
          isMilitary: classifyMilitary(callsign, hex),
        };
      });
  } catch { return []; }
}

function dedup(flights: Flight[]): Flight[] {
  const map = new Map<string, Flight>();
  for (const f of flights) {
    const key = f.icao24.toLowerCase();
    const existing = map.get(key);
    if (!existing || f.lastContact > existing.lastContact) {
      if (existing?.isMilitary) f.isMilitary = true;
      map.set(key, f);
    }
  }
  return Array.from(map.values());
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { airborne } = body;
    const now = Date.now();

    if (now - flightCache.timestamp < CACHE_TTL && flightCache.data.length > 0) {
      const flights = airborne !== false ? flightCache.data.filter(f => !f.onGround) : flightCache.data;
      const milCount = flights.filter((f: any) => f.isMilitary).length;
      return new Response(
        JSON.stringify({ flights, total: flights.length, militaryCount: milCount, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[Flight] Fetching all sources...");
    const [ap, mil, os] = await Promise.allSettled([
      fetchAirplanesLive(),
      fetchADSBFiMilitary(),
      fetchOpenSky(),
    ]);

    const all: Flight[] = [];
    const sources: Record<string, number> = {};
    for (const [name, r] of [["airplaneslive", ap], ["adsbfi_mil", mil], ["opensky", os]] as [string, PromiseSettledResult<Flight[]>][]) {
      if (r.status === "fulfilled" && r.value.length > 0) {
        all.push(...r.value);
        sources[name] = r.value.length;
        console.log(`[Flight] ${name}: ${r.value.length}`);
      }
    }

    const deduplicated = dedup(all);
    flightCache = { data: deduplicated, timestamp: now };

    const flights = airborne !== false ? deduplicated.filter(f => !f.onGround) : deduplicated;
    const milCount = flights.filter(f => f.isMilitary).length;
    console.log(`[Flight] Serving ${flights.length} (${milCount} military)`);

    return new Response(
      JSON.stringify({ flights, total: flights.length, militaryCount: milCount, cached: false, sources }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[Flight] Error:", err);
    if (flightCache.data.length > 0) {
      return new Response(
        JSON.stringify({ flights: flightCache.data.filter(f => !f.onGround), total: flightCache.data.length, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: err.message, flights: [], total: 0 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
