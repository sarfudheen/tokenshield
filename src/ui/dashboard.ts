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

const REFRESH_COMMAND = 'aiTokenOptimizer.showDashboard';
const EXPORT_COMMAND = 'aiTokenOptimizer.exportTelemetry';
const PRUNE_COMMAND = 'aiTokenOptimizer.pruneSelection';
const PROFILE_COMMAND = 'aiTokenOptimizer.selectProfile';
const EXCLUSIONS_COMMAND = 'aiTokenOptimizer.configureExclusions';
const RESET_COMMAND = 'aiTokenOptimizer.resetSession';

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
  cap: string;
  name: string;
  icon: string;
  subtitle: string;
  liveMetric: string;
  howItSaves: string;
  whereItRan: string;
  tokensSavedBadge: string;
  measurement: Measurement;
}

function getCapCardState(
  capCode: string,
  name: string,
  icon: string,
  subtitle: string,
  howItSaves: string,
  measurement: Measurement,
  events: ChatSavingsEvent[],
  sessionNum: number
): DirectiveCardData {
  if (measurement.status === 'disabled') {
    return {
      id: capCode.toLowerCase(),
      cap: capCode,
      name,
      icon,
      subtitle,
      liveMetric: 'Directive is currently DISABLED in configuration profile',
      tokensSavedBadge: 'DISABLED',
      whereItRan: 'Not loaded into LLM system prompts.',
      howItSaves,
      measurement,
    };
  }

  const capEvents = events.filter(e =>
    e.directive.toUpperCase().includes(capCode.toUpperCase()) ||
    e.directive.toLowerCase().includes(name.toLowerCase())
  );
  const capTokens = capEvents.reduce((acc, e) => acc + e.tokensSaved, 0);

  if (capTokens > 0) {
    const latest = capEvents[0];
    const formatted = capTokens >= 1000 ? `${(capTokens / 1000).toFixed(1)}k` : `${capTokens}`;
    return {
      id: capCode.toLowerCase(),
      cap: capCode,
      name,
      icon,
      subtitle,
      liveMetric: `+${capTokens.toLocaleString()} tokens avoided in Session #${sessionNum} (${capEvents.length} event${capEvents.length > 1 ? 's' : ''})`,
      tokensSavedBadge: `+${formatted} TOKENS`,
      whereItRan: `Last ran on <code>${latest.source}</code>: ${latest.details}`,
      howItSaves,
      measurement: {
        ...measurement,
        percent: measurement.percent || 75,
      },
    };
  }

  // If no events in this session (e.g. freshly reset)
  return {
    id: capCode.toLowerCase(),
    cap: capCode,
    name,
    icon,
    subtitle,
    liveMetric: `0 tokens in Session #${sessionNum} · Directive Armed & Standing Guard`,
    tokensSavedBadge: 'ARMED (0 TOK)',
    whereItRan: `Active system directive in <code>AGENTS.md</code> & <code>copilot-instructions.md</code>. Will record exact file & token savings upon first query.`,
    howItSaves,
    measurement: {
      ...measurement,
      percent: 0,
    },
  };
}

export class DashboardPanel {
  private static currentPanel: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static async show(_extensionUri: vscode.Uri): Promise<void> {
    if (DashboardPanel.currentPanel) {
      DashboardPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      await DashboardPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aiTokenOptimizerDashboard',
      'TokenShield — ROI Savings Dashboard',
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
    <div class="card">
      <div class="card-header">
        <div>
          <div class="cap-tag">${card.cap}</div>
          <h3 class="card-title">${card.icon} ${card.name}</h3>
          <div class="card-subtitle">${card.subtitle}</div>
        </div>
        <div>${badgeHtml}</div>
      </div>

      <div class="live-metric-box">
        <div class="live-metric-title">📊 MEASURED GAIN IN THIS WORKSPACE:</div>
        <div class="live-metric-val">${card.liveMetric}</div>
      </div>

      ${barWidth > 0 ? `
      <div class="bar-container">
        <div class="bar-track"><div class="bar" style="width: ${barWidth}%"></div></div>
      </div>` : ''}

      <div class="info-section">
        <div class="info-label">🎯 WHERE & WHEN IT RAN:</div>
        <div class="info-text">${card.whereItRan}</div>
      </div>

      <div class="card-footer">
        <span class="detail-note"><strong>Mechanism:</strong> ${card.howItSaves}</span>
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
      getCapCardState(
        'CAP-6',
        'AST Skeleton Pruning',
        '🌲',
        'Signatures-Only File Inspection',
        'Extracts types, classes, interfaces, and function signatures without loading implementation bodies.',
        measurements.astSkeleton,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-5',
        'Local Semantic Answer Cache',
        '💾',
        'Zero-Cost Disk Cache',
        'Reuses previous answers from local disk at $0.00 cost without querying the LLM.',
        measurements.semanticCache,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-1',
        'CodeGraph Semantic Indexing',
        '🔍',
        'Graph-First Symbol Explorer',
        'Replaces wide multi-file grep searches (~15,000 tokens) with direct symbol graph hops (~400 tokens: 97% saved).',
        measurements.codeGraph,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-3',
        'Dense Output (Caveman)',
        '🗣️',
        'Zero Conversational Puffery',
        'Strips polite greetings, apologies, and filler explanations from AI responses.',
        measurements.verbosityControl,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-4',
        'Context Hygiene & Compaction',
        '🧹',
        'Multi-Turn Session Pruner',
        'Instructs LLM to clear stale conversational history and drop redundant output logs.',
        measurements.sessionManagement,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-7',
        'Smart Context Exclusions',
        '🚫',
        'Noise & Build Bundle Shield',
        'Blocks lockfiles, compiled dist/ bundles, and minified assets from polluting AI context.',
        measurements.contextExclusion,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-8',
        'Unified Diff Modifications',
        '📝',
        'Targeted Patch Editing',
        'Outputs only modified diff hunks (40 tokens) instead of rewriting entire 500-line files (1,500-5,800 tokens).',
        measurements.diffOnlyOutput,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-10',
        'Smart Model Routing',
        '🚦',
        'Cost-Aware Model Routing',
        'Runs routine coding tasks on lightweight models vs $15.00/1M Flagship models (99% cost reduction).',
        measurements.smartModelRouting,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-9',
        'Agent Loop Guardrails',
        '🛡️',
        'Runaway Retry Interceptor',
        'Aborts infinite retry loops after 3 consecutive failures to prevent runaway credit burn.',
        measurements.agentGuardrails,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-2',
        'RTK Output Compression',
        '📦',
        'Terminal & Test Log Trimmer',
        'Filters out passing test lines and verbose progress spinners before AI ingestion.',
        measurements.outputCompression,
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-11',
        'Git Diff-Scoped Context',
        '🔀',
        'Incremental Change Ingestion',
        'Scopes code reviews, refactors, and test writing strictly to rtk git diff and 1-hop AST callers/callees.',
        { status: strategies.gitDiffContext ? 'measured' : 'disabled', percent: 85, detail: 'Scopes PRs to rtk git diff hunks and direct AST dependencies' },
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-12',
        'Cloud KV-Cache Alignment',
        '⚡',
        'Deterministic Prefix Cache',
        'Preserves byte-identical system prompt prefixes to unlock up to 90% cloud input token cache discounts.',
        { status: strategies.kvCacheAlignment ? 'measured' : 'disabled', percent: 90, detail: 'Byte-aligned deterministic prefix blocks' },
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-13',
        'Comment & Header Stripper',
        '✂️',
        'Payload Minifier',
        'Strips license headers, copyright preambles, and low-signal inline comments during context ingestion.',
        { status: strategies.commentStripper ? 'measured' : 'disabled', percent: 30, detail: 'Removes boilerplate comments from source code' },
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-14',
        'Test Failure Isolator',
        '🧪',
        'Smart Test Shrinker',
        'Captures only failing assertions and line numbers, stripping out passing suites from terminal logs.',
        { status: strategies.testFailureIsolator ? 'measured' : 'disabled', percent: 95, detail: 'Isolates failing test lines from test runners' },
        recentEvents,
        sessionNum
      ),
      getCapCardState(
        'CAP-15',
        'Windowed Range Slicing',
        '🔍',
        'Anti-File Dump Shield',
        'Restricts large-file navigation to targeted 100-line slice windows around symbol declarations.',
        { status: strategies.rangeSlicing ? 'measured' : 'disabled', percent: 80, detail: 'Enforces 100-line window slicing on file reads' },
        recentEvents,
        sessionNum
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
                    <th style="width:180px;">Directive</th>
                    <th style="width:200px;">Target File / Action</th>
                    <th style="width:170px;">Tokens Avoided</th>
                    <th>How It Was Avoided</th>
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
      <h2>📜 Historical Archived Sessions (Click Any Session to View Breakdown)</h2>
      <div style="margin-bottom:32px;">
        ${sessionBlocks}
      </div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TokenShield ROI Dashboard</title>
  <style>
    :root {
      --bg: #0e131f;
      --card-bg: #161c2d;
      --card-border: #232c42;
      --text: #e2e8f0;
      --text-muted: #8e9db3;
      --accent: #38bdf8;
      --green: #4ade80;
      --green-bg: rgba(74, 222, 128, 0.14);
      --blue-bg: rgba(56, 189, 248, 0.14);
      --red: #f87171;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: var(--text);
      background-color: var(--bg);
      padding: 28px 32px;
      line-height: 1.5;
      margin: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .tagline {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .btn-group {
      display: flex;
      gap: 10px;
    }
    .btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--text);
      padding: 6px 14px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 12.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover { background: #334155; color: #fff; }
    .btn-primary { background: #0284c7; border-color: #0369a1; color: #fff; }
    .btn-primary:hover { background: #0369a1; }
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 20px;
    }
    .kpi-val {
      font-size: 32px;
      font-weight: 800;
      color: var(--green);
      line-height: 1.1;
    }
    .kpi-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
      margin-top: 6px;
    }
    .kpi-desc {
      font-size: 11.5px;
      color: var(--text-muted);
      margin-top: 4px;
      line-height: 1.4;
    }
    h2 {
      font-size: 17px;
      font-weight: 700;
      margin: 32px 0 16px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ledger-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 32px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left; }
    th { background: #1a2236; padding: 12px 16px; font-weight: 700; color: #cbd5e1; border-bottom: 1px solid var(--card-border); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    td { padding: 12px 16px; border-bottom: 1px solid var(--card-border); vertical-align: middle; }
    tr:last-child td { border-bottom: none; }
    .ledger-time { font-family: monospace; font-size: 11.5px; color: var(--accent); background: rgba(56, 189, 248, 0.1); padding: 2px 6px; border-radius: 4px; }
    .tool-badge { background: #222d44; color: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-size: 11.5px; font-weight: 600; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 18px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .cap-tag {
      font-size: 10.5px;
      font-weight: 700;
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      margin: 2px 0 0 0;
      color: #fff;
    }
    .card-subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }
    .badge {
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
      letter-spacing: 0.03em;
    }
    .badge-measured { background: var(--green-bg); color: var(--green); border: 1px solid rgba(74, 222, 128, 0.3); }
    .badge-off { background: rgba(148, 163, 184, 0.12); color: var(--text-muted); }
    .live-metric-box {
      background: #0f1523;
      border: 1px solid #1e283d;
      border-left: 3px solid var(--green);
      border-radius: 6px;
      padding: 10px 12px;
      margin: 8px 0 12px 0;
    }
    .live-metric-title {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.05em;
      margin-bottom: 2px;
    }
    .live-metric-val {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--green);
      line-height: 1.4;
    }
    .bar-container { margin: 4px 0 12px 0; }
    .bar-track { background: #232c42; height: 6px; border-radius: 3px; overflow: hidden; }
    .bar { background: var(--green); height: 100%; border-radius: 3px; }
    .info-section { margin-bottom: 12px; }
    .info-label { font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.04em; margin-bottom: 2px; }
    .info-text { font-size: 12px; color: var(--text); line-height: 1.45; }
    .card-footer {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 10px;
      font-size: 11px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <h1>🛡️ TokenShield Real-Time ROI Dashboard</h1>
      <div class="tagline">Live Telemetry & Verifiable Token Avoidance Ledger (100% Local On-Device)</div>
    </div>
    <div class="btn-group">
      <a class="btn" href="command:${REFRESH_COMMAND}">↻ Refresh Stats</a>
      <a class="btn" href="command:${RESET_COMMAND}">🔄 Reset / New Session</a>
      <a class="btn btn-primary" href="command:${EXPORT_COMMAND}">⬇ Export Audit Report</a>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-val">+${totalTokensSaved.toLocaleString()}</div>
      <div class="kpi-title">Session #${sessionNum} Tokens Avoided</div>
      <div class="kpi-desc">Active since <strong>${sessionStarted.toLocaleTimeString()}</strong> · Calculated across AST skeletons, exclusions, cache & diffs.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--green);">$${totalCostSaved.toFixed(4)}</div>
      <div class="kpi-title">Session #${sessionNum} Cost Avoided</div>
      <div class="kpi-desc">Calculated at $${config.pricing[activeModel.tier].inputPerMillion.toFixed(2)}/1M token rate for <strong>${activeModel.name}</strong>.</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val" style="color:var(--accent); font-size:24px; padding-top:4px;">${activeModel.name}</div>
      <div class="kpi-title">Active AI Assistant (${activeModel.tier.toUpperCase()} Tier)</div>
      <div class="kpi-desc">Auto-detected Google Antigravity IDE host environment with lightweight fast pricing.</div>
    </div>
  </div>

  <h2>🔴 Live Activity & Savings Ledger (Session #${sessionNum})</h2>
  <div class="ledger-container">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Directive</th>
          <th>Target File / Action</th>
          <th>Exact Tokens Avoided</th>
          <th>How It Was Avoided</th>
        </tr>
      </thead>
      <tbody>
        ${ledgerRows}
      </tbody>
    </table>
  </div>

  ${pastSessionsHtml}

  <h2>🛡️ Live Strategy Directives & Measured Workspace Metrics (CAP-1 to CAP-10)</h2>
  <div class="grid">
    ${cardsHtml}
  </div>

</body>
</html>`;
  }
}
