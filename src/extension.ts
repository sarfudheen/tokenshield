import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, TOTAL_STRATEGIES } from './core/config';
import { showProjectPicker } from './ui/projectPicker';
import { generateAllInstructions, exportInstructionsToRepo } from './generators';
import { installAllTools } from './installer';
import { configureMcpServers } from './mcp';
import { createStatusBar, updateStatusBar, disposeStatusBar } from './ui/statusBar';
import { createEditorTokenBadge } from './ui/editorTokenBadge';
import { createSessionSavingsWidget } from './ui/sessionSavingsWidget';
import { chatSavingsTracker } from './telemetry/chatSavingsTracker';
import { pruneContext, compressGitDiff } from './strategies/adaptivePruner';
import { showProfilePicker } from './ui/quickPick';
import { DashboardPanel } from './ui/dashboard';
import { exportTelemetryCommand } from './ui/exportTelemetry';
import { startCodeGraphWatcher, runCodeGraphReindex, validateIndex, disposeCodeGraphWatcher, validateAllStrategies, applyContextExclusions, showExclusionPicker } from './strategies';
import { SemanticCacheStore } from './cache/store';
import { CallLogStore } from './cache/callLog';
import { startSession } from './session/tracker';
import { initializeForProject } from './generators/projectInit';
import * as path from 'path';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;
let extensionPath: string;
let sessionStarted = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('TokenShield');
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
    vscode.commands.registerCommand('tokenshield.toggle', toggleAllCommand),
    vscode.commands.registerCommand('tokenshield.switchProfile', showProfilePicker),
    vscode.commands.registerCommand('tokenshield.regenerate', regenerateCommand),
    vscode.commands.registerCommand('tokenshield.dashboard', () => DashboardPanel.show(context.extensionUri)),
    vscode.commands.registerCommand('tokenshield.reindex', () => runCodeGraphReindex(outputChannel)),
    vscode.commands.registerCommand('tokenshield.validateGraph', () => validateIndex(outputChannel)),
    vscode.commands.registerCommand('tokenshield.setupTools', () => installAllTools(outputChannel, true)),
    vscode.commands.registerCommand('tokenshield.manageProjects', () => showProjectPicker(outputChannel)),
    vscode.commands.registerCommand('tokenshield.configureMcp', () => configureMcpServers(outputChannel, extensionPath)),
    vscode.commands.registerCommand('tokenshield.healthCheck', () => validateAllStrategies(outputChannel)),
    vscode.commands.registerCommand('tokenshield.flushCache', clearCacheCommand),
    vscode.commands.registerCommand('tokenshield.exportReport', () => exportTelemetryCommand(outputChannel)),
    vscode.commands.registerCommand('tokenshield.exclusions', () => showExclusionPicker(outputChannel)),
    vscode.commands.registerCommand('tokenshield.init', () => initializeForProject(getConfig(), outputChannel)),
    vscode.commands.registerCommand('tokenshield.pruneAndCopy', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const text = editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection);
      const result = pruneContext(text, { aggressive: true });
      await vscode.env.clipboard.writeText(result.prunedText);
      const tokensSaved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
      const fileName = editor.document.fileName ? vscode.workspace.asRelativePath(editor.document.fileName) : 'Selection';
      if (tokensSaved > 0) {
        chatSavingsTracker.recordEvent(
          'Adaptive Pruner',
          fileName,
          tokensSaved,
          `Pruned context (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} → ${result.prunedTokensEst} tok)`,
          true
        );
      } else {
        vscode.window.showInformationMessage(`TokenShield: Context copied to clipboard.`);
      }
    }),
    vscode.commands.registerCommand('tokenshield.exportToRepo', async () => {
      const results = await exportInstructionsToRepo(getConfig());
      vscode.window.showInformationMessage(`TokenShield: Exported ${results.length} instruction files to repository.`);
    }),
    vscode.commands.registerCommand('tokenshield.newSession', async () => {
      const archived = await chatSavingsTracker.resetSession();
      await updateStatusBar();
      await DashboardPanel.refreshCurrentPanel();
      vscode.window.showInformationMessage(
        `🛡️ TokenShield: Started new Session #${chatSavingsTracker.getSessionNumber()}! Session #${archived.sessionNumber} archived (${archived.totalTokensSaved.toLocaleString()} tok, $${archived.totalCostSavedUsd.toFixed(4)} saved).`
      );
    }),
    vscode.commands.registerCommand('tokenshield.compressDiff', async () => {
      try {
        const { execSync } = require('child_process');
        const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        let diffRaw = '';
        try {
          diffRaw = execSync('rtk git diff HEAD', { cwd: wsPath, encoding: 'utf-8', timeout: 5000 });
        } catch {
          diffRaw = execSync('git diff HEAD', { cwd: wsPath, encoding: 'utf-8', timeout: 5000 });
        }
        if (!diffRaw || diffRaw.trim().length === 0) {
          vscode.window.showInformationMessage('TokenShield: No git changes detected (working directory clean).');
          return;
        }
        const result = compressGitDiff(diffRaw);
        await vscode.env.clipboard.writeText(result.prunedText);
        const tokensSaved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
        chatSavingsTracker.recordEvent(
          'Git Diff Scoping',
          'rtk git diff HEAD',
          tokensSaved,
          `Compressed git diff (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} → ${result.prunedTokensEst} tok)`,
          true
        );
      } catch (err) {
        vscode.window.showErrorMessage(`TokenShield: Failed to extract git diff: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  // Create unified TokenShield Master Hub and active editor token badge (clean 2-item layout)
  const statusBar = createStatusBar(context);
  const tokenBadge = createEditorTokenBadge(context);
  context.subscriptions.push(statusBar, tokenBadge);

  // Listen for config changes — hot-swap strategies without restart
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('tokenshield')) {
        updateStatusBar();
        onConfigChanged();
      }
    }),
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.scheme !== 'file') { return; }
      const relPath = vscode.workspace.asRelativePath(doc.uri);
      if (
        relPath.includes('node_modules') ||
        relPath.includes('.git') ||
        relPath.includes('dist') ||
        relPath.includes('.aicache')
      ) {
        return;
      }
      try {
        const { execSync } = require('child_process');
        const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
        const diffRaw = execSync(`git diff HEAD -- "${relPath}"`, { cwd: wsPath, encoding: 'utf-8', timeout: 3000 });
        if (diffRaw && diffRaw.trim().length > 0) {
          const fileTokens = Math.max(1, Math.ceil(doc.getText().length / 3.8));
          const diffTokens = Math.max(1, Math.ceil(diffRaw.length / 3.8));
          const savedTokens = Math.max(0, fileTokens - diffTokens);
          if (savedTokens > 20) {
            chatSavingsTracker.recordEvent(
              'Diff-Only Output',
              relPath,
              savedTokens,
              `Applied ${diffTokens} token diff hunk instead of rewriting full ${fileTokens} token file (${Math.round((savedTokens / fileTokens) * 100)}% tokens saved)`
            );
          }
        }
      } catch {
        // Not a git repo or unmodified
      }
    })
  );

  // Auto-apply on activation
  if (config.autoApply) {
    await autoApply(config);
  }

  // First-run nudge: only prompt if NO instructions file exists and user has not dismissed it
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsPath) {
    const candidatePaths = [
      path.join(wsPath, '.github', 'instructions', 'copilot-instructions.md'),
      path.join(wsPath, '.github', 'instructions', 'tokenshield.instructions.md'),
      path.join(wsPath, '.github', 'copilot-instructions.md'),
      path.join(wsPath, 'AGENTS.md'),
      path.join(wsPath, 'CLAUDE.md'),
      path.join(wsPath, '.vscode', 'copilot-instructions.md'),
    ];

    const hasAnyInstructions = candidatePaths.some(p => fs.existsSync(p));
    const alreadyDismissed = context.workspaceState.get<boolean>('tokenshield.initPromptDismissed', false);

    if (!hasAnyInstructions && !alreadyDismissed) {
      vscode.window.showInformationMessage(
        '🛡️ TokenShield: No project-level Copilot instructions found. Initialize for this project to get stack-specific optimizations?',
        'Initialize Now',
        'Do Not Show Again'
      ).then(async action => {
        if (action === 'Initialize Now') {
          await context.workspaceState.update('tokenshield.initPromptDismissed', true);
          await initializeForProject(config, outputChannel);
        } else if (action === 'Do Not Show Again') {
          await context.workspaceState.update('tokenshield.initPromptDismissed', true);
        }
      });
    }
  }

  // Start CodeGraph file watcher
  if (config.activeStrategies.codeGraph) {
    const watchers = startCodeGraphWatcher(outputChannel);
    context.subscriptions.push(...watchers);
  }

  // Apply context exclusions on activation
  const strategies = getEffectiveStrategies(config);
  if (strategies.contextExclusion) {
    try {
      await applyContextExclusions(outputChannel);
    } catch (err) {
      outputChannel.appendLine(`[activate] Context exclusion failed: ${err}`);
    }
  }

  const activeCount = countActiveStrategies(strategies);
  outputChannel.appendLine(`[activate] TokenShield ready — ${activeCount}/${TOTAL_STRATEGIES} strategies active`);
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
        `TokenShield: ${created} instruction files created, ${updated} updated`
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
  const wsConfig = vscode.workspace.getConfiguration('tokenshield');
  const newEnabled = !config.enabled;
  await wsConfig.update('enabled', newEnabled, vscode.ConfigurationTarget.Workspace);
  updateStatusBar();
  vscode.window.showInformationMessage(
    `TokenShield: ${newEnabled ? 'Enabled' : 'Disabled'}`
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
    `TokenShield: Regenerated ${count} instruction files`
  );
}

async function clearCacheCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('TokenShield: No workspace folder open');
    return;
  }
  const store = new SemanticCacheStore(workspaceFolders[0].uri.fsPath);
  const stats = store.stats();
  store.clear();
  outputChannel.appendLine(`[cache] Cleared semantic cache (${stats.entries} entries, ${stats.totalHits} lifetime hits)`);
  vscode.window.showInformationMessage(`TokenShield: Semantic cache cleared (${stats.entries} entries removed)`);
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
