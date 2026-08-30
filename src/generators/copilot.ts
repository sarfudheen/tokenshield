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
      sections.push(`### Code Search & Navigation (CAP-1: CodeGraph)
- **MANDATORY**: When locating symbols, callers, or implementations, ALWAYS query CodeGraph (\`codegraph_explore\` or \`codegraph\`) before grepping.
- **FORBIDDEN**: NEVER perform brute-force directory grep searches when CodeGraph semantic indexing is available.`);
    }

    // CAP-2: Only inject RTK directive if rtk binary is actually available on the system.
    if (strategies.outputCompression) {
      const rtkInstalled = isBinaryAvailable('rtk');
      if (rtkInstalled) {
        sections.push(`### Mandatory CLI Execution: RTK Proxy (CAP-2: RTK Compression)
- **MANDATORY**: When proposing or running terminal commands for \`git\`, \`test\`, \`build\`, \`ls\`, or \`grep\`, ALWAYS prefix them with \`rtk\` (e.g. \`rtk git status\`, \`rtk git diff\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: NEVER execute or propose raw \`git\` commands (\`git status\`, \`git diff\`, \`git log\`) directly in terminal. Always route through \`rtk git <cmd>\` to compress token output by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.`);
      } else {
        sections.push(`### Mandatory CLI Output Compression (CAP-2: Output Compression)
- **MANDATORY**: Report only test failure details and status summaries — skip passing test lines.
- **FORBIDDEN**: NEVER run full verbose test suites or print entire git diffs into prompt context without range limits.`);
      }
    }

    if (strategies.verbosityControl) {
      const reduction = config.verbosityLevel === 'ultra' ? '50%' : config.verbosityLevel === 'light' ? '20%' : '35%';
      sections.push(`### Response Verbosity Control (CAP-3: Caveman — ${config.verbosityLevel} mode)
- **MANDATORY**: Answer code-first and immediately. Provide dense, direct solutions targeting ~${reduction} response token reduction.
- **FORBIDDEN**: NEVER output conversational preambles ("Sure!", "I can help with that", "Great question", "Certainly!"), recap summaries, or conversational sign-offs.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Session Context Hygiene (CAP-4)
- **MANDATORY**: Reuse previously loaded symbols from working memory. Keep state summaries minimal when switching tasks.
- **FORBIDDEN**: NEVER re-read or re-fetch files already inspected in the active turn or session.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Answer Cache (CAP-5: token-cache MCP)
- **MANDATORY**: For boilerplate, configuration, or repeat questions, ALWAYS invoke \`cache_lookup\` before generating an answer.
- **FORBIDDEN**: NEVER query the full model if a valid cached response is available locally (100% token savings).`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### Smart Context Pruning (CAP-6: AST Skeleton)
- **MANDATORY**: When exploring unfamiliar or large files (>100 lines), ALWAYS invoke \`skeleton_view({ file: "path" })\` first to inspect signatures, interfaces, and types.
- **FORBIDDEN**: NEVER ingest full implementation bodies unless you are directly editing that exact function (~90% context savings).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- **MANDATORY**: Respect all active exclusion filters (\`.copilotignore\`, \`settings.json\`).
- **FORBIDDEN**: NEVER ingest, scan, or reference lock files (\`*.lock\`, \`package-lock.json\`), minified bundles, build outputs (\`dist/\`, \`target/\`), or sourcemaps.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff-Only Modifications (CAP-8)
- **MANDATORY**: Always propose code modifications strictly as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: NEVER reprint full, unmodified source files or classes (~92% output token savings).`);
    }

    if (strategies.agentGuardrails) {
      const g = config.guardrails;
      sections.push(`### Agent Loop Guardrails (CAP-9)
- **MANDATORY**: Halt execution after ${g.maxRetries} failed retry attempts on the same task and explain the blocker.
- **FORBIDDEN**: NEVER enter infinite retry loops or inspect the same file more than ${g.maxFileReads} times per turn.
- If modifying more than ${g.maxFilesPerTask} files, pause and confirm with the user.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing (CAP-10)
- **MANDATORY**: For lightweight tasks (renames, formatting, linting, docstrings), suggest fast/cost-effective models.
- Preserve flagship reasoning models exclusively for deep architectural or complex debugging tasks.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff-Scoped Context (CAP-11)
- **MANDATORY**: Scope review, PR analysis, and test writing strictly to \`git diff\` output and direct 1-hop AST callers/callees.
- **FORBIDDEN**: NEVER ingest entire files when only the changed lines are relevant.`);
    }

    if (strategies.kvCacheAlignment) {
      sections.push(`### Deterministic Prompt Prefix Caching (CAP-12: API/Agent Mode)
- *Applies when using raw API calls or custom agent frameworks (Cursor, custom scripts).*
- Keep system prompt and instruction blocks byte-identical across turns to maximise cloud KV-cache hits.
- Place stable context (instructions, project summary) before dynamic context (file content, user query).`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment & Header Stripping (CAP-13)
- **MANDATORY**: Strip license preambles, copyright headers, and filler comments when ingesting code into prompt context.
- Preserve doc-comments (JSDoc, docstrings) that describe runtime behavior.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Log Failure Isolation (CAP-14)
- **MANDATORY**: When reporting test execution results, output ONLY failing assertions, error stacks, and file:line locations.
- **FORBIDDEN**: NEVER include passing test suite lines or full raw stdout in context.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Windowed Range Slicing (CAP-15)
- **MANDATORY**: Read targeted 100-line windows around the exact symbol you are modifying.
- **FORBIDDEN**: NEVER dump entire 500+ line files into context when only a function or class is needed.`);
    }

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope Pinning (CAP-16)
- **MANDATORY**: Constrain inline chat context strictly to the selected lines and their direct symbol references.
- **FORBIDDEN**: NEVER read or infer from unselected parts of the file unless explicitly referenced.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore Context Blocking (CAP-17)
- **MANDATORY**: Strictly respect \`.copilotignore\` exclusion rules exactly like \`.gitignore\`.
- **FORBIDDEN**: NEVER read, reference, or include content from ignored paths (build outputs, lock files, secrets).`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Copilot Edits Session Awareness (CAP-18)
- **MANDATORY**: Treat all files currently open in a Copilot Edits session as already loaded.
- **FORBIDDEN**: NEVER re-read active edit session files via secondary tool calls. Propose incremental edits only.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Thread Reset Trigger (CAP-19)
- **MANDATORY**: When a conversation exceeds 40 messages or 30 minutes, proactively advise the user to start a fresh chat thread to prevent context saturation.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# TokenShield Optimization Standards

## Active Optimization Directives

${sections.join('\n\n')}

## Diagnostic Exceptions
- Always show complete error traces and assertion messages when diagnosing test/build failures.
- Never compress security vulnerability findings or critical alerts.

${MARKER_END}
`;
  }
}
