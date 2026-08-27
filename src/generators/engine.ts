import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, StrategyState, getEffectiveStrategies, TargetTool } from '../core/config';
import { MARKER_START, MARKER_END, MARKER_COMMENT } from '../core/constants';
import { CopilotGenerator } from './copilot';
import { ClaudeGenerator } from './claude';
import { CodexGenerator } from './codex';
import { AntigravityGenerator } from './antigravity';

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

export class InstructionEngine {
  private generators: Map<TargetTool, BaseInstructionGenerator> = new Map();

  constructor() {
    const copilot = new CopilotGenerator();
    const claude = new ClaudeGenerator();
    const codex = new CodexGenerator();
    const antigravity = new AntigravityGenerator();

    this.generators.set('copilot', copilot);
    this.generators.set('claude', claude);
    this.generators.set('codex', codex);
    this.generators.set('antigravity', antigravity);
  }

  async generateAll(config: ExtensionConfig): Promise<GenerationResult[]> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) { return []; }

    const wsPath = wsFolders[0].uri.fsPath;
    const results: GenerationResult[] = [];

    if (config.useVscodeStorage) {
      // Storage mode: write to .vscode/ to avoid committing into repository git history
      const storageDir = path.join(wsPath, '.vscode');
      const gen = this.generators.get('copilot');
      if (gen) {
        const res = await gen.generateToStorage(storageDir, config);
        results.push(res);
      }

      // Link in workspace settings
      try {
        const wsConfig = vscode.workspace.getConfiguration('', wsFolders[0].uri);
        const rel = '.vscode/copilot-instructions.md';
        const existing = wsConfig.get<any[]>('github.copilot.chat.codeGeneration.instructions') || [];
        const hasEntry = existing.some(e => typeof e === 'object' && e.file?.includes('copilot-instructions.md'));
        if (!hasEntry) {
          await wsConfig.update(
            'github.copilot.chat.codeGeneration.instructions',
            [...existing, { file: rel }],
            vscode.ConfigurationTarget.Workspace
          );
        }
      } catch { /* ignore */ }
    } else {
      // Project files mode
      for (const tool of config.targetTools) {
        const gen = this.generators.get(tool);
        if (gen) {
          const res = await gen.generate(wsPath, config);
          results.push(res);
        }
      }
    }

    return results;
  }

  async exportToRepo(config: ExtensionConfig): Promise<GenerationResult[]> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) { return []; }

    const wsPath = wsFolders[0].uri.fsPath;
    const results: GenerationResult[] = [];

    for (const tool of config.targetTools) {
      const gen = this.generators.get(tool);
      if (gen) {
        const res = await gen.generate(wsPath, config);
        results.push(res);
      }
    }

    return results;
  }
}
