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
      sections.push(`### CodeGraph Pre-Indexing (CAP-1)
- **MANDATORY**: Query \`codegraph_explore\` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.`);
    }

    if (strategies.outputCompression) {
      sections.push(`### RTK Command Output Filtering (CAP-2)
- **MANDATORY**: Execute shell commands through RTK filters (\`rtk git\`, \`rtk test\`, \`rtk ls\`).
- **FORBIDDEN**: Never invoke raw \`git\` commands directly in terminal.`);
    }

    if (strategies.verbosityControl) {
      sections.push(`### Dense Precision Output (CAP-3)
- **MANDATORY**: Answer directly with actionable diffs and zero pleasantries.
- **FORBIDDEN**: Never include preambles, intros, or chit-chat.`);
    }

    if (strategies.sessionManagement) {
      sections.push(`### Session Hygiene (CAP-4)
- **MANDATORY**: Keep task state concise and reuse loaded symbol memory.
- **FORBIDDEN**: Never re-read previously inspected files in the same turn.`);
    }

    if (strategies.semanticCache) {
      sections.push(`### Local MCP Semantic Cache (CAP-5)
- **MANDATORY**: Query \`cache_lookup\` tool for repeated/boilerplate answers.`);
    }

    if (strategies.astSkeleton) {
      sections.push(`### AST Skeleton Pruning (CAP-6)
- **MANDATORY**: Call \`skeleton_view\` MCP tool first when navigating files to load signatures only (~90% savings).
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.`);
    }

    if (strategies.contextExclusion) {
      sections.push(`### Context Exclusions (CAP-7)
- **MANDATORY**: Exclude lock files (\`*.lock\`, \`package-lock.json\`), build outputs (\`dist/\`, \`build/\`), and minified assets.`);
    }

    if (strategies.diffOnlyOutput) {
      sections.push(`### Unified Diff Formatting (CAP-8)
- **MANDATORY**: Always propose code edits as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified files or entire classes.`);
    }

    if (strategies.agentGuardrails) {
      sections.push(`### Autonomous Guardrails (CAP-9)
- **MANDATORY**: Abort retry cycles after ${config.guardrails.maxRetries} failures and summarize blocker.`);
    }

    if (strategies.smartModelRouting) {
      sections.push(`### Model Routing (CAP-10)
- Leverage fast Flash/Haiku models for simple non-reasoning steps.`);
    }

    if (strategies.gitDiffContext) {
      sections.push(`### Git Diff Context (CAP-11)
- **MANDATORY**: Scope review & test tasks strictly to \`git diff\` lines + 1-hop callers.`);
    }

    if (strategies.kvCacheAlignment) {
      sections.push(`### Deterministic Prompt Prefix Caching (CAP-12)
- Maintain stable instruction prefix order across turns to maximize KV cache hits.`);
    }

    if (strategies.commentStripper) {
      sections.push(`### Comment Stripping (CAP-13)
- Strip copyright headers and filler comments on ingestion.`);
    }

    if (strategies.testFailureIsolator) {
      sections.push(`### Test Log Isolation (CAP-14)
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.`);
    }

    if (strategies.rangeSlicing) {
      sections.push(`### Range Slicing (CAP-15)
- **MANDATORY**: Inspect 100-line windows around target symbols instead of full files.`);
    }

    if (strategies.inlineChatScopePinning) {
      sections.push(`### Inline Chat Scope (CAP-16)
- **MANDATORY**: Restrict context to selected editor lines and direct references.`);
    }

    if (strategies.copilotIgnoreGeneration) {
      sections.push(`### .copilotignore Compliance (CAP-17)
- **MANDATORY**: Never read or reference ignored paths.`);
    }

    if (strategies.copilotEditsAwareness) {
      sections.push(`### Edit Session Awareness (CAP-18)
- **MANDATORY**: Do not re-read files already open in the active edit session.`);
    }

    if (strategies.threadResetTrigger) {
      sections.push(`### Thread Reset Trigger (CAP-19)
- Surface a fresh-thread prompt when conversation exceeds 40 messages.`);
    }

    return `${MARKER_START}
${MARKER_COMMENT}

# Antigravity TokenShield Directives

## Active Directives

${sections.join('\n\n')}

${MARKER_END}
`;
  }
}
