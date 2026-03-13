import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const KNOWN_LOCATIONS: Record<string, [number, number]> = {
  'ukraine': [49.0, 32.0], 'kyiv': [50.45, 30.52], 'kharkiv': [49.99, 36.23], 'odesa': [46.48, 30.73], 'zaporizhzhia': [47.84, 35.14],
  'russia': [55.75, 37.62], 'moscow': [55.75, 37.62], 'crimea': [44.95, 34.1], 'kursk': [51.73, 36.19],
  'gaza': [31.5, 34.47], 'israel': [31.77, 35.22], 'tel aviv': [32.09, 34.78], 'jerusalem': [31.77, 35.22], 'rafah': [31.3, 34.25], 'khan younis': [31.35, 34.3],
  'iran': [35.69, 51.39], 'tehran': [35.69, 51.39], 'isfahan': [32.65, 51.68],
  'syria': [33.51, 36.29], 'damascus': [33.51, 36.29], 'aleppo': [36.2, 37.15], 'idlib': [35.93, 36.63],
  'yemen': [15.37, 44.19], 'houthi': [15.37, 44.19], 'red sea': [20.0, 38.0], 'sanaa': [15.35, 44.21],
  'taiwan': [25.03, 121.56], 'taipei': [25.03, 121.56],
  'china': [39.9, 116.4], 'beijing': [39.9, 116.4], 'shanghai': [31.23, 121.47], 'south china sea': [12.0, 114.0],
  'north korea': [39.03, 125.75], 'pyongyang': [39.03, 125.75],
  'south korea': [37.57, 126.98], 'seoul': [37.57, 126.98],
  'japan': [35.68, 139.69], 'tokyo': [35.68, 139.69], 'okinawa': [26.34, 127.77],
  'india': [28.61, 77.21], 'new delhi': [28.61, 77.21], 'mumbai': [19.08, 72.88], 'kashmir': [34.08, 74.8],
  'pakistan': [33.69, 73.04], 'islamabad': [33.69, 73.04], 'karachi': [24.86, 67.01],
  'afghanistan': [34.53, 69.17], 'kabul': [34.53, 69.17],
  'iraq': [33.31, 44.37], 'baghdad': [33.31, 44.37], 'mosul': [36.34, 43.14],
  'lebanon': [33.89, 35.5], 'beirut': [33.89, 35.5], 'hezbollah': [33.89, 35.5],
  'libya': [32.9, 13.18], 'tripoli': [32.9, 13.18],
  'sudan': [15.59, 32.53], 'khartoum': [15.59, 32.53],
  'somalia': [2.05, 45.34], 'mogadishu': [2.05, 45.34],
  'ethiopia': [9.02, 38.75], 'niger': [13.51, 2.11],
  'nigeria': [9.06, 7.49], 'mali': [12.64, -8.0], 'burkina faso': [12.37, -1.52],
  'congo': [-4.32, 15.31], 'south africa': [-33.92, 18.42],
  'egypt': [30.04, 31.24], 'cairo': [30.04, 31.24], 'suez': [29.97, 32.53],
  'turkey': [39.93, 32.85], 'ankara': [39.93, 32.85], 'istanbul': [41.01, 28.98],
  'united states': [38.9, -77.04], 'washington': [38.9, -77.04], 'pentagon': [38.87, -77.06],
  'new york': [40.71, -74.01], 'los angeles': [34.05, -118.24],
  'united kingdom': [51.51, -0.13], 'london': [51.51, -0.13],
  'france': [48.86, 2.35], 'paris': [48.86, 2.35],
  'germany': [52.52, 13.41], 'berlin': [52.52, 13.41],
  'nato': [50.87, 4.42], 'brussels': [50.85, 4.35],
  'strait of hormuz': [26.6, 56.3], 'strait of malacca': [2.5, 101.0],
  'black sea': [43.0, 35.0], 'baltic sea': [58.0, 20.0], 'mediterranean': [35.0, 18.0],
  'persian gulf': [27.0, 51.0], 'gulf of aden': [12.0, 45.0], 'arctic': [75.0, 0.0],
  'panama canal': [9.08, -79.68], 'suez canal': [30.46, 32.34],
  'mexico': [19.43, -99.13], 'brazil': [-15.79, -47.88], 'venezuela': [10.49, -66.88],
  'colombia': [4.71, -74.07], 'myanmar': [16.87, 96.2], 'philippines': [14.6, 120.98],
  'indonesia': [-6.21, 106.85], 'singapore': [1.35, 103.82], 'australia': [-33.87, 151.21],
  'poland': [52.23, 21.01], 'romania': [44.43, 26.1], 'finland': [60.17, 24.94],
  'sweden': [59.33, 18.07], 'norway': [59.91, 10.75],
};

function geocodeFromText(text: string): { coords: [number, number]; place: string; country: string } | null {
  const lower = text.toLowerCase();
  let bestMatch = '';
  let bestCoords: [number, number] | null = null;
  for (const [place, coords] of Object.entries(KNOWN_LOCATIONS)) {
    if (lower.includes(place) && place.length > bestMatch.length) {
      bestMatch = place;
      bestCoords = coords;
    }
  }
  if (!bestCoords) return null;
  const countryNames = ['ukraine','russia','israel','iran','syria','yemen','taiwan','china','north korea','south korea',
    'japan','india','pakistan','afghanistan','iraq','lebanon','libya','sudan','somalia','ethiopia','nigeria',
    'egypt','turkey','united states','united kingdom','france','germany','mexico','brazil','australia',
    'philippines','indonesia','poland','romania','finland','sweden','norway','colombia','myanmar','south africa','venezuela'];
  let country = bestMatch;
  for (const cn of countryNames) {
    if (lower.includes(cn)) { country = cn; break; }
  }
  return { coords: bestCoords, place: bestMatch, country };
}

const THREAT_KEYWORDS = [
  'attack', 'bomb', 'missile', 'explosion', 'strike', 'war', 'conflict', 'military',
  'terror', 'shoot', 'kill', 'dead', 'casualt', 'weapon', 'nuclear', 'drone',
  'sanction', 'invasion', 'troops', 'navy', 'airforce', 'army', 'siege',
  'protest', 'riot', 'coup', 'rebel', 'insurgent', 'militia', 'hostage',
  'earthquake', 'tsunami', 'hurricane', 'typhoon', 'flood', 'wildfire',
  'cyber', 'hack', 'breach', 'espionage', 'intelligence',
  'refugee', 'humanitarian', 'crisis', 'famine', 'epidemic',
  'piracy', 'hijack', 'smuggl', 'trafficking',
  'deploy', 'escalat', 'retaliat', 'tensions',
  'naval', 'aircraft carrier', 'submarine', 'destroyer',
  'airspace', 'no-fly', 'blockade', 'embargo', 'launch',
  'radar', 'intercept', 'fighter jet', 'warship', 'convoy',
];

function categorizeEvent(title: string): { category: string; severity: string } {
  const lower = title.toLowerCase();
  if (/missile|bomb|strike|attack|explosion|shell|airstrike/i.test(lower)) return { category: 'military_strike', severity: 'critical' };
  if (/nuclear|wmd|chemical weapon/i.test(lower)) return { category: 'wmd', severity: 'critical' };
  if (/war |invasion|troops deploy|escalat|offensive/i.test(lower)) return { category: 'conflict', severity: 'high' };
  if (/terror|hostage|insurgent/i.test(lower)) return { category: 'terrorism', severity: 'high' };
  if (/earthquake|tsunami|hurricane|typhoon/i.test(lower)) return { category: 'natural_disaster', severity: 'high' };
  if (/protest|riot|coup|unrest/i.test(lower)) return { category: 'civil_unrest', severity: 'medium' };
  if (/cyber|hack|breach/i.test(lower)) return { category: 'cyber', severity: 'medium' };
  if (/piracy|hijack|smuggl/i.test(lower)) return { category: 'maritime', severity: 'medium' };
  if (/sanction|embargo|blockade/i.test(lower)) return { category: 'geopolitical', severity: 'medium' };
  if (/naval|aircraft carrier|submarine|destroyer|military exercise|radar|warship|convoy|launch/i.test(lower)) return { category: 'military_movement', severity: 'medium' };
  if (/refugee|humanitarian|famine|crisis/i.test(lower)) return { category: 'humanitarian', severity: 'medium' };
  return { category: 'incident', severity: 'low' };
}

async function aiClassifyBatch(articles: { title: string; url?: string }[]): Promise<any[]> {
  if (!LOVABLE_API_KEY || articles.length === 0) return [];
  
  const titles = articles.slice(0, 30).map((a, i) => `${i + 1}. ${a.title}`).join('\n');
  
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [{
          role: 'user',
          content: `You are a military/security intelligence analyst. From the following news headlines, identify ONLY those that are actual security alerts (military movements, attacks, missile launches, conflicts, natural disasters, cyber attacks, terrorism). Skip normal politics, economics, sports, entertainment.

For each relevant headline, return a JSON array of objects: {"idx": number, "lat": number, "lng": number, "location": "string", "country": "string"}

Return ONLY the JSON array, no other text. If none are relevant, return [].

Headlines:
${titles}`
        }],
        max_tokens: 1500,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '[]';
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e: any) {
    console.log("[NEWS-GEO] AI batch classify failed:", e.message);
    return [];
  }
}

async function fetchGDELT(): Promise<{ title: string; url: string; domain: string; date: string }[]> {
  const queries = [
    'conflict OR military OR attack OR missile',
    'war OR strike OR explosion OR troops OR drone',
    'earthquake OR tsunami OR hurricane OR nuclear',
  ];
  const articles: any[] = [];
  
  const results = await Promise.allSettled(
    queries.map(q =>
      fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&maxrecords=30&format=json&sort=datedesc&timespan=1d`, {
        signal: AbortSignal.timeout(8000),
      }).then(r => r.ok ? r.json() : null)
    )
  );
  
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.articles) continue;
    for (const art of r.value.articles) {
      if (!art.title || seen.has(art.title)) continue;
      seen.add(art.title);
      articles.push({
        title: art.title,
        url: art.url || '',
        domain: art.domain || 'GDELT',
        date: art.seendate || '',
      });
    }
  }
  return articles;
}

async function fetchRSSFeeds(): Promise<{ title: string; url: string; domain: string; date: string }[]> {
  // Use free RSS-to-JSON converters for major alert feeds
  const feeds = [
    'https://api.rss2json.com/v1/api.json?rss_url=https://feeds.bbci.co.uk/news/world/rss.xml&count=20',
    'https://api.rss2json.com/v1/api.json?rss_url=https://rss.nytimes.com/services/xml/rss/nyt/World.xml&count=20',
    'https://api.rss2json.com/v1/api.json?rss_url=https://www.aljazeera.com/xml/rss/all.xml&count=20',
  ];
  
  const articles: any[] = [];
  const results = await Promise.allSettled(
    feeds.map(url =>
      fetch(url, { signal: AbortSignal.timeout(6000) }).then(r => r.ok ? r.json() : null)
    )
  );
  
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value?.items) continue;
    for (const item of r.value.items) {
      if (!item.title) continue;
      articles.push({
        title: item.title,
        url: item.link || '',
        domain: new URL(item.link || 'https://unknown').hostname.replace('www.', ''),
        date: item.pubDate || new Date().toISOString(),
      });
    }
  }
  return articles;
}

function parseGDELTDate(d: string): string {
  try {
    if (/^\d{14}$/.test(d)) {
      return new Date(d.replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6Z')).toISOString();
    }
    return new Date(d).toISOString();
  } catch { return new Date().toISOString(); }
}

async function fetchAndGeocodeNews(): Promise<any[]> {
  // Fetch from multiple sources in parallel
  const [gdeltArticles, rssArticles] = await Promise.allSettled([fetchGDELT(), fetchRSSFeeds()]);
  
  const allArticles: { title: string; url: string; domain: string; date: string }[] = [];
  if (gdeltArticles.status === 'fulfilled') allArticles.push(...gdeltArticles.value);
  if (rssArticles.status === 'fulfilled') allArticles.push(...rssArticles.value);
  
  console.log(`[NEWS-GEO] Fetched ${allArticles.length} articles from all sources`);
  if (allArticles.length === 0) return [];

  // Filter by threat keywords first
  const relevant = allArticles.filter(a => {
    const lower = a.title.toLowerCase();
    return THREAT_KEYWORDS.some(kw => lower.includes(kw));
  });
  
  console.log(`[NEWS-GEO] ${relevant.length} articles match threat keywords`);
  
  const events: any[] = [];
  
  // Step 1: Try keyword-based geocoding (instant, no API calls)
  const needsAI: { title: string; url?: string; idx: number }[] = [];
  
  for (let i = 0; i < relevant.length; i++) {
    const art = relevant[i];
    const geo = geocodeFromText(art.title);
    if (geo) {
      const { category, severity } = categorizeEvent(art.title);
      events.push({
        title: art.title.slice(0, 500),
        summary: `Source: ${art.domain} | ${art.date}`,
        category, severity,
        lat: geo.coords[0], lng: geo.coords[1],
        location_name: geo.place, country: geo.country,
        source_url: art.url, source_name: art.domain,
        event_time: parseGDELTDate(art.date),
        tags: [category, severity, geo.country].filter(Boolean),
      });
    } else {
      needsAI.push({ title: art.title, url: art.url, idx: i });
    }
  }
  
  // Step 2: Batch AI geocoding for remaining articles
  if (needsAI.length > 0 && LOVABLE_API_KEY) {
    const aiResults = await aiClassifyBatch(needsAI);
    for (const r of aiResults) {
      if (!r || typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
      const idx = (r.idx || 1) - 1;
      const art = needsAI[idx];
      if (!art) continue;
      const origArt = relevant.find(a => a.title === art.title);
      if (!origArt) continue;
      const { category, severity } = categorizeEvent(art.title);
      events.push({
        title: art.title.slice(0, 500),
        summary: `Source: ${origArt.domain} | ${origArt.date}`,
        category, severity,
        lat: r.lat, lng: r.lng,
        location_name: r.location || '', country: r.country || '',
        source_url: origArt.url, source_name: origArt.domain,
        event_time: parseGDELTDate(origArt.date),
        tags: [category, severity, r.country].filter(Boolean),
      });
    }
  }

  console.log(`[NEWS-GEO] Geocoded ${events.length} events from news`);
  return events;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "scan";

    if (mode === "read") {
      const { data, error } = await supabase
        .from('intel_events')
        .select('*')
        .order('event_time', { ascending: false })
        .limit(500);
      if (error) throw error;
      return new Response(JSON.stringify({ events: data || [], count: data?.length || 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Auto-purge events older than 7 days
    await supabase.from('intel_events').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());

    console.log("[NEWS-GEO] Starting news scan...");
    const events = await fetchAndGeocodeNews();

    if (events.length > 0) {
      const { data: existing } = await supabase
        .from('intel_events')
        .select('title, lat, lng')
        .gte('created_at', new Date(Date.now() - 86400000).toISOString());

      const existingSet = new Set((existing || []).map(e => `${e.title.slice(0, 80)}_${e.lat.toFixed(1)}_${e.lng.toFixed(1)}`));
      const newEvents = events.filter(e => {
        const key = `${e.title.slice(0, 80)}_${e.lat.toFixed(1)}_${e.lng.toFixed(1)}`;
        return !existingSet.has(key);
      });

      if (newEvents.length > 0) {
        // Insert in batches of 50
        for (let i = 0; i < newEvents.length; i += 50) {
          const batch = newEvents.slice(i, i + 50);
          const { error } = await supabase.from('intel_events').insert(batch);
          if (error) console.error("[NEWS-GEO] Insert error:", error.message);
        }
        console.log(`[NEWS-GEO] Stored ${newEvents.length} new events`);
      }
    }

    const { data: allEvents } = await supabase
      .from('intel_events')
      .select('*')
      .order('event_time', { ascending: false })
      .limit(500);

    return new Response(JSON.stringify({ events: allEvents || [], count: allEvents?.length || 0, scanned: events.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[NEWS-GEO] Error:", err);
    return new Response(JSON.stringify({ error: err.message, events: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
