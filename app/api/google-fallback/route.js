// Live Google Places fallback — only ever called from the empty-state (our
// own data found nothing), never blended into the main search results, so
// "our data first, Google only as a last resort" stays true regardless of
// how many people hit this endpoint. The API key stays server-side; this
// route is the only place it's ever read.
//
// Deliberately NOT part of the offline static export (same reasoning as
// /api/submit) — a live Google call makes no sense without a live server.

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MAX_RESULTS = 5;

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

  const textQuery = `${query} Auckland`;

  let response;
  try {
    response = await fetch(TEXT_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.id",
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

  const results = places.slice(0, MAX_RESULTS).map((place) => ({
    name: place.displayName?.text || "Unnamed place",
    address: place.formattedAddress || "",
    url: place.websiteUri || `https://www.google.com/maps/place/?q=place_id:${place.id}`,
  }));

  return Response.json({ available: true, results });
}
