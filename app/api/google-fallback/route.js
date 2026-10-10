// Live Google Places fallback — only ever called from the empty-state (our
// own data found nothing), never blended into the main search results, so
// "our data first, Google only as a last resort" stays true regardless of
// how many people hit this endpoint. The API key stays server-side; this
// route is the only place it's ever read.
//
// Deliberately NOT part of the offline static export (same reasoning as
// /api/submit) — a live Google call makes no sense without a live server.

import { haversineDistanceKm } from "../../../lib/geo";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_RESULTS = 5;

const PRICE_LEVEL_LABELS = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

// In-memory cache of raw Places results, keyed by search text — distance
// depends on the individual user's location, so that's computed fresh per
// request from the cached place coordinates, never cached itself. This is a
// plain module-level Map, not a separate cache service: `next start` is a
// single long-running Node process (confirmed — this app isn't deployed as
// serverless), so the cache genuinely persists across requests without
// needing Redis or similar for a course-project's traffic. Resets on every
// server restart, which is fine — Google's own data changes too, a cold
// cache isn't a correctness problem.
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 200; // safety cap so a long-lived dev server can't grow unbounded
const cache = new Map(); // normalized query -> { timestamp, places }

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.places;
}

function setCache(key, places) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Oldest-inserted key — Map preserves insertion order.
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { timestamp: Date.now(), places });
}

async function fetchPlaces(textQuery, apiKey) {
  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.websiteUri,places.id,places.location,places.priceLevel,places.currentOpeningHours.openNow",
    },
    body: JSON.stringify({ textQuery, regionCode: "NZ" }),
  });

  if (!response.ok) {
    throw new Error(`Google Places returned ${response.status}.`);
  }

  const { places = [] } = await response.json();
  return places;
}

export async function GET(request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Not configured — not an error, the UI just won't offer this fallback.
    return Response.json({ available: false, results: [] });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  if (!query) {
    return Response.json({ error: "Missing query." }, { status: 400 });
  }

  // Optional — only present when the user has already granted location via
  // "Find near me", so we can show distance the same way our own results do.
  const userLat = parseFloat(searchParams.get("lat"));
  const userLng = parseFloat(searchParams.get("lng"));
  const hasUserLocation = Number.isFinite(userLat) && Number.isFinite(userLng);

  const textQuery = `${query} Auckland`;
  const cacheKey = textQuery.toLowerCase();

  let places = getCached(cacheKey);
  if (!places) {
    try {
      places = await fetchPlaces(textQuery, apiKey);
    } catch (err) {
      return Response.json({ available: true, results: [], error: err.message });
    }
    setCache(cacheKey, places);
  }

  const results = places.slice(0, MAX_RESULTS).map((place) => {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    const distanceKm =
      hasUserLocation && typeof lat === "number" && typeof lng === "number"
        ? haversineDistanceKm(userLat, userLng, lat, lng)
        : null;

    return {
      name: place.displayName?.text || "Unnamed place",
      address: place.formattedAddress || "",
      url: place.websiteUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
      price: PRICE_LEVEL_LABELS[place.priceLevel] || null,
      openNow:
        typeof place.currentOpeningHours?.openNow === "boolean"
          ? place.currentOpeningHours.openNow
          : null,
      distanceKm,
    };
  });

  return Response.json({ available: true, results });
}
