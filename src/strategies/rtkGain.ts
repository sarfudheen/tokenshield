// Real, locally-persisted RTK savings — from `rtk gain --format json --all
// --project`, a stable public CLI flag (verified against rtk 0.43.0). Unlike
// the old synthetic ls/find benchmark this replaced, these numbers reflect
// actual command usage recorded by rtk itself, lifetime for this workspace.
//
// No by-command breakdown here: it exists only in rtk's text-table output,
// not --format json/csv — parsing that would mean regex-scraping an
// unstable, dynamically-truncated table, the same fragility that made the
// old synthetic benchmark unreliable. Skipped for now.
import { spawnSync } from 'child_process';

export type RtkGainStatus = 'measured' | 'no-data' | 'error';

export interface RtkGainSummary {
  totalCommands: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSavedTokens: number;
  avgSavingsPct: number;
  totalTimeMs: number;
}

export interface RtkGainResult {
  status: RtkGainStatus;
  summary?: RtkGainSummary;
  detail: string;
}

/** Pure parser — unit-testable against fixture strings, no process spawn. */
export function parseRtkGainOutput(jsonText: string): RtkGainResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: 'error', detail: 'rtk gain output was not valid JSON — the rtk CLI schema may have changed.' };
  }

  const summary = (parsed as { summary?: Record<string, unknown> })?.summary;
  if (!summary || typeof summary.total_commands !== 'number') {
    return { status: 'error', detail: 'rtk gain JSON was missing the expected "summary" block — the rtk CLI schema may have changed.' };
  }

  if (summary.total_commands === 0) {
    return { status: 'no-data', detail: 'No RTK command history yet for this project — run some commands through rtk to build savings history.' };
  }

  const num = (key: string): number => (typeof summary[key] === 'number' ? (summary[key] as number) : 0);
  return {
    status: 'measured',
    summary: {
      totalCommands: num('total_commands'),
      totalInputTokens: num('total_input'),
      totalOutputTokens: num('total_output'),
      totalSavedTokens: num('total_saved'),
      avgSavingsPct: num('avg_savings_pct'),
      totalTimeMs: num('total_time_ms'),
    },
    detail: '',
  };
}

/** Thin I/O wrapper — shells out to the real rtk binary and delegates parsing. */
export function getRtkGain(cwd: string): RtkGainResult {
  const result = spawnSync('rtk', ['gain', '--format', 'json', '--all', '--project'], {
    cwd,
    encoding: 'utf-8',
    timeout: 5000,
  });

  if (result.error || result.status !== 0) {
    return { status: 'error', detail: `rtk gain exited with an error — ${result.error?.message || `status ${result.status}`}` };
  }

  return parseRtkGainOutput(result.stdout || '');
}
