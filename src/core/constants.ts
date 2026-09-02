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
export const COPILOT_INSTRUCTIONS_SUBDIR_PATH = '.github/instructions/tokenshield.instructions.md';
export const COPILOT_PROJECT_INSTRUCTIONS_SUBDIR_PATH = '.github/instructions/copilot-instructions.md';
export const TOKENSHIELD_AGENT_PATH = '.github/agents/tokenshield.agent.md';
export const TOKENSHIELD_SKILL_PATH = '.github/skills/tokenshield-optimize/SKILL.md';
export const COPILOT_VSCODE_INSTRUCTIONS_PATH = '.vscode/copilot-instructions.md';
export const COPILOTIGNORE_PATH = '.copilotignore';
export const CLAUDE_INSTRUCTIONS_PATH = 'CLAUDE.md';
export const CODEX_INSTRUCTIONS_PATH = '.codex/instructions.md';
export const ANTIGRAVITY_INSTRUCTIONS_PATH = 'AGENTS.md';

export const MCP_CACHE_SERVER_NAME = 'token-cache';

export const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  codeGraph:               'CodeGraph Pre-Indexing — search symbol graphs instead of scanning whole files',
  outputCompression:       'CLI Output Compression — strip verbose boilerplate from terminal/test output',
  verbosityControl:        'Concise AI Responses — remove conversational filler and verbose greetings',
  sessionManagement:       'Context Compaction — prune stale turns and drop redundant tool output',
  semanticCache:           'Semantic Cache — instant zero-token answers for repeat queries from disk',
  astSkeleton:             'AST Skeletons — inspect type signatures without full implementation bodies',
  contextExclusion:        'Smart Context Exclusions — block lockfiles, dist folders, and minified bundles',
  diffOnlyOutput:          'Diff-Only Output — apply concise patches instead of rewriting whole files',
  agentGuardrails:         'Loop Guardrails — prevent runaway retry cycles and wasted token burn',
  smartModelRouting:       'Smart Model Routing — route routine edits to faster, cost-effective models',
  gitDiffContext:          'Git Diff Scoping — restrict review/test context to changed lines and callers',
  kvCacheAlignment:        'Prompt Prefix Caching — align stable system prompt prefixes for cloud KV caching',
  commentStripper:         'Comment & Header Stripping — strip license headers and filler comments on ingestion',
  testFailureIsolator:     'Test Failure Isolator — extract failing assertions and line numbers from test logs',
  rangeSlicing:            'Windowed Range Slicing — restrict file reads to 100-line windows around symbols',
  inlineChatScopePinning:  'Inline Chat Scope Lock — pin inline editor chat to active selection and 1-hop refs',
  copilotIgnoreGeneration: '.copilotignore Generator — create exclusion rules to block non-code noise',
  copilotEditsAwareness:   'Edit Session Awareness — avoid re-reading files already loaded in editor session',
  threadResetTrigger:      'Context Saturation Monitor — suggest fresh chat thread when context gets too long',
};

export const STRATEGY_CAP_LABELS: Record<string, string> = {
  codeGraph:               'CodeGraph',
  outputCompression:       'CLI Compression',
  verbosityControl:        'Concise Output',
  sessionManagement:       'Compaction',
  semanticCache:           'Semantic Cache',
  astSkeleton:             'AST Skeletons',
  contextExclusion:        'Exclusions',
  diffOnlyOutput:          'Diff Edits',
  agentGuardrails:         'Guardrails',
  smartModelRouting:       'Model Routing',
  gitDiffContext:          'Git Diff',
  kvCacheAlignment:        'Prefix Cache',
  commentStripper:         'Comment Stripper',
  testFailureIsolator:     'Test Isolator',
  rangeSlicing:            'Range Slicing',
  inlineChatScopePinning:  'Inline Scope',
  copilotIgnoreGeneration: '.copilotignore',
  copilotEditsAwareness:   'Edit Awareness',
  threadResetTrigger:      'Thread Reset',
};

import { TOTAL_STRATEGIES } from './config';

export const PROFILE_DESCRIPTIONS: Record<string, string> = {
  full: `$(zap) Full Optimization — all ${TOTAL_STRATEGIES} TokenShield strategies active`,
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
