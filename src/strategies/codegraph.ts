import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getProjectsToIndex } from '../ui/projectPicker';
import { isBinaryAvailable } from '../installer/installer';
import { invalidateTtl } from '../cache/ttlCache';
import { recordReindex } from '../session/tracker';

function isCodeGraphInstalled(): boolean {
  return isBinaryAvailable('codegraph');
}

let reindexTimeout: NodeJS.Timeout | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let pendingChangedFiles: Set<string> = new Set();
let lastIndexedAt: Date | undefined;
let indexStatusBar: vscode.StatusBarItem | undefined;
const projectIndexState: Map<string, { lastIndexed: Date | undefined; status: string }> = new Map();

export interface IndexStatus {
  exists: boolean;
  lastIndexed: Date | undefined;
  pendingChanges: number;
  isStale: boolean;
  filePath: string;
  projects: Array<{ name: string; absPath: string; indexed: boolean; lastIndexed: Date | undefined }>;
}

export function getIndexStatus(wsPath: string): IndexStatus {
  const codegraphIndex = path.join(wsPath, '.codegraph');
  const exists = fs.existsSync(codegraphIndex);
  const staleThresholdMs = 5 * 60 * 1000;
  const isStale = !exists || (lastIndexedAt !== undefined && Date.now() - lastIndexedAt.getTime() > staleThresholdMs);
  const projects = getProjectsToIndex().map(p => {
    const state = projectIndexState.get(p.absPath);
    return { name: p.name, absPath: p.absPath, indexed: fs.existsSync(path.join(p.absPath, '.codegraph')), lastIndexed: state?.lastIndexed };
  });
  return { exists, lastIndexed: lastIndexedAt, pendingChanges: pendingChangedFiles.size, isStale, filePath: codegraphIndex, projects };
}

export function startCodeGraphWatcher(outputChannel: vscode.OutputChannel): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  indexStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  indexStatusBar.command = 'aiTokenOptimizer.validateIndex';
  updateIndexStatusBar('idle');
  indexStatusBar.show();
  disposables.push(indexStatusBar);

  fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,js,tsx,jsx,py,go,rs,java,rb,cpp,c,h}');
  const scheduleReindex = (uri: vscode.Uri) => {
    const rel = vscode.workspace.asRelativePath(uri);
    if (!rel.includes('node_modules') && !rel.includes('.git')) {
      pendingChangedFiles.add(uri.fsPath);
      updateIndexStatusBar('pending');
      outputChannel.appendLine(`[codegraph] Change: ${rel} (${pendingChangedFiles.size} pending)`);
    }
    if (reindexTimeout) { clearTimeout(reindexTimeout); }
    reindexTimeout = setTimeout(() => runCodeGraphReindex(outputChannel), 30000);
  };
  fileWatcher.onDidCreate(scheduleReindex);
  fileWatcher.onDidDelete(scheduleReindex);
  fileWatcher.onDidChange(scheduleReindex);
  disposables.push(fileWatcher);

  if (!isCodeGraphInstalled()) {
    outputChannel.appendLine('[codegraph] codegraph CLI not found — running in instruction-only mode (CAP-1 rules active via instruction files)');
    updateIndexStatusBar('missing');
    // Still watch files so we can report pending changes if codegraph is installed later
  } else {
    const projects = getProjectsToIndex();
    outputChannel.appendLine(`[codegraph] Watcher started for ${projects.length} project(s): ${projects.map(p => p.name).join(', ')}`);
    // Pre-populate state for projects already indexed before this session
    for (const project of projects) {
      if (!projectIndexState.has(project.absPath) && fs.existsSync(path.join(project.absPath, '.codegraph'))) {
        projectIndexState.set(project.absPath, { lastIndexed: undefined, status: 'pre-indexed' });
        outputChannel.appendLine(`[codegraph] ✓ ${project.name}: existing index detected`);
      }
    }
    updateIndexStatusBar('idle');
  }
  return disposables;
}

export async function runCodeGraphReindex(outputChannel: vscode.OutputChannel): Promise<void> {
  if (!isCodeGraphInstalled()) {
    outputChannel.appendLine('[codegraph] codegraph CLI not found — instruction-based search rules are active (CAP-1)');
    outputChannel.appendLine('[codegraph] To enable index-based search: install codegraph separately and restart VS Code.');
    updateIndexStatusBar('missing');
    pendingChangedFiles.clear();
    return;
  }

  const projects = getProjectsToIndex();
  if (projects.length === 0) {
    outputChannel.appendLine('[codegraph] No projects configured');
    updateIndexStatusBar('missing');
    return;
  }
  const changedPaths = Array.from(pendingChangedFiles);
  const toReindex = projects.filter(p =>
    changedPaths.some(f => f.startsWith(p.absPath)) || !fs.existsSync(path.join(p.absPath, '.codegraph'))
  );
  const targets = toReindex.length > 0 ? toReindex : projects;
  outputChannel.appendLine(`[codegraph] Reindexing ${targets.length}/${projects.length} project(s): ${targets.map(p => p.name).join(', ')}`);
  updateIndexStatusBar('indexing');
  let succeeded = 0, failed = 0;
  for (const project of targets) {
    if (!fs.existsSync(project.absPath)) {
      outputChannel.appendLine(`[codegraph] ✗ ${project.name}: path not found`);
      failed++;
      continue;
    }
    const hasIndex = fs.existsSync(path.join(project.absPath, '.codegraph'));
    // codegraph init — one step: creates .codegraph/ and builds the full graph
    // codegraph sync — incremental update for an already-initialized project
    const cmd = hasIndex ? 'codegraph sync' : 'codegraph init';
    try {
      outputChannel.appendLine(`[codegraph] → ${project.name} (${project.absPath})`);
      execSync(cmd, { cwd: project.absPath, timeout: 60000 });
      const now = new Date();
      projectIndexState.set(project.absPath, { lastIndexed: now, status: 'fresh' });
      lastIndexedAt = now;
      succeeded++;
      outputChannel.appendLine(`[codegraph] ✓ ${project.name} indexed at ${now.toLocaleTimeString()}`);
    } catch (err) {
      failed++;
      projectIndexState.set(project.absPath, { lastIndexed: undefined, status: 'error' });
      outputChannel.appendLine(`[codegraph] ✗ ${project.name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  pendingChangedFiles.clear();
  if (succeeded > 0) {
    // Index changed — drop memoized dashboard stats so fresh counts show immediately
    invalidateTtl('measure:codegraph');
    recordReindex();
  }
  updateIndexStatusBar(failed > 0 ? 'error' : 'fresh');
  outputChannel.appendLine(`[codegraph] Done — ${succeeded} ok, ${failed} failed`);
  if (failed > 0) { outputChannel.show(true); }
}

/** Run `codegraph status` and append the key stats lines to the Output channel. */
function appendCodeGraphStats(outputChannel: vscode.OutputChannel, projectPath: string): void {
  try {
    const out = execSync('codegraph status', { cwd: projectPath, timeout: 10000, encoding: 'utf-8' });
    const lines = out.split('\n');
    const want = ['Files:', 'Nodes:', 'Edges:', 'DB Size:', 'Journal:'];
    for (const line of lines) {
      if (want.some(k => line.trimStart().startsWith(k))) {
        outputChannel.appendLine(`    ${line.trimStart()}`);
      }
    }
    const freshLine = lines.find(l => l.includes('up to date') || l.includes('stale'));
    if (freshLine) {
      outputChannel.appendLine(`    ${freshLine.trim()}`);
    }
  } catch {
    outputChannel.appendLine('    (codegraph status unavailable)');
  }
}

export async function validateIndex(outputChannel: vscode.OutputChannel): Promise<void> {
  if (!isCodeGraphInstalled()) {
    outputChannel.show(true);
    outputChannel.appendLine('\n══════════════════════════════════════════');
    outputChannel.appendLine('[codegraph] Validation Report');
    outputChannel.appendLine('  Status  : ○ codegraph CLI not installed');
    outputChannel.appendLine('  Mode    : Instruction-based (CAP-1 rules injected into AI instructions)');
    outputChannel.appendLine('  Effect  : AI is instructed to search before synthesizing — no binary required');
    outputChannel.appendLine('  Install : npm install -g @colbymchenry/codegraph   (or: curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh)');
    outputChannel.appendLine('══════════════════════════════════════════\n');
    vscode.window.showInformationMessage(
      'CodeGraph CLI not installed. Run "AI Token Optimizer: Install Tools" or: npm install -g @colbymchenry/codegraph',
      'Install Now',
      'Manage Projects'
    ).then(choice => {
      if (choice === 'Install Now') {
        vscode.commands.executeCommand('aiTokenOptimizer.installTools');
      } else if (choice === 'Manage Projects') {
        vscode.commands.executeCommand('aiTokenOptimizer.manageProjects');
      }
    });
    return;
  }

  const projects = getProjectsToIndex();
  outputChannel.show(true);
  outputChannel.appendLine('\n══════════════════════════════════════════');
  outputChannel.appendLine('[codegraph] Index Validation Report');
  outputChannel.appendLine(`  Timestamp     : ${new Date().toLocaleString()}`);
  outputChannel.appendLine(`  Projects count: ${projects.length}`);
  outputChannel.appendLine(`  Pending files : ${pendingChangedFiles.size}`);
  outputChannel.appendLine('──────────────────────────────────────────');
  if (projects.length === 0) {
    outputChannel.appendLine('  ⚠  No projects configured. Run "Manage CodeGraph Projects" to add.');
    outputChannel.appendLine('══════════════════════════════════════════\n');
    const choice = await vscode.window.showWarningMessage('No CodeGraph projects configured.', 'Manage Projects', 'Cancel');
    if (choice === 'Manage Projects') { await vscode.commands.executeCommand('aiTokenOptimizer.manageProjects'); }
    return;
  }
  let allFresh = true;
  for (const project of projects) {
    const hasIndex = fs.existsSync(path.join(project.absPath, '.codegraph'));
    const state = projectIndexState.get(project.absPath);
    outputChannel.appendLine(`  ${project.name}`);
    outputChannel.appendLine(`    Path  : ${project.absPath}`);
    if (!hasIndex) {
      allFresh = false;
      outputChannel.appendLine('    Index : ✗ NO INDEX — run "codegraph init" in this directory');
    } else if (state?.lastIndexed) {
      // Indexed during this session
      outputChannel.appendLine(`    Index : ✓ Indexed at ${state.lastIndexed.toLocaleTimeString()} (this session)`);
      appendCodeGraphStats(outputChannel, project.absPath);
    } else {
      // Index exists but was built before this VS Code session (or via terminal)
      outputChannel.appendLine('    Index : ✓ Index exists (built outside this session)');
      appendCodeGraphStats(outputChannel, project.absPath);
    }
  }
  if (pendingChangedFiles.size > 0) {
    allFresh = false;
    outputChannel.appendLine('──────────────────────────────────────────');
    outputChannel.appendLine(`  Pending (${pendingChangedFiles.size}):`);
    Array.from(pendingChangedFiles).slice(0, 5).forEach(f => outputChannel.appendLine(`    • ${f}`));
    if (pendingChangedFiles.size > 5) { outputChannel.appendLine(`    ... and ${pendingChangedFiles.size - 5} more`); }
  }
  outputChannel.appendLine('══════════════════════════════════════════\n');
  if (!allFresh || pendingChangedFiles.size > 0) {
    const choice = await vscode.window.showWarningMessage(
      `CodeGraph: ${pendingChangedFiles.size} pending change(s). Reindex now?`,
      'Reindex All', 'Manage Projects', 'Ignore'
    );
    if (choice === 'Reindex All') { await runCodeGraphReindex(outputChannel); }
    else if (choice === 'Manage Projects') { await vscode.commands.executeCommand('aiTokenOptimizer.manageProjects'); }
  } else {
    vscode.window.showInformationMessage(`CodeGraph: All ${projects.length} project(s) fresh. Last: ${lastIndexedAt?.toLocaleTimeString() ?? 'this session'}`);
  }
}

function updateIndexStatusBar(state: 'idle' | 'pending' | 'indexing' | 'fresh' | 'stale' | 'error' | 'missing'): void {
  if (!indexStatusBar) { return; }
  const count = getProjectsToIndex().length;
  const cfg: Record<string, { text: string; tooltip: string; bg?: string }> = {
    idle:     { text: `$(graph) CG:${count}`,     tooltip: `Watching ${count} project(s). Click to validate.` },
    pending:  { text: `$(graph) CG:${count} ●`,   tooltip: `${pendingChangedFiles.size} change(s) pending (30s debounce).`, bg: 'statusBarItem.warningBackground' },
    indexing: { text: `$(sync~spin) CG:${count}`, tooltip: 'Reindexing...' },
    fresh:    { text: `$(graph) CG:${count} ✓`,   tooltip: `All ${count} project(s) indexed. Last: ${lastIndexedAt?.toLocaleTimeString()}.` },
    stale:    { text: `$(graph) CG:${count} ⚠`,   tooltip: 'Index may be stale. Click to validate.', bg: 'statusBarItem.warningBackground' },
    error:    { text: `$(graph) CG:${count} ✗`,   tooltip: 'Reindex failed. Check Output panel.', bg: 'statusBarItem.errorBackground' },
    missing:  { text: `$(graph) CG:0 —`,          tooltip: 'No projects configured. Click to manage.', bg: 'statusBarItem.warningBackground' },
  };
  const c = cfg[state];
  indexStatusBar.text = c.text;
  indexStatusBar.tooltip = c.tooltip;
  indexStatusBar.backgroundColor = c.bg ? new vscode.ThemeColor(c.bg) : undefined;
}

export function disposeCodeGraphWatcher(): void {
  if (reindexTimeout) { clearTimeout(reindexTimeout); }
  if (fileWatcher) { fileWatcher.dispose(); }
  if (indexStatusBar) { indexStatusBar.dispose(); }
  pendingChangedFiles.clear();
  projectIndexState.clear();
}
