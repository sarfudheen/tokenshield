import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, StrategyState, getEffectiveStrategies, TargetTool } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT } from '../core/constants';

export interface GenerationResult {
  target: TargetTool;
  filePath: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
}

export abstract class BaseInstructionGenerator {
  abstract readonly target: TargetTool;
  abstract readonly relativePath: string;

  abstract generateContent(strategies: StrategyState, config: ExtensionConfig): string;

  async generate(workspacePath: string, config: ExtensionConfig): Promise<GenerationResult> {
    const absPath = path.join(workspacePath, this.relativePath);
    const strategies = getEffectiveStrategies(config);
    const newContent = this.generateContent(strategies, config);

    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(absPath)) {
      fs.writeFileSync(absPath, newContent, 'utf-8');
      return { target: this.target, filePath: absPath, created: true, updated: false, skipped: false };
    }

    const existing = fs.readFileSync(absPath, 'utf-8');
    if (config.preserveExistingInstructions) {
      const merged = this.mergeContent(existing, newContent);
      if (merged === existing) {
        return { target: this.target, filePath: absPath, created: false, updated: false, skipped: true };
      }
      fs.writeFileSync(absPath, merged, 'utf-8');
      return { target: this.target, filePath: absPath, created: false, updated: true, skipped: false };
    }

    fs.writeFileSync(absPath, newContent, 'utf-8');
    return { target: this.target, filePath: absPath, created: false, updated: true, skipped: false };
  }

  async generateToStorage(storageDir: string, config: ExtensionConfig): Promise<GenerationResult> {
    const fileName = path.basename(this.relativePath);
    const absPath = path.join(storageDir, fileName);
    const strategies = getEffectiveStrategies(config);
    const newContent = this.generateContent(strategies, config);

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const existing = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '';
    if (existing === newContent) {
      return { target: this.target, filePath: absPath, created: false, updated: false, skipped: true };
    }

    fs.writeFileSync(absPath, newContent, 'utf-8');
    return { target: this.target, filePath: absPath, created: !existing, updated: !!existing, skipped: false };
  }

  protected mergeContent(existing: string, newOptimizationBlock: string): string {
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);
    const section = this.extractMarkedSection(newOptimizationBlock);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + MARKER_END.length);
      return before + section + after;
    }

    return existing.trimEnd() + '\n\n' + section + '\n';
  }

  private extractMarkedSection(content: string): string {
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      return content.substring(startIdx, endIdx + MARKER_END.length);
    }
    return `${MARKER_START}\n${MARKER_COMMENT}\n${content}\n${MARKER_END}`;
  }
}
