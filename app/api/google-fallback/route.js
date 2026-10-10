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

  let response;
  try {
    response = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.formattedAddress,places.websiteUri,places.id,places.location,places.priceLevel,places.currentOpeningHours.openNow",
      },
      body: JSON.stringify({ textQuery, regionCode: "NZ" }),
    });
  } catch {
    return Response.json({ available: true, results: [], error: "Google Places request failed." });
  }

  if (!response.ok) {
    return Response.json({ available: true, results: [], error: `Google Places returned ${response.status}.` });
  }

  const { places = [] } = await response.json();

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
