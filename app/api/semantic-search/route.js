// Server-side semantic fallback — only ever called when the client's own
// exact/synonym/typo matching (Explorer.js) already came up empty. Ranks
// over OUR OWN services.json data (not external), so it's tried before the
// Google fallback, matching the project's "our data first" principle.
//
// Model and embeddings stay entirely server-side: the client never gets
// anything heavier than a list of {id, score} pairs, resolved back against
// the full dataset it already has (app/page.js already ships services.json
// to the client as a prop). Deliberately NOT part of the offline static
// export (same reasoning as /api/google-fallback) — a live model call makes
// no sense without a live server.

import { pipeline } from "@huggingface/transformers";
import services from "../../../data/services.json";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
// Tuned empirically against this project's actual 98-record corpus (see
// CHANGELOG): genuine near-miss matches ("pushbike" -> bike hubs,
// "two-wheeler" -> bike hubs, "children's clothing" -> toy library) scored
// 0.40-0.51; true negatives (nonsense queries, unrelated items like "car",
// "moped") scored 0.19-0.26. 0.35 sits just above that gap.
const SIMILARITY_THRESHOLD = 0.35;
const MAX_MATCHES = 10;

// Lazily created once per server process and reused for every request —
// loading the model (and on first-ever run, downloading it) is the slow
// part, embedding a single query against it afterwards is fast.
let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", MODEL_NAME);
  }
  return extractorPromise;
}

// services.json doesn't change without a redeploy, so these embeddings are
// valid for the server's whole lifetime — computed once, not per request.
let serviceEmbeddingsPromise = null;
function getServiceEmbeddings() {
  if (!serviceEmbeddingsPromise) {
    serviceEmbeddingsPromise = (async () => {
      const extractor = await getExtractor();
      const documents = services.map((service) => `${service.item}. ${service.notes || ""}`);
      const output = await extractor(documents, { pooling: "mean", normalize: true });
      return services.map((service, index) => ({
        id: service.id,
        embedding: output[index].data,
      }));
    })();
  }
  return serviceEmbeddingsPromise;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Both vectors are already normalized by the pipeline's normalize:true,
  // so the dot product alone is the cosine similarity.
  return dot;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") || "").trim();
  if (!query) {
    return Response.json({ error: "Missing query." }, { status: 400 });
  }

  try {
    const extractor = await getExtractor();
    const serviceEmbeddings = await getServiceEmbeddings();
    const queryOutput = await extractor(query, { pooling: "mean", normalize: true });
    const queryEmbedding = queryOutput.data;

    const matches = serviceEmbeddings
      .map(({ id, embedding }) => ({ id, score: cosineSimilarity(queryEmbedding, embedding) }))
      .filter((match) => match.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MATCHES);

    return Response.json({ available: true, matches });
  } catch (err) {
    // Model load/download failure (e.g. no network on first boot) should
    // degrade silently to "nothing semantic found", not break the page —
    // the client falls through to the Google fallback either way.
    return Response.json({ available: false, matches: [], error: err.message });
  }
}
