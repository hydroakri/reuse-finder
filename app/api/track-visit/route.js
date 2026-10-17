import { promises as fs } from "node:fs";
import path from "node:path";

// SCRUM-77: "how many customers are using the tool" -- the minimal,
// privacy-respecting answer: an aggregate daily page-load counter. No
// cookies, no IP/user-agent storage, no per-visitor identity at all -- just
// a running total, so this can't be used to track or re-identify anyone.
// Same plain-JSON read-modify-write pattern as /api/submit.

const STATS_FILE = path.join(process.cwd(), "data", "usage_stats.json");

async function readStats() {
  try {
    const raw = await fs.readFile(STATS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      totalVisits: typeof parsed.totalVisits === "number" ? parsed.totalVisits : 0,
      byDate: typeof parsed.byDate === "object" && parsed.byDate !== null ? parsed.byDate : {},
    };
  } catch {
    return { totalVisits: 0, byDate: {} };
  }
}

export async function POST() {
  const stats = await readStats();
  const today = new Date().toISOString().slice(0, 10);

  stats.totalVisits += 1;
  stats.byDate[today] = (stats.byDate[today] || 0) + 1;

  // Note: simple read-modify-write, no file locking -- same accepted
  // tradeoff as /api/submit at this project's traffic volume.
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2) + "\n", "utf8");

  return Response.json({ ok: true });
}

export async function GET() {
  const stats = await readStats();
  return Response.json(stats);
}
