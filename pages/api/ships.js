const DEFAULT_LIMIT = 500;

const TYPE_ALIASES = {
  cargo: 'cargo',
  tanker: 'tanker',
  passenger: 'passenger',
  fishing: 'fishing',
  tug: 'tug',
  tow: 'tug',
  sailing: 'sailing',
  military: 'military',
  naval: 'military',
  highspeed: 'highspeed',
  hsc: 'highspeed',
  pleasure: 'pleasure',
  yacht: 'pleasure',
};

const SOURCE_NAMES = {
  myshiptracking: 'mst',
  vesselfinder: 'vf',
  datalastic: 'dl',
};

function toType(typeText) {
  const text = String(typeText || 'unknown').toLowerCase();
  for (const [key, value] of Object.entries(TYPE_ALIASES)) {
    if (text.includes(key)) return value;
  }
  return 'unknown';
}

function parseNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildBBox(lat, lon, zoom) {
  const span = Math.max(0.6, Math.min(45, 120 / Math.pow(2, Math.max(zoom, 2) - 2)));
  return {
    minLat: Math.max(-85, lat - span / 2),
    maxLat: Math.min(85, lat + span / 2),
    minLon: Math.max(-180, lon - span),
    maxLon: Math.min(180, lon + span),
  };
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'NAVTRACK/1.0 (+vercel)',
        accept: 'application/json,text/plain,*/*',
      },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeShip(raw, source) {
  const lat = parseNumber(raw.lat ?? raw.latitude ?? raw.y);
  const lon = parseNumber(raw.lon ?? raw.lng ?? raw.longitude ?? raw.x);
  if (lat == null || lon == null) return null;

  const mmsiRaw = raw.mmsi ?? raw.MMSI ?? raw.ais_id ?? raw.id;
  if (mmsiRaw == null) return null;

  const mmsi = String(mmsiRaw).trim();
  if (!mmsi) return null;

  return {
    mmsi,
    name: raw.name ?? raw.vessel_name ?? raw.shipname ?? `MMSI ${mmsi}`,
    imo: raw.imo ? String(raw.imo) : null,
    lat,
    lon,
    speed: parseNumber(raw.speed ?? raw.sog),
    course: parseNumber(raw.course ?? raw.cog ?? raw.heading),
    flag: raw.flag ?? raw.flag_name ?? raw.country ?? null,
    type: toType(raw.type ?? raw.ship_type ?? raw.vessel_type),
    src: SOURCE_NAMES[source],
    sources: [SOURCE_NAMES[source]],
    ts: Date.now(),
  };
}

async function fromMyShipTracking(bbox) {
  const url = `https://www.myshiptracking.com/requests/vesselsonmap.php?minLat=${bbox.minLat.toFixed(5)}&maxLat=${bbox.maxLat.toFixed(5)}&minLon=${bbox.minLon.toFixed(5)}&maxLon=${bbox.maxLon.toFixed(5)}`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return rows.map((item) => normalizeShip(item, 'myshiptracking')).filter(Boolean);
}

async function fromVesselFinder(bbox) {
  const url = `https://www.vesselfinder.com/api/pub/vessels?min_lat=${bbox.minLat.toFixed(5)}&max_lat=${bbox.maxLat.toFixed(5)}&min_lon=${bbox.minLon.toFixed(5)}&max_lon=${bbox.maxLon.toFixed(5)}`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.vessels) ? data.vessels : Array.isArray(data) ? data : [];
  return rows.map((item) => normalizeShip(item, 'vesselfinder')).filter(Boolean);
}

async function fromDatalastic(bbox) {
  const url = `https://api.datalastic.com/api/v0/vessel_inradius?lat=${((bbox.minLat + bbox.maxLat) / 2).toFixed(5)}&lon=${((bbox.minLon + bbox.maxLon) / 2).toFixed(5)}&radius=200`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data?.vessels) ? data.vessels : [];
  return rows.map((item) => normalizeShip(item, 'datalastic')).filter(Boolean);
}

function mergeShips(listBySource) {
  const map = new Map();
  for (const ships of Object.values(listBySource)) {
    for (const ship of ships) {
      if (!map.has(ship.mmsi)) {
        map.set(ship.mmsi, ship);
      } else {
        const current = map.get(ship.mmsi);
        const mergedSources = new Set([...(current.sources || []), ...(ship.sources || [])]);
        map.set(ship.mmsi, {
          ...current,
          ...ship,
          sources: [...mergedSources],
        });
      }
    }
  }
  return [...map.values()];
}

function mockShips(lat, lon, count = 120) {
  const types = ['cargo', 'tanker', 'passenger', 'fishing', 'tug', 'sailing', 'military', 'highspeed', 'pleasure', 'unknown'];
  return Array.from({ length: count }).map((_, i) => {
    const dist = (Math.random() * 2.8) + 0.1;
    const angle = Math.random() * Math.PI * 2;
    const dLat = Math.cos(angle) * dist;
    const dLon = Math.sin(angle) * dist;
    const mmsi = `999${String(i).padStart(6, '0')}`;
    return {
      mmsi,
      name: `SIM-${i + 1}`,
      imo: null,
      lat: lat + dLat,
      lon: lon + dLon,
      speed: Number((Math.random() * 19).toFixed(1)),
      course: Math.round(Math.random() * 359),
      flag: ['PA', 'LR', 'SG', 'NO', 'GR'][i % 5],
      type: types[i % types.length],
      src: 'sim',
      sources: ['sim'],
      ts: Date.now(),
    };
  });
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat ?? 25);
  const lon = Number(req.query.lon ?? 15);
  const zoom = Number(req.query.zoom ?? 4);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon must be numbers' });
  }

  const bbox = buildBBox(lat, lon, zoom);

  const sources = {
    myshiptracking: { ok: false, count: null, error: null },
    vesselfinder: { ok: false, count: null, error: null },
    datalastic: { ok: false, count: null, error: null },
  };

  const [mst, vf, dl] = await Promise.allSettled([
    fromMyShipTracking(bbox),
    fromVesselFinder(bbox),
    fromDatalastic(bbox),
  ]);

  const bySource = { myshiptracking: [], vesselfinder: [], datalastic: [] };

  if (mst.status === 'fulfilled') {
    bySource.myshiptracking = mst.value;
    sources.myshiptracking = { ok: true, count: mst.value.length, error: null };
  } else {
    sources.myshiptracking = { ok: false, count: null, error: mst.reason?.message || 'failed' };
  }

  if (vf.status === 'fulfilled') {
    bySource.vesselfinder = vf.value;
    sources.vesselfinder = { ok: true, count: vf.value.length, error: null };
  } else {
    sources.vesselfinder = { ok: false, count: null, error: vf.reason?.message || 'failed' };
  }

  if (dl.status === 'fulfilled') {
    bySource.datalastic = dl.value;
    sources.datalastic = { ok: true, count: dl.value.length, error: null };
  } else {
    sources.datalastic = { ok: false, count: null, error: dl.reason?.message || 'failed' };
  }

  let ships = mergeShips(bySource).slice(0, DEFAULT_LIMIT);
  let fallback = null;

  if (ships.length === 0) {
    ships = mockShips(lat, lon, 180);
    fallback = 'simulated';
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ships,
    meta: {
      center: { lat, lon },
      zoom,
      bbox,
      count: ships.length,
      fallback,
      sources,
      generatedAt: new Date().toISOString(),
    },
  });
}
