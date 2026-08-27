import * as vscode from 'vscode';
import { getConfig } from '../core/config';
import { getActiveModel } from '../models/modelDetector';

let tokenStatusBarItem: vscode.StatusBarItem | undefined;
let debounceTimer: NodeJS.Timeout | undefined;

export function createEditorTokenBadge(context: vscode.ExtensionContext): vscode.StatusBarItem {
  tokenStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  tokenStatusBarItem.name = 'TokenShield Token Counter';
  tokenStatusBarItem.command = 'aiTokenOptimizer.showDashboard';

  // Listen to active editor change
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      updateTokenBadge(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection(e => {
      scheduleUpdate(e.textEditor);
    }),
    vscode.workspace.onDidChangeTextDocument(e => {
      const active = vscode.window.activeTextEditor;
      if (active && active.document === e.document) {
        scheduleUpdate(active);
      }
    })
  );

  updateTokenBadge(vscode.window.activeTextEditor);
  tokenStatusBarItem.show();
  return tokenStatusBarItem;
}

function scheduleUpdate(editor: vscode.TextEditor | undefined): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    updateTokenBadge(editor);
  }, 100);
}

export async function updateTokenBadge(editor: vscode.TextEditor | undefined): Promise<void> {
  if (!tokenStatusBarItem) {
    return;
  }

  if (!editor || !editor.document || editor.document.isClosed) {
    tokenStatusBarItem.hide();
    return;
  }

  const config = getConfig();
  if (!config.enabled) {
    tokenStatusBarItem.hide();
    return;
  }

  const selection = editor.selection;
  const hasSelection = !selection.isEmpty;
  const text = hasSelection
    ? editor.document.getText(selection)
    : editor.document.getText();

  // Fast & accurate token estimation (~3.8 characters per code token)
  const tokenCount = estimateTokens(text);
  const activeModel = await getActiveModel();
  const pricing = config.pricing[activeModel.tier] || config.pricing.standard;
  const cost = (tokenCount / 1_000_000) * pricing.inputPerMillion;

  const formattedTokens = tokenCount >= 1000
    ? `${(tokenCount / 1000).toFixed(1)}k`
    : `${tokenCount}`;

  const formattedCost = cost < 0.0001 && cost > 0
    ? '<$0.0001'
    : `$${cost.toFixed(4)}`;

  if (hasSelection) {
    tokenStatusBarItem.text = `$(symbol-variable) Sel: ${formattedTokens} tok (${formattedCost})`;
    tokenStatusBarItem.tooltip = [
      `TokenShield Selection Analysis:`,
      `• Selected Tokens: ~${tokenCount.toLocaleString()}`,
      `• Estimated Cost: ${formattedCost} (${activeModel.name})`,
      `• Pricing Rate: $${pricing.inputPerMillion}/1M input tokens`,
      `Click to open TokenShield ROI Dashboard`,
    ].join('\n');
  } else {
    tokenStatusBarItem.text = `$(file-code) ${formattedTokens} tok · ${formattedCost}`;
    tokenStatusBarItem.tooltip = [
      `TokenShield File Analysis:`,
      `• File: ${editor.document.fileName}`,
      `• Estimated Tokens: ~${tokenCount.toLocaleString()}`,
      `• Estimated Prompt Cost: ${formattedCost} (${activeModel.name})`,
      `• Lines: ${editor.document.lineCount.toLocaleString()}`,
      `Click to open TokenShield ROI Dashboard`,
    ].join('\n');
  }

  tokenStatusBarItem.show();
}

/**
 * Heuristic token counter optimized for code, markdown, and JSON.
 */
export function estimateTokens(text: string): number {
  if (!text) { return 0; }
  const len = text.length;
  // Code tends to be ~3.6 to 4.0 chars per token due to symbols, indentation, and identifiers
  return Math.max(1, Math.ceil(len / 3.8));
}
