import * as path from 'path';
import * as fs from 'fs';
import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, ANTIGRAVITY_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator, GenerationResult } from './engine';

export class AntigravityGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'antigravity';
  readonly relativePath = ANTIGRAVITY_INSTRUCTIONS_PATH;

  override async generate(workspacePath: string, config: ExtensionConfig): Promise<GenerationResult> {
    const mainResult = await super.generate(workspacePath, config);

    // Also write to .agents/rules/tokenshield.md for deep Antigravity integration
    try {
      const agentsRulesDir = path.join(workspacePath, '.agents', 'rules');
      if (!fs.existsSync(agentsRulesDir)) {
        fs.mkdirSync(agentsRulesDir, { recursive: true });
      }
      const rulePath = path.join(agentsRulesDir, 'tokenshield.md');
      const content = this.generateContent(config.activeStrategies, config);
      fs.writeFileSync(rulePath, content, 'utf-8');
    } catch { /* ignore */ }

    return mainResult;
  }

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
- Query token-cache tool \`cache_lookup\` to reuse proven answers from local disk.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- Call \`skeleton_view\` MCP tool first when navigating repository files to load signatures only (~90% savings).`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusions (CAP-7)
- Exclude generated assets, lockfiles (*.lock, package-lock.json), and bundle artifacts (dist/, build/) from context.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Unified Diff Formatting (CAP-8)
- Always propose code edits as targeted unified diff chunks with line context.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Guardrails (CAP-9)
- Abort infinite retry cycles after ${config.guardrails.maxRetries} failures and summarize blocker.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Model Routing (CAP-10)
- Leverage fast Flash/Haiku models for simple non-reasoning steps.`);
    }

    return `# Antigravity TokenShield Directives

${MARKER_START}
${MARKER_COMMENT}

## Active Directives

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
