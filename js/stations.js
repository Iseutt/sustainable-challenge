// Fetches train/tram/bus stops for the Metropole Europeenne de Lille (MEL)
// from the public Overpass API (OpenStreetMap), caches them in localStorage
// for 24h, and renders them as clustered, toggleable Leaflet layers.
//
// Known limitation: overpass-api.de is a free/shared demo endpoint. Fine for
// a prototype; a production app should self-host Overpass or use MEL's own
// open-data GTFS export instead.

const Stations = (() => {
  const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
  const MEL_AREA_NAME = "Métropole Européenne de Lille";
  // Fallback bbox (south, west, north, east) roughly covering the MEL, used
  // if the named-area query comes back empty (e.g. OSM relation renamed).
  const FALLBACK_BBOX = "50.55,2.85,50.80,3.30";
  const CACHE_KEY = "carpool_stations_cache";
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  let allStations = []; // flattened: {id, lat, lon, name, type}

  function areaQuery() {
    return `
      [out:json][timeout:60];
      area["boundary"="administrative"]["name"="${MEL_AREA_NAME}"]->.mel;
      (
        node["railway"~"^(station|halt)$"](area.mel);
        node["railway"="tram_stop"](area.mel);
        node["highway"="bus_stop"](area.mel);
        node["amenity"="bus_station"](area.mel);
      );
      out body;
    `;
  }

  function bboxQuery() {
    return `
      [out:json][timeout:60][bbox:${FALLBACK_BBOX}];
      (
        node["railway"~"^(station|halt)$"];
        node["railway"="tram_stop"];
        node["highway"="bus_stop"];
        node["amenity"="bus_station"];
      );
      out body;
    `;
  }

  function classify(tags) {
    if (!tags) return null;
    if (tags.railway === "station" || tags.railway === "halt") return "train";
    if (tags.railway === "tram_stop") return "tram";
    if (tags.highway === "bus_stop" || tags.amenity === "bus_station") return "bus";
    return null;
  }

  function parseElements(elements) {
    const out = [];
    for (const el of elements) {
      if (el.type !== "node") continue;
      const type = classify(el.tags);
      if (!type) continue;
      out.push({
        id: `osm-${el.id}`,
        lat: el.lat,
        lon: el.lon,
        name: (el.tags && el.tags.name) || null,
        type,
      });
    }
    return out;
  }

  async function runQuery(query) {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: "data=" + encodeURIComponent(query),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const json = await res.json();
    return parseElements(json.elements || []);
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.fetchedAt || !Array.isArray(parsed.data)) return null;
      if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      if (parsed.data.length === 0) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  function saveCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch {
      // localStorage full/unavailable: non-fatal, just skip caching.
    }
  }

  async function fetchStations({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached) {
        allStations = cached;
        return { data: cached, fromCache: true };
      }
    }
    let data = await runQuery(areaQuery());
    if (data.length === 0) {
      data = await runQuery(bboxQuery());
    }
    allStations = data;
    saveCache(data);
    return { data, fromCache: false };
  }

  function getAll() {
    return allStations;
  }

  const ICON_COLORS = { train: "#c0392b", tram: "#2471a3", bus: "#1e8449" };
  const ICON_LETTER = { train: "T", tram: "R", bus: "B" };

  function makeIcon(type, highlighted = false) {
    const color = ICON_COLORS[type] || "#555";
    const size = highlighted ? 16 : 11;
    return L.divIcon({
      className: "",
      html: `<div class="stop-marker${highlighted ? " stop-marker--highlight" : ""}" style="background:${color};width:${size}px;height:${size}px;"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }

  function labelFor(type) {
    return type === "train" ? t("layers_train") : type === "tram" ? t("layers_tram") : t("layers_bus");
  }

  // Renders the three station layers on the map and wires a layer control.
  // Returns { layers: {train, tram, bus}, markerById: Map }
  function renderLayers(map, data) {
    const groups = {
      train: L.markerClusterGroup({ disableClusteringAtZoom: 15 }),
      tram: L.markerClusterGroup({ disableClusteringAtZoom: 15 }),
      bus: L.markerClusterGroup({ disableClusteringAtZoom: 16, maxClusterRadius: 50 }),
    };
    const markerById = new Map();

    for (const st of data) {
      const marker = L.marker([st.lat, st.lon], { icon: makeIcon(st.type) });
      marker.stationId = st.id;
      marker.bindPopup(() => `<strong>${st.name || labelFor(st.type)}</strong><br>${labelFor(st.type)}`);
      groups[st.type].addLayer(marker);
      markerById.set(st.id, marker);
    }

    Object.values(groups).forEach((g) => g.addTo(map));

    const legendHtml = (type) =>
      `<span class="legend-dot" style="background:${ICON_COLORS[type]}"></span><span class="legend-label" data-type="${type}">${labelFor(type)}</span>`;
    const overlays = {
      [legendHtml("train")]: groups.train,
      [legendHtml("tram")]: groups.tram,
      [legendHtml("bus")]: groups.bus,
    };
    L.control.layers(null, overlays, { collapsed: false, position: "topright" }).addTo(map);

    return { layers: groups, markerById };
  }

  // Re-translates the layer-control legend labels after a language switch
  // (the control's HTML is only built once at renderLayers time).
  function updateLegendLabels() {
    document.querySelectorAll(".legend-label").forEach((el) => {
      el.textContent = labelFor(el.dataset.type);
    });
  }

  return { fetchStations, getAll, renderLayers, updateLegendLabels, makeIcon, labelFor, CACHE_KEY };
})();
