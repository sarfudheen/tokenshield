import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, CODEX_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './base';

export class CodexGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'codex';
  readonly relativePath = CODEX_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### CodeGraph Search
- **MANDATORY**: Query \`codegraph_explore\` before reading files.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### CLI Output Compression (RTK)
- **MANDATORY**: Pipe shell executions through \`rtk\` filters (\`rtk git\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: Never run raw \`git\` commands directly in terminal.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Concise Direct Responses
- **MANDATORY**: Return code and diffs directly with zero pleasantries or summaries.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Compaction & Session Hygiene
- **MANDATORY**: Avoid re-reading recently inspected files in the same turn.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local Semantic Cache
- **MANDATORY**: Query \`cache_lookup\` tool before answering repeat/boilerplate questions.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning
- **MANDATORY**: Use \`skeleton_view\` to inspect type definitions and structure.
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Exclude build/dist artifacts, lockfiles, and minified bundles.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff Edits
- **MANDATORY**: Propose edits strictly as targeted unified diff chunks.
- **FORBIDDEN**: Never reprint unmodified source files.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Loop Guardrails
- **MANDATORY**: Limit consecutive retries to ${config.guardrails.maxRetries} and summarize blocker.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing
- Suggest lightweight models for boilerplate/formatting edits.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff Context Scoping
- **MANDATORY**: Scope review & test tasks strictly to \`git diff\` lines + 1-hop callers.`);
    }

    if (strategies.kvCacheAlignment) {
      sections.push(`### Deterministic Prefix Caching
- Maintain stable instruction prefix order across turns to maximize KV cache hits.`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment & Header Stripping
- Strip copyright headers and filler comments on ingestion.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Failure Log Isolation
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Windowed Range Slicing
- **MANDATORY**: Inspect 100-line windows around target symbols instead of full files.`);
    }

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope Pinning
- **MANDATORY**: Restrict context to selected editor lines and direct references.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore Compliance
- **MANDATORY**: Never read or reference ignored paths.`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Edit Session Awareness
- **MANDATORY**: Do not re-read files already open in the active edit session.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Context Saturation Thread Reset
- Surface a fresh-thread prompt when conversation exceeds 40 messages.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# OpenAI Codex Guidelines

## Active Optimizations

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
