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

function matchesKeyword(service, keyword) {
  if (!keyword) return true;
  const normalizedKeyword = normalize(keyword);
  const resolvedKeyword = SYNONYMS[normalizedKeyword] || normalizedKeyword;
  const haystack = normalize(service.item);
  return (
    haystack.includes(normalizedKeyword) ||
    haystack.includes(resolvedKeyword) ||
    // A synonym like "hire" resolves to the category "rent" — that should
    // surface every rent listing, not just ones whose item text happens to
    // contain the word "rent".
    service.category === resolvedKeyword
  );
}

function matchesSuburb(service, suburb) {
  if (!suburb) return true;
  return normalize(service.suburb).includes(normalize(suburb));
}

function matchesCategory(service, category) {
  if (category === "all") return true;
  return service.category === category;
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

      <ResultsList results={filtered} />
    </section>
  );
}
