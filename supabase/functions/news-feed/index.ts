import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// In-memory cache to avoid hammering GDELT
let cache: { ts: number; mode: string; articles: any[] } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 min cache

async function fetchGDELT(query: string): Promise<any[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&maxrecords=15&sort=DateDesc&format=json&timespan=3d`;
  
  const resp = await fetch(url, {
    headers: { "User-Agent": "SoTaNik_AI/2.0" },
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`[GDELT] ${resp.status}: ${body.slice(0, 200)}`);
    return [];
  }

  const data = await resp.json();
  return (data.articles || []).map((a: any) => ({
    title: a.title || "",
    url: a.url || "",
    source: a.domain || a.source || "",
    date: a.seendate || "",
    language: a.language || "English",
    image: a.socialimage || "",
    tone: a.tone ? parseFloat(String(a.tone).split(",")[0]) : null,
    country: a.sourcecountry || "",
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { mode } = await req.json().catch(() => ({ mode: "global" }));

    // Serve from cache if fresh
    if (cache && cache.mode === mode && Date.now() - cache.ts < CACHE_TTL) {
      return new Response(JSON.stringify({ articles: cache.articles, geoEvents: [], count: cache.articles.length, ts: cache.ts }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queries: Record<string, string> = {
      military: "military defense missile",
      threats: "terrorism conflict attack",
      maritime: "shipping maritime naval",
      space: "satellite space rocket",
      global: "India defense security",
    };

    const query = queries[mode] || queries.global;
    console.log(`[GDELT] Fetching: mode=${mode}, query=${query}`);

    let articles: any[] = [];
    try {
      articles = await fetchGDELT(query);
    } catch (e) {
      console.error("[GDELT] Fetch failed:", e);
    }

    // If GDELT fails, try a simpler single-word query as fallback
    if (articles.length === 0) {
      try {
        articles = await fetchGDELT("India");
      } catch { /* give up */ }
    }

    // Update cache
    if (articles.length > 0) {
      cache = { ts: Date.now(), mode, articles };
    }

    return new Response(JSON.stringify({ articles, geoEvents: [], count: articles.length, ts: Date.now() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("news-feed error:", e);
    // Return cached data if available
    if (cache) {
      return new Response(JSON.stringify({ articles: cache.articles, geoEvents: [], count: cache.articles.length, ts: cache.ts, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ articles: [], geoEvents: [], count: 0, ts: Date.now(), error: "News temporarily unavailable" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
