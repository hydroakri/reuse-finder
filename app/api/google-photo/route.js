// Proxies a Google Places photo through our own server so the API key never
// reaches the client (an <img src> with the key embedded would leak it to
// anyone viewing page source or the network tab). Same "server-only key"
// principle as /api/google-fallback.
//
// Billed separately from Text Search -- the "Places Photo" SKU (confirmed
// via Google's pricing page: 1,000 free/month, then $7.00/1000 up to
// 100,000, listed under the "legacy" pricing section -- worth re-verifying
// against actual Cloud Console billing once there's been real usage, same
// caveat as the FieldMask-tier question in SCRUM-57).

const MAX_WIDTH_PX = 400;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h -- photos change far less often than place data
const CACHE_MAX_ENTRIES = 100;
const cache = new Map(); // photoName -> { timestamp, contentType, buffer }

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key, entry) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { ...entry, timestamp: Date.now() });
}

// photoName looks like "places/PLACE_ID/photos/PHOTO_ID" -- validated so
// this route can't be abused as an open proxy for arbitrary Google API
// paths.
function isValidPhotoName(name) {
  return typeof name === "string" && /^places\/[^/]+\/photos\/[^/]+$/.test(name);
}

export async function GET(request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return new Response(null, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const photoName = searchParams.get("name");
  if (!isValidPhotoName(photoName)) {
    return Response.json({ error: "Invalid or missing photo name." }, { status: 400 });
  }

  const cached = getCached(photoName);
  if (cached) {
    return new Response(cached.buffer, {
      headers: { "Content-Type": cached.contentType, "Cache-Control": "public, max-age=86400" },
    });
  }

  const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${MAX_WIDTH_PX}&skipHttpRedirect=true`;
  let upstream;
  try {
    upstream = await fetch(mediaUrl, { headers: { "X-Goog-Api-Key": apiKey } });
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!upstream.ok) {
    return new Response(null, { status: upstream.status });
  }

  // skipHttpRedirect=true returns JSON with a photoUri instead of a 302 --
  // fetch that directly rather than following a redirect, so we control the
  // final response headers/caching ourselves.
  const { photoUri } = await upstream.json();
  if (!photoUri) {
    return new Response(null, { status: 502 });
  }

  let imageResponse;
  try {
    imageResponse = await fetch(photoUri);
  } catch {
    return new Response(null, { status: 502 });
  }
  if (!imageResponse.ok) {
    return new Response(null, { status: imageResponse.status });
  }

  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  setCache(photoName, { contentType, buffer });

  return new Response(buffer, {
    headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=86400" },
  });
}
