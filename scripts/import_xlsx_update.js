#!/usr/bin/env node
// Converts a teammate-maintained spreadsheet export (see data/sources/) into
// data/services.json records. Used for the 2026-10-13 update (95 new venues
// + 53 existing venues with factual updates, 148 rows total) -- kept as a
// reference/reusable script for the next such update, not meant to be the
// only step: Nominatim fails on "prose" addresses (venue-within-venue
// descriptions, parenthetical date ranges) often enough that some rows will
// still need manual address research before a re-run picks them up.
//
// Expects a pre-parsed JSON export of the sheet's "Locations" tab (export
// via pandas: `df.to_json(path, orient="records")`), since this project has
// no xlsx-reading dependency and openpyxl/pandas aren't in package.json --
// deliberately kept to a Node-only dependency surface, same as every other
// script here.
//
// Existing rows (sheet column "Added in this update" == "Existing") are
// matched to current services.json by normalized venue name. Their
// lat/lng/address/suburb/id are NEVER touched -- already-verified
// coordinates are more trustworthy than re-geocoding slightly-different
// address text from a new sheet. Only notes/contact/conditions refresh.
//
// New rows are geocoded via Nominatim (rate-limited to 1 req/sec per their
// usage policy) and expanded into one record per category (sheet's
// "Service category" can be e.g. "Borrow; Repair" -- becomes two records,
// consistent with services.json's existing one-record-per-category
// convention; Explorer.js's groupResultsByVenue merges them back into one
// card for display).
//
// Run with: node scripts/import_xlsx_update.js <parsed-locations.json>
// Writes data/services.json directly (not a reviewable candidate file like
// scripts/import/ -- this is curated data from a known teammate, not an
// unverified external scrape). Always run scripts/validate_data.js after.

const fs = require("fs");
const path = require("path");
const { isWithinAucklandBounds } = require("./lib/auckland_bounds");

const SERVICES_FILE = path.join(__dirname, "..", "data", "services.json");

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// For NAME MATCHING only (not display) -- collapses curly vs straight
// quotes/dashes, case, whitespace, so sheet text matches services.json text
// even with minor unicode punctuation differences.
function normalizeForMatch(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_MAP = { borrow: "borrow", rent: "rent", repair: "repair", used: "used", event: "event" };
function parseCategories(raw) {
  return (raw || "")
    .split(";")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .map((c) => CATEGORY_MAP[c])
    .filter(Boolean);
}

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=1&q=${encodeURIComponent(address + ", Auckland, New Zealand")}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AucklandReuseFinder/1.0 (ENGGEN731 course project)" },
  });
  if (!res.ok) return null;
  const results = await res.json();
  if (!results.length) return null;
  const r = results[0];
  const addr = r.address || {};
  const suburb = addr.suburb || addr.city_district || addr.neighbourhood || addr.town || addr.village || "";
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), suburb };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNotes(row) {
  const parts = [];
  if (row["Detailed item categories provided at location"]) {
    parts.push(row["Detailed item categories provided at location"].trim());
  }
  if (row["Objects offered (published details)"]) {
    parts.push(`Objects offered: ${row["Objects offered (published details)"].trim()}`);
  }
  return parts.join(" ");
}

function firstSourceUrl(row) {
  const website = (row["Website or social links"] || "").split("|")[0].trim();
  if (website) return website;
  return (row["Source links"] || "").split("|")[0].trim();
}

async function main() {
  const locationsFile = process.argv[2];
  if (!locationsFile) {
    console.error("Usage: node scripts/import_xlsx_update.js <parsed-locations.json>");
    process.exit(1);
  }

  const services = JSON.parse(fs.readFileSync(SERVICES_FILE, "utf8"));
  const rows = JSON.parse(fs.readFileSync(locationsFile, "utf8"));

  const venuesByName = new Map();
  for (const svc of services) {
    const key = normalizeForMatch(svc.item);
    if (!venuesByName.has(key)) venuesByName.set(key, []);
    venuesByName.get(key).push(svc);
  }

  const updatedById = new Map(services.map((s) => [s.id, s]));
  const report = { matchedExisting: [], unmatchedExisting: [], newGeocoded: [], newGeocodeFailed: [] };
  const newRecords = [];

  for (const row of rows) {
    const name = (row["Location name"] || "").trim();
    const isNew = row["Added in this update"] === "NEW";
    const categories = parseCategories(row["Service category"]);

    if (!isNew) {
      const matches = venuesByName.get(normalizeForMatch(name));
      if (!matches || matches.length === 0) {
        report.unmatchedExisting.push({ name, address: row["Address"] });
        continue;
      }
      const notes = buildNotes(row);
      const contact = (row["Contacts"] || "").trim();
      const hours = (row["Service timing / status"] || "").trim();
      const fee = (row["Cost / access conditions"] || "").trim();
      const eligibility = (row["Service provided to"] || "").trim();

      for (const svc of matches) {
        const target = updatedById.get(svc.id);
        if (notes) target.notes = notes;
        if (contact) target.contact = contact;
        if (hours) target.conditions.hours = hours;
        if (fee) target.conditions.fee = fee;
        if (eligibility) target.conditions.eligibility = eligibility;
      }
      report.matchedExisting.push({ name, recordIds: matches.map((m) => m.id) });
      continue;
    }

    const address = (row["Address"] || "").trim();
    if (!address || categories.length === 0) {
      report.newGeocodeFailed.push({ name, reason: !address ? "no address" : "no valid category" });
      continue;
    }

    let geo;
    try {
      geo = await geocode(address);
    } catch {
      geo = null;
    }
    await sleep(1100); // Nominatim usage policy: max 1 req/sec

    if (!geo || !isWithinAucklandBounds(geo.lat, geo.lng)) {
      report.newGeocodeFailed.push({ name, address, reason: !geo ? "no geocode result" : "outside Auckland bounds", geo });
      continue;
    }

    const notes = buildNotes(row);
    const contact = (row["Contacts"] || "").trim();
    const sourceUrl = firstSourceUrl(row);
    const suburb = geo.suburb || "Auckland";
    const baseSlug = slugify(name);

    for (const category of categories) {
      newRecords.push({
        id: `${baseSlug}-${category}`,
        item: name,
        category,
        suburb,
        address,
        lat: geo.lat,
        lng: geo.lng,
        source: name,
        source_url: sourceUrl,
        status: "unconfirmed",
        checked_date: new Date().toISOString().slice(0, 10),
        conditions: {
          hours: (row["Service timing / status"] || "").trim(),
          fee: (row["Cost / access conditions"] || "").trim(),
          eligibility: (row["Service provided to"] || "").trim(),
          membership: "",
          dropoff_pickup: "",
        },
        notes,
        contact,
      });
    }
    report.newGeocoded.push({ name, suburb, lat: geo.lat, lng: geo.lng, categories });
  }

  const finalServices = [...services, ...newRecords];
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(finalServices, null, 2) + "\n", "utf8");

  console.log(`Matched existing venues: ${report.matchedExisting.length}`);
  console.log(`Unmatched "Existing" rows (flagged, not touched): ${report.unmatchedExisting.length}`);
  if (report.unmatchedExisting.length) console.log(JSON.stringify(report.unmatchedExisting, null, 2));
  console.log(`New venues geocoded: ${report.newGeocoded.length} (-> ${newRecords.length} category records)`);
  console.log(`New rows that FAILED to geocode (need manual address research): ${report.newGeocodeFailed.length}`);
  if (report.newGeocodeFailed.length) console.log(JSON.stringify(report.newGeocodeFailed, null, 2));
  console.log(`\nTotal records: ${services.length} -> ${finalServices.length}`);
  console.log(`\nRun 'node scripts/validate_data.js' next.`);
}

main();
