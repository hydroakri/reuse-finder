"use client";

import { useEffect, useState } from "react";

// Only ever rendered from the empty-state (Explorer already confirmed our
// own data has zero matches) — "our data first, Google only as a last
// resort" holds regardless of how often this fires, since it can't fire any
// other way. Results render inline, clearly labelled as unverified, instead
// of sending the user away to a separate Google tab.
export default function GoogleFallback({ query }) {
  const [state, setState] = useState({ status: "idle" });

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return undefined;
    }

    let cancelled = false;
    setState({ status: "loading" });

    fetch(`/api/google-fallback?q=${encodeURIComponent(query)}`)
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
  }, [query]);

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
        <ul className="google-fallback-list">
          {state.results.map((result) => (
            <li key={result.url}>
              <a href={result.url} target="_blank" rel="noopener noreferrer">
                {result.name}
              </a>
              {result.address && <span className="result-address"> — {result.address}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
