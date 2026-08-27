// Pure Node module — no vscode import. In-memory TTL memoizer for repeated
// CLI/measurement work inside the extension process (lost on reload, like the
// module-level debounce state in strategies/codegraph.ts).

interface TtlEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, TtlEntry>();

export function memoizeTtl<T>(key: string, ttlMs: number, compute: () => T, now: () => number = Date.now): T {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now()) {
    return existing.value as T;
  }
  const value = compute();
  cache.set(key, { value, expiresAt: now() + ttlMs });
  return value;
}

export async function memoizeTtlAsync<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now()) {
    return existing.value as T;
  }
  const value = await compute();
  cache.set(key, { value, expiresAt: now() + ttlMs });
  return value;
}

/** Drop all entries, or only those whose key starts with `prefix`. */
export function invalidateTtl(prefix?: string): void {
  if (prefix === undefined) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
