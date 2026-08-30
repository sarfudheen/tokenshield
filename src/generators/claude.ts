import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, CLAUDE_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './base';

export class ClaudeGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'claude';
  readonly relativePath = CLAUDE_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### CodeGraph Pre-Indexing (CAP-1)
- **MANDATORY**: Query \`codegraph_explore\` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### RTK Output Compression (CAP-2)
- **MANDATORY**: Pipe shell executions through \`rtk\` filters (\`rtk git\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: Never run raw \`git\` commands directly in terminal.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Verbosity Reduction (CAP-3: Caveman mode)
- **MANDATORY**: Answer code-first and densely. Zero preambles, summaries, or conversational sign-offs.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Hygiene (CAP-4)
- **MANDATORY**: Maintain tight session scope. Never re-read previously inspected files in the same turn.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Cache (CAP-5)
- **MANDATORY**: Query \`cache_lookup\` tool for repeated/boilerplate questions before generating new tokens.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- **MANDATORY**: Call \`skeleton_view\` tool first when navigating large source files (>100 lines).
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them (~90% context reduction).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- **MANDATORY**: Exclude build/dist artifacts, lockfiles, and minified bundles.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff Formatting (CAP-8)
- **MANDATORY**: Always provide targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified source files or entire classes.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Guardrails (CAP-9)
- **MANDATORY**: Halt and ask user clarification after ${config.guardrails.maxRetries} failed attempts.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing (CAP-10)
- Recommend lightweight Claude models (Haiku) for boilerplate/trivial edits.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff Context (CAP-11)
- **MANDATORY**: Scope review & test tasks strictly to \`git diff\` lines + 1-hop callers.`);
    }

    if (strategies.kvCacheAlignment) {
      sections.push(`### Deterministic Prefix Caching (CAP-12)
- Maintain stable instruction prefix order across turns to maximize KV cache hits.`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment Stripping (CAP-13)
- Strip copyright headers and filler comments on ingestion.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Log Isolation (CAP-14)
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Range Slicing (CAP-15)
- **MANDATORY**: Inspect 100-line windows around target symbols instead of full files.`);
    }

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope (CAP-16)
- **MANDATORY**: Restrict context to selected editor lines and direct references.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore Compliance (CAP-17)
- **MANDATORY**: Never read or reference ignored paths.`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Edit Session Awareness (CAP-18)
- **MANDATORY**: Do not re-read files already open in the active edit session.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Thread Reset Trigger (CAP-19)
- Surface a fresh-thread prompt when conversation exceeds 40 messages.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# TokenShield Directives for Claude Code

## Optimization Directives

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
