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
  savingsStatusBarItem.command = 'tokenshield.sessionBreakdown';

  // Listen to in-memory tracker changes
  context.subscriptions.push(
    chatSavingsTracker.onDidChange(() => {
      updateSessionSavingsWidget();
    })
  );

  // Register the breakdown picker command only — resetSession is owned by extension.ts
  // to ensure the full handler (archive + statusBar update + dashboard refresh) runs.
  context.subscriptions.push(
    vscode.commands.registerCommand('tokenshield.sessionBreakdown', showSessionBreakdownQuickPick)
  );

  // Watch .aicache/call-log.json to capture live MCP calls from Antigravity/Claude
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const wsPath = workspaceFolders[0].uri.fsPath;
    const eventsPattern = new vscode.RelativePattern(wsPath, '.aicache/events.json');
    const eventsWatcher = vscode.workspace.createFileSystemWatcher(eventsPattern);
    const onEventsChange = () => {
      chatSavingsTracker.syncFromDisk();
    };
    eventsWatcher.onDidChange(onEventsChange);
    eventsWatcher.onDidCreate(onEventsChange);
    context.subscriptions.push(eventsWatcher);

    const callLogPattern = new vscode.RelativePattern(wsPath, '.aicache/call-log.json');
    callLogWatcher = vscode.workspace.createFileSystemWatcher(callLogPattern);

    const onLogChange = () => {
      chatSavingsTracker.syncFromDisk();
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
  const sessionNum = chatSavingsTracker.getSessionNumber();
  const sessionStarted = chatSavingsTracker.getSessionStartedAt();

  const formattedTokens = tokensSaved >= 1000
    ? `${(tokensSaved / 1000).toFixed(1)}k`
    : `${tokensSaved}`;

  const formattedCost = costSaved < 0.0001 && costSaved > 0
    ? '<$0.0001'
    : `$${costSaved.toFixed(4)}`;

  savingsStatusBarItem.text = `$(pulse) #${sessionNum} \u00b7 ${formattedTokens} \u2193 ${formattedCost}`;

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  md.appendMarkdown(`### 💎 TokenShield Session #${sessionNum} Savings\n`);
  md.appendMarkdown(`- **Started At**: \`${sessionStarted.toLocaleTimeString()}\`\n`);
  md.appendMarkdown(`- **Session Tokens Avoided**: ~\`${tokensSaved.toLocaleString()}\` tokens\n`);
  md.appendMarkdown(`- **Session Cost Avoided**: \`${formattedCost}\` (Rate: \`${activeModel.name}\`)\n\n`);
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

  md.appendMarkdown(`[\ud83d\udd04 New Session](command:tokenshield.newSession) \u0026nbsp;|\u0026nbsp; [\ud83d\udcac Session History](command:tokenshield.sessionBreakdown) \u0026nbsp;|\u0026nbsp; [\ud83d\udcca Dashboard](command:tokenshield.dashboard)`);

  savingsStatusBarItem.tooltip = md;
  savingsStatusBarItem.show();
}

async function showSessionBreakdownQuickPick(): Promise<void> {
  const events = chatSavingsTracker.getRecentEvents(25);
  const totalTok = chatSavingsTracker.getTotalTokensSaved();
  const totalCost = chatSavingsTracker.getTotalCostSavedUsd();
  const sessionNum = chatSavingsTracker.getSessionNumber();
  const pastSessions = chatSavingsTracker.getPastSessions();

  const items: vscode.QuickPickItem[] = [];

  items.push({
    label: `$(sync) Start New Session (Reset Current Counters to 0)`,
    description: `Currently in Session #${sessionNum}`,
    detail: 'Archives current session savings into history and starts counting fresh from 0 tokens.',
  });

  items.push({
    label: `$(graph) Session #${sessionNum} Total: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
    description: 'Click to open Savings Dashboard',
    detail: 'Aggregated across AST skeletons, semantic cache, context exclusions, and diff modifications.',
  });

  items.push({
    label: '',
    kind: vscode.QuickPickItemKind.Separator,
  });

  if (events.length === 0) {
    items.push({
      label: '$(info) No optimization events in current session yet',
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

  if (pastSessions.length > 0) {
    items.push({
      label: 'Archived Past Sessions',
      kind: vscode.QuickPickItemKind.Separator,
    });

    for (const s of pastSessions) {
      items.push({
        label: `$(history) Session #${s.sessionNumber}: ~${s.totalTokensSaved.toLocaleString()} tokens ($${s.totalCostSavedUsd.toFixed(4)})`,
        description: `${s.startedAt.toLocaleTimeString()} - ${s.endedAt.toLocaleTimeString()}`,
        detail: `${s.eventsCount} events recorded on ${s.modelName}`,
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `TokenShield — Session #${sessionNum} Savings Breakdown`,
    title: `Session #${sessionNum} Savings: ~${totalTok.toLocaleString()} tokens ($${totalCost.toFixed(4)})`,
  });

  if (!selected) { return; }

  if (selected.label.includes('Start New Session')) {
    vscode.commands.executeCommand('tokenshield.newSession');
  } else if (selected.description === 'Click to open Savings Dashboard') {
    vscode.commands.executeCommand('tokenshield.dashboard');
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
          'Semantic Cache',
          'token-cache MCP',
          delta,
          'Served cached answer from local disk without model query'
        );
      }
    }
  } catch { /* ignore */ }
}
