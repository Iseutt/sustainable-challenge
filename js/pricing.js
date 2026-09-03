// Passenger pricing and driver/passenger CO2/points calculations.
//
// Pricing model: a flat per-km cost-sharing rate applied to the distance the
// passenger actually rides (from their meeting station to the driver's
// destination) — not a full-trip-cost split, so the fare doesn't depend on
// how many other passengers are aboard.
//
// CO2 model: the same ridden distance is what the passenger would otherwise
// have driven alone (which is why a passenger must confirm they own a car
// before joining — see the landing page gate), so CO2 "saved" = ridden
// distance x an average-car emission factor. 0.17 kg/km is a representative
// mixed-fleet petrol car figure (in the range ADEME/EEA cite); it's a
// deliberate simplification, not a per-vehicle measurement.
//
// Points: both the driver and the passenger are rewarded from that same
// avoided CO2, but at different rates so the passenger's advantage is the
// bigger one — they're the one who actually left their car at home.
// Passenger: 10 pts/kg (the originally specified rate). Driver: 4 pts/kg,
// a smaller "host bonus" for making the ride possible. Both share the same
// 1000-point / EUR10 (future) reward threshold, so the passenger simply
// reaches it faster. At ~0.17 kg/km, a typical 4km ride saves ~0.7kg: ~7
// passenger points or ~3 driver points per ride — a believable loyalty pace
// for a daily commuter (roughly 150 rides to 1000 points as a passenger).

const Pricing = (() => {
  const PRICE_PER_KM = 0.12;
  const MIN_FARE = 1;
  const PRICE_ROUNDING = 0.5;

  const CO2_KG_PER_KM = 0.17;
  const PASSENGER_POINTS_PER_KG = 10;
  const DRIVER_POINTS_PER_KG = 4;
  const POINTS_PER_REWARD = 1000;
  const REWARD_EUR = 10;

  function remainingDistanceKm(trajet, cumulativeMeters) {
    const remainingMeters = Math.max(0, (trajet.distanceMeters || 0) - (cumulativeMeters || 0));
    return remainingMeters / 1000;
  }

  function computePrice(distanceKm) {
    const raw = Math.max(MIN_FARE, distanceKm * PRICE_PER_KM);
    return Math.round(raw / PRICE_ROUNDING) * PRICE_ROUNDING;
  }

  function computeCO2Kg(distanceKm) {
    return distanceKm * CO2_KG_PER_KM;
  }

  function computeDriverPoints(kgSaved) {
    return Math.round(kgSaved * DRIVER_POINTS_PER_KG);
  }

  function computePassengerPoints(kgSaved) {
    return Math.round(kgSaved * PASSENGER_POINTS_PER_KG);
  }

  function formatPrice(distanceKm) {
    return `${computePrice(distanceKm).toFixed(2)} €`;
  }

  return {
    PRICE_PER_KM,
    MIN_FARE,
    CO2_KG_PER_KM,
    PASSENGER_POINTS_PER_KG,
    DRIVER_POINTS_PER_KG,
    POINTS_PER_REWARD,
    REWARD_EUR,
    remainingDistanceKm,
    computePrice,
    computeCO2Kg,
    computeDriverPoints,
    computePassengerPoints,
    formatPrice,
  };
})();
