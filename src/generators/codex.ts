import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, CODEX_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator } from './engine';

export class CodexGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'codex';
  readonly relativePath = CODEX_INSTRUCTIONS_PATH;

  generateContent(strategies: StrategyState, config: ExtensionConfig): string {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(`### Search First (CAP-1)
- Query existing implementations by path before synthesizing new code.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### Output Compression (CAP-2)
- Summarize command output to errors and counts only.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Response Conciseness (CAP-3)
- Deliver concise code changes with minimal conversational framing.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Management (CAP-4)
- Keep active memory clean and trim stale conversation turns.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Cache (CAP-5)
- Leverage local cache MCP tools to serve repeated queries without model cost.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- Review signature skeletons before reading whole file bodies.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- Do not read lock files, build artifacts, or minified assets.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff-Only Changes (CAP-8)
- Generate target diff blocks rather than full-file code replacements.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Execution Limits (CAP-9)
- Cease execution after ${config.guardrails.maxRetries} consecutive failures.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Model Efficiency (CAP-10)
- Favor fast lightweight models for minor edits.`);
    }

    return `# OpenAI Codex Efficiency Guidelines

${MARKER_START}
${MARKER_COMMENT}

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
