import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, Profile, TOTAL_STRATEGIES } from '../core/config';
import { PROFILE_DESCRIPTIONS } from '../core/constants';

let statusBarItem: vscode.StatusBarItem;

export function createStatusBar(): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'aiTokenOptimizer.selectProfile';
  updateStatusBar();
  statusBarItem.show();
  return statusBarItem;
}

export function updateStatusBar(): void {
  if (!statusBarItem) {
    return;
  }

  const config = getConfig();
  if (!config.enabled) {
    statusBarItem.text = '$(shield) TokenShield: OFF';
    statusBarItem.tooltip = 'TokenShield is DISABLED. Click to enable optimization directives.';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    return;
  }

  const strategies = getEffectiveStrategies(config);
  const activeCount = countActiveStrategies(strategies);
  const profileLabel = getProfileShortLabel(config.profile);

  statusBarItem.text = `$(shield) TokenShield: ${profileLabel} (${activeCount}/${TOTAL_STRATEGIES})`;
  statusBarItem.tooltip = buildTooltip(config.profile, strategies);
  statusBarItem.backgroundColor = activeCount === TOTAL_STRATEGIES
    ? undefined
    : new vscode.ThemeColor('statusBarItem.warningBackground');
}

function getProfileShortLabel(profile: Profile): string {
  const labels: Record<Profile, string> = {
    full: 'Full',
    debug: 'Debug',
    planning: 'Plan',
    review: 'Review',
    custom: 'Custom',
  };
  return labels[profile];
}

function buildTooltip(profile: Profile, strategies: ReturnType<typeof getEffectiveStrategies>): string {
  const lines = [
    `TokenShield — ${PROFILE_DESCRIPTIONS[profile]}`,
    '',
    'Active Directives:',
    `  ${strategies.codeGraph ? '✓' : '✗'} CAP-1: CodeGraph (search-first)`,
    `  ${strategies.outputCompression ? '✓' : '✗'} CAP-2: RTK Output Compression`,
    `  ${strategies.verbosityControl ? '✓' : '✗'} CAP-3: Verbosity Control (Caveman)`,
    `  ${strategies.sessionManagement ? '✓' : '✗'} CAP-4: Context Hygiene`,
    `  ${strategies.semanticCache ? '✓' : '✗'} CAP-5: Semantic Answer Cache`,
    `  ${strategies.astSkeleton ? '✓' : '✗'} CAP-6: AST Skeleton Pruning`,
    `  ${strategies.contextExclusion ? '✓' : '✗'} CAP-7: Context Exclusion`,
    `  ${strategies.diffOnlyOutput ? '✓' : '✗'} CAP-8: Diff-Only Output`,
    `  ${strategies.agentGuardrails ? '✓' : '✗'} CAP-9: Agent Guardrails`,
    `  ${strategies.smartModelRouting ? '✓' : '✗'} CAP-10: Smart Model Routing`,
    '',
    'Click: change profile / toggle directives / view ROI dashboard',
  ];
  return lines.join('\n');
}

export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
