import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, COPILOT_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './engine';

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

    if (strategies.outputCompression) {
      sections.push(`### Concise CLI Output (CAP-2: RTK Compression)
- Use RTK commands (rtk git, rtk test, rtk ls) to compress CLI outputs by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.`);
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
      sections.push(`### Context Exclusion (CAP-7: CopilotIgnore)
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
