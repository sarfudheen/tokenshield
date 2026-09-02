import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, COPILOT_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './base';
import { isBinaryAvailable } from '../installer/installer';

export class CopilotGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'copilot';
  readonly relativePath = COPILOT_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### Code Search & Navigation (CodeGraph)
- **MANDATORY**: When locating symbols, callers, or implementations, ALWAYS query CodeGraph (\`codegraph_explore\` or \`codegraph\`) before grepping.
- **FORBIDDEN**: NEVER perform brute-force directory grep searches when CodeGraph semantic indexing is available.`);
    }

    if (strategies.outputCompression) {
      const rtkInstalled = isBinaryAvailable('rtk');
      if (rtkInstalled) {
        sections.push(`### CLI Output Compression (RTK)
- **MANDATORY**: When proposing or running terminal commands for \`git\`, \`test\`, \`build\`, \`ls\`, or \`grep\`, ALWAYS prefix them with \`rtk\` (e.g. \`rtk git status\`, \`rtk git diff\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: NEVER execute or propose raw \`git\` commands (\`git status\`, \`git diff\`, \`git log\`) directly in terminal. Always route through \`rtk git <cmd>\` to compress token output by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.`);
      } else {
        sections.push(`### CLI Output Compression
- **MANDATORY**: Report only test failure details and status summaries — skip passing test lines.
- **FORBIDDEN**: NEVER run full verbose test suites or print entire git diffs into prompt context without range limits.`);
      }
    }

    if (strategies.verbosityControl) {
      const reduction = config.verbosityLevel === 'ultra' ? '50%' : config.verbosityLevel === 'light' ? '20%' : '35%';
      sections.push(`### Concise Direct Responses (${config.verbosityLevel} mode)
- **MANDATORY**: Answer code-first and immediately. Provide dense, direct solutions targeting ~${reduction} response token reduction.
- **FORBIDDEN**: NEVER output conversational preambles ("Sure!", "I can help with that", "Great question", "Certainly!"), recap summaries, or conversational sign-offs.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Compaction & Session Hygiene
- **MANDATORY**: Reuse previously loaded symbols from working memory. Keep state summaries minimal when switching tasks.
- **FORBIDDEN**: NEVER re-read or re-fetch files already inspected in the active turn or session.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local Semantic Cache (token-cache MCP)
- **MANDATORY**: For boilerplate, configuration, or repeat questions, ALWAYS invoke \`cache_lookup\` before generating an answer.
- **FORBIDDEN**: NEVER query the full model if a valid cached response is available locally (100% token savings).`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (skeleton_view MCP)
- **MANDATORY**: When exploring unfamiliar or large files (>100 lines), ALWAYS invoke \`skeleton_view({ file: "path" })\` first to inspect signatures, interfaces, and types.
- **FORBIDDEN**: NEVER ingest full implementation bodies unless you are directly editing that exact function (~90% context savings).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Automatically omit lock files (\`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`), build outputs (\`dist/\`, \`build/\`, \`.next/\`, \`out/\`), minified files (\`*.min.js\`, \`*.bundle.js\`), and binary files from prompt context.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff-Only Modifications
- **MANDATORY**: For file edits, ALWAYS output changes as targeted unified diffs or focused modification blocks with ±3 lines of context.
- **FORBIDDEN**: NEVER rewrite or reprint entire unmodified files or whole classes (~92% output token savings).`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Loop Guardrails
- **MANDATORY**: Abort and pause for user input if a tool or command fails ${config.guardrails.maxRetries} times in succession.
- NEVER exceed ${config.guardrails.maxFilesPerTask} file modifications in a single autonomous task without asking confirmation.
- NEVER read the same file more than ${config.guardrails.maxFileReads} times in a single conversation.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing
- When generating suggestions for minor edits, documentation comments, or commit messages, recommend using fast/lightweight models (e.g. Gemini 2.0 Flash, Claude Haiku, GPT-4o-mini) to save ~80% inference cost.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff Scoping
- **MANDATORY**: When reviewing code, generating pull request summaries, or writing tests, scope file context strictly to lines changed in \`git diff\` plus direct 1-hop AST callers/callees.`);
    }

    if (strategies.kvCacheAlignment) {
      sections.push(`### Prompt Prefix Caching
- Maintain a deterministic, unchanging instruction prefix order across turns to maximize cloud KV-cache hit rates.`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment & Header Stripping
- Automatically strip copyright license headers and low-signal comments before ingesting files into context.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Failure Isolator
- When executing test suites, filter terminal output to include ONLY failing assertion lines, file names, and stack traces. Omit passing tests.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Windowed Range Slicing
- When inspecting large source files, restrict reads to 100-line windows around target symbols instead of loading the entire file.`);
    }

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope Pinning
- Restrict VS Code inline chat context strictly to currently selected lines and their immediate 1-hop symbol references.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore File Rules
- Enforce \`.copilotignore\` patterns to block build outputs, secrets, environment files, and non-source artifacts from AI context.`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Edit Session Awareness
- Avoid re-reading or re-inspecting files that are already open and dirty in the active multi-file edit session.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Context Saturation Thread Reset
- When a chat session exceeds 40 conversation turns, surface a clear recommendation to start a fresh chat thread to avoid attention degradation.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# TokenShield Optimization Directives

## Active Optimizations

${sections.join('\n\n')}

## Diagnostic Exceptions
- Always show complete error traces and assertion messages when diagnosing test/build failures.
- Never compress security vulnerability findings or critical alerts.

${MARKER_END}
`;
  }
}
