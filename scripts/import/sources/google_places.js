// Fetches candidates via the Google Places API (Text Search) — unlike the
// other two sources, this needs a billing-enabled Google Cloud project and
// an API key. Reads the key from GOOGLE_PLACES_API_KEY; if it's not set,
// fetchCandidates() returns an empty list with a clear console message
// instead of throwing, so `--source=all` runs stay usable for whoever
// hasn't set up a key yet. "No API key" stays the default state.

const { AUCKLAND_BOUNDS } = require("../../lib/auckland_bounds");

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

// Query text -> category guess. Google Places doesn't expose a clean
// "repair shop" type filter, so this leans on text search phrasing instead
// of place types, same as a person would type into Google Maps.
const QUERIES = [
  { text: "bike repair shop Auckland", category: "repair" },
  { text: "op shop Auckland", category: "used" },
  { text: "second hand shop Auckland", category: "used" },
  { text: "tool library Auckland", category: "borrow" },
  { text: "clothing alterations repair Auckland", category: "repair" },
];

function isWithinBounds(lat, lng) {
  const { minLat, maxLat, minLng, maxLng } = AUCKLAND_BOUNDS;
  return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
}

async function searchOne(query, apiKey) {
  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      // Field mask keeps the response (and quota cost) minimal — only what
      // normalize.js actually needs.
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.websiteUri,places.id",
    },
    body: JSON.stringify({ textQuery: query.text, regionCode: "NZ" }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Google Places request failed for "${query.text}": ${response.status} ${body}`);
  }

  const { places = [] } = await response.json();
  const fetchedAt = new Date().toISOString();

  return places
    .map((place) => {
      const item = place.displayName?.text?.trim();
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (!item || typeof lat !== "number" || typeof lng !== "number" || !isWithinBounds(lat, lng)) {
        return null;
      }

      return {
        item,
        category: query.category,
        suburb: "", // Places doesn't return a clean suburb field — human fills in on review
        address: place.formattedAddress || "",
        lat,
        lng,
        source: "Google Places",
        source_url: place.websiteUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
        conditions: {},
        notes: `Imported via Google Places text search ("${query.text}") — hours/fee/eligibility not returned by this query, needs human verification.`,
        source_system: "google_places",
        fetched_at: fetchedAt,
      };
    })
    .filter(Boolean);
}

async function fetchCandidates() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.log(
      "google_places: GOOGLE_PLACES_API_KEY is not set — skipping this source. Set it in your environment to enable Google Places import."
    );
    return [];
  }

  const results = [];
  for (const query of QUERIES) {
    results.push(...(await searchOne(query, apiKey)));
  }
  return results;
}

module.exports = { fetchCandidates };
