// Pure Node module — no vscode import. Shared by the extension bundle and the
// standalone MCP cache server bundle (dist/cache-server.js).
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { normalizeQuery, cacheKey, buildIdf, similarity, isMatch } from './similarity';

export const CACHE_DIR = '.aicache';
export const CACHE_FILE = 'semantic-cache.json';

const MAX_ENTRIES = 300;
const MAX_FILE_BYTES = 1024 * 1024; // 1 MB serialized
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days since last access
const GIT_HEAD_TTL_MS = 10_000;

/** 'code' answers go stale when HEAD moves; 'durable' answers never do. */
export type CacheScope = 'code' | 'durable';

export interface CacheEntry {
  id: string;
  query: string;
  tokens: string[];
  answer: string;
  scope: CacheScope;
  gitHead: string | null;
  createdAt: number;
  lastAccessedAt: number;
  hits: number;
}

interface CacheFile {
  version: 1;
  entries: CacheEntry[];
}

export interface LookupResult {
  hit: boolean;
  answer?: string;
  exact?: boolean;
  similarity?: number;
  stale?: boolean;
  storedAt?: number;
}

export interface CacheStats {
  entries: number;
  totalHits: number;
  estTokensSaved: number;
}

export class SemanticCacheStore {
  private readonly cacheDir: string;
  private readonly cacheFilePath: string;
  private gitHeadCache: { value: string | null; expiresAt: number } | null = null;

  constructor(
    private readonly workspaceRoot: string,
    private readonly now: () => number = Date.now,
  ) {
    this.cacheDir = path.join(workspaceRoot, CACHE_DIR);
    this.cacheFilePath = path.join(this.cacheDir, CACHE_FILE);
  }

  lookup(query: string): LookupResult {
    const data = this.load();
    const tokens = normalizeQuery(query);
    const key = cacheKey(tokens);
    const head = this.currentGitHead();

    const exactEntry = data.entries.find((e) => e.id === key);
    if (exactEntry) {
      return this.recordHit(data, exactEntry, head, { exact: true, similarity: 1 });
    }

    const idf = buildIdf([...data.entries.map((e) => e.tokens), tokens]);
    let best: CacheEntry | undefined;
    let bestScore = 0;
    for (const entry of data.entries) {
      if (!isMatch(tokens, entry.tokens, idf)) { continue; }
      const score = similarity(tokens, entry.tokens, idf);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    if (best) {
      return this.recordHit(data, best, head, { exact: false, similarity: bestScore });
    }
    return { hit: false };
  }

  store(query: string, answer: string, scope: CacheScope = 'code'): CacheEntry {
    const data = this.load();
    const tokens = normalizeQuery(query);
    const key = cacheKey(tokens);
    const timestamp = this.now();

    let entry = data.entries.find((e) => e.id === key);
    if (entry) {
      entry.query = query;
      entry.answer = answer;
      entry.scope = scope;
      entry.gitHead = this.currentGitHead();
      entry.lastAccessedAt = timestamp;
    } else {
      entry = {
        id: key,
        query,
        tokens,
        answer,
        scope,
        gitHead: this.currentGitHead(),
        createdAt: timestamp,
        lastAccessedAt: timestamp,
        hits: 0,
      };
      data.entries.push(entry);
    }
    this.save(data);
    return entry;
  }

  clear(): void {
    this.save({ version: 1, entries: [] });
  }

  stats(): CacheStats {
    const data = this.load();
    let totalHits = 0;
    let estTokensSaved = 0;
    for (const entry of data.entries) {
      totalHits += entry.hits;
      estTokensSaved += entry.hits * Math.ceil(entry.answer.length / 4);
    }
    return { entries: data.entries.length, totalHits, estTokensSaved };
  }

  private recordHit(
    data: CacheFile,
    entry: CacheEntry,
    head: string | null,
    match: { exact: boolean; similarity: number },
  ): LookupResult {
    entry.hits++;
    entry.lastAccessedAt = this.now();
    this.save(data);
    return {
      hit: true,
      answer: entry.answer,
      exact: match.exact,
      similarity: match.similarity,
      // Stale entries are flagged, not dropped — a commit shouldn't nuke the
      // cache; the caller decides whether the answer is still usable.
      stale: entry.scope === 'code' && entry.gitHead !== head,
      storedAt: entry.createdAt,
    };
  }

  private load(): CacheFile {
    try {
      const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && Array.isArray(parsed.entries)) {
        return parsed as CacheFile;
      }
    } catch {
      // Missing or corrupt file — start fresh.
    }
    return { version: 1, entries: [] };
  }

  private save(data: CacheFile): void {
    this.evict(data);
    this.ensureCacheDir();
    const tmpPath = this.cacheFilePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.cacheFilePath);
  }

  private evict(data: CacheFile): void {
    const cutoff = this.now() - MAX_AGE_MS;
    data.entries = data.entries.filter((e) => e.lastAccessedAt >= cutoff);

    const lruFirst = () => data.entries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    if (data.entries.length > MAX_ENTRIES) {
      lruFirst();
      data.entries = data.entries.slice(data.entries.length - MAX_ENTRIES);
    }
    while (data.entries.length > 0 && Buffer.byteLength(JSON.stringify(data)) > MAX_FILE_BYTES) {
      lruFirst();
      data.entries.shift();
    }
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    // Self-ignoring directory — never touch the user's root .gitignore.
    const gitignorePath = path.join(this.cacheDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n', 'utf-8');
    }
  }

  private currentGitHead(): string | null {
    const timestamp = this.now();
    if (this.gitHeadCache && this.gitHeadCache.expiresAt > timestamp) {
      return this.gitHeadCache.value;
    }
    let head: string | null = null;
    try {
      const commitResult = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        timeout: 3000,
      });
      const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        timeout: 3000,
      });
      if (commitResult.status === 0 && commitResult.stdout) {
        const commit = commitResult.stdout.trim();
        const branch = branchResult.status === 0 ? branchResult.stdout.trim() : 'unknown';
        head = `${branch}:${commit}`;
      }
    } catch {
      // Not a git repo or git unavailable — entries just never go stale.
    }
    this.gitHeadCache = { value: head, expiresAt: timestamp + GIT_HEAD_TTL_MS };
    return head;
  }
}
