// Pure Node module — no vscode import. Shared by the extension bundle and the
// standalone MCP cache server bundle (dist/cache-server.js).
//
// Separate from SemanticCacheStore: per-entry `hits` there only counts actual
// cache hits — a miss has no entry to attribute to, so real call-level
// telemetry (including misses) needs its own counters.
import * as fs from 'fs';
import * as path from 'path';
import { CACHE_DIR } from './store';
import { recordDiskEvent } from './eventLog';

export const CALL_LOG_FILE = 'call-log.json';

export interface CallLogCounts {
  lookups: number;
  hits: number;
  misses: number;
  staleHits: number;
  stores: number;
}

const ZERO_COUNTS: CallLogCounts = { lookups: 0, hits: 0, misses: 0, staleHits: 0, stores: 0 };

interface CallLogFile {
  version: 1;
  counts: CallLogCounts;
}

export class CallLogStore {
  private readonly cacheDir: string;
  private readonly filePath: string;

  constructor(private readonly workspaceRoot: string) {
    this.cacheDir = path.join(workspaceRoot, CACHE_DIR);
    this.filePath = path.join(this.cacheDir, CALL_LOG_FILE);
  }

  recordLookup(result: { hit: boolean; stale?: boolean }): CallLogCounts {
    const data = this.load();
    data.counts.lookups++;
    if (result.hit) {
      data.counts.hits++;
      if (result.stale) { data.counts.staleHits++; }
    } else {
      data.counts.misses++;
    }
    this.save(data);
    return data.counts;
  }

  recordStore(): CallLogCounts {
    const data = this.load();
    data.counts.stores++;
    this.save(data);
    return data.counts;
  }

  counts(): CallLogCounts {
    return this.load().counts;
  }

  private load(): CallLogFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.counts) {
        return { version: 1, counts: { ...ZERO_COUNTS, ...parsed.counts } };
      }
    } catch {
      // Missing or corrupt file — start fresh.
    }
    return { version: 1, counts: { ...ZERO_COUNTS } };
  }

  private save(data: CallLogFile): void {
    this.ensureCacheDir();
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
    // Same self-ignoring directory SemanticCacheStore uses — only write the
    // .gitignore if it isn't already there (avoid clobbering).
    const gitignorePath = path.join(this.cacheDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '*\n', 'utf-8');
    }
  }
}
