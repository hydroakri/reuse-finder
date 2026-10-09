"use client";

import { useMemo, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import ResultsList from "./ResultsList";
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

  if (categorySignal) {
    if (service.category !== categorySignal) return false;
    // A bare category word ("rent") still browses the whole category — but
    // if other words are present too ("bike rent"), they must actually
    // match the item, so a category word alone can't drag in every
    // unrelated record just because it shares that category (e.g. "bike
    // rent" should not return every toy library).
    const remainingWords = words.filter((word) => (SYNONYMS[word] || word) !== categorySignal);
    if (remainingWords.length === 0) return true;
    return remainingWords.some((word) => haystack.includes(word));
  }

  return haystack.includes(normalizedKeyword);
}

// The dataset itself spells the same real-world area several different ways
// ("Auckland CBD" / "Auckland Central" / "Auckland City Centre" all show up
// as literal `suburb` values), and people search using everyday terms the
// data doesn't necessarily use (e.g. "CBD"). Each group below is a set of
// interchangeable substrings — confirmed against actual addresses in the
// dataset, not guessed — so a search against any one of them also matches
// records labelled with any other member of the same group.
const SUBURB_ALIAS_GROUPS = [
  ["auckland cbd", "auckland central", "auckland city centre", "cbd"],
  ["point chevalier", "pt chevalier"],
];

function resolveSuburbAliasGroup(normalizedInput) {
  return (
    SUBURB_ALIAS_GROUPS.find((group) =>
      group.some(
        (alias) => normalizedInput.includes(alias) || alias.includes(normalizedInput)
      )
    ) || [normalizedInput]
  );
}

function matchesSuburb(service, suburb) {
  if (!suburb) return true;
  const normalizedService = normalize(service.suburb);
  const candidates = resolveSuburbAliasGroup(normalize(suburb));
  return candidates.some((candidate) => normalizedService.includes(candidate));
}

function matchesCategory(service, category) {
  if (category === "all") return true;
  return service.category === category;
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

  const handleMapUnavailable = useCallback(() => {
    setMapAvailable(false);
  }, []);

  const resetFilters = useCallback(() => {
    setKeyword("");
    setSuburb("");
    setCategory("all");
  }, []);

  const hasActiveFilters = keyword !== "" || suburb !== "" || category !== "all";

  return (
    <section>
      <form className="search-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Item
          <input
            type="text"
            placeholder="e.g. bicycle, drill, coat"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </label>
        <label>
          Suburb
          <input
            type="text"
            placeholder="e.g. Ponsonby"
            value={suburb}
            onChange={(e) => setSuburb(e.target.value)}
          />
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
        <div className="map-region">
          {mapAvailable ? (
            <MapView
              results={filtered}
              userLocation={userLocation}
              onUnavailable={handleMapUnavailable}
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
            No matches for this search. We currently cover repair, borrow,
            rental and used-purchase options mostly around Auckland CBD,
            Grafton and nearby suburbs, plus a separate Event category you
            can browse by selecting it directly — an empty list here doesn&apos;t
            mean there&apos;s nothing nearby, just nothing matching this exact
            combination.
          </p>
          <button type="button" className="link-button" onClick={resetFilters}>
            Clear all filters
          </button>
        </div>
      ) : (
        <ResultsList results={filtered} />
      )}
    </section>
  );
}
