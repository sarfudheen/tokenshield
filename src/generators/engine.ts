import * as vscode from 'vscode';
import * as path from 'path';
import { ExtensionConfig } from '../core/config';
import { BaseInstructionGenerator, GenerationResult } from './base';
import { CopilotGenerator } from './copilot';
import { ClaudeGenerator } from './claude';
import { CodexGenerator } from './codex';
import { AntigravityGenerator } from './antigravity';
import { TargetTool } from '../core/config';

export { BaseInstructionGenerator, GenerationResult } from './base';

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
