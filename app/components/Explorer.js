"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import ResultsList from "./ResultsList";
import GoogleFallback from "./GoogleFallback";
import SemanticFallback from "./SemanticFallback";
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

// A number of real venues legitimately offer more than one category of
// service (e.g. a hub that both lends and repairs bikes) and are stored as
// one record per category -- same item/address/notes/conditions, only
// `category` differs (confirmed: identical content across every
// multi-category venue in the dataset). Shown separately under "All
// categories" that reads as duplicate listings of the same place. This is a
// display-only merge, applied after filtering/sorting/ranking -- it never
// touches matchesCategory or any search logic above, which still operates
// on the original flat per-category records.
function groupResultsByVenue(results) {
  const order = [];
  const groups = new Map();
  for (const result of results) {
    const key = `${result.item}|${result.address || result.suburb}`;
    if (!groups.has(key)) {
      order.push(key);
      groups.set(key, { ...result, categories: [] });
    }
    const group = groups.get(key);
    if (!group.categories.includes(result.category)) {
      group.categories.push(result.category);
    }
  }
  return order.map((key) => groups.get(key));
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

export default function Explorer({ services, communityListings = [] }) {
  const [keyword, setKeyword] = useState("");
  const [suburb, setSuburb] = useState("");
  const [category, setCategory] = useState("all");
  const [userLocation, setUserLocation] = useState(null);
  const [locateStatus, setLocateStatus] = useState("idle"); // idle | locating | done | denied | unsupported
  const [mapAvailable, setMapAvailable] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
  const [googleResults, setGoogleResults] = useState([]);
  const [semanticResults, setSemanticResults] = useState([]);
  const [semanticStatus, setSemanticStatus] = useState("idle");
  // SCRUM-73: manual opt-in to blend live Google results alongside our own
  // at all times, not just on an empty search. Off by default (the ticket's
  // own wording — "manually switch on and off" — implies opt-in, and it
  // keeps the established "our data first" default behaviour unchanged for
  // anyone who never touches the toggle). Persisted so a user who turns it
  // on doesn't have to redo it every page load.
  const [alwaysShowGoogle, setAlwaysShowGoogle] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("alwaysShowGoogle");
    if (stored === "true") setAlwaysShowGoogle(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("alwaysShowGoogle", String(alwaysShowGoogle));
  }, [alwaysShowGoogle]);

  // SCRUM-77: aggregate page-load counter only -- no cookies, no per-visitor
  // identity, nothing that could re-identify anyone. Fire-and-forget; a
  // failure here should never affect the page.
  useEffect(() => {
    fetch("/api/track-visit", { method: "POST" }).catch(() => {});
  }, []);

  const suburbOptions = useMemo(() => buildSuburbOptions(services), [services]);

  // SCRUM-78: community-submitted listings that skipped the review queue.
  // Filtered with the exact same functions as our own data so searching
  // behaves consistently, but kept in a separate array/section -- never
  // merged into `filtered`/`displayResults` -- so the main results list
  // stays strictly our manually-verified data.
  const matchingCommunityListings = useMemo(
    () =>
      communityListings.filter(
        (listing) =>
          matchesKeyword(listing, keyword) &&
          matchesSuburb(listing, suburb) &&
          matchesCategory(listing, category)
      ),
    [communityListings, keyword, suburb, category]
  );

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

  // 3-tier waterfall: exact/synonym/typo match (filtered) -> semantic match
  // over our own data -> Google Places live fallback, each tier only
  // consulted if the one before it found nothing. Semantic ranks over our
  // own verified data, so it's tried before Google per the project's
  // "our data first" principle.
  const displayResults = filtered.length > 0 ? filtered : semanticResults;
  // Merged for rendering only -- every check above (empty-state, semantic
  // fallback, Google fallback triggers) stays based on the raw per-category
  // counts, so this has no effect on search/ranking behaviour.
  const groupedDisplayResults = useMemo(() => groupResultsByVenue(displayResults), [displayResults]);
  const showingSemanticResults = filtered.length === 0 && semanticResults.length > 0;
  const showGoogleFallback =
    filtered.length === 0 &&
    semanticResults.length === 0 &&
    (semanticStatus === "done" || semanticStatus === "error" || semanticStatus === "idle");
  // SCRUM-73: the toggle overrides the empty-only trigger above and queries
  // Google regardless of whether we already have our own results.
  const googleQuery =
    alwaysShowGoogle || showGoogleFallback ? buildFallbackQuery(keyword, suburb) : "";

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

      <label className="google-toggle">
        <input
          type="checkbox"
          checked={alwaysShowGoogle}
          onChange={(e) => setAlwaysShowGoogle(e.target.checked)}
        />
        Always show Google results alongside ours (unverified)
      </label>

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
              results={groupedDisplayResults}
              googleResults={googleResults}
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

      <SemanticFallback
        query={filtered.length === 0 ? keyword : ""}
        services={services}
        userLocation={userLocation}
        matchesSuburb={matchesSuburb}
        matchesCategory={matchesCategory}
        suburb={suburb}
        category={category}
        onResultsChange={setSemanticResults}
        onStatusChange={setSemanticStatus}
      />

      {displayResults.length === 0 ? (
        <div className="empty-state">
          <p>
            No matches for this combination — not necessarily nothing
            nearby. Try adjusting your search, or clear filters below.
          </p>
          <button type="button" className="link-button" onClick={resetFilters}>
            Clear all filters
          </button>
          {semanticStatus === "loading" && (
            <p className="status-note">Searching for broader matches…</p>
          )}
        </div>
      ) : (
        <>
          {showingSemanticResults && (
            <p className="status-note">
              No exact matches — showing broader matches based on meaning.
            </p>
          )}
          <ResultsList
            results={groupedDisplayResults}
            onViewOnMap={ENABLE_MAP ? viewOnMap : null}
            userLocation={userLocation}
          />
        </>
      )}

      {/* SCRUM-73: renders below either branch above — our own results (or
          the empty-state) always come first, Google's stay a visually
          distinct second section rather than being interleaved into the
          same list. GoogleFallback no-ops (returns null) whenever
          googleQuery is empty, so this is a no-op unless the toggle is on
          or the old empty-only trigger fired. */}
      <GoogleFallback
        query={googleQuery}
        userLocation={userLocation}
        onResultsChange={setGoogleResults}
      />

      {/* SCRUM-78: community-submitted listings that skipped review — kept
          in their own clearly-labelled section below everything else,
          same separation principle as the Google section above. */}
      {matchingCommunityListings.length > 0 && (
        <div className="community-listings">
          <p className="status-note">
            ⚠️ Community-submitted listings below — not reviewed by our team.
          </p>
          <ResultsList results={matchingCommunityListings} userLocation={userLocation} />
        </div>
      )}
    </section>
  );
}
