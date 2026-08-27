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
- Search symbol graphs before reading files.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### RTK Compression
- Use compressed terminal output.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Precision Output
- Return code only with minimal prose.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local Cache
- Query semantic cache MCP before regenerating answers.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeletons
- Use \`skeleton_view\` to inspect type definitions and structure.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff Edits
- Propose edits strictly as diffs.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Guardrails
- Limit consecutive retries to ${config.guardrails.maxRetries}.`);
    }

    return `# OpenAI Codex Guidelines

${MARKER_START}
${MARKER_COMMENT}

## Active Directives

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
