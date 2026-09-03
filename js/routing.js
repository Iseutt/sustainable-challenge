// Geocoding (Nominatim), road routing (OSRM public demo server), and
// point-to-route distance matching used to find which stations a driver's
// route passes close enough to for a passenger pickup.
//
// Known limitation: both nominatim.openstreetmap.org and
// router.project-osrm.org are free/shared demo endpoints, fine for a
// prototype but not for production-scale traffic.

const Routing = (() => {
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
  const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
  // Soft bias toward the Lille metropolitan area without excluding results outside it.
  const MEL_VIEWBOX = "2.75,50.85,3.35,50.50"; // left,top,right,bottom

  async function geocodeAddress(query) {
    const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=fr&viewbox=${MEL_VIEWBOX}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const results = await res.json();
    if (!results.length) return null;
    const r = results[0];
    return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name };
  }

  async function fetchRoute(origin, destination) {
    const url = `${OSRM_URL}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== "Ok" || !json.routes || !json.routes.length) return null;
    const route = json.routes[0];
    const coords = route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    return { coords, distanceMeters: route.distance, durationSeconds: route.duration };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // Projects lat/lon to local planar meters relative to a reference latitude,
  // accurate enough for short (city-scale) point-to-segment distances.
  function project(lat, lon, refLat) {
    const x = lon * Math.cos((refLat * Math.PI) / 180) * 111320;
    const y = lat * 110540;
    return { x, y };
  }

  // Returns { distance, t } where t in [0,1] is how far along segment a->b
  // the closest point to p falls (used to derive cumulative route distance).
  function distancePointToSegment(p, a, b) {
    const refLat = a.lat;
    const P = project(p.lat, p.lon, refLat);
    const A = project(a.lat, a.lon, refLat);
    const B = project(b.lat, b.lon, refLat);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = A.x + t * dx;
    const cy = A.y + t * dy;
    return { distance: Math.hypot(P.x - cx, P.y - cy), t };
  }

  // Precomputes per-segment lengths and prefix sums once per route so that,
  // for any point, we can cheaply derive both its distance to the route and
  // its cumulative distance along the route (needed for pricing/CO2, which
  // depend on how much of the route remains after a given station).
  function routeSegments(routeCoords) {
    const lengths = [];
    const prefix = [0];
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const len = haversine(routeCoords[i][0], routeCoords[i][1], routeCoords[i + 1][0], routeCoords[i + 1][1]);
      lengths.push(len);
      prefix.push(prefix[i] + len);
    }
    return { lengths, prefix };
  }

  function closestPointOnRoute(lat, lon, routeCoords, segments) {
    let best = { distance: Infinity, cumulative: 0 };
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const a = { lat: routeCoords[i][0], lon: routeCoords[i][1] };
      const b = { lat: routeCoords[i + 1][0], lon: routeCoords[i + 1][1] };
      const { distance, t } = distancePointToSegment({ lat, lon }, a, b);
      if (distance < best.distance) {
        best = { distance, cumulative: segments.prefix[i] + t * segments.lengths[i] };
        if (distance === 0) break;
      }
    }
    return best;
  }

  // Returns stations within radiusMeters of the route, each augmented with
  // `distance` (meters to the route) and `cumulativeMeters` (distance from
  // the route's start to the station's closest point, used to derive how
  // much of the trip remains for pricing/CO2). Sorted nearest-first.
  // Pre-filters by a padded bounding box first since routes can have
  // hundreds of stations to check against.
  function findStationsNearRoute(routeCoords, stations, radiusMeters) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const [lat, lon] of routeCoords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    const padLat = radiusMeters / 110540;
    const padLon = radiusMeters / (111320 * Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180));
    minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;

    const candidates = stations.filter(
      (s) => s.lat >= minLat && s.lat <= maxLat && s.lon >= minLon && s.lon <= maxLon
    );

    const segments = routeSegments(routeCoords);
    const results = [];
    for (const s of candidates) {
      const { distance, cumulative } = closestPointOnRoute(s.lat, s.lon, routeCoords, segments);
      if (distance <= radiusMeters) results.push({ ...s, distance, cumulativeMeters: cumulative });
    }
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  // ---------- Address autocomplete ----------

  const resolvedByInput = new WeakMap();
  const AUTOCOMPLETE_DEBOUNCE_MS = 400;
  const AUTOCOMPLETE_MIN_CHARS = 3;

  function getResolved(inputEl) {
    return resolvedByInput.get(inputEl) || null;
  }

  function shortLabel(displayName) {
    return displayName.split(",").slice(0, 3).join(",");
  }

  // Wires a debounced Nominatim suggestion dropdown onto a text input.
  // Requires the input to be wrapped in an element with class
  // "address-field" containing a sibling ".autocomplete-list" <ul> and a
  // ".confirm-icon" element (see index.html). Calling getResolved(inputEl)
  // afterwards returns the {lat, lon, displayName} of the picked suggestion,
  // or null if the user hasn't confirmed one (caller should then fall back
  // to a plain geocodeAddress call).
  function attachAutocomplete(inputEl) {
    const wrap = inputEl.closest(".address-field");
    const list = wrap && wrap.querySelector(".autocomplete-list");
    const confirmIcon = wrap && wrap.querySelector(".confirm-icon");
    if (!list) return;

    let debounceTimer = null;
    let activeIndex = -1;
    let currentResults = [];

    function setConfirmed(isConfirmed) {
      wrap.classList.toggle("address-field--confirmed", isConfirmed);
      if (confirmIcon) confirmIcon.hidden = !isConfirmed;
    }

    function closeList() {
      list.innerHTML = "";
      list.hidden = true;
      activeIndex = -1;
      currentResults = [];
    }

    function renderList(results) {
      currentResults = results;
      activeIndex = -1;
      list.innerHTML = "";
      results.forEach((r, i) => {
        const li = document.createElement("li");
        li.className = "autocomplete-item";
        li.textContent = shortLabel(r.display_name);
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          pick(r);
        });
        list.appendChild(li);
      });
      list.hidden = results.length === 0;
    }

    function highlight(index) {
      [...list.children].forEach((li, i) => li.classList.toggle("autocomplete-item--active", i === index));
      activeIndex = index;
    }

    function pick(r) {
      const resolved = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name };
      resolvedByInput.set(inputEl, resolved);
      inputEl.value = shortLabel(r.display_name);
      setConfirmed(true);
      closeList();
    }

    inputEl.addEventListener("input", () => {
      resolvedByInput.delete(inputEl);
      setConfirmed(false);
      clearTimeout(debounceTimer);
      const query = inputEl.value.trim();
      if (query.length < AUTOCOMPLETE_MIN_CHARS) {
        closeList();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const url = `${NOMINATIM_URL}?format=json&limit=5&countrycodes=fr&viewbox=${MEL_VIEWBOX}&q=${encodeURIComponent(query)}`;
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) return;
          const results = await res.json();
          renderList(results);
        } catch {
          // Silent: autocomplete is a convenience, not required for submit.
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    });

    inputEl.addEventListener("keydown", (e) => {
      if (list.hidden || !currentResults.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlight(Math.min(activeIndex + 1, currentResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlight(Math.max(activeIndex - 1, 0));
      } else if (e.key === "Enter") {
        if (activeIndex >= 0) {
          e.preventDefault();
          pick(currentResults[activeIndex]);
        }
      } else if (e.key === "Escape") {
        closeList();
      }
    });

    inputEl.addEventListener("blur", () => setTimeout(closeList, 100));
  }

  return {
    geocodeAddress,
    fetchRoute,
    haversine,
    findStationsNearRoute,
    attachAutocomplete,
    getResolved,
  };
})();
