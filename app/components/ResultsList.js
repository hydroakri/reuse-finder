"use client";

const CATEGORY_LABELS = {
  repair: "Repair",
  borrow: "Borrow",
  rent: "Rent",
  used: "Used purchase",
};

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

export default function ResultsList({ results }) {
  if (results.length === 0) {
    return (
      <p className="empty-state">
        No matches. Try a different item, suburb, or category.
      </p>
    );
  }

  return (
    <ul className="results-list">
      {results.map((result) => (
        <li key={result.id} className="result-card">
          <div className="result-card-header">
            <span className={`category-tag category-${result.category}`}>
              {CATEGORY_LABELS[result.category] ?? result.category}
            </span>
            {typeof result.distanceKm === "number" && (
              <span className="distance-tag">
                {result.distanceKm.toFixed(1)} km away
              </span>
            )}
          </div>
          <h3>{result.item}</h3>
          <p className="result-suburb">{result.suburb}</p>

          <dl className="result-conditions">
            {result.conditions?.hours && (
              <>
                <dt>Hours</dt>
                <dd>{result.conditions.hours}</dd>
              </>
            )}
            {result.conditions?.fee && (
              <>
                <dt>Fee</dt>
                <dd>{result.conditions.fee}</dd>
              </>
            )}
            {result.conditions?.eligibility && (
              <>
                <dt>Eligibility</dt>
                <dd>{result.conditions.eligibility}</dd>
              </>
            )}
            {result.conditions?.membership && (
              <>
                <dt>Membership</dt>
                <dd>{result.conditions.membership}</dd>
              </>
            )}
            {result.conditions?.dropoff_pickup && (
              <>
                <dt>Drop-off / pickup</dt>
                <dd>{result.conditions.dropoff_pickup}</dd>
              </>
            )}
          </dl>

          <p className="result-provenance">
            Source: {result.source || "unknown"} &middot; Status:{" "}
            {result.status || "unknown"} &middot; Checked:{" "}
            {result.checked_date || "unknown"}
          </p>

          {safeExternalUrl(result.source_url) && (
            <a
              className="result-link"
              href={safeExternalUrl(result.source_url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View original source &rarr;
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
