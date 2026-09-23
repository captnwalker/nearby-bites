(() => {
  const WALK_MI = 0.5;
  const DRIVE_MI = 3;
  const PAGE = 25;
  const FAV_KEY = "nearby-bites-favs";
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";

  const $ = (id) => document.getElementById(id);
  const cityInput = $("city");
  const qInput = $("q");
  const listEl = $("list");
  const statusEl = $("status");
  const placeLabel = $("place-label");
  const moreBtn = $("btn-more");
  const searchAreaBtn = $("btn-search-area");
  const radiusInput = $("radius");
  const radiusLabel = $("radius-label");
  const distExtra = $("dist-extra");

  const state = {
    lat: null,
    lon: null,
    label: "",
    miles: WALK_MI,
    places: [],
    filtered: [],
    shown: PAGE,
    markers: [],
    savedOnly: false,
    mapMoved: false,
  };

  const map = L.map("map", { zoomControl: false, attributionControl: true });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.setView([39.8283, -98.5795], 4);

  let youMarker = null;

  function miToM(mi) {
    return mi * 1609.344;
  }

  function haversine(aLat, aLon, bLat, bLon) {
    const R = 3958.8;
    const dLat = ((bLat - aLat) * Math.PI) / 180;
    const dLon = ((bLon - aLon) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((aLat * Math.PI) / 180) *
        Math.cos((bLat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function loadFavs() {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveFavs(ids) {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  }

  function isFav(id) {
    return loadFavs().includes(id);
  }

  function toggleFav(id) {
    const favs = loadFavs();
    const i = favs.indexOf(id);
    if (i >= 0) favs.splice(i, 1);
    else favs.push(id);
    saveFavs(favs);
  }

  function tag(tags, ...keys) {
    if (!tags) return "";
    for (const k of keys) {
      if (tags[k]) return String(tags[k]).trim();
    }
    return "";
  }

  function phoneHref(num) {
    const cleaned = num.replace(/[^\d+]/g, "");
    return cleaned ? `tel:${cleaned}` : "";
  }

  function mapsUrl(place) {
    const q = encodeURIComponent(
      [place.name, place.address].filter(Boolean).join(" ")
    );
    const ll = `${place.lat},${place.lon}`;
    const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isiOS) return `https://maps.apple.com/?ll=${ll}&q=${q}`;
    return `https://www.google.com/maps/search/?api=1&query=${ll}`;
  }

  function hasUsefulData(p) {
    return Boolean(p.hours || p.cuisine || p.phone);
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function formatMiles(mi) {
    if (mi < 0.1) return `${Math.round(mi * 5280)} ft`;
    return `${mi.toFixed(mi < 1 ? 2 : 1)} mi`;
  }

  function applyFilter() {
    const q = qInput.value.trim().toLowerCase();
    let rows = state.places.filter(hasUsefulData);
    if (state.savedOnly) rows = rows.filter((p) => isFav(p.id));
    if (q) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.cuisine.toLowerCase().includes(q)
      );
    }
    rows.sort((a, b) => a.miles - b.miles);
    state.filtered = rows;
    state.shown = PAGE;
    renderList();
  }

  function clearMarkers() {
    state.markers.forEach((m) => map.removeLayer(m));
    state.markers = [];
  }

  function renderList() {
    const rows = state.filtered.slice(0, state.shown);
    clearMarkers();
    listEl.innerHTML = "";

    if (!rows.length) {
      const msg = document.createElement("p");
      msg.className = "empty";
      msg.textContent = state.savedOnly
        ? "No saved places in this area yet."
        : "No restaurants or cafes with usable details in this range.";
      listEl.appendChild(msg);
      moreBtn.classList.add("hidden");
      setStatus(state.savedOnly ? "Saved" : "No places");
      return;
    }

    rows.forEach((p, i) => {
      const n = i + 1;
      const card = document.createElement("article");
      card.className = "card";
      const callHref = p.phone ? phoneHref(p.phone) : "";
      let hoursBit;
      if (p.hours) hoursBit = `<span>${escapeHtml(p.hours)}</span>`;
      else if (callHref) hoursBit = `<a class="call" href="${callHref}">Call</a>`;
      else hoursBit = `<span>Call</span>`;

      card.innerHTML = `
        <div class="pin-num">${n}</div>
        <div>
          <h2>${escapeHtml(p.name)}</h2>
          <p class="meta">${formatMiles(p.miles)}${p.cuisine ? " \u00b7 " + escapeHtml(p.cuisine) : ""}</p>
        </div>
        <button type="button" class="heart${isFav(p.id) ? " on" : ""}" data-id="${p.id}" aria-label="Save">${isFav(p.id) ? "Saved" : "Save"}</button>
        <div class="actions">
          ${hoursBit}
          <a href="${mapsUrl(p)}" target="_blank" rel="noopener">Open in Maps</a>
          ${p.website ? `<a href="${escapeAttr(p.website)}" target="_blank" rel="noopener">Website</a>` : ""}
          ${p.phone && p.hours ? `<a href="${callHref}">${escapeHtml(p.phone)}</a>` : ""}
        </div>
      `;
      listEl.appendChild(card);

      const icon = L.divIcon({
        className: "",
        html: `<div class="nb-pin">${n}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([p.lat, p.lon], { icon }).addTo(map);
      marker.bindPopup(
        `<strong>${escapeHtml(p.name)}</strong><br>${formatMiles(p.miles)}`
      );
      state.markers.push(marker);
    });

    listEl.querySelectorAll(".heart").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleFav(btn.dataset.id);
        renderList();
      });
    });

    moreBtn.classList.toggle("hidden", state.filtered.length <= state.shown);
    const noun = state.savedOnly ? "saved" : "nearby";
    setStatus(`${rows.length} of ${state.filtered.length} ${noun}`);
    placeLabel.textContent = state.label
      ? `${state.label} \u00b7 ${state.miles} mi`
      : `${state.miles} mi`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function normalizeWebsite(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
  }

  async function fetchPlaces(lat, lon, miles) {
    const r = Math.round(miToM(miles));
    const query = `
      [out:json][timeout:25];
      (
        node["amenity"="restaurant"](around:${r},${lat},${lon});
        way["amenity"="restaurant"](around:${r},${lat},${lon});
        node["amenity"="cafe"](around:${r},${lat},${lon});
        way["amenity"="cafe"](around:${r},${lat},${lon});
      );
      out center tags;
    `;
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: "data=" + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error("Overpass error");
    const data = await res.json();
    const seen = new Set();
    const places = [];
    for (const el of data.elements || []) {
      const tags = el.tags || {};
      if (tags.amenity === "fast_food") continue;
      const lat2 = el.lat ?? el.center?.lat;
      const lon2 = el.lon ?? el.center?.lon;
      if (lat2 == null || lon2 == null) continue;
      const name = tag(tags, "name", "brand");
      if (!name) continue;
      const id = `${el.type}/${el.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const address = [
        tag(tags, "addr:housenumber"),
        tag(tags, "addr:street"),
        tag(tags, "addr:city"),
      ]
        .filter(Boolean)
        .join(" ");
      places.push({
        id,
        name,
        lat: lat2,
        lon: lon2,
        miles: haversine(lat, lon, lat2, lon2),
        cuisine: (tag(tags, "cuisine") || "").replace(/_/g, " ").replace(/;/g, ", "),
        hours: tag(tags, "opening_hours"),
        phone: tag(tags, "phone", "contact:phone"),
        website: normalizeWebsite(tag(tags, "website", "contact:website")),
        address,
      });
    }
    return places;
  }

  async function reverseHint(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=14`;
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "NearbyBites/1.0" },
      });
      if (!res.ok) return "";
      const data = await res.json();
      const a = data.address || {};
      return a.neighbourhood || a.suburb || a.city || a.town || a.village || a.county || "";
    } catch {
      return "";
    }
  }

  async function geocodeCity(q) {
    const url = `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "NearbyBites/1.0" },
    });
    if (!res.ok) throw new Error("Geocode failed");
    const data = await res.json();
    if (!data.length) throw new Error("City not found");
    return {
      lat: Number(data[0].lat),
      lon: Number(data[0].lon),
      label: data[0].display_name.split(",").slice(0, 2).join(","),
    };
  }

  async function loadAt(lat, lon, label) {
    state.lat = lat;
    state.lon = lon;
    state.label = label || "";
    state.mapMoved = false;
    searchAreaBtn.classList.add("hidden");
    setStatus("Loading places\u2026");
    listEl.innerHTML = "";
    if (youMarker) map.removeLayer(youMarker);
    youMarker = L.circleMarker([lat, lon], {
      radius: 7,
      color: "#1d4a36",
      fillColor: "#edf0e8",
      fillOpacity: 1,
      weight: 3,
    }).addTo(map);
    const zoom = state.miles <= 0.75 ? 15 : state.miles <= 2 ? 14 : 13;
    map.setView([lat, lon], zoom);
    try {
      state.places = await fetchPlaces(lat, lon, state.miles);
      if (!state.label) state.label = await reverseHint(lat, lon);
      applyFilter();
    } catch (err) {
      console.error(err);
      setStatus("Could not load places. Try again in a minute.");
    }
  }

  function useLocation() {
    setStatus("Getting your location\u2026");
    if (!navigator.geolocation) {
      setStatus("Location not available. Enter a city.");
      cityInput.focus();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        loadAt(pos.coords.latitude, pos.coords.longitude, "Your location");
      },
      () => {
        setStatus("Location blocked. Enter a city to browse.");
        cityInput.focus();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function setMiles(mi, fromSlider) {
    state.miles = Number(mi);
    radiusInput.value = String(state.miles);
    radiusLabel.textContent = `${state.miles} mi`;
    $("mode-walk").classList.toggle("on", Math.abs(state.miles - WALK_MI) < 0.01);
    $("mode-drive").classList.toggle("on", Math.abs(state.miles - DRIVE_MI) < 0.01);
    if (!fromSlider && state.lat != null) loadAt(state.lat, state.lon, state.label);
  }

  $("mode-walk").addEventListener("click", () => setMiles(WALK_MI));
  $("mode-drive").addEventListener("click", () => setMiles(DRIVE_MI));
  $("btn-more-dist").addEventListener("click", () => {
    const open = distExtra.classList.toggle("hidden") === false;
    $("btn-more-dist").setAttribute("aria-expanded", String(open));
  });
  radiusInput.addEventListener("input", () => {
    radiusLabel.textContent = `${radiusInput.value} mi`;
  });
  radiusInput.addEventListener("change", () => setMiles(radiusInput.value, false));

  $("search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = cityInput.value.trim();
    if (!q) return;
    setStatus("Finding that city\u2026");
    try {
      const hit = await geocodeCity(q);
      cityInput.value = hit.label;
      await loadAt(hit.lat, hit.lon, hit.label);
    } catch {
      setStatus("Could not find that place.");
    }
  });

  qInput.addEventListener("input", applyFilter);
  moreBtn.addEventListener("click", () => {
    state.shown += PAGE;
    renderList();
  });
  $("btn-locate").addEventListener("click", useLocation);
  $("btn-saved").addEventListener("click", () => {
    state.savedOnly = !state.savedOnly;
    $("btn-saved").setAttribute("aria-pressed", String(state.savedOnly));
    applyFilter();
  });
  $("btn-search-area").addEventListener("click", () => {
    const c = map.getCenter();
    loadAt(c.lat, c.lng, "This area");
  });

  map.on("moveend", () => {
    if (state.lat == null) return;
    const c = map.getCenter();
    const moved = haversine(state.lat, state.lon, c.lat, c.lng);
    searchAreaBtn.classList.toggle("hidden", moved < state.miles * 0.35);
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  useLocation();
})();
