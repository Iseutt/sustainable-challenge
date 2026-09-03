// App state, driver/passenger forms, localStorage persistence, and map wiring.

const TRAJETS_KEY = "carpool_trajets";
const REQUESTS_KEY = "carpool_requests";
const PASSENGER_SEARCH_RADIUS_M = 1000; // how far a passenger may be from a matched station
const ROUTE_COLORS = ["#8e44ad", "#d35400", "#16a085", "#2c3e50", "#c0392b", "#2471a3"];

const LOCALE_MAP = { fr: "fr-FR", en: "en-GB", de: "de-DE", nl: "nl-NL", vls: "nl-BE" };

let map;
let routesLayer;
let allStations = [];

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadTrajets() {
  try {
    return JSON.parse(localStorage.getItem(TRAJETS_KEY)) || [];
  } catch {
    return [];
  }
}
function saveTrajets(trajets) {
  localStorage.setItem(TRAJETS_KEY, JSON.stringify(trajets));
}
function loadRequests() {
  try {
    return JSON.parse(localStorage.getItem(REQUESTS_KEY)) || [];
  } catch {
    return [];
  }
}
function saveRequests(requests) {
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(requests));
}

function seatsTaken(trajetId, requests) {
  return requests.filter((r) => r.trajetId === trajetId).length;
}

function fmtDateTime(iso) {
  const locale = LOCALE_MAP[getCurrentLang()] || "fr-FR";
  try {
    return new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function setStatus(message, kind = "info") {
  const el = document.getElementById("status-banner");
  if (!message) {
    el.hidden = true;
    return;
  }
  el.textContent = message;
  el.className = `status-banner status-banner--${kind}`;
  el.hidden = false;
}

// ---------- Map + station init ----------

async function initMap() {
  map = L.map("map", { zoomControl: true }).setView([50.6292, 3.0573], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  routesLayer = L.layerGroup().addTo(map);

  setStatus(t("stations_loading"), "info");
  try {
    const { data, fromCache } = await Stations.fetchStations();
    allStations = data;
    Stations.renderLayers(map, data);
    setStatus(fromCache ? null : `${t("stations_cached")} (${data.length})`, "success");
    if (!fromCache) setTimeout(() => setStatus(null), 4000);
  } catch (err) {
    console.error(err);
    setStatus(t("stations_error"), "error");
  }
}

// ---------- Rendering trajets on the map ----------

function clearRouteLayer() {
  routesLayer.clearLayers();
}

function renderTrajetsOnMap(trajets) {
  clearRouteLayer();
  trajets.forEach((trajet, i) => {
    const color = ROUTE_COLORS[i % ROUTE_COLORS.length];
    const line = L.polyline(trajet.routeCoords, { color, weight: 5, opacity: 0.8 });
    line.bindPopup(
      `<strong>${trajet.driverName}</strong><br>${trajet.originText} &rarr; ${trajet.destText}<br>${fmtDateTime(trajet.datetime)}`
    );
    line.addTo(routesLayer);

    (trajet.stationIds || []).forEach((sid) => {
      const st = allStations.find((s) => s.id === sid);
      if (!st) return;
      const marker = L.circleMarker([st.lat, st.lon], {
        radius: 9,
        color,
        weight: 3,
        fillColor: "#fff",
        fillOpacity: 1,
      });
      marker.bindPopup(
        `<strong>${st.name || Stations.labelFor(st.type)}</strong><br>${t("popup_driver")}: ${trajet.driverName}<br>${t("popup_departure")}: ${fmtDateTime(trajet.datetime)}`
      );
      marker.addTo(routesLayer);
    });
  });
}

function focusTrajet(trajet) {
  const bounds = L.latLngBounds(trajet.routeCoords);
  map.fitBounds(bounds, { padding: [40, 40] });
  document.querySelector('.tab-btn[data-tab="map"]');
}

// ---------- Trajet card (shared by Trajets tab + passenger search results) ----------

function trajetCard(trajet, requests, opts = {}) {
  const taken = seatsTaken(trajet.id, requests);
  const left = trajet.seats - taken;
  const stations = (trajet.stationIds || [])
    .map((sid) => allStations.find((s) => s.id === sid))
    .filter(Boolean);

  const card = document.createElement("div");
  card.className = "trajet-card";

  const header = document.createElement("div");
  header.className = "trajet-card__header";
  header.innerHTML = `<strong>${trajet.driverName}</strong> &middot; ${fmtDateTime(trajet.datetime)}`;
  card.appendChild(header);

  const route = document.createElement("div");
  route.className = "trajet-card__route";
  route.textContent = `${t("trajets_from")} ${trajet.originText} ${t("trajets_to")} ${trajet.destText}`;
  if (trajet.originResolved || trajet.destResolved) {
    route.title = `${trajet.originResolved || trajet.originText} → ${trajet.destResolved || trajet.destText}`;
  }
  card.appendChild(route);

  if (trajet.originResolved || trajet.destResolved) {
    const resolved = document.createElement("div");
    resolved.className = "trajet-card__resolved";
    resolved.textContent = `${t("driver_resolvedAs")}: ${trajet.originResolved} → ${trajet.destResolved}`;
    card.appendChild(resolved);
  }

  if (trajet.note) {
    const note = document.createElement("div");
    note.className = "trajet-card__note";
    note.textContent = trajet.note;
    card.appendChild(note);
  }

  const seatsEl = document.createElement("div");
  seatsEl.className = "trajet-card__seats";
  seatsEl.textContent = left > 0 ? `${left} ${t("passenger_seatsLeft")}` : t("passenger_full");
  card.appendChild(seatsEl);

  if (stations.length) {
    const stLabel = document.createElement("div");
    stLabel.className = "trajet-card__stations-label";
    stLabel.textContent = t("passenger_stationsNear") + ":";
    card.appendChild(stLabel);

    const chips = document.createElement("div");
    chips.className = "trajet-card__chips";
    stations.forEach((s) => {
      const chip = document.createElement("span");
      chip.className = `chip chip--${s.type}`;
      chip.textContent = s.name || Stations.labelFor(s.type);
      if (opts.highlightStationId === s.id) chip.classList.add("chip--active");
      chips.appendChild(chip);
    });
    card.appendChild(chips);
  }

  const actions = document.createElement("div");
  actions.className = "trajet-card__actions";

  const viewBtn = document.createElement("button");
  viewBtn.className = "btn btn--secondary";
  viewBtn.textContent = t("trajets_viewOnMap");
  viewBtn.onclick = () => {
    focusTrajet(trajet);
    switchTab("map");
  };
  actions.appendChild(viewBtn);

  if (stations.length) {
    let select = null;
    if (!opts.presetStationId) {
      select = document.createElement("select");
      select.className = "station-select";
      stations.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name || Stations.labelFor(s.type);
        select.appendChild(o);
      });
      actions.appendChild(select);
    }

    const reqBtn = document.createElement("button");
    reqBtn.className = "btn btn--primary";
    reqBtn.textContent = t("passenger_request");
    reqBtn.disabled = left <= 0;
    reqBtn.onclick = () => {
      const stationId = opts.presetStationId || select.value;
      const requests = loadRequests();
      requests.push({ id: uid(), trajetId: trajet.id, stationId, createdAt: new Date().toISOString() });
      saveRequests(requests);
      reqBtn.textContent = t("passenger_requested");
      reqBtn.disabled = true;
      const newLeft = left - 1;
      seatsEl.textContent = newLeft > 0 ? `${newLeft} ${t("passenger_seatsLeft")}` : t("passenger_full");
      renderAll();
    };
    actions.appendChild(reqBtn);
  }

  if (opts.deletable) {
    const delBtn = document.createElement("button");
    delBtn.className = "btn btn--danger";
    delBtn.textContent = t("trajets_delete");
    delBtn.onclick = () => {
      saveTrajets(loadTrajets().filter((tj) => tj.id !== trajet.id));
      saveRequests(loadRequests().filter((r) => r.trajetId !== trajet.id));
      renderAll();
    };
    actions.appendChild(delBtn);
  }

  card.appendChild(actions);
  return card;
}

// ---------- Trajets tab list ----------

function renderTrajetsList() {
  const trajets = loadTrajets();
  const requests = loadRequests();
  const list = document.getElementById("trajets-list");
  list.innerHTML = "";
  if (!trajets.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = t("trajets_empty");
    list.appendChild(empty);
    return;
  }
  trajets
    .slice()
    .reverse()
    .forEach((trajet) => list.appendChild(trajetCard(trajet, requests, { deletable: true })));
}

// ---------- Driver form ----------

function initDriverForm() {
  const form = document.getElementById("driver-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get("name").trim();
    const originText = fd.get("origin").trim();
    const destText = fd.get("destination").trim();
    const datetime = fd.get("datetime");
    const seats = parseInt(fd.get("seats"), 10);
    const radius = parseInt(fd.get("radius"), 10) || 300;
    const note = (fd.get("note") || "").trim();

    const feedback = document.getElementById("driver-feedback");
    feedback.className = "form-feedback";
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      feedback.textContent = t("driver_geocoding");
      const [origin, destination] = await Promise.all([
        Routing.geocodeAddress(originText),
        Routing.geocodeAddress(destText),
      ]);
      if (!origin || !destination) throw new Error("geocode-failed");

      feedback.textContent = t("driver_routing");
      const route = await Routing.fetchRoute(origin, destination);
      if (!route) throw new Error("route-failed");

      const nearStations = Routing.findStationsNearRoute(route.coords, allStations, radius);

      const trajet = {
        id: uid(),
        driverName: name,
        originText,
        destText,
        originLat: origin.lat,
        originLon: origin.lon,
        originResolved: origin.displayName,
        destLat: destination.lat,
        destLon: destination.lon,
        destResolved: destination.displayName,
        datetime,
        seats,
        radius,
        note,
        routeCoords: route.coords,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        stationIds: nearStations.map((s) => s.id),
        createdAt: new Date().toISOString(),
      };

      const trajets = loadTrajets();
      trajets.push(trajet);
      saveTrajets(trajets);

      feedback.classList.add("form-feedback--success");
      const resolvedLine = `${t("driver_resolvedAs")}: ${origin.displayName} → ${destination.displayName}`;
      feedback.textContent = nearStations.length
        ? `${t("driver_success")} ${resolvedLine}`
        : `${t("driver_success")} ${t("driver_noStations")} ${resolvedLine}`;
      form.reset();
      renderAll();
      focusTrajet(trajet);
    } catch (err) {
      console.error(err);
      feedback.classList.add("form-feedback--error");
      feedback.textContent = t("driver_error");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ---------- Passenger "search near me" ----------

function initPassengerSearch() {
  const form = document.getElementById("passenger-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const address = fd.get("address").trim();
    const results = document.getElementById("passenger-results");
    const feedback = document.getElementById("passenger-feedback");
    feedback.className = "form-feedback";
    results.innerHTML = "";
    feedback.textContent = t("driver_geocoding");

    try {
      const point = await Routing.geocodeAddress(address);
      if (!point) throw new Error("geocode-failed");

      const trajets = loadTrajets();
      const requests = loadRequests();
      const matches = [];
      for (const trajet of trajets) {
        const stations = (trajet.stationIds || [])
          .map((sid) => allStations.find((s) => s.id === sid))
          .filter(Boolean);
        let best = null;
        for (const s of stations) {
          const d = Routing.haversine(point.lat, point.lon, s.lat, s.lon);
          if (d <= PASSENGER_SEARCH_RADIUS_M && (!best || d < best.distance)) {
            best = { station: s, distance: d };
          }
        }
        if (best) matches.push({ trajet, station: best.station });
      }

      feedback.textContent = "";
      if (!matches.length) {
        feedback.textContent = t("passenger_noResults");
        return;
      }
      matches.forEach(({ trajet, station }) =>
        results.appendChild(
          trajetCard(trajet, requests, { presetStationId: station.id, highlightStationId: station.id })
        )
      );
    } catch (err) {
      console.error(err);
      feedback.classList.add("form-feedback--error");
      feedback.textContent = t("driver_error");
    }
  });
}

// ---------- Tabs ----------

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tabId}`));
  if (tabId === "map") setTimeout(() => map.invalidateSize(), 50);
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

// ---------- Global render ----------

function renderAll() {
  const trajets = loadTrajets();
  renderTrajetsOnMap(trajets);
  renderTrajetsList();
}

document.addEventListener("langchange", () => {
  Stations.updateLegendLabels();
  renderAll();
});

document.addEventListener("DOMContentLoaded", async () => {
  applyTranslations();
  initLanguageSwitcher();
  initTabs();
  initDriverForm();
  initPassengerSearch();
  await initMap();
  renderAll();
});
