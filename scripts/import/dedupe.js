// Drops import candidates that are probably the same real-world place as
// something already in data/services.json, or already sitting unreviewed
// in a prior data/import_candidates/*.json file — otherwise a daily run
// would re-surface the same unreviewed candidate every single time.
//
// lib/geo.js uses ESM `export` syntax with no "type":"module" in
// package.json (it only works today because Next's bundler transpiles
// everything under app/ and lib/ regardless). A plain `require()` from
// this CommonJS script would fail; dynamic `import()` works because Node
// falls back to parsing it as ESM once it detects `export` syntax.

const fs = require("fs");
const path = require("path");

const SERVICES_PATH = path.join(__dirname, "..", "..", "data", "services.json");
const CANDIDATES_DIR = path.join(__dirname, "..", "..", "data", "import_candidates");

// Same real-world place is assumed within ~150m with an overlapping name —
// loose enough to catch minor address/geocoding drift, tight enough not to
// conflate two different venues in the same block.
const DUPLICATE_DISTANCE_KM = 0.15;

function normalizeName(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readJsonArraySafe(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadKnownLocations() {
  const { haversineDistanceKm } = await import("../../lib/geo.js");

  const locations = readJsonArraySafe(SERVICES_PATH).map((r) => ({
    item: r.item,
    lat: r.lat,
    lng: r.lng,
  }));

  if (fs.existsSync(CANDIDATES_DIR)) {
    for (const file of fs.readdirSync(CANDIDATES_DIR)) {
      if (!file.endsWith(".json") || file.startsWith(".")) continue;
      for (const r of readJsonArraySafe(path.join(CANDIDATES_DIR, file))) {
        locations.push({ item: r.item, lat: r.lat, lng: r.lng });
      }
    }
  }

  return { locations, haversineDistanceKm };
}

async function filterDuplicates(candidates) {
  const { locations, haversineDistanceKm } = await loadKnownLocations();

  return candidates.filter((candidate) => {
    const candidateName = normalizeName(candidate.item);
    const isDuplicate = locations.some((known) => {
      if (typeof known.lat !== "number" || typeof known.lng !== "number") return false;
      const distanceKm = haversineDistanceKm(known.lat, known.lng, candidate.lat, candidate.lng);
      if (distanceKm > DUPLICATE_DISTANCE_KM) return false;
      const knownName = normalizeName(known.item);
      return knownName.includes(candidateName) || candidateName.includes(knownName);
    });
    return !isDuplicate;
  });
}

module.exports = { filterDuplicates };
