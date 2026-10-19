import { promises as fs } from "node:fs";
import path from "node:path";
import Link from "next/link";
import Explorer from "./components/Explorer";
import servicesData from "../data/services.json";

// services.json has no runtime write path (manually curated, changes only
// via a rebuild), so a static import is fine for it. community_listings.json
// does have a runtime writer (app/api/submit/route.js) -- a static import
// of that file gets inlined at `npm run build` time same as the bug
// documented in app/stats/page.js, so it's read at request time instead and
// this route is marked force-dynamic so Next doesn't cache a stale render.
export const dynamic = "force-dynamic";

async function readCommunityListings() {
  const filePath = path.join(process.cwd(), "data", "community_listings.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Server Component: data is read from the single source-of-truth JSON file
// at build/request time. All interactivity (search, filter, map) lives in
// the Explorer client component below.
export default async function Home() {
  const communityListingsData = await readCommunityListings();

  return (
    <main className="page">
      <header className="page-header">
        <h1>Auckland Reuse Finder</h1>
        <p>
          Find nearby repair, borrow, rental and used-purchase options for
          household items in Auckland — not a price comparison, just a way
          to see what&apos;s available near you.
        </p>
        <p className="page-subnote">
          &quot;Repair&quot; covers both volunteer-run repair cafés (usually
          free or koha-based, limited hours) and commercial repair shops
          (paid, regular hours) — check each listing&apos;s fee and hours
          before you go.
        </p>
        <p>
          <Link href="/submit">Suggest a listing &rarr;</Link>
        </p>
      </header>
      <Explorer services={servicesData} communityListings={communityListingsData} />
      <footer className="page-footer">
        <p>
          Event listings are compiled from{" "}
          <a href="https://theaucklandbagel.com" target="_blank" rel="noopener noreferrer">
            The Auckland Bagel
          </a>
          , an independent Auckland events newsletter. Descriptions here are
          our own summaries, not reproduced from their newsletter.
        </p>
        <p>
          <Link href="/stats">Usage stats (internal)</Link>
        </p>
      </footer>
    </main>
  );
}
