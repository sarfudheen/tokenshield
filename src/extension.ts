import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, TOTAL_STRATEGIES } from './core/config';
import { showProjectPicker } from './ui/projectPicker';
import { generateAllInstructions, exportInstructionsToRepo, stripAllInstructions } from './generators';
import { installAllTools } from './installer';
import { configureMcpServers } from './mcp';
import { createStatusBar, updateStatusBar, disposeStatusBar } from './ui/statusBar';
import { createEditorTokenBadge } from './ui/editorTokenBadge';
import { chatSavingsTracker } from './telemetry/chatSavingsTracker';
import { pruneContext, compressGitDiff } from './strategies/adaptivePruner';
import { showProfilePicker, showSingleFeatureToggle } from './ui/quickPick';
import { DashboardPanel, registerDiffContentProvider } from './ui/dashboard';
import { exportTelemetryCommand } from './ui/exportTelemetry';
import { startCodeGraphWatcher, runCodeGraphReindex, validateIndex, disposeCodeGraphWatcher, validateAllStrategies, applyContextExclusions, removeContextExclusions, showExclusionPicker } from './strategies';
import { SemanticCacheStore } from './cache/store';
import { CallLogStore } from './cache/callLog';
import { startSession } from './session/tracker';
import { initializeForProject } from './generators/projectInit';
import { detectActiveTools, TARGET_TOOL_LABELS } from './core/ideDetector';
import * as path from 'path';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;
let extensionPath: string;
let sessionStarted = false;

function registerCommandWithAlias(
  context: vscode.ExtensionContext,
  suffix: string,
  callback: (...args: any[]) => any
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(`tokensculpt.${suffix}`, callback),
    vscode.commands.registerCommand(`tokenshield.${suffix}`, callback)
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  outputChannel = vscode.window.createOutputChannel('TokenSculpt');
  outputChannel.appendLine('[activate] TokenSculpt starting...');
  extensionPath = context.extensionPath;

  // Enforce zero cloud leakage & disable Headroom external telemetry beacon
  process.env.HEADROOM_BEACON = 'off';
  process.env.HEADROOM_TELEMETRY = 'off';
  process.env.HEADROOM_OFFLINE = '1';
  process.env.DO_NOT_TRACK = '1';

  const config = getConfig();

  // Log detected AI tools for diagnostics
  const detectedTools = detectActiveTools();
  outputChannel.appendLine(`[activate] Detected IDE tools: ${detectedTools.map(t => TARGET_TOOL_LABELS[t]).join(', ')}`);
  outputChannel.appendLine(`[activate] Effective targetTools: ${config.targetTools.join(', ')}`);

  if (config.enabled) {
    initSessionTracking();
  } else {
    outputChannel.appendLine('[activate] TokenSculpt is currently completely deactivated');
  }

  // Register commands — dual registration for TokenSculpt with TokenShield backward compatibility
  registerCommandWithAlias(context, 'toggle', toggleAllCommand);
  registerCommandWithAlias(context, 'deactivateCompletely', deactivateCompletelyCommand);
  registerCommandWithAlias(context, 'reactivate', reactivateCommand);
  registerCommandWithAlias(context, 'toggleFeature', showSingleFeatureToggle);
  registerCommandWithAlias(context, 'sessionBreakdown', () => DashboardPanel.show(context.extensionUri));
  registerCommandWithAlias(context, 'switchProfile', showProfilePicker);
  registerCommandWithAlias(context, 'regenerate', regenerateCommand);
  registerCommandWithAlias(context, 'dashboard', () => DashboardPanel.show(context.extensionUri));
  registerCommandWithAlias(context, 'reindex', () => runCodeGraphReindex(outputChannel));
  registerCommandWithAlias(context, 'validateGraph', () => validateIndex(outputChannel));
  registerCommandWithAlias(context, 'setupTools', () => installAllTools(outputChannel, true));
  registerCommandWithAlias(context, 'manageProjects', () => showProjectPicker(outputChannel));
  registerCommandWithAlias(context, 'configureMcp', () => configureMcpServers(outputChannel, extensionPath));
  registerCommandWithAlias(context, 'healthCheck', () => validateAllStrategies(outputChannel));
  registerCommandWithAlias(context, 'flushCache', clearCacheCommand);
  registerCommandWithAlias(context, 'exportReport', () => exportTelemetryCommand(outputChannel));
  registerCommandWithAlias(context, 'exclusions', () => showExclusionPicker(outputChannel));
  registerCommandWithAlias(context, 'init', () => initializeForProject(getConfig(), outputChannel));
  registerCommandWithAlias(context, 'pruneAndCopy', async () => {
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
        `Pruned context (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} ➔ ${result.prunedTokensEst} tok)`,
        true,
        result.originalTokensEst,
        result.prunedTokensEst,
        result.reductionPercent,
        text,
        result.prunedText
      );
    } else {
      vscode.window.showInformationMessage(`TokenSculpt: Context copied to clipboard.`);
    }
  });
  registerCommandWithAlias(context, 'exportToRepo', async () => {
    const results = await exportInstructionsToRepo(getConfig());
    vscode.window.showInformationMessage(`TokenSculpt: Exported ${results.length} instruction files to repository.`);
  });
  registerCommandWithAlias(context, 'newSession', async () => {
    const archived = await chatSavingsTracker.resetSession();
    await updateStatusBar();
    await DashboardPanel.refreshCurrentPanel();
    vscode.window.showInformationMessage(
      `🛡️ TokenSculpt: Started new Session #${chatSavingsTracker.getSessionNumber()}! Session #${archived.sessionNumber} archived (${archived.totalTokensSaved.toLocaleString()} tok, $${archived.totalCostSavedUsd.toFixed(4)} saved).`
    );
  });
  registerCommandWithAlias(context, 'resetAllData', async () => {
    const confirm = await vscode.window.showWarningMessage(
      'Are you sure you want to completely reset all TokenSculpt lifetime statistics, archived sessions, and event logs? This cannot be undone.',
      { modal: true },
      'Reset Complete Data'
    );
    if (confirm === 'Reset Complete Data') {
      await chatSavingsTracker.resetAllData();
      await updateStatusBar();
      await DashboardPanel.refreshCurrentPanel();
      vscode.window.showInformationMessage('🛡️ TokenSculpt: All lifetime statistics and session history have been reset to clean slate.');
    }
  });
  registerCommandWithAlias(context, 'compressDiff', async () => {
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
        vscode.window.showInformationMessage('TokenSculpt: No git changes detected (working directory clean).');
        return;
      }
      const result = compressGitDiff(diffRaw);
      await vscode.env.clipboard.writeText(result.prunedText);
      const tokensSaved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
      chatSavingsTracker.recordEvent(
        'Git Diff Scoping',
        'rtk git diff HEAD',
        tokensSaved,
        `Compressed git diff (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} ➔ ${result.prunedTokensEst} tok)`,
        true,
        result.originalTokensEst,
        result.prunedTokensEst,
        result.reductionPercent,
        diffRaw,
        result.prunedText
      );
    } catch (err) {
      vscode.window.showErrorMessage(`TokenSculpt: Failed to extract git diff: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Create unified TokenShield Master Hub and active editor token badge (clean 2-item layout)
  const statusBar = createStatusBar(context);
  const tokenBadge = createEditorTokenBadge(context);
  registerDiffContentProvider(context);
  context.subscriptions.push(statusBar, tokenBadge);

  // Listen for config changes — hot-swap strategies without restart
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('tokensculpt') || e.affectsConfiguration('tokenshield')) {
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
          const pct = Math.round((savedTokens / fileTokens) * 100);
          if (savedTokens > 20) {
            chatSavingsTracker.recordEvent(
              'Diff-Only Output',
              relPath,
              savedTokens,
              `Applied ${diffTokens} token diff hunk instead of rewriting full ${fileTokens} token file (${pct}% tokens saved)`,
              false,
              fileTokens,
              diffTokens,
              pct,
              doc.getText(),
              diffRaw
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
      path.join(wsPath, '.github', 'instructions', 'tokensculpt.instructions.md'),
      path.join(wsPath, '.github', 'instructions', 'tokenshield.instructions.md'),
      path.join(wsPath, '.github', 'copilot-instructions.md'),
      path.join(wsPath, 'AGENTS.md'),
      path.join(wsPath, 'CLAUDE.md'),
      path.join(wsPath, '.vscode', 'copilot-instructions.md'),
    ];

    const hasAnyInstructions = candidatePaths.some(p => fs.existsSync(p));
    const alreadyDismissed = context.workspaceState.get<boolean>('tokensculpt.initPromptDismissed', false) ||
                             context.workspaceState.get<boolean>('tokenshield.initPromptDismissed', false);

    if (!hasAnyInstructions && !alreadyDismissed) {
      const detectedToolNames = config.targetTools.map(t => TARGET_TOOL_LABELS[t]).join(', ');
      vscode.window.showInformationMessage(
        `🛡️ TokenSculpt: No project instructions found. Detected tools: ${detectedToolNames}. Initialize for this project?`,
        'Initialize Now',
        'Do Not Show Again'
      ).then(async action => {
        if (action === 'Initialize Now') {
          await context.workspaceState.update('tokensculpt.initPromptDismissed', true);
          await initializeForProject(config, outputChannel);
        } else if (action === 'Do Not Show Again') {
          await context.workspaceState.update('tokensculpt.initPromptDismissed', true);
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
  outputChannel.appendLine(`[activate] TokenSculpt ready — ${activeCount}/${TOTAL_STRATEGIES} strategies active`);
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
        `TokenSculpt: ${created} instruction files created, ${updated} updated`
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

export async function deactivateCompletelyCommand(): Promise<void> {
  const config = getConfig();
  const wsConfig = vscode.workspace.getConfiguration('tokensculpt');
  await wsConfig.update('enabled', false, vscode.ConfigurationTarget.Workspace);
  try {
    const legacyConfig = vscode.workspace.getConfiguration('tokenshield');
    await legacyConfig.update('enabled', false, vscode.ConfigurationTarget.Workspace);
  } catch { /* ignore legacy config write error */ }

  // 1. Strip all instruction files
  try {
    const results = await stripAllInstructions(config);
    outputChannel.appendLine(`[deactivate] Stripped directives from ${results.length} files`);
  } catch (err) {
    outputChannel.appendLine(`[deactivate] Error stripping directives: ${err}`);
  }

  // 2. Remove context exclusions (.vscode/settings.json, .copilotignore)
  try {
    await removeContextExclusions(outputChannel);
  } catch (err) {
    outputChannel.appendLine(`[deactivate] Error removing context exclusions: ${err}`);
  }

  // 3. Stop watchers
  disposeCodeGraphWatcher();

  // 4. Update status bar and dashboard
  await updateStatusBar();
  await DashboardPanel.refreshCurrentPanel();

  vscode.window.showInformationMessage(
    '🛡️ TokenSculpt: Completely deactivated. All optimization directives and exclusions were removed from your workspace.'
  );
}

export async function reactivateCommand(): Promise<void> {
  const wsConfig = vscode.workspace.getConfiguration('tokensculpt');
  await wsConfig.update('enabled', true, vscode.ConfigurationTarget.Workspace);
  try {
    const legacyConfig = vscode.workspace.getConfiguration('tokenshield');
    await legacyConfig.update('enabled', true, vscode.ConfigurationTarget.Workspace);
  } catch { /* ignore legacy config write error */ }
  const config = getConfig();

  initSessionTracking();

  // 1. Auto-apply instructions
  await autoApply(config);

  // 2. Restart CodeGraph watcher
  if (config.activeStrategies.codeGraph) {
    startCodeGraphWatcher(outputChannel);
  }

  // 3. Apply context exclusions
  const strategies = getEffectiveStrategies(config);
  if (strategies.contextExclusion) {
    try {
      await applyContextExclusions(outputChannel);
    } catch (err) {
      outputChannel.appendLine(`[reactivate] Context exclusion failed: ${err}`);
    }
  }

  // 4. Update status bar and dashboard
  await updateStatusBar();
  await DashboardPanel.refreshCurrentPanel();

  vscode.window.showInformationMessage(
    '🛡️ TokenSculpt: Reactivated! All optimization directives and tools have been restored.'
  );
}

async function toggleAllCommand(): Promise<void> {
  const config = getConfig();
  if (config.enabled) {
    await deactivateCompletelyCommand();
  } else {
    await reactivateCommand();
  }
}

async function regenerateCommand(): Promise<void> {
  const config = getConfig();
  // Force regenerate by temporarily disabling preserve
  const overrideConfig = { ...config, preserveExistingInstructions: false };
  const results = await generateAllInstructions(overrideConfig);
  const count = results.filter(r => r.created || r.updated).length;
  vscode.window.showInformationMessage(
    `TokenSculpt: Regenerated ${count} instruction files`
  );
}

async function clearCacheCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('TokenSculpt: No workspace folder open');
    return;
  }
  const store = new SemanticCacheStore(workspaceFolders[0].uri.fsPath);
  const stats = store.stats();
  store.clear();
  outputChannel.appendLine(`[cache] Cleared semantic cache (${stats.entries} entries, ${stats.totalHits} lifetime hits)`);
  vscode.window.showInformationMessage(`TokenSculpt: Semantic cache cleared (${stats.entries} entries removed)`);
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
