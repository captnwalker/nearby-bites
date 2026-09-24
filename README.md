# Nearby Bites

A free, installable PWA that finds restaurants and cafes close to you — or in a city you type. Data comes from OpenStreetMap via Overpass. No paid APIs, no accounts, no ratings.

## Use

- Allow location, or type a city.
- **Short walk** is 0.5 miles. **Short drive** is 3 miles. **More** opens a slider up to 5 miles.
- Filter the loaded list by name or cuisine.
- Save places on this device only.
- **Call** appears when hours are missing. If OSM has a phone number, Call dials it.
- **Open in Maps** hands off to Apple Maps or Google Maps.

Places with no hours, no cuisine, and no phone are hidden.

## Stack

Static HTML, CSS, and JavaScript. Leaflet + OSM tiles. Nominatim (Photon fallback) for city search. A Vercel `/api/places` function is the only Overpass client: one preferred instance, one fallback, 25s max duration, named User-Agent, and a 4-hour CDN cache. Each load fetches a 3-mile circle (or the slider value if larger) so Short drive is instant after the first success. The phone filters that list down to the selected distance. Device cache is 6 hours, with a 2-minute pause after a miss so retries do not pile onto public servers.

## Local

Open `index.html` from a local static server (required for geolocation and the service worker):

```bash
npx serve .
```
