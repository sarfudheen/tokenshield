// Pure Node — turns the persisted history.jsonl into windowed trend summaries.
// The history rows are structural snapshots of the CodeGraph index captured
// each time the dashboard runs, so the trends here are REAL repository growth
// over time (files/nodes/edges/symbols/index size), not per-request LLM data
// the extension can't see.
import { HistoryRow } from './store';

export type WindowKey = '24h' | '7d' | '30d' | 'lifetime';

export const WINDOWS: { key: WindowKey; label: string; ms: number | null }[] = [
  { key: '24h', label: 'Last 24 Hours', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: 'Last 7 Days', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: 'Last 30 Days', ms: 30 * 24 * 60 * 60 * 1000 },
  { key: 'lifetime', label: 'Entire Lifetime', ms: null },
];

/** The numeric series we can trend from a HistoryRow. */
export type MetricKey = 'files' | 'nodes' | 'edges' | 'classes' | 'interfaces' | 'methods' | 'functions' | 'indexBytes';

export interface MetricTrend {
  metric: MetricKey;
  /** Chronological values within the window (for a sparkline). */
  series: number[];
  first: number;
  latest: number;
  /** latest - first over the window. */
  delta: number;
  /** Percent change vs. the window's first sample; null when first is 0. */
  deltaPercent: number | null;
  min: number;
  max: number;
  avg: number;
}

export interface WindowSummary {
  window: WindowKey;
  label: string;
  repo: string;
  sampleCount: number;
  from: number | null;
  to: number | null;
  trends: Record<MetricKey, MetricTrend>;
}

const METRIC_KEYS: MetricKey[] = ['files', 'nodes', 'edges', 'classes', 'interfaces', 'methods', 'functions', 'indexBytes'];

function trendOf(metric: MetricKey, rows: HistoryRow[]): MetricTrend {
  const series = rows.map((r) => r[metric] ?? 0);
  const first = series[0] ?? 0;
  const latest = series[series.length - 1] ?? 0;
  const min = series.length ? Math.min(...series) : 0;
  const max = series.length ? Math.max(...series) : 0;
  const avg = series.length ? Math.round(series.reduce((a, b) => a + b, 0) / series.length) : 0;
  return {
    metric,
    series,
    first,
    latest,
    delta: latest - first,
    deltaPercent: first > 0 ? Math.round(((latest - first) / first) * 1000) / 10 : null,
    min,
    max,
    avg,
  };
}

/** Distinct repository names present in history, latest-active first. */
export function repositoriesInHistory(rows: HistoryRow[]): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) { seen.set(r.repo, r.t); }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/**
 * Summarize one repository's history within a time window. Rows are filtered to
 * the window (relative to `now`) and sorted chronologically before trending.
 */
export function summarizeWindow(
  rows: HistoryRow[],
  repo: string,
  window: WindowKey,
  now: number = Date.now(),
): WindowSummary {
  const spec = WINDOWS.find((w) => w.key === window)!;
  const cutoff = spec.ms === null ? -Infinity : now - spec.ms;
  const scoped = rows
    .filter((r) => r.repo === repo && r.t >= cutoff)
    .sort((a, b) => a.t - b.t);

  const trends = {} as Record<MetricKey, MetricTrend>;
  for (const key of METRIC_KEYS) { trends[key] = trendOf(key, scoped); }

  return {
    window,
    label: spec.label,
    repo,
    sampleCount: scoped.length,
    from: scoped.length ? scoped[0].t : null,
    to: scoped.length ? scoped[scoped.length - 1].t : null,
    trends,
  };
}
