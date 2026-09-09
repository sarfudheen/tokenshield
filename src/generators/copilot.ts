import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, COPILOT_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './base';
import { isBinaryAvailable } from '../installer/installer';
import { isHeadroomSdkAvailable } from '../strategies/adaptivePruner';

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

    // AST Skeleton: PREFERRED instead of FORBIDDEN — merged with rangeSlicing hint
    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (skeleton_view MCP)
- **MANDATORY**: When exploring unfamiliar or large files (>100 lines), ALWAYS invoke \`skeleton_view({ file: "path" })\` first to inspect signatures, interfaces, and types.
- **PREFERRED**: Avoid ingesting full implementation bodies unless you are directly editing that exact function or need to understand call-site logic (~90% context savings).${strategies.rangeSlicing ? '\n- When full file reads are needed, restrict to 100-line windows around target symbols.' : ''}`);
    }

    // Context Exclusion: merged with .copilotignore hint
    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Automatically omit lock files (\`package-lock.json\`, \`yarn.lock\`, \`pnpm-lock.yaml\`), build outputs (\`dist/\`, \`build/\`, \`.next/\`, \`out/\`), minified files (\`*.min.js\`, \`*.bundle.js\`), and binary files from prompt context.${strategies.copilotIgnoreGeneration ? '\n- Enforce `.copilotignore` patterns to block build outputs, secrets, and non-source artifacts from AI context.' : ''}`);
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
- **MANDATORY**: Maintain a deterministic, byte-stable instruction prefix across turns to maximize cloud KV-cache hit rates (75–90% cost savings).
- **MANDATORY**: Sink ephemeral turn metadata (timestamps, turn counters, run UUIDs) to the very bottom of the prompt suffix. Never prepend dynamic tokens before static rules.`);
    }

    // Comment stripping: respects commentStrippingMode setting
    if (strategies.commentStripper) {
      if (config.commentStrippingMode === 'aggressive') {
        sections.push(`### Comment & Header Stripping
- Automatically strip copyright license headers and low-signal comments before ingesting files into context.`);
      } else if (config.commentStrippingMode !== 'off') {
        sections.push(`### License Header Stripping
- Strip copyright license headers and preamble blocks before ingesting files. Preserve inline comments (they aid comprehension).`);
      }
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Failure Isolator
- When executing test suites, filter terminal output to include ONLY failing assertion lines, file names, and stack traces. Omit passing tests.`);
    }

    // rangeSlicing is now merged into astSkeleton directive above
    // inlineChatScopePinning removed: VS Code already handles this natively
    // copilotIgnoreGeneration is now merged into contextExclusion directive above
    // copilotEditsAwareness removed: all modern agents avoid re-reading open files
    // threadResetTrigger removed: agent hosts handle context limits

    // Headroom: only emit directive if SDK is actually available
    if (strategies.headroomCompression && isHeadroomSdkAvailable()) {
      sections.push(`### Headroom Context Compression (CCR & SmartCrusher)
- **MANDATORY**: For bulky tool outputs, API responses, or JSON data (>50 items), apply Headroom context compression or SmartCrusher schema compaction before injecting into prompt.
- Use \`headroom_retrieve\` whenever precise uncompressed segments are required.
- **FORBIDDEN**: NEVER flood context with uncompressed raw JSON logs or multi-megabyte trace dumps.`);
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
