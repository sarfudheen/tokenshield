import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, Profile, TOTAL_STRATEGIES } from '../core/config';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';
import { getActiveModel } from '../models/modelDetector';
import { getCodeGraphState } from '../strategies/codegraph';
import { formatCompactTokens, formatCost } from './formatters';

let statusBarItem: vscode.StatusBarItem;

export function createStatusBar(context?: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.name = 'TokenSculpt Hub';
  statusBarItem.command = 'tokensculpt.hub';

  if (context) {
    context.subscriptions.push(
      chatSavingsTracker.onDidChange(() => {
        updateStatusBar();
      }),
      vscode.commands.registerCommand('tokensculpt.hub', showMasterHubQuickPick),
      vscode.commands.registerCommand('tokenshield.hub', showMasterHubQuickPick),
      vscode.commands.registerCommand('tokensculpt.refreshStatus', () => {
        updateStatusBar();
      }),
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
    statusBarItem.text = '$(circle-slash) TS: DEACTIVATED';
    statusBarItem.tooltip = new vscode.MarkdownString('**🛡️ TokenSculpt is Completely DEACTIVATED**\n\nAll optimization directives and exclusions have been stripped from your workspace files.\n\nClick to Reactivate TokenSculpt.');
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

  const formattedTokens = formatCompactTokens(tokensSaved);
  const formattedCost = formatCost(costSaved);

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

  md.appendMarkdown(`### 🛡️ TokenSculpt Control Hub\n\n`);

  const lifetimeTok = chatSavingsTracker.getLifetimeTokensSaved();
  const lifetimeCost = formatCost(chatSavingsTracker.getLifetimeCostSavedUsd());

  md.appendMarkdown(`- **💎 Session #${sessionNum} Savings**: ~\`${tokensSaved.toLocaleString()}\` tokens (\`${costSaved}\`)\n`);
  md.appendMarkdown(`- **🌐 All-Time Lifetime Savings**: ~\`${lifetimeTok.toLocaleString()}\` tokens (\`${lifetimeCost}\`)\n`);
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
    { key: strategies.commentStripper, name: 'License Header Stripper' },
    { key: strategies.testFailureIsolator, name: 'Test Isolator' },
    { key: strategies.rangeSlicing, name: 'Range Slicing' },
    { key: strategies.inlineChatScopePinning, name: 'Inline Scope Lock' },
    { key: strategies.copilotIgnoreGeneration, name: '.copilotignore Rules' },
    { key: strategies.copilotEditsAwareness, name: 'Edit Session Awareness' },
    { key: strategies.threadResetTrigger, name: 'Context Saturation Monitor' },
    { key: strategies.headroomCompression, name: 'Headroom Reversible CCR' },
  ];

  for (const r of rows) {
    const icon = r.key ? `$(pass-filled)` : `$(circle-slash)`;
    md.appendMarkdown(`${icon} ${r.name} &nbsp; `);
  }
  md.appendMarkdown(`\n\n---\n\n`);

  md.appendMarkdown(`[📊 Dashboard](command:tokensculpt.dashboard) &nbsp;|&nbsp; [🔄 New Session](command:tokensculpt.newSession) &nbsp;|&nbsp; [⚙️ Toggle Features](command:tokensculpt.toggleFeature) &nbsp;|&nbsp; [🩺 Health Check](command:tokensculpt.healthCheck) &nbsp;|&nbsp; [⚡ Prune](command:tokensculpt.pruneAndCopy)`);

  return md;
}

async function showMasterHubQuickPick(): Promise<void> {
  const config = getConfig();

  if (!config.enabled) {
    const items: vscode.QuickPickItem[] = [
      {
        label: `$(play) Reactivate TokenSculpt`,
        description: 'Restore all optimization directives and tools',
        detail: 'Re-injects managed blocks into instruction files, enables CodeGraph and exclusions.',
      },
      {
        label: `$(graph) Open Savings Dashboard`,
        description: 'View past sessions and optimization history',
      },
      {
        label: `$(pulse) Run Health Check`,
        description: 'Verify tools, environment and directive status',
      },
    ];
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'TokenSculpt is completely deactivated',
      title: 'TokenSculpt Control Hub (DEACTIVATED)',
    });
    if (!selected) { return; }
    if (selected.label.includes('Reactivate')) {
      vscode.commands.executeCommand('tokensculpt.reactivate');
    } else if (selected.label.includes('Run Health Check')) {
      vscode.commands.executeCommand('tokensculpt.healthCheck');
    } else {
      vscode.commands.executeCommand('tokensculpt.dashboard');
    }
    return;
  }

  const sessionNum = chatSavingsTracker.getSessionNumber();
  const totalTok = chatSavingsTracker.getTotalTokensSaved();
  const totalCost = chatSavingsTracker.getTotalCostSavedUsd();

  const items: vscode.QuickPickItem[] = [
    {
      label: `$(graph) Open Savings Dashboard`,
      description: `Session #${sessionNum}: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
      detail: 'View token and cost savings, live activity log, and feature metrics.',
    },
    {
      label: `$(check) Toggle Individual Features (1-Click Switch)`,
      description: 'Turn any of the 20 optimization features ON or OFF instantly',
      detail: 'Fine-tune behavior without editing JSON settings.',
    },
    {
      label: `$(pulse) Run Health Check (Validate 20 Strategies)`,
      description: 'Verify tools, MCP servers, CodeGraph & directives',
      detail: 'Runs diagnostics across all 20 strategies and outputs report.',
    },
    {
      label: `$(sync) Start New Session (Reset Current Counters)`,
      description: `Currently in Session #${sessionNum}`,
      detail: 'Archive current session savings to history and start counting from 0 tokens.',
    },
    {
      label: `$(trash) Reset Complete Data (Wipe All History)`,
      description: `All-Time: ~${chatSavingsTracker.getLifetimeTokensSaved().toLocaleString()} tokens saved`,
      detail: 'Reset all lifetime statistics, past session archives, and event logs back to Session #1.',
    },
    {
      label: `$(settings-gear) Switch Optimization Profile (Current: ${config.profile.toUpperCase()})`,
      description: 'Full · Debug · Planning · Review · Custom',
      detail: `Instantly toggle presets across all ${TOTAL_STRATEGIES} optimization features.`,
    },
    {
      label: `$(meter) Context Window Budget Breakdown`,
      description: 'View active model limits, buffer sizes, and headroom gauge',
      detail: 'Inspect tokens allocated across active editor, instructions, and workspace.',
    },
    {
      label: `$(calculator) "What If" Multi-Model Cost Simulator`,
      description: 'Compare costs and ROI across GPT-4o, Claude 3.5, Gemini & Haiku',
      detail: 'Simulate how your token savings translate across different model tiers.',
    },
    {
      label: `$(symbol-keyword) Prompt Template Library`,
      description: 'Use or save token-optimized, zero-boilerplate prompts',
      detail: 'Pre-packaged and custom prompt templates for tests, refactoring, and debugging.',
    },
    {
      label: `$(shield) Generate Smart .copilotignore Exclusions`,
      description: 'Scan workspace for heavy directories, locks, and datasets',
      detail: 'Auto-detect non-source bloat to eliminate up to 90% scan token waste.',
    },
    {
      label: `$(circle-slash) Deactivate TokenSculpt Completely`,
      description: 'Strip all directives from workspace files (100% unconstrained AI)',
      detail: 'Removes managed blocks from AGENTS.md, CLAUDE.md, and Copilot files.',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'TokenSculpt Control Hub',
    title: `TokenSculpt Hub — Profile: ${config.profile.toUpperCase()} | Session #${sessionNum}: ~${totalTok.toLocaleString()} tok ($${totalCost.toFixed(4)})`,
  });

  if (!selected) { return; }

  if (selected.label.includes('Open Savings Dashboard')) {
    vscode.commands.executeCommand('tokensculpt.dashboard');
  } else if (selected.label.includes('Toggle Individual Features')) {
    vscode.commands.executeCommand('tokensculpt.toggleFeature');
  } else if (selected.label.includes('Run Health Check')) {
    vscode.commands.executeCommand('tokensculpt.healthCheck');
  } else if (selected.label.includes('Start New Session')) {
    vscode.commands.executeCommand('tokensculpt.newSession');
  } else if (selected.label.includes('Reset Complete Data')) {
    vscode.commands.executeCommand('tokensculpt.resetAllData');
  } else if (selected.label.includes('Switch Optimization Profile')) {
    vscode.commands.executeCommand('tokensculpt.switchProfile');
  } else if (selected.label.includes('Context Window Budget')) {
    vscode.commands.executeCommand('tokensculpt.showContextBudget');
  } else if (selected.label.includes('Multi-Model Cost Simulator')) {
    vscode.commands.executeCommand('tokensculpt.simulateCosts');
  } else if (selected.label.includes('Prompt Template Library')) {
    vscode.commands.executeCommand('tokensculpt.usePromptTemplate');
  } else if (selected.label.includes('Generate Smart .copilotignore')) {
    vscode.commands.executeCommand('tokensculpt.generateSmartExclusions');
  } else if (selected.label.includes('Deactivate TokenSculpt Completely')) {
    vscode.commands.executeCommand('tokensculpt.deactivateCompletely');
  }
}

export function disposeStatusBar(): void {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
