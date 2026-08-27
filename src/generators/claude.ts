import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, CLAUDE_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './engine';

export class ClaudeGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'claude';
  readonly relativePath = CLAUDE_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### Search Before Synthesize (CAP-1: CodeGraph)
- Use semantic indexing and graph symbols to navigate code before full reads.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### Output Compression (CAP-2: RTK)
- Use RTK CLI (rtk git, rtk pytest, rtk cargo test) to filter logs before sending to context.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Response Verbosity (CAP-3: Caveman — ${config.verbosityLevel} mode)
- Use /compact for routine tasks. Skip preambles and boilerplate explanations.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Session Hygiene (CAP-4)
- Use /clear on major task switches and /context to audit oversized context bloat.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Cache (CAP-5: token-cache MCP)
- Call \`cache_lookup\` for repeated/common questions before generating from model.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- Call \`skeleton_view\` to inspect type/signature summaries (~90% context savings).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- Exclude lock files (*.lock), minified code, and build artifacts from prompt context.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff-Only Edits (CAP-8)
- Output only unified diffs with ±3 context lines; never rewrite entire files.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Agent Loop Guardrails (CAP-9)
- Stop after ${config.guardrails.maxRetries} failed retries and request user input.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Model Routing (CAP-10)
- Use /model to downshift to lighter models (Haiku / Sonnet) for routine formatting and renames.`);
    }

    return `# Claude Code Optimization Rules

${MARKER_START}
${MARKER_COMMENT}

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
