import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_EXCLUSION_PATTERNS } from '../core/constants';

export interface ExclusionStats {
  excludedPatterns: number;
  estimatedExcludedFiles: number;
  estimatedTokensSaved: number;
}

/**
 * Detect the project type and return the appropriate exclusion patterns.
 * Looks for package.json (Node), pyproject.toml (Python), Cargo.toml (Rust),
 * go.mod (Go), pom.xml / build.gradle (Java).
 */
export function detectProjectExclusions(workspacePath: string): string[] {
  const patterns: string[] = [...DEFAULT_EXCLUSION_PATTERNS.universal];

  if (fs.existsSync(path.join(workspacePath, 'package.json'))) {
    patterns.push(...DEFAULT_EXCLUSION_PATTERNS.node);
  }
  if (fs.existsSync(path.join(workspacePath, 'pyproject.toml')) ||
      fs.existsSync(path.join(workspacePath, 'requirements.txt')) ||
      fs.existsSync(path.join(workspacePath, 'Pipfile'))) {
    patterns.push(...DEFAULT_EXCLUSION_PATTERNS.python);
  }
  if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) {
    patterns.push(...DEFAULT_EXCLUSION_PATTERNS.rust);
  }
  if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
    patterns.push(...DEFAULT_EXCLUSION_PATTERNS.go);
  }
  if (fs.existsSync(path.join(workspacePath, 'pom.xml')) ||
      fs.existsSync(path.join(workspacePath, 'build.gradle')) ||
      fs.existsSync(path.join(workspacePath, 'build.gradle.kts'))) {
    patterns.push(...DEFAULT_EXCLUSION_PATTERNS.java);
  }

  return [...new Set(patterns)];
}

/**
 * Apply context exclusions to workspace settings.
 * Writes directly to `.vscode/settings.json` so it works across Antigravity, Copilot, and Claude.
 */
export async function applyContextExclusions(
  outputChannel: vscode.OutputChannel,
): Promise<ExclusionStats> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    outputChannel.appendLine('[cap-7] No workspace folder — skipping exclusion configuration');
    return { excludedPatterns: 0, estimatedExcludedFiles: 0, estimatedTokensSaved: 0 };
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  const patterns = detectProjectExclusions(wsPath);

  // Build the exclusion object
  const excludeObj: Record<string, boolean> = {};
  for (const pattern of patterns) {
    excludeObj[pattern] = true;
  }

  // Update .vscode/settings.json directly on disk to bypass unregistered schema validation
  try {
    const settingsPath = path.join(wsPath, '.vscode', 'settings.json');
    const vscodeDir = path.join(wsPath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }

    let settings: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        settings = {};
      }
    }

    settings['github.copilot.chat.codesearch.exclude'] = {
      ...((settings['github.copilot.chat.codesearch.exclude'] as Record<string, boolean>) || {}),
      ...excludeObj,
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    outputChannel.appendLine(`[cap-7] Applied ${patterns.length} exclusion patterns to .vscode/settings.json`);
  } catch (err) {
    outputChannel.appendLine(`[cap-7] Notice: could not write exclusions to .vscode/settings.json: ${err}`);
  }

  // CAP-17: Also generate .copilotignore — Copilot respects it natively (like .gitignore)
  generateCopilotIgnore(wsPath, patterns, outputChannel);

  // Estimate savings
  const estimatedFiles = countExcludedFiles(wsPath, patterns);
  const avgFileTokens = 500;
  const estimatedTokens = estimatedFiles * avgFileTokens;

  outputChannel.appendLine(`[cap-7] Estimated ${estimatedFiles} files excluded, ~${estimatedTokens} tokens saved per full-context scan`);

  return {
    excludedPatterns: patterns.length,
    estimatedExcludedFiles: estimatedFiles,
    estimatedTokensSaved: estimatedTokens,
  };
}

/**
 * CAP-17: Write a .copilotignore file from the detected exclusion patterns.
 * VS Code Copilot natively respects .copilotignore (same syntax as .gitignore).
 * Only writes if the file doesn't exist or content differs — never overwrites user customisations.
 */
export function generateCopilotIgnore(
  workspacePath: string,
  patterns: string[],
  outputChannel: vscode.OutputChannel
): void {
  const ignorePath = path.join(workspacePath, '.copilotignore');

  const header = [
    '# .copilotignore — Managed by TokenShield (CAP-17)',
    '# VS Code Copilot respects this file like .gitignore.',
    '# Add your own patterns below the managed block.',
    '# To regenerate: TokenShield: Configure Context Exclusions',
    '',
    '# --- TOKENSHIELD MANAGED ---',
  ];

  // Convert glob patterns to .gitignore-compatible lines
  const gitignoreLines = patterns.map(p =>
    // Convert dir/** → dirname/ for .gitignore style
    p.endsWith('/**') ? p.slice(0, -3) + '/' : p
  );

  const footer = ['# --- END TOKENSHIELD MANAGED ---', ''];

  const managedBlock = [...header, ...gitignoreLines, ...footer].join('\n');

  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, managedBlock, 'utf-8');
    outputChannel.appendLine(`[cap-17] Created .copilotignore with ${patterns.length} exclusion patterns`);
    return;
  }

  // File exists — only replace managed block, preserve user lines outside it
  const existing = fs.readFileSync(ignorePath, 'utf-8');
  const MANAGED_START = '# --- TOKENSHIELD MANAGED ---';
  const MANAGED_END = '# --- END TOKENSHIELD MANAGED ---';
  const startIdx = existing.indexOf(MANAGED_START);
  const endIdx = existing.indexOf(MANAGED_END);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.substring(0, startIdx);
    const after = existing.substring(endIdx + MANAGED_END.length);
    const updated = before + [...header, ...gitignoreLines, ...footer].join('\n') + after;
    if (updated !== existing) {
      fs.writeFileSync(ignorePath, updated, 'utf-8');
      outputChannel.appendLine(`[cap-17] Updated managed block in .copilotignore`);
    } else {
      outputChannel.appendLine(`[cap-17] .copilotignore unchanged`);
    }
  } else {
    // No managed block — append to end, don't overwrite user content
    const appended = existing.trimEnd() + '\n\n' + managedBlock;
    fs.writeFileSync(ignorePath, appended, 'utf-8');
    outputChannel.appendLine(`[cap-17] Appended managed block to existing .copilotignore`);
  }
}

/**
 * Count how many files would be matched by the exclusion patterns.
 */
function countExcludedFiles(workspacePath: string, patterns: string[]): number {
  let count = 0;
  const maxDepth = 3;

  const extensionPatterns = patterns
    .filter(p => p.startsWith('*.'))
    .map(p => p.slice(1));

  const dirPatterns = patterns
    .filter(p => p.endsWith('/**'))
    .map(p => p.slice(0, -3));

  const filePatterns = patterns
    .filter(p => !p.includes('*') && !p.endsWith('/**'));

  function scan(dir: string, depth: number): void {
    if (depth > maxDepth) { return; }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') { continue; }

      if (entry.isDirectory()) {
        if (dirPatterns.some(p => entry.name === p)) {
          try {
            const subEntries = fs.readdirSync(path.join(dir, entry.name));
            count += subEntries.length;
          } catch { /* ignore */ }
        } else {
          scan(path.join(dir, entry.name), depth + 1);
        }
      } else {
        if (extensionPatterns.some(ext => entry.name.endsWith(ext)) ||
            filePatterns.some(f => entry.name === f)) {
          count++;
        }
      }
    }
  }

  scan(workspacePath, 0);
  return count;
}

/**
 * Interactive command for users to review/modify exclusion patterns.
 */
export async function showExclusionPicker(outputChannel: vscode.OutputChannel): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('TokenShield: No workspace folder open');
    return;
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  const patterns = detectProjectExclusions(wsPath);

  const items: vscode.QuickPickItem[] = patterns.map(p => ({
    label: p,
    picked: true,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select patterns to exclude from AI reasoning context',
    title: 'TokenShield — Context Exclusions (CAP-7)',
    canPickMany: true,
  });

  if (!selected) { return; }

  const selectedPatterns = selected.map(i => i.label);
  const excludeObj: Record<string, boolean> = {};
  for (const p of selectedPatterns) {
    excludeObj[p] = true;
  }

  const settingsPath = path.join(wsPath, '.vscode', 'settings.json');
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      settings = {};
    }
  }

  settings['github.copilot.chat.codesearch.exclude'] = excludeObj;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  vscode.window.showInformationMessage(
    `TokenShield: ${selectedPatterns.length} exclusion patterns applied to .vscode/settings.json`
  );
  outputChannel.appendLine(`[cap-7] User updated ${selectedPatterns.length} exclusion patterns`);
}
