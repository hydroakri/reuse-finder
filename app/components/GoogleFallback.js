"use client";

import { useEffect, useState } from "react";

// Only ever rendered from the empty-state (Explorer already confirmed our
// own data has zero matches) — "our data first, Google only as a last
// resort" holds regardless of how often this fires, since it can't fire any
// other way. Results render inline, clearly labelled as unverified, instead
// of sending the user away to a separate Google tab. Card markup/classes
// deliberately match ResultsList's own cards so a Google result reads as
// "the same kind of thing, different source" rather than a different UI.
export default function GoogleFallback({ query, userLocation }) {
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return undefined;
    }

    let cancelled = false;
    setState({ status: "loading" });

    const params = new URLSearchParams({ q: query });
    if (userLocation) {
      params.set("lat", userLocation.lat);
      params.set("lng", userLocation.lng);
    }

    fetch(`/api/google-fallback?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.available) {
          setState({ status: "unavailable" });
        } else if (data.error) {
          setState({ status: "error" });
        } else {
          setState({ status: "done", results: data.results });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, [query, userLocation]);

  if (state.status === "idle" || state.status === "unavailable") return null;

  return (
    <div className="google-fallback">
      <p className="status-note">
        ⚠️ Showing live results from Google — not verified by our team and may
        include commercial listings.
      </p>
      {state.status === "loading" && <p className="status-note">Searching Google...</p>}
      {state.status === "error" && (
        <p className="status-note">Couldn&apos;t reach Google — try again later.</p>
      )}
      {state.status === "done" && state.results.length === 0 && (
        <p className="status-note">No results from Google either.</p>
      )}
      {state.status === "done" && state.results.length > 0 && (
        <ul className="results-list">
          {state.results.map((result) => (
            <li key={result.url} className="result-card">
              <div className="result-card-header">
                <span className="category-tag category-google">From Google</span>
                {typeof result.distanceKm === "number" && (
                  <span className="distance-tag">{result.distanceKm.toFixed(1)} km away</span>
                )}
              </div>
              <h3>{result.name}</h3>
              {result.address && <p className="result-address">{result.address}</p>}
              <dl className="result-conditions">
                {result.price && (
                  <>
                    <dt>Price</dt>
                    <dd>{result.price}</dd>
                  </>
                )}
                {typeof result.openNow === "boolean" && (
                  <>
                    <dt>Status</dt>
                    <dd>{result.openNow ? "Open now" : "Closed now"}</dd>
                  </>
                )}
              </dl>
              <a className="result-link" href={result.url} target="_blank" rel="noopener noreferrer">
                View on Google &rarr;
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
