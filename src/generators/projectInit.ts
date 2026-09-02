import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, getEffectiveStrategies } from '../core/config';
import {
  MARKER_START,
  MARKER_END,
  MARKER_COMMENT,
  COPILOT_INSTRUCTIONS_PATH,
  COPILOT_INSTRUCTIONS_SUBDIR_PATH,
  COPILOT_PROJECT_INSTRUCTIONS_SUBDIR_PATH,
  TOKENSHIELD_AGENT_PATH,
  TOKENSHIELD_SKILL_PATH,
} from '../core/constants';
import { CopilotGenerator } from './copilot';
import { detectGithubStructure } from './engine';

export type ProjectStack =
  | 'node'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'dotnet'
  | 'ruby'
  | 'php'
  | 'generic';

export interface StackDetectionResult {
  stacks: ProjectStack[];
  primary: ProjectStack;
  ambiguous: boolean;
}

const STACK_MARKERS: Array<{ file: string; stack: ProjectStack }> = [
  { file: 'package.json', stack: 'node' },
  { file: 'requirements.txt', stack: 'python' },
  { file: 'pyproject.toml', stack: 'python' },
  { file: 'setup.py', stack: 'python' },
  { file: 'go.mod', stack: 'go' },
  { file: 'Cargo.toml', stack: 'rust' },
  { file: 'pom.xml', stack: 'java' },
  { file: 'build.gradle', stack: 'java' },
  { file: 'build.gradle.kts', stack: 'java' },
  { file: '*.csproj', stack: 'dotnet' },
  { file: '*.sln', stack: 'dotnet' },
  { file: 'Gemfile', stack: 'ruby' },
  { file: 'composer.json', stack: 'php' },
];

const STACK_LABELS: Record<ProjectStack, string> = {
  node: '$(package) Node.js / TypeScript / JavaScript',
  python: '$(snake) Python',
  go: '$(arrow-right) Go',
  rust: '$(gear) Rust',
  java: '$(coffee) Java / Kotlin (JVM)',
  dotnet: '$(dot-net) .NET / C#',
  ruby: '$(ruby) Ruby',
  php: '$(code) PHP',
  generic: '$(globe) Generic / Other',
};

/** Stack-specific Copilot directives to append below the main TokenShield block */
const STACK_DIRECTIVES: Record<ProjectStack, string> = {
  node: `## Project Stack: Node.js / TypeScript
- Never read \`node_modules/\` — use \`npm ls <pkg>\` or type declarations instead.
- Run tests with \`npm test -- --reporter=min\` to get failure-only output (Test Failure Isolator).
- Prefer \`npx tsc --noEmit\` over full builds to check types without emitting.
- Lock file is \`package-lock.json\` / \`yarn.lock\` — never modify or ingest it.
- For imports, resolve from \`tsconfig.json\` paths before suggesting new deps.`,

  python: `## Project Stack: Python
- Never read \`.venv/\`, \`venv/\`, \`__pycache__/\`, or \`*.pyc\` files.
- Run tests with \`pytest -q --tb=short\` for compressed failure output (Test Failure Isolator).
- Use \`python -m mypy --ignore-missing-imports\` for type checks.
- Lock file is \`poetry.lock\` / \`Pipfile.lock\` — treat as read-only context.
- Prefer \`importlib.resources\` over relative \`__file__\` path hacks.`,

  go: `## Project Stack: Go
- Never read \`vendor/\` directory — use \`go list -m all\` instead.
- Run tests with \`go test ./... -v 2>&1 | grep -E 'FAIL|PASS|---'\` (Test Failure Isolator).
- Use \`go vet ./...\` and \`staticcheck\` before suggesting fixes.
- \`go.sum\` is auto-generated — never modify or include it in context.
- Prefer table-driven tests (\`tt\` pattern) over individual test functions.`,

  rust: `## Project Stack: Rust
- Never read \`target/\` directory — it can be hundreds of MB.
- Run tests with \`cargo test 2>&1 | grep -E 'FAILED|test result'\` (Test Failure Isolator).
- Use \`cargo check\` (no codegen) for fast type/borrow checking.
- \`Cargo.lock\` — treat as read-only; for binaries it is committed, for libs it is not.
- Prefer \`clippy\` suggestions: run \`cargo clippy -- -D warnings\`.`,

  java: `## Project Stack: Java / Kotlin (JVM)
- Never read \`target/\`, \`build/\`, or \`*.class\` files.
- Run tests with \`mvn test -q\` or \`./gradlew test --quiet\` (Test Failure Isolator).
- Use \`javac -proc:only\` for annotation processing checks without full compile.
- Gradle/Maven lock files are auto-generated — treat as read-only.
- Prefer referencing existing interfaces and abstract classes before creating new ones.`,

  dotnet: `## Project Stack: .NET / C#
- Never read \`bin/\`, \`obj/\`, or \`*.dll\` files.
- Run tests with \`dotnet test --logger "console;verbosity=minimal"\` (Test Failure Isolator).
- Use \`dotnet build --no-restore\` for incremental builds.
- NuGet \`packages.lock.json\` — treat as read-only context.
- Prefer existing \`IServiceCollection\` extension patterns for DI registration.`,

  ruby: `## Project Stack: Ruby
- Never read \`.bundle/\`, \`vendor/bundle/\`, or compiled gems.
- Run tests with \`bundle exec rspec --format progress\` for compact output (Test Failure Isolator).
- Use \`bundle exec rubocop --format clang\` for lint output.
- \`Gemfile.lock\` — treat as read-only; never modify.
- Prefer \`ActiveSupport::Concern\` patterns over raw \`module\` includes in Rails.`,

  php: `## Project Stack: PHP
- Never read \`vendor/\` — use \`composer show <pkg>\` for dependency info.
- Run tests with \`./vendor/bin/phpunit --testdox\` for readable output (Test Failure Isolator).
- Use \`composer validate\` to check \`composer.json\` integrity.
- \`composer.lock\` — treat as read-only context.
- Prefer PSR-4 autoloading paths when suggesting new class locations.`,

  generic: `## Project Notes
- Focus on targeted, minimal changes to reduce review surface.
- Always confirm file paths exist before suggesting edits.
- Prefer idiomatic patterns already present in the codebase over introducing new ones.`,
};

/**
 * Scans the workspace root for well-known stack marker files.
 * Returns detected stacks, the primary (most likely) one, and whether detection is ambiguous.
 */
export function detectProjectStack(wsPath: string): StackDetectionResult {
  const detected = new Set<ProjectStack>();

  for (const { file, stack } of STACK_MARKERS) {
    if (file.includes('*')) {
      const ext = file.replace('*', '');
      try {
        const entries = fs.readdirSync(wsPath);
        if (entries.some(e => e.endsWith(ext))) {
          detected.add(stack);
        }
      } catch { /* ignore */ }
    } else {
      if (fs.existsSync(path.join(wsPath, file))) {
        detected.add(stack);
      }
    }
  }

  const stacks = Array.from(detected);
  if (stacks.length === 0) {
    return { stacks: ['generic'], primary: 'generic', ambiguous: false };
  }
  if (stacks.length === 1) {
    return { stacks, primary: stacks[0], ambiguous: false };
  }

  // Ambiguous — prefer non-node if multiple detected (node package.json is often present in mixed repos)
  const nonNode = stacks.filter(s => s !== 'node');
  const primary = nonNode.length > 0 ? nonNode[0] : stacks[0];
  return { stacks, primary, ambiguous: true };
}

/**
 * Returns the project-specific markdown directive block for a given stack.
 */
export function getStackDirectives(stack: ProjectStack): string {
  return STACK_DIRECTIVES[stack] ?? STACK_DIRECTIVES.generic;
}

/**
 * Builds combined project instructions from core block and stack directives.
 */
export function buildProjectInstructions(
  coreBlock: string,
  stack: ProjectStack,
  projectName: string
): string {
  const stackSection = getStackDirectives(stack);
  return `# TokenShield Optimization Standards — ${projectName}

${coreBlock}

${stackSection}
`;
}

/**
 * Main entry point: detect stack (with optional QuickPick for ambiguous cases),
 * generate tailored instructions with all 19 CAPs + stack tips, and write cleanly.
 */
export async function initializeForProject(
  config: ExtensionConfig,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    vscode.window.showWarningMessage('TokenShield: No workspace folder open.');
    return;
  }

  const wsPath = wsFolders[0].uri.fsPath;
  const projectName = path.basename(wsPath);
  const structureLayout = detectGithubStructure(wsPath, config.githubStructureMode);

  // 1. Detect stack
  const detection = detectProjectStack(wsPath);
  outputChannel.appendLine(`[initProject] Detected stacks: ${detection.stacks.join(', ')} (primary: ${detection.primary})`);

  let chosenStack: ProjectStack = detection.primary;

  // 2. If ambiguous, show a QuickPick
  if (detection.ambiguous) {
    const items = detection.stacks.map(s => ({
      label: STACK_LABELS[s],
      description: s,
      stack: s,
    }));
    items.push({ label: STACK_LABELS.generic, description: 'generic', stack: 'generic' as ProjectStack });

    const pick = await vscode.window.showQuickPick(items, {
      title: 'TokenShield: Multiple stacks detected — pick the primary one',
      placeHolder: `Detected: ${detection.stacks.join(', ')}`,
    });

    if (!pick) {
      outputChannel.appendLine('[initProject] User cancelled stack selection.');
      return;
    }
    chosenStack = pick.stack;
  }

  outputChannel.appendLine(`[initProject] Using stack: ${chosenStack} for project: ${projectName}`);

  // 3. Build core TokenShield block via CopilotGenerator (includes all 19 CAPs)
  const copilotGen = new CopilotGenerator();
  const strategies = getEffectiveStrategies(config);
  const baseContent = copilotGen.generateContent(strategies, config);
  const stackSection = getStackDirectives(chosenStack);

  const fullContent = `${baseContent.trimEnd()}

${stackSection}
`;

  let writtenPath = '';

  if (structureLayout === 'structured') {
    // --- Structured .github/ layout ---
    const targetSubdirPath = path.join(wsPath, COPILOT_INSTRUCTIONS_SUBDIR_PATH);
    const subdir = path.dirname(targetSubdirPath);
    if (!fs.existsSync(subdir)) {
      fs.mkdirSync(subdir, { recursive: true });
    }

    fs.writeFileSync(targetSubdirPath, fullContent, 'utf-8');
    writtenPath = targetSubdirPath;
    outputChannel.appendLine(`[initProject] Wrote structured directives: ${targetSubdirPath}`);

    // Direct merge of optimization directives into existing main instructions file
    injectCrossReference(wsPath, fullContent, outputChannel);

    // Optional agent & skill scaffolding
    if (config.generateAgentFiles) {
      scaffoldAgentAndSkill(wsPath, outputChannel);
    }
  } else {
    // --- Flat .github/ layout ---
    const githubDir = path.join(wsPath, '.github');
    if (!fs.existsSync(githubDir)) {
      fs.mkdirSync(githubDir, { recursive: true });
    }
    const githubPath = path.join(githubDir, 'copilot-instructions.md');

    // Check if existing file exists to merge cleanly
    if (fs.existsSync(githubPath)) {
      const existing = fs.readFileSync(githubPath, 'utf-8');
      const startIdx = existing.indexOf(MARKER_START);
      const endIdx = existing.indexOf(MARKER_END);
      if (startIdx !== -1 && endIdx !== -1) {
        const before = existing.substring(0, startIdx);
        const after = existing.substring(endIdx + MARKER_END.length);
        const sIdx = fullContent.indexOf(MARKER_START);
        const eIdx = fullContent.indexOf(MARKER_END);
        const newBlock = (sIdx !== -1 && eIdx !== -1)
          ? fullContent.substring(sIdx, eIdx + MARKER_END.length)
          : fullContent;
        fs.writeFileSync(githubPath, before + newBlock + after, 'utf-8');
      } else {
        fs.writeFileSync(githubPath, existing.trimEnd() + '\n\n' + fullContent, 'utf-8');
      }
    } else {
      fs.writeFileSync(githubPath, fullContent, 'utf-8');
    }

    writtenPath = githubPath;
    outputChannel.appendLine(`[initProject] Wrote: ${githubPath}`);

    // Secondary .vscode/copilot-instructions.md
    const vscodeDir = path.join(wsPath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }
    const vscodePath = path.join(vscodeDir, 'copilot-instructions.md');
    fs.writeFileSync(vscodePath, fullContent, 'utf-8');
    outputChannel.appendLine(`[initProject] Wrote: ${vscodePath}`);
  }

  // Register in settings.json
  try {
    const wsConfig = vscode.workspace.getConfiguration('', wsFolders[0].uri);
    const rel = structureLayout === 'structured'
      ? COPILOT_INSTRUCTIONS_SUBDIR_PATH
      : '.vscode/copilot-instructions.md';
    const existing = wsConfig.get<any[]>('github.copilot.chat.codeGeneration.instructions') || [];
    const hasEntry = existing.some(e => typeof e === 'object' && (e.file?.includes('copilot-instructions.md') || e.file?.includes('tokenshield.instructions.md')));
    if (!hasEntry) {
      await wsConfig.update(
        'github.copilot.chat.codeGeneration.instructions',
        [...existing, { file: rel }],
        vscode.ConfigurationTarget.Workspace
      );
      outputChannel.appendLine(`[initProject] Registered in github.copilot.chat.codeGeneration.instructions: ${rel}`);
    }
  } catch (err) {
    outputChannel.appendLine(`[initProject] Notice: settings.json update deferred: ${err}`);
  }

  // Notify user
  const stackLabel = STACK_LABELS[chosenStack].replace(/\$\([^)]+\) /, '');
  const modeLabel = structureLayout === 'structured' ? '.github/instructions/' : '.github/';
  const action = await vscode.window.showInformationMessage(
    `🛡️ TokenShield: Project initialized for ${stackLabel}! Directives written to ${modeLabel}.`,
    'Open Instructions',
    'Dismiss'
  );
  if (action === 'Open Instructions' && writtenPath) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(writtenPath));
    await vscode.window.showTextDocument(doc);
  }
}

function injectCrossReference(wsPath: string, fullContent: string, outputChannel: vscode.OutputChannel): void {
  const candidatePaths = [
    path.join(wsPath, COPILOT_PROJECT_INSTRUCTIONS_SUBDIR_PATH),
    path.join(wsPath, COPILOT_INSTRUCTIONS_PATH),
  ];

  const copilotGen = new CopilotGenerator();

  for (const targetFile of candidatePaths) {
    if (fs.existsSync(targetFile)) {
      const existing = fs.readFileSync(targetFile, 'utf-8');
      const merged = (copilotGen as any).mergeContent(existing, fullContent);
      if (merged !== existing) {
        fs.writeFileSync(targetFile, merged, 'utf-8');
        outputChannel.appendLine(`[initProject] Merged TokenShield optimization directives into: ${targetFile}`);
      }
      break;
    }
  }
}

function scaffoldAgentAndSkill(wsPath: string, outputChannel: vscode.OutputChannel): void {
  const agentPath = path.join(wsPath, TOKENSHIELD_AGENT_PATH);
  const agentDir = path.dirname(agentPath);
  if (!fs.existsSync(agentPath)) {
    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
    }
    const agentContent = `---
name: "TokenShield Optimizer"
description: >
  Token and cost optimization agent. Use this agent to analyze
  prompt efficiency, suggest context pruning, and enforce the
  19 optimization features.
tools:
  - search/codebase
  - terminal
---

# TokenShield Optimizer Agent

You enforce TokenShield optimization standards for this project.

## Active Optimizations
Read \`.github/instructions/tokenshield.instructions.md\` for the full list of active features.
`;
    fs.writeFileSync(agentPath, agentContent, 'utf-8');
    outputChannel.appendLine(`[initProject] Scaffolded agent: ${agentPath}`);
  }

  const skillPath = path.join(wsPath, TOKENSHIELD_SKILL_PATH);
  const skillDir = path.dirname(skillPath);
  if (!fs.existsSync(skillPath)) {
    if (!fs.existsSync(skillDir)) {
      fs.mkdirSync(skillDir, { recursive: true });
    }
    const skillContent = `---
name: tokenshield-optimize
description: >
  Analyze current AI interaction patterns and suggest token/cost
  optimizations using TokenShield's 19 optimization features.
---

# TokenShield Optimization Skill

Invoke this skill to analyze prompt efficiency and apply TokenShield optimizations.

## Active Optimizations
Read \`.github/instructions/tokenshield.instructions.md\` for active optimization rules.
`;
    fs.writeFileSync(skillPath, skillContent, 'utf-8');
    outputChannel.appendLine(`[initProject] Scaffolded skill: ${skillPath}`);
  }
}
