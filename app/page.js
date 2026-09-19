import Link from "next/link";
import Explorer from "./components/Explorer";
import servicesData from "../data/services.json";

// Server Component: data is read from the single source-of-truth JSON file
// at build/request time. All interactivity (search, filter, map) lives in
// the Explorer client component below.
export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Auckland Reuse Finder</h1>
        <p>
          Compare nearby repair, borrow, rental and used-purchase options for
          household items in Auckland.
        </p>
        <p>
          <Link href="/submit">Suggest a listing &rarr;</Link>
        </p>
      </header>
      <Explorer services={servicesData} />
    </main>
  );
}
