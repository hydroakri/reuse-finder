// Generates candidate item-keyword synonym pairs by cross-referencing
// WordNet noun synsets (via wordpos/wordnet-db, fully offline, no network
// calls) against the words that actually appear in data/services.json's
// `item` fields. A human reviews the output file and hand-copies useful
// pairs into ITEM_SYNONYMS in app/components/Explorer.js — this script
// only ever proposes candidates, it never edits app code itself.
//
// Run manually: node scripts/generate_item_synonyms.js
// Not wired into CI — unlike validate_data.js (which only reads and
// reports), this script's output changes search *behaviour*, so it goes
// through the same human-review-before-it-matters principle as data.

const fs = require("fs");
const path = require("path");
const WordPOS = require("wordpos");

const SERVICES_PATH = path.join(__dirname, "..", "data", "services.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "item_synonyms.suggestions.json");

const wordpos = new WordPOS({ stopwords: true });

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .split(/[^a-z]+/)
    // Words under 4 letters ("a", "at", "ar") trigger obscure WordNet
    // senses (chemical symbols, abbreviations) that are pure noise here.
    .filter((word) => word.length >= 4);
}

async function main() {
  const services = JSON.parse(fs.readFileSync(SERVICES_PATH, "utf8"));

  const vocab = new Set();
  for (const record of services) {
    for (const word of tokenize(record.item)) {
      vocab.add(word);
    }
  }

  const suggestions = {};

  for (const word of [...vocab].sort()) {
    let synsets;
    try {
      synsets = await wordpos.lookupNoun(word);
    } catch {
      continue;
    }
    if (!synsets || synsets.length === 0) continue;

    for (const synset of synsets) {
      for (const synonym of synset.synonyms || []) {
        const candidate = synonym.toLowerCase();
        if (
          candidate === word ||
          !/^[a-z]+$/.test(candidate) || // skip multi-word/underscored WordNet entries
          vocab.has(candidate) || // already matches literally — not a useful suggestion
          Object.prototype.hasOwnProperty.call(suggestions, candidate)
        ) {
          continue;
        }
        suggestions[candidate] = word;
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(suggestions, null, 2) + "\n");
  const count = Object.keys(suggestions).length;
  console.log(
    `Wrote ${count} candidate synonym pair(s) to ${path.relative(process.cwd(), OUTPUT_PATH)}`
  );
  console.log(
    "Review them, then hand-copy the useful ones into ITEM_SYNONYMS in app/components/Explorer.js."
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
