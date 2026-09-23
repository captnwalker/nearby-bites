(() => {
  const WALK_MI = 0.5;
  const DRIVE_MI = 3;
  const PAGE = 25;
  const FAV_KEY = "nearby-bites-favs";
  const CACHE_KEY = "nearby-bites-place-cache";
  const CACHE_MS = 6 * 60 * 60 * 1000;
  const OVERPASS_URLS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass-api.de/api/interpreter",
  ];
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const PHOTON = "https://photon.komoot.io/api/";
  const $ = (id) => document.getElementById(id);
  const cityInput = $("city");
  const qInput = $("q");
  const listEl = $("list");
  const statusEl = $("status");
  const placeLabel = $("place-label");
  const moreBtn = $("btn-more");
  const retryBtn = $("btn-retry");
  const searchAreaBtn = $("btn-search-area");
  const radiusInput = $("radius");
  const radiusLabel = $("radius-label");
  const distExtra = $("dist-extra");
  const state = {
    lat: null, lon: null, label: "", miles: WALK_MI,
    places: [], filtered: [], shown: PAGE, markers: [],
    savedOnly: false, mapMoved: false, stale: false, inflight: 0,
  };
  const map = L.map("map", { zoomControl: false, attributionControl: true });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a>",
  }).addTo(map);
  map.setView([39.8283, -98.5795], 4);
  let youMarker = null;
  function miToM(mi) { return mi * 1609.344; }
  function haversine(aLat, aLon, bLat, bLon) {
    const R = 3958.8;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function loadFavs() { try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); } catch { return []; } }
  function saveFavs(ids) { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); }
  function isFav(id) { return loadFavs().includes(id); }
  function toggleFav(id) {
    const favs = loadFavs();
    const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1); else favs.push(id);
    saveFavs(favs);
  }
  function tag(tags, ...keys) {
    if (!tags) return "";
    for (const k of keys) { if (tags[k]) return String(tags[k]).trim(); }
    return "";
  }
  function phoneHref(num) {
    const cleaned = num.replace(/[^\d+]/g, "");
    return cleaned ? "tel:" + cleaned : "";
  }
  function mapsUrl(place) {
    const q = encodeURIComponent([place.name, place.address].filter(Boolean).join(" "));
    const ll = place.lat + "," + place.lon;
    if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return "https://maps.apple.com/?ll=" + ll + "&q=" + q;
    return "https://www.google.com/maps/search/?api=1&query=" + ll;
  }
  function hasUsefulData(p) { return Boolean(p.hours || p.cuisine || p.phone); }
  function setStatus(text) { statusEl.textContent = text; }
  function formatMiles(mi) {
    if (mi < 0.1) return Math.round(mi * 5280) + " ft";
    return mi.toFixed(mi < 1 ? 2 : 1) + " mi";
  }
  function cacheKey(lat, lon, miles) {
    return (Math.round(lat * 1000) / 1000).toFixed(3) + "|" + (Math.round(lon * 1000) / 1000).toFixed(3) + "|" + (Math.round(miles * 4) / 4).toFixed(2);
  }
  function readPlaceCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; } }
  function getCachedPlaces(lat, lon, miles) {
    const hit = readPlaceCache()[cacheKey(lat, lon, miles)];
    if (!hit || !Array.isArray(hit.places) || Date.now() - hit.savedAt > CACHE_MS * 4) return null;
    return hit;
  }
  function setCachedPlaces(lat, lon, miles, places) {
    try {
      const all = readPlaceCache();
      all[cacheKey(lat, lon, miles)] = { places: places, savedAt: Date.now() };
      const keys = Object.keys(all);
      if (keys.length > 40) {
        keys.sort(function(a, b) { return (all[a].savedAt || 0) - (all[b].savedAt || 0); }).slice(0, keys.length - 40).forEach(function(k) { delete all[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) {}
  }
  function escapeHtml(s) {
    const amp = "\u0026";
    return String(s).replace(/&/g, amp + "amp;").replace(/</g, amp + "lt;").replace(/>/g, amp + "gt;").replace(/"/g, amp + "quot;");
  }
  function escapeAttr(s) { return escapeHtml(s); }
  function normalizeWebsite(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return "https://" + url;
  }
  function applyFilter() {
    const q = qInput.value.trim().toLowerCase();
    let rows = state.places.filter(hasUsefulData);
    if (state.savedOnly) rows = rows.filter(function(p) { return isFav(p.id); });
    if (q) rows = rows.filter(function(p) { return p.name.toLowerCase().includes(q) || p.cuisine.toLowerCase().includes(q); });
    rows.sort(function(a, b) { return a.miles - b.miles; });
    state.filtered = rows;
    state.shown = PAGE;
    renderList();
  }
  function clearMarkers() {
    state.markers.forEach(function(m) { map.removeLayer(m); });
    state.markers = [];
  }
  function renderList() {
    const rows = state.filtered.slice(0, state.shown);
    clearMarkers();
    listEl.innerHTML = "";
    if (!rows.length) {
      const msg = document.createElement("p");
      msg.className = "empty";
      msg.textContent = state.savedOnly ? "No saved places in this area yet." : "No restaurants or cafes with usable details in this range.";
      listEl.appendChild(msg);
      moreBtn.classList.add("hidden");
      setStatus(state.savedOnly ? "Saved" : "No places");
      return;
    }
    rows.forEach(function(p, i) {
      const n = i + 1;
      const card = document.createElement("article");
      card.className = "card";
      const callHref = p.phone ? phoneHref(p.phone) : "";
      let hoursBit;
      if (p.hours) hoursBit = "<span>" + escapeHtml(p.hours) + "</span>";
      else if (callHref) hoursBit = '<a class="call" href="' + callHref + '">Call</a>';
      else hoursBit = "<span>Call</span>";
      card.innerHTML =
        '<div class="pin-num">' + n + "</div><div><h2>" + escapeHtml(p.name) +
        '</h2><p class="meta">' + formatMiles(p.miles) + (p.cuisine ? " \u00b7 " + escapeHtml(p.cuisine) : "") +
        '</p></div><button type="button" class="heart' + (isFav(p.id) ? " on" : "") +
        '" data-id="' + p.id + '" aria-label="Save">' + (isFav(p.id) ? "Saved" : "Save") +
        '</button><div class="actions">' + hoursBit +
        ' <a href="' + mapsUrl(p) + '" target="_blank" rel="noopener">Open in Maps</a>' +
        (p.website ? ' <a href="' + escapeAttr(p.website) + '" target="_blank" rel="noopener">Website</a>' : "") +
        (p.phone && p.hours ? ' <a href="' + callHref + '">' + escapeHtml(p.phone) + "</a>" : "") +
        "</div>";
      listEl.appendChild(card);
      const icon = L.divIcon({ className: "", html: '<div class="nb-pin">' + n + "</div>", iconSize: [26, 26], iconAnchor: [13, 13] });
      const marker = L.marker([p.lat, p.lon], { icon: icon }).addTo(map);
      marker.bindPopup("<strong>" + escapeHtml(p.name) + "</strong><br>" + formatMiles(p.miles));
      state.markers.push(marker);
    });
    listEl.querySelectorAll(".heart").forEach(function(btn) {
      btn.addEventListener("click", function() { toggleFav(btn.dataset.id); renderList(); });
    });
    moreBtn.classList.toggle("hidden", state.filtered.length <= state.shown);
    setStatus(rows.length + " of " + state.filtered.length + (state.savedOnly ? " saved" : " nearby") + (state.stale ? " \u00b7 cached" : ""));
    placeLabel.textContent = state.label ? state.label + " \u00b7 " + state.miles + " mi" : state.miles + " mi";
  }
  function buildQuery(lat, lon, miles) {
    const r = Math.round(miToM(miles));
    return "[out:json][timeout:15][maxsize:1048576];(" +
      'node["amenity"="restaurant"](around:' + r + "," + lat + "," + lon + ");" +
      'node["amenity"="cafe"](around:' + r + "," + lat + "," + lon + ");" +
      'way["amenity"="restaurant"](around:' + r + "," + lat + "," + lon + ");" +
      'way["amenity"="cafe"](around:' + r + "," + lat + "," + lon + ");" +
      ");out center tags;";
  }
  function looksBusy(status, payload) {
    if (status === 429 || status === 502 || status === 503 || status === 504 || status === 406) return true;
    const remark = payload && typeof payload === "object" ? String(payload.remark || "") : "";
    const text = (typeof payload === "string" ? payload : remark).toLowerCase();
    return text.indexOf("rate_limited") >= 0 || text.indexOf("too many requests") >= 0 || text.indexOf("quota of your ip") >= 0 || text.indexOf("query timed out") >= 0 || text.indexOf("runtime error") >= 0;
  }
  function parsePlaces(data, lat, lon) {
    const seen = new Set();
    const places = [];
    const elements = (data && data.elements) || [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const tags = el.tags || {};
      if (tags.amenity === "fast_food") continue;
      const lat2 = el.lat != null ? el.lat : (el.center && el.center.lat);
      const lon2 = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (lat2 == null || lon2 == null) continue;
      const name = tag(tags, "name", "brand");
      if (!name) continue;
      const id = el.type + "/" + el.id;
      if (seen.has(id)) continue;
      seen.add(id);
      places.push({
        id: id, name: name, lat: lat2, lon: lon2, miles: haversine(lat, lon, lat2, lon2),
        cuisine: (tag(tags, "cuisine") || "").replace(/_/g, " ").replace(/;/g, ", "),
        hours: tag(tags, "opening_hours"),
        phone: tag(tags, "phone", "contact:phone"),
        website: normalizeWebsite(tag(tags, "website", "contact:website")),
        address: [tag(tags, "addr:housenumber"), tag(tags, "addr:street"), tag(tags, "addr:city")].filter(Boolean).join(" "),
      });
    }
    return places;
  }
  async function fetchJson(url, options, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(function() { ctrl.abort(); }, timeoutMs);
    try {
      const res = await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (e) { json = null; }
      if (!res.ok || looksBusy(res.status, json || text) || !json) throw new Error("HTTP " + res.status);
      return json;
    } finally { clearTimeout(timer); }
  }
  async function fetchFromOverpass(url, query) {
    return fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: "data=" + encodeURIComponent(query),
    }, 14000);
  }
  async function fetchViaProxy(lat, lon, miles) {
    const params = "lat=" + (Math.round(lat * 1000) / 1000) + "&lon=" + (Math.round(lon * 1000) / 1000) + "&m=" + (Math.round(miles * 4) / 4);
    return fetchJson("/api/places?" + params, { headers: { Accept: "application/json" } }, 18000);
  }
  async function fetchPlaces(lat, lon, miles) {
    const query = buildQuery(lat, lon, miles);
    let data = null;
    let lastErr = null;
    try {
      setStatus("Loading places\u2026");
      data = await fetchViaProxy(lat, lon, miles);
    } catch (err) { lastErr = err; }
    if (!data) {
      for (let i = 0; i < OVERPASS_URLS.length; i++) {
        try {
          setStatus(i === 0 ? "Asking OpenStreetMap\u2026" : "Trying another map server\u2026");
          data = await fetchFromOverpass(OVERPASS_URLS[i], query);
          lastErr = null;
          break;
        } catch (err) { lastErr = err; }
      }
    }
    if (!data) throw lastErr || new Error("Overpass error");
    return parsePlaces(data, lat, lon);
  }
  async function reverseHint(lat, lon) {
    try {
      const res = await fetch("https://nominatim.openstreetmap.org/reverse?lat=" + lat + "&lon=" + lon + "&format=json&zoom=14", { headers: { Accept: "application/json" } });
      if (!res.ok) return "";
      const data = await res.json();
      const a = data.address || {};
      return a.neighbourhood || a.suburb || a.city || a.town || a.village || a.county || "";
    } catch (e) { return ""; }
  }
  async function geocodeCity(q) {
    try {
      const res = await fetch(NOMINATIM + "?q=" + encodeURIComponent(q) + "&format=json&limit=1&addressdetails=1", { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data.length) return { lat: Number(data[0].lat), lon: Number(data[0].lon), label: data[0].display_name.split(",").slice(0, 2).join(",") };
      }
    } catch (e) {}
    const res = await fetch(PHOTON + "?q=" + encodeURIComponent(q) + "&limit=1", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Geocode failed");
    const data = await res.json();
    const feat = data.features && data.features[0];
    if (!feat) throw new Error("City not found");
    const p = feat.properties || {};
    return { lat: feat.geometry.coordinates[1], lon: feat.geometry.coordinates[0], label: [p.name, p.city || p.state || p.country].filter(Boolean).join(", ") };
  }
  async function loadAt(lat, lon, label) {
    const ticket = ++state.inflight;
    state.lat = lat; state.lon = lon; state.label = label || ""; state.mapMoved = false; state.stale = false;
    searchAreaBtn.classList.add("hidden");
    if (retryBtn) retryBtn.classList.add("hidden");
    setStatus("Loading places\u2026");
    listEl.innerHTML = "";
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker([lat, lon], { radius: 7, color: "#1d4a36", fillColor: "#edf0e8", fillOpacity: 1, weight: 3 }).addTo(map);
    map.setView([lat, lon], state.miles <= 0.75 ? 15 : state.miles <= 2 ? 14 : 13);
    const cached = getCachedPlaces(lat, lon, state.miles);
    const fresh = cached && Date.now() - cached.savedAt < CACHE_MS;
    if (cached && fresh) {
      state.places = cached.places.map(function(p) { return Object.assign({}, p, { miles: haversine(lat, lon, p.lat, p.lon) }); });
      if (!state.label) state.label = (await reverseHint(lat, lon)) || state.label;
      if (ticket !== state.inflight) return;
      applyFilter();
      return;
    }
    if (cached) {
      state.places = cached.places.map(function(p) { return Object.assign({}, p, { miles: haversine(lat, lon, p.lat, p.lon) }); });
      state.stale = true;
      applyFilter();
      setStatus("Updating list\u2026");
    }
    try {
      const places = await fetchPlaces(lat, lon, state.miles);
      if (ticket !== state.inflight) return;
      setCachedPlaces(lat, lon, state.miles, places);
      state.places = places;
      state.stale = false;
      if (!state.label) state.label = await reverseHint(lat, lon);
      applyFilter();
      if (retryBtn) retryBtn.classList.add("hidden");
    } catch (err) {
      console.error(err);
      if (ticket !== state.inflight) return;
      if (cached) {
        state.stale = true;
        applyFilter();
        setStatus("Map servers busy. Showing places saved on this device.");
      } else {
        setStatus("Map data servers are busy. Try again in a minute.");
        if (retryBtn) retryBtn.classList.remove("hidden");
      }
    }
  }
  function useLocation() {
    setStatus("Getting your location\u2026");
    if (!navigator.geolocation) { setStatus("Location not available. Enter a city."); cityInput.focus(); return; }
    navigator.geolocation.getCurrentPosition(
      function(pos) { loadAt(pos.coords.latitude, pos.coords.longitude, "Your location"); },
      function() { setStatus("Location blocked. Enter a city to browse."); cityInput.focus(); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }
  function setMiles(mi) {
    state.miles = Number(mi);
    radiusInput.value = String(state.miles);
    radiusLabel.textContent = state.miles + " mi";
    $("mode-walk").classList.toggle("on", Math.abs(state.miles - WALK_MI) < 0.01);
    $("mode-drive").classList.toggle("on", Math.abs(state.miles - DRIVE_MI) < 0.01);
    if (state.lat != null) loadAt(state.lat, state.lon, state.label);
  }
  $("mode-walk").addEventListener("click", function() { setMiles(WALK_MI); });
  $("mode-drive").addEventListener("click", function() { setMiles(DRIVE_MI); });
  $("btn-more-dist").addEventListener("click", function() {
    const open = distExtra.classList.toggle("hidden") === false;
    $("btn-more-dist").setAttribute("aria-expanded", String(open));
  });
  radiusInput.addEventListener("input", function() { radiusLabel.textContent = radiusInput.value + " mi"; });
  radiusInput.addEventListener("change", function() { setMiles(radiusInput.value); });
  $("search-form").addEventListener("submit", async function(e) {
    e.preventDefault();
    const q = cityInput.value.trim();
    if (!q) return;
    setStatus("Finding that city\u2026");
    try {
      const hit = await geocodeCity(q);
      cityInput.value = hit.label;
      await loadAt(hit.lat, hit.lon, hit.label);
    } catch (err) { setStatus("Could not find that place."); }
  });
  qInput.addEventListener("input", applyFilter);
  moreBtn.addEventListener("click", function() { state.shown += PAGE; renderList(); });
  if (retryBtn) retryBtn.addEventListener("click", function() {
    if (state.lat != null) loadAt(state.lat, state.lon, state.label);
    else useLocation();
  });
  $("btn-locate").addEventListener("click", useLocation);
  $("btn-saved").addEventListener("click", function() {
    state.savedOnly = !state.savedOnly;
    $("btn-saved").setAttribute("aria-pressed", String(state.savedOnly));
    applyFilter();
  });
  $("btn-search-area").addEventListener("click", function() {
    const c = map.getCenter();
    loadAt(c.lat, c.lng, "This area");
  });
  map.on("moveend", function() {
    if (state.lat == null) return;
    const c = map.getCenter();
    searchAreaBtn.classList.toggle("hidden", haversine(state.lat, state.lon, c.lat, c.lng) < state.miles * 0.35);
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(function() {});
  useLocation();
})();
