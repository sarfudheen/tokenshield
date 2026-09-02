import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, Profile, TOTAL_STRATEGIES } from '../core/config';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';
import { getActiveModel } from '../models/modelDetector';
import { getCodeGraphState } from '../strategies/codegraph';

let statusBarItem: vscode.StatusBarItem;

export function createStatusBar(context?: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = 'TokenShield Hub';
  statusBarItem.command = 'tokenshield.hub';

  if (context) {
    context.subscriptions.push(
      chatSavingsTracker.onDidChange(() => {
        updateStatusBar();
      }),
      vscode.commands.registerCommand('tokenshield.hub', showMasterHubQuickPick),
      vscode.commands.registerCommand('tokenshield.refreshStatus', () => {
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
  statusBarItem.text = `$(shield) TS: ${profileLabel} · ${formattedTokens} ↓ · ${formattedCost}`;
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

  md.appendMarkdown(`### 🛡️ TokenShield Control Hub\n\n`);

  md.appendMarkdown(`**💎 Session #${sessionNum} Savings**: ~\`${tokensSaved.toLocaleString()}\` tokens saved (\`${costSaved}\`)\n`);
  md.appendMarkdown(`- **Active Engine**: \`${activeModel.name}\` (${activeModel.tier.toUpperCase()} Tier)\n`);
  md.appendMarkdown(`- **Session Started**: \`${sessionStarted.toLocaleTimeString()}\`\n`);
  md.appendMarkdown(`- **CodeGraph Status**: \`${cg.count}\` repository graph(s) indexed & active\n\n`);
  md.appendMarkdown(`---\n\n`);

  md.appendMarkdown(`**Active Optimization Features (${activeCount}/${TOTAL_STRATEGIES} Active - ${profile.toUpperCase()})**:\n`);
  const rows = [
    { key: strategies.codeGraph, name: 'CodeGraph Pre-Indexing' },
    { key: strategies.outputCompression, name: 'CLI Output Compression' },
    { key: strategies.verbosityControl, name: 'Concise Responses' },
    { key: strategies.sessionManagement, name: 'Context Compaction' },
    { key: strategies.semanticCache, name: 'Semantic Cache' },
    { key: strategies.astSkeleton, name: 'AST Skeletons' },
    { key: strategies.contextExclusion, name: 'Context Exclusions' },
    { key: strategies.diffOnlyOutput, name: 'Diff-Only Output' },
    { key: strategies.agentGuardrails, name: 'Loop Guardrails' },
    { key: strategies.smartModelRouting, name: 'Model Routing' },
    { key: strategies.gitDiffContext, name: 'Git Diff Scoping' },
    { key: strategies.kvCacheAlignment, name: 'Prefix Caching' },
    { key: strategies.commentStripper, name: 'Comment Stripper' },
    { key: strategies.testFailureIsolator, name: 'Test Isolator' },
    { key: strategies.rangeSlicing, name: 'Range Slicing' },
    { key: strategies.inlineChatScopePinning, name: 'Inline Scope Lock' },
    { key: strategies.copilotIgnoreGeneration, name: '.copilotignore Rules' },
    { key: strategies.copilotEditsAwareness, name: 'Edit Session Awareness' },
    { key: strategies.threadResetTrigger, name: 'Context Saturation Monitor' },
  ];

  for (const r of rows) {
    const icon = r.key ? `$(pass-filled)` : `$(circle-slash)`;
    md.appendMarkdown(`${icon} ${r.name} &nbsp; `);
  }
  md.appendMarkdown(`\n\n---\n\n`);

  md.appendMarkdown(`[📊 Dashboard](command:tokenshield.dashboard) &nbsp;|&nbsp; [🔄 New Session](command:tokenshield.newSession) &nbsp;|&nbsp; [⚙️ Profile](command:tokenshield.switchProfile) &nbsp;|&nbsp; [⚡ Prune](command:tokenshield.pruneAndCopy)`);

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
      label: `$(graph) Open Savings Dashboard`,
      description: `Session #${sessionNum}: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
      detail: 'View token and cost savings, live activity log, and feature metrics.',
    },
    {
      label: `$(sync) Start New Session (Reset Current Counters)`,
      description: `Currently in Session #${sessionNum}`,
      detail: 'Archive current session savings to history and start counting from 0 tokens.',
    },
    {
      label: `$(database) CodeGraph: ${cg.count} Indexed Graph(s) [Status: ${cg.state.toUpperCase()}]`,
      description: 'Validate or reindex symbol graph',
      detail: 'Run manual synchronization or project graph validation.',
    },
    {
      label: `$(settings-gear) Switch Optimization Profile (Current: ${config.profile.toUpperCase()})`,
      description: 'Full · Debug · Planning · Review · Custom',
      detail: `Instantly toggle presets across all ${TOTAL_STRATEGIES} optimization features.`,
    },
    {
      label: `$(filter) Configure Context Exclusions`,
      description: 'Manage excluded build folders, lockfiles, and minified bundles',
      detail: 'Block non-code artifacts from AI prompt ingestion.',
    },
    {
      label: `$(cloud-download) Export Savings Report`,
      description: 'CSV · JSON · Markdown',
      detail: 'Generate clean token and cost reduction reports.',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'TokenShield Control Hub',
    title: `TokenShield Hub — Profile: ${config.profile.toUpperCase()} | Session #${sessionNum}: ~${totalTok.toLocaleString()} tok ($${totalCost.toFixed(4)})`,
  });

  if (!selected) { return; }

  if (selected.label.includes('Open Savings Dashboard')) {
    vscode.commands.executeCommand('tokenshield.dashboard');
  } else if (selected.label.includes('Start New Session')) {
    vscode.commands.executeCommand('tokenshield.newSession');
  } else if (selected.label.includes('CodeGraph')) {
    vscode.commands.executeCommand('tokenshield.validateGraph');
  } else if (selected.label.includes('Switch Optimization Profile')) {
    vscode.commands.executeCommand('tokenshield.switchProfile');
  } else if (selected.label.includes('Configure Context Exclusions')) {
    vscode.commands.executeCommand('tokenshield.exclusions');
  } else if (selected.label.includes('Export Savings Report')) {
    vscode.commands.executeCommand('tokenshield.exportReport');
  }
}

export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
