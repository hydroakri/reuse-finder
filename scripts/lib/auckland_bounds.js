// Rough bounding box for the Auckland region — catches obvious typos (e.g.
// swapped lat/lng) in validate_data.js, and lets the import pipeline reject
// out-of-region candidates before they ever reach a human reviewer.
// maxLng widened from 175.3 to 175.55 (2026-10-17) to cover Great Barrier
// Island / Aotea -- part of Auckland Council's territorial area, confirmed
// via real geocoded venues out there (e.g. Claris, ~175.47) that were being
// wrongly rejected as out-of-region.
const AUCKLAND_BOUNDS = { minLat: -37.4, maxLat: -36.0, minLng: 174.3, maxLng: 175.55 };

function isWithinAucklandBounds(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  const { minLat, maxLat, minLng, maxLng } = AUCKLAND_BOUNDS;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

module.exports = { AUCKLAND_BOUNDS, isWithinAucklandBounds };
