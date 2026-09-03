// App state, landing/role selection, driver/passenger forms, pricing/CO2,
// localStorage persistence, and map wiring.

const TRAJETS_KEY = "carpool_trajets";
const REQUESTS_KEY = "carpool_requests";
const ROLE_KEY = "carpool_role";
const HAS_CAR_KEY = "carpool_hasCar";
const PASSENGER_SEARCH_RADIUS_M = 1000; // how far a passenger may be from a matched station
const DEFAULT_PICKUP_RADIUS_M = 350; // fixed now that drivers no longer set a radius themselves
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

// ---------- Pricing / CO2 helpers ----------

function priceForStation(trajet, stationId) {
  const cumulative = (trajet.stationCumulative || {})[stationId] || 0;
  const distanceKm = Pricing.remainingDistanceKm(trajet, cumulative);
  const priceEUR = Pricing.computePrice(distanceKm);
  const co2Kg = Pricing.computeCO2Kg(distanceKm);
  const driverPoints = Pricing.computeDriverPoints(co2Kg);
  const passengerPoints = Pricing.computePassengerPoints(co2Kg);
  return { distanceKm, priceEUR, co2Kg, driverPoints, passengerPoints };
}

// Both roles are rewarded from the same avoided CO2, but the passenger
// (who actually left their car at home) earns points at a higher rate than
// the driver (who gets a smaller "host" bonus) — see js/pricing.js.
function renderRewards() {
  const co2El = document.getElementById("rewards-co2");
  if (!co2El) return;
  const role = getRole();
  const pointsField = role === "passenger" ? "passengerPoints" : "driverPoints";
  const requests = loadRequests();
  let co2 = 0;
  let points = 0;
  requests.forEach((r) => {
    co2 += r.co2Kg || 0;
    points += r[pointsField] || 0;
  });
  co2El.textContent = `${co2.toFixed(1)} kg`;
  document.getElementById("rewards-points").textContent = Math.round(points);

  const progressPoints = points % Pricing.POINTS_PER_REWARD;
  const pct = (progressPoints / Pricing.POINTS_PER_REWARD) * 100;
  document.getElementById("rewards-progress-fill").style.width = `${pct}%`;
  document.getElementById("rewards-progress-label").textContent =
    `${Math.round(progressPoints)} / ${Pricing.POINTS_PER_REWARD} ${t("rewards_towardNext")} (${Pricing.REWARD_EUR}€)`;

  const boostNote = document.getElementById("rewards-boost-note");
  if (boostNote) boostNote.hidden = role !== "passenger";
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
  if (routesLayer) routesLayer.clearLayers();
}

function renderTrajetsOnMap(trajets) {
  if (!routesLayer) return;
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
      const { priceEUR, distanceKm } = priceForStation(trajet, sid);
      marker.bindPopup(
        `<strong>${st.name || Stations.labelFor(st.type)}</strong><br>${t("popup_driver")}: ${trajet.driverName}<br>${t("popup_departure")}: ${fmtDateTime(trajet.datetime)}<br>${priceEUR.toFixed(2)} € · ${distanceKm.toFixed(1)} km`
      );
      marker.addTo(routesLayer);
    });
  });
}

function focusTrajet(trajet) {
  const bounds = L.latLngBounds(trajet.routeCoords);
  map.fitBounds(bounds, { padding: [40, 40] });
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

  let priceEl = null;
  let select = null;

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

    priceEl = document.createElement("div");
    priceEl.className = "trajet-card__price";
    card.appendChild(priceEl);
  }

  function updatePrice(stationId) {
    if (!priceEl || !stationId) return;
    const { priceEUR, distanceKm } = priceForStation(trajet, stationId);
    priceEl.textContent = `${priceEUR.toFixed(2)} € · ${distanceKm.toFixed(1)} km`;
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
    if (!opts.presetStationId) {
      select = document.createElement("select");
      select.className = "station-select";
      stations.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.id;
        o.textContent = s.name || Stations.labelFor(s.type);
        select.appendChild(o);
      });
      select.addEventListener("change", () => updatePrice(select.value));
      actions.appendChild(select);
    }

    updatePrice(opts.presetStationId || (stations[0] && stations[0].id));

    const reqBtn = document.createElement("button");
    reqBtn.className = "btn btn--primary";
    reqBtn.textContent = t("passenger_request");
    reqBtn.disabled = left <= 0;
    reqBtn.onclick = () => {
      const stationId = opts.presetStationId || select.value;
      const { priceEUR, distanceKm, co2Kg, driverPoints, passengerPoints } = priceForStation(trajet, stationId);
      const requests = loadRequests();
      requests.push({
        id: uid(),
        trajetId: trajet.id,
        stationId,
        priceEUR,
        distanceKm,
        co2Kg,
        driverPoints,
        passengerPoints,
        createdAt: new Date().toISOString(),
      });
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
  const titleEl = document.getElementById("trajets-title");
  if (titleEl) {
    titleEl.textContent = getRole() === "driver" ? t("trajets_titleDriver") : t("trajets_titlePassenger");
  }
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

// ---------- Address field reset helper ----------

function resetAddressFields(form) {
  form.querySelectorAll(".address-field").forEach((wrap) => {
    wrap.classList.remove("address-field--confirmed");
    const icon = wrap.querySelector(".confirm-icon");
    if (icon) icon.hidden = true;
  });
}

// ---------- Driver form ----------

function initDriverForm() {
  const form = document.getElementById("driver-form");
  const originInput = form.querySelector('[name="origin"]');
  const destInput = form.querySelector('[name="destination"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = fd.get("name").trim();
    const originText = originInput.value.trim();
    const destText = destInput.value.trim();
    const datetime = fd.get("datetime");
    const seats = parseInt(fd.get("seats"), 10);
    const note = (fd.get("note") || "").trim();

    const feedback = document.getElementById("driver-feedback");
    feedback.className = "form-feedback";
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      feedback.textContent = t("driver_geocoding");
      const originCached = Routing.getResolved(originInput);
      const destCached = Routing.getResolved(destInput);
      const [origin, destination] = await Promise.all([
        originCached ? Promise.resolve(originCached) : Routing.geocodeAddress(originText),
        destCached ? Promise.resolve(destCached) : Routing.geocodeAddress(destText),
      ]);
      if (!origin || !destination) throw new Error("geocode-failed");
      const confirmed = !!(originCached && destCached);

      feedback.textContent = t("driver_routing");
      const route = await Routing.fetchRoute(origin, destination);
      if (!route) throw new Error("route-failed");

      const nearStations = Routing.findStationsNearRoute(route.coords, allStations, DEFAULT_PICKUP_RADIUS_M);
      const stationCumulative = {};
      nearStations.forEach((s) => {
        stationCumulative[s.id] = s.cumulativeMeters;
      });

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
        note,
        routeCoords: route.coords,
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        stationIds: nearStations.map((s) => s.id),
        stationCumulative,
        addressesConfirmed: confirmed,
        createdAt: new Date().toISOString(),
      };

      const trajets = loadTrajets();
      trajets.push(trajet);
      saveTrajets(trajets);

      feedback.classList.add("form-feedback--success");
      const resolvedLine = `${t("driver_resolvedAs")}: ${origin.displayName} → ${destination.displayName}`;
      const unconfirmedNote = confirmed ? "" : ` ${t("driver_unconfirmedNote")}`;
      feedback.textContent = nearStations.length
        ? `${t("driver_success")} ${resolvedLine}${unconfirmedNote}`
        : `${t("driver_success")} ${t("driver_noStations")} ${resolvedLine}${unconfirmedNote}`;
      form.reset();
      resetAddressFields(form);
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
  const addressInput = form.querySelector('[name="address"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const address = addressInput.value.trim();
    const results = document.getElementById("passenger-results");
    const feedback = document.getElementById("passenger-feedback");
    feedback.className = "form-feedback";
    results.innerHTML = "";
    feedback.textContent = t("driver_geocoding");

    try {
      const cached = Routing.getResolved(addressInput);
      const point = cached || (await Routing.geocodeAddress(address));
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

// ---------- Address autocomplete wiring ----------

function initAutocomplete() {
  document.querySelectorAll(".address-field input").forEach((input) => Routing.attachAutocomplete(input));
}

// ---------- Tabs ----------

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tabId));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `tab-${tabId}`));
  if (tabId === "map" && map) setTimeout(() => map.invalidateSize(), 50);
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

// ---------- Landing / role selection ----------

function getRole() {
  return localStorage.getItem(ROLE_KEY);
}

function applyRoleUI() {
  const role = getRole();
  const landing = document.getElementById("landing");
  const tabBar = document.getElementById("tab-bar");
  const appMain = document.getElementById("app-main");
  const switchBtn = document.getElementById("switch-role-btn");

  if (!role) {
    landing.hidden = false;
    tabBar.hidden = true;
    appMain.hidden = true;
    switchBtn.hidden = true;
    return;
  }

  landing.hidden = true;
  tabBar.hidden = false;
  appMain.hidden = false;
  switchBtn.hidden = false;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const r = btn.dataset.role;
    btn.hidden = !(r === "both" || r === role);
  });

  switchTab(role === "driver" ? "driver" : "passenger");
  renderAll();
}

function setRole(role) {
  localStorage.setItem(ROLE_KEY, role);
  applyRoleUI();
}

function clearRole() {
  localStorage.removeItem(ROLE_KEY);
  applyRoleUI();
}

function initRoleSelection() {
  document.getElementById("role-driver-btn").addEventListener("click", () => setRole("driver"));
  document.getElementById("switch-role-btn").addEventListener("click", () => clearRole());

  const carCheckbox = document.getElementById("passenger-has-car-checkbox");
  const passengerBtn = document.getElementById("role-passenger-btn");

  // Returning users who already confirmed car ownership aren't re-prompted.
  const hasCar = localStorage.getItem(HAS_CAR_KEY) === "1";
  carCheckbox.checked = hasCar;
  passengerBtn.disabled = !hasCar;

  carCheckbox.addEventListener("change", () => {
    passengerBtn.disabled = !carCheckbox.checked;
  });

  passengerBtn.addEventListener("click", () => {
    if (!carCheckbox.checked) return;
    localStorage.setItem(HAS_CAR_KEY, "1");
    setRole("passenger");
  });
}

// ---------- Global render ----------

function renderAll() {
  const trajets = loadTrajets();
  renderTrajetsOnMap(trajets);
  renderTrajetsList();
  renderRewards();
}

document.addEventListener("langchange", () => {
  Stations.updateLegendLabels();
  renderAll();
});

document.addEventListener("DOMContentLoaded", async () => {
  applyTranslations();
  initLanguageSwitcher();
  initTabs();
  initRoleSelection();
  initAutocomplete();
  initDriverForm();
  initPassengerSearch();
  applyRoleUI();
  await initMap();
  renderAll();
});
