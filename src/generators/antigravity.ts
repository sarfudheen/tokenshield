import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, ANTIGRAVITY_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './engine';

export class AntigravityGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'antigravity';
  readonly relativePath = ANTIGRAVITY_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### CodeGraph Pre-Indexing (CAP-1)
- Query codegraph_explore / graph index before running wide grep searches.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### RTK Command Output Filtering (CAP-2)
- Execute shell tasks through RTK filters when running tests or git inspections.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Dense Precision Output (CAP-3)
- Answer directly with actionable diffs and zero pleasantries.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Session Hygiene (CAP-4)
- Keep task state concise and avoid repeated context accumulation.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local MCP Semantic Cache (CAP-5)
- Query token-cache tool \`cache_lookup\` to reuse proven answers.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- Call \`skeleton_view\` tool first when navigating repository files.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusions (CAP-7)
- Exclude generated assets, lockfiles, and bundle artifacts.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Unified Diff Formatting (CAP-8)
- Always propose edits as unified diff chunks with line context.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Guardrails (CAP-9)
- Abort infinite retry cycles after ${config.guardrails.maxRetries} failures.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Model Routing (CAP-10)
- Leverage fast Flash/Haiku models for simple non-reasoning steps.`);
    }

    return `# Antigravity Agent Guidelines

${MARKER_START}
${MARKER_COMMENT}

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
