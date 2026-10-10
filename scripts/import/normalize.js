// Shared field cleanup for import candidates. Each source module in
// scripts/import/sources/*.js returns loosely-shaped raw records; this
// turns them into the app's canonical schema plus import metadata
// (source_system/fetched_at/missing_fields), rejecting anything that can't
// become a usable candidate (no item name, no category guess, no
// coordinates, or coordinates outside Auckland).

const { isWithinAucklandBounds } = require("../lib/auckland_bounds");

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics (e.g. ā -> a)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCandidate(raw) {
  const item = (raw.item || "").trim();
  const suburb = (raw.suburb || "").trim();
  const address = (raw.address || "").trim();
  const category = raw.category || null;
  const lat = typeof raw.lat === "number" ? raw.lat : null;
  const lng = typeof raw.lng === "number" ? raw.lng : null;

  // Can't make a usable candidate without these — skip rather than guess,
  // consistent with the project's "don't invent data" principle.
  if (!item || !category || lat === null || lng === null) return null;
  if (!isWithinAucklandBounds(lat, lng)) return null;

  const missingFields = [];
  if (!suburb) missingFields.push("suburb");
  if (!address) missingFields.push("address");
  if (!raw.conditions || !raw.conditions.hours) missingFields.push("conditions.hours");
  if (!raw.conditions || !raw.conditions.fee) missingFields.push("conditions.fee");

  return {
    id: `${raw.source_system}-${slugify(item)}-${slugify(suburb || "auckland")}`,
    item,
    category,
    suburb: suburb || "Auckland",
    address,
    lat,
    lng,
    source: raw.source || item,
    source_url: raw.source_url || "",
    status: "unconfirmed",
    // Left blank deliberately — this is the date a human actually confirms
    // the record, not the date it was fetched. `fetched_at` below covers
    // the latter. A candidate is NOT ready for services.json until this
    // (and the other required fields) are filled in by whoever reviews it.
    checked_date: "",
    conditions: {
      hours: raw.conditions?.hours || "",
      fee: raw.conditions?.fee || "",
      eligibility: raw.conditions?.eligibility || "",
      membership: raw.conditions?.membership || "",
      dropoff_pickup: raw.conditions?.dropoff_pickup || "",
    },
    notes: raw.notes || "",
    source_system: raw.source_system,
    fetched_at: raw.fetched_at,
    missing_fields: missingFields,
  };
}

module.exports = { normalizeCandidate, slugify };
