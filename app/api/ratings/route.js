import { promises as fs } from "node:fs";
import path from "node:path";

// SCRUM-54: ratings and reviews -- these are real, user-submitted data
// (collected from actual app users through this route), never pre-filled or
// fabricated content about any business. Same plain-JSON read-modify-write
// pattern as /api/submit. Not pre-moderated like listing submissions --
// publishing a rating instantly is the point of the feature (see
// SCRUM-54/78 discussion), but each rating is tied to an existing
// services.json id, not a free-text claim about a new place.

const RATINGS_FILE = path.join(process.cwd(), "data", "ratings.json");
const MIN_RATING = 1;
const MAX_RATING = 5;
const MAX_COMMENT_LENGTH = 500;

async function readRatings() {
  try {
    const raw = await fs.readFile(RATINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function aggregate(ratings, serviceId) {
  const forService = ratings.filter((r) => r.serviceId === serviceId);
  const count = forService.length;
  const average = count === 0 ? null : forService.reduce((sum, r) => sum + r.rating, 0) / count;
  return { serviceId, average, count };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
  const rating = Number(body.rating);

  if (!serviceId) {
    return Response.json({ error: "Missing serviceId." }, { status: 400 });
  }
  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    return Response.json(
      { error: `rating must be an integer from ${MIN_RATING} to ${MAX_RATING}.` },
      { status: 400 }
    );
  }

  const comment =
    typeof body.comment === "string" ? body.comment.trim().slice(0, MAX_COMMENT_LENGTH) : "";

  const ratings = await readRatings();
  ratings.push({
    id: `rating-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    serviceId,
    rating,
    comment,
    submitted_at: new Date().toISOString(),
  });

  // Note: simple read-modify-write, no file locking -- same accepted
  // tradeoff as /api/submit at this project's traffic volume.
  await fs.writeFile(RATINGS_FILE, JSON.stringify(ratings, null, 2) + "\n", "utf8");

  return Response.json(aggregate(ratings, serviceId));
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const serviceId = searchParams.get("serviceId");
  const ratings = await readRatings();

  if (serviceId) {
    return Response.json(aggregate(ratings, serviceId));
  }

  const byService = new Map();
  for (const r of ratings) {
    if (!byService.has(r.serviceId)) byService.set(r.serviceId, []);
    byService.get(r.serviceId).push(r);
  }
  const all = Array.from(byService.keys()).map((id) => aggregate(ratings, id));
  return Response.json({ services: all });
}
