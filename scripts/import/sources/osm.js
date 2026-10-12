// Fetches reuse/repair/borrow/rent-relevant points from OpenStreetMap via
// the Overpass API — free, no key, but has a fair-use rate limit (roughly
// 100 queries / 10MB per day; this module makes exactly one query per run
// and identifies itself via User-Agent, per Overpass's own etiquette
// guidance). OSM has no concept of a scheduled "event", so this source can
// only ever produce repair/borrow/rent/used candidates.

const { AUCKLAND_BOUNDS } = require("../../lib/auckland_bounds");

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "reuse-finder-import-script/1.0 (course project, manual use only)";

// Each entry: OSM tag match -> category guess. Deliberately only tags with
// a clear, documented meaning (OSM wiki) are used — no guessing at
// ambiguous/rare tags, consistent with "don't invent data".
const TAG_QUERIES = [
  { tags: { shop: "second_hand" }, category: "used" },
  { tags: { shop: "charity" }, category: "used" },
  { tags: { craft: "tailor" }, category: "repair" },
  { tags: { craft: "shoemaker" }, category: "repair" },
  { tags: { craft: "electronics_repair" }, category: "repair" },
  { tags: { amenity: "toy_library" }, category: "borrow" },
  { tags: { shop: "bicycle", "service:bicycle:repair": "yes" }, category: "repair" },
  { tags: { shop: "bicycle", "service:bicycle:rental": "yes" }, category: "rent" },
];

function buildQuery() {
  const { minLat, minLng, maxLat, maxLng } = AUCKLAND_BOUNDS;
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  const statements = TAG_QUERIES.map(({ tags }) => {
    const filters = Object.entries(tags)
      .map(([key, value]) => `["${key}"="${value}"]`)
      .join("");
    return `nwr${filters}(${bbox});`;
  }).join("\n  ");
  return `[out:json][timeout:25];\n(\n  ${statements}\n);\nout center tags;`;
}

function categoryForTags(tags) {
  for (const { tags: match, category } of TAG_QUERIES) {
    const isMatch = Object.entries(match).every(([key, value]) => tags[key] === value);
    if (isMatch) return category;
  }
  return null;
}

function buildAddress(tags) {
  const parts = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean);
  return parts.join(" ");
}

async function fetchCandidates() {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: `data=${encodeURIComponent(buildQuery())}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API request failed: ${response.status} ${response.statusText}`);
  }

  const { elements = [] } = await response.json();
  const fetchedAt = new Date().toISOString();

  return elements
    .map((element) => {
      const tags = element.tags || {};
      const item = (tags.name || "").trim();
      if (!item) return null; // unnamed points aren't useful candidates

      const lat = element.type === "node" ? element.lat : element.center?.lat;
      const lng = element.type === "node" ? element.lon : element.center?.lon;
      const category = categoryForTags(tags);
      if (!category || typeof lat !== "number" || typeof lng !== "number") return null;

      return {
        item,
        category,
        suburb: tags["addr:suburb"] || tags["addr:city"] || "",
        address: buildAddress(tags),
        lat,
        lng,
        source: "OpenStreetMap contributors",
        source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        // OSM's opening_hours tag is a real (if terse) structured value
        // when present — worth carrying over as a starting point, still
        // needs a human to confirm it's current. No price tag is pulled in
        // here: OSM rarely tags fees for these shop/craft/amenity types, so
        // leaving conditions.fee blank (flagged in missing_fields) is more
        // honest than guessing.
        conditions: tags.opening_hours ? { hours: tags.opening_hours } : {},
        notes: `Imported from OpenStreetMap tags (${Object.entries(tags)
          .filter(([k]) => k.startsWith("shop") || k.startsWith("craft") || k === "amenity")
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}) — needs human verification of hours/fee/eligibility.`,
        source_system: "osm",
        fetched_at: fetchedAt,
      };
    })
    .filter(Boolean);
}

module.exports = { fetchCandidates };
