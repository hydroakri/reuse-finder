#!/usr/bin/env node
// SCRUM-74 + SCRUM-22 + rating blend: look up a REAL photo, phone number,
// and rating per curated venue via Google Places Text Search, writing
// straight into data/services.json (not a reviewable candidate file like
// scripts/import/ -- these are enrichments of already-verified existing
// records, not new unverified data).
//
// google_rating/google_rating_count are NOT shown on their own -- /api/
// ratings only blends them into a venue's rating once that venue has at
// least one real user rating (see that route's `aggregate()`). An empty
// local rating state is never backfilled with Google's, deliberately --
// see that file's comment for why.
//
// Safety gate against mismatching a venue to the wrong real-world place
// (which would misrepresent a real organisation, worse than no photo/phone
// at all): only accepts a match whose returned location is within 150m of
// our own already-verified lat/lng -- same "same real-world place" distance
// threshold scripts/import/dedupe.js already uses. No name-only matching.
//
// Safe to re-run: a venue already holding image_url, contact AND
// google_rating is skipped entirely, so running this again only queries
// venues still missing at least one of the three.
//
// Run with: GOOGLE_PLACES_API_KEY=... node scripts/fetch_service_photos.js
// Requires network + the same API key used by scripts/import/sources/
// google_places.js and /api/google-fallback. Cost: one Text Search per
// unique venue still missing data (venues repeated across categories are
// only queried once) -- rating/review-count ride along in the same
// request, no extra API calls.

const fs = require("node:fs");
const path = require("node:path");

const DATA_FILE = path.join(__dirname, "..", "data", "services.json");
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const MATCH_DISTANCE_KM = 0.15;

async function searchVenue(record, apiKey) {
  const textQuery = `${record.item} ${record.address || record.suburb} Auckland`;
  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.location,places.photos,places.nationalPhoneNumber,places.rating,places.userRatingCount",
    },
    body: JSON.stringify({ textQuery, regionCode: "NZ" }),
  });

  if (!response.ok) {
    console.warn(`  Places request failed (${response.status}) for "${textQuery}"`);
    return null;
  }

  const { places = [] } = await response.json();
  return places[0] || null;
}

function isComplete(record) {
  return Boolean(record.image_url) && Boolean(record.contact) && typeof record.google_rating === "number";
}

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error(
      "GOOGLE_PLACES_API_KEY is not set in this shell. Run: GOOGLE_PLACES_API_KEY=<your key> node scripts/fetch_service_photos.js"
    );
    process.exit(1);
  }

  const { haversineDistanceKm } = await import("../lib/geo.js");
  const records = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  // Dedupe by venue -- several records share the same physical place across
  // categories (e.g. a repair café that's also a borrow hub), and querying
  // Google once per venue instead of once per record keeps cost down.
  const venueKey = (r) => `${r.item}|${r.address || r.suburb}`;
  const venues = new Map();
  for (const record of records) {
    const key = venueKey(record);
    if (!venues.has(key)) venues.set(key, []);
    venues.get(key).push(record);
  }

  let gotPhoto = 0;
  let gotContact = 0;
  let gotRating = 0;
  let skippedTooFar = 0;
  let skippedNothingFound = 0;
  let skippedAlreadyComplete = 0;
  let skippedNoResult = 0;

  for (const [, group] of venues) {
    const sample = group[0];
    if (isComplete(sample)) {
      skippedAlreadyComplete += group.length;
      continue;
    }

    const place = await searchVenue(sample, apiKey);
    if (!place || !place.location) {
      skippedNoResult += group.length;
      console.log(`  no result: ${sample.item}`);
      continue;
    }

    const distanceKm = haversineDistanceKm(
      sample.lat,
      sample.lng,
      place.location.latitude,
      place.location.longitude
    );
    if (distanceKm > MATCH_DISTANCE_KM) {
      skippedTooFar += group.length;
      console.log(
        `  too far (${(distanceKm * 1000).toFixed(0)}m): ${sample.item} -> "${place.displayName?.text}"`
      );
      continue;
    }

    const photoName = place.photos?.[0]?.name;
    const phone = place.nationalPhoneNumber || null;
    const rating = typeof place.rating === "number" ? place.rating : null;
    const ratingCount = typeof place.userRatingCount === "number" ? place.userRatingCount : null;

    if (!photoName && !phone && rating === null) {
      skippedNothingFound += group.length;
      console.log(`  matched place but no photo, phone or rating available: ${sample.item}`);
      continue;
    }

    for (const record of group) {
      if (photoName && !record.image_url) {
        record.image_url = `/api/google-photo?name=${encodeURIComponent(photoName)}`;
      }
      if (phone && !record.contact) {
        record.contact = phone;
      }
      if (rating !== null && typeof record.google_rating !== "number") {
        record.google_rating = rating;
        record.google_rating_count = ratingCount || 0;
      }
    }
    if (photoName) gotPhoto += group.length;
    if (phone) gotContact += group.length;
    if (rating !== null) gotRating += group.length;
    console.log(
      `  matched: ${sample.item} (${group.length} record(s))` +
        `${photoName ? " [photo]" : ""}${phone ? " [phone]" : ""}${rating !== null ? ` [rating ${rating}]` : ""}`
    );
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(records, null, 2) + "\n", "utf8");

  console.log(`\nDone. ${venues.size} unique venue(s) checked.`);
  console.log(`  ${gotPhoto} record(s) got a real photo.`);
  console.log(`  ${gotContact} record(s) got a phone number.`);
  console.log(`  ${gotRating} record(s) got a Google rating.`);
  console.log(`  ${skippedAlreadyComplete} already had all three, left untouched.`);
  console.log(`  ${skippedTooFar} skipped -- best match was further than ${MATCH_DISTANCE_KM * 1000}m away.`);
  console.log(`  ${skippedNothingFound} skipped -- matched place but Google has none of photo/phone/rating for it.`);
  console.log(`  ${skippedNoResult} skipped -- no Places result at all.`);
  console.log(`\nRun 'node scripts/validate_data.js' to confirm services.json is still valid.`);
}

main();
