// Rough bounding box for the Auckland region — catches obvious typos (e.g.
// swapped lat/lng) in validate_data.js, and lets the import pipeline reject
// out-of-region candidates before they ever reach a human reviewer.
const AUCKLAND_BOUNDS = { minLat: -37.4, maxLat: -36.0, minLng: 174.3, maxLng: 175.3 };

function isWithinAucklandBounds(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  const { minLat, maxLat, minLng, maxLng } = AUCKLAND_BOUNDS;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

module.exports = { AUCKLAND_BOUNDS, isWithinAucklandBounds };
