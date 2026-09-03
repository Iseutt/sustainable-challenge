// Passenger pricing and driver CO2/points calculations.
//
// Pricing model: a flat per-km cost-sharing rate applied to the distance the
// passenger actually rides (from their meeting station to the driver's
// destination) — not a full-trip-cost split, so the fare doesn't depend on
// how many other passengers are aboard.
//
// CO2 model: the same ridden distance is what the passenger would otherwise
// have driven alone, so CO2 "saved" = ridden distance x an average-car
// emission factor. 0.17 kg/km is a representative mixed-fleet petrol car
// figure (in the range ADEME/EEA cite); it's a deliberate simplification,
// not a per-vehicle measurement.
//
// Points: 1 kg CO2 saved = 10 points, 1000 points = a (future) EUR10
// fuel-station reward. At ~0.17 kg/km, a typical 4km ride saves ~0.7kg
// (~7 points) - reaching 1000 points takes roughly 150 such rides, a
// believable loyalty-program pace for a daily commuter, so this exchange
// rate is kept as specified.

const Pricing = (() => {
  const PRICE_PER_KM = 0.12;
  const MIN_FARE = 1;
  const PRICE_ROUNDING = 0.5;

  const CO2_KG_PER_KM = 0.17;
  const POINTS_PER_KG = 10;
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

  function computePoints(kgSaved) {
    return Math.round(kgSaved * POINTS_PER_KG);
  }

  function formatPrice(distanceKm) {
    return `${computePrice(distanceKm).toFixed(2)} €`;
  }

  return {
    PRICE_PER_KM,
    MIN_FARE,
    CO2_KG_PER_KM,
    POINTS_PER_KG,
    POINTS_PER_REWARD,
    REWARD_EUR,
    remainingDistanceKm,
    computePrice,
    computeCO2Kg,
    computePoints,
    formatPrice,
  };
})();
