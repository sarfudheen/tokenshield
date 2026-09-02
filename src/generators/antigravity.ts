import * as path from 'path';
import * as fs from 'fs';
import { TargetTool, StrategyState, ExtensionConfig } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT, ANTIGRAVITY_INSTRUCTIONS_PATH } from '../core/constants';
import { BaseInstructionGenerator, GenerationResult } from './base';

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
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Smart Context Exclusions
- **MANDATORY**: Exclude lock files (\`*.lock\`, \`package-lock.json\`), build outputs (\`dist/\`, \`build/\`), and minified assets.`);
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

# Antigravity TokenShield Optimizations

## Active Optimizations

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
