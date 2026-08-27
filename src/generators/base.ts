import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { MARKER_START, MARKER_END, MARKER_COMMENT } from '../constants';
import { ExtensionConfig, getEffectiveStrategies, StrategyState } from '../config';

export interface GeneratorResult {
  filePath: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  reason?: string;
}

export abstract class BaseGenerator {
  protected abstract getRelativePath(): string;
  protected abstract generateContent(strategies: StrategyState, config: ExtensionConfig): string;

  async generate(workspaceFolder: vscode.WorkspaceFolder, config: ExtensionConfig): Promise<GeneratorResult> {
    const relativePath = this.getRelativePath();
    const absolutePath = path.join(workspaceFolder.uri.fsPath, relativePath);
    const strategies = getEffectiveStrategies(config);

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const newContent = this.generateContent(strategies, config);

    if (!fs.existsSync(absolutePath)) {
      fs.writeFileSync(absolutePath, newContent, 'utf-8');
      return { filePath: absolutePath, created: true, updated: false, skipped: false };
    }

    const existing = fs.readFileSync(absolutePath, 'utf-8');

    if (config.preserveExistingInstructions) {
      const merged = this.mergeContent(existing, newContent);
      if (merged === existing) {
        return { filePath: absolutePath, created: false, updated: false, skipped: true, reason: 'Content unchanged' };
      }
      fs.writeFileSync(absolutePath, merged, 'utf-8');
      return { filePath: absolutePath, created: false, updated: true, skipped: false };
    }

    fs.writeFileSync(absolutePath, newContent, 'utf-8');
    return { filePath: absolutePath, created: false, updated: true, skipped: false };
  }

  /**
   * Generate instructions to VS Code storage instead of project files.
   * Returns the path to the generated file.
   */
  async generateToStorage(storagePath: string, config: ExtensionConfig): Promise<GeneratorResult> {
    const strategies = getEffectiveStrategies(config);
    const newContent = this.generateContent(strategies, config);
    const filePath = path.join(storagePath, 'copilot-instructions.md');

    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    if (existing === newContent) {
      return { filePath, created: false, updated: false, skipped: true, reason: 'Content unchanged' };
    }

    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { filePath, created: !existing, updated: !!existing, skipped: false };
  }

  protected mergeContent(existing: string, newOptimizationBlock: string): string {
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    const optimizationSection = this.extractMarkedSection(newOptimizationBlock);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + MARKER_END.length);
      return before + optimizationSection + after;
    }

    return existing.trimEnd() + '\n\n' + optimizationSection + '\n';
  }

  private extractMarkedSection(content: string): string {
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      return content.substring(startIdx, endIdx + MARKER_END.length);
    }
    return `${MARKER_START}\n${MARKER_COMMENT}\n${content}\n${MARKER_END}`;
  }

  protected buildSections(strategies: StrategyState, config: ExtensionConfig): string[] {
    const sections: string[] = [];

    if (strategies.codeGraph) {
      sections.push(this.getCodeGraphSection());
    }
    if (strategies.outputCompression) {
      sections.push(this.getCompressionSection());
    }
    if (strategies.verbosityControl) {
      sections.push(this.getVerbositySection(config.verbosityLevel));
    }
    if (strategies.sessionManagement) {
      sections.push(this.getSessionSection());
    }
    if (strategies.semanticCache) {
      sections.push(this.getCacheSection());
    }
    // New strategies (CAP-6 – CAP-10)
    if (strategies.astSkeleton) {
      sections.push(this.getAstSkeletonSection());
    }
    if (strategies.contextExclusion) {
      sections.push(this.getContextExclusionSection());
    }
    if (strategies.diffOnlyOutput) {
      sections.push(this.getDiffOnlySection());
    }
    if (strategies.agentGuardrails) {
      sections.push(this.getGuardrailsSection(config));
    }
    if (strategies.smartModelRouting) {
      sections.push(this.getModelRoutingSection());
    }

    return sections;
  }

  // Original strategies (CAP-1 – CAP-5)
  protected abstract getCodeGraphSection(): string;
  protected abstract getCompressionSection(): string;
  protected abstract getVerbositySection(level: string): string;
  protected abstract getSessionSection(): string;
  protected abstract getCacheSection(): string;

  // New strategies (CAP-6 – CAP-10)
  protected abstract getAstSkeletonSection(): string;
  protected abstract getContextExclusionSection(): string;
  protected abstract getDiffOnlySection(): string;
  protected abstract getGuardrailsSection(config: ExtensionConfig): string;
  protected abstract getModelRoutingSection(): string;
}
