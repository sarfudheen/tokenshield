// Pure module, in-memory only — scoped to this VS Code window's lifetime
// (from activate() to reload/close). "Session" means the current window,
// not a historical log; nothing here is persisted to disk.
import { CacheStats } from '../cache/store';
import { CallLogCounts } from '../cache/callLog';

const ZERO_CALL_COUNTS: CallLogCounts = { lookups: 0, hits: 0, misses: 0, staleHits: 0, stores: 0, skeletonViews: 0, prunes: 0 };

interface SessionState {
  startedAt: number;
  cacheStatsAtStart: CacheStats | null;
  callCountsAtStart: CallLogCounts | null;
  reindexCount: number;
}

let session: SessionState | null = null;

export function startSession(
  cacheStatsAtStart: CacheStats | null,
  now: () => number = Date.now,
  callCountsAtStart: CallLogCounts | null = null,
): void {
  session = { startedAt: now(), cacheStatsAtStart, callCountsAtStart, reindexCount: 0 };
}

export function recordReindex(): void {
  if (session) { session.reindexCount++; }
}

export interface SessionSummary {
  active: boolean;
  elapsedMs: number;
  reindexCount: number;
  cacheHitsThisSession: number;
  tokensSavedThisSession: number;
  mcpLookupsThisSession: number;
  mcpHitsThisSession: number;
  mcpMissesThisSession: number;
  mcpStoresThisSession: number;
}

export function getSessionSummary(
  currentCacheStats: CacheStats | null,
  now: () => number = Date.now,
  currentCallCounts: CallLogCounts | null = null,
): SessionSummary {
  if (!session) {
    return {
      active: false, elapsedMs: 0, reindexCount: 0,
      cacheHitsThisSession: 0, tokensSavedThisSession: 0,
      mcpLookupsThisSession: 0, mcpHitsThisSession: 0, mcpMissesThisSession: 0, mcpStoresThisSession: 0,
    };
  }
  const startHits = session.cacheStatsAtStart?.totalHits ?? 0;
  const startTokens = session.cacheStatsAtStart?.estTokensSaved ?? 0;
  const currentHits = currentCacheStats?.totalHits ?? startHits;
  const currentTokens = currentCacheStats?.estTokensSaved ?? startTokens;

  const startCalls = session.callCountsAtStart ?? ZERO_CALL_COUNTS;
  const currentCalls = currentCallCounts ?? startCalls;

  return {
    active: true,
    elapsedMs: Math.max(0, now() - session.startedAt),
    reindexCount: session.reindexCount,
    // Clamped at 0: a cache clear mid-session would otherwise read as a negative saving.
    cacheHitsThisSession: Math.max(0, currentHits - startHits),
    tokensSavedThisSession: Math.max(0, currentTokens - startTokens),
    mcpLookupsThisSession: Math.max(0, currentCalls.lookups - startCalls.lookups),
    mcpHitsThisSession: Math.max(0, currentCalls.hits - startCalls.hits),
    mcpMissesThisSession: Math.max(0, currentCalls.misses - startCalls.misses),
    mcpStoresThisSession: Math.max(0, currentCalls.stores - startCalls.stores),
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) { return `${hours}h ${minutes}m`; }
  if (minutes > 0) { return `${minutes}m ${seconds}s`; }
  return `${seconds}s`;
}
