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
      sections.push(`### Search Before Synthesize (CAP-1: CodeGraph)
- Search the codebase for existing patterns and implementations before writing new code.
- Prefer semantic symbol queries over brute-force file grepping.`);
    }

    // CAP-2: Only inject RTK directive if rtk binary is actually available on the system.
    // Injecting it when RTK isn't installed causes Copilot to hallucinate non-existent commands.
    if (strategies.outputCompression) {
      const rtkInstalled = isBinaryAvailable('rtk');
      if (rtkInstalled) {
        sections.push(`### Concise CLI Output (CAP-2: RTK Compression)
- Use RTK commands (rtk git, rtk test, rtk ls) to compress CLI outputs by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.`);
      } else {
        sections.push(`### Concise CLI Output (CAP-2: Output Compression)
- Report only test failure details and status summaries — skip passing test lines.
- For git output: show only changed file names, not full diff unless explicitly requested.
- Compress build logs to error/warning counts, not full verbose stdout.`);
      }
    }

    if (strategies.verbosityControl) {
      const reduction = config.verbosityLevel === 'ultra' ? '50%' : config.verbosityLevel === 'light' ? '20%' : '35%';
      sections.push(`### Response Verbosity Control (CAP-3: Caveman — ${config.verbosityLevel} mode)
- Eliminate conversational preambles ("Sure!", "I can help with that", "Great question").
- Communicate code-first with direct answers. Target ~${reduction} reduction in response tokens.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Session Context Hygiene (CAP-4)
- Summarize previous state when switching tasks.
- Avoid re-reading recently inspected files within the same active session.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Answer Cache (CAP-5: token-cache MCP)
- Call the \`cache_lookup\` tool before answering repeat or boilerplate questions.
- If a valid non-stale hit is found, reuse the cached answer directly to save 100% of model tokens.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### Smart Context Pruning (CAP-6: AST Skeleton)
- When exploring unfamiliar files, call \`skeleton_view({ file: "path" })\` to get signatures, interfaces, and types.
- Request full source bodies only for the exact functions/methods you need to edit (~90% context savings).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- Lock files (*.lock, package-lock.json), minified bundles, build outputs, and sourcemaps are excluded from context.
- Never ingest or scan binary/lock files into your reasoning context.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff-Only Modifications (CAP-8)
- When modifying code, produce ONLY the changed lines in unified diff format with ±3 lines of context.
- NEVER reprint unmodified file contents (~92% output token savings).`);
    }

    if (strategies.agentGuardrails) {
      const g = config.guardrails;
      sections.push(`### Agent Loop Guardrails (CAP-9)
- Stop after ${g.maxRetries} failed retry attempts on the same task and explain the blocker.
- Do not inspect the same file more than ${g.maxFileReads} times per turn.
- If modifying more than ${g.maxFilesPerTask} files, pause and confirm with the user.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing (CAP-10)
- Lightweight tasks (renames, formatting, linting, docstrings): recommend fast/cost-effective models.
- Deep architectural, security, or complex debugging: preserve flagship reasoning models.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff-Scoped Context (CAP-11)
- When reviewing changes or writing feature tests, scope context to \`git diff\` output and 1-hop AST callers/callees.
- Do not ingest entire files when only the changed lines are relevant.`);
    }

    // CAP-12: Relabelled — clarify it is for API/agent-mode workflows, not native VS Code Copilot chat.
    if (strategies.kvCacheAlignment) {
      sections.push(`### Deterministic Prompt Prefix Caching (CAP-12: API/Agent Mode)
- *Applies when using raw API calls or custom agent frameworks (Cursor, custom scripts).*
- Keep system prompt and instruction blocks byte-identical across turns to maximise cloud KV-cache hits.
- Place stable context (instructions, project summary) before dynamic context (file content, user query).`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment & Header Stripping (CAP-13)
- Strip copyright headers, license preambles, and filler comments when including file content in context.
- Preserve doc-comments (JSDoc, docstrings) that describe behaviour — strip only noise.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Log Failure Isolation (CAP-14)
- Filter test runner output to failing assertions, expected vs actual diffs, and file:line references only.
- Never include passing test suite output — it contributes zero diagnostic signal.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Windowed Range Slicing (CAP-15)
- When navigating large files, read targeted 100-line windows around the relevant symbol.
- Avoid dumping entire files into context when only a function or class is needed.`);
    }

    // --- New CAPs ---

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope Pinning (CAP-16)
- When responding to an inline chat request, constrain your context to the **selected lines** and their direct symbol references only.
- Do not read or infer from unselected parts of the same file unless explicitly referenced.
- If the selection is ambiguous, ask for clarification rather than expanding scope.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore Context Blocking (CAP-17)
- A \`.copilotignore\` file is active in this project — respect its exclusion rules exactly like \`.gitignore\`.
- Never read, reference, or include content from ignored paths (build outputs, lock files, generated code, secrets).
- If a required file is excluded, surface the conflict rather than silently bypassing it.`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Copilot Edits Session Awareness (CAP-18)
- When operating in Copilot Edits (multi-file edit mode), treat all files already in the edit session as loaded — do not re-read them via tool calls.
- Propose changes as incremental edits to the open edit set, not full file rewrites.
- Close the edit session scope when the task is complete rather than leaving stale file handles open.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Thread Reset Trigger (CAP-19)
- When a conversation exceeds 40 messages or 30 minutes of elapsed time, proactively suggest: "This thread is getting long — starting a fresh chat will give me a clean context window and sharper answers."
- Do not silently degrade — surface the context saturation signal to the user.`);
    }

    return `# TokenShield Optimization Standards

${MARKER_START}
${MARKER_COMMENT}

## Active Optimization Directives

${sections.join('\n\n')}

## Diagnostic Exceptions
- Always show complete error traces and assertion messages when diagnosing test/build failures.
- Never compress security vulnerability findings or critical alerts.

${MARKER_END}
`;
  }
}
