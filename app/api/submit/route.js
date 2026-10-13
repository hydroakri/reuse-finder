import { promises as fs } from "node:fs";
import path from "node:path";

// M4: self-hosted submission intake. Deliberately NOT part of the offline
// static export — provider self-corrections/new listings only make sense
// when the site is live, and Charter excludes an account system, so this is
// the only place any "write" happens. Submissions never touch
// data/services.json directly; a human reviews data/pending_submissions.json
// and merges approved entries by hand (pre-moderation, see plan doc).

const PENDING_FILE = path.join(process.cwd(), "data", "pending_submissions.json");
// SCRUM-78: an opt-in second path. A submitter can choose to skip the
// review queue and have their listing show immediately -- but it never
// touches services.json or the pending-review queue; it lands in its own
// file, kept separate at every layer (Explorer.js renders it in its own
// clearly-labelled "unverified, from the community" section, never blended
// into the main verified results) so the rest of the app's "our data is
// manually verified" claim stays true for everything except this one
// explicitly-labelled section.
const COMMUNITY_FILE = path.join(process.cwd(), "data", "community_listings.json");
const REQUIRED_FIELDS = ["item", "category", "suburb", "source", "source_url"];
const VALID_CATEGORIES = ["repair", "borrow", "rent", "used"];

async function readJsonArray(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
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

  // Optional (SCRUM-74) -- only validated if actually provided.
  let imageUrl = "";
  if (typeof body.image_url === "string" && body.image_url.trim() !== "") {
    try {
      const parsedImageUrl = new URL(body.image_url.trim());
      if (!["http:", "https:"].includes(parsedImageUrl.protocol)) {
        throw new Error("unsupported protocol");
      }
      imageUrl = body.image_url.trim();
    } catch {
      return Response.json(
        { error: "image_url must be a valid http:// or https:// URL." },
        { status: 400 }
      );
    }
  }

  const publishUnverified = body.publish_unverified === true;
  const idPrefix = publishUnverified ? "community" : "pending";

  const submission = {
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    item: body.item.trim(),
    category: body.category,
    suburb: body.suburb.trim(),
    source: body.source.trim(),
    source_url: body.source_url.trim(),
    notes: typeof body.notes === "string" ? body.notes.trim() : "",
    image_url: imageUrl,
    contact: typeof body.contact === "string" ? body.contact.trim() : "",
    submitter_contact:
      typeof body.submitter_contact === "string" ? body.submitter_contact.trim() : "",
    status: publishUnverified ? "unverified-community" : "pending_review",
    submitted_at: new Date().toISOString(),
  };

  const targetFile = publishUnverified ? COMMUNITY_FILE : PENDING_FILE;
  const list = await readJsonArray(targetFile);
  list.push(submission);

  // Note: simple read-modify-write, no file locking. Acceptable at this
  // project's expected submission volume (a handful of manual reviews per
  // iteration); revisit if that assumption stops holding.
  await fs.writeFile(targetFile, JSON.stringify(list, null, 2) + "\n", "utf8");

  return Response.json({ ok: true });
}
