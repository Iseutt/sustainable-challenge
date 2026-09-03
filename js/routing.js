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
    return Math.hypot(P.x - cx, P.y - cy);
  }

  function minDistanceToRoute(lat, lon, routeCoords) {
    let min = Infinity;
    for (let i = 0; i < routeCoords.length - 1; i++) {
      const a = { lat: routeCoords[i][0], lon: routeCoords[i][1] };
      const b = { lat: routeCoords[i + 1][0], lon: routeCoords[i + 1][1] };
      const d = distancePointToSegment({ lat, lon }, a, b);
      if (d < min) min = d;
      if (min === 0) break;
    }
    return min;
  }

  // Returns stations within radiusMeters of the route, each augmented with
  // a `distance` field (meters), sorted nearest-first. Pre-filters by a
  // padded bounding box first since routes can have hundreds of stations
  // to check against.
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

    const results = [];
    for (const s of candidates) {
      const d = minDistanceToRoute(s.lat, s.lon, routeCoords);
      if (d <= radiusMeters) results.push({ ...s, distance: d });
    }
    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  return { geocodeAddress, fetchRoute, haversine, findStationsNearRoute };
})();
