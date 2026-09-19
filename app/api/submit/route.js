import { promises as fs } from "node:fs";
import path from "node:path";

// M4: self-hosted submission intake. Deliberately NOT part of the offline
// static export — provider self-corrections/new listings only make sense
// when the site is live, and Charter excludes an account system, so this is
// the only place any "write" happens. Submissions never touch
// data/services.json directly; a human reviews data/pending_submissions.json
// and merges approved entries by hand (pre-moderation, see plan doc).

const PENDING_FILE = path.join(process.cwd(), "data", "pending_submissions.json");
const REQUIRED_FIELDS = ["item", "category", "suburb", "source", "source_url"];
const VALID_CATEGORIES = ["repair", "borrow", "rent", "used"];

async function readPending() {
  try {
    const raw = await fs.readFile(PENDING_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Honeypot: a hidden field real users never see or fill in. If it's
  // populated, silently pretend success so the bot doesn't learn to adapt,
  // but never persist the submission.
  if (body.company_website) {
    return Response.json({ ok: true });
  }

  const missing = REQUIRED_FIELDS.filter(
    (field) => typeof body[field] !== "string" || body[field].trim() === ""
  );
  if (missing.length > 0) {
    return Response.json(
      { error: `Missing required field(s): ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  if (!VALID_CATEGORIES.includes(body.category)) {
    return Response.json(
      { error: `Category must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const parsedUrl = new URL(body.source_url.trim());
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("unsupported protocol");
    }
  } catch {
    return Response.json(
      { error: "source_url must be a valid http:// or https:// URL." },
      { status: 400 }
    );
  }

  const submission = {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    item: body.item.trim(),
    category: body.category,
    suburb: body.suburb.trim(),
    source: body.source.trim(),
    source_url: body.source_url.trim(),
    notes: typeof body.notes === "string" ? body.notes.trim() : "",
    submitter_contact:
      typeof body.submitter_contact === "string" ? body.submitter_contact.trim() : "",
    status: "pending_review",
    submitted_at: new Date().toISOString(),
  };

  const pending = await readPending();
  pending.push(submission);

  // Note: simple read-modify-write, no file locking. Acceptable at this
  // project's expected submission volume (a handful of manual reviews per
  // iteration); revisit if that assumption stops holding.
  await fs.writeFile(PENDING_FILE, JSON.stringify(pending, null, 2) + "\n", "utf8");

  return Response.json({ ok: true });
}
