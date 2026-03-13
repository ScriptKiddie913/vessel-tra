import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BASE = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=';
const FMT = '&FORMAT=tle';

// In-memory cache: category -> { raw, ts }
const cache = new Map<string, { raw: string; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 min

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let category = "active";
    try {
      const body = await req.json();
      category = body.category || "active";
    } catch {
      const url = new URL(req.url);
      category = url.searchParams.get("category") || "active";
    }

    // Check cache
    const cached = cache.get(category);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      console.log(`[TLE] Cache hit for ${category} (${cached.raw.length} bytes)`);
      return new Response(cached.raw, {
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    // Fetch from CelesTrak
    const url = `${BASE}${category}${FMT}`;
    console.log(`[TLE] Fetching ${url}`);
    
    const res = await fetch(url, {
      headers: { "User-Agent": "SoTaNik-AI/2.0 (satellite-intelligence)" },
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) {
      throw new Error(`CelesTrak returned ${res.status}`);
    }

    const raw = await res.text();
    
    if (raw.length < 100) {
      throw new Error("Response too small - likely error page");
    }

    // Cache it
    cache.set(category, { raw, ts: Date.now() });
    console.log(`[TLE] Cached ${category}: ${raw.length} bytes`);

    return new Response(raw, {
      headers: { ...corsHeaders, "Content-Type": "text/plain" },
    });
  } catch (err: any) {
    console.error("[TLE] Error:", err.message);
    
    // Return any cached data even if stale
    for (const [key, val] of cache) {
      if (val.raw.length > 100) {
        console.log(`[TLE] Returning stale cache for ${key}`);
        return new Response(val.raw, {
          headers: { ...corsHeaders, "Content-Type": "text/plain" },
        });
      }
    }

    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
