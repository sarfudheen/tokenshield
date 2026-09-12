import * as path from 'path';
import { spawnSync } from 'child_process';
import { CacheEntry } from './store';

const diffCache = new Map<string, { changedFiles: Set<string>; timestamp: number }>();
const DIFF_CACHE_TTL_MS = 30_000;

/**
 * Get changed files between two git commits/refs.
 * Returns null if git command fails or repository is in an unusual state.
 */
export function getChangedFilesBetween(
  workspaceRoot: string,
  oldHead: string,
  newHead: string
): Set<string> | null {
  if (!oldHead || !newHead || oldHead === newHead) {
    return new Set();
  }

  const cacheKey = `${workspaceRoot}:${oldHead}:${newHead}`;
  const now = Date.now();
  const cached = diffCache.get(cacheKey);
  if (cached && now - cached.timestamp < DIFF_CACHE_TTL_MS) {
    return cached.changedFiles;
  }

  try {
    const res = spawnSync('git', ['diff', '--name-only', oldHead, newHead], {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      timeout: 3000,
    });

    if (res.status !== 0 || res.error) {
      return null;
    }

    const set = new Set<string>();
    const lines = res.stdout.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        set.add(trimmed.replace(/\\/g, '/'));
      }
    }

    diffCache.set(cacheKey, { changedFiles: set, timestamp: now });
    return set;
  } catch {
    return null;
  }
}

/**
 * Extract candidate file paths mentioned in a query string.
 */
export function extractCandidateFiles(text: string): string[] {
  const filePattern = /(?:[\w@.-]+[/\\])*[\w@.-]+\.(?:ts|tsx|js|jsx|json|py|go|rs|rb|java|cpp|c|h|cs|php|swift|kt|md|ya?ml|toml|html|css|scss)/gi;
  const matches = text.match(filePattern);
  if (!matches) { return []; }
  return Array.from(new Set(matches.map(m => m.replace(/\\/g, '/'))));
}

/**
 * Determine if a cache entry is stale given the current git HEAD.
 * Returns true only if the entry relates to files modified between the entry's gitHead and currentHead.
 */
export function isCacheEntryStale(
  entry: CacheEntry,
  currentHead: string | null,
  workspaceRoot: string
): boolean {
  if (entry.scope === 'durable') {
    return false;
  }

  // If the entry was never bound to a git commit, it cannot be invalidated by git
  if (!entry.gitHead) {
    return false;
  }

  // If HEAD hasn't moved, the entry is fresh
  if (entry.gitHead === currentHead) {
    return false;
  }

  // If HEAD moved and currentHead is null (e.g. repo changed/detached), entry is stale
  if (!currentHead) {
    return true;
  }

  const candidateFiles = (entry.sourceFiles && entry.sourceFiles.length > 0)
    ? entry.sourceFiles
    : extractCandidateFiles(entry.query);

  // If no files are associated with this entry, it cannot be safely differentiated, so mark stale
  if (candidateFiles.length === 0) {
    return true;
  }

  const changed = getChangedFilesBetween(workspaceRoot, entry.gitHead, currentHead);
  if (!changed) {
    // Git diff unavailable, conservative fallback: mark stale
    return true;
  }

  // Check if any candidate file was modified
  for (const file of candidateFiles) {
    const normalized = file.replace(/\\/g, '/');
    const base = path.basename(normalized);
    for (const changedFile of changed) {
      if (changedFile === normalized || changedFile.endsWith(`/${normalized}`) || path.basename(changedFile) === base) {
        return true; // File changed
      }
    }
  }

  // None of the associated files changed between oldHead and newHead!
  return false;
}
