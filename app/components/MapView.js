"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Map, Marker, Popup, NavigationControl } from "react-map-gl/maplibre";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre GL loads its vector-tile decoding code in a Web Worker, resolved
// via `import.meta.url` relative to its own bundled chunk. Next.js/Turbopack
// doesn't preserve that relative path, so the worker silently 404s and every
// vector source just sits at isSourceLoaded:false forever (no console error,
// no failed network request even — this took real digging to track down).
// Fix: ship the worker file (and the shared chunk it imports) as static
// assets under public/, copied from node_modules/maplibre-gl/dist/
// (maplibre-gl-worker.mjs + maplibre-gl-shared.mjs), and point MapLibre at
// them explicitly before any map is constructed. Re-copy both files if
// maplibre-gl is ever upgraded.
if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre-gl-worker.mjs");
}

// OpenFreeMap: free, no API key/signup, vector tiles rendered client-side —
// chosen after CARTO's equivalent free raster tiles turned out to require a
// key (confirmed by testing, not assumed). The "liberty" style is their
// general-purpose colourful basemap, closest to the CARTO Voyager look the
// team wanted. Style/tile URLs are versioned internally by OpenFreeMap; the
// style JSON below is the only URL this app hardcodes — MapLibre resolves
// the current tile set from it at runtime, including that tileset's own
// attribution string (shown automatically, no need to hardcode it here).
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

const AUCKLAND_CENTER = { longitude: 174.7633, latitude: -36.8485 };
const ERROR_WINDOW_MS = 5000;
const ERROR_THRESHOLD = 3;

// Only render source_url as a clickable link if it's a genuine http(s) URL —
// blocks javascript:/data: pseudo-protocols from ever being clickable, in
// case bad data slips past the intake/validation checks.
function safeExternalUrl(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

// Service pins (repair/borrow/rent/used) stay green; "event" listings (e.g.
// one-off Repair Café dates pulled from a community newsletter, not an
// ongoing service) get a visually distinct colour so they don't read as
// permanent reuse options. Blue is reserved for the "you are here" pin.
const SERVICE_PIN_COLOR = "#2f6b3a";
const EVENT_PIN_COLOR = "#d9822b";
const USER_PIN_COLOR = "#1f5fb0";

function pinColorForCategory(category) {
  return category === "event" ? EVENT_PIN_COLOR : SERVICE_PIN_COLOR;
}

// Google Maps' documented directions URL: if `origin` is omitted, Google
// Maps uses the device's current location when the link is opened (asking
// for location permission itself). We still pass an explicit origin when we
// already have one from "Find near me" — avoids asking twice and keeps the
// route anchored to the point the user picked in this app.
function buildDirectionsUrl(destination, origin) {
  const params = new URLSearchParams({
    api: "1",
    destination: `${destination.lat},${destination.lng}`,
  });
  if (origin) {
    params.set("origin", `${origin.lat},${origin.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function MarkerPin({ color }) {
  return (
    <svg width="24" height="32" viewBox="0 0 24 32" style={{ cursor: "pointer", display: "block" }}>
      <path
        d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z"
        fill={color}
        stroke="#1f1f1f"
        strokeWidth="1"
      />
      <circle cx="12" cy="12" r="4.5" fill="#ffffff" />
    </svg>
  );
}

export default function MapView({ results, userLocation, onUnavailable, selectedId, onSelectResult }) {
  const mapRef = useRef(null);
  const errorTimestampsRef = useRef([]);

  // Only used for the very first paint — the fitBounds effect below takes
  // over any time the filters/location change after that.
  const initialViewState = useMemo(() => {
    if (userLocation) {
      return { longitude: userLocation.lng, latitude: userLocation.lat, zoom: 13 };
    }
    if (results.length > 0) {
      return { longitude: results[0].lng, latitude: results[0].lat, zoom: 13 };
    }
    return { ...AUCKLAND_CENTER, zoom: 12 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fully offline device (file:// demo, or wifi down) will never manage to
  // load the style/tiles — fail fast instead of showing a stuck spinner.
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      onUnavailable();
    }
  }, [onUnavailable]);

  // Watches for style/tile/glyph load failures. Only trips if several
  // happen within a short window — an isolated flaky request that recovers
  // should not permanently hide a map that's actually working.
  const handleError = useCallback(() => {
    const now = Date.now();
    const recent = errorTimestampsRef.current.filter((t) => now - t < ERROR_WINDOW_MS);
    recent.push(now);
    errorTimestampsRef.current = recent;
    if (recent.length >= ERROR_THRESHOLD) {
      onUnavailable();
    }
  }, [onUnavailable]);

  // Keeps the viewport framed around whatever is currently visible.
  // initialViewState only applies on first mount, so without this the map
  // would stay stuck on its initial view after the user changes the
  // search/suburb/category filters or locates themselves.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    const points = results.map((r) => [r.lng, r.lat]);
    if (userLocation) points.push([userLocation.lng, userLocation.lat]);

    if (points.length === 0) {
      map.easeTo({ center: [AUCKLAND_CENTER.longitude, AUCKLAND_CENTER.latitude], zoom: 12, duration: 300 });
    } else if (points.length === 1) {
      map.easeTo({ center: points[0], zoom: 14, duration: 300 });
    } else {
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 48, maxZoom: 15, duration: 300 }
      );
    }
  }, [results, userLocation]);

  // Lets a "View on map" button on a result card (outside this component)
  // jump straight to that pin, not just the viewport-fit effect above which
  // only reacts to the filtered list or user location changing.
  useEffect(() => {
    if (!selectedId) return;
    const map = mapRef.current?.getMap();
    const selected = results.find((r) => r.id === selectedId);
    if (!map || !selected) return;
    map.easeTo({ center: [selected.lng, selected.lat], zoom: 15, duration: 400 });
  }, [selectedId, results]);

  const selectedResult = results.find((r) => r.id === selectedId) || null;

  return (
    <Map
      ref={mapRef}
      initialViewState={initialViewState}
      mapStyle={MAP_STYLE}
      onError={handleError}
      style={{ width: "100%", height: 420, borderRadius: 8 }}
    >
      <NavigationControl position="top-left" />

      {results.map((result) => (
        <Marker
          key={result.id}
          longitude={result.lng}
          latitude={result.lat}
          anchor="bottom"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            onSelectResult(result.id);
          }}
        >
          <MarkerPin color={pinColorForCategory(result.category)} />
        </Marker>
      ))}

      {userLocation && (
        <Marker longitude={userLocation.lng} latitude={userLocation.lat} anchor="bottom">
          <MarkerPin color={USER_PIN_COLOR} />
        </Marker>
      )}

      {selectedResult && (
        <Popup
          longitude={selectedResult.lng}
          latitude={selectedResult.lat}
          anchor="bottom"
          offset={28}
          closeOnClick={false}
          onClose={() => onSelectResult(null)}
        >
          <strong>{selectedResult.item}</strong>
          <br />
          {selectedResult.suburb} &middot; {selectedResult.category}
          <br />
          Source: {selectedResult.source} ({selectedResult.status}, checked {selectedResult.checked_date})
          <div className="popup-actions">
            {safeExternalUrl(selectedResult.source_url) ? (
              <a
                className="popup-action-button"
                href={safeExternalUrl(selectedResult.source_url)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View source
              </a>
            ) : (
              <span>Source link unavailable</span>
            )}
            <a
              className="popup-action-button popup-action-primary"
              href={buildDirectionsUrl(selectedResult, userLocation)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Get directions
            </a>
          </div>
          <a href={`#result-${selectedResult.id}`}>View full details &darr;</a>
        </Popup>
      )}
    </Map>
  );
}
