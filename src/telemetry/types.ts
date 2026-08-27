// Pure Node module — no vscode import, so it stays unit-testable in isolation
// (same discipline as src/cache/store.ts). The telemetry layer is deliberately
// built around small, pluggable collectors so future metric sources can be
// added without touching the core or the dashboard wiring.

/**
 * A value we can actually observe locally vs. one we cannot. `null` is used
 * throughout the data models to mean "this codebase / index genuinely does not
 * expose this — do not render a fabricated number". The dashboard renders
 * `null` as "n/a", never as 0, so the distinction survives to the UI.
 */
export type Observable<T> = T | null;

export type CollectorStatus = 'ok' | 'unavailable' | 'disabled' | 'error';

/**
 * Uniform envelope every collector returns. `data` is only populated when
 * status === 'ok'. `detail` explains any non-ok status in plain language so it
 * can be surfaced verbatim to the user (the existing dashboard already does
 * this for its measurements).
 */
export interface MetricSnapshot<T> {
  readonly collector: string;
  readonly collectedAt: number;
  readonly status: CollectorStatus;
  readonly detail: string;
  readonly data?: T;
}

/** Everything a collector needs to run. Extend additively — never break the shape. */
export interface CollectContext {
  readonly workspaceRoot: string;
  readonly projects: ReadonlyArray<{ name: string; absPath: string }>;
  readonly now: () => number;
}

/**
 * The one interface every metric source implements. Async by contract so a
 * collector may shell out / read files without blocking; the registry runs
 * them concurrently. `enabled` lets a collector be switched off via config
 * without removing it from the pipeline.
 */
export interface MetricsCollector<T> {
  readonly id: string;
  readonly title: string;
  isEnabled(): boolean;
  collect(context: CollectContext): Promise<MetricSnapshot<T>>;
}

// ---------------------------------------------------------------------------
// Repository metrics (Tier A — read straight from the CodeGraph index; real)
// ---------------------------------------------------------------------------

/**
 * Structural facts about one indexed repository. Every field is either read
 * directly from `.codegraph/codegraph.db` or derived from it. Fields CodeGraph
 * does not model (APIs, DB queries) are typed `Observable` and reported as
 * `null` rather than guessed at.
 */
export interface RepositoryMetrics {
  repositoryName: string;
  /** Sum of indexed source file sizes, in bytes (SUM(files.size)). */
  sourceBytes: number;
  totalFiles: number;
  totalDirectories: number;
  /** Language-specific concept CodeGraph doesn't model as a node kind. */
  totalPackages: Observable<number>;
  totalClasses: number;
  totalInterfaces: number;
  totalEnums: number;
  totalMethods: number;
  totalFunctions: number;
  totalApis: Observable<number>;
  totalDatabaseQueries: Observable<number>;
  totalGraphNodes: number;
  totalGraphRelationships: number;
  /** Size of codegraph.db on disk, in bytes. */
  indexSizeBytes: number;
  /** Duration of the index build, if CodeGraph recorded it; else null. */
  graphBuildTimeMs: Observable<number>;
  /** Files-table language → file count. */
  languages: Record<string, number>;
  /** nodes.kind → count. The raw breakdown the fields above are derived from. */
  nodeKinds: Record<string, number>;
  /** edges.kind → count. */
  edgeKinds: Record<string, number>;
  /** How this snapshot was obtained, so the dashboard can note fidelity. */
  source: 'sqlite' | 'codegraph-status';
}

// ---------------------------------------------------------------------------
// Savings model (Tier B — a labeled estimate, never presented as measured)
// ---------------------------------------------------------------------------

/**
 * Assumptions behind the savings model. These are inputs to an estimate, NOT
 * observations. They exist explicitly so the dashboard can print them next to
 * the numbers they produce — the reader always sees what the estimate rests on.
 */
export interface SavingsAssumptions {
  /** Files a graph-scoped retrieval typically pulls for one request. */
  avgFilesRetrievedPerQuery: number;
  /** Chars per token, for the source-bytes → tokens conversion. */
  charsPerToken: number;
  /** USD per 1K prompt tokens, for the illustrative cost figure. */
  usdPer1kPromptTokens: number;
  /** Which baseline "without graph" represents. */
  baseline: 'whole-repository';
}

export const DEFAULT_ASSUMPTIONS: SavingsAssumptions = {
  avgFilesRetrievedPerQuery: 8,
  charsPerToken: 4,
  usdPer1kPromptTokens: 0.003,
  baseline: 'whole-repository',
};

/**
 * A modeled comparison of "no graph" (load the whole repo) vs. "graph-scoped"
 * (load ~avgFilesRetrievedPerQuery files). Labeled `modeled: true` so the UI is
 * obligated to mark it as an estimate, distinct from the real repo metrics.
 */
export interface SavingsEstimate {
  readonly modeled: true;
  assumptions: SavingsAssumptions;
  estimatedFilesWithoutGraph: number;
  estimatedFilesWithGraph: number;
  estimatedPromptTokensWithoutGraph: number;
  estimatedPromptTokensWithGraph: number;
  estimatedContextKbWithoutGraph: number;
  estimatedContextKbWithGraph: number;
  filesReductionPercent: number;
  tokenReductionPercent: number;
  estimatedCostWithoutGraphUsd: number;
  estimatedCostWithGraphUsd: number;
  estimatedCostSavedUsd: number;
}
