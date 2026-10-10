#!/usr/bin/env node
// Entry point for the multi-source import pipeline. Manual-only by design
// — nothing schedules this. Fetches from the requested source(s),
// normalizes to the app's schema, drops anything that's already in
// data/services.json or a prior unreviewed candidate file, and writes
// whatever's left to data/import_candidates/<source>-<date>.json.
//
// This script NEVER writes to data/services.json and never auto-merges
// anything — a human reviews the candidate file and copies entries in by
// hand, same as the existing "Suggest a listing" review process, then runs
// `node scripts/validate_data.js` before committing.
//
// Usage:
//   node scripts/import/run_import.js --source=all
//   node scripts/import/run_import.js --source=osm,council
//   node scripts/import/run_import.js --source=osm --force   (skip the staleness check)

const fs = require("fs");
const path = require("path");

const { normalizeCandidate } = require("./normalize");
const { filterDuplicates } = require("./dedupe");

const CANDIDATES_DIR = path.join(__dirname, "..", "..", "data", "import_candidates");
const LAST_RUN_PATH = path.join(CANDIDATES_DIR, ".last_run.json");
const STALENESS_HOURS = 20;

// Auckland Council was planned as a third source, but has no structured
// open-data feed for recycling/resource-recovery facilities (confirmed by
// checking data.govt.nz and Auckland Council's own ArcGIS Hub — other
// regions like Wellington/Christchurch/Canterbury publish this, Auckland
// doesn't). Dropped rather than faking a source with nowhere real to fetch
// from; that handful of facilities is a better fit for one-off manual
// research than an automated pipeline anyway.
const SOURCES = {
  osm: () => require("./sources/osm"),
  google_places: () => require("./sources/google_places"),
};

function parseArgs(argv) {
  const sourceArg = argv.find((a) => a.startsWith("--source="));
  const requested = sourceArg ? sourceArg.replace("--source=", "").split(",") : ["all"];
  const sources = requested.includes("all") ? Object.keys(SOURCES) : requested;
  const force = argv.includes("--force");
  return { sources, force };
}

function readLastRun() {
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeLastRun(lastRun) {
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
  fs.writeFileSync(LAST_RUN_PATH, JSON.stringify(lastRun, null, 2) + "\n");
}

function isStaleEnough(lastRunIso, force) {
  if (force || !lastRunIso) return true;
  const hoursSince = (Date.now() - new Date(lastRunIso).getTime()) / (1000 * 60 * 60);
  return hoursSince >= STALENESS_HOURS;
}

async function runSource(sourceName, lastRun, force) {
  if (!SOURCES[sourceName]) {
    console.error(`Unknown source "${sourceName}" — valid sources: ${Object.keys(SOURCES).join(", ")}`);
    return;
  }

  if (!isStaleEnough(lastRun[sourceName], force)) {
    const hoursAgo = (
      (Date.now() - new Date(lastRun[sourceName]).getTime()) /
      (1000 * 60 * 60)
    ).toFixed(1);
    console.log(
      `${sourceName}: ran ${hoursAgo}h ago (within ${STALENESS_HOURS}h) — skipping. Pass --force to re-run anyway.`
    );
    return;
  }

  console.log(`${sourceName}: fetching...`);
  const { fetchCandidates } = SOURCES[sourceName]();
  let raw;
  try {
    raw = await fetchCandidates();
  } catch (err) {
    console.error(`${sourceName}: fetch failed — ${err.message}`);
    return;
  }

  const normalized = raw.map(normalizeCandidate).filter(Boolean);
  const fresh = await filterDuplicates(normalized);

  lastRun[sourceName] = new Date().toISOString();

  if (fresh.length === 0) {
    console.log(`${sourceName}: ${raw.length} raw result(s), 0 new after normalize/dedupe. Nothing to write.`);
    return;
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(CANDIDATES_DIR, `${sourceName}-${dateStamp}.json`);
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(fresh, null, 2) + "\n");
  console.log(
    `${sourceName}: ${raw.length} raw result(s) -> ${fresh.length} new candidate(s) written to ${path.relative(
      process.cwd(),
      outPath
    )}`
  );
}

async function main() {
  const { sources, force } = parseArgs(process.argv.slice(2));
  const lastRun = readLastRun();

  for (const sourceName of sources) {
    await runSource(sourceName, lastRun, force);
  }

  writeLastRun(lastRun);
  console.log(
    "\nNothing here was written to data/services.json. Review each candidate file, copy the useful entries in by hand (filling in checked_date and anything flagged in missing_fields), then run scripts/validate_data.js before committing."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
