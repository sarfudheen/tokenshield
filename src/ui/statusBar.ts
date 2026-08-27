import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, Profile, TOTAL_STRATEGIES } from '../core/config';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';
import { getActiveModel } from '../models/modelDetector';
import { getCodeGraphState } from '../strategies/codegraph';

let statusBarItem: vscode.StatusBarItem;

export function createStatusBar(context?: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = 'TokenShield Hub';
  statusBarItem.command = 'aiTokenOptimizer.showMasterHub';

  if (context) {
    context.subscriptions.push(
      chatSavingsTracker.onDidChange(() => {
        updateStatusBar();
      }),
      vscode.commands.registerCommand('aiTokenOptimizer.showMasterHub', showMasterHubQuickPick),
      vscode.commands.registerCommand('aiTokenOptimizer.updateStatusBarHook', () => {
        updateStatusBar();
      })
    );
  }

  updateStatusBar();
  statusBarItem.show();
  return statusBarItem;
}

export async function updateStatusBar(): Promise<void> {
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
  const tokensSaved = chatSavingsTracker.getTotalTokensSaved();
  const costSaved = chatSavingsTracker.getTotalCostSavedUsd();
  const sessionNum = chatSavingsTracker.getSessionNumber();
  const cg = getCodeGraphState();

  const formattedTokens = tokensSaved >= 1000
    ? `${(tokensSaved / 1000).toFixed(1)}k`
    : `${tokensSaved}`;

  const formattedCost = costSaved < 0.0001 && costSaved > 0
    ? '<$0.0001'
    : `$${costSaved.toFixed(4)}`;

  let cgBadge = '';
  if (cg.state === 'pending') {
    cgBadge = ' [CG:●]';
  } else if (cg.state === 'indexing') {
    cgBadge = ' [CG:sync]';
  } else if (cg.state === 'error') {
    cgBadge = ' [CG:✗]';
  }

  // Clean consolidated badge text: $(shield) TokenShield: Full (10/10) · $(sparkle) 519.9k saved
  statusBarItem.text = `$(shield) TokenShield: ${profileLabel} (${activeCount}/${TOTAL_STRATEGIES})${cgBadge} · $(sparkle) ${formattedTokens} saved`;
  statusBarItem.tooltip = await buildMasterHubMarkdownTooltip(config.profile, strategies, activeCount, tokensSaved, formattedCost, sessionNum, cg);
  statusBarItem.backgroundColor = cg.state === 'error'
    ? new vscode.ThemeColor('statusBarItem.errorBackground')
    : (activeCount < TOTAL_STRATEGIES || cg.state === 'pending')
    ? new vscode.ThemeColor('statusBarItem.warningBackground')
    : undefined;
}

function getProfileShortLabel(profile: Profile): string {
  const labels: Record<Profile, string> = {
    full: 'Full',
    debug: 'Debug',
    planning: 'Plan',
    review: 'Review',
    custom: 'Custom',
  };
  return labels[profile] || 'Full';
}

async function buildMasterHubMarkdownTooltip(
  profile: Profile,
  strategies: ReturnType<typeof getEffectiveStrategies>,
  activeCount: number,
  tokensSaved: number,
  costSaved: string,
  sessionNum: number,
  cg: ReturnType<typeof getCodeGraphState>
): Promise<vscode.MarkdownString> {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;
  const activeModel = await getActiveModel();
  const sessionStarted = chatSavingsTracker.getSessionStartedAt();

  md.appendMarkdown(`### 🛡️ TokenShield Unified Master Hub\n\n`);

  md.appendMarkdown(`**💎 Session #${sessionNum} Savings**: ~\`${tokensSaved.toLocaleString()}\` tokens avoided (\`${costSaved}\`)\n`);
  md.appendMarkdown(`- **Active Engine**: \`${activeModel.name}\` (${activeModel.tier.toUpperCase()} Tier)\n`);
  md.appendMarkdown(`- **Session Started**: \`${sessionStarted.toLocaleTimeString()}\`\n`);
  md.appendMarkdown(`- **CodeGraph Status**: \`${cg.count}\` repository graph(s) indexed & active\n\n`);
  md.appendMarkdown(`---\n\n`);

  md.appendMarkdown(`**Active Optimization Directives (${activeCount}/${TOTAL_STRATEGIES} Active - ${profile.toUpperCase()})**:\n`);
  const rows = [
    { key: strategies.codeGraph, cap: 'CAP-1', name: 'CodeGraph Indexing' },
    { key: strategies.outputCompression, cap: 'CAP-2', name: 'RTK CLI Compression' },
    { key: strategies.verbosityControl, cap: 'CAP-3', name: 'Dense Output (Caveman)' },
    { key: strategies.sessionManagement, cap: 'CAP-4', name: 'Context Hygiene' },
    { key: strategies.semanticCache, cap: 'CAP-5', name: 'Semantic Answer Cache' },
    { key: strategies.astSkeleton, cap: 'CAP-6', name: 'AST Skeleton Pruner' },
    { key: strategies.contextExclusion, cap: 'CAP-7', name: 'Smart Context Exclusion' },
    { key: strategies.diffOnlyOutput, cap: 'CAP-8', name: 'Unified Diff Output' },
    { key: strategies.agentGuardrails, cap: 'CAP-9', name: 'Loop Guardrails' },
    { key: strategies.smartModelRouting, cap: 'CAP-10', name: 'Smart Model Routing' },
    { key: strategies.gitDiffContext, cap: 'CAP-11', name: 'Git Diff Context' },
    { key: strategies.kvCacheAlignment, cap: 'CAP-12', name: 'KV-Cache Alignment' },
    { key: strategies.commentStripper, cap: 'CAP-13', name: 'Comment Stripper' },
    { key: strategies.testFailureIsolator, cap: 'CAP-14', name: 'Test Failure Isolator' },
    { key: strategies.rangeSlicing, cap: 'CAP-15', name: 'Windowed Range Slicing' },
  ];

  for (const r of rows) {
    const icon = r.key ? `$(pass-filled)` : `$(circle-slash)`;
    md.appendMarkdown(`${icon} \`${r.cap}\` ${r.name} &nbsp; `);
  }
  md.appendMarkdown(`\n\n---\n\n`);

  md.appendMarkdown(`[📊 Open ROI Dashboard](command:aiTokenOptimizer.showDashboard) &nbsp;|&nbsp; [🔄 Reset / New Session](command:aiTokenOptimizer.resetSession) &nbsp;|&nbsp; [⚙️ Switch Profile](command:aiTokenOptimizer.selectProfile) &nbsp;|&nbsp; [⚡ Prune Selection](command:aiTokenOptimizer.pruneSelection)`);

  return md;
}

async function showMasterHubQuickPick(): Promise<void> {
  const sessionNum = chatSavingsTracker.getSessionNumber();
  const totalTok = chatSavingsTracker.getTotalTokensSaved();
  const totalCost = chatSavingsTracker.getTotalCostSavedUsd();
  const config = getConfig();
  const cg = getCodeGraphState();

  const items: vscode.QuickPickItem[] = [
    {
      label: `$(graph) Open ROI Savings Dashboard`,
      description: `Session #${sessionNum}: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
      detail: 'View graphical ROI charts, Live Activity Ledger, and strategy efficiency metrics.',
    },
    {
      label: `$(sync) Start New Session (Reset Current Counters)`,
      description: `Currently in Session #${sessionNum}`,
      detail: 'Archive current session savings to history and start counting from 0 tokens.',
    },
    {
      label: `$(database) CodeGraph: ${cg.count} Indexed Graph(s) [Status: ${cg.state.toUpperCase()}]`,
      description: 'Validate or reindex AST symbol graph',
      detail: 'Run manual synchronization or project graph validation.',
    },
    {
      label: `$(settings-gear) Switch Optimization Profile (Current: ${config.profile.toUpperCase()})`,
      description: 'Full · Debug · Planning · Review · Custom',
      detail: 'Instantly toggle presets of the 10 optimization directives.',
    },
    {
      label: `$(filter) Configure Context Exclusions (CAP-7)`,
      description: 'Manage excluded build folders, lockfiles, and minified bundles',
      detail: 'Exclude non-code artifacts from AI prompt ingestion.',
    },
    {
      label: `$(cloud-download) Export Executive Audit Report`,
      description: 'CSV · JSON · Markdown',
      detail: 'Generate auditable token & cost reduction reports for leadership.',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'TokenShield Unified Master Hub',
    title: `TokenShield Hub — Profile: ${config.profile.toUpperCase()} | Session #${sessionNum}: ~${totalTok.toLocaleString()} tok ($${totalCost.toFixed(4)})`,
  });

  if (!selected) { return; }

  if (selected.label.includes('Open ROI Savings Dashboard')) {
    vscode.commands.executeCommand('aiTokenOptimizer.showDashboard');
  } else if (selected.label.includes('Start New Session')) {
    vscode.commands.executeCommand('aiTokenOptimizer.resetSession');
  } else if (selected.label.includes('CodeGraph')) {
    vscode.commands.executeCommand('aiTokenOptimizer.validateIndex');
  } else if (selected.label.includes('Switch Optimization Profile')) {
    vscode.commands.executeCommand('aiTokenOptimizer.selectProfile');
  } else if (selected.label.includes('Configure Context Exclusions')) {
    vscode.commands.executeCommand('aiTokenOptimizer.configureExclusions');
  } else if (selected.label.includes('Export Executive Audit Report')) {
    vscode.commands.executeCommand('aiTokenOptimizer.exportTelemetry');
  }
}

export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
