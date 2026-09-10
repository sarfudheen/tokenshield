import * as vscode from 'vscode';
import * as fs from 'fs';
import { TargetTool } from './config';
import {
  COPILOT_EXTENSION_ID,
  CLAUDE_EXTENSION_ID,
  CODEX_EXTENSION_ID,
} from './constants';

const ANTIGRAVITY_EXTENSION_ID = 'google.antigravity';

/**
 * Human-readable labels for each target tool (used in QuickPick UI).
 */
export const TARGET_TOOL_LABELS: Record<TargetTool, string> = {
  copilot: 'GitHub Copilot',
  claude: 'Claude Code (Anthropic)',
  codex: 'OpenAI Codex',
  antigravity: 'Google Antigravity',
};

/**
 * Auto-detects which AI coding tools are present in the current IDE
 * by probing installed extensions, the app identity, and workspace markers.
 *
 * Returns at least one tool (defaults to `['copilot']` if nothing is detected,
 * since TokenShield itself is a VS Code extension).
 */
export function detectActiveTools(): TargetTool[] {
  const detected: TargetTool[] = [];
  const appName = (vscode.env.appName || '').toLowerCase();

  // --- Antigravity IDE ---
  if (
    appName.includes('antigravity') ||
    vscode.extensions.getExtension(ANTIGRAVITY_EXTENSION_ID)
  ) {
    detected.push('antigravity');
  }

  // --- GitHub Copilot ---
  if (
    vscode.extensions.getExtension(COPILOT_EXTENSION_ID) ||
    appName.includes('visual studio code') ||
    appName.includes('vscodium') ||
    appName.includes('cursor')
  ) {
    detected.push('copilot');
  }

  // --- Claude Code (Anthropic) ---
  if (vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)) {
    detected.push('claude');
  }

  // --- OpenAI Codex ---
  // Codex can be a VS Code extension or a standalone CLI.
  // Check extension first, then fall back to workspace marker (.codex/ directory).
  if (vscode.extensions.getExtension(CODEX_EXTENSION_ID)) {
    detected.push('codex');
  } else {
    const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (wsPath && fs.existsSync(`${wsPath}/.codex`)) {
      detected.push('codex');
    }
  }

  // Safe fallback: if we somehow detected nothing, assume Copilot
  // since we are running inside a VS Code-compatible editor.
  if (detected.length === 0) {
    detected.push('copilot');
  }

  return detected;
}

/**
 * Resolves the effective target tools list.
 *
 * Priority:
 *   1. Explicit user setting (`tokenshield.targetTools` with ≥1 entry) → use as-is
 *   2. Auto-detection enabled → `detectActiveTools()`
 *   3. Fallback → `['copilot']`
 */
export function resolveTargetTools(
  explicitSetting: TargetTool[],
  autoDetect: boolean,
): TargetTool[] {
  // If the user explicitly configured tools, honour their choice.
  if (explicitSetting.length > 0) {
    return explicitSetting;
  }

  if (autoDetect) {
    return detectActiveTools();
  }

  return ['copilot'];
}
