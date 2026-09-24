const UPSTREAMS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

const UA = "NearbyBites/1.1 (+https://github.com/captnwalker/nearby-bites)";
const FETCH_MI = 3;
const OUT_CAP = 80;

function buildQuery(lat, lon, meters) {
  return `[out:json][timeout:12][maxsize:524288];
nwr["amenity"~"^(restaurant|cafe)$"](around:${meters},${lat},${lon});
out center ${OUT_CAP} tags;`;
}

function looksFailed(status, text, json) {
  if (status === 429 || status === 504 || status === 502 || status === 503 || status === 406) {
    return true;
  }
  const blob = `${text || ""} ${json && json.remark ? json.remark : ""}`.toLowerCase();
  return (
    blob.includes("rate_limited") ||
    blob.includes("too many requests") ||
    blob.includes("quota of your ip") ||
    blob.includes("runtime error") ||
    blob.includes("query timed out") ||
    blob.includes("dispatcher")
  );
}

async function askUpstream(url, query, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: "data=" + encodeURIComponent(query),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (!res.ok || !json || looksFailed(res.status, text, json)) {
      throw new Error("upstream " + res.status);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }

  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  const miles = Number(req.query.m);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: "bad coordinates" });
    return;
  }
  if (!Number.isFinite(miles) || miles < 0.2 || miles > 5) {
    res.status(400).json({ error: "bad radius" });
    return;
  }

  const rLat = Math.round(lat * 200) / 200;
  const rLon = Math.round(lon * 200) / 200;
  const fetchMiles = miles > FETCH_MI ? Math.round(miles * 4) / 4 : FETCH_MI;
  const meters = Math.round(fetchMiles * 1609.344);
  const query = buildQuery(rLat, rLon, meters);

  let lastErr = "overpass busy";
  for (let i = 0; i < UPSTREAMS.length; i++) {
    try {
      const data = await askUpstream(UPSTREAMS[i], query, i === 0 ? 10000 : 8000);
      res.setHeader("Cache-Control", "public, s-maxage=14400, stale-while-revalidate=86400");
      res.setHeader("X-Overpass-Source", UPSTREAMS[i]);
      res.setHeader("X-Fetch-Miles", String(fetchMiles));
      res.status(200).json({
        elements: data.elements || [],
        osm3s: data.osm3s || null,
        fetchMiles: fetchMiles,
      });
      return;
    } catch (err) {
      lastErr = err && err.message ? err.message : String(err);
    }
  }

  res.setHeader("Cache-Control", "public, s-maxage=90, stale-while-revalidate=30");
  res.status(503).json({ error: "map servers busy", detail: lastErr });
};
