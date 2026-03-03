const DEFAULT_LIMIT = 800;
const AIS_TTL_MS = 20 * 60 * 1000;

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
  aisstream: 'ais',
  marinetraffic: 'mt',
  datalastic: 'dl',
};

const globalState = globalThis.__NAVTRACK_AISSTREAM__ || {
  started: false,
  connected: false,
  error: null,
  ships: new Map(),
  lastMessageAt: null,
  reconnectTimer: null,
};
globalThis.__NAVTRACK_AISSTREAM__ = globalState;

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

function latLonToTile(lat, lon, zoom) {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function inBBox(ship, bbox) {
  return ship.lat >= bbox.minLat && ship.lat <= bbox.maxLat && ship.lon >= bbox.minLon && ship.lon <= bbox.maxLon;
}

async function fetchJson(url, extraHeaders = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'NAVTRACK/2.0 (+vercel)',
        accept: 'application/json,text/plain,*/*',
        ...extraHeaders,
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

  const mmsiRaw = raw.mmsi ?? raw.MMSI ?? raw.ais_id ?? raw.id ?? raw.userId ?? raw.userid;
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

function normalizeAisMessage(msg) {
  const root = msg?.Message || msg;
  const pr = root?.PositionReport || root?.StandardClassBPositionReport || root?.BaseStationReport;
  if (!pr) return null;

  const mmsi = String(pr.UserID ?? pr.MMSI ?? '').trim();
  const lat = parseNumber(pr.Latitude);
  const lon = parseNumber(pr.Longitude);
  if (!mmsi || lat == null || lon == null) return null;

  return {
    mmsi,
    name: `MMSI ${mmsi}`,
    imo: null,
    lat,
    lon,
    speed: parseNumber(pr.Sog),
    course: parseNumber(pr.Cog ?? pr.TrueHeading),
    flag: null,
    type: 'unknown',
    src: 'ais',
    sources: ['ais'],
    ts: Date.now(),
  };
}

function initAisStream() {
  if (globalState.started) return;
  globalState.started = true;

  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) {
    globalState.error = 'AISSTREAM_API_KEY is not set';
    return;
  }

  if (typeof WebSocket === 'undefined') {
    globalState.error = 'WebSocket runtime unavailable';
    return;
  }

  const connect = () => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

    ws.onopen = () => {
      globalState.connected = true;
      globalState.error = null;
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [[[-85, -180], [85, 180]]],
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const ship = normalizeAisMessage(payload);
        if (ship) {
          globalState.ships.set(ship.mmsi, ship);
          globalState.lastMessageAt = Date.now();
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onerror = () => {
      globalState.error = 'AISstream websocket error';
    };

    ws.onclose = () => {
      globalState.connected = false;
      globalState.reconnectTimer = setTimeout(connect, 4000);
    };
  };

  connect();
}

function readAisShipsInBbox(bbox) {
  const now = Date.now();
  const out = [];
  for (const [mmsi, ship] of globalState.ships.entries()) {
    if (now - ship.ts > AIS_TTL_MS) {
      globalState.ships.delete(mmsi);
      continue;
    }
    if (inBBox(ship, bbox)) out.push(ship);
  }
  return out;
}

async function fromMarineTraffic(lat, lon, zoom) {
  const z = Math.max(4, Math.min(10, Math.floor(zoom)));
  const center = latLonToTile(lat, lon, z);

  const requests = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = center.x + dx;
      const y = center.y + dy;
      if (x < 0 || y < 0) continue;
      const url = `https://www.marinetraffic.com/getData/get_data_json_4/z:${z}/X:${x}/Y:${y}/station:0`;
      requests.push(
        fetchJson(url, {
          referer: 'https://www.marinetraffic.com/',
          origin: 'https://www.marinetraffic.com',
        }).catch(() => []),
      );
    }
  }

  const settled = await Promise.all(requests);
  const rows = settled.flatMap((r) => (Array.isArray(r) ? r : []));

  const ships = rows
    .map((row) => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const [mmsi, latV, lonV, course, speed, name, type] = row;
      return normalizeShip({
        mmsi,
        lat: latV,
        lon: lonV,
        course,
        speed,
        name,
        type,
      }, 'marinetraffic');
    })
    .filter(Boolean);

  return ships;
}

async function fromDatalasticWithKey(bbox) {
  const key = process.env.DATALASTIC_API_KEY;
  if (!key) throw new Error('API key required');

  const lat = ((bbox.minLat + bbox.maxLat) / 2).toFixed(5);
  const lon = ((bbox.minLon + bbox.maxLon) / 2).toFixed(5);
  const url = `https://api.datalastic.com/api/v0/vessel_inradius?lat=${lat}&lon=${lon}&radius=200&api-key=${encodeURIComponent(key)}`;
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
        map.set(ship.mmsi, {
          ...current,
          ...ship,
          sources: [...new Set([...(current.sources || []), ...(ship.sources || [])])],
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
    return {
      mmsi: `999${String(i).padStart(6, '0')}`,
      name: `SIM-${i + 1}`,
      imo: null,
      lat: lat + (Math.cos(angle) * dist),
      lon: lon + (Math.sin(angle) * dist),
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

async function runSource(fn) {
  try {
    const ships = await fn();
    return { ok: true, ships, count: ships.length, error: null };
  } catch (error) {
    return { ok: false, ships: [], count: null, error: error?.message || 'failed' };
  }
}

export default async function handler(req, res) {
  const lat = Number(req.query.lat ?? 25);
  const lon = Number(req.query.lon ?? 15);
  const zoom = Number(req.query.zoom ?? 4);
  const allowSimulation = req.query.allowSimulation !== '0';

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon must be numbers' });
  }

  initAisStream();
  const bbox = buildBBox(lat, lon, zoom);

  const aisShips = readAisShipsInBbox(bbox);
  const aisStatus = {
    ok: globalState.connected && aisShips.length > 0,
    count: aisShips.length,
    error: globalState.error,
    requiresApiKey: true,
  };

  const [mt, dl] = await Promise.all([
    runSource(() => fromMarineTraffic(lat, lon, zoom)),
    runSource(() => fromDatalasticWithKey(bbox)),
  ]);

  const bySource = {
    aisstream: aisShips,
    marinetraffic: mt.ships,
    datalastic: dl.ships,
  };

  const sources = {
    aisstream: aisStatus,
    marinetraffic: { ok: mt.ok, count: mt.count, error: mt.error, requiresApiKey: false },
    datalastic: { ok: dl.ok, count: dl.count, error: dl.error, requiresApiKey: true },
  };

  let ships = mergeShips(bySource).slice(0, DEFAULT_LIMIT);
  let fallback = null;

  if (ships.length === 0 && allowSimulation) {
    ships = mockShips(lat, lon, 180);
    fallback = 'simulated';
  }

  const noKeyReachable = ['marinetraffic'].filter((k) => sources[k].ok);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ships,
    meta: {
      center: { lat, lon },
      zoom,
      bbox,
      count: ships.length,
      fallback,
      noKeyReachable,
      message: noKeyReachable.length
        ? `No-key live providers reachable: ${noKeyReachable.join(', ')}`
        : 'No no-key live provider reachable right now (AISstream can still work with key).',
      sources,
      generatedAt: new Date().toISOString(),
      aisstream: {
        connected: globalState.connected,
        shipCacheSize: globalState.ships.size,
        lastMessageAt: globalState.lastMessageAt,
      },
    },
  });
}
