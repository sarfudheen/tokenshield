import * as path from 'path';
import * as fs from 'fs';
import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, ANTIGRAVITY_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator, GenerationResult } from './base';
import { isHeadroomSdkAvailable } from '../strategies/adaptivePruner';

export class AntigravityGenerator extends BaseInstructionGenerator {
  readonly target: TargetTool = 'antigravity';
  readonly relativePath = ANTIGRAVITY_INSTRUCTIONS_PATH;

  override async generate(workspacePath: string, config: ExtensionConfig): Promise<GenerationResult> {
    const mainResult = await super.generate(workspacePath, config);

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
      sections.push(`### CodeGraph Pre-Indexing
- **MANDATORY**: Query \`codegraph_explore\` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### CLI Output Compression (RTK)
- **MANDATORY**: Execute shell commands through RTK filters (\`rtk git\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: Never invoke raw \`git\` commands directly in terminal.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Concise Direct Responses
- **MANDATORY**: Answer directly with actionable diffs and zero pleasantries.
- **FORBIDDEN**: Never include preambles, intros, or chit-chat.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Context Compaction & Session Hygiene
- **MANDATORY**: Keep task state concise and reuse loaded symbol memory.
- **FORBIDDEN**: Never re-read previously inspected files in the same turn.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local Semantic Cache
- **MANDATORY**: Query \`cache_lookup\` tool for repeated/boilerplate answers.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning
- **MANDATORY**: Call \`skeleton_view\` MCP tool first when navigating files to load signatures only (~90% savings).
- **PREFERRED**: Avoid ingesting full function bodies unless actively modifying them or tracing call-site logic.${strategies.rangeSlicing ? '\n- When full reads are needed, restrict to 100-line windows around target symbols.' : ''}`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Exclude lock files (\`*.lock\`, \`package-lock.json\`), build outputs (\`dist/\`, \`build/\`), and minified assets.${strategies.copilotIgnoreGeneration ? '\n- Enforce `.copilotignore` patterns to block non-source artifacts from AI context.' : ''}`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Unified Diff Formatting
- **MANDATORY**: Always propose code edits as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified files or entire classes.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Loop Guardrails
- **MANDATORY**: Abort retry cycles after ${config.guardrails.maxRetries} failures and summarize blocker.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Smart Model Routing
- Leverage fast Flash/Haiku models for simple non-reasoning steps.`);
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
- **MANDATORY**: Use Headroom context compression on bulky JSON/trace tool outputs; retrieve uncompressed sections via \`headroom_retrieve\`.
- **FORBIDDEN**: Never ingest raw JSON dumps >50 items without schema compaction.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# Antigravity TokenShield Optimizations

## Active Optimizations

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
