import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, CLAUDE_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './base';
import { isHeadroomSdkAvailable } from '../strategies/adaptivePruner';

export class ClaudeGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'claude';
  readonly relativePath = CLAUDE_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### CodeGraph Pre-Indexing
- **MANDATORY**: Query \`codegraph_explore\` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### CLI Output Compression (RTK)
- **MANDATORY**: Pipe shell executions through \`rtk\` filters (\`rtk git\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: Never run raw \`git\` commands directly in terminal.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Concise Direct Responses
- **MANDATORY**: Answer code-first and densely. Zero preambles, summaries, or conversational sign-offs.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Compaction & Session Hygiene
- **MANDATORY**: Maintain tight session scope. Never re-read previously inspected files in the same turn.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local Semantic Cache
- **MANDATORY**: Query \`cache_lookup\` tool for repeated/boilerplate questions before generating new tokens.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning
- **MANDATORY**: Call \`skeleton_view\` tool first when navigating large source files (>100 lines).
- **PREFERRED**: Avoid ingesting full function bodies unless actively modifying them or tracing call-site logic (~90% context reduction).${strategies.rangeSlicing ? '\n- When full reads are needed, restrict to 100-line windows around target symbols.' : ''}`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Exclude build/dist artifacts, lockfiles, and minified bundles.${strategies.copilotIgnoreGeneration ? '\n- Enforce `.copilotignore` patterns to block non-source artifacts from AI context.' : ''}`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Unified Diff Formatting
- **MANDATORY**: Always provide targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified source files or entire classes.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Loop Guardrails
- **MANDATORY**: Halt and ask user clarification after ${config.guardrails.maxRetries} failed attempts.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing
- Recommend lightweight Claude models (Haiku) for boilerplate/trivial edits.`);
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
      if (config.commentStrippingMode === 'aggressive') {
        sections.push(`### Comment & Header Stripping
- Strip copyright headers and filler comments on ingestion.`);
      } else if (config.commentStrippingMode !== 'off') {
        sections.push(`### License Header Stripping
- Strip copyright license headers and preamble blocks. Preserve inline comments.`);
      }
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Failure Log Isolation
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.`);
    }

    // rangeSlicing merged into astSkeleton above
    // inlineChatScopePinning removed: VS Code handles natively
    // copilotIgnoreGeneration merged into contextExclusion above
    // copilotEditsAwareness removed: modern agents already do this
    // threadResetTrigger removed: agent hosts handle context limits

    if (strategies.headroomCompression && isHeadroomSdkAvailable()) {
      sections.push(`### Headroom Reversible CCR & SmartCrusher
- **MANDATORY**: Route bulky bash/tool/JSON outputs through Headroom compression; fetch original chunks via \`headroom_retrieve\`.
- **FORBIDDEN**: Never output or inspect uncompressed JSON traces exceeding 50 items.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# TokenShield Optimizations for Claude Code

## Active Optimizations

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
