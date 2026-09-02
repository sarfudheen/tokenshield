import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ExtensionConfig, GithubStructureMode } from '../core/config';
import { BaseInstructionGenerator, GenerationResult } from './base';
import { CopilotGenerator } from './copilot';
import { ClaudeGenerator } from './claude';
import { CodexGenerator } from './codex';
import { AntigravityGenerator } from './antigravity';
import { TargetTool } from '../core/config';
import {
  COPILOT_INSTRUCTIONS_PATH,
  COPILOT_INSTRUCTIONS_SUBDIR_PATH,
  COPILOT_PROJECT_INSTRUCTIONS_SUBDIR_PATH,
  TOKENSHIELD_AGENT_PATH,
  TOKENSHIELD_SKILL_PATH,
} from '../core/constants';

export { BaseInstructionGenerator, GenerationResult } from './base';

/**
 * Detects whether the workspace uses a structured .github directory
 * (instructions/, agents/, skills/ subfolders) or a simple flat layout.
 */
export function detectGithubStructure(wsPath: string, mode: GithubStructureMode): 'flat' | 'structured' {
  if (mode === 'structured') {
    return 'structured';
  }
  if (mode === 'flat') {
    return 'flat';
  }

  // Auto-detection: check for instructions/, agents/, or skills/ folders under .github/
  const hasSubdirInstructions = fs.existsSync(path.join(wsPath, '.github', 'instructions'));
  const hasAgents = fs.existsSync(path.join(wsPath, '.github', 'agents'));
  const hasSkills = fs.existsSync(path.join(wsPath, '.github', 'skills'));

  if (hasSubdirInstructions || hasAgents || hasSkills) {
    return 'structured';
  }

  return 'flat';
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
    const structureLayout = detectGithubStructure(wsPath, config.githubStructureMode);

    const copilotGen = this.generators.get('copilot');

    if (copilotGen) {
      if (structureLayout === 'structured') {
        // --- Structured .github/ Mode ---
        // 1. Write dedicated TokenShield directives file to .github/instructions/tokenshield.instructions.md
        const targetSubdirPath = path.join(wsPath, COPILOT_INSTRUCTIONS_SUBDIR_PATH);
        const subdir = path.dirname(targetSubdirPath);
        if (!fs.existsSync(subdir)) {
          fs.mkdirSync(subdir, { recursive: true });
        }

        const strategies = config.profile === 'custom' ? config.activeStrategies : undefined;
        const fullContent = copilotGen.generateContent(
          strategies || config.activeStrategies,
          config
        );

        const existingSubdir = fs.existsSync(targetSubdirPath) ? fs.readFileSync(targetSubdirPath, 'utf-8') : '';
        if (existingSubdir !== fullContent) {
          fs.writeFileSync(targetSubdirPath, fullContent, 'utf-8');
          results.push({
            target: 'copilot',
            filePath: targetSubdirPath,
            created: !existingSubdir,
            updated: !!existingSubdir,
            skipped: false,
          });
        } else {
          results.push({
            target: 'copilot',
            filePath: targetSubdirPath,
            created: false,
            updated: false,
            skipped: true,
          });
        }

        // 2. Direct injection: ensure the primary instructions file includes the managed block
        this.injectCrossReference(wsPath, config);

        // 3. Optional agent & skill scaffolding
        if (config.generateAgentFiles) {
          this.scaffoldAgentAndSkill(wsPath);
        }
      } else {
        // --- Flat / Standard Mode ---
        if (config.useVscodeStorage) {
          const storageDir = path.join(wsPath, '.vscode');
          const vscodeRes = await copilotGen.generateToStorage(storageDir, config);
          results.push(vscodeRes);

          // Mirror to .github/copilot-instructions.md with merge
          const githubPath = path.join(wsPath, COPILOT_INSTRUCTIONS_PATH);
          const githubDir = path.dirname(githubPath);
          if (!fs.existsSync(githubDir)) {
            fs.mkdirSync(githubDir, { recursive: true });
          }

          const vscodeContent = fs.existsSync(vscodeRes.filePath)
            ? fs.readFileSync(vscodeRes.filePath, 'utf-8')
            : '';
          const githubExisting = fs.existsSync(githubPath)
            ? fs.readFileSync(githubPath, 'utf-8')
            : '';

          if (vscodeContent && vscodeContent !== githubExisting) {
            // If .github/copilot-instructions.md exists, merge safely
            if (githubExisting && config.preserveExistingInstructions) {
              const merged = (copilotGen as any).mergeContent(githubExisting, vscodeContent);
              if (merged !== githubExisting) {
                fs.writeFileSync(githubPath, merged, 'utf-8');
              }
            } else {
              fs.writeFileSync(githubPath, vscodeContent, 'utf-8');
            }
          }
        } else {
          const res = await copilotGen.generate(wsPath, config);
          results.push(res);
        }
      }

      // Always ensure .vscode/ settings registration for codeGeneration instructions
      try {
        const wsConfig = vscode.workspace.getConfiguration('', wsFolders[0].uri);
        const rel = structureLayout === 'structured'
          ? COPILOT_INSTRUCTIONS_SUBDIR_PATH
          : '.vscode/copilot-instructions.md';
        const existing = wsConfig.get<any[]>('github.copilot.chat.codeGeneration.instructions') || [];
        const hasEntry = existing.some(e => typeof e === 'object' && (e.file?.includes('copilot-instructions.md') || e.file?.includes('tokenshield.instructions.md')));
        if (!hasEntry) {
          await wsConfig.update(
            'github.copilot.chat.codeGeneration.instructions',
            [...existing, { file: rel }],
            vscode.ConfigurationTarget.Workspace
          );
        }
      } catch { /* best effort */ }
    }

    // Process other non-copilot target tools (Claude, Codex, Antigravity)
    for (const tool of config.targetTools) {
      if (tool === 'copilot') { continue; }
      const gen = this.generators.get(tool);
      if (gen) {
        const res = await gen.generate(wsPath, config);
        results.push(res);
      }
    }

    return results;
  }

  /**
   * Injects the managed TokenShield optimization directives block directly into the
   * project's primary instructions file so Copilot Chat immediately enforces them without
   * needing secondary file-read tool calls.
   */
  private injectCrossReference(wsPath: string, config: ExtensionConfig): void {
    const candidatePaths = [
      path.join(wsPath, COPILOT_PROJECT_INSTRUCTIONS_SUBDIR_PATH),
      path.join(wsPath, COPILOT_INSTRUCTIONS_PATH),
    ];

    const copilotGen = this.generators.get('copilot');
    if (!copilotGen) { return; }

    const strategies = config.profile === 'custom' ? config.activeStrategies : undefined;
    const fullContent = copilotGen.generateContent(
      strategies || config.activeStrategies,
      config
    );

    for (const targetFile of candidatePaths) {
      if (fs.existsSync(targetFile)) {
        const existing = fs.readFileSync(targetFile, 'utf-8');
        const merged = (copilotGen as any).mergeContent(existing, fullContent);
        if (merged !== existing) {
          fs.writeFileSync(targetFile, merged, 'utf-8');
        }
        break; // merged into primary existing file
      }
    }
  }

  /**
   * Scaffolds the TokenShield agent and optimization skill templates into .github/
   */
  private scaffoldAgentAndSkill(wsPath: string): void {
    // 1. Agent file: .github/agents/tokenshield.agent.md
    const agentPath = path.join(wsPath, TOKENSHIELD_AGENT_PATH);
    const agentDir = path.dirname(agentPath);
    if (!fs.existsSync(agentPath)) {
      if (!fs.existsSync(agentDir)) {
        fs.mkdirSync(agentDir, { recursive: true });
      }
      const agentTemplatePath = path.join(__dirname, '..', '..', 'templates', 'tokenshield-agent.md');
      let agentContent = '';
      if (fs.existsSync(agentTemplatePath)) {
        agentContent = fs.readFileSync(agentTemplatePath, 'utf-8');
      } else {
        agentContent = `---
name: "TokenShield Optimizer"
description: >
  Token and cost optimization agent. Enforces the 19 optimization features.
tools:
  - search/codebase
  - terminal
---

# TokenShield Optimizer Agent
Read \`.github/instructions/tokenshield.instructions.md\` for active optimization features.
`;
      }
      fs.writeFileSync(agentPath, agentContent, 'utf-8');
    }

    // 2. Skill file: .github/skills/tokenshield-optimize/SKILL.md
    const skillPath = path.join(wsPath, TOKENSHIELD_SKILL_PATH);
    const skillDir = path.dirname(skillPath);
    if (!fs.existsSync(skillPath)) {
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true });
      }
      const skillTemplatePath = path.join(__dirname, '..', '..', 'templates', 'tokenshield-skill.md');
      let skillContent = '';
      if (fs.existsSync(skillTemplatePath)) {
        skillContent = fs.readFileSync(skillTemplatePath, 'utf-8');
      } else {
        skillContent = `---
name: tokenshield-optimize
description: >
  Analyze current AI interaction patterns and suggest token/cost optimizations using TokenShield's 19 optimization features.
---

# TokenShield Optimization Skill
Read \`.github/instructions/tokenshield.instructions.md\` to apply active features.
`;
      }
      fs.writeFileSync(skillPath, skillContent, 'utf-8');
    }
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
