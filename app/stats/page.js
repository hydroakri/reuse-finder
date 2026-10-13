import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";

// SCRUM-77: internal-only view of the aggregate page-load counter --
// data/usage_stats.json has no per-visitor identity in it to begin with
// (see /api/track-visit), so this page is just a plain read of that file.
// No auth system exists in this app (same as /submit), so this is
// unauthenticated like every other route -- linked from the page footer as
// "Usage stats (internal)" but not actually access-restricted. Fine for a
// course prototype; flag before relying on it with real public traffic.
//
// Read at request time (not a static import) and marked force-dynamic --
// a static import gets inlined at build time, which would freeze this page
// at whatever the counter said when `next build` ran instead of showing
// live numbers.
export const dynamic = "force-dynamic";

async function readUsageStats() {
  const filePath = path.join(process.cwd(), "data", "usage_stats.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { totalVisits: 0, byDate: {} };
  }
}

export default async function StatsPage() {
  const usageStats = await readUsageStats();
  const dates = Object.keys(usageStats.byDate).sort().reverse();

  return (
    <main className="page">
      <p>
        <Link href="/">&larr; Back to search</Link>
      </p>
      <header className="page-header">
        <h1>Usage stats</h1>
        <p>
          Aggregate page-load count only -- no cookies, no IP/user-agent
          storage, no per-visitor identity. Internal team view.
        </p>
      </header>

      <p className="stats-total">
        <strong>{usageStats.totalVisits}</strong> total page load
        {usageStats.totalVisits === 1 ? "" : "s"} recorded.
      </p>

      {dates.length === 0 ? (
        <p className="status-note">No visits recorded yet.</p>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Visits</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => (
              <tr key={date}>
                <td>{date}</td>
                <td>{usageStats.byDate[date]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
