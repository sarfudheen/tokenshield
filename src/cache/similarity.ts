// Pure Node module — no vscode import. Shared by the extension bundle and the
// standalone MCP cache server bundle (dist/cache-server.js).
import * as crypto from 'crypto';

// Small hard-coded stopword list: high-frequency English words that carry no
// meaning for query matching. Kept short on purpose — over-aggressive removal
// hurts short technical queries.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'having',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those',
  'and', 'or', 'but', 'not', 'no', 'if', 'then', 'else', 'so',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'about',
  'how', 'what', 'when', 'where', 'which', 'who', 'why',
  'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'there', 'here', 'up', 'down', 'out', 'over', 'under', 'again', 'please',
]);

// Minimum content tokens for fuzzy matching. Below this, only exact key
// matches count. Floor is 2, not 1 — a single shared content token already
// forces Jaccard to 1.0 regardless of topic ("cache" alone would fuzzy-match
// every cache-related question), so 1-token queries stay exact-only. At 2+
// tokens the Jaccard/cosine thresholds below do the real discriminating work.
export const MIN_FUZZY_TOKENS = 3;

// Tuned together: Jaccard ≥ 0.5 already demands half the unique tokens be
// shared, so cosine mainly rejects share-one-rare-token cases. 0.7 lets a
// paraphrase add one or two content words without dropping below threshold.
const COSINE_THRESHOLD = 0.8;
const JACCARD_THRESHOLD = 0.5;

/** Lowercase, split camelCase and non-alphanumerics, drop stopwords/short tokens, light stemming. */
export function normalizeQuery(query: string): string[] {
  const withCamelSplit = query.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return withCamelSplit
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stemLite);
}

// Strip common suffixes only when enough stem remains — "clearing" → "clear",
// "cached"/"caches"/"cache" all → "cach", "merging"/"merge" → "merg". Crude,
// but both sides of a comparison pass through the same function, so
// consistency is all that matters.
function stemLite(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith('ing')) { t = t.slice(0, -3); }
  else if (t.length > 4 && t.endsWith('ed')) { t = t.slice(0, -2); }
  else if (t.length > 4 && t.endsWith('es')) { t = t.slice(0, -2); }
  else if (t.length > 4 && t.endsWith('s')) { t = t.slice(0, -1); }
  if (t.length > 4 && t.endsWith('e')) { t = t.slice(0, -1); }
  return t;
}

/** Order-insensitive exact-match key: sha256 over sorted unique tokens. */
export function cacheKey(tokens: string[]): string {
  const canonical = Array.from(new Set(tokens)).sort().join(' ');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Inverse document frequency over the cached corpus. Recomputed per
 * lookup/store — trivial at the 300-entry cap.
 */
export function buildIdf(corpusTokens: string[][]): Map<string, number> {
  const docCount = corpusTokens.length;
  const df = new Map<string, number>();
  for (const doc of corpusTokens) {
    for (const token of new Set(doc)) {
      df.set(token, (df.get(token) || 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log((docCount + 1) / (count + 1)) + 1);
  }
  return idf;
}

/** TF-IDF-weighted cosine similarity between two token lists. */
export function similarity(a: string[], b: string[], idf: Map<string, number>): number {
  if (a.length === 0 || b.length === 0) { return 0; }
  const vecA = tfidfVector(a, idf);
  const vecB = tfidfVector(b, idf);

  let dot = 0;
  for (const [token, weightA] of vecA) {
    const weightB = vecB.get(token);
    if (weightB !== undefined) { dot += weightA * weightB; }
  }
  const norm = (v: Map<string, number>) => Math.sqrt(Array.from(v.values()).reduce((s, w) => s + w * w, 0));
  const denom = norm(vecA) * norm(vecB);
  return denom === 0 ? 0 : dot / denom;
}

function tfidfVector(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  const vec = new Map<string, number>();
  for (const [token, count] of tf) {
    vec.set(token, (count / tokens.length) * (idf.get(token) || 1));
  }
  return vec;
}

function jaccard(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) { return 0; }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) { intersection++; }
  }
  return intersection / (setA.size + setB.size - intersection);
}

/**
 * Fuzzy-match decision: TF-IDF cosine catches paraphrases via distinctive
 * terms; the Jaccard guard blocks cosine false-positives where two short
 * queries share a single rare token. Queries under MIN_FUZZY_TOKENS never
 * fuzzy-match (exact key only).
 */
export function isMatch(a: string[], b: string[], idf: Map<string, number>): boolean {
  if (a.length < MIN_FUZZY_TOKENS || b.length < MIN_FUZZY_TOKENS) { return false; }
  return similarity(a, b, idf) >= COSINE_THRESHOLD && jaccard(a, b) >= JACCARD_THRESHOLD;
}
