export { BaseInstructionGenerator, GenerationResult, InstructionEngine } from './engine';
export { CopilotGenerator } from './copilot';
export { ClaudeGenerator } from './claude';
export { CodexGenerator } from './codex';
export { AntigravityGenerator } from './antigravity';
export { initializeForProject, detectProjectStack, getStackDirectives, buildProjectInstructions } from './projectInit';

import { InstructionEngine } from './engine';
import { ExtensionConfig } from '../core/config';

let defaultEngine: InstructionEngine | undefined;

export function getInstructionEngine(): InstructionEngine {
  if (!defaultEngine) {
    defaultEngine = new InstructionEngine();
  }
  return defaultEngine;
}

export async function generateAllInstructions(config: ExtensionConfig) {
  return getInstructionEngine().generateAll(config);
}

export async function exportInstructionsToRepo(config: ExtensionConfig) {
  return getInstructionEngine().exportToRepo(config);
}
