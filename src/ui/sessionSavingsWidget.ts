import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';
import { getConfig } from '../core/config';
import { getActiveModel } from '../models/modelDetector';

let savingsStatusBarItem: vscode.StatusBarItem | undefined;
let callLogWatcher: vscode.FileSystemWatcher | undefined;

export function createSessionSavingsWidget(context: vscode.ExtensionContext): vscode.StatusBarItem {
  savingsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
  savingsStatusBarItem.name = 'TokenShield Session Savings';
  savingsStatusBarItem.command = 'aiTokenOptimizer.showSessionBreakdown';

  // Listen to in-memory tracker changes
  context.subscriptions.push(
    chatSavingsTracker.onDidChange(() => {
      updateSessionSavingsWidget();
    })
  );

  // Register the interactive QuickPick command
  context.subscriptions.push(
    vscode.commands.registerCommand('aiTokenOptimizer.showSessionBreakdown', showSessionBreakdownQuickPick)
  );

  // Watch .aicache/call-log.json to capture live MCP calls from Antigravity/Claude
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const wsPath = workspaceFolders[0].uri.fsPath;
    const callLogPattern = new vscode.RelativePattern(wsPath, '.aicache/call-log.json');
    callLogWatcher = vscode.workspace.createFileSystemWatcher(callLogPattern);

    const onLogChange = () => {
      syncWithCallLog(wsPath);
    };

    callLogWatcher.onDidChange(onLogChange);
    callLogWatcher.onDidCreate(onLogChange);
    context.subscriptions.push(callLogWatcher);
  }

  updateSessionSavingsWidget();
  savingsStatusBarItem.show();
  return savingsStatusBarItem;
}

export async function updateSessionSavingsWidget(): Promise<void> {
  if (!savingsStatusBarItem) {
    return;
  }

  const config = getConfig();
  if (!config.enabled) {
    savingsStatusBarItem.hide();
    return;
  }

  const tokensSaved = chatSavingsTracker.getTotalTokensSaved();
  const costSaved = chatSavingsTracker.getTotalCostSavedUsd();
  const activeModel = await getActiveModel();

  const formattedTokens = tokensSaved >= 1000
    ? `${(tokensSaved / 1000).toFixed(1)}k`
    : `${tokensSaved}`;

  const formattedCost = costSaved < 0.0001 && costSaved > 0
    ? '<$0.0001'
    : `$${costSaved.toFixed(4)}`;

  savingsStatusBarItem.text = `$(sparkle) Saved: ${formattedTokens} tok (${formattedCost})`;

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  md.appendMarkdown(`### 💎 TokenShield Live Session Savings\n`);
  md.appendMarkdown(`- **Total Tokens Avoided**: ~\`${tokensSaved.toLocaleString()}\` tokens\n`);
  md.appendMarkdown(`- **Total Cost Avoided**: \`${formattedCost}\` (Based on \`${activeModel.name}\`)\n\n`);
  md.appendMarkdown(`---\n\n`);

  const recent = chatSavingsTracker.getRecentEvents(4);
  if (recent.length > 0) {
    md.appendMarkdown(`**Recent Optimization Events**:\n`);
    for (const ev of recent) {
      const timeStr = ev.timestamp.toLocaleTimeString();
      const evCost = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
      md.appendMarkdown(`- \`${timeStr}\` **${ev.directive}**: +${ev.tokensSaved.toLocaleString()} tok (${evCost}) — *${ev.details}*\n`);
    }
    md.appendMarkdown(`\n---\n\n`);
  }

  md.appendMarkdown(`[💬 View Per-Chat History](command:aiTokenOptimizer.showSessionBreakdown) &nbsp;|&nbsp; [📊 Open ROI Dashboard](command:aiTokenOptimizer.showDashboard)`);

  savingsStatusBarItem.tooltip = md;
  savingsStatusBarItem.show();
}

async function showSessionBreakdownQuickPick(): Promise<void> {
  const events = chatSavingsTracker.getRecentEvents(20);
  const totalTok = chatSavingsTracker.getTotalTokensSaved();
  const totalCost = chatSavingsTracker.getTotalCostSavedUsd();

  const items: vscode.QuickPickItem[] = [];

  items.push({
    label: `$(graph) Total Session Savings: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
    description: 'Click to open full graphical ROI Dashboard',
    detail: 'Aggregated across AST skeletons, semantic cache, context exclusions, and diff modifications.',
  });

  items.push({
    label: '',
    kind: vscode.QuickPickItemKind.Separator,
  });

  if (events.length === 0) {
    items.push({
      label: '$(info) No specific chat optimization events recorded yet',
      detail: 'Chat with your AI assistant or prune a selection to see live per-query savings.',
    });
  } else {
    for (const ev of events) {
      const timeStr = ev.timestamp.toLocaleTimeString();
      const evCost = ev.costSavedUsd < 0.0001 ? '<$0.0001' : `$${ev.costSavedUsd.toFixed(4)}`;
      items.push({
        label: `$(pass) [${ev.directive}] +${ev.tokensSaved.toLocaleString()} tokens (${evCost})`,
        description: timeStr,
        detail: `${ev.source}: ${ev.details}`,
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'TokenShield — Live Per-Chat Savings Breakdown',
    title: `Session Token Avoidance: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
  });

  if (selected && selected.description === 'Click to open full graphical ROI Dashboard') {
    vscode.commands.executeCommand('aiTokenOptimizer.showDashboard');
  }
}

function syncWithCallLog(wsPath: string): void {
  const logFile = path.join(wsPath, '.aicache', 'call-log.json');
  if (!fs.existsSync(logFile)) { return; }

  try {
    const raw = fs.readFileSync(logFile, 'utf-8');
    const data = JSON.parse(raw);
    if (data && typeof data.totalSavedTokens === 'number') {
      const delta = data.totalSavedTokens;
      if (delta > 0) {
        chatSavingsTracker.recordEvent(
          'CAP-5: Semantic Cache',
          'token-cache MCP',
          delta,
          'Served cached answer from local disk without model query'
        );
      }
    }
  } catch { /* ignore */ }
}
