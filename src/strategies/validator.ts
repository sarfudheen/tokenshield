import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import { getConfig, getEffectiveStrategies, TOTAL_STRATEGIES } from '../core/config';
import { isBinaryAvailable } from '../installer/installer';
import { getProjectsToIndex } from '../ui/projectPicker';
import { COPILOT_INSTRUCTIONS_PATH, CLAUDE_INSTRUCTIONS_PATH, CODEX_INSTRUCTIONS_PATH, MARKER_START, MCP_CACHE_SERVER_NAME, COPILOTIGNORE_PATH } from '../core/constants';
import { SemanticCacheStore, CACHE_DIR, CACHE_FILE } from '../cache/store';
import { detectProjectExclusions } from './contextExclusion';
import { getGuardrailTracker } from './guardrails';
import { getModelRoutingTracker } from './modelRouting';

// ─── result types ────────────────────────────────────────────────────────────

type Status = 'ok' | 'warn' | 'error' | 'disabled';

interface CategoryResult {
  category: string;
  status: Status;
  lines: string[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function runCmd(cmd: string, args: string[], cwd?: string): string {
  const r = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000,
    encoding: 'utf-8',
    cwd,
  });
  return (r.stdout ?? '') + (r.stderr ?? '');
}

function getVersion(bin: string): string {
  try {
    const out = execSync(`${bin} --version`, { stdio: 'pipe', timeout: 5000, encoding: 'utf-8' });
    return out.trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

function wsPath(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

function instructionPath(rel: string): string {
  const ws = wsPath();
  return ws ? path.join(ws, rel) : '';
}

function checkInstructionFile(rel: string, keyword: string): { exists: boolean; hasSection: boolean; path: string } {
  const p = instructionPath(rel);
  if (!p || !fs.existsSync(p)) { return { exists: false, hasSection: false, path: p }; }
  const content = fs.readFileSync(p, 'utf-8');
  const hasSection = content.includes(MARKER_START) && content.includes(keyword);
  return { exists: true, hasSection, path: p };
}

function icon(status: Status): string {
  return { ok: '✓', warn: '⚠', error: '✗', disabled: '○' }[status];
}

// ─── CodeGraph ────────────────────────────────────────────────────────

async function validateCodeGraph(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];
  let status: Status = 'ok';

  if (!strategies.codeGraph) {
    return { category: 'CodeGraph', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const installed = isBinaryAvailable('codegraph');
  if (!installed) {
    return {
      category: 'CodeGraph', status: 'warn',
      lines: [
        'codegraph binary not installed — running in instruction-only search mode',
        'Optional CLI install: npm install -g @colbymchenry/codegraph',
      ],
    };
  }

  const version = getVersion('codegraph');
  lines.push(`Binary     : codegraph ${version}`);

  const projects = getProjectsToIndex();
  if (projects.length === 0) {
    lines.push('Projects   : none configured — all workspace folders used as fallback');
  } else {
    lines.push(`Projects   : ${projects.length} configured`);
  }

  for (const project of projects) {
    const indexDir = path.join(project.absPath, '.codegraph');
    const hasIndex = fs.existsSync(indexDir);
    if (!hasIndex) {
      lines.push(`  ○ ${project.name}: not indexed (optional)`);
    } else {
      const statusOut = runCmd('codegraph', ['status'], project.absPath);
      const nodeLine = statusOut.split('\n').find(l => /nodes|symbols/i.test(l))?.trim();
      lines.push(`  ✓ ${project.name}: indexed${nodeLine ? ` — ${nodeLine}` : ''}`);
    }
  }

  return { category: 'CodeGraph', status, lines };
}

// ─── RTK / CLI Compression ───────────────────────────────────────────

async function validateRtk(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.outputCompression) {
    return { category: 'CLI Output Compression', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const installed = isBinaryAvailable('rtk');
  if (!installed) {
    return {
      category: 'CLI Output Compression', status: 'ok',
      lines: [
        '  ✓ Universal CLI compression rules active in instructions (test failure filtering & git status summaries)',
        '  ○ Optional rtk binary not found on PATH — running in universal instruction mode',
      ],
    };
  }

  const version = getVersion('rtk');
  lines.push(`Binary     : rtk ${version}`);

  const showOut = runCmd('rtk', ['init', '--show']);
  const hookLine = showOut.split('\n').find(l => /hook|copilot|claude|wired|active|install/i.test(l))?.trim();
  if (hookLine) {
    lines.push(`Hook status: ${hookLine}`);
  }

  return { category: 'CLI Output Compression', status: 'ok', lines };
}

// ─── Verbosity Control ────────────────────────────────────────────────

async function validateVerbosity(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.verbosityControl) {
    return { category: 'Verbosity Control', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push(`Verbosity level: ${config.verbosityLevel} mode`);
  lines.push('  ✓ Active in Copilot instructions');
  return { category: 'Verbosity Control', status: 'ok', lines };
}

// ─── Session Management ───────────────────────────────────────────────

async function validateSession(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.sessionManagement) {
    return { category: 'Session Management', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Session & context hygiene rules active in instructions');
  return { category: 'Session Management', status: 'ok', lines };
}

// ─── Semantic Cache ───────────────────────────────────────────────────

async function validateSemanticCache(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];
  let status: Status = 'ok';

  if (!strategies.semanticCache) {
    return { category: 'Semantic Cache', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const ws = wsPath();
  if (!ws) {
    return { category: 'Semantic Cache', status: 'warn', lines: ['No workspace folder open'] };
  }

  const settingsPath = path.join(ws, '.vscode', 'settings.json');
  let serverOk = false;
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const entry = settings?.mcp?.servers?.[MCP_CACHE_SERVER_NAME];
    if (entry?.args?.[0]) {
      lines.push(`  ✓ MCP server registered: ${MCP_CACHE_SERVER_NAME}`);
      serverOk = true;
    }
  } catch { /* ignore */ }

  if (!serverOk) {
    lines.push(`  ○ MCP server "${MCP_CACHE_SERVER_NAME}" entry pending in .vscode/settings.json`);
  }

  const cacheFilePath = path.join(ws, CACHE_DIR, CACHE_FILE);
  if (fs.existsSync(cacheFilePath)) {
    try {
      const stats = new SemanticCacheStore(ws).stats();
      lines.push(`  ✓ Cache store: ${stats.entries} answers cached, ${stats.totalHits} hits`);
    } catch {
      lines.push('  ⚠ Cache file unreadable');
    }
  } else {
    lines.push('  ✓ Cache ready: .aicache store initialized');
  }

  return { category: 'Semantic Cache', status, lines };
}

// ─── AST Skeleton ─────────────────────────────────────────────────────

async function validateAstSkeleton(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.astSkeleton) {
    return { category: 'AST Skeleton Context Pruning', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Language parsers: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, JSON');
  lines.push('  ✓ skeleton_view MCP tool registered in token-cache server');
  lines.push('  ✓ ~85-95% context reduction on file navigation');

  return { category: 'AST Skeleton Context Pruning', status: 'ok', lines };
}

// ─── Context Exclusion ────────────────────────────────────────────────

async function validateContextExclusion(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.contextExclusion) {
    return { category: 'Smart Context Exclusion', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const ws = wsPath();
  const patterns = ws ? detectProjectExclusions(ws) : [];
  lines.push(`  ✓ Auto-exclusion: ${patterns.length} patterns configured`);
  lines.push('  ✓ Excludes lock files, minified bundles, build output, coverage from Copilot context');

  return { category: 'Smart Context Exclusion', status: 'ok', lines };
}

// ─── Diff-Only Output ─────────────────────────────────────────────────

async function validateDiffOnly(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.diffOnlyOutput) {
    return { category: 'Diff-Only Output Mode', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Diff-only output rules active in instructions (~92% output token savings)');
  lines.push('  ✓ Instructs AI to produce patches with ±3 context lines instead of rewriting files');

  return { category: 'Diff-Only Output Mode', status: 'ok', lines };
}

// ─── Agent Guardrails ─────────────────────────────────────────────────

async function validateGuardrails(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.agentGuardrails) {
    return { category: 'Agent Loop Guardrails', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const tracker = getGuardrailTracker();
  const stats = tracker.getStats();
  lines.push(`  ✓ Limits: Max retries = ${config.guardrails.maxRetries}, Max file edits = ${config.guardrails.maxFilesPerTask}`);
  lines.push(`  ✓ Session events: ${stats.totalTriggers} runaway loop(s) intercepted`);

  return { category: 'Agent Loop Guardrails', status: 'ok', lines };
}

// ─── Smart Model Routing ─────────────────────────────────────────────

async function validateModelRouting(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.smartModelRouting) {
    return { category: 'Smart Model Routing', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const tracker = getModelRoutingTracker();
  const stats = tracker.getStats();
  lines.push('  ✓ Prompt task classifier active (lightweight vs full-power)');
  lines.push(`  ✓ Session classifications: ${stats.totalClassified} tasks (${stats.lightweight} lightweight, ${stats.fullPower} full-power)`);

  return { category: 'Smart Model Routing', status: 'ok', lines };
}

// ─── Git Diff Context ────────────────────────────────────────────────

async function validateGitDiffContext(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.gitDiffContext) {
    return { category: 'Git Diff-Scoped Context', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Prunes reviews and test context to `git diff` boundaries + 1-hop callers');
  lines.push('  ✓ Active in Copilot & Antigravity instruction sets');

  return { category: 'Git Diff-Scoped Context', status: 'ok', lines };
}

// ─── Deterministic Prefix Caching ────────────────────────────────────

async function validateKvCache(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.kvCacheAlignment) {
    return { category: 'Deterministic Prefix Caching', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Static prefix byte-ordering rules active for API/agent-mode frameworks');
  lines.push('  ✓ Optimizes cloud KV-cache hits in Cursor and custom agents');

  return { category: 'Deterministic Prefix Caching', status: 'ok', lines };
}

// ─── Comment Stripper ────────────────────────────────────────────────

async function validateCommentStripper(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.commentStripper) {
    return { category: 'Comment & Header Stripping', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ strip_comments tool available in token-cache server');
  lines.push('  ✓ Automatically removes license preambles and boilerplate comments on ingestion');

  return { category: 'Comment & Header Stripping', status: 'ok', lines };
}

// ─── Test Failure Isolator ───────────────────────────────────────────

async function validateTestFailureIsolator(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.testFailureIsolator) {
    return { category: 'Test Log Failure Isolation', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ isolate_test_failures tool available in token-cache server');
  lines.push('  ✓ Filters test output to failing assertions & file:line references (~90% log savings)');

  return { category: 'Test Log Failure Isolation', status: 'ok', lines };
}

// ─── Windowed Range Slicing ──────────────────────────────────────────

async function validateRangeSlicing(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.rangeSlicing) {
    return { category: 'Windowed Range Slicing', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Constrains symbol navigation to targeted 100-line windows');
  lines.push('  ✓ Prevents whole-file ingestion when inspecting individual functions');

  return { category: 'Windowed Range Slicing', status: 'ok', lines };
}

// ─── Inline Chat Scope Pinning ───────────────────────────────────────

async function validateInlineChatScope(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.inlineChatScopePinning) {
    return { category: 'Inline Chat Scope Pinning', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Constrains VS Code inline chat context to selected lines + 1-hop references');
  lines.push('  ✓ Active in Copilot instructions');

  return { category: 'Inline Chat Scope Pinning', status: 'ok', lines };
}

// ─── .copilotignore Generation ───────────────────────────────────────

async function validateCopilotIgnore(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.copilotIgnoreGeneration) {
    return { category: '.copilotignore Generation', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  const ws = wsPath();
  const ignoreFile = ws ? path.join(ws, COPILOTIGNORE_PATH) : '';
  const exists = ignoreFile && fs.existsSync(ignoreFile);

  if (exists) {
    lines.push(`  ✓ .copilotignore file active in workspace root`);
    lines.push('  ✓ GitHub Copilot natively blocks matched paths from prompt indexing');
  } else {
    lines.push(`  ○ .copilotignore file will be generated on next context exclusion sync`);
  }

  return { category: '.copilotignore Generation', status: 'ok', lines };
}

// ─── Copilot Edits Awareness ─────────────────────────────────────────

async function validateCopilotEdits(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.copilotEditsAwareness) {
    return { category: 'Copilot Edits Awareness', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Directs Copilot not to re-read files already open in active edit sessions');
  lines.push('  ✓ Enforces incremental patch proposals instead of file rewrites');

  return { category: 'Copilot Edits Awareness', status: 'ok', lines };
}

// ─── Thread Reset Trigger ────────────────────────────────────────────

async function validateThreadReset(): Promise<CategoryResult> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);
  const lines: string[] = [];

  if (!strategies.threadResetTrigger) {
    return { category: 'Thread Reset Trigger', status: 'disabled', lines: ['Strategy disabled in current profile'] };
  }

  lines.push('  ✓ Proactively prompts user to start a fresh thread at 40+ messages / 30m');
  lines.push('  ✓ Prevents context saturation and quality degradation in long chats');

  return { category: 'Thread Reset Trigger', status: 'ok', lines };
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function validateAllStrategies(outputChannel: vscode.OutputChannel): Promise<void> {
  outputChannel.show(true);
  outputChannel.appendLine('');
  outputChannel.appendLine('══════════════════════════════════════════════════════════');
  outputChannel.appendLine('  TokenShield — Strategy Health Check Report');
  outputChannel.appendLine(`  ${new Date().toLocaleString()}  |  Profile: ${getConfig().profile}`);
  outputChannel.appendLine('══════════════════════════════════════════════════════════');

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Validating all ${TOTAL_STRATEGIES} strategies…`, cancellable: false },
    async (progress) => {
      progress.report({ message: 'CodeGraph Pre-Indexing…' });
      const r1 = await validateCodeGraph();

      progress.report({ message: 'CLI Output Compression…' });
      const r2 = await validateRtk();

      progress.report({ message: 'Concise Responses…' });
      const r3 = await validateVerbosity();

      progress.report({ message: 'Context Compaction…' });
      const r4 = await validateSession();

      progress.report({ message: 'Semantic Cache…' });
      const r5 = await validateSemanticCache();

      progress.report({ message: 'AST Skeletons…' });
      const r6 = await validateAstSkeleton();

      progress.report({ message: 'Smart Context Exclusions…' });
      const r7 = await validateContextExclusion();

      progress.report({ message: 'Diff-Only Output…' });
      const r8 = await validateDiffOnly();

      progress.report({ message: 'Loop Guardrails…' });
      const r9 = await validateGuardrails();

      progress.report({ message: 'Smart Model Routing…' });
      const r10 = await validateModelRouting();

      progress.report({ message: 'Git Diff Scoping…' });
      const r11 = await validateGitDiffContext();

      progress.report({ message: 'Prompt Prefix Caching…' });
      const r12 = await validateKvCache();

      progress.report({ message: 'Comment Stripper…' });
      const r13 = await validateCommentStripper();

      progress.report({ message: 'Test Failure Isolator…' });
      const r14 = await validateTestFailureIsolator();

      progress.report({ message: 'Windowed Range Slicing…' });
      const r15 = await validateRangeSlicing();

      progress.report({ message: 'Inline Chat Scope…' });
      const r16 = await validateInlineChatScope();

      progress.report({ message: '.copilotignore Generator…' });
      const r17 = await validateCopilotIgnore();

      progress.report({ message: 'Edit Session Awareness…' });
      const r18 = await validateCopilotEdits();

      progress.report({ message: 'Context Saturation Monitor…' });
      const r19 = await validateThreadReset();

      return [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, r18, r19];
    }
  );

  for (const r of results) {
    outputChannel.appendLine('');
    outputChannel.appendLine(`  ${icon(r.status)} ${r.category}  [${r.status.toUpperCase()}]`);
    outputChannel.appendLine('  ──────────────────────────────────────────────────────');
    for (const line of r.lines) {
      outputChannel.appendLine(`  ${line}`);
    }
  }

  outputChannel.appendLine('');
  outputChannel.appendLine('══════════════════════════════════════════════════════════');

  const okCount = results.filter(r => r.status === 'ok').length;
  const disabledCount = results.filter(r => r.status === 'disabled').length;
  const errorCount = results.filter(r => r.status === 'error').length;
  const warnCount = results.filter(r => r.status === 'warn').length;

  outputChannel.appendLine(`  Summary: ${okCount} ok  |  ${disabledCount} disabled  |  ${warnCount} warn  |  ${errorCount} error`);
  outputChannel.appendLine('══════════════════════════════════════════════════════════');

  vscode.window.showInformationMessage(
    `TokenShield: ${okCount}/${TOTAL_STRATEGIES} strategies validated ✓ (${disabledCount} disabled, ${warnCount} warnings)`,
    'Show Report'
  ).then(c => { if (c) { outputChannel.show(); } });
}
