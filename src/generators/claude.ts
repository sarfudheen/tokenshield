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
- Query codegraph_explore before broad grep searches.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### RTK Output Compression (CAP-2)
- Pipe command execution through rtk filters to minimize context consumption.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Verbosity Reduction (CAP-3: Caveman mode)
- Concise, dense output. Zero preambles or chit-chat.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Hygiene (CAP-4)
- Maintain tight session scope and avoid accumulating redundant conversation history.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Semantic Cache (CAP-5)
- Leverage token-cache MCP \`cache_lookup\` tool for identical or repeated questions.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- Call \`skeleton_view\` tool first when navigating large source files.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusion (CAP-7)
- Exclude build/dist artifacts, lockfiles, and minified files.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Diff Formatting (CAP-8)
- Always provide targeted unified diff chunks rather than full file rewrites.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Guardrails (CAP-9)
- Halt and ask user clarification after ${config.guardrails.maxRetries} failed attempts.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing (CAP-10)
- Recommend lightweight Claude models (Haiku) for boilerplate/trivial edits.`);
    }

    return `# TokenShield Directives for Claude Code

${MARKER_START}
${MARKER_COMMENT}

## Optimization Directives

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
