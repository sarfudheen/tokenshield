export const MARKER_START = '<!-- TOKENSHIELD:START -->';
export const MARKER_END = '<!-- TOKENSHIELD:END -->';
export const MARKER_COMMENT = '<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->';

export const EXTENSION_ID = 'tokenshield';
export const EXTENSION_NAME = 'TokenShield';

export type ToolInstallMethod = 'npm-global' | 'brew' | 'shell-script';

export interface ToolInstallEntry {
  name: string;
  description: string;
  method: ToolInstallMethod;
  npmPackage?: string;
  brewPackage?: string;
  shellScriptUrl?: string;
  postInstallArgs?: string[];
}

export const TOOLS_TO_INSTALL: ToolInstallEntry[] = [
  {
    name: 'codegraph',
    description: 'Semantic code-graph indexing — 58% fewer AI tool calls, 22% faster answers (100% local)',
    method: 'npm-global',
    npmPackage: '@colbymchenry/codegraph',
  },
  {
    name: 'rtk',
    description: 'CLI proxy — 60-90% token savings on git, test, build, ls, grep commands (Apache 2.0)',
    method: 'brew',
    brewPackage: 'rtk',
    shellScriptUrl: 'https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh',
    postInstallArgs: ['init', '-g', '--copilot'],
  },
];

export const COPILOT_EXTENSION_ID = 'github.copilot';
export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
export const CODEX_EXTENSION_ID = 'openai.codex';

export const COPILOT_INSTRUCTIONS_PATH = '.github/copilot-instructions.md';
export const COPILOT_VSCODE_INSTRUCTIONS_PATH = '.vscode/copilot-instructions.md';
export const CLAUDE_INSTRUCTIONS_PATH = 'CLAUDE.md';
export const CODEX_INSTRUCTIONS_PATH = '.codex/instructions.md';
export const ANTIGRAVITY_INSTRUCTIONS_PATH = 'AGENTS.md';

export const MCP_CACHE_SERVER_NAME = 'token-cache';

export const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  codeGraph: 'CodeGraph pre-indexing — locate files via semantic query instead of grepping',
  outputCompression: 'RTK output compression — compress CLI/log output before AI reads it',
  verbosityControl: 'Caveman response control — constrain AI response length',
  sessionManagement: 'Session management — audit context, clear sessions, route models',
  semanticCache: 'Semantic cache — serve repeated/similar questions from local disk, zero tokens',
  astSkeleton: 'AST Skeleton — show only signatures/types, not full source (~90% reduction)',
  contextExclusion: 'Context Exclusion — auto-exclude lock files, dist/, node_modules from context',
  diffOnlyOutput: 'Diff-Only Output — produce patches instead of rewriting entire files (~92% reduction)',
  agentGuardrails: 'Agent Guardrails — prevent runaway retry loops and wasted token burns',
  smartModelRouting: 'Smart Model Routing — suggest cheaper models for trivial tasks (~80% cost savings)',
};

export const STRATEGY_CAP_LABELS: Record<string, string> = {
  codeGraph: 'CAP-1',
  outputCompression: 'CAP-2',
  verbosityControl: 'CAP-3',
  sessionManagement: 'CAP-4',
  semanticCache: 'CAP-5',
  astSkeleton: 'CAP-6',
  contextExclusion: 'CAP-7',
  diffOnlyOutput: 'CAP-8',
  agentGuardrails: 'CAP-9',
  smartModelRouting: 'CAP-10',
};

export const PROFILE_DESCRIPTIONS: Record<string, string> = {
  full: '$(zap) Full Optimization — all 10 TokenShield strategies active',
  debug: '$(bug) Debug Mode — output compression & diff-only disabled for full diagnostics',
  planning: '$(lightbulb) Planning Mode — verbosity & guardrails relaxed for deep architectural review',
  review: '$(eye) Review Mode — session clearing preserved for full historical context',
  custom: '$(gear) Custom — customized TokenShield strategy set',
};

export const DEFAULT_EXCLUSION_PATTERNS: Record<string, string[]> = {
  universal: [
    '*.lock',
    '*.min.js',
    '*.min.css',
    '*.map',
    '*.d.ts',
    '*.generated.*',
    'dist/**',
    'build/**',
    'coverage/**',
    '.git/**',
    'node_modules/**',
    '.next/**',
    '.nuxt/**',
    '__pycache__/**',
    '*.pyc',
    '*.pyo',
    'target/**',
    'vendor/**',
  ],
  node: [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.yarn/**',
  ],
  python: [
    'poetry.lock',
    'Pipfile.lock',
    '*.egg-info/**',
    '.venv/**',
    'venv/**',
  ],
  java: [
    '*.class',
    '*.jar',
    'gradle.lockfile',
    '.gradle/**',
  ],
  rust: [
    'Cargo.lock',
    'target/**',
  ],
  go: [
    'go.sum',
    'vendor/**',
  ],
};

export const LIGHTWEIGHT_TASK_PATTERNS = [
  'rename', 'format', 'lint', 'fix typo', 'add comment', 'update comment',
  'move file', 'delete file', 'import', 'export', 'boilerplate',
  'simple', 'trivial', 'quick', 'minor', 'docstring',
];

export const FULLPOWER_TASK_PATTERNS = [
  'architect', 'design', 'refactor', 'debug', 'security', 'performance',
  'optimize', 'review', 'analyze', 'complex', 'multi-file', 'migration',
  'concurrency', 'race condition', 'memory leak',
];
