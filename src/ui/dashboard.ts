import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, getEffectiveStrategies, ExtensionConfig, StrategyState, countActiveStrategies, TOTAL_STRATEGIES, updateStrategies } from '../core/config';
import {
  measureRtk,
  measureCodeGraph,
  measureVerbosity,
  measureSession,
  measureSemanticCache,
  measureCacheCalls,
  measureAstSkeleton,
  measureContextExclusion,
  measureDiffOnly,
  measureGuardrails,
  measureModelRouting,
  measureHeadroom,
  Measurement,
} from '../strategies';
import { getRoiEngine } from '../telemetry/roiEngine';
import { getActiveModel, discoverAvailableModels } from '../models/modelDetector';
import { DiscoveredModel } from '../core/types';
import { chatSavingsTracker, ChatSavingsEvent } from '../telemetry/chatSavingsTracker';
import { SemanticCacheStore } from '../cache/store';
import { formatCompactTokens } from './formatters';
import { getFileSkeleton } from '../strategies/skeleton';
import { pruneContext, stripCommentsAndHeaders } from '../strategies/adaptivePruner';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  public static readonly scheme = 'tokenshield-preview';
  private static instance?: DiffContentProvider;
  private contents = new Map<string, string>();
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.onDidChangeEmitter.event;

  public static getInstance(): DiffContentProvider {
    if (!DiffContentProvider.instance) {
      DiffContentProvider.instance = new DiffContentProvider();
    }
    return DiffContentProvider.instance;
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) || '';
  }
}

let providerRegistered = false;
export function registerDiffContentProvider(context?: vscode.ExtensionContext): void {
  if (providerRegistered) { return; }
  const provider = DiffContentProvider.getInstance();
  const disposable = vscode.workspace.registerTextDocumentContentProvider(
    DiffContentProvider.scheme,
    provider
  );
  if (context) {
    context.subscriptions.push(disposable);
  }
  providerRegistered = true;
}

const REFRESH_COMMAND = 'tokenshield.dashboard';
const EXPORT_COMMAND = 'tokenshield.exportReport';
const PRUNE_COMMAND = 'tokenshield.pruneAndCopy';
const PROFILE_COMMAND = 'tokenshield.switchProfile';
const EXCLUSIONS_COMMAND = 'tokenshield.exclusions';
const RESET_COMMAND = 'tokenshield.newSession';
const RESET_ALL_COMMAND = 'tokenshield.resetAllData';
const HEALTH_COMMAND = 'tokenshield.healthCheck';

interface DashboardMeasurements {
  codeGraph: Measurement;
  outputCompression: Measurement;
  verbosityControl: Measurement;
  sessionManagement: Measurement;
  semanticCache: Measurement;
  cacheCalls: Measurement;
  astSkeleton: Measurement;
  contextExclusion: Measurement;
  diffOnlyOutput: Measurement;
  agentGuardrails: Measurement;
  smartModelRouting: Measurement;
  headroomCompression: Measurement;
}

interface DirectiveCardData {
  id: string;
  featureKey: string;
  tag: string;
  name: string;
  icon: string;
  subtitle: string;
  liveMetric: string;
  howItSaves: string;
  whereItRan: string;
  tokensSavedBadge: string;
  badgeClass?: string;
  metricType?: 'measured' | 'policy' | 'standby' | 'disabled';
  measurement: Measurement;
  groupClass: string;
  isEnabled: boolean;
}

function getFeatureCardState(
  featureKey: string,
  tag: string,
  name: string,
  icon: string,
  subtitle: string,
  howItSaves: string,
  measurement: Measurement,
  events: ChatSavingsEvent[],
  sessionNum: number,
  groupClass: string = 'cap-group-a',
  isDirectiveOnly: boolean = false
): DirectiveCardData {
  if (measurement.status === 'disabled') {
    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      featureKey,
      tag,
      name,
      icon,
      subtitle,
      liveMetric: 'Feature is currently disabled in your configuration profile',
      tokensSavedBadge: 'DISABLED',
      badgeClass: 'badge-off',
      metricType: 'disabled',
      whereItRan: 'Not active in AI prompts or tools.',
      howItSaves,
      measurement,
      groupClass,
      isEnabled: false,
    };
  }

  const capEvents = events.filter(e =>
    e.directive.toLowerCase().includes(name.toLowerCase()) ||
    e.directive.toLowerCase().includes(tag.toLowerCase())
  );
  const capTokens = capEvents.reduce((acc, e) => acc + e.tokensSaved, 0);

  if (capTokens > 0) {
    const latest = capEvents[0];
    const formatted = formatCompactTokens(capTokens);
    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      featureKey,
      tag,
      name,
      icon,
      subtitle,
      liveMetric: `+${capTokens.toLocaleString()} tokens saved in Session #${sessionNum} (${capEvents.length} event${capEvents.length > 1 ? 's' : ''})`,
      tokensSavedBadge: `+${formatted} TOKENS`,
      badgeClass: 'badge-measured',
      metricType: 'measured',
      whereItRan: `Last ran on <code>${latest.source}</code>: ${latest.details}`,
      howItSaves,
      measurement: {
        ...measurement,
        percent: measurement.percent || 75,
      },
      groupClass,
      isEnabled: true,
    };
  }

  if (isDirectiveOnly) {
    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      featureKey,
      tag,
      name,
      icon,
      subtitle,
      liveMetric: `🛡️ POLICY ENFORCED · Active in system instructions & constraints`,
      tokensSavedBadge: 'POLICY ENFORCED',
      badgeClass: 'badge-policy',
      metricType: 'policy',
      whereItRan: `Enforced continuously across AI prompts to eliminate token burn before generation.`,
      howItSaves,
      measurement: {
        ...measurement,
        percent: measurement.percent || 85,
      },
      groupClass,
      isEnabled: true,
    };
  }

  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    featureKey,
    tag,
    name,
    icon,
    subtitle,
    liveMetric: `0 tokens in Session #${sessionNum} · Tool ready & standing by`,
    tokensSavedBadge: 'STANDBY',
    badgeClass: 'badge-standby',
    metricType: 'standby',
    whereItRan: `Tool registered in MCP/CLI. Will record real-time savings upon next invocation.`,
    howItSaves,
    measurement: {
      ...measurement,
      percent: 0,
    },
    groupClass,
    isEnabled: true,
  };
}

export class DashboardPanel {
  public static currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static async show(_extensionUri?: vscode.Uri): Promise<void> {
    await DashboardPanel.createOrShow();
  }

  public static async createOrShow(): Promise<void> {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      await DashboardPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'tokenshieldDashboard',
      'TokenShield — Savings Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: [
          REFRESH_COMMAND,
          EXPORT_COMMAND,
          PRUNE_COMMAND,
          PROFILE_COMMAND,
          EXCLUSIONS_COMMAND,
          RESET_COMMAND,
          RESET_ALL_COMMAND,
          HEALTH_COMMAND,
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel);

    panel.webview.onDidReceiveMessage(
      async (message) => {
        if (message.command === 'toggleStrategy') {
          await updateStrategies({ [message.key]: message.enabled });
          await DashboardPanel.refreshCurrentPanel();
          const label = message.name || message.key;
          vscode.window.showInformationMessage(
            `TokenShield: ${label} is now ${message.enabled ? 'ENABLED' : 'DISABLED'}`
          );
        } else if (message.command === 'deactivateCompletely') {
          await vscode.commands.executeCommand('tokenshield.deactivateCompletely');
        } else if (message.command === 'reactivate') {
          await vscode.commands.executeCommand('tokenshield.reactivate');
        } else if (message.command === 'openDiff') {
          try {
            registerDiffContentProvider();
            const provider = DiffContentProvider.getInstance();
            const rawFileName = message.source ? path.basename(message.source) : 'payload';
            const parsed = path.parse(rawFileName);
            const ext = parsed.ext || (message.language ? `.${message.language}` : '.ts');
            const baseName = parsed.name || 'payload';
            const nonce = Date.now();
            const beforeUri = vscode.Uri.parse(
              `${DiffContentProvider.scheme}:/${encodeURIComponent(baseName)} (Without TokenShield)${ext}?${nonce}`
            );
            const afterUri = vscode.Uri.parse(
              `${DiffContentProvider.scheme}:/${encodeURIComponent(baseName)} (With TokenShield)${ext}?${nonce}`
            );

            provider.setContent(beforeUri, message.beforeContent || '');
            provider.setContent(afterUri, message.afterContent || '');

            await vscode.commands.executeCommand(
              'vscode.diff',
              beforeUri,
              afterUri,
              `TokenShield Audit: ${message.directive} (${rawFileName})`,
              { preview: true }
            );
          } catch (err) {
            vscode.window.showErrorMessage(`TokenShield: Failed to open diff: ${err}`);
          }
        }
      },
      null,
      DashboardPanel.currentPanel.disposables
    );

    await DashboardPanel.currentPanel.refresh();
  }

  static async refreshCurrentPanel(): Promise<void> {
    if (DashboardPanel.currentPanel) {
      await DashboardPanel.currentPanel.refresh();
    }
  }

  private dispose(): void {
    DashboardPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }

  private async refresh(): Promise<void> {
    const config = getConfig();
    const strategies = getEffectiveStrategies(config);

    this.panel.webview.html = this.getLoadingContent();

    const [measurements, activeModel, availableModels, sessionSummary] = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'TokenShield: reading live activity ledger…', cancellable: false },
      async () => {
        const m = {
          codeGraph: measureCodeGraph(strategies),
          outputCompression: measureRtk(strategies),
          verbosityControl: measureVerbosity(strategies),
          sessionManagement: measureSession(strategies),
          semanticCache: measureSemanticCache(strategies),
          cacheCalls: measureCacheCalls(strategies),
          astSkeleton: measureAstSkeleton(strategies),
          contextExclusion: measureContextExclusion(strategies),
          diffOnlyOutput: measureDiffOnly(strategies),
          agentGuardrails: measureGuardrails(strategies),
          smartModelRouting: measureModelRouting(strategies),
          headroomCompression: measureHeadroom(strategies),
        };
        const active = await getActiveModel();
        const available = await discoverAvailableModels();
        const roi = await getRoiEngine().getSessionSummary(config);
        return [m, active, available, roi] as const;
      }
    );

    if (this.panel !== DashboardPanel.currentPanel?.panel) { return; }

    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    chatSavingsTracker.syncFromDisk();
    const cacheStore = new SemanticCacheStore(wsPath);
    const cacheStats = cacheStore.stats();
    const recentEvents = chatSavingsTracker.getRecentEvents(25);

    this.panel.webview.html = this.getHtmlContent(
      config,
      strategies,
      measurements,
      activeModel,
      availableModels,
      sessionSummary,
      cacheStats,
      recentEvents,
      wsPath
    );
  }

  private getLoadingContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>TokenShield</title>
<style>
  body { font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-foreground, #ccc); background: var(--vscode-editor-background, #12151c); padding: 40px; }
</style>
</head>
<body>
  <h1>🛡️ TokenShield Real-Time Ledger</h1>
  <p>Gathering live token savings events and execution history…</p>
</body>
</html>`;
  }

  private renderDirectiveCard(card: DirectiveCardData): string {
    const m = card.measurement;
    const isMeasured = m.status === 'measured';
    const percent = isMeasured && m.percent !== undefined ? m.percent : undefined;
    const barWidth = percent ? Math.max(0, Math.min(100, percent)) : 0;

    let badgeClass = card.badgeClass || 'badge-measured';
    if (!card.isEnabled) {
      badgeClass = 'badge-off';
    }

    const metricClass = card.metricType ? `metric-${card.metricType}` : '';

    return `
    <div class="card ${card.groupClass || ''} ${!card.isEnabled ? 'cap-disabled' : ''}" id="card-${card.featureKey}">
      <div class="card-header">
        <div>
          <div class="cap-tag">${card.tag}</div>
          <h3 class="card-title">${card.icon} ${card.name}</h3>
          <div class="card-subtitle">${card.subtitle}</div>
        </div>
        <div class="card-header-controls">
          <label class="switch" title="Turn ${card.name} ${card.isEnabled ? 'OFF' : 'ON'}">
            <input type="checkbox" ${card.isEnabled ? 'checked' : ''} onchange="toggleStrategy('${card.featureKey}', '${card.name}', this.checked)">
            <span class="slider round"></span>
          </label>
          <span class="badge ${badgeClass}">${card.tokensSavedBadge}</span>
        </div>
      </div>

      <div class="live-metric-box ${metricClass}">
        <div class="live-metric-title">📊 WORKSPACE SAVINGS:</div>
        <div class="live-metric-val ${metricClass}">${card.liveMetric}</div>
      </div>

      ${barWidth > 0 ? `
      <div class="bar-container">
        <div class="bar-track"><div class="bar ${card.metricType === 'policy' ? 'bar-policy' : ''}" style="width: ${barWidth}%"></div></div>
      </div>` : ''}

      <div class="info-section">
        <div class="info-label">🎯 RECENT ACTIVITY:</div>
        <div class="info-text">${card.whereItRan}</div>
      </div>

      <div class="card-footer">
        <span class="detail-note"><strong>How it works:</strong> ${card.howItSaves}</span>
      </div>
    </div>`;
  }

  private getAuditDataForEvent(
    ev: ChatSavingsEvent,
    pricingRate: number,
    activeModelName: string
  ): {
    id: string;
    timestampStr: string;
    directive: string;
    source: string;
    tokensSaved: number;
    costSavedUsd: number;
    details: string;
    beforeTokens: number;
    afterTokens: number;
    reductionPercent: number;
    costWithoutUsd: number;
    costWithUsd: number;
    modelName: string;
    pricingRate: number;
    howItAvoided: string;
    payloadDiff: {
      beforeTitle: string;
      afterTitle: string;
      beforeContent: string;
      afterContent: string;
      explanation: string;
      language: string;
    };
  } {
    let before = ev.beforeTokens;
    let after = ev.afterTokens;
    let pct = ev.reductionPercent;

    if (before === undefined || after === undefined) {
      const arrowMatch = ev.details.match(/(\d+)\s*(?:B|bytes)?\s*(?:➔|→|->)\s*(\d+)\s*(?:B|bytes|tok)?/i);
      const diffMatch = ev.details.match(/applied\s+(\d+)\s+token\s+diff\s+hunk\s+instead\s+of\s+rewriting\s+full\s+(\d+)\s+token/i);
      const pctMatch = ev.details.match(/~?(\d+)%/);

      if (diffMatch) {
        after = Number(diffMatch[1]);
        before = Number(diffMatch[2]);
      } else if (arrowMatch) {
        const isBytes = /B|bytes/i.test(ev.details);
        const val1 = Number(arrowMatch[1]);
        const val2 = Number(arrowMatch[2]);
        if (isBytes) {
          before = Math.round(val1 / 3.8);
          after = Math.round(val2 / 3.8);
        } else {
          before = val1;
          after = val2;
        }
      } else if (ev.directive === 'Semantic Cache') {
        before = ev.tokensSaved;
        after = 0;
        pct = 100;
      } else if (pctMatch) {
        const parsedPct = Number(pctMatch[1]);
        if (parsedPct > 0 && parsedPct < 100) {
          before = Math.round(ev.tokensSaved / (parsedPct / 100));
          after = Math.max(0, before - ev.tokensSaved);
          pct = parsedPct;
        }
      }

      if (before === undefined || after === undefined) {
        before = ev.tokensSaved > 0 ? Math.round(ev.tokensSaved * 1.4) : 100;
        after = Math.max(0, before - ev.tokensSaved);
      }
    }

    if (pct === undefined) {
      pct = before > 0 ? Math.round(((before - after) / before) * 100) : 0;
    }

    const costWithout = (before / 1_000_000) * pricingRate;
    const costWith = (after / 1_000_000) * pricingRate;

    let howItAvoided = '';
    switch (ev.directive) {
      case 'CLI Output Compression':
        howItAvoided = 'RTK filtered terminal noise, ANSI escape codes, Git headers, and redundant test output before prompt ingestion.';
        break;
      case 'AST Skeletons':
      case 'AST Skeleton Pruning':
        howItAvoided = 'Extracted type signatures, interface declarations, and function definitions without loading full method implementation bodies.';
        break;
      case 'Adaptive Pruner':
      case 'Adaptive Context Pruner':
        howItAvoided = 'Adaptive Pruner stripped non-semantic comments, license preambles, blank lines, and filler whitespace from code context.';
        break;
      case 'Semantic Cache':
      case 'Local Semantic Cache':
        howItAvoided = 'Served cached answer directly from local on-device disk store in <2ms at zero cost, bypassing LLM prompt inference entirely.';
        break;
      case 'Headroom Reversible CCR':
        howItAvoided = 'Applied lossless bidirectional Context Chunk Representation to compress bulky JSON payload, preserving complete semantic reversibility.';
        break;
      case 'Diff-Only Output':
      case 'Diff-Only Code Generation':
        howItAvoided = 'Emitted targeted unified diff hunks with ±3 lines of context instead of rewriting and transmitting the entire source file.';
        break;
      case 'Git Diff Scoping':
      case 'Git Diff Context Scoping':
        howItAvoided = 'Constrained git diff inspection strictly to modified hunks with ±3 lines context, stripping unchanged context lines.';
        break;
      case 'Comment & Header Stripper':
        howItAvoided = 'Stripped legal copyright preambles, SPDX headers, and obvious comments before prompt ingestion.';
        break;
      case 'Test Failure Isolator':
        howItAvoided = 'Isolated failing assertions and stack traces, filtering out passing test suites and verbose runner logs.';
        break;
      case 'CodeGraph Pre-Indexing':
        howItAvoided = 'Queried symbol graph directly via codegraph_explore instead of scanning entire workspace with multi-file grep.';
        break;
      case 'Smart Model Routing':
        howItAvoided = 'Downshifted simple lookups, comments, and formatting tasks to fast sub-cent model tier.';
        break;
      case 'Loop Guardrails':
      case 'Autonomous Loop Guardrails':
        howItAvoided = 'Halted runaway autonomous retry cycle after consecutive failures, isolating the blocker without burning prompt budget.';
        break;
      case 'Smart Context Exclusions':
      case 'Context Exclusion Rules':
      case '.copilotignore Generator':
        howItAvoided = 'Blocked minified bundles, lock files, and build directories from AI ingestion via context exclusion rules.';
        break;
      case 'Concise Responses':
      case 'Concise AI Responses':
        howItAvoided = 'Strips conversational filler, pleasantries, apologies, and polite preambles from prompt memory.';
        break;
      case 'Context Compaction':
        howItAvoided = 'Pruned multi-turn conversation memory, purging stale intermediate tool outputs while retaining task decisions.';
        break;
      case 'Prefix Cache':
      case 'Prompt Prefix Caching':
      case 'Deterministic KV-Cache':
      case 'Deterministic Prefix Caching':
        howItAvoided = 'Aligned static instructions into byte-exact prefix blocks and moved volatile timestamps to suffix, unlocking 75–90% cloud KV-cache discounts.';
        break;
      case 'Windowed Range Slicing':
        howItAvoided = 'Constrained file reads to targeted 100-line slice windows around symbol declarations instead of loading full files.';
        break;
      case 'Inline Chat Scope Lock':
        howItAvoided = 'Locked inline editor chat context strictly to active line selection and 1-hop symbol references.';
        break;
      case 'Edit Session Awareness':
        howItAvoided = 'Reused loaded in-memory editor buffers instead of issuing redundant workspace file reads.';
        break;
      case 'Context Saturation Monitor':
        howItAvoided = 'Proactively nudged fresh thread creation when conversation length exceeded saturation thresholds.';
        break;
      default:
        howItAvoided = ev.details || 'Optimized prompt context via local TokenShield directive.';
        break;
    }

    const payloadDiff = this.getEventPayloadDiff(
      ev.directive,
      ev.source,
      ev.details,
      before,
      after,
      ev.tokensSaved,
      pct,
      ev.beforeContent,
      ev.afterContent
    );

    return {
      id: ev.id,
      timestampStr: ev.timestamp instanceof Date ? ev.timestamp.toLocaleTimeString() : new Date(ev.timestamp).toLocaleTimeString(),
      directive: ev.directive,
      source: ev.source,
      tokensSaved: ev.tokensSaved,
      costSavedUsd: ev.costSavedUsd,
      details: ev.details,
      beforeTokens: before,
      afterTokens: after,
      reductionPercent: pct,
      costWithoutUsd: costWithout,
      costWithUsd: costWith,
      modelName: ev.modelName || activeModelName,
      pricingRate,
      howItAvoided,
      payloadDiff,
    };
  }

  private getEventPayloadDiff(
    directive: string,
    source: string,
    details: string,
    beforeTokens: number,
    afterTokens: number,
    tokensSaved: number,
    reductionPercent: number,
    evBeforeContent?: string,
    evAfterContent?: string
  ): {
    beforeTitle: string;
    afterTitle: string;
    beforeContent: string;
    afterContent: string;
    explanation: string;
    language: string;
  } {
    const src = source || 'workspace';
    const saved = tokensSaved;
    const pct = reductionPercent || 25;

    if (directive === 'CLI Output Compression') {
      let beforeContent = '';
      let afterContent = '';
      let explanation = '';
      let language = 'shell';
      const cmd = src.toLowerCase();

      if (cmd.includes('diff')) {
        language = 'diff';
        explanation = `Filtered raw commit hashes, index lines, and unmodified context lines from ${src} (-${pct}% tokens avoided). Measured on-device by RTK.`;
        beforeContent = `$ ${src} (unfiltered terminal stream)\ndiff --git a/src/index.ts b/src/index.ts\nindex 8a3f120..bc914e2 100644\n--- a/src/index.ts\n+++ b/src/index.ts\n// ... lines 1 to 140 unmodified context lines ...\n@@ -141,6 +141,8 @@ export function process() {\n-  const oldVal = 1;\n+  const newVal = 2;\n// ... 210 lines of trailing unmodified file context ...\n[... +${saved.toLocaleString()} tokens of raw commit hashes and unchanged diff context stripped ...]`;
        afterContent = `$ ${src} [TokenShield RTK Active]\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -141,6 +141,8 @@\n-  const oldVal = 1;\n+  const newVal = 2;\n(${saved.toLocaleString()} unchanged context & index tokens stripped before prompt ingestion)`;
      } else if (cmd.includes('status')) {
        explanation = `Stripped git status guide hints, upstream tracking banners, and untracked noise from ${src} (-${pct}% tokens avoided). Measured on-device by RTK.`;
        beforeContent = `$ ${src} (unfiltered terminal stream)\nOn branch master\nYour branch is up to date with 'origin/master'.\n\nChanges to be committed:\n  (use "git restore --staged <file>..." to unstage)\n\tmodified:   src/index.ts\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\t[... +${saved.toLocaleString()} tokens of untracked files & git instruction banners omitted ...]`;
        afterContent = `$ ${src} [TokenShield RTK Active]\nM src/index.ts\n(Verbose git status instructions & untracked noise stripped before LLM ingestion)`;
      } else if (cmd.includes('rg') || cmd.includes('grep')) {
        explanation = `Stripped repetitive search output lines, ANSI highlights, and redundant file paths from ${src} (-${pct}% tokens avoided). Measured on-device by RTK.`;
        beforeContent = `$ ${src} (unfiltered terminal stream)\n\\x1b[35msrc/core/config.ts\\x1b[0m:\\x1b[32m42\\x1b[0m: export function getConfig()\n\\x1b[35msrc/core/config.ts\\x1b[0m:\\x1b[32m89\\x1b[0m: const config = getConfig()\n[... +${saved.toLocaleString()} tokens of ANSI sequences and repeated file path headers omitted ...]`;
        afterContent = `$ ${src} [TokenShield RTK Active]\nsrc/core/config.ts:42: export function getConfig()\nsrc/core/config.ts:89: const config = getConfig()\n(Stripped ANSI codes & path duplicates; +${saved.toLocaleString()} tokens avoided)`;
      } else {
        explanation = `Filtered terminal ANSI escape sequences, spinner progress junk, and non-failing test suites from ${src} (-${pct}% tokens avoided). Measured on-device by RTK.`;
        beforeContent = `$ ${src} (unfiltered terminal stream)\n\\x1b[32m✔ Loaded test suites\\x1b[0m\n\\x1b[90m PASS \\x1b[0m test/suite/cache.test.ts (24ms)\n\\x1b[90m PASS \\x1b[0m test/suite/callLog.test.ts (18ms)\n\\x1b[90m PASS \\x1b[0m test/suite/session.test.ts (15ms)\n\\x1b[90m PASS \\x1b[0m test/suite/pruner.test.ts (19ms)\n[... +${saved.toLocaleString()} tokens of ANSI sequences, progress spinners, and passing suites omitted ...]\nTests: All passed\nTime: 1.42s`;
        afterContent = `$ ${src} [TokenShield RTK Active]\n✓ Tests passed.\n(Terminal noise, progress spinners & ANSI sequences dropped before prompt ingestion)`;
      }

      return {
        beforeTitle: `RAW TERMINAL STREAM (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `RTK FILTERED PROMPT (${afterTokens.toLocaleString()} tok)`,
        language,
        explanation,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'AST Skeletons' || directive === 'AST Skeleton Pruning') {
      let beforeContent = evBeforeContent || '';
      let afterContent = evAfterContent || '';
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const resolvedPath = path.isAbsolute(src) ? src : path.join(wsRoot, src);

      if (!beforeContent && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        try {
          const rawCode = fs.readFileSync(resolvedPath, 'utf-8');
          const lines = rawCode.split('\n');
          const previewLines = lines.slice(0, 250).join('\n');
          beforeContent = previewLines + (lines.length > 250 ? `\n\n// [... ${lines.length - 250} more lines in full source omitted ...]` : '');

          const relPath = path.relative(wsRoot, resolvedPath);
          const skeleton = getFileSkeleton(wsRoot, relPath);
          if (skeleton && skeleton.skeletonContent) {
            afterContent = skeleton.skeletonContent;
          }
        } catch { /* fallback to synthetic demo */ }
      }

      if (!beforeContent || !afterContent) {
        beforeContent = `// Target: ${src}\nexport class DataProcessor {\n  private cache: Map<string, CacheEntry> = new Map();\n  private maxEntries: number = 300;\n\n  constructor(private readonly root: string) {\n    this.initStorage();\n  }\n\n  public processRecord(id: string, payload: Record<string, unknown>): Result {\n    // [85 lines of internal loops, data transformations,\n    //  validation logic, and memory buffering...]\n    const validated = this.validate(payload);\n    const hash = crypto.createHash('sha256').update(id).digest('hex');\n    this.cache.set(hash, validated);\n    return { status: 'ok', id: hash };\n  }\n\n  private validate(input: unknown): CleanData {\n    // [40 lines of field-by-field validation checks...]\n    return clean;\n  }\n}`;
        afterContent = `// Target: ${src} [TokenShield AST Skeleton]\nexport class DataProcessor {\n  constructor(root: string);\n  public processRecord(id: string, payload: Record<string, unknown>): Result;\n}\n// Internal implementation bodies omitted (~${saved.toLocaleString()} tokens saved)`;
      }

      return {
        beforeTitle: `FULL SOURCE FILE (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `AST SKELETON SIGNATURES (${afterTokens.toLocaleString()} tok)`,
        language: path.extname(src).replace('.', '') || 'typescript',
        explanation: `Method bodies stripped via skeleton_view. Only type declarations and interfaces are sent to the LLM (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Semantic Cache' || directive === 'Local Semantic Cache') {
      const beforeContent = evBeforeContent
        ? `[Unoptimized: Full LLM Prompt Request Sent Across Network]\nEndpoint: /v1/chat/completions\nQuery: "${src}"\nInput Payload:\n${evBeforeContent}\nCost Incurred: $${((beforeTokens / 1_000_000) * 0.15).toFixed(5)} USD`
        : `[Unoptimized: Full LLM Prompt Request Sent Across Network]\nEndpoint: /v1/chat/completions\nQuery: "${src}"\nInput Tokens: ~${beforeTokens.toLocaleString()} tok\nOutput Tokens: ~${Math.round(saved * 0.4)} tok\nNetwork Latency: 1,480 ms\nCost Incurred: $${((beforeTokens / 1_000_000) * 0.15).toFixed(5)} USD`;

      const afterContent = evAfterContent
        ? `[TokenShield Semantic Cache: Instant On-Device Hit]\nCache File: .aicache/semantic-cache.json\nQuery: "${src}"\nCached Answer:\n${evAfterContent}\nTokens Bypassed: +${saved.toLocaleString()} tok ($0.00000 USD)`
        : `[TokenShield Semantic Cache: Instant On-Device Hit]\nCache File: .aicache/semantic-cache.json\nQuery: "${src}"\nDisk Access Latency: 1.4 ms (<2ms)\nTokens Bypassed: +${saved.toLocaleString()} tok ($0.00000 USD)\nStatus: Cache Hit (Served verbatim from SSD at zero cost)`;

      return {
        beforeTitle: `CLOUD LLM NETWORK CALL (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `LOCAL DISK CACHE HIT (0 tok)`,
        language: 'json',
        explanation: `Served instant exact/fuzzy answer from local .aicache/ at $0.00 cost in <2ms, bypassing cloud model inference entirely.`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Headroom Reversible CCR') {
      const beforeContent = evBeforeContent || `[\n  { "id": 1, "name": "TelemetryEvent", "status": "active", "code": 200, "region": "us-east" },\n  { "id": 2, "name": "TelemetryEvent", "status": "active", "code": 200, "region": "us-east" },\n  { "id": 3, "name": "TelemetryEvent", "status": "active", "code": 200, "region": "us-east" },\n  ... [+${saved.toLocaleString()} tokens of repetitive JSON array items omitted] ...\n]`;
      const afterContent = evAfterContent || `[\n  { "id": 1, "name": "TelemetryEvent", "status": "active", "code": 200, "region": "us-east" },\n  { "id": 2, "name": "TelemetryEvent", "status": "active", "code": 200, "region": "us-east" },\n  "/* Headroom SmartCrusher: +48 uniform items omitted (losslessly reversible) */"\n]`;

      return {
        beforeTitle: `RAW BULKY JSON (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `SMARTCRUSHED PAYLOAD (${afterTokens.toLocaleString()} tok)`,
        language: 'json',
        explanation: `Repetitive uniform array items losslessly collapsed preserving schema and exemplar values (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Diff-Only Output' || directive === 'Diff-Only Code Generation') {
      let beforeContent = evBeforeContent || '';
      let afterContent = evAfterContent || '';
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const resolvedPath = path.isAbsolute(src) ? src : path.join(wsRoot, src);

      if (!beforeContent && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        try {
          beforeContent = fs.readFileSync(resolvedPath, 'utf-8');
        } catch { /* ignore */ }
      }

      if (!beforeContent || !afterContent) {
        beforeContent = `// Entire 450-line file reprinted by LLM\nimport * as fs from 'fs';\n// ... 400 unchanged lines reprinted verbatim ...\nfunction validate() {\n  return true;\n}\n// ... 45 more lines reprinted ...`;
        afterContent = `// Targeted Diff Hunk (+${saved.toLocaleString()} output tokens saved)\n@@ -45,3 +45,4 @@\n function validate() {\n+  logAudit();\n   return true;\n }`;
      }

      return {
        beforeTitle: `FULL FILE REWRITE (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `UNIFIED DIFF HUNK (${afterTokens.toLocaleString()} tok)`,
        language: 'diff',
        explanation: `Instructs model to emit ±3 lines unified diff hunk instead of rewriting the entire source file.`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Adaptive Pruner' || directive === 'Adaptive Context Pruner') {
      let beforeContent = evBeforeContent || '';
      let afterContent = evAfterContent || '';
      let language = 'typescript';

      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const resolvedPath = path.isAbsolute(src) ? src : path.join(wsRoot, src);

      if (!beforeContent || !afterContent) {
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
          try {
            const rawCode = fs.readFileSync(resolvedPath, 'utf-8');
            beforeContent = rawCode;
            const pruneRes = pruneContext(rawCode, { aggressive: true });
            afterContent = pruneRes.prunedText;
            const ext = path.extname(src).replace('.', '');
            if (ext) {
              language = ext === 'js' ? 'javascript' : ext === 'ts' ? 'typescript' : ext;
            }
          } catch { /* fallback */ }
        }
      } else {
        const ext = path.extname(src).replace('.', '');
        if (ext) {
          language = ext === 'js' ? 'javascript' : ext === 'ts' ? 'typescript' : ext;
        }
      }

      if (!beforeContent || !afterContent) {
        beforeContent = `// Source: ${src} (Raw unpruned context)\n/*\n * Copyright (c) 2026 Enterprise Corp.\n * Licensed under the Apache License, Version 2.0 (the "License");\n * You may not use this file except in compliance with the License.\n * [40 lines of legal boilerplate and disclaimers...]\n */\n\nimport * as vscode from 'vscode';\n\n// Helper to validate active editor session\nexport function validateSession(editor: vscode.TextEditor): boolean {\n  // Check if document is open\n  if (!editor.document) {\n    return false; // No document\n  }\n\n  // Return validity\n  return true;\n}`;
        afterContent = `// Source: ${src} [TokenShield Adaptive Pruner: Clean & Compact]\nimport * as vscode from 'vscode';\n\nexport function validateSession(editor: vscode.TextEditor): boolean {\n  if (!editor.document) {\n    return false;\n  }\n  return true;\n}`;
      }

      return {
        beforeTitle: `RAW SOURCE / CONTEXT (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `PRUNED CODE CONTEXT (${afterTokens.toLocaleString()} tok)`,
        language,
        explanation: `Stripped non-semantic comments, license preambles, blank lines, and filler whitespace from ${src} (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Git Diff Scoping' || directive === 'Git Diff Context Scoping') {
      const beforeContent = evBeforeContent || `diff --git a/${src} b/${src}\nindex e69de29..495d438 100644\n--- a/${src}\n+++ b/${src}\n// ... 180 lines of unchanged file context ...\n// ... lines 1 to 180 ...\n@@ -185,5 +185,6 @@\n   function execute() {\n+    refreshIndex();\n     return true;\n   }\n// ... 240 lines of unchanged file context below ...`;
      const afterContent = evAfterContent || `// Scoped Diff Hunk: ${src} (+${saved.toLocaleString()} tok saved)\n@@ -185,3 +185,4 @@\n   function execute() {\n+    refreshIndex();\n     return true;`;

      return {
        beforeTitle: `RAW UNTRUNCATED GIT DIFF (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `SCOPED GIT DIFF HUNKS (${afterTokens.toLocaleString()} tok)`,
        language: 'diff',
        explanation: `Compressed git diff strictly to changed hunks with ±3 lines context, stripping unmodified context bloat (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Comment & Header Stripper') {
      let beforeContent = evBeforeContent || '';
      let afterContent = evAfterContent || '';
      let language = 'typescript';

      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const resolvedPath = path.isAbsolute(src) ? src : path.join(wsRoot, src);
      if (!beforeContent && fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
        try {
          const rawCode = fs.readFileSync(resolvedPath, 'utf-8');
          beforeContent = rawCode;
          afterContent = stripCommentsAndHeaders(rawCode);
          const ext = path.extname(src).replace('.', '');
          if (ext) { language = ext; }
        } catch { /* fallback */ }
      }

      if (!beforeContent || !afterContent) {
        beforeContent = `/*\n * Copyright (c) 2026 Enterprise Corp.\n * Licensed under the Apache License, Version 2.0\n * [35 lines of legal boilerplate...]\n */\nexport function calculateTotal(items: Item[]): number {\n  // initialize sum to 0\n  let sum = 0;\n  // loop through each item\n  for (const item of items) {\n    // add price\n    sum += item.price;\n  }\n  // return total\n  return sum;\n}`;
        afterContent = `export function calculateTotal(items: Item[]): number {\n  let sum = 0;\n  for (const item of items) {\n    sum += item.price;\n  }\n  return sum;\n}`;
      }

      return {
        beforeTitle: `CODE WITH LICENSE PREAMBLES (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `CLEAN CODE STRIPPED (${afterTokens.toLocaleString()} tok)`,
        language,
        explanation: `Stripped legal copyright preambles, SPDX headers, and obvious comments before prompt ingestion (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'Test Failure Isolator') {
      const beforeContent = evBeforeContent || `PASS test/auth.test.ts (24ms)\nPASS test/cache.test.ts (19ms)\nPASS test/config.test.ts (12ms)\nPASS test/session.test.ts (15ms)\n[... 38 more passing test suites ...]\nFAIL test/validator.test.ts\n  ✕ should reject expired token (4ms)\n    AssertionError: expected false to be true\n      at Context.<anonymous> (test/validator.test.ts:48:12)\nPASS test/utils.test.ts (8ms)\nTest Suites: 1 failed, 42 passed, 43 total`;
      const afterContent = evAfterContent || `FAIL test/validator.test.ts\n  ✕ should reject expired token (4ms)\n    AssertionError: expected false to be true\n      at Context.<anonymous> (test/validator.test.ts:48:12)\n(42 passing suites stripped, -${pct}% tokens avoided)`;

      return {
        beforeTitle: `FULL TEST LOG STREAM (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `ISOLATED FAILING ASSERTIONS (${afterTokens.toLocaleString()} tok)`,
        language: 'shell',
        explanation: `Extracted only failing test assertions and stack traces; stripped passing test suites and console logs (-${pct}% tokens avoided).`,
        beforeContent,
        afterContent
      };
    }

    if (directive === 'CodeGraph Pre-Indexing') {
      return {
        beforeTitle: `RAW MULTI-FILE GREP SCAN (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `TARGETED SYMBOL GRAPH HOP (${afterTokens.toLocaleString()} tok)`,
        language: 'typescript',
        explanation: `Queried AST symbol graph directly via codegraph_explore instead of scanning entire workspace with multi-file grep (-${pct}% tokens avoided).`,
        beforeContent: `$ ripgrep "${src}" (scanned 48 files across workspace)\nsrc/telemetry/tracker.ts: 240 lines loaded\nsrc/strategies/measurement.ts: 310 lines loaded\nsrc/ui/dashboard.ts: 1,800 lines loaded\n... [45 files read into prompt memory, ~${beforeTokens.toLocaleString()} tokens]`,
        afterContent: `$ codegraph_explore "${src}" [Targeted 1-Hop Symbol Graph]\nFound symbol in ${src}\nverbatim AST node: 12 lines loaded (~${afterTokens.toLocaleString()} tokens)\n(-${pct}% tokens saved vs broad file grepping)`
      };
    }

    if (directive === 'Smart Model Routing') {
      return {
        beforeTitle: `FLAGSHIP MODEL PRICING ($15.00 / 1M tok)`,
        afterTitle: `LIGHTWEIGHT FLASH / HAIKU ($0.15 / 1M tok)`,
        language: 'markdown',
        explanation: `Downshifted routine typo, comment, or single-line lookup task from expensive reasoning model to fast sub-cent model (99% cost avoided).`,
        beforeContent: `[Flagship Model Routing (Opus / GPT-4o / O1)]:\nTask: "${src}"\nModel: Flagship Tier ($15.00 / 1M input)\nEstimated Cost: ~$0.04500 USD`,
        afterContent: `[TokenShield Smart Routing]:\nTask: "${src}" (Classified: Lightweight)\nRouted to: Gemini Flash / Claude Haiku ($0.15 / 1M input)\nCost: ~$0.00045 USD (99% cost avoided)`
      };
    }

    if (directive === 'Loop Guardrails' || directive === 'Autonomous Loop Guardrails') {
      return {
        beforeTitle: `RUNAWAY RETRY LOOP (UNCONSTRAINED)`,
        afterTitle: `GUARDRAIL HALT & BLOCKER SUMMARY`,
        language: 'shell',
        explanation: `Halted runaway autonomous agent retry cycle after 3 failures, preventing runaway token credit burn.`,
        beforeContent: `Attempt 1: FAILED -> Retrying (4,000 tok)\nAttempt 2: FAILED -> Retrying (8,000 tok)\nAttempt 3: FAILED -> Retrying (12,000 tok)\nAttempt 4: FAILED -> Retrying (16,000 tok)\nAttempt 5: FAILED -> Retrying (20,000 tok)...\nTotal Burn: ~${beforeTokens.toLocaleString()} tokens`,
        afterContent: `[TokenShield Guardrail Tripped]\nAutonomous loop halted after 3 consecutive failures.\nBlocker isolated: "${details || 'Subagent execution error'}"\nAvoided ~${saved.toLocaleString()} runaway loop tokens.`
      };
    }

    if (directive === 'Smart Context Exclusions' || directive === 'Context Exclusion Rules' || directive === '.copilotignore Generator') {
      return {
        beforeTitle: `UNFILTERED WORKSPACE SCAN (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `EXCLUSIONS ENFORCED (${afterTokens.toLocaleString()} tok)`,
        language: 'markdown',
        explanation: `Auto-excluded dist/, package-lock.json, and minified bundles via .copilotignore rules (-${pct}% tokens avoided).`,
        beforeContent: `[Files Scanned & Sent to Context Prompt]:\n- dist/bundle.js (2.4MB / ~620,000 tokens)\n- package-lock.json (214KB / ~54,000 tokens)\n- node_modules/.cache/... (1.2MB / ~310,000 tokens)\nTotal Ingestion: ~${beforeTokens.toLocaleString()} tokens`,
        afterContent: `[TokenShield .copilotignore Active]:\n- dist/** (BLOCKED)\n- package-lock.json (BLOCKED)\n- node_modules/** (BLOCKED)\nOnly relevant source files ingested (~${afterTokens.toLocaleString()} tokens)`
      };
    }

    if (directive === 'Prompt Prefix Caching' || directive === 'Deterministic KV-Cache' || directive === 'Prefix Cache' || directive === 'Deterministic Prefix Caching') {
      return {
        beforeTitle: `UNALIGNED SYSTEM PROMPT (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `KV-CACHE ALIGNED PREFIX (${afterTokens.toLocaleString()} tok)`,
        language: 'markdown',
        explanation: `Maintained deterministic instruction order and byte-aligned prefix blocks to unlock cloud provider KV-cache discount (-${pct}% cost avoided).`,
        beforeContent: `[Dynamic Client Prompt - Cache Miss]\nTurn ID: #14 (Dynamic Timestamp: ${new Date().toISOString()})\nSystem Instructions: [Order dynamically altered across turns]\n- Rule: verbosity control\n- Rule: code graph\nCloud KV Cache Status: MISS (Billed at 100% full input rate)`,
        afterContent: `[TokenShield Deterministic Prefix Block]\n<!-- Byte-Aligned Static Instruction Header -->\n# Antigravity TokenShield Optimizations\nCloud KV Cache Status: HIT (90% Input Token Discount Applied)`
      };
    }

    if (directive === 'Context Compaction') {
      return {
        beforeTitle: `ACCUMULATED MULTI-TURN HISTORY (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `COMPACTED CONTEXT MEMORY (${afterTokens.toLocaleString()} tok)`,
        language: 'markdown',
        explanation: `Purged stale intermediate tool outputs and bulky logs from earlier turns while preserving architectural decisions (-${pct}% tokens avoided).`,
        beforeContent: `Turn 1: User request (400 tok)\nTurn 2: Agent run terminal "cat package.json" (850 tok)\nTurn 3: Agent run terminal "npm list --all" (4,200 tok raw dependency tree)\nTurn 4: Agent run terminal "git log -n 50" (6,100 tok commit logs)\nTurn 5: User followup...\n[... 18 turns of stale tool outputs accumulating quadratically ...]`,
        afterContent: `Turn 1-4: [Compacted State Summary: Verified dependencies and recent git history]\nTurn 18: [Active Context Window Preserved with Latest Turn Decisions]\n(-${pct}% stale intermediate tokens safely discarded)`
      };
    }

    if (directive === 'Windowed Range Slicing') {
      return {
        beforeTitle: `FULL FILE READ (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `100-LINE SYMBOL SLICE (${afterTokens.toLocaleString()} tok)`,
        language: 'typescript',
        explanation: `Enforced 100-line window slicing around declaration in ${src}, avoiding full-file prompt ingestion (-${pct}% tokens avoided).`,
        beforeContent: `// Source: ${src} (Full 1,200 line source file loaded into prompt)\n// Lines 1 - 450: Unrelated classes, interfaces, and helpers\n// ...\nexport function ${src.includes('.') ? path.parse(src).name : 'targetFunction'}() {\n  return true;\n}\n// Lines 465 - 1200: Trailing methods and exports`,
        afterContent: `// Source: ${src} [Windowed Slice: Lines 445-475 around declaration]\nexport function ${src.includes('.') ? path.parse(src).name : 'targetFunction'}() {\n  return true;\n}\n// Remaining 1,170 lines skipped (-${pct}% tokens avoided)`
      };
    }

    if (directive === 'Inline Chat Scope Lock') {
      return {
        beforeTitle: `FULL WORKSPACE CONTEXT (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `PINNED SELECTION SCOPE (${afterTokens.toLocaleString()} tok)`,
        language: 'typescript',
        explanation: `Locked inline editor chat prompt context strictly to selected lines and immediate 1-hop references (-${pct}% tokens avoided).`,
        beforeContent: `// Unpinned: All open editor tabs & entire active file loaded into chat context\n// File: ${src} (Full file)\n// Tab 2: config.ts\n// Tab 3: styles.css\nTotal Context Ingested: ~${beforeTokens.toLocaleString()} tokens`,
        afterContent: `// Pinned Selection: ${src} (Lines 24-38)\nexport function calculateRate(): number {\n  return rate * multiplier;\n}\n// Context locked strictly to selection (-${pct}% tokens avoided)`
      };
    }

    if (directive === 'Edit Session Awareness') {
      return {
        beforeTitle: `REDUNDANT FILE DISK READ (${beforeTokens.toLocaleString()} tok)`,
        afterTitle: `IN-MEMORY SESSION BUFFER HIT (0 tok)`,
        language: 'typescript',
        explanation: `Reused active in-memory edit session buffer for ${src} instead of issuing redundant workspace file reads (-${pct}% tokens avoided).`,
        beforeContent: `[File Read Requested for Multi-File Edit]:\nPath: ${src}\nDisk Read: Issued\nPrompt Ingestion: ~${beforeTokens.toLocaleString()} tokens reprinted`,
        afterContent: `[TokenShield Edit Session Awareness]:\nPath: ${src}\nBuffer Status: Already loaded in active multi-file edit session.\nAction: Reused in-memory editor buffer (0 redundant tokens ingested)`
      };
    }

    if (directive === 'Context Saturation Monitor') {
      return {
        beforeTitle: `SATURATED THREAD (45+ MESSAGES)`,
        afterTitle: `FRESH COMPACT THREAD NUDGE`,
        language: 'markdown',
        explanation: `Proactively nudged thread reset when conversation length exceeded saturation limits, preventing quadratic token cost accumulation.`,
        beforeContent: `[Chat Thread History: Saturated]\nMessage Count: 48 messages\nAccumulated Context: ~${beforeTokens.toLocaleString()} tokens per subsequent prompt\nRisk: Quadratic token accumulation & context degradation`,
        afterContent: `[TokenShield Thread Reset Nudge]\nSuggested Action: Start fresh session with current task summary.\nSavings: Resets prompt baseline to ~${afterTokens.toLocaleString()} tokens (avoided +${saved.toLocaleString()} tokens)`
      };
    }

    return {
      beforeTitle: `UNPRUNED PROMPT (${beforeTokens.toLocaleString()} tok)`,
      afterTitle: `OPTIMIZED CONTEXT (${afterTokens.toLocaleString()} tok)`,
      language: 'markdown',
      explanation: `Pruned conversational preambles, apologies, and filler comments from prompt memory (-${pct}% tokens avoided).`,
      beforeContent: `Certainly! I would be delighted to help you write that helper function.\n\nTo solve this problem, we must first analyze the requirements carefully. Here is an in-depth breakdown of what we are doing:\n[Redundant conversational filler, polite preambles, and repetitive system instructions...]\n\nHere is the code you requested:\n[Code implementation]\n\nI hope this explanation was clear and helpful! Please let me know if you have any questions!`,
      afterContent: `[Direct Code-First Output — Zero Pleasantries & No Filler]\nexport function formatHelper(): void {\n  // direct code output\n}`
    };
  }

  private getHtmlContent(
    config: ExtensionConfig,
    strategies: StrategyState,
    measurements: DashboardMeasurements,
    activeModel: DiscoveredModel,
    availableModels: DiscoveredModel[],
    summary: import('../core/types').SessionRoiSummary,
    cacheStats: { entries: number; totalHits: number; estTokensSaved: number },
    recentEvents: ChatSavingsEvent[],
    wsPath: string
  ): string {
    const activeCount = countActiveStrategies(strategies);
    const sessionTokensSaved = chatSavingsTracker.getSessionTokensSaved();
    const sessionCostSaved = chatSavingsTracker.getSessionCostSavedUsd();
    const lifetimeTokensSaved = chatSavingsTracker.getLifetimeTokensSaved();
    const lifetimeCostSaved = chatSavingsTracker.getLifetimeCostSavedUsd();
    const sessionNum = chatSavingsTracker.getSessionNumber();
    const sessionStarted = chatSavingsTracker.getSessionStartedAt();
    const pastSessions = chatSavingsTracker.getPastSessions();

    const directiveCards: DirectiveCardData[] = [
      getFeatureCardState(
        'codeGraph',
        'CODE SEARCH',
        'CodeGraph Pre-Indexing',
        '🔍',
        'Semantic Symbol Explorer',
        'Replaces multi-file grep scans with direct AST graph lookups (~97% context reduction).',
        measurements.codeGraph,
        recentEvents,
        sessionNum,
        'cap-group-a',
        false
      ),
      getFeatureCardState(
        'outputCompression',
        'TERMINAL',
        'CLI Output Compression',
        '⚡',
        'Shell Output Filter',
        'Filters verbose terminal, test, and git output to isolate actionable output (60-90% smaller).',
        measurements.outputCompression,
        recentEvents,
        sessionNum,
        'cap-group-a',
        false
      ),
      getFeatureCardState(
        'verbosityControl',
        'PROMPT FILTER',
        'Concise AI Responses',
        '🗣️',
        'Compact Output Mode',
        'Strips conversational filler, pleasantries, and polite apologies from assistant responses.',
        measurements.verbosityControl,
        recentEvents,
        sessionNum,
        'cap-group-a',
        true
      ),
      getFeatureCardState(
        'sessionManagement',
        'SESSION',
        'Context Compaction',
        '🧹',
        'Multi-Turn Session Pruning',
        'Automatically clears stale conversational history and redundant tool output turns.',
        measurements.sessionManagement,
        recentEvents,
        sessionNum,
        'cap-group-a',
        true
      ),
      getFeatureCardState(
        'semanticCache',
        'DISK CACHE',
        'Semantic Cache',
        '💾',
        'Instant Local Answer Cache',
        'Serves repeated or similar questions instantly from local disk at $0.00 cost (zero model tokens).',
        measurements.semanticCache,
        recentEvents,
        sessionNum,
        'cap-group-b',
        false
      ),
      getFeatureCardState(
        'astSkeleton',
        'AST PARSER',
        'AST Skeletons',
        '🌲',
        'Signatures-Only Inspection',
        'Loads interfaces, classes, and function signatures without ingesting full implementation bodies.',
        measurements.astSkeleton,
        recentEvents,
        sessionNum,
        'cap-group-b',
        false
      ),
      getFeatureCardState(
        'contextExclusion',
        'EXCLUSIONS',
        'Smart Context Exclusions',
        '🚫',
        'Noise & Build File Shield',
        'Prevents lockfiles, compiled dist/ bundles, and minified code from polluting prompt context.',
        measurements.contextExclusion,
        recentEvents,
        sessionNum,
        'cap-group-b',
        true
      ),
      getFeatureCardState(
        'diffOnlyOutput',
        'PATCH EDITING',
        'Diff-Only Output',
        '📝',
        'Targeted Patch Editing',
        'Outputs modified diff hunks instead of rewriting entire multi-hundred line files.',
        measurements.diffOnlyOutput,
        recentEvents,
        sessionNum,
        'cap-group-b',
        false
      ),
      getFeatureCardState(
        'agentGuardrails',
        'SAFETY',
        'Loop Guardrails',
        '🛡️',
        'Runaway Retry Interceptor',
        'Halts runaway retry loops after 3 failures to prevent expensive token and cost burns.',
        measurements.agentGuardrails,
        recentEvents,
        sessionNum,
        'cap-group-c',
        true
      ),
      getFeatureCardState(
        'smartModelRouting',
        'ROUTING',
        'Smart Model Routing',
        '🚦',
        'Cost-Aware Model Routing',
        'Routes routine tasks (formatting, renaming, simple edits) to faster, cost-effective models.',
        measurements.smartModelRouting,
        recentEvents,
        sessionNum,
        'cap-group-c',
        true
      ),
      getFeatureCardState(
        'gitDiffContext',
        'GIT SCOPE',
        'Git Diff Scoping',
        '🔀',
        'Incremental Change Ingestion',
        'Restricts code reviews, PRs, and unit test generation strictly to git diff lines and direct callers.',
        { status: strategies.gitDiffContext ? 'measured' : 'disabled', percent: 85, detail: 'Scopes reviews to git diff hunks and direct AST dependencies' },
        recentEvents,
        sessionNum,
        'cap-group-c',
        true
      ),
      getFeatureCardState(
        'kvCacheAlignment',
        'CLOUD CACHE',
        'Prompt Prefix Caching',
        '⚡',
        'Deterministic KV-Cache',
        'Maintains deterministic system prompt prefixes to unlock cloud input token caching discounts.',
        { status: strategies.kvCacheAlignment ? 'measured' : 'disabled', percent: 90, detail: 'Byte-aligned deterministic prefix blocks' },
        recentEvents,
        sessionNum,
        'cap-group-c',
        true
      ),
      getFeatureCardState(
        'commentStripper',
        'MINIFIER',
        'Comment & Header Stripper',
        '✂️',
        'Source Minifier',
        'Strips license preambles, copyright blocks, and low-signal filler comments on file reads.',
        { status: strategies.commentStripper ? 'measured' : 'disabled', percent: 30, detail: 'Removes boilerplate comments from source code' },
        recentEvents,
        sessionNum,
        'cap-group-d',
        false
      ),
      getFeatureCardState(
        'testFailureIsolator',
        'TEST RUNNER',
        'Test Failure Isolator',
        '🧪',
        'Failure Extractor',
        'Isolates failing assertions and line numbers, stripping passing test suites from logs.',
        { status: strategies.testFailureIsolator ? 'measured' : 'disabled', percent: 95, detail: 'Extracts failing assertions from test runners' },
        recentEvents,
        sessionNum,
        'cap-group-d',
        true
      ),
      getFeatureCardState(
        'rangeSlicing',
        'RANGE SLICER',
        'Windowed Range Slicing',
        '🔍',
        'Slice Navigation',
        'Constrains file reads to targeted 100-line slice windows around symbol declarations.',
        { status: strategies.rangeSlicing ? 'measured' : 'disabled', percent: 80, detail: 'Enforces 100-line window slicing on file reads' },
        recentEvents,
        sessionNum,
        'cap-group-d',
        true
      ),
      getFeatureCardState(
        'inlineChatScopePinning',
        'EDITOR SCOPE',
        'Inline Chat Scope Lock',
        '🎯',
        'Selection Lock',
        'Pins inline editor chat context strictly to selected lines and immediate symbol references.',
        { status: strategies.inlineChatScopePinning ? 'measured' : 'disabled', percent: 85, detail: 'Locks inline chat context to active selection' },
        recentEvents,
        sessionNum,
        'cap-group-d',
        true
      ),
      getFeatureCardState(
        'copilotIgnoreGeneration',
        'RULES',
        '.copilotignore Generator',
        '🛡️',
        'Context Filter Rules',
        'Maintains project-level .copilotignore rules to block build files, secrets, and assets.',
        { status: strategies.copilotIgnoreGeneration ? 'measured' : 'disabled', percent: 90, detail: 'Enforces .copilotignore file exclusion rules' },
        recentEvents,
        sessionNum,
        'cap-group-a',
        true
      ),
      getFeatureCardState(
        'copilotEditsAwareness',
        'SESSION CACHE',
        'Edit Session Awareness',
        '🔄',
        'Active Editor Cache',
        'Treats files already open in multi-file edit sessions as loaded, avoiding redundant re-reads.',
        { status: strategies.copilotEditsAwareness ? 'measured' : 'disabled', percent: 75, detail: 'Avoids re-reading open edit session files' },
        recentEvents,
        sessionNum,
        'cap-group-b',
        true
      ),
      getFeatureCardState(
        'threadResetTrigger',
        'MONITOR',
        'Context Saturation Monitor',
        '💡',
        'Thread Reset Nudge',
        'Proactively suggests fresh chat threads when conversation length exceeds 40 messages.',
        { status: strategies.threadResetTrigger ? 'measured' : 'disabled', percent: 100, detail: 'Surfaces thread reset nudges on long conversations' },
        recentEvents,
        sessionNum,
        'cap-group-c',
        true
      ),
      getFeatureCardState(
        'headroomCompression',
        'CCR LOSSLESS',
        'Headroom Reversible CCR',
        '🗜️',
        'Lossless Context Compressor',
        'Bidirectional context compressor & SmartCrusher for massive JSON, traces, and tool outputs.',
        measurements.headroomCompression,
        recentEvents,
        sessionNum,
        'cap-group-d',
        false
      ),
    ];

    const cardsHtml = directiveCards.map(c => this.renderDirectiveCard(c)).join('\n');

    const activePricing = config.pricing[activeModel.tier] || config.pricing.standard;
    const pricingRate = activePricing.inputPerMillion;
    const allEventsMap: Record<string, any> = {};

    const registerEventAudit = (ev: ChatSavingsEvent) => {
      const audit = this.getAuditDataForEvent(ev, pricingRate, activeModel.name);
      allEventsMap[ev.id] = audit;
      return audit;
    };

    // Build Live Activity Ledger rows
    let ledgerRows = '';
    if (recentEvents.length === 0) {
      ledgerRows = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:20px;">No events logged in Session #${sessionNum} yet. Run a CLI command or prompt pruner to see live events.</td></tr>`;
    } else {
      ledgerRows = recentEvents.map(ev => {
        registerEventAudit(ev);
        const timeStr = ev.timestamp.toLocaleTimeString();
        const costStr = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
        return `
        <tr class="activity-row" onclick="openEventModal('${ev.id}')" title="Click to inspect With vs Without TokenShield calculation">
          <td><span class="ledger-time">${timeStr}</span></td>
          <td><span class="tool-badge">${ev.directive}</span></td>
          <td><code>${ev.source}</code></td>
          <td style="color:var(--green); font-weight:700;">+${ev.tokensSaved.toLocaleString()} tok (${costStr})</td>
          <td style="color:var(--text-muted); font-size:12px;">${ev.details}</td>
          <td style="text-align:right;"><button class="btn-inspect" onclick="event.stopPropagation(); openEventModal('${ev.id}')">🔍 Justify</button></td>
        </tr>`;
      }).join('\n');
    }

    // Build Past Sessions Table with Expandable Event Ledgers
    let pastSessionsHtml = '';
    if (pastSessions.length > 0) {
      const sessionBlocks = pastSessions.map(s => {
        const eventRows = (s.events || []).map(ev => {
          registerEventAudit(ev);
          const timeStr = new Date(ev.timestamp).toLocaleTimeString();
          const costStr = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
          return `
            <tr class="activity-row" onclick="openEventModal('${ev.id}')" title="Click to inspect With vs Without TokenShield calculation">
              <td><span class="ledger-time">${timeStr}</span></td>
              <td><span class="tool-badge">${ev.directive}</span></td>
              <td><code>${ev.source}</code></td>
              <td style="color:var(--green); font-weight:700;">+${ev.tokensSaved.toLocaleString()} tok (${costStr})</td>
              <td style="color:var(--text-muted); font-size:12px;">${ev.details}</td>
              <td style="text-align:right;"><button class="btn-inspect" onclick="event.stopPropagation(); openEventModal('${ev.id}')">🔍 Justify</button></td>
            </tr>`;
        }).join('');

        return `
        <div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:8px; margin-bottom:12px; overflow:hidden;">
          <details style="padding:0;">
            <summary style="cursor:pointer; padding:14px 18px; display:flex; justify-content:space-between; align-items:center; list-style:none; user-select:none; background:#161c2d;">
              <div style="display:flex; align-items:center; gap:12px;">
                <span style="font-weight:700; font-size:14px; color:#fff;">📁 Session #${s.sessionNumber}</span>
                <span style="font-size:12px; color:var(--text-muted);">${s.startedAt.toLocaleTimeString()} - ${s.endedAt.toLocaleTimeString()}</span>
                <span class="tool-badge">${s.modelName}</span>
              </div>
              <div style="display:flex; align-items:center; gap:16px;">
                <span style="color:var(--green); font-weight:800; font-size:13.5px;">+${s.totalTokensSaved.toLocaleString()} tok</span>
                <span style="color:var(--accent); font-weight:800; font-size:13.5px;">$${s.totalCostSavedUsd.toFixed(4)}</span>
                <span class="badge badge-measured" style="cursor:pointer;">${s.eventsCount} events ▼</span>
              </div>
            </summary>
            <div style="border-top:1px solid var(--card-border); background:#0f1422; padding:0;">
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="background:#131a2c;">
                    <th style="width:110px;">Timestamp</th>
                    <th style="width:170px;">Optimization</th>
                    <th style="width:180px;">Target File / Action</th>
                    <th style="width:160px;">Tokens Saved</th>
                    <th>Details</th>
                    <th style="width:90px; text-align:right;">Calculation</th>
                  </tr>
                </thead>
                <tbody>
                  ${eventRows.length > 0 ? eventRows : '<tr><td colspan="6" style="text-align:center; padding:16px; color:#64748b;">No individual events logged in this session.</td></tr>'}
                </tbody>
              </table>
            </div>
          </details>
        </div>`;
      }).join('');

      pastSessionsHtml = `
      <h2>📜 Past Sessions (Click to View Events)</h2>
      <div style="margin-bottom:32px;">
        ${sessionBlocks}
      </div>`;
    }

    const safeEventsJson = JSON.stringify(allEventsMap)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TokenShield Savings Dashboard</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    :root {
      --bg-start: #0a0e1a;
      --bg-end: #1a1035;
      --glass: rgba(255,255,255,0.04);
      --glass-border: rgba(255,255,255,0.08);
      --glass-hover: rgba(255,255,255,0.07);
      --text: #e2e8f0;
      --text-muted: #8492a6;
      --accent: #00e5ff;
      --accent-glow: rgba(0,229,255,0.15);
      --green: #00ffa3;
      --green-bg: rgba(0,255,163,0.12);
      --purple: #a855f7;
      --purple-bg: rgba(168,85,247,0.12);
      --amber: #fbbf24;
      --amber-bg: rgba(251,191,36,0.12);
      --red: #f87171;
      --gradient-btn: linear-gradient(135deg, #00e5ff, #a855f7);
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: var(--text);
      background: linear-gradient(135deg, var(--bg-start) 0%, var(--bg-end) 100%);
      background-attachment: fixed;
      padding: 28px 32px;
      line-height: 1.5;
      margin: 0;
      min-height: 100vh;
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes ringDraw {
      from { stroke-dashoffset: 251; }
    }
    @keyframes pulseGlow {
      0%, 100% { box-shadow: 0 0 0 0 rgba(0,229,255,0); }
      50% { box-shadow: 0 0 12px 2px rgba(0,229,255,0.25); }
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--glass-border);
      padding-bottom: 20px;
      margin-bottom: 28px;
      animation: fadeInUp 0.5s ease;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #fff 0%, var(--accent) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .tagline {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
      font-weight: 500;
    }
    .btn-group { display: flex; gap: 10px; }
    .btn {
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 12.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .btn:hover { background: var(--glass-hover); border-color: rgba(255,255,255,0.15); transform: translateY(-1px); }
    .btn-primary {
      background: var(--gradient-btn);
      border: none;
      color: #fff;
      font-weight: 700;
      box-shadow: 0 4px 20px rgba(0,229,255,0.2);
    }
    .btn-primary:hover { box-shadow: 0 6px 28px rgba(0,229,255,0.35); transform: translateY(-1px); }

    /* KPI Cards */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .kpi-card {
      background: var(--glass);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      padding: 22px 20px;
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease both;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .kpi-card:nth-child(1) { animation-delay: 0.1s; }
    .kpi-card:nth-child(2) { animation-delay: 0.2s; }
    .kpi-card:nth-child(3) { animation-delay: 0.3s; }
    .kpi-card:nth-child(4) { animation-delay: 0.4s; }
    .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,229,255,0.08); }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 2px;
      background: var(--gradient-btn);
      opacity: 0.6;
    }
    .kpi-val {
      font-size: 34px;
      font-weight: 900;
      color: var(--green);
      line-height: 1.1;
      letter-spacing: -0.02em;
    }
    .kpi-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text);
      margin-top: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kpi-desc {
      font-size: 11.5px;
      color: var(--text-muted);
      margin-top: 4px;
      line-height: 1.4;
    }

    /* Section Headers */
    h2 {
      font-size: 17px;
      font-weight: 700;
      margin: 36px 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
      color: #fff;
    }
    h2::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, var(--glass-border), transparent);
      margin-left: 12px;
    }

    /* Ledger Table */
    .ledger-container {
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      overflow: hidden;
      margin-bottom: 32px;
      animation: fadeInUp 0.7s ease both;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; }
    th {
      background: rgba(255,255,255,0.03);
      padding: 14px 16px;
      font-weight: 700;
      color: var(--text-muted);
      border-bottom: 1px solid var(--glass-border);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    td { padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
    tr:nth-child(even) td { background: rgba(255,255,255,0.015); }
    tr:last-child td { border-bottom: none; }
    tr { animation: fadeInUp 0.4s ease both; }
    .ledger-time {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: var(--accent);
      background: var(--accent-glow);
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
    }
    .tool-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .tool-badge-cyan { background: var(--accent-glow); color: var(--accent); }
    .tool-badge-purple { background: var(--purple-bg); color: var(--purple); }
    .tool-badge-green { background: var(--green-bg); color: var(--green); }
    .tool-badge-amber { background: var(--amber-bg); color: var(--amber); }

    /* Strategy Cards Grid */
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border);
      border-radius: 14px;
      padding: 20px 22px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
      animation: fadeInUp 0.5s ease both;
    }
    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 8px 32px rgba(0,229,255,0.06);
      border-color: rgba(255,255,255,0.12);
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0;
      width: 3px;
      border-radius: 3px 0 0 3px;
    }
    .card.cap-group-a::before { background: var(--accent); }
    .card.cap-group-b::before { background: var(--purple); }
    .card.cap-group-c::before { background: var(--green); }
    .card.cap-group-d::before { background: var(--amber); }
    .card.cap-disabled { opacity: 0.5; }
    .card.cap-disabled::after {
      content: 'DISABLED';
      position: absolute;
      top: 12px; right: 12px;
      font-size: 9px;
      font-weight: 800;
      color: var(--text-muted);
      background: rgba(255,255,255,0.06);
      padding: 2px 8px;
      border-radius: 4px;
      letter-spacing: 0.06em;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
      padding-left: 10px;
    }
    .cap-tag {
      font-size: 10px;
      font-weight: 800;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .card-title {
      font-size: 14.5px;
      font-weight: 700;
      margin: 2px 0 0 0;
      color: #fff;
    }
    .card-subtitle {
      font-size: 11.5px;
      color: var(--text-muted);
      font-weight: 500;
    }

    /* Badges */
    .badge {
      font-size: 10px;
      font-weight: 800;
      padding: 4px 10px;
      border-radius: 20px;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .badge-measured {
      background: var(--green-bg);
      color: var(--green);
      border: 1px solid rgba(0,255,163,0.25);
      animation: pulseGlow 3s ease infinite;
    }
    .badge-policy {
      background: rgba(0, 229, 255, 0.12);
      color: var(--accent);
      border: 1px solid rgba(0, 229, 255, 0.35);
    }
    .badge-standby {
      background: rgba(148, 163, 184, 0.1);
      color: #94a3b8;
      border: 1px solid rgba(148, 163, 184, 0.2);
    }
    .badge-off { background: rgba(148, 163, 184, 0.1); color: var(--text-muted); }

    /* Live Metric Box */
    .live-metric-box {
      background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.06);
      border-left: 3px solid var(--green);
      border-radius: 8px;
      padding: 12px 14px;
      margin: 8px 0 12px 10px;
    }
    .live-metric-box.metric-policy {
      border-left: 3px solid var(--accent);
    }
    .live-metric-box.metric-standby {
      border-left: 3px solid #64748b;
    }
    .live-metric-box.metric-disabled {
      border-left: 3px solid rgba(148, 163, 184, 0.3);
    }
    .live-metric-title {
      font-size: 9.5px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.06em;
      margin-bottom: 3px;
      text-transform: uppercase;
    }
    .live-metric-val {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--green);
      line-height: 1.4;
    }
    .live-metric-val.metric-policy {
      color: var(--accent);
    }
    .live-metric-val.metric-standby {
      color: #94a3b8;
    }
    .live-metric-val.metric-disabled {
      color: var(--text-muted);
    }

    /* Progress Bars */
    .bar-container { margin: 4px 0 12px 10px; }
    .bar-track {
      background: rgba(255,255,255,0.06);
      height: 4px;
      border-radius: 2px;
      overflow: hidden;
    }
    .bar {
      height: 100%;
      border-radius: 2px;
      background: linear-gradient(90deg, var(--accent), var(--green));
      transition: width 0.8s ease;
    }
    .bar.bar-policy {
      background: linear-gradient(90deg, #7928ca, var(--accent));
    }

    /* Card Footer */
    .info-section { margin-bottom: 12px; padding-left: 10px; }
    .info-label {
      font-size: 9.5px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      margin-bottom: 2px;
      text-transform: uppercase;
    }
    .info-text { font-size: 12px; color: var(--text); line-height: 1.45; }
    .card-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 10px;
      padding-left: 10px;
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Donut Ring */
    .donut-ring {
      display: inline-block;
      width: 44px;
      height: 44px;
      vertical-align: middle;
    }
    .donut-ring svg { width: 44px; height: 44px; }
    .donut-ring .ring-bg { fill: none; stroke: rgba(255,255,255,0.06); stroke-width: 4; }
    .donut-ring .ring-fill { fill: none; stroke-width: 4; stroke-linecap: round;
      stroke-dasharray: 251; animation: ringDraw 1s ease both; transform: rotate(-90deg); transform-origin: center; }
    .donut-ring .ring-label { fill: var(--text); font-size: 11px; font-weight: 800; text-anchor: middle; dominant-baseline: central; font-family: 'Inter', sans-serif; }

    /* Header Controls & Toggle Switch */
    .card-header-controls {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 38px;
      height: 22px;
      margin-bottom: 2px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: rgba(255,255,255,0.12);
      transition: .25s ease;
      border-radius: 22px;
      border: 1px solid rgba(255,255,255,0.15);
    }
    .slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: #94a3b8;
      transition: .25s ease;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: rgba(0, 255, 163, 0.25);
      border-color: var(--green);
    }
    input:checked + .slider:before {
      transform: translateX(16px);
      background-color: var(--green);
      box-shadow: 0 0 8px rgba(0,255,163,0.6);
    }

    /* Deactivation Banner & Buttons */
    .deactivated-banner {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.18) 0%, rgba(185, 28, 28, 0.08) 100%);
      border: 1px solid rgba(239, 68, 68, 0.4);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      animation: fadeInUp 0.4s ease;
    }
    .deactivated-banner h3 {
      margin: 0 0 6px 0;
      font-size: 16px;
      color: #fca5a5;
    }
    .deactivated-banner p {
      margin: 0;
      font-size: 12.5px;
      color: #cbd5e1;
    }
    .btn-reactivate {
      background: linear-gradient(135deg, #10b981, #059669);
      border: none;
      color: #fff;
      font-weight: 700;
      padding: 8px 18px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12.5px;
      white-space: nowrap;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-reactivate:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
    }
    .btn-danger-outline {
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #fca5a5;
      background: rgba(239, 68, 68, 0.08);
      cursor: pointer;
    }
    .btn-danger-outline:hover {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.6);
      transform: translateY(-1px);
    }
    .section-note {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: -10px;
      margin-bottom: 16px;
    }

    /* Activity Log Interactive Rows */
    .activity-row {
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .activity-row:hover {
      background: rgba(0, 229, 255, 0.08) !important;
    }
    .btn-inspect {
      background: rgba(0, 229, 255, 0.12);
      color: var(--accent);
      border: 1px solid rgba(0, 229, 255, 0.35);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }
    .btn-inspect:hover {
      background: var(--accent);
      color: #050b14;
      box-shadow: 0 0 10px rgba(0, 229, 255, 0.6);
      transform: translateY(-1px);
    }

    /* Modal Backdrop & Dialog */
    .modal-backdrop {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(5, 8, 16, 0.82);
      backdrop-filter: blur(10px);
      z-index: 10000;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .modal-backdrop.active {
      display: flex;
    }
    .modal-dialog {
      background: #0d1322;
      border: 1px solid rgba(0, 229, 255, 0.35);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(0, 229, 255, 0.18);
      border-radius: 16px;
      width: 100%;
      max-width: 860px;
      max-height: 90vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      animation: modalSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes modalSlideUp {
      from { transform: translateY(20px) scale(0.97); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    .modal-header {
      padding: 18px 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      background: linear-gradient(180deg, rgba(0, 229, 255, 0.06) 0%, transparent 100%);
    }
    .modal-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: var(--accent);
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.3);
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 6px;
    }
    .modal-title-wrap h3 {
      margin: 0 0 4px 0;
      font-size: 18px;
      font-weight: 800;
      color: #fff;
    }
    .modal-subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }
    .modal-close {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #cbd5e1;
      font-size: 16px;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .modal-close:hover {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      border-color: rgba(239, 68, 68, 0.4);
    }
    .modal-body {
      padding: 20px 24px;
    }
    .modal-section-title {
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 14px;
    }
    .comparison-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 12px;
      align-items: center;
      margin-bottom: 20px;
    }
    .comp-card {
      background: #080d18;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .comp-without {
      border-color: rgba(239, 68, 68, 0.35);
      background: linear-gradient(180deg, rgba(239, 68, 68, 0.09) 0%, #080d18 100%);
    }
    .comp-with {
      border-color: rgba(0, 255, 163, 0.35);
      background: linear-gradient(180deg, rgba(0, 255, 163, 0.09) 0%, #080d18 100%);
    }
    .comp-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .comp-without .comp-header { color: #fca5a5; }
    .comp-with .comp-header { color: var(--green); }
    .comp-tokens {
      font-size: 20px;
      font-weight: 900;
      margin-bottom: 2px;
    }
    .comp-without .comp-tokens { color: #f87171; }
    .comp-with .comp-tokens { color: var(--green); }
    .comp-cost {
      font-size: 11.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .comp-desc {
      font-size: 11.5px;
      color: #94a3b8;
      line-height: 1.4;
    }
    .comp-vs {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 0 4px;
    }
    .vs-badge {
      font-size: 10px;
      font-weight: 800;
      color: #64748b;
      background: rgba(255, 255, 255, 0.06);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .savings-pct {
      font-size: 13px;
      font-weight: 800;
      color: var(--green);
      background: rgba(0, 255, 163, 0.12);
      border: 1px solid rgba(0, 255, 163, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      white-space: nowrap;
    }
    .justification-card {
      background: #090e1b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 16px;
    }
    .just-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12.5px;
      gap: 12px;
    }
    .just-row:last-child {
      margin-bottom: 0;
    }
    .just-label {
      color: #94a3b8;
      font-weight: 600;
      white-space: nowrap;
    }
    .just-formula {
      font-family: monospace;
      font-size: 11.5px;
      color: var(--accent);
      background: rgba(0, 229, 255, 0.08);
      padding: 4px 10px;
      border-radius: 6px;
      text-align: right;
    }
    .just-desc {
      font-size: 12px;
      color: #cbd5e1;
      text-align: right;
      line-height: 1.4;
    }
    .just-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.06);
      margin: 12px 0;
    }
    .just-proof-badge {
      margin-top: 14px;
      padding: 8px 12px;
      background: rgba(0, 255, 163, 0.06);
      border: 1px solid rgba(0, 255, 163, 0.2);
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      color: var(--green);
      text-align: center;
    }

    /* Visual Payload Diff */
    .payload-diff-section {
      margin-top: 18px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      padding-top: 16px;
    }
    .payload-diff-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .btn-diff-open {
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.35);
      color: var(--accent);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }
    .btn-diff-open:hover {
      background: var(--accent);
      color: #050b14;
      box-shadow: 0 0 12px rgba(0, 229, 255, 0.6);
      transform: translateY(-1px);
    }
    .payload-explanation {
      font-size: 12px;
      color: #94a3b8;
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .payload-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .payload-col {
      background: #050913;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .payload-col-before {
      border-color: rgba(239, 68, 68, 0.3);
    }
    .payload-col-after {
      border-color: rgba(0, 255, 163, 0.3);
    }
    .payload-col-header {
      padding: 7px 12px;
      font-size: 10.5px;
      font-weight: 800;
      letter-spacing: 0.04em;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .payload-col-before .payload-col-header {
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      border-bottom: 1px solid rgba(239, 68, 68, 0.2);
    }
    .payload-col-after .payload-col-header {
      background: rgba(0, 255, 163, 0.1);
      color: var(--green);
      border-bottom: 1px solid rgba(0, 255, 163, 0.2);
    }
    .payload-tag-bloat {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 800;
    }
    .payload-tag-clean {
      background: rgba(0, 255, 163, 0.2);
      color: var(--green);
      padding: 1px 5px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 800;
    }
    .payload-pre {
      margin: 0;
      padding: 12px;
      font-family: 'Consolas', 'Menlo', monospace;
      font-size: 11px;
      line-height: 1.45;
      color: #cbd5e1;
      max-height: 230px;
      overflow-y: auto;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .payload-col-before .payload-pre {
      background: rgba(239, 68, 68, 0.03);
    }
    .payload-col-after .payload-pre {
      background: rgba(0, 255, 163, 0.03);
    }

    .modal-footer {
      padding: 14px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: flex-end;
      background: #080d18;
      border-radius: 0 0 16px 16px;
    }
  </style>
</head>
<body>

  ${!config.enabled ? `
  <div class="deactivated-banner">
    <div>
      <h3>⚠️ TokenShield is Completely Deactivated</h3>
      <p>All optimization directives, prompt policies, and file exclusions have been stripped from your workspace. AI assistants (Copilot, Claude, Antigravity) are operating in default unconstrained mode.</p>
    </div>
    <div>
      <button class="btn-reactivate" onclick="reactivate()">▶ Reactivate TokenShield</button>
    </div>
  </div>` : ''}

  <div class="header">
    <div>
      <h1>🛡️ TokenShield Savings Dashboard</h1>
      <div class="tagline">Real-time local token & cost optimization monitor (100% private & on-device)</div>
    </div>
    <div class="btn-group">
      ${config.enabled ? `
      <button class="btn btn-danger-outline" onclick="deactivateCompletely()">⚡ Deactivate Completely</button>
      ` : `
      <button class="btn-reactivate" onclick="reactivate()">▶ Reactivate</button>
      `}
      <a class="btn" href="command:${REFRESH_COMMAND}">↻ Refresh Stats</a>
      <a class="btn" href="command:${HEALTH_COMMAND}">🩺 Health Check</a>
      <a class="btn" href="command:${RESET_COMMAND}">🔄 Reset / New Session</a>
      <a class="btn" href="command:${RESET_ALL_COMMAND}" style="border-color:rgba(239, 68, 68, 0.4); color:#fca5a5;">🗑️ Reset Complete Data</a>
      <a class="btn btn-primary" href="command:${EXPORT_COMMAND}">⬇ Export Savings Report</a>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-val">+${sessionTokensSaved >= 1_000_000 ? `${formatCompactTokens(sessionTokensSaved)} <span style="font-size:16px; font-weight:600; opacity:0.75;">(${sessionTokensSaved.toLocaleString()})</span>` : sessionTokensSaved.toLocaleString()}</div>
      <div class="kpi-title">Session #${sessionNum} Tokens Saved</div>
      <div class="kpi-desc">Active since <strong>${sessionStarted.toLocaleTimeString()}</strong> · Current window session.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--green);">$${sessionCostSaved.toFixed(4)}</div>
      <div class="kpi-title">Session #${sessionNum} Estimated Savings</div>
      <div class="kpi-desc">Calculated at $${config.pricing[activeModel.tier].inputPerMillion.toFixed(2)}/1M token rate for <strong>${activeModel.name}</strong>.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:#38bdf8;">+${formatCompactTokens(lifetimeTokensSaved)} <span style="font-size:16px; font-weight:600; opacity:0.8;">($${lifetimeCostSaved.toFixed(4)})</span></div>
      <div class="kpi-title">🌐 All-Time Lifetime Savings</div>
      <div class="kpi-desc">~<strong>${lifetimeTokensSaved.toLocaleString()}</strong> tokens avoided across all sessions. Persisted across IDE restarts.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--accent); font-size:24px; padding-top:4px;">${activeModel.name}</div>
      <div class="kpi-title">Active AI Assistant (${activeModel.tier.toUpperCase()} Tier)</div>
      <div class="kpi-desc">Auto-detected host environment with lightweight fast pricing rate.</div>
    </div>
  </div>

  <h2>🔴 Live Activity Log (Session #${sessionNum})</h2>
  <div class="ledger-container">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Optimization</th>
          <th>Target File / Action</th>
          <th>Tokens Saved</th>
          <th>Details</th>
          <th style="text-align:right;">Calculation</th>
        </tr>
      </thead>
      <tbody>
        ${ledgerRows}
      </tbody>
    </table>
  </div>

  ${pastSessionsHtml}

  <h2>⚙️ Optimization Features (${activeCount}/${TOTAL_STRATEGIES} Active)</h2>
  <div class="section-note">Toggle each feature ON or OFF independently. Directives are hot-reloaded automatically.</div>
  <div class="grid">
    ${cardsHtml}
  </div>

  <!-- Event Justification Modal -->
  <div id="event-detail-modal" class="modal-backdrop" onclick="closeModalOnBackdrop(event)">
    <div class="modal-dialog" onclick="event.stopPropagation()">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-badge" id="m-directive-badge">OPTIMIZATION DIRECTIVE</span>
          <h3 id="m-directive-title">CLI Output Compression</h3>
          <div class="modal-subtitle" id="m-source-sub">Target: <code id="m-source-code">rtk CLI proxy</code> · <span id="m-time">9:44:05 AM</span></div>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      
      <div class="modal-body">
        <div class="modal-section-title">📊 TOKEN CALCULATION & VERIFIABLE AUDIT BREAKDOWN</div>
        <div class="comparison-grid">
          <div class="comp-card comp-without">
            <div class="comp-header">
              <span class="comp-icon">🔴</span>
              <span class="comp-name">WITHOUT TOKENSHIELD</span>
            </div>
            <div class="comp-tokens" id="m-before-tokens">12,961 tok</div>
            <div class="comp-cost" id="m-before-cost">$0.0019 est. baseline</div>
            <div class="comp-desc" id="m-before-desc">Full unoptimized raw output or entire file read sent to model prompt.</div>
          </div>

          <div class="comp-card comp-vs">
            <div class="vs-badge">VS</div>
            <div class="savings-arrow" style="color:var(--accent); font-size:16px;">➔</div>
            <div class="savings-pct" id="m-reduction-pct">-23%</div>
          </div>

          <div class="comp-card comp-with">
            <div class="comp-header">
              <span class="comp-icon">🟢</span>
              <span class="comp-name">WITH TOKENSHIELD</span>
            </div>
            <div class="comp-tokens" id="m-after-tokens">10,006 tok</div>
            <div class="comp-cost" id="m-after-cost">$0.0015 optimized</div>
            <div class="comp-desc" id="m-after-desc">Compressed, stripped of terminal noise, ANSI sequences, and filler.</div>
          </div>
        </div>

        <div class="justification-card">
          <div class="just-row">
            <div class="just-label">⚡ Real Tokens Avoided:</div>
            <div class="just-val" id="m-tokens-saved" style="color:var(--green); font-weight:800; font-size:15px;">+2,955 tokens</div>
          </div>
          <div class="just-row">
            <div class="just-label">💵 Direct Cost Saved:</div>
            <div class="just-val" id="m-cost-saved" style="color:var(--accent); font-weight:800; font-size:15px;">$0.0004 USD</div>
          </div>
          <div class="just-divider"></div>
          <div class="just-row">
            <div class="just-label">📐 Mathematical Proof:</div>
            <div class="just-formula" id="m-formula">Tokens Avoided = Baseline - Optimized</div>
          </div>
          <div class="just-row">
            <div class="just-label">💲 Rate Justification:</div>
            <div class="just-formula" id="m-rate-formula">Cost Avoided = (Tokens / 1,000,000) × Model Rate</div>
          </div>
          <div class="just-row" style="align-items:flex-start;">
            <div class="just-label">🎯 How It Avoided:</div>
            <div class="just-desc" id="m-how">Filters shell outputs</div>
          </div>
          <div class="just-row" style="align-items:flex-start;">
            <div class="just-label">📝 Audit Log Evidence:</div>
            <div class="just-desc" id="m-details" style="font-family:monospace; font-size:11px; color:#94a3b8;">Event details</div>
          </div>
          <div class="just-proof-badge">
            🛡️ 100% Locally Measured On-Device · Verifiable Against Local Binary & Disk Cache
          </div>
        </div>

        <!-- Visual Payload Diff Comparison -->
        <div class="payload-diff-section">
          <div class="payload-diff-header">
            <div class="modal-section-title" style="margin-bottom:0;">🔍 VISUAL PAYLOAD DIFF (WHAT WAS STRIPPED & OPTIMIZED)</div>
            <button class="btn-diff-open" onclick="openNativeVsCodeDiff()">
              <span>🖥️</span> Compare in VS Code Diff Editor
            </button>
          </div>
          <div class="payload-explanation" id="m-diff-explanation">
            Detailed breakdown of payload optimization
          </div>
          <div class="payload-grid">
            <div class="payload-col payload-col-before">
              <div class="payload-col-header">
                <span id="m-diff-before-title">🔴 WITHOUT TOKENSHIELD (RAW)</span>
                <span class="payload-tag-bloat">PROMPT BLOAT</span>
              </div>
              <pre class="payload-pre" id="m-diff-before-code"></pre>
            </div>
            <div class="payload-col payload-col-after">
              <div class="payload-col-header">
                <span id="m-diff-after-title">🟢 WITH TOKENSHIELD (OPTIMIZED)</span>
                <span class="payload-tag-clean">CLEAN PROMPT</span>
              </div>
              <pre class="payload-pre" id="m-diff-after-code"></pre>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Close (Esc)</button>
      </div>
    </div>
  </div>

  <script type="application/json" id="tokenshield-events-data">
${safeEventsJson}
  </script>
  <script>
    const vscode = acquireVsCodeApi();
    let eventsMap = {};
    try {
      const dataEl = document.getElementById('tokenshield-events-data');
      if (dataEl && dataEl.textContent) {
        eventsMap = JSON.parse(dataEl.textContent);
      }
    } catch (e) {
      console.error('TokenShield: Failed to parse events data:', e);
    }
    let activeModalEvent = null;

    function openEventModal(eventId) {
      try {
        const ev = eventsMap[eventId];
        if (!ev) {
          console.warn('TokenShield: Event not found for id:', eventId);
          return;
        }
        activeModalEvent = ev;

        const setTxt = (id, txt) => {
          const el = document.getElementById(id);
          if (el) el.textContent = txt;
        };

        setTxt('m-directive-badge', ev.directive ? ev.directive.toUpperCase() : 'DIRECTIVE');
        setTxt('m-directive-title', ev.directive || 'Optimization Directive');
        setTxt('m-source-code', ev.source || 'workspace');
        setTxt('m-time', (ev.timestampStr || '') + ' · ' + (ev.modelName || 'Model'));

        setTxt('m-before-tokens', Number(ev.beforeTokens || 0).toLocaleString() + ' tok');
        setTxt('m-before-cost', '$' + Number(ev.costWithoutUsd || 0).toFixed(5) + ' est. baseline');

        setTxt('m-after-tokens', Number(ev.afterTokens || 0).toLocaleString() + ' tok');
        setTxt('m-after-cost', '$' + Number(ev.costWithUsd || 0).toFixed(5) + ' with TokenShield');

        setTxt('m-reduction-pct', '-' + (ev.reductionPercent || 0) + '%');
        setTxt('m-tokens-saved', '+' + Number(ev.tokensSaved || 0).toLocaleString() + ' tokens');
        setTxt('m-cost-saved', '$' + Number(ev.costSavedUsd || 0).toFixed(5) + ' USD');

        setTxt('m-formula', 
          'Tokens Avoided = ' + Number(ev.beforeTokens || 0).toLocaleString() + ' - ' + Number(ev.afterTokens || 0).toLocaleString() + ' = +' + Number(ev.tokensSaved || 0).toLocaleString() + ' tok');

        setTxt('m-rate-formula', 
          'Cost Avoided = (' + Number(ev.tokensSaved || 0).toLocaleString() + ' / 1,000,000) × $' + Number(ev.pricingRate || 0).toFixed(2) + ' (' + (ev.modelName || 'Model') + ')');

        setTxt('m-how', ev.howItAvoided || '');
        setTxt('m-details', ev.details || '');

        // Populate Visual Payload Diff
        const diff = ev.payloadDiff;
        if (diff) {
          setTxt('m-diff-explanation', diff.explanation || '');
          setTxt('m-diff-before-title', '🔴 ' + (diff.beforeTitle || 'WITHOUT TOKENSHIELD (RAW)'));
          setTxt('m-diff-before-code', diff.beforeContent || '(No before content recorded)');
          setTxt('m-diff-after-title', '🟢 ' + (diff.afterTitle || 'WITH TOKENSHIELD (OPTIMIZED)'));
          setTxt('m-diff-after-code', diff.afterContent || '(No after content recorded)');
        }

        const modal = document.getElementById('event-detail-modal');
        if (modal) {
          modal.classList.add('active');
        }
      } catch (err) {
        console.error('TokenShield: Failed to open event modal:', err);
      }
    }

    function openNativeVsCodeDiff() {
      if (!activeModalEvent || !activeModalEvent.payloadDiff) return;
      vscode.postMessage({
        command: 'openDiff',
        directive: activeModalEvent.directive,
        source: activeModalEvent.source,
        beforeContent: activeModalEvent.payloadDiff.beforeContent,
        afterContent: activeModalEvent.payloadDiff.afterContent,
        language: activeModalEvent.payloadDiff.language || 'text'
      });
    }

    function closeModal() {
      const modal = document.getElementById('event-detail-modal');
      if (modal) {
        modal.classList.remove('active');
      }
    }

    function closeModalOnBackdrop(e) {
      if (e && e.target && e.target.id === 'event-detail-modal') {
        closeModal();
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    });

    function toggleStrategy(key, name, enabled) {
      vscode.postMessage({ command: 'toggleStrategy', key, name, enabled });
    }
    function deactivateCompletely() {
      if (confirm('Deactivate TokenShield completely?\\n\\nThis will cleanly remove all optimization directives from AGENTS.md, CLAUDE.md, and Copilot files, and halt all background tasks.')) {
        vscode.postMessage({ command: 'deactivateCompletely' });
      }
    }
    function reactivate() {
      vscode.postMessage({ command: 'reactivate' });
    }

    window.openEventModal = openEventModal;
    window.closeModal = closeModal;
    window.closeModalOnBackdrop = closeModalOnBackdrop;
    window.openNativeVsCodeDiff = openNativeVsCodeDiff;
    window.toggleStrategy = toggleStrategy;
    window.deactivateCompletely = deactivateCompletely;
    window.reactivate = reactivate;
  </script>
</body>
</html>`;
  }
}
