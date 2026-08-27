// Tier-A collector: real structural metrics read from the CodeGraph index.
// Nothing here is estimated — every number comes from codegraph.db (preferred,
// full breakdown) or from `codegraph status` (fallback, totals only).
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CollectContext, MetricSnapshot, MetricsCollector, RepositoryMetrics } from './types';
import { countBy, isSqliteAvailable, locateDb, query } from './codegraphDb';

/**
 * Maps CodeGraph node kinds onto the prompt's requested categories. CodeGraph
 * emits `class`/`interface`/`method`/`function`/`enum` as node kinds; anything
 * it doesn't emit (APIs, DB queries) is reported as null upstream, not zero.
 */
function sumKinds(nodeKinds: Record<string, number>, ...kinds: string[]): number {
  return kinds.reduce((total, k) => total + (nodeKinds[k] ?? 0), 0);
}

/** Distinct parent directories across indexed file paths. */
function countDirectories(filePaths: string[]): number {
  const dirs = new Set<string>();
  for (const f of filePaths) { dirs.add(path.dirname(f)); }
  return dirs.size;
}

export class RepositoryMetricsCollector implements MetricsCollector<RepositoryMetrics[]> {
  readonly id = 'repository';
  readonly title = 'Repository Intelligence';

  constructor(private readonly enabled: () => boolean = () => true) {}

  isEnabled(): boolean {
    return this.enabled();
  }

  async collect(context: CollectContext): Promise<MetricSnapshot<RepositoryMetrics[]>> {
    const collectedAt = context.now();
    if (!this.isEnabled()) {
      return { collector: this.id, collectedAt, status: 'disabled', detail: 'Telemetry disabled in settings.' };
    }
    if (context.projects.length === 0) {
      return { collector: this.id, collectedAt, status: 'unavailable', detail: 'No workspace folder open to inspect.' };
    }

    const sqlite = isSqliteAvailable();
    const results: RepositoryMetrics[] = [];
    for (const project of context.projects) {
      const metrics = sqlite ? this.fromDb(project) : null;
      const resolved = metrics ?? this.fromStatus(project);
      if (resolved) { results.push(resolved); }
    }

    if (results.length === 0) {
      const why = sqlite
        ? 'No indexed CodeGraph database found — run "AI Token Optimizer: Reindex CodeGraph".'
        : 'sqlite3 CLI not found and `codegraph status` returned nothing — install sqlite3 or reindex.';
      return { collector: this.id, collectedAt, status: 'unavailable', detail: why };
    }

    const detail = sqlite
      ? `Read from codegraph.db across ${results.length} project(s) — full node/edge breakdown.`
      : `sqlite3 unavailable — totals only, parsed from \`codegraph status\` across ${results.length} project(s).`;
    return { collector: this.id, collectedAt, status: 'ok', detail, data: results };
  }

  /** Full-fidelity path: read the SQLite index directly. */
  private fromDb(project: { name: string; absPath: string }): RepositoryMetrics | null {
    const location = locateDb(project.absPath);
    if (!location) { return null; }
    const { dbPath, indexSizeBytes } = location;

    const nodeKinds = countBy(dbPath, 'nodes');
    const edgeKinds = countBy(dbPath, 'edges');
    if (Object.keys(nodeKinds).length === 0) { return null; }

    const totalGraphNodes = Object.values(nodeKinds).reduce((a, b) => a + b, 0);
    const totalGraphRelationships = Object.values(edgeKinds).reduce((a, b) => a + b, 0);

    // Files: path, language, size — the source of truth for files/dirs/langs/bytes.
    const fileRows = query(dbPath, 'SELECT path, language, size FROM files;') ?? [];
    const languages: Record<string, number> = {};
    let sourceBytes = 0;
    const paths: string[] = [];
    for (const [p, lang, size] of fileRows) {
      paths.push(p ?? '');
      languages[lang || 'unknown'] = (languages[lang || 'unknown'] ?? 0) + 1;
      sourceBytes += Number(size) || 0;
    }

    const buildTime = this.readBuildTimeMs(dbPath);

    return {
      repositoryName: project.name,
      sourceBytes,
      totalFiles: fileRows.length || (nodeKinds['file'] ?? 0),
      totalDirectories: countDirectories(paths),
      totalPackages: null, // not a CodeGraph node kind — language-specific, not modeled
      totalClasses: sumKinds(nodeKinds, 'class'),
      totalInterfaces: sumKinds(nodeKinds, 'interface'),
      totalEnums: sumKinds(nodeKinds, 'enum'),
      totalMethods: sumKinds(nodeKinds, 'method'),
      totalFunctions: sumKinds(nodeKinds, 'function'),
      totalApis: null,             // not modeled by the index
      totalDatabaseQueries: null,  // not modeled by the index
      totalGraphNodes,
      totalGraphRelationships,
      indexSizeBytes,
      graphBuildTimeMs: buildTime,
      languages,
      nodeKinds,
      edgeKinds,
      source: 'sqlite',
    };
  }

  /**
   * CodeGraph records index timestamps in project_metadata but not a build
   * *duration*. If both a discovery-start and complete marker exist we can
   * derive one; otherwise this is genuinely unknown → null.
   */
  private readBuildTimeMs(dbPath: string): number | null {
    const rows = query(dbPath, "SELECT key, value FROM project_metadata WHERE key LIKE 'index_%';");
    if (!rows) { return null; }
    let started: number | undefined;
    let completed: number | undefined;
    for (const [key, value] of rows) {
      const n = Number(value);
      if (!Number.isFinite(n)) { continue; }
      if (key === 'index_started_at') { started = n; }
      if (key === 'index_completed_at') { completed = n; }
    }
    return started !== undefined && completed !== undefined && completed >= started
      ? completed - started
      : null;
  }

  /** Degraded path: parse totals out of `codegraph status` text. */
  private fromStatus(project: { name: string; absPath: string }): RepositoryMetrics | null {
    const r = spawnSync('codegraph', ['status'], { cwd: project.absPath, encoding: 'utf-8', timeout: 5000 });
    if (r.error || r.status !== 0) { return null; }
    const out = r.stdout ?? '';
    const files = out.match(/Files:\s*(\d+)/)?.[1];
    const nodes = out.match(/Nodes:\s*(\d+)/)?.[1];
    const edges = out.match(/Edges:\s*(\d+)/)?.[1];
    if (!files || !nodes) { return null; }

    const location = locateDb(project.absPath);
    return {
      repositoryName: project.name,
      sourceBytes: 0,
      totalFiles: Number(files),
      totalDirectories: 0,
      totalPackages: null,
      totalClasses: 0,
      totalInterfaces: 0,
      totalEnums: 0,
      totalMethods: 0,
      totalFunctions: 0,
      totalApis: null,
      totalDatabaseQueries: null,
      totalGraphNodes: Number(nodes),
      totalGraphRelationships: edges ? Number(edges) : 0,
      indexSizeBytes: location?.indexSizeBytes ?? 0,
      graphBuildTimeMs: null,
      languages: {},
      nodeKinds: {},
      edgeKinds: {},
      source: 'codegraph-status',
    };
  }
}
