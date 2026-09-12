import * as vscode from 'vscode';
import * as path from 'path';
import { getActiveModel, discoverAvailableModels, setActiveModelOverride } from '../models/modelDetector';
import { DiscoveredModel } from '../core/types';
import { formatCompactTokens } from './formatters';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';

export interface ContextBudgetSnapshot {
  activeModel: DiscoveredModel;
  contextLimitTokens: number;
  activeEditorTokens: number;
  systemInstructionTokens: number;
  openFilesTokens: number;
  totalEstimatedUsedTokens: number;
  remainingTokens: number;
  usedPercentage: number;
  statusLevel: 'normal' | 'warning' | 'critical';
}

const MODEL_LIMIT_MAP: Record<string, number> = {
  'gemini-3.8-flash': 1_048_576,
  'gemini-3.8-pro': 2_097_152,
  'gemini-3.7-flash': 1_048_576,
  'gemini-2.5-pro': 2_097_152,
  'gemini-2.0-flash': 1_048_576,
  'claude-opus-4.6': 200_000,
  'claude-3.5-sonnet': 200_000,
  'claude-3.7-sonnet': 200_000,
  'claude-3.5-haiku': 200_000,
  'claude-3-opus': 200_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o1': 128_000,
  'o3': 128_000,
};

const DEFAULT_LIMIT = 128_000;

export function resolveModelContextLimit(model: DiscoveredModel): number {
  if (model.maxInputTokens && model.maxInputTokens > 0) {
    return model.maxInputTokens;
  }
  const fam = model.family.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_LIMIT_MAP)) {
    if (fam.includes(key)) {
      return limit;
    }
  }
  return DEFAULT_LIMIT;
}

export async function getContextBudgetSnapshot(): Promise<ContextBudgetSnapshot> {
  const model = await getActiveModel();
  const limit = resolveModelContextLimit(model);

  // 1. Active editor tokens
  let activeEditorTokens = 0;
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const text = editor.document.getText();
    activeEditorTokens = Math.max(1, Math.ceil(text.length / 4));
  }

  // 2. Open documents tokens
  let openFilesTokens = 0;
  for (const doc of vscode.workspace.textDocuments) {
    if (editor && doc.uri.toString() === editor.document.uri.toString()) {
      continue;
    }
    if (!doc.isClosed && !doc.uri.scheme.startsWith('git')) {
      openFilesTokens += Math.max(1, Math.ceil(doc.getText().length / 4));
    }
  }

  // Cap background open file context simulation to reasonable active window (e.g. 30k tokens)
  openFilesTokens = Math.min(30_000, openFilesTokens);

  // 3. System instruction tokens estimate
  let systemInstructionTokens = 2_500; // default instructions size
  const wsFolders = vscode.workspace.workspaceFolders;
  if (wsFolders && wsFolders[0]) {
    const wsRoot = wsFolders[0].uri.fsPath;
    const candidateFiles = [
      vscode.Uri.file(`${wsRoot}/.github/copilot-instructions.md`),
      vscode.Uri.file(`${wsRoot}/AGENTS.md`),
      vscode.Uri.file(`${wsRoot}/CLAUDE.md`),
    ];
    for (const f of candidateFiles) {
      try {
        const stat = await vscode.workspace.fs.stat(f);
        if (stat.size > 0) {
          systemInstructionTokens += Math.ceil(stat.size / 4);
        }
      } catch { /* file does not exist */ }
    }
  }

  const totalUsed = activeEditorTokens + openFilesTokens + systemInstructionTokens;
  const remaining = Math.max(0, limit - totalUsed);
  const usedPercentage = Math.min(100, Math.round((totalUsed / limit) * 100));

  let statusLevel: 'normal' | 'warning' | 'critical' = 'normal';
  if (usedPercentage >= 80) {
    statusLevel = 'critical';
  } else if (usedPercentage >= 60) {
    statusLevel = 'warning';
  }

  return {
    activeModel: model,
    contextLimitTokens: limit,
    activeEditorTokens,
    systemInstructionTokens,
    openFilesTokens,
    totalEstimatedUsedTokens: totalUsed,
    remainingTokens: remaining,
    usedPercentage,
    statusLevel,
  };
}

let budgetStatusBarItem: vscode.StatusBarItem | undefined;

export function createBudgetStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  budgetStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  budgetStatusBarItem.command = 'tokensculpt.showContextBudget';
  context.subscriptions.push(budgetStatusBarItem);

  updateBudgetStatusBar();

  // Re-calculate on editor switch or document edit
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateBudgetStatusBar()),
    vscode.workspace.onDidSaveTextDocument(() => updateBudgetStatusBar())
  );

  return budgetStatusBarItem;
}

export async function updateBudgetStatusBar(): Promise<void> {
  if (!budgetStatusBarItem) { return; }
  try {
    const snapshot = await getContextBudgetSnapshot();
    const usedFormatted = formatCompactTokens(snapshot.totalEstimatedUsedTokens);
    const limitFormatted = formatCompactTokens(snapshot.contextLimitTokens);

    let icon = '$(meter)';
    if (snapshot.statusLevel === 'critical') {
      icon = '$(warning)';
      budgetStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (snapshot.statusLevel === 'warning') {
      icon = '$(alert)';
      budgetStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      budgetStatusBarItem.backgroundColor = undefined;
    }

    budgetStatusBarItem.text = `${icon} Context: ${usedFormatted}/${limitFormatted} (${snapshot.usedPercentage}%)`;
    budgetStatusBarItem.tooltip = `TokenSculpt Context Budget\nModel: ${snapshot.activeModel.name}\nUsed: ${snapshot.totalEstimatedUsedTokens.toLocaleString()} / ${snapshot.contextLimitTokens.toLocaleString()} tokens (${snapshot.usedPercentage}%)\nRemaining: ${snapshot.remainingTokens.toLocaleString()} tokens\nClick for detailed breakdown`;
    budgetStatusBarItem.show();
  } catch {
    // Ignore updates when closing
  }
}

export async function showContextBudgetQuickPick(): Promise<void> {
  const snapshot = await getContextBudgetSnapshot();
  const sessionSaved = chatSavingsTracker.getSessionTokensSaved();

  const items: (vscode.QuickPickItem & { actionId: string })[] = [
    {
      actionId: 'model',
      label: `$(hub) Active Model: ${snapshot.activeModel.name}`,
      description: `Tier: ${snapshot.activeModel.tier.toUpperCase()} — Click to switch`,
      detail: `Max context window: ${snapshot.contextLimitTokens.toLocaleString()} tokens`,
    },
    {
      actionId: 'editor',
      label: `$(file-code) Active Editor Buffer`,
      description: `${snapshot.activeEditorTokens.toLocaleString()} tokens — Click to inspect`,
      detail: 'Estimated token size of the currently focused document',
    },
    {
      actionId: 'openFiles',
      label: `$(files) Open Working Files`,
      description: `${snapshot.openFilesTokens.toLocaleString()} tokens — Click to view tabs`,
      detail: 'Estimated background tokens from open tabs included in assistant scope',
    },
    {
      actionId: 'instructions',
      label: `$(book) System Rules & Instructions`,
      description: `${snapshot.systemInstructionTokens.toLocaleString()} tokens — Click to view rules`,
      detail: 'Copilot / Antigravity project instructions and guidelines',
    },
    {
      actionId: 'savings',
      label: `$(shield) Session TokenSculpt Savings`,
      description: `-${sessionSaved.toLocaleString()} tokens saved — Click for options`,
      detail: 'Tokens pruned away this session via AST skeletons, semantic cache, and exclusions',
    },
    {
      actionId: 'headroom',
      label: `$(pie-chart) Context Headroom Remaining`,
      description: `${snapshot.remainingTokens.toLocaleString()} tokens (${100 - snapshot.usedPercentage}% free) — Click for tips`,
      detail: snapshot.statusLevel === 'critical'
        ? '⚠️ High context load: Close unused tabs or use skeleton_view to avoid degradation'
        : '✓ Context consumption is healthy and well within model bounds',
    },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: `TokenSculpt Context Budget — ${snapshot.usedPercentage}% Utilized`,
    placeHolder: 'Click any category to inspect, switch models, or take action',
  });

  if (!selected) { return; }

  switch (selected.actionId) {
    case 'model': {
      const models = await discoverAvailableModels();
      const modelItems: (vscode.QuickPickItem & { model?: DiscoveredModel; custom?: boolean })[] = models.map(m => ({
        label: `${m.name === snapshot.activeModel.name ? '$(check) ' : ''}${m.name}`,
        description: `[${m.tier.toUpperCase()}] Limit: ${resolveModelContextLimit(m).toLocaleString()} tok`,
        detail: `Vendor: ${m.vendor.toUpperCase()} · Family: ${m.family}`,
        model: m,
      }));

      modelItems.push({
        label: `$(edit) Enter Custom Token Window Limit...`,
        description: `Currently ${snapshot.contextLimitTokens.toLocaleString()} tokens`,
        detail: 'Manually specify custom token ceiling for unlisted models',
        custom: true,
      });

      const picked = await vscode.window.showQuickPick(modelItems, {
        title: 'Switch Active AI Model / Context Limit',
        placeHolder: 'Select model to update context budget & pricing',
      });

      if (!picked) { return; }

      if (picked.custom) {
        const input = await vscode.window.showInputBox({
          title: 'Custom Context Window Limit',
          prompt: 'Enter maximum tokens for context window',
          value: String(snapshot.contextLimitTokens),
          validateInput: v => (isNaN(Number(v)) || Number(v) <= 0 ? 'Must be a positive number' : null),
        });
        if (input) {
          const customLimit = Number(input);
          const customModel: DiscoveredModel = {
            ...snapshot.activeModel,
            id: `custom/${snapshot.activeModel.family}`,
            name: `${snapshot.activeModel.name} (Custom ${formatCompactTokens(customLimit)})`,
            maxInputTokens: customLimit,
          };
          setActiveModelOverride(customModel);
          await updateBudgetStatusBar();
          vscode.window.showInformationMessage(`TokenSculpt: Custom context window set to ${customLimit.toLocaleString()} tokens.`);
        }
      } else if (picked.model) {
        setActiveModelOverride(picked.model);
        await updateBudgetStatusBar();
        vscode.window.showInformationMessage(
          `TokenSculpt: Switched active model to ${picked.model.name} (${picked.model.tier.toUpperCase()}). Window: ${resolveModelContextLimit(picked.model).toLocaleString()} tokens.`
        );
      }
      break;
    }
    case 'editor': {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage('No active editor open.');
        return;
      }
      const text = editor.document.getText();
      const lineCount = editor.document.lineCount;
      const charCount = text.length;
      const tokens = Math.max(1, Math.ceil(charCount / 4));
      const fileName = path.basename(editor.document.fileName);

      const action = await vscode.window.showQuickPick([
        {
          label: `$(clippy) Prune and Copy to Clipboard`,
          description: 'Runs Adaptive Pruner to compress code/prompt text',
          action: 'prune',
        },
        {
          label: `$(eye) View AST Skeleton in Dashboard`,
          description: 'View function/class signatures with stripped bodies',
          action: 'dashboard',
        },
      ], {
        title: `Active Buffer: ${fileName} (~${tokens.toLocaleString()} tokens)`,
        placeHolder: `${lineCount.toLocaleString()} lines, ${charCount.toLocaleString()} chars. Select an action:`,
      });

      if (action?.action === 'prune') {
        vscode.commands.executeCommand('tokensculpt.pruneAndCopy');
      } else if (action?.action === 'dashboard') {
        vscode.commands.executeCommand('tokensculpt.dashboard');
      }
      break;
    }
    case 'openFiles': {
      const openDocs = vscode.workspace.textDocuments.filter(d => !d.isClosed && !d.uri.scheme.startsWith('git'));
      const docItems: (vscode.QuickPickItem & { doc?: vscode.TextDocument; closeAll?: boolean })[] = openDocs.map(d => {
        const tokens = Math.max(1, Math.ceil(d.getText().length / 4));
        const base = path.basename(d.uri.fsPath);
        return {
          label: `$(file-code) ${base}`,
          description: `~${tokens.toLocaleString()} tokens (${d.lineCount} lines)`,
          detail: d.uri.fsPath,
          doc: d,
        };
      });

      docItems.unshift({
        label: `$(close-all) Close All Unmodified Background Tabs`,
        description: 'Frees up background context window headroom',
        detail: 'Keeps active document open, closes clean tabs',
        closeAll: true,
      });

      const chosen = await vscode.window.showQuickPick(docItems, {
        title: `Open Working Tabs (${openDocs.length} files, ~${snapshot.openFilesTokens.toLocaleString()} tokens)`,
        placeHolder: 'Select a document to view, or close background tabs',
      });

      if (!chosen) { return; }

      if (chosen.closeAll) {
        await vscode.commands.executeCommand('workbench.action.closeUnmodifiedEditors');
        await updateBudgetStatusBar();
        vscode.window.showInformationMessage('TokenSculpt: Closed unmodified background editors.');
      } else if (chosen.doc) {
        await vscode.window.showTextDocument(chosen.doc);
      }
      break;
    }
    case 'instructions': {
      const wsFolders = vscode.workspace.workspaceFolders;
      if (!wsFolders || !wsFolders[0]) { return; }
      const wsRoot = wsFolders[0].uri.fsPath;
      const candidateFiles = [
        { rel: '.github/copilot-instructions.md', uri: vscode.Uri.file(`${wsRoot}/.github/copilot-instructions.md`) },
        { rel: 'AGENTS.md', uri: vscode.Uri.file(`${wsRoot}/AGENTS.md`) },
        { rel: 'CLAUDE.md', uri: vscode.Uri.file(`${wsRoot}/CLAUDE.md`) },
        { rel: '.vscode/copilot-instructions.md', uri: vscode.Uri.file(`${wsRoot}/.vscode/copilot-instructions.md`) },
      ];

      const ruleItems: (vscode.QuickPickItem & { uri: vscode.Uri })[] = [];
      for (const cf of candidateFiles) {
        try {
          const stat = await vscode.workspace.fs.stat(cf.uri);
          if (stat.size > 0) {
            const tokens = Math.ceil(stat.size / 4);
            ruleItems.push({
              label: `$(book) ${cf.rel}`,
              description: `~${tokens.toLocaleString()} tokens (${stat.size} bytes)`,
              detail: 'Click to open and edit instructions file',
              uri: cf.uri,
            });
          }
        } catch { /* file does not exist */ }
      }

      if (ruleItems.length === 0) {
        vscode.window.showInformationMessage('TokenSculpt: No system instruction files found in workspace.');
        return;
      }

      const pickedRule = await vscode.window.showQuickPick(ruleItems, {
        title: `System Rules & Instructions (~${snapshot.systemInstructionTokens.toLocaleString()} tokens)`,
        placeHolder: 'Select a rule file to open in editor',
      });

      if (pickedRule) {
        await vscode.window.showTextDocument(pickedRule.uri);
      }
      break;
    }
    case 'savings': {
      const action = await vscode.window.showQuickPick([
        {
          label: `$(graph) Open Savings Dashboard`,
          description: 'View full audit log, before/after diffs, and lifetime metrics',
          action: 'dashboard',
        },
        {
          label: `$(calculator) Run "What If" Cost Simulator`,
          description: 'Simulate savings across Claude Opus, GPT-4o, Gemini and Haiku',
          action: 'simulator',
        },
      ], {
        title: `Session Savings: ~${sessionSaved.toLocaleString()} tokens avoided`,
        placeHolder: 'Select a savings view:',
      });

      if (action?.action === 'dashboard') {
        vscode.commands.executeCommand('tokensculpt.dashboard');
      } else if (action?.action === 'simulator') {
        vscode.commands.executeCommand('tokensculpt.simulateCosts');
      }
      break;
    }
    case 'headroom': {
      const action = await vscode.window.showQuickPick([
        {
          label: `$(shield) Generate Smart Exclusions (.copilotignore)`,
          description: 'Exclude heavy build folders and lock files to maximize headroom',
          action: 'exclude',
        },
        {
          label: `$(pulse) Run Full Health Check`,
          description: 'Validate all 20 optimization strategies and MCP servers',
          action: 'health',
        },
      ], {
        title: `Context Headroom: ${snapshot.remainingTokens.toLocaleString()} tokens (${100 - snapshot.usedPercentage}% free)`,
        placeHolder: `Status: ${snapshot.statusLevel.toUpperCase()} · Choose an optimization action:`,
      });

      if (action?.action === 'exclude') {
        vscode.commands.executeCommand('tokensculpt.generateSmartExclusions');
      } else if (action?.action === 'health') {
        vscode.commands.executeCommand('tokensculpt.healthCheck');
      }
      break;
    }
  }
}
