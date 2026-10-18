"use client";

import { useEffect, useState } from "react";

// SCRUM-54: per-card rating display + submission. Each card owns its own
// fetch/state so ResultsList doesn't need to know about ratings at all.
export default function RatingWidget({ serviceId }) {
  const [aggregate, setAggregate] = useState(null); // { average, count } | null while loading
  const [formOpen, setFormOpen] = useState(false);
  const [pendingRating, setPendingRating] = useState(0);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("idle"); // idle | submitting | error

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ratings?serviceId=${encodeURIComponent(serviceId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAggregate(data);
      })
      .catch(() => {
        if (!cancelled) setAggregate({ average: null, count: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  async function submitRating() {
    if (pendingRating < 1) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId, rating: pendingRating, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit rating.");
      setAggregate(data);
      setFormOpen(false);
      setPendingRating(0);
      setComment("");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="rating-widget">
      <span className="rating-summary">
        {aggregate?.googleOnly
          ? `★ ${aggregate.average.toFixed(1)} (Google rating, ${aggregate.googleCount} review${aggregate.googleCount === 1 ? "" : "s"} -- no ratings here yet)`
          : aggregate?.count > 0
            ? `★ ${aggregate.average.toFixed(1)} (${aggregate.count} rating${aggregate.count === 1 ? "" : "s"}${
                aggregate.googleBlended ? `, incl. ${aggregate.googleCount} from Google` : ""
              })`
            : "No ratings yet"}
      </span>
      {!formOpen ? (
        <button type="button" className="link-button" onClick={() => setFormOpen(true)}>
          Rate this
        </button>
      ) : (
        <div className="rating-form">
          <div className="rating-stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`rating-star${n <= pendingRating ? " rating-star-filled" : ""}`}
                aria-label={`${n} star${n === 1 ? "" : "s"}`}
                onClick={() => setPendingRating(n)}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            placeholder="Optional comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="rating-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={submitRating}
              disabled={pendingRating < 1 || status === "submitting"}
            >
              {status === "submitting" ? "Submitting..." : "Submit"}
            </button>
            <button type="button" className="link-button" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
          {status === "error" && (
            <p className="status-note status-error">Couldn&apos;t submit — try again.</p>
          )}
        </div>
      )}
    </div>
  );
}
