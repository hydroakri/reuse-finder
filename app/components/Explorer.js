"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import ResultsList from "./ResultsList";
import GoogleFallback from "./GoogleFallback";
import { haversineDistanceKm } from "../../lib/geo";

// M3 kill switch: flip to false to hide the map entirely (list/search still
// work) if the map ever becomes more trouble than it's worth before demo day.
const ENABLE_MAP = true;

// Map must never block initial page render or SSR — react-leaflet touches
// `window` on import, which only exists in the browser.
const MapView = dynamic(() => import("./MapView"), { ssr: false });

const CATEGORIES = [
  { value: "all", label: "All categories" },
  { value: "repair", label: "Repair" },
  { value: "borrow", label: "Borrow" },
  { value: "rent", label: "Rent" },
  { value: "used", label: "Used purchase" },
  { value: "event", label: "Event" },
];

// Small manually-maintained synonym table so obvious wording differences
// ("second-hand" vs "used") still match — deliberately not a full search
// engine, the dataset is at most a few dozen records.
const SYNONYMS = {
  "second-hand": "used",
  secondhand: "used",
  "pre-loved": "used",
  preloved: "used",
  hire: "rent",
  lend: "borrow",
  lending: "borrow",
  fix: "repair",
  fixing: "repair",
};

function normalize(text) {
  return (text || "").toLowerCase().trim();
}

// Everyday words people search that don't literally appear in any item
// name, mapped to a word that does (e.g. nobody's item is named
// "bicycle", but several are named "bike"). Separate from the category
// SYNONYMS above — these resolve to an item-name word, not a category.
const ITEM_SYNONYMS = {
  bicycle: "bike",
  bicycles: "bike",
  cycle: "bike",
  cycling: "bike",
};

// Small, dependency-free edit-distance check so an obvious typo ("repiar")
// still matches — deliberately conservative (short words need an exact
// match) to avoid coincidental matches on unrelated short words.
function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[rows - 1][cols - 1];
}

function isCloseTypo(word, target) {
  if (word === target) return true;
  if (word.length < 4 || target.length < 4) return false;
  const threshold = Math.max(word.length, target.length) >= 7 ? 2 : 1;
  return levenshteinDistance(word, target) <= threshold;
}

// A query word matches an item if it (or its everyday synonym) appears in
// the item name verbatim, or is a close typo of one of the item's words.
function wordMatchesItem(word, haystack, haystackWords) {
  const resolved = ITEM_SYNONYMS[word] || word;
  if (haystack.includes(word) || haystack.includes(resolved)) return true;
  return haystackWords.some(
    (haystackWord) => isCloseTypo(haystackWord, word) || isCloseTypo(haystackWord, resolved)
  );
}

const CATEGORY_VALUES = CATEGORIES.map((option) => option.value).filter(
  (value) => value !== "all"
);

// Finds a word in the search text that names a category (directly, or via
// SYNONYMS, e.g. "hire" -> "rent"). Used both to filter and to decide
// relevance ranking, so a word like "rent" always means the same thing.
function extractCategorySignal(words) {
  for (const word of words) {
    const resolved = SYNONYMS[word] || word;
    if (CATEGORY_VALUES.includes(resolved)) return resolved;
  }
  return null;
}

function matchesKeyword(service, keyword) {
  if (!keyword) return true;
  const normalizedKeyword = normalize(keyword);
  const words = normalizedKeyword.split(/\s+/).filter(Boolean);
  const categorySignal = extractCategorySignal(words);
  const haystack = normalize(service.item);
  const haystackWords = haystack.split(/\s+/);

  if (categorySignal) {
    if (service.category !== categorySignal) return false;
    // A bare category word ("rent") still browses the whole category — but
    // if other words are present too ("bike rent"), they must actually
    // match the item, so a category word alone can't drag in every
    // unrelated record just because it shares that category (e.g. "bike
    // rent" should not return every toy library).
    const remainingWords = words.filter((word) => (SYNONYMS[word] || word) !== categorySignal);
    if (remainingWords.length === 0) return true;
    return remainingWords.some((word) => wordMatchesItem(word, haystack, haystackWords));
  }

  return words.some((word) => wordMatchesItem(word, haystack, haystackWords));
}

// The dataset itself spells the same real-world area several different ways
// ("Auckland CBD" / "Auckland Central" / "Auckland City Centre" all show up
// as literal `suburb` values), and people search using everyday terms the
// data doesn't necessarily use (e.g. "CBD"). Each group's aliases are
// interchangeable substrings — confirmed against actual addresses in the
// dataset, not guessed — so a search against any one of them also matches
// records labelled with any other member of the same group. `label` is the
// one clean option shown in the suburb dropdown for the whole group.
const SUBURB_ALIAS_GROUPS = [
  {
    label: "Auckland CBD",
    aliases: ["auckland cbd", "auckland central", "auckland city centre", "cbd"],
  },
  { label: "Point Chevalier", aliases: ["point chevalier", "pt chevalier"] },
];

function findSuburbAliasGroup(normalizedInput) {
  return SUBURB_ALIAS_GROUPS.find((group) =>
    group.aliases.some(
      (alias) => normalizedInput.includes(alias) || alias.includes(normalizedInput)
    )
  );
}

function resolveSuburbAliasGroup(normalizedInput) {
  return findSuburbAliasGroup(normalizedInput)?.aliases || [normalizedInput];
}

function matchesSuburb(service, suburb) {
  if (!suburb) return true;
  const normalizedService = normalize(service.suburb);
  const candidates = resolveSuburbAliasGroup(normalize(suburb));
  return candidates.some((candidate) => normalizedService.includes(candidate));
}

// Builds the suburb dropdown's option list from the data itself (not
// hand-maintained) — one clean entry per alias group, plus the raw suburb
// text for anything that isn't part of a group, so the dropdown can't ever
// offer a suburb spelling the data doesn't actually have.
function buildSuburbOptions(services) {
  const labelByKey = new Map();
  for (const service of services) {
    const raw = (service.suburb || "").trim();
    if (!raw) continue;
    const normalized = normalize(raw);
    const group = findSuburbAliasGroup(normalized);
    const key = group ? group.label : normalized;
    if (!labelByKey.has(key)) labelByKey.set(key, group ? group.label : raw);
  }
  return Array.from(labelByKey.values()).sort((a, b) => a.localeCompare(b));
}

function matchesCategory(service, category) {
  if (category === "all") return true;
  return service.category === category;
}

function buildFallbackQuery(keyword, suburb) {
  return [keyword, suburb]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ");
}

function resolveCategoryFromKeyword(keyword) {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return null;
  return extractCategorySignal(normalizedKeyword.split(/\s+/).filter(Boolean));
}

export default function Explorer({ services }) {
  const [keyword, setKeyword] = useState("");
  const [suburb, setSuburb] = useState("");
  const [category, setCategory] = useState("all");
  const [userLocation, setUserLocation] = useState(null);
  const [locateStatus, setLocateStatus] = useState("idle"); // idle | locating | done | denied | unsupported
  const [mapAvailable, setMapAvailable] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);

  const suburbOptions = useMemo(() => buildSuburbOptions(services), [services]);

  const filtered = useMemo(() => {
    let list = services.filter(
      (service) =>
        matchesKeyword(service, keyword) &&
        matchesSuburb(service, suburb) &&
        matchesCategory(service, category)
    );

    // Near-me distance is a stronger, more explicit signal than keyword
    // relevance, so only rank by category match when the user hasn't asked
    // to sort by distance.
    const keywordCategory = resolveCategoryFromKeyword(keyword);
    if (keywordCategory && !userLocation) {
      list = [...list].sort((a, b) => {
        const aExact = a.category === keywordCategory ? 0 : 1;
        const bExact = b.category === keywordCategory ? 0 : 1;
        return aExact - bExact;
      });
    }

    if (userLocation) {
      list = list
        .map((service) => ({
          ...service,
          distanceKm: haversineDistanceKm(
            userLocation.lat,
            userLocation.lng,
            service.lat,
            service.lng
          ),
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm);
    }

    return list;
  }, [services, keyword, suburb, category, userLocation]);

  // Shown once, on the first time the user actually starts searching —
  // not an automatic browser permission popup on page load, which tends to
  // get reflexively dismissed/denied when there's no context for why it's
  // asking. "Find near me" itself still works at any time without this.
  const triggerLocationPrompt = useCallback(() => {
    if (!locationPromptDismissed && locateStatus === "idle") {
      setLocationPromptVisible(true);
    }
  }, [locationPromptDismissed, locateStatus]);

  const dismissLocationPrompt = useCallback(() => {
    setLocationPromptVisible(false);
    setLocationPromptDismissed(true);
  }, []);

  const findNearMe = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setLocateStatus("unsupported");
      return;
    }

    setLocateStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setLocateStatus("done");
      },
      () => {
        // Permission denied, unavailable, or timed out — fall back to
        // manual suburb/keyword search rather than blocking the page.
        setLocateStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  // If the user triggers "Find near me" directly, the contextual prompt (if
  // still showing) is now redundant — drop it rather than leaving it
  // sitting on screen alongside a location that's already being resolved.
  useEffect(() => {
    if (locateStatus !== "idle") {
      setLocationPromptVisible(false);
    }
  }, [locateStatus]);

  const handleMapUnavailable = useCallback(() => {
    setMapAvailable(false);
  }, []);

  const viewOnMap = useCallback((id) => {
    setSelectedId(id);
    document.getElementById("map-region")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const resetFilters = useCallback(() => {
    setKeyword("");
    setSuburb("");
    setCategory("all");
  }, []);

  const hasActiveFilters = keyword !== "" || suburb !== "" || category !== "all";

  return (
    <section>
      <div className="filter-bar">
      <form className="search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Item
          <input
            type="text"
            placeholder="e.g. bicycle, drill, coat"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              triggerLocationPrompt();
            }}
          />
        </label>
        <label>
          Suburb
          <select
            value={suburb}
            onChange={(e) => {
              setSuburb(e.target.value);
              triggerLocationPrompt();
            }}
          >
            <option value="">All suburbs</option>
            {suburbOptions.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={findNearMe} disabled={locateStatus === "locating"}>
          {locateStatus === "locating" ? "Locating..." : "Find near me"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={resetFilters}
          disabled={!hasActiveFilters}
        >
          Clear filters
        </button>
      </form>

      {locationPromptVisible && (
        <div className="location-prompt">
          <span>
            📍 Find your lifestyle nearby — enable location for the best experience.
          </span>
          <button type="button" onClick={() => { dismissLocationPrompt(); findNearMe(); }}>
            Enable location
          </button>
          <button type="button" className="link-button" onClick={dismissLocationPrompt}>
            No thanks
          </button>
        </div>
      )}
      </div>

      {locateStatus === "unsupported" && (
        <p className="status-note">
          Location isn&apos;t available in this browser/context. Use the suburb search instead.
        </p>
      )}
      {locateStatus === "denied" && (
        <p className="status-note">
          Couldn&apos;t get your location (permission declined, unsupported, or timed out).
          Use the suburb search instead.
        </p>
      )}
      {locateStatus === "done" && (
        <p className="status-note">Showing results sorted by distance from you.</p>
      )}

      {ENABLE_MAP && (
        <div className="map-region" id="map-region">
          {mapAvailable ? (
            <MapView
              results={filtered}
              userLocation={userLocation}
              onUnavailable={handleMapUnavailable}
              selectedId={selectedId}
              onSelectResult={setSelectedId}
            />
          ) : (
            <p className="status-note">
              Map is currently unavailable (offline or blocked) — showing the list below instead.
            </p>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>
            No matches for this combination — not necessarily nothing
            nearby. Try adjusting your search, or clear filters below.
          </p>
          <button type="button" className="link-button" onClick={resetFilters}>
            Clear all filters
          </button>
          <GoogleFallback
            query={buildFallbackQuery(keyword, suburb)}
            userLocation={userLocation}
          />
        </div>
      ) : (
        <ResultsList
          results={filtered}
          onViewOnMap={ENABLE_MAP ? viewOnMap : null}
          userLocation={userLocation}
        />
      )}
    </section>
  );
}
