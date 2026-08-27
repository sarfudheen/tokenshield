import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, TOTAL_STRATEGIES } from './core/config';
import { showProjectPicker } from './ui/projectPicker';
import { generateAllInstructions, exportInstructionsToRepo } from './generators';
import { installAllTools } from './installer';
import { configureMcpServers } from './mcp';
import { createStatusBar, updateStatusBar, disposeStatusBar } from './ui/statusBar';
import { createEditorTokenBadge } from './ui/editorTokenBadge';
import { pruneContext } from './strategies/adaptivePruner';
import { showProfilePicker } from './ui/quickPick';
import { DashboardPanel } from './ui/dashboard';
import { exportTelemetryCommand } from './ui/exportTelemetry';
import { startCodeGraphWatcher, runCodeGraphReindex, validateIndex, disposeCodeGraphWatcher, validateAllStrategies, applyContextExclusions, showExclusionPicker } from './strategies';
import { SemanticCacheStore } from './cache/store';
import { CallLogStore } from './cache/callLog';
import { startSession } from './session/tracker';

let outputChannel: vscode.OutputChannel;
let extensionPath: string;
let sessionStarted = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('AI Token Optimizer');
  outputChannel.appendLine('[activate] TokenShield starting...');
  extensionPath = context.extensionPath;

  const config = getConfig();

  if (!config.enabled) {
    outputChannel.appendLine('[activate] Extension disabled via settings');
    return;
  }

  initSessionTracking();

  // Register commands — original + new
  context.subscriptions.push(
    vscode.commands.registerCommand('aiTokenOptimizer.toggleAll', toggleAllCommand),
    vscode.commands.registerCommand('aiTokenOptimizer.selectProfile', showProfilePicker),
    vscode.commands.registerCommand('aiTokenOptimizer.regenerateInstructions', regenerateCommand),
    vscode.commands.registerCommand('aiTokenOptimizer.showDashboard', () => DashboardPanel.show(context.extensionUri)),
    vscode.commands.registerCommand('aiTokenOptimizer.reindex', () => runCodeGraphReindex(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.validateIndex', () => validateIndex(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.installTools', () => installAllTools(outputChannel, true)),
    vscode.commands.registerCommand('aiTokenOptimizer.manageProjects', () => showProjectPicker(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.configureMcp', () => configureMcpServers(outputChannel, extensionPath)),
    vscode.commands.registerCommand('aiTokenOptimizer.validateAll', () => validateAllStrategies(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.clearCache', clearCacheCommand),
    vscode.commands.registerCommand('aiTokenOptimizer.exportTelemetry', () => exportTelemetryCommand(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.configureExclusions', () => showExclusionPicker(outputChannel)),
    vscode.commands.registerCommand('aiTokenOptimizer.pruneSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      const result = pruneContext(text, { aggressive: true });
      await vscode.env.clipboard.writeText(result.prunedText);
      vscode.window.showInformationMessage(
        `TokenShield: Pruned context copied to clipboard! (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} → ${result.prunedTokensEst} tok)`
      );
    }),
    vscode.commands.registerCommand('aiTokenOptimizer.exportToRepo', async () => {
      const results = await exportInstructionsToRepo(getConfig());
      vscode.window.showInformationMessage(`TokenShield: Exported ${results.length} instruction files to repository.`);
    }),
  );

  // Create main status bar & editor token counter badge
  const statusBar = createStatusBar();
  const tokenBadge = createEditorTokenBadge(context);
  context.subscriptions.push(statusBar, tokenBadge);

  // Listen for config changes — hot-swap strategies without restart
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiTokenOptimizer')) {
        updateStatusBar();
        onConfigChanged();
      }
    })
  );

  // Auto-apply on activation
  if (config.autoApply) {
    await autoApply(config);
  }

  // Start CodeGraph file watcher
  if (config.activeStrategies.codeGraph) {
    const watchers = startCodeGraphWatcher(outputChannel);
    context.subscriptions.push(...watchers);
  }

  // CAP-7: Apply context exclusions on activation
  const strategies = getEffectiveStrategies(config);
  if (strategies.contextExclusion) {
    try {
      await applyContextExclusions(outputChannel);
    } catch (err) {
      outputChannel.appendLine(`[activate] Context exclusion failed: ${err}`);
    }
  }

  const activeCount = countActiveStrategies(strategies);
  outputChannel.appendLine(`[activate] AI Token Optimizer ready — ${activeCount}/${TOTAL_STRATEGIES} strategies active`);
}

// Starts once per window — elapsed-session stats track from here, not from
// a persisted log. Guarded so toggling the extension off/on mid-window
// doesn't reset the clock a user already started watching.
function initSessionTracking(): void {
  if (sessionStarted) { return; }
  sessionStarted = true;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cacheSnapshot = ws ? new SemanticCacheStore(ws).stats() : null;
  const callCountsSnapshot = ws ? new CallLogStore(ws).counts() : null;
  startSession(cacheSnapshot, Date.now, callCountsSnapshot);
}

async function autoApply(config: ReturnType<typeof getConfig>): Promise<void> {
  outputChannel.appendLine('[auto-apply] Starting auto-apply...');

  // 1. Generate instruction files
  try {
    const results = await generateAllInstructions(config);
    for (const result of results) {
      if (result.created) {
        outputChannel.appendLine(`[auto-apply] Created: ${result.filePath}`);
      } else if (result.updated) {
        outputChannel.appendLine(`[auto-apply] Updated: ${result.filePath}`);
      } else if (result.skipped) {
        outputChannel.appendLine(`[auto-apply] Skipped (unchanged): ${result.filePath}`);
      }
    }
    const created = results.filter(r => r.created).length;
    const updated = results.filter(r => r.updated).length;
    if (created > 0 || updated > 0) {
      vscode.window.showInformationMessage(
        `AI Token Optimizer: ${created} instruction files created, ${updated} updated`
      );
    }
  } catch (err) {
    outputChannel.appendLine(`[auto-apply] Instruction generation failed: ${err}`);
  }

  // 2. Install tools silently
  if (config.autoInstallTools) {
    try {
      await installAllTools(outputChannel);
    } catch (err) {
      outputChannel.appendLine(`[auto-apply] Tool installation failed: ${err}`);
    }
  }

  // 3. Configure MCP servers
  if (config.configureMcpOnActivation) {
    try {
      await configureMcpServers(outputChannel, extensionPath);
    } catch (err) {
      outputChannel.appendLine(`[auto-apply] MCP configuration failed: ${err}`);
    }
  }

  outputChannel.appendLine('[auto-apply] Complete');
}

async function toggleAllCommand(): Promise<void> {
  const config = getConfig();
  const wsConfig = vscode.workspace.getConfiguration('aiTokenOptimizer');
  const newEnabled = !config.enabled;
  await wsConfig.update('enabled', newEnabled, vscode.ConfigurationTarget.Workspace);
  updateStatusBar();
  vscode.window.showInformationMessage(
    `AI Token Optimizer: ${newEnabled ? 'Enabled' : 'Disabled'}`
  );

  if (newEnabled) {
    initSessionTracking();
    await autoApply(getConfig());
  }
}

async function regenerateCommand(): Promise<void> {
  const config = getConfig();
  // Force regenerate by temporarily disabling preserve
  const overrideConfig = { ...config, preserveExistingInstructions: false };
  const results = await generateAllInstructions(overrideConfig);
  const count = results.filter(r => r.created || r.updated).length;
  vscode.window.showInformationMessage(
    `AI Token Optimizer: Regenerated ${count} instruction files`
  );
}

async function clearCacheCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('AI Token Optimizer: No workspace folder open');
    return;
  }
  const store = new SemanticCacheStore(workspaceFolders[0].uri.fsPath);
  const stats = store.stats();
  store.clear();
  outputChannel.appendLine(`[cache] Cleared semantic cache (${stats.entries} entries, ${stats.totalHits} lifetime hits)`);
  vscode.window.showInformationMessage(`AI Token Optimizer: Semantic cache cleared (${stats.entries} entries removed)`);
}

async function onConfigChanged(): Promise<void> {
  const config = getConfig();
  if (config.enabled && config.autoApply) {
    try {
      await generateAllInstructions(config);
      outputChannel.appendLine('[config-change] Instruction files updated for new configuration');
    } catch (err) {
      outputChannel.appendLine(`[config-change] Failed to update instructions: ${err}`);
    }

    // Re-apply context exclusions if toggled on
    const strategies = getEffectiveStrategies(config);
    if (strategies.contextExclusion) {
      try {
        await applyContextExclusions(outputChannel);
      } catch (err) {
        outputChannel.appendLine(`[config-change] Context exclusion update failed: ${err}`);
      }
    }
  }
}

export function deactivate(): void {
  disposeStatusBar();
  disposeCodeGraphWatcher();
  if (outputChannel) {
    outputChannel.dispose();
  }
}
