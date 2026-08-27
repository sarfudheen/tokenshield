// Persistence for telemetry snapshots. Two artifacts under .aicache/telemetry/:
//   repository.json  — the latest snapshot per repository (overwritten)
//   history.jsonl    — one compact append per collection, for future trends
// Atomic writes (tmp + rename) mirror src/cache/store.ts, so a concurrent read
// never sees a half-written file. Pure Node; no vscode import.
import * as fs from 'fs';
import * as path from 'path';
import { RepositoryMetrics } from './types';

export const TELEMETRY_DIR = path.join('.aicache', 'telemetry');
const LATEST_FILE = 'repository.json';
const HISTORY_FILE = 'history.jsonl';
const MAX_HISTORY_BYTES = 2 * 1024 * 1024; // 2 MB cap; oldest lines dropped past it

interface LatestFile {
  version: 1;
  updatedAt: number;
  repositories: RepositoryMetrics[];
}

/** One trend-friendly row appended per repository per collection. */
export interface HistoryRow {
  t: number;
  repo: string;
  files: number;
  nodes: number;
  edges: number;
  classes: number;
  interfaces: number;
  methods: number;
  functions: number;
  indexBytes: number;
}

export class TelemetryStore {
  private readonly dir: string;
  private readonly latestPath: string;
  private readonly historyPath: string;

  constructor(workspaceRoot: string, private readonly now: () => number = Date.now) {
    this.dir = path.join(workspaceRoot, TELEMETRY_DIR);
    this.latestPath = path.join(this.dir, LATEST_FILE);
    this.historyPath = path.join(this.dir, HISTORY_FILE);
  }

  /** Overwrite the latest snapshot and append one history row per repository. */
  recordRepositories(repositories: RepositoryMetrics[]): void {
    if (repositories.length === 0) { return; }
    const timestamp = this.now();
    this.ensureDir();

    const latest: LatestFile = { version: 1, updatedAt: timestamp, repositories };
    this.atomicWrite(this.latestPath, JSON.stringify(latest, null, 2));

    const rows = repositories.map((r) => this.toHistoryRow(r, timestamp));
    this.appendHistory(rows);
  }

  readLatest(): LatestFile | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.latestPath, 'utf-8'));
      if (parsed && parsed.version === 1 && Array.isArray(parsed.repositories)) {
        return parsed as LatestFile;
      }
    } catch {
      // Missing or corrupt — no history yet.
    }
    return null;
  }

  /** All history rows, oldest first. Malformed lines are skipped, not fatal. */
  readHistory(): HistoryRow[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.historyPath, 'utf-8');
    } catch {
      return [];
    }
    const rows: HistoryRow[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) { continue; }
      try { rows.push(JSON.parse(trimmed) as HistoryRow); } catch { /* skip */ }
    }
    return rows;
  }

  private toHistoryRow(r: RepositoryMetrics, timestamp: number): HistoryRow {
    return {
      t: timestamp,
      repo: r.repositoryName,
      files: r.totalFiles,
      nodes: r.totalGraphNodes,
      edges: r.totalGraphRelationships,
      classes: r.totalClasses,
      interfaces: r.totalInterfaces,
      methods: r.totalMethods,
      functions: r.totalFunctions,
      indexBytes: r.indexSizeBytes,
    };
  }

  private appendHistory(rows: HistoryRow[]): void {
    const existing = this.readHistory();
    const combined = [...existing, ...rows];
    let serialized = combined.map((r) => JSON.stringify(r)).join('\n') + '\n';
    // Drop oldest lines until under the byte cap.
    while (Buffer.byteLength(serialized) > MAX_HISTORY_BYTES && combined.length > rows.length) {
      combined.shift();
      serialized = combined.map((r) => JSON.stringify(r)).join('\n') + '\n';
    }
    this.atomicWrite(this.historyPath, serialized);
  }

  private atomicWrite(target: string, content: string): void {
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, target);
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
    const gitignore = path.join(this.dir, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, '*\n', 'utf-8');
    }
  }
}
