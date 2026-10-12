// Pure-JS distance calculation — no external geocoding/distance API needed,
// works fully offline once the page and data are loaded.

const EARTH_RADIUS_KM = 6371;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

// Google Maps' documented directions URL: if `origin` is omitted, Google
// Maps uses the device's current location when the link is opened (asking
// for location permission itself). We still pass an explicit origin when we
// already have one from "Find near me" — avoids asking twice and keeps the
// route anchored to the point the user picked in this app. Shared by the
// map popup and the result card so both links are built the same way.
export function buildDirectionsUrl(destination, origin) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lng}`,
  });
  if (origin) {
    params.set("origin", `${origin.lat},${origin.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
