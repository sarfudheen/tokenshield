import * as vscode from 'vscode';
import { DiscoveredModel, ModelTier } from '../core/types';

/**
 * Classifies a model string/family into an enterprise pricing tier.
 */
export function classifyModelTier(modelNameOrFamily: string): ModelTier {
  const lower = modelNameOrFamily.toLowerCase();

  // Tier 1: Ultra Reasoning / Flagship
  if (lower.includes('opus') || lower.includes('o1') || lower.includes('o3') || lower.includes('claude-3-opus') || lower.includes('reasoning')) {
    return 'flagship';
  }

  // Tier 3: Lightweight / Fast
  if (lower.includes('mini') || lower.includes('haiku') || lower.includes('flash') || lower.includes('small') || lower.includes('lite') || lower.includes('gpt-4o-mini')) {
    return 'lightweight';
  }

  // Tier 2: Standard Production (GPT-4o, Sonnet, etc.)
  return 'standard';
}

/**
 * Discover available chat models from VS Code's Language Model API (`vscode.lm`).
 */
export async function discoverAvailableModels(): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = [];

  try {
    if ('lm' in vscode && typeof (vscode as any).lm?.selectChatModels === 'function') {
      const chatModels = await (vscode as any).lm.selectChatModels();
      for (const m of chatModels) {
        const family = m.family || m.name || m.id;
        models.push({
          id: m.id,
          name: m.name || m.id,
          vendor: m.vendor || 'copilot',
          family: family,
          maxInputTokens: m.maxInputTokens,
          tier: classifyModelTier(family),
        });
      }
    }
  } catch {
    // vscode.lm API not available in older VS Code versions or during headless tests
  }

  // If no models were discovered (e.g. running in test or before Copilot auth), provide defaults
  if (models.length === 0) {
    models.push(
      { id: 'copilot/gpt-4o', name: 'GPT-4o (Copilot)', vendor: 'copilot', family: 'gpt-4o', tier: 'standard' },
      { id: 'copilot/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Copilot)', vendor: 'copilot', family: 'claude-3.5-sonnet', tier: 'standard' },
      { id: 'copilot/gpt-4o-mini', name: 'GPT-4o-mini', vendor: 'copilot', family: 'gpt-4o-mini', tier: 'lightweight' },
      { id: 'copilot/claude-3.5-haiku', name: 'Claude 3.5 Haiku', vendor: 'copilot', family: 'claude-3.5-haiku', tier: 'lightweight' },
      { id: 'copilot/o1', name: 'o1 (Reasoning)', vendor: 'copilot', family: 'o1', tier: 'flagship' },
    );
  }

  return models;
}

/**
 * Gets the primary active model for the workspace.
 */
export async function getActiveModel(): Promise<DiscoveredModel> {
  const available = await discoverAvailableModels();
  // Prefer standard flagship/production model (Claude Sonnet or GPT-4o) as primary baseline
  const active = available.find(m => m.tier === 'standard') || available[0];
  return active;
}
