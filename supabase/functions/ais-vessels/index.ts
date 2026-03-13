import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Vessel {
  id: string; name: string; type: string;
  lat: number; lng: number; course: number;
  speed: number; flag: string; ts: number; source: string;
  mmsi?: string; destination?: string; imo?: string;
}

let vesselCache: { data: Vessel[]; timestamp: number } = { data: [], timestamp: 0 };
const CACHE_TTL = 45000;

const MID: Record<string, string> = {
  '201':'🇦🇱','203':'🇦🇹','211':'🇩🇪','219':'🇩🇰','220':'🇩🇰','226':'🇫🇷','227':'🇫🇷','228':'🇫🇷',
  '230':'🇫🇮','231':'🇫🇮','232':'🇬🇧','233':'🇬🇧','234':'🇬🇧','235':'🇬🇧',
  '240':'🇬🇷','241':'🇬🇷','244':'🇳🇱','245':'🇳🇱','247':'🇮🇹','248':'🇲🇹','249':'🇲🇹',
  '250':'🇮🇪','255':'🇵🇹','257':'🇳🇴','258':'🇳🇴','259':'🇳🇴',
  '261':'🇵🇱','265':'🇸🇪','266':'🇸🇪','271':'🇹🇷','272':'🇺🇦','273':'🇷🇺',
  '303':'🇺🇸','338':'🇺🇸','366':'🇺🇸','367':'🇺🇸','368':'🇺🇸','369':'🇺🇸',
  '316':'🇨🇦','412':'🇨🇳','413':'🇨🇳','419':'🇮🇳',
  '431':'🇯🇵','432':'🇯🇵','440':'🇰🇷','441':'🇰🇷',
  '503':'🇦🇺','525':'🇮🇩','533':'🇲🇾','559':'🇸🇬','567':'🇹🇭',
  '351':'🇵🇦','352':'🇵🇦','353':'🇵🇦','354':'🇵🇦','355':'🇵🇦',
  '636':'🇱🇷','637':'🇱🇷','538':'🇲🇭',
  '710':'🇧🇷','725':'🇨🇱','311':'🇧🇸','312':'🇧🇸',
};

function getFlag(mmsi: string): string {
  return MID[mmsi.slice(0, 3)] ?? '🏳️';
}

function shipType(t: number): string {
  if (t === 30) return 'Fishing';
  if (t === 31 || t === 32 || t === 52) return 'Tug';
  if (t === 35 || t === 36 || t === 55) return 'Military';
  if (t >= 40 && t <= 49) return 'High Speed';
  if (t >= 60 && t <= 69) return 'Passenger';
  if (t >= 70 && t <= 79) return 'Cargo';
  if (t >= 80 && t <= 89) return 'Tanker';
  if (t === 50) return 'Pilot';
  if (t === 51) return 'SAR';
  if (t === 53) return 'Research';
  return 'Unknown';
}

// ── Source 1: Finnish Digitraffic (Northern Europe, ~18k vessels) ──
async function fetchDigitraffic(): Promise<Vessel[]> {
  const vessels: Vessel[] = [];
  try {
    console.log("[AIS] Fetching Digitraffic...");
    const res = await fetch('https://meri.digitraffic.fi/api/ais/v1/locations', {
      headers: { 'Accept': 'application/json', 'Digitraffic-User': 'SoTaNik-Intel/2.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    for (const f of (data?.features ?? [])) {
      const p = f.properties;
      const c = f.geometry?.coordinates;
      if (!c || c.length < 2) continue;
      const [lng, lat] = c;
      if (lat === 0 && lng === 0) continue;
      const mmsi = String(p.mmsi ?? '');
      if (!mmsi) continue;
      vessels.push({
        id: mmsi, mmsi, name: `VESSEL-${mmsi}`,
        type: shipType(p.shipType ?? 0), lat, lng,
        course: p.cog ?? p.heading ?? 0, speed: p.sog ?? 0,
        flag: getFlag(mmsi), ts: p.timestampExternal ?? Date.now(), source: 'digitraffic',
      });
    }
    console.log(`[AIS] Digitraffic: ${vessels.length} vessels`);
  } catch (e: any) { console.error("[AIS] Digitraffic error:", e.message); }
  return vessels;
}

// ── Source 2: Norwegian Kystverket raw AIS TCP ──
async function fetchNorwegianAIS(): Promise<Vessel[]> {
  const vessels: Vessel[] = [];
  try {
    console.log("[AIS] Connecting Norwegian AIS TCP...");
    const conn = await Deno.connect({ hostname: "153.44.253.27", port: 5631 });
    const decoder = new TextDecoder();
    let buffer = '';
    const mmsiSeen = new Set<string>();
    const timeout = setTimeout(() => { try { conn.close(); } catch {} }, 8000);
    try {
      const buf = new Uint8Array(8192);
      while (true) {
        const n = await conn.read(buf);
        if (n === null) break;
        buffer += decoder.decode(buf.subarray(0, n));
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const parsed = decodeAISNMEA(line.trim());
          if (parsed && !mmsiSeen.has(parsed.mmsi)) {
            mmsiSeen.add(parsed.mmsi);
            vessels.push({
              id: parsed.mmsi, mmsi: parsed.mmsi, name: `NO-${parsed.mmsi}`,
              type: shipType(parsed.shipType || 0), lat: parsed.lat, lng: parsed.lng,
              course: parsed.course ?? 0, speed: parsed.speed ?? 0,
              flag: getFlag(parsed.mmsi), ts: Date.now(), source: 'kystverket',
            });
          }
        }
      }
    } catch {} finally { clearTimeout(timeout); try { conn.close(); } catch {} }
    console.log(`[AIS] Kystverket: ${vessels.length} vessels`);
  } catch (e: any) { console.error("[AIS] Kystverket error:", e.message); }
  return vessels;
}

function decodeAISNMEA(sentence: string): { mmsi: string; lat: number; lng: number; course?: number; speed?: number; shipType?: number } | null {
  try {
    const parts = sentence.split(',');
    if (parts.length < 6 || parts[1] !== '1') return null;
    const payload = parts[5];
    if (!payload || payload.length < 20) return null;
    const bits = payload.split('').map(c => {
      let v = c.charCodeAt(0) - 48; if (v > 40) v -= 8;
      return v.toString(2).padStart(6, '0');
    }).join('');
    if (bits.length < 149) return null;
    const msgType = parseInt(bits.substring(0, 6), 2);
    if (msgType < 1 || msgType > 3) return null;
    const mmsi = parseInt(bits.substring(8, 38), 2).toString().padStart(9, '0');
    const speedRaw = parseInt(bits.substring(46, 56), 2);
    let lngRaw = parseInt(bits.substring(61, 89), 2);
    let latRaw = parseInt(bits.substring(89, 116), 2);
    const courseRaw = parseInt(bits.substring(116, 128), 2);
    if (lngRaw >= (1 << 27)) lngRaw -= (1 << 28);
    if (latRaw >= (1 << 26)) latRaw -= (1 << 27);
    const lng = lngRaw / 600000.0, lat = latRaw / 600000.0;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0) || lat === 91 || lng === 181) return null;
    return { mmsi, lat, lng, speed: speedRaw / 10.0, course: courseRaw / 10.0 };
  } catch { return null; }
}

// ── Source 3: AISStream (optional, needs AISSTREAM_API_KEY) ──
async function fetchAISStream(): Promise<Vessel[]> {
  const API_KEY = Deno.env.get("AISSTREAM_API_KEY");
  if (!API_KEY) return [];
  const vessels: Vessel[] = [];
  try {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 10000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ APIKey: API_KEY, BoundingBoxes: [[[-90, -180], [90, 180]]], FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport'] }));
      });
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.ERROR || msg.error) { clearTimeout(timeout); try { ws.close(); } catch {} resolve(); return; }
          const mmsi = String(msg?.MetaData?.MMSI ?? ''); if (!mmsi) return;
          const pr = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport; if (!pr) return;
          const { Latitude: lat, Longitude: lng } = pr;
          if (lat == null || lng == null || (lat === 0 && lng === 0)) return;
          vessels.push({ id: mmsi, mmsi, name: String(msg.MetaData?.ShipName ?? '').trim() || `VESSEL-${mmsi}`, type: shipType(msg.MetaData?.ShipType ?? 0), lat, lng, course: pr.Cog ?? pr.TrueHeading ?? 0, speed: pr.Sog ?? 0, flag: getFlag(mmsi), ts: Date.now(), source: 'aisstream' });
        } catch {}
      });
      ws.addEventListener('error', () => { clearTimeout(timeout); resolve(); });
      ws.addEventListener('close', () => { clearTimeout(timeout); resolve(); });
    });
  } catch {}
  return vessels;
}

// ── Metadata enrichment ──
let metaCache: { data: Map<string, any>; ts: number } = { data: new Map(), ts: 0 };
async function enrichMetadata(vessels: Vessel[]): Promise<void> {
  const now = Date.now();
  if (now - metaCache.ts < 300000 && metaCache.data.size > 0) { /* use cached */ }
  else {
    try {
      const res = await fetch('https://meri.digitraffic.fi/api/ais/v1/vessels', {
        headers: { 'Accept': 'application/json', 'Digitraffic-User': 'SoTaNik-Intel/2.0' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        const m = new Map<string, any>();
        for (const v of data) m.set(String(v.mmsi), v);
        metaCache = { data: m, ts: now };
      }
    } catch {}
  }
  for (const v of vessels) {
    if (v.source !== 'digitraffic' && v.source !== 'kystverket') continue;
    const meta = metaCache.data.get(v.mmsi ?? '');
    if (meta) {
      if (meta.name) v.name = meta.name.trim();
      if (meta.destination) v.destination = meta.destination.trim();
      if (meta.shipType) v.type = shipType(meta.shipType);
      if (meta.imo) v.imo = String(meta.imo);
    }
  }
}

function dedup(vessels: Vessel[]): Vessel[] {
  const map = new Map<string, Vessel>();
  for (const v of vessels) {
    const existing = map.get(v.id);
    if (!existing || v.ts > existing.ts) map.set(v.id, v);
  }
  return Array.from(map.values());
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const now = Date.now();
    if (now - vesselCache.timestamp < CACHE_TTL && vesselCache.data.length > 0) {
      const sources: Record<string, number> = {};
      for (const v of vesselCache.data) sources[v.source] = (sources[v.source] || 0) + 1;
      return new Response(JSON.stringify({ vessels: vesselCache.data, count: vesselCache.data.length, total: vesselCache.data.length, sources, lastUpdate: vesselCache.timestamp, cached: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [digitraffic, kystverket, aisstream] = await Promise.all([
      fetchDigitraffic(), fetchNorwegianAIS(), fetchAISStream(),
    ]);

    const allVessels = [...digitraffic, ...kystverket, ...aisstream];
    if (digitraffic.length > 0 || kystverket.length > 0) await enrichMetadata(allVessels);

    const deduplicated = dedup(allVessels);
    vesselCache = { data: deduplicated.slice(0, 20000), timestamp: now };

    const sources: Record<string, number> = {};
    for (const v of vesselCache.data) sources[v.source] = (sources[v.source] || 0) + 1;
    console.log(`[AIS] Serving ${vesselCache.data.length} REAL vessels: ${JSON.stringify(sources)}`);

    return new Response(JSON.stringify({ vessels: vesselCache.data, count: vesselCache.data.length, total: vesselCache.data.length, sources, lastUpdate: now, cached: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[AIS] Error:", err);
    return new Response(JSON.stringify({ vessels: [], count: 0, total: 0, sources: {}, lastUpdate: Date.now(), error: err.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
