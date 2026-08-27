import * as vscode from 'vscode';
import { DiscoveredModel, ModelTier } from '../core/types';

/**
 * Classifies a model string/family into an enterprise pricing tier.
 */
export function classifyModelTier(modelNameOrFamily: string): ModelTier {
  const lower = modelNameOrFamily.toLowerCase();

  // Tier 1: Ultra Reasoning / Flagship
  if (
    lower.includes('opus') ||
    lower.includes('o1') ||
    lower.includes('o3') ||
    lower.includes('deep-think') ||
    lower.includes('ultra') ||
    lower.includes('reasoning')
  ) {
    return 'flagship';
  }

  // Tier 3: Lightweight / Fast (Flash, Haiku, Mini, Flash-Lite)
  if (
    lower.includes('flash') ||
    lower.includes('mini') ||
    lower.includes('haiku') ||
    lower.includes('small') ||
    lower.includes('lite') ||
    lower.includes('3.7 flash') ||
    lower.includes('2.5 flash') ||
    lower.includes('2.0 flash')
  ) {
    return 'lightweight';
  }

  // Tier 2: Standard Production (Gemini Pro, GPT-4o, Claude Sonnet)
  return 'standard';
}

/**
 * Detects whether the active environment is Antigravity IDE, Claude, Codex, or VS Code Copilot.
 */
export function detectHostEnvironment(): 'antigravity' | 'claude' | 'copilot' | 'generic' {
  const appName = (vscode.env.appName || '').toLowerCase();
  if (appName.includes('antigravity') || vscode.extensions.getExtension('google.antigravity')) {
    return 'antigravity';
  }
  if (vscode.extensions.getExtension('anthropic.claude-code')) {
    return 'claude';
  }
  if (vscode.extensions.getExtension('github.copilot') || appName.includes('visual studio code') || appName.includes('vscodium') || appName.includes('cursor')) {
    return 'copilot';
  }
  return 'copilot'; // Default to Copilot in any standard editor
}

/**
 * Discover available chat models dynamically from VS Code LM API, active IDE vendor, or configuration.
 */
export async function discoverAvailableModels(): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = [];

  // 1. Try VS Code LM API if exposed
  try {
    if ('lm' in vscode && typeof (vscode as any).lm?.selectChatModels === 'function') {
      const chatModels = await (vscode as any).lm.selectChatModels();
      if (Array.isArray(chatModels) && chatModels.length > 0) {
        for (const m of chatModels) {
          const family = m.family || m.name || m.id;
          models.push({
            id: m.id,
            name: m.name || m.id,
            vendor: m.vendor || 'antigravity',
            family: family,
            maxInputTokens: m.maxInputTokens,
            tier: classifyModelTier(family),
          });
        }
      }
    }
  } catch { /* ignore */ }

  if (models.length > 0) {
    return models;
  }

  // 2. Dynamic host environment models
  const host = detectHostEnvironment();

  if (host === 'antigravity') {
    return [
      { id: 'antigravity/gemini-3.7-flash', name: 'Gemini 3.7 Flash (High)', vendor: 'google', family: 'gemini-3.7-flash', tier: 'lightweight' },
      { id: 'antigravity/gemini-2.5-pro', name: 'Gemini 2.5 Pro', vendor: 'google', family: 'gemini-2.5-pro', tier: 'standard' },
      { id: 'antigravity/gemini-3.7-pro', name: 'Gemini 3.7 Pro', vendor: 'google', family: 'gemini-3.7-pro', tier: 'standard' },
      { id: 'antigravity/gemini-2.0-flash', name: 'Gemini 2.0 Flash', vendor: 'google', family: 'gemini-2.0-flash', tier: 'lightweight' },
      { id: 'antigravity/gemini-deep-think', name: 'Gemini 3.7 Deep Think', vendor: 'google', family: 'gemini-deep-think', tier: 'flagship' },
    ];
  }

  if (host === 'claude') {
    return [
      { id: 'claude/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', vendor: 'anthropic', family: 'claude-3.5-sonnet', tier: 'standard' },
      { id: 'claude/claude-3.5-haiku', name: 'Claude 3.5 Haiku', vendor: 'anthropic', family: 'claude-3.5-haiku', tier: 'lightweight' },
      { id: 'claude/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', vendor: 'anthropic', family: 'claude-3.7-sonnet', tier: 'standard' },
      { id: 'claude/claude-3-opus', name: 'Claude 3 Opus', vendor: 'anthropic', family: 'claude-3-opus', tier: 'flagship' },
    ];
  }

  return [
    { id: 'copilot/gpt-4o', name: 'GPT-4o (Copilot)', vendor: 'copilot', family: 'gpt-4o', tier: 'standard' },
    { id: 'copilot/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', vendor: 'copilot', family: 'claude-3.5-sonnet', tier: 'standard' },
    { id: 'copilot/gpt-4o-mini', name: 'GPT-4o-mini', vendor: 'copilot', family: 'gpt-4o-mini', tier: 'lightweight' },
    { id: 'copilot/o1', name: 'o1 (Reasoning)', vendor: 'copilot', family: 'o1', tier: 'flagship' },
  ];
}

/**
 * Gets the active model for the workspace based on host environment.
 */
export async function getActiveModel(): Promise<DiscoveredModel> {
  const available = await discoverAvailableModels();
  const host = detectHostEnvironment();

  if (host === 'antigravity') {
    // In Antigravity IDE, Gemini 3.7 Flash High is the active primary engine
    return available.find(m => m.id.includes('3.7-flash')) || available[0];
  }

  const active = available.find(m => m.tier === 'standard') || available[0];
  return active;
}
