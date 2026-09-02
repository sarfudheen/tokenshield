import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, getEffectiveStrategies, ExtensionConfig, StrategyState, countActiveStrategies, TOTAL_STRATEGIES } from '../core/config';
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
  Measurement,
} from '../strategies';
import { getRoiEngine } from '../telemetry/roiEngine';
import { getActiveModel, discoverAvailableModels } from '../models/modelDetector';
import { DiscoveredModel } from '../core/types';
import { chatSavingsTracker, ChatSavingsEvent } from '../telemetry/chatSavingsTracker';
import { SemanticCacheStore } from '../cache/store';

const REFRESH_COMMAND = 'tokenshield.dashboard';
const EXPORT_COMMAND = 'tokenshield.exportReport';
const PRUNE_COMMAND = 'tokenshield.pruneAndCopy';
const PROFILE_COMMAND = 'tokenshield.switchProfile';
const EXCLUSIONS_COMMAND = 'tokenshield.exclusions';
const RESET_COMMAND = 'tokenshield.newSession';

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
}

interface DirectiveCardData {
  id: string;
  tag: string;
  name: string;
  icon: string;
  subtitle: string;
  liveMetric: string;
  howItSaves: string;
  whereItRan: string;
  tokensSavedBadge: string;
  measurement: Measurement;
  groupClass: string;
}

function getFeatureCardState(
  tag: string,
  name: string,
  icon: string,
  subtitle: string,
  howItSaves: string,
  measurement: Measurement,
  events: ChatSavingsEvent[],
  sessionNum: number,
  groupClass: string = 'cap-group-a'
): DirectiveCardData {
  if (measurement.status === 'disabled') {
    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      tag,
      name,
      icon,
      subtitle,
      liveMetric: 'Feature is currently disabled in your configuration profile',
      tokensSavedBadge: 'DISABLED',
      whereItRan: 'Not active in AI prompts or tools.',
      howItSaves,
      measurement,
      groupClass,
    };
  }

  const capEvents = events.filter(e =>
    e.directive.toLowerCase().includes(name.toLowerCase()) ||
    e.directive.toLowerCase().includes(tag.toLowerCase())
  );
  const capTokens = capEvents.reduce((acc, e) => acc + e.tokensSaved, 0);

  if (capTokens > 0) {
    const latest = capEvents[0];
    const formatted = capTokens >= 1000 ? `${(capTokens / 1000).toFixed(1)}k` : `${capTokens}`;
    return {
      id: name.toLowerCase().replace(/\s+/g, '-'),
      tag,
      name,
      icon,
      subtitle,
      liveMetric: `+${capTokens.toLocaleString()} tokens saved in Session #${sessionNum} (${capEvents.length} event${capEvents.length > 1 ? 's' : ''})`,
      tokensSavedBadge: `+${formatted} TOKENS`,
      whereItRan: `Last ran on <code>${latest.source}</code>: ${latest.details}`,
      howItSaves,
      measurement: {
        ...measurement,
        percent: measurement.percent || 75,
      },
      groupClass,
    };
  }

  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    tag,
    name,
    icon,
    subtitle,
    liveMetric: `0 tokens in Session #${sessionNum} · Feature active & standing by`,
    tokensSavedBadge: 'ACTIVE (0 TOK)',
    whereItRan: `Active in AI instruction directives. Will record savings on your next assistant query.`,
    howItSaves,
    measurement: {
      ...measurement,
      percent: 0,
    },
    groupClass,
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
        ],
      }
    );

    DashboardPanel.currentPanel = new DashboardPanel(panel);
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

    let badgeHtml = `<span class="badge badge-measured">${card.tokensSavedBadge}</span>`;
    if (m.status === 'disabled') {
      badgeHtml = `<span class="badge badge-off">DISABLED</span>`;
    }

    return `
    <div class="card ${card.groupClass || ''} ${m.status === 'disabled' ? 'cap-disabled' : ''}">
      <div class="card-header">
        <div>
          <div class="cap-tag">${card.tag}</div>
          <h3 class="card-title">${card.icon} ${card.name}</h3>
          <div class="card-subtitle">${card.subtitle}</div>
        </div>
        <div>${badgeHtml}</div>
      </div>

      <div class="live-metric-box">
        <div class="live-metric-title">📊 WORKSPACE SAVINGS:</div>
        <div class="live-metric-val">${card.liveMetric}</div>
      </div>

      ${barWidth > 0 ? `
      <div class="bar-container">
        <div class="bar-track"><div class="bar" style="width: ${barWidth}%"></div></div>
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
    const totalTokensSaved = chatSavingsTracker.getTotalTokensSaved();
    const totalCostSaved = chatSavingsTracker.getTotalCostSavedUsd();
    const sessionNum = chatSavingsTracker.getSessionNumber();
    const sessionStarted = chatSavingsTracker.getSessionStartedAt();
    const pastSessions = chatSavingsTracker.getPastSessions();

    const directiveCards: DirectiveCardData[] = [
      getFeatureCardState(
        'CODE SEARCH',
        'CodeGraph Pre-Indexing',
        '🔍',
        'Semantic Symbol Explorer',
        'Replaces multi-file grep scans with direct AST graph lookups (~97% context reduction).',
        measurements.codeGraph,
        recentEvents,
        sessionNum,
        'cap-group-a'
      ),
      getFeatureCardState(
        'TERMINAL',
        'CLI Output Compression',
        '⚡',
        'Shell Output Filter',
        'Filters verbose terminal, test, and git output to isolate actionable output (60-90% smaller).',
        measurements.outputCompression,
        recentEvents,
        sessionNum,
        'cap-group-a'
      ),
      getFeatureCardState(
        'PROMPT FILTER',
        'Concise AI Responses',
        '🗣️',
        'Compact Output Mode',
        'Strips conversational filler, pleasantries, and polite apologies from assistant responses.',
        measurements.verbosityControl,
        recentEvents,
        sessionNum,
        'cap-group-a'
      ),
      getFeatureCardState(
        'SESSION',
        'Context Compaction',
        '🧹',
        'Multi-Turn Session Pruning',
        'Automatically clears stale conversational history and redundant tool output turns.',
        measurements.sessionManagement,
        recentEvents,
        sessionNum,
        'cap-group-a'
      ),
      getFeatureCardState(
        'DISK CACHE',
        'Semantic Cache',
        '💾',
        'Instant Local Answer Cache',
        'Serves repeated or similar questions instantly from local disk at $0.00 cost (zero model tokens).',
        measurements.semanticCache,
        recentEvents,
        sessionNum,
        'cap-group-b'
      ),
      getFeatureCardState(
        'AST PARSER',
        'AST Skeletons',
        '🌲',
        'Signatures-Only Inspection',
        'Loads interfaces, classes, and function signatures without ingesting full implementation bodies.',
        measurements.astSkeleton,
        recentEvents,
        sessionNum,
        'cap-group-b'
      ),
      getFeatureCardState(
        'EXCLUSIONS',
        'Smart Context Exclusions',
        '🚫',
        'Noise & Build File Shield',
        'Prevents lockfiles, compiled dist/ bundles, and minified code from polluting prompt context.',
        measurements.contextExclusion,
        recentEvents,
        sessionNum,
        'cap-group-b'
      ),
      getFeatureCardState(
        'PATCH EDITING',
        'Diff-Only Output',
        '📝',
        'Targeted Patch Editing',
        'Outputs modified diff hunks instead of rewriting entire multi-hundred line files.',
        measurements.diffOnlyOutput,
        recentEvents,
        sessionNum,
        'cap-group-b'
      ),
      getFeatureCardState(
        'SAFETY',
        'Loop Guardrails',
        '🛡️',
        'Runaway Retry Interceptor',
        'Halts runaway retry loops after 3 failures to prevent expensive token and cost burns.',
        measurements.agentGuardrails,
        recentEvents,
        sessionNum,
        'cap-group-c'
      ),
      getFeatureCardState(
        'ROUTING',
        'Smart Model Routing',
        '🚦',
        'Cost-Aware Model Routing',
        'Routes routine tasks (formatting, renaming, simple edits) to faster, cost-effective models.',
        measurements.smartModelRouting,
        recentEvents,
        sessionNum,
        'cap-group-c'
      ),
      getFeatureCardState(
        'GIT SCOPE',
        'Git Diff Scoping',
        '🔀',
        'Incremental Change Ingestion',
        'Restricts code reviews, PRs, and unit test generation strictly to git diff lines and direct callers.',
        { status: strategies.gitDiffContext ? 'measured' : 'disabled', percent: 85, detail: 'Scopes reviews to git diff hunks and direct AST dependencies' },
        recentEvents,
        sessionNum,
        'cap-group-c'
      ),
      getFeatureCardState(
        'CLOUD CACHE',
        'Prompt Prefix Caching',
        '⚡',
        'Deterministic KV-Cache',
        'Maintains deterministic system prompt prefixes to unlock cloud input token caching discounts.',
        { status: strategies.kvCacheAlignment ? 'measured' : 'disabled', percent: 90, detail: 'Byte-aligned deterministic prefix blocks' },
        recentEvents,
        sessionNum,
        'cap-group-c'
      ),
      getFeatureCardState(
        'MINIFIER',
        'Comment & Header Stripper',
        '✂️',
        'Source Minifier',
        'Strips license preambles, copyright blocks, and low-signal filler comments on file reads.',
        { status: strategies.commentStripper ? 'measured' : 'disabled', percent: 30, detail: 'Removes boilerplate comments from source code' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'TEST RUNNER',
        'Test Failure Isolator',
        '🧪',
        'Failure Extractor',
        'Isolates failing assertions and line numbers, stripping passing test suites from logs.',
        { status: strategies.testFailureIsolator ? 'measured' : 'disabled', percent: 95, detail: 'Extracts failing assertions from test runners' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'RANGE SLICER',
        'Windowed Range Slicing',
        '🔍',
        'Slice Navigation',
        'Constrains file reads to targeted 100-line slice windows around symbol declarations.',
        { status: strategies.rangeSlicing ? 'measured' : 'disabled', percent: 80, detail: 'Enforces 100-line window slicing on file reads' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'EDITOR SCOPE',
        'Inline Chat Scope Lock',
        '🎯',
        'Selection Lock',
        'Pins inline editor chat context strictly to selected lines and immediate symbol references.',
        { status: strategies.inlineChatScopePinning ? 'measured' : 'disabled', percent: 85, detail: 'Locks inline chat context to active selection' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'RULES',
        '.copilotignore Generator',
        '🛡️',
        'Context Filter Rules',
        'Maintains project-level .copilotignore rules to block build files, secrets, and assets.',
        { status: strategies.copilotIgnoreGeneration ? 'measured' : 'disabled', percent: 90, detail: 'Enforces .copilotignore file exclusion rules' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'SESSION CACHE',
        'Edit Session Awareness',
        '🔄',
        'Active Editor Cache',
        'Treats files already open in multi-file edit sessions as loaded, avoiding redundant re-reads.',
        { status: strategies.copilotEditsAwareness ? 'measured' : 'disabled', percent: 75, detail: 'Avoids re-reading open edit session files' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
      getFeatureCardState(
        'MONITOR',
        'Context Saturation Monitor',
        '💡',
        'Thread Reset Nudge',
        'Proactively suggests fresh chat threads when conversation length exceeds 40 messages.',
        { status: strategies.threadResetTrigger ? 'measured' : 'disabled', percent: 100, detail: 'Surfaces thread reset nudges on long conversations' },
        recentEvents,
        sessionNum,
        'cap-group-d'
      ),
    ];

    const cardsHtml = directiveCards.map(c => this.renderDirectiveCard(c)).join('\n');

    // Build Live Activity Ledger rows
    let ledgerRows = '';
    if (recentEvents.length === 0) {
      ledgerRows = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No events logged in Session #${sessionNum} yet. Use the prompt pruner or ask an AI query to see live events.</td></tr>`;
    } else {
      ledgerRows = recentEvents.map(ev => {
        const timeStr = ev.timestamp.toLocaleTimeString();
        const costStr = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
        return `
        <tr>
          <td><span class="ledger-time">${timeStr}</span></td>
          <td><span class="tool-badge">${ev.directive}</span></td>
          <td><code>${ev.source}</code></td>
          <td style="color:var(--green); font-weight:700;">+${ev.tokensSaved.toLocaleString()} tok (${costStr})</td>
          <td style="color:var(--text-muted); font-size:12px;">${ev.details}</td>
        </tr>`;
      }).join('\n');
    }

    // Build Past Sessions Table with Expandable Event Ledgers
    let pastSessionsHtml = '';
    if (pastSessions.length > 0) {
      const sessionBlocks = pastSessions.map(s => {
        const eventRows = (s.events || []).map(ev => {
          const timeStr = new Date(ev.timestamp).toLocaleTimeString();
          const costStr = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
          return `
            <tr>
              <td><span class="ledger-time">${timeStr}</span></td>
              <td><span class="tool-badge">${ev.directive}</span></td>
              <td><code>${ev.source}</code></td>
              <td style="color:var(--green); font-weight:700;">+${ev.tokensSaved.toLocaleString()} tok (${costStr})</td>
              <td style="color:var(--text-muted); font-size:12px;">${ev.details}</td>
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
                    <th style="width:120px;">Timestamp</th>
                    <th style="width:180px;">Optimization</th>
                    <th style="width:200px;">Target File / Action</th>
                    <th style="width:170px;">Tokens Saved</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${eventRows.length > 0 ? eventRows : '<tr><td colspan="5" style="text-align:center; padding:16px; color:#64748b;">No individual events logged in this session.</td></tr>'}
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
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>🛡️ TokenShield Savings Dashboard</h1>
      <div class="tagline">Real-time local token & cost optimization monitor (100% private & on-device)</div>
    </div>
    <div class="btn-group">
      <a class="btn" href="command:${REFRESH_COMMAND}">↻ Refresh Stats</a>
      <a class="btn" href="command:${RESET_COMMAND}">🔄 Reset / New Session</a>
      <a class="btn btn-primary" href="command:${EXPORT_COMMAND}">⬇ Export Savings Report</a>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-val">+${totalTokensSaved.toLocaleString()}</div>
      <div class="kpi-title">Session #${sessionNum} Tokens Saved</div>
      <div class="kpi-desc">Active since <strong>${sessionStarted.toLocaleTimeString()}</strong> · Calculated across AST skeletons, exclusions, cache & diffs.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--green);">$${totalCostSaved.toFixed(4)}</div>
      <div class="kpi-title">Session #${sessionNum} Estimated Savings</div>
      <div class="kpi-desc">Calculated at $${config.pricing[activeModel.tier].inputPerMillion.toFixed(2)}/1M token rate for <strong>${activeModel.name}</strong>.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--accent); font-size:24px; padding-top:4px;">${activeModel.name}</div>
      <div class="kpi-title">Active AI Assistant (${activeModel.tier.toUpperCase()} Tier)</div>
      <div class="kpi-desc">Auto-detected Google Antigravity IDE host environment with lightweight fast pricing.</div>
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
        </tr>
      </thead>
      <tbody>
        ${ledgerRows}
      </tbody>
    </table>
  </div>

  ${pastSessionsHtml}

  <h2>🛡️ Optimization Features (${TOTAL_STRATEGIES} Active)</h2>
  <div class="grid">
    ${cardsHtml}
  </div>

</body>
</html>`;
  }
}
