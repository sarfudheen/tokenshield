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

/**
 * Filter out build artifacts, dist/, lockfiles, and generated files from indexing.
 */
/**
 * Filter out build artifacts, dist/, lockfiles, and generated files from indexing.
 */
function shouldIgnoreFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').toLowerCase();

  // Excluded directories
  const excludedDirs = [
    'dist/', 'build/', 'out/', 'target/', 'coverage/', '.next/', '.nuxt/',
    'node_modules/', '.git/', '.codegraph/', '.aicache/', '.agents/', '.claude/',
    'vendor/', '__pycache__/', '.venv/', 'venv/', 'tsoa-output/', 'generated/',
  ];

  for (const dir of excludedDirs) {
    if (normalized.startsWith(dir) || normalized.includes('/' + dir)) {
      return true;
    }
  }

  // Excluded file extensions & generated artifacts
  if (
    normalized.endsWith('.d.ts') ||
    normalized.endsWith('.map') ||
    normalized.endsWith('.min.js') ||
    normalized.endsWith('.min.css') ||
    normalized.endsWith('.lock') ||
    normalized.includes('.generated.') ||
    normalized.includes('tsoa-output') ||
    normalized.endsWith('routes.ts')
  ) {
    return true;
  }

  return false;
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
    if (shouldIgnoreFile(rel)) {
      return;
    }

    pendingChangedFiles.add(uri.fsPath);
    updateIndexStatusBar('pending');
    outputChannel.appendLine(`[codegraph] Change: ${rel} (${pendingChangedFiles.size} pending)`);

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
  } else {
    const projects = getProjectsToIndex();
    outputChannel.appendLine(`[codegraph] Watcher started for ${projects.length} project(s): ${projects.map(p => p.name).join(', ')}`);
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
    const subCmd = hasIndex ? 'sync' : 'init';
    try {
      outputChannel.appendLine(`[codegraph] → ${project.name} (${project.absPath})`);
      const { spawnSync } = require('child_process');
      let res = spawnSync('codegraph', [subCmd], {
        cwd: project.absPath,
        timeout: 60000,
        shell: true,
        encoding: 'utf-8',
      });

      // If sync failed, try unlock and retry
      if (res.status !== 0) {
        outputChannel.appendLine(`[codegraph] Attempting lock recovery for ${project.name}...`);
        spawnSync('codegraph', ['unlock'], { cwd: project.absPath, shell: true, timeout: 10000 });
        res = spawnSync('codegraph', [subCmd], { cwd: project.absPath, timeout: 60000, shell: true, encoding: 'utf-8' });
      }

      if (res.status === 0) {
        const now = new Date();
        projectIndexState.set(project.absPath, { lastIndexed: now, status: 'fresh' });
        lastIndexedAt = now;
        succeeded++;
        outputChannel.appendLine(`[codegraph] ✓ ${project.name} indexed at ${now.toLocaleTimeString()}`);
      } else {
        const errMsg = res.stderr || res.stdout || `Exit code ${res.status}`;
        throw new Error(errMsg.trim().split('\n')[0]);
      }
    } catch (err) {
      failed++;
      projectIndexState.set(project.absPath, { lastIndexed: undefined, status: 'error' });
      outputChannel.appendLine(`[codegraph] ✗ ${project.name}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
    }
  }
  pendingChangedFiles.clear();
  if (succeeded > 0) {
    invalidateTtl('measure:codegraph');
    recordReindex();
  }
  updateIndexStatusBar(failed > 0 ? 'error' : 'fresh');
  outputChannel.appendLine(`[codegraph] Done — ${succeeded} ok, ${failed} failed`);
  if (failed > 0) { outputChannel.show(true); }
}

export async function validateIndex(outputChannel: vscode.OutputChannel): Promise<void> {
  const projects = getProjectsToIndex();
  if (projects.length === 0) {
    vscode.window.showWarningMessage('CodeGraph: No workspace projects configured.');
    return;
  }
  const unindexed = projects.filter(p => !fs.existsSync(path.join(p.absPath, '.codegraph')));
  if (unindexed.length > 0) {
    const choice = await vscode.window.showWarningMessage(
      `CodeGraph: ${unindexed.length} of ${projects.length} project(s) not indexed (${unindexed.map(p => p.name).join(', ')}). Index now?`,
      'Index Now', 'Manage Projects', 'Cancel'
    );
    if (choice === 'Index Now') { await runCodeGraphReindex(outputChannel); }
    else if (choice === 'Manage Projects') { await vscode.commands.executeCommand('aiTokenOptimizer.manageProjects'); }
  } else {
    vscode.window.showInformationMessage(`CodeGraph: All ${projects.length} project(s) fresh. Last: ${lastIndexedAt?.toLocaleTimeString() ?? 'this session'}`);
  }
}

function updateIndexStatusBar(state: 'idle' | 'pending' | 'indexing' | 'fresh' | 'stale' | 'error' | 'missing'): void {
  if (!indexStatusBar) { return; }
  const count = getProjectsToIndex().length;
  const cfg: Record<string, { text: string; tooltip: string; bg?: string }> = {
    idle:     { text: `$(graph) CG:${count}`,     tooltip: `CodeGraph: Watching ${count} indexed repository graph(s). Click to validate.` },
    pending:  { text: `$(graph) CG:${count} ●`,   tooltip: `CodeGraph: ${pendingChangedFiles.size} change(s) pending (30s debounce).`, bg: 'statusBarItem.warningBackground' },
    indexing: { text: `$(sync~spin) CG:${count}`, tooltip: 'CodeGraph: Reindexing symbol graphs...' },
    fresh:    { text: `$(graph) CG:${count} ✓`,   tooltip: `CodeGraph: ${count} repository graph(s) indexed & fresh. (100% local search-first index active). Click to manage.` },
    stale:    { text: `$(graph) CG:${count} ⚠`,   tooltip: 'CodeGraph: Index may be stale. Click to validate/reindex.', bg: 'statusBarItem.warningBackground' },
    error:    { text: `$(graph) CG:${count} ✗`,   tooltip: 'CodeGraph: Reindex failed. Check Output panel.', bg: 'statusBarItem.errorBackground' },
    missing:  { text: `$(graph) CG:0 —`,          tooltip: 'CodeGraph: No indexed projects. Click to configure.', bg: 'statusBarItem.warningBackground' },
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
