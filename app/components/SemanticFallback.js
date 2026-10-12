"use client";

import { useEffect } from "react";
import { haversineDistanceKm } from "../../lib/geo";

// Only ever rendered from the empty-state (Explorer already confirmed exact
// keyword/synonym matching found nothing) — fetches which of OUR OWN
// services semantically match the query, resolves those ids back against
// the full dataset already in the browser, and reports the resolved records
// up via onResultsChange so Explorer can render them through the normal
// ResultsList/MapView (these are our own verified data, just reached via
// looser matching — not external/unverified like the Google fallback, so no
// separate card UI or distinct pin colour).
//
// matchesSuburb/matchesCategory are passed in from Explorer rather than
// reimplemented here, so a semantic match still respects whatever
// suburb/category filter the user has active.
export default function SemanticFallback({
  query,
  services,
  userLocation,
  matchesSuburb,
  matchesCategory,
  suburb,
  category,
  onResultsChange,
  onStatusChange,
}) {
  useEffect(() => {
    if (!query) {
      onStatusChange?.("idle");
      onResultsChange?.([]);
      return undefined;
    }

    let cancelled = false;
    onStatusChange?.("loading");

    fetch(`/api/semantic-search?${new URLSearchParams({ q: query }).toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.available || !data.matches?.length) {
          onStatusChange?.("done");
          onResultsChange?.([]);
          return;
        }

        const byId = new Map(services.map((service) => [service.id, service]));
        let resolved = data.matches
          .map((match) => byId.get(match.id))
          .filter(Boolean)
          .filter((service) => matchesSuburb(service, suburb) && matchesCategory(service, category));

        if (userLocation) {
          resolved = resolved
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

        onStatusChange?.("done");
        onResultsChange?.(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          onStatusChange?.("error");
          onResultsChange?.([]);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, suburb, category, userLocation]);

  return null;
}
