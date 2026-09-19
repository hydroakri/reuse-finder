#!/usr/bin/env node
// One-shot schema validator for data/services.json — no external dependencies.
// Run with: node scripts/validate_data.js
// Corresponds to Iteration 1 task T3 (data schema, validation rules, import workflow).

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'services.json');

const VALID_CATEGORIES = ['repair', 'borrow', 'rent', 'used'];
const VALID_STATUSES = ['active', 'inactive', 'unconfirmed', 'unverified-sample'];
const REQUIRED_STRING_FIELDS = ['id', 'item', 'category', 'suburb', 'source', 'source_url', 'status', 'checked_date'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Rough bounding box for the Auckland region — catches obvious typos (e.g. swapped lat/lng).
const AUCKLAND_BOUNDS = { minLat: -37.4, maxLat: -36.0, minLng: 174.3, maxLng: 175.3 };

function fail(errors) {
  console.error(`\nFAILED: ${errors.length} problem(s) found in data/services.json\n`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error('');
  process.exit(1);
}

function main() {
  if (!fs.existsSync(DATA_FILE)) {
    fail([`File not found: ${DATA_FILE}`]);
  }

  let records;
  try {
    records = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    fail([`services.json is not valid JSON: ${err.message}`]);
  }

  if (!Array.isArray(records)) {
    fail(['services.json must contain a top-level JSON array of records.']);
  }

  const errors = [];
  const seenIds = new Set();

  records.forEach((record, index) => {
    const where = `record #${index} (id: ${record && record.id ? record.id : 'MISSING'})`;

    for (const field of REQUIRED_STRING_FIELDS) {
      if (typeof record[field] !== 'string' || record[field].trim() === '') {
        errors.push(`${where}: missing or empty required field "${field}"`);
      }
    }

    if (record.id) {
      if (seenIds.has(record.id)) {
        errors.push(`${where}: duplicate id "${record.id}"`);
      }
      seenIds.add(record.id);
    }

    if (record.category && !VALID_CATEGORIES.includes(record.category)) {
      errors.push(`${where}: category "${record.category}" is not one of ${VALID_CATEGORIES.join(', ')}`);
    }

    if (record.status && !VALID_STATUSES.includes(record.status)) {
      errors.push(`${where}: status "${record.status}" is not one of ${VALID_STATUSES.join(', ')}`);
    }

    if (record.checked_date && !DATE_RE.test(record.checked_date)) {
      errors.push(`${where}: checked_date "${record.checked_date}" must be in YYYY-MM-DD format`);
    }

    if (typeof record.lat !== 'number' || typeof record.lng !== 'number') {
      errors.push(`${where}: lat/lng must both be numbers (needed for the map view)`);
    } else {
      const { minLat, maxLat, minLng, maxLng } = AUCKLAND_BOUNDS;
      if (record.lat < minLat || record.lat > maxLat || record.lng < minLng || record.lng > maxLng) {
        errors.push(`${where}: lat/lng (${record.lat}, ${record.lng}) falls outside the expected Auckland region bounding box — check for a typo or swapped lat/lng`);
      }
    }

    if (record.source_url) {
      try {
        const parsedUrl = new URL(record.source_url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          errors.push(`${where}: source_url "${record.source_url}" must use http:// or https:// (found "${parsedUrl.protocol}")`);
        }
      } catch {
        errors.push(`${where}: source_url "${record.source_url}" is not a valid URL`);
      }
    }

    if (typeof record.conditions !== 'object' || record.conditions === null || Array.isArray(record.conditions)) {
      errors.push(`${where}: "conditions" must be an object (hours, fee, eligibility, membership, dropoff_pickup)`);
    }

    if (record.status === 'unverified-sample') {
      console.warn(`WARNING: ${where} is placeholder sample data, not a real verified record. Replace before demo/submission.`);
    }
  });

  if (errors.length > 0) fail(errors);

  console.log(`OK: ${records.length} record(s) in services.json passed validation.`);
}

main();
