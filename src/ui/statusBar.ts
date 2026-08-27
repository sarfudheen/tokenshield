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
    statusBarItem.tooltip = new vscode.MarkdownString('**TokenShield is DISABLED**\n\nClick to enable optimization directives.');
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    return;
  }

  const strategies = getEffectiveStrategies(config);
  const activeCount = countActiveStrategies(strategies);
  const profileLabel = getProfileShortLabel(config.profile);

  statusBarItem.text = `$(shield) TokenShield: ${profileLabel} (${activeCount}/${TOTAL_STRATEGIES})`;
  statusBarItem.tooltip = buildRichMarkdownTooltip(config.profile, strategies, activeCount);
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

function buildRichMarkdownTooltip(
  profile: Profile,
  strategies: ReturnType<typeof getEffectiveStrategies>,
  activeCount: number
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  md.appendMarkdown(`### 🛡️ TokenShield Active Enforcement HUD\n`);
  md.appendMarkdown(`**Profile**: \`${profile.toUpperCase()}\` (${activeCount}/${TOTAL_STRATEGIES} Active Directives)\n\n`);
  md.appendMarkdown(`*These directives are automatically injected into the system context of every prompt sent to the LLM:*\n\n`);
  md.appendMarkdown(`---\n\n`);

  const rows = [
    { key: strategies.codeGraph, cap: 'CAP-1', name: 'CodeGraph Pre-Indexing', desc: 'Queries symbol graph before broad searches' },
    { key: strategies.outputCompression, cap: 'CAP-2', name: 'RTK Output Filter', desc: 'Compresses verbose test & CLI output' },
    { key: strategies.verbosityControl, cap: 'CAP-3', name: 'Dense Output (Caveman)', desc: 'Strips greetings, apologies, and filler' },
    { key: strategies.sessionManagement, cap: 'CAP-4', name: 'Context Hygiene', desc: 'Auto-compacts stale conversational turns' },
    { key: strategies.semanticCache, cap: 'CAP-5', name: 'Local Semantic Cache', desc: 'Auto-checks local disk before regenerating' },
    { key: strategies.astSkeleton, cap: 'CAP-6', name: 'AST Skeleton Pruner', desc: 'Loads signatures only (75-95% context saved)' },
    { key: strategies.contextExclusion, cap: 'CAP-7', name: 'Context Exclusion', desc: 'Auto-blocks 22 lockfiles and build bundles' },
    { key: strategies.diffOnlyOutput, cap: 'CAP-8', name: 'Unified Diff Editing', desc: 'Outputs diff hunks only (92% output saved)' },
    { key: strategies.agentGuardrails, cap: 'CAP-9', name: 'Agent Loop Guardrails', desc: 'Caps retries at 3 to prevent runaway burn' },
    { key: strategies.smartModelRouting, cap: 'CAP-10', name: 'Smart Model Routing', desc: 'Directs routine tasks to lightweight tier' },
  ];

  for (const r of rows) {
    const icon = r.key ? `$(pass-filled)` : `$(circle-slash)`;
    const status = r.key ? `**${r.name}**` : `~~${r.name}~~ *(disabled)*`;
    md.appendMarkdown(`${icon} **\`${r.cap}\`** ${status} — *${r.desc}*\n\n`);
  }

  md.appendMarkdown(`---\n\n`);
  md.appendMarkdown(`**Active MCP Tools**: \`cache_lookup\` · \`cache_store\` · \`skeleton_view\` · \`prune_context\`\n\n`);
  md.appendMarkdown(`[📊 Open ROI Dashboard](command:aiTokenOptimizer.showDashboard) &nbsp;|&nbsp; [⚙️ Change Profile](command:aiTokenOptimizer.selectProfile) &nbsp;|&nbsp; [⚡ Prune Selection](command:aiTokenOptimizer.pruneSelection)`);

  return md;
}

export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
