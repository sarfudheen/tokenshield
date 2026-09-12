import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface DetectedExclusion {
  pattern: string;
  category: 'build' | 'lockfiles' | 'datasets' | 'minified' | 'caches' | 'vendor';
  reason: string;
  matchedCount: number;
  estimatedTokensSaved: number;
}

const COMMON_CANDIDATES: { pattern: string; category: DetectedExclusion['category']; reason: string }[] = [
  // Build outputs
  { pattern: 'dist/', category: 'build', reason: 'Compiled JavaScript/TypeScript distribution' },
  { pattern: 'build/', category: 'build', reason: 'Build output artifacts' },
  { pattern: 'out/', category: 'build', reason: 'Compiler output directory' },
  { pattern: '.next/', category: 'build', reason: 'Next.js server & client build cache' },
  { pattern: '.nuxt/', category: 'build', reason: 'Nuxt build directory' },
  { pattern: '.turbo/', category: 'build', reason: 'Turborepo local cache' },
  { pattern: 'target/', category: 'build', reason: 'Rust / Cargo / Maven build target' },
  { pattern: 'bin/', category: 'build', reason: 'Binary outputs' },
  { pattern: 'obj/', category: 'build', reason: '.NET / C# intermediate objects' },
  { pattern: 'coverage/', category: 'build', reason: 'Test coverage reports' },
  { pattern: '.nyc_output/', category: 'build', reason: 'NYC coverage cache' },

  // Lock files
  { pattern: 'package-lock.json', category: 'lockfiles', reason: 'NPM dependency lockfile (often 10k-50k tokens)' },
  { pattern: 'yarn.lock', category: 'lockfiles', reason: 'Yarn dependency lockfile' },
  { pattern: 'pnpm-lock.yaml', category: 'lockfiles', reason: 'PNPM dependency lockfile' },
  { pattern: 'Cargo.lock', category: 'lockfiles', reason: 'Cargo dependency lockfile' },
  { pattern: 'composer.lock', category: 'lockfiles', reason: 'PHP Composer lockfile' },
  { pattern: 'Gemfile.lock', category: 'lockfiles', reason: 'Ruby Bundler lockfile' },
  { pattern: 'poetry.lock', category: 'lockfiles', reason: 'Python Poetry lockfile' },

  // Minified & Maps
  { pattern: '**/*.min.js', category: 'minified', reason: 'Minified JavaScript (high token density, zero semantic value)' },
  { pattern: '**/*.min.css', category: 'minified', reason: 'Minified CSS stylesheets' },
  { pattern: '**/*.map', category: 'minified', reason: 'Source map files' },
  { pattern: '**/*.bundle.js', category: 'minified', reason: 'Pre-bundled JavaScript assets' },

  // Caches
  { pattern: '.cache/', category: 'caches', reason: 'Tool caches' },
  { pattern: '.parcel-cache/', category: 'caches', reason: 'Parcel bundler cache' },
  { pattern: '.pytest_cache/', category: 'caches', reason: 'Python Pytest cache' },
  { pattern: '.mypy_cache/', category: 'caches', reason: 'Mypy type cache' },
  { pattern: '.ruff_cache/', category: 'caches', reason: 'Ruff linter cache' },
  { pattern: '.gradle/', category: 'caches', reason: 'Gradle build cache' },

  // Datasets & Large Binaries
  { pattern: '**/*.sqlite', category: 'datasets', reason: 'SQLite databases' },
  { pattern: '**/*.parquet', category: 'datasets', reason: 'Columnar data files' },
  { pattern: '**/*.csv', category: 'datasets', reason: 'Raw tabular datasets' },
  { pattern: '**/*.onnx', category: 'datasets', reason: 'ONNX machine learning models' },
  { pattern: '**/*.wasm', category: 'datasets', reason: 'WebAssembly binaries' },

  // Vendor
  { pattern: 'vendor/', category: 'vendor', reason: 'Third-party vendor libraries' },
  { pattern: 'bower_components/', category: 'vendor', reason: 'Legacy Bower dependencies' },
  { pattern: 'Pods/', category: 'vendor', reason: 'CocoaPods dependencies' },
];

export async function scanWorkspaceForExclusions(workspacePath: string): Promise<DetectedExclusion[]> {
  const results: DetectedExclusion[] = [];

  for (const candidate of COMMON_CANDIDATES) {
    const isDir = candidate.pattern.endsWith('/');
    const isGlob = candidate.pattern.includes('*');

    if (!isGlob) {
      const fullPath = path.join(workspacePath, isDir ? candidate.pattern.slice(0, -1) : candidate.pattern);
      if (fs.existsSync(fullPath)) {
        let matchedCount = 1;
        let estTokens = 500;
        if (isDir) {
          try {
            const files = fs.readdirSync(fullPath);
            matchedCount = files.length;
            estTokens = matchedCount * 400;
          } catch {
            matchedCount = 10;
            estTokens = 4000;
          }
        } else {
          try {
            const stat = fs.statSync(fullPath);
            estTokens = Math.max(100, Math.ceil(stat.size / 4));
          } catch {
            estTokens = 2500;
          }
        }
        results.push({
          pattern: candidate.pattern,
          category: candidate.category,
          reason: candidate.reason,
          matchedCount,
          estimatedTokensSaved: estTokens,
        });
      }
    } else {
      // For glob patterns, check if any files match via VS Code search
      try {
        const uris = await vscode.workspace.findFiles(candidate.pattern, '**/node_modules/**', 10);
        if (uris.length > 0) {
          results.push({
            pattern: candidate.pattern,
            category: candidate.category,
            reason: candidate.reason,
            matchedCount: uris.length,
            estimatedTokensSaved: uris.length * 1500,
          });
        }
      } catch {
        // Fallback ignore
      }
    }
  }

  return results;
}

const MANAGED_START = '# --- TOKENSCULPT MANAGED EXCLUSIONS ---';
const MANAGED_END = '# --- END TOKENSCULPT MANAGED EXCLUSIONS ---';

export function applyPatternsToCopilotIgnore(
  workspacePath: string,
  patterns: string[]
): { created: boolean; updated: boolean; count: number } {
  const ignorePath = path.join(workspacePath, '.copilotignore');

  const contentBlock = [
    MANAGED_START,
    '# .copilotignore — Smart Exclusions Managed by TokenSculpt',
    '# Excludes non-source build artifacts, lockfiles, and large datasets from AI context',
    '# Custom rules can be safely added outside this managed block',
    '',
    ...patterns,
    MANAGED_END,
  ].join('\n');

  if (!fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, contentBlock + '\n', 'utf-8');
    return { created: true, updated: false, count: patterns.length };
  }

  const existing = fs.readFileSync(ignorePath, 'utf-8');
  const startIdx = existing.indexOf(MANAGED_START);
  const endIdx = existing.indexOf(MANAGED_END);

  let updatedContent: string;
  if (startIdx !== -1 && endIdx !== -1) {
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + MANAGED_END.length);
    updatedContent = before + contentBlock + after;
  } else {
    // Check legacy tokenshield block
    const legacyStart = existing.indexOf('# --- TOKENSHIELD MANAGED ---');
    const legacyEnd = existing.indexOf('# --- END TOKENSHIELD MANAGED ---');
    if (legacyStart !== -1 && legacyEnd !== -1) {
      const before = existing.slice(0, legacyStart);
      const after = existing.slice(legacyEnd + '# --- END TOKENSHIELD MANAGED ---'.length);
      updatedContent = before + contentBlock + after;
    } else {
      updatedContent = existing.trimEnd() + '\n\n' + contentBlock + '\n';
    }
  }

  fs.writeFileSync(ignorePath, updatedContent, 'utf-8');
  return { created: false, updated: true, count: patterns.length };
}

export async function generateSmartExclusionsCommand(outputChannel?: vscode.OutputChannel): Promise<void> {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    vscode.window.showWarningMessage('TokenSculpt: Open a workspace to generate exclusions.');
    return;
  }

  const wsPath = wsFolders[0].uri.fsPath;
  outputChannel?.appendLine('[autoExclude] Scanning workspace for heavy non-source files...');

  const detected = await scanWorkspaceForExclusions(wsPath);

  if (detected.length === 0) {
    vscode.window.showInformationMessage('TokenSculpt: Workspace is clean. No excessive non-source files detected.');
    return;
  }

  let totalTokensSaved = 0;
  for (const d of detected) {
    totalTokensSaved += d.estimatedTokensSaved;
  }

  const quickPickItems: (vscode.QuickPickItem & { pattern: string })[] = detected.map(d => ({
    label: `$(file-directory) ${d.pattern}`,
    description: `[${d.category.toUpperCase()}] ~${d.estimatedTokensSaved.toLocaleString()} tok saved`,
    detail: `${d.reason} (${d.matchedCount} matches detected)`,
    picked: true,
    pattern: d.pattern,
  }));

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    title: `TokenSculpt: Smart .copilotignore Generator (~${totalTokensSaved.toLocaleString()} tok potential savings)`,
    placeHolder: 'Select patterns to exclude from AI context (all checked by default)',
    canPickMany: true,
  });

  if (!selected || selected.length === 0) {
    outputChannel?.appendLine('[autoExclude] Exclusion generation cancelled.');
    return;
  }

  const chosenPatterns = selected.map(s => s.pattern);
  const result = applyPatternsToCopilotIgnore(wsPath, chosenPatterns);

  outputChannel?.appendLine(`[autoExclude] Applied ${result.count} patterns to .copilotignore`);
  vscode.window.showInformationMessage(
    `TokenSculpt: Applied ${result.count} smart exclusion patterns to .copilotignore (~${totalTokensSaved.toLocaleString()} tokens saved/scan).`
  );
}
