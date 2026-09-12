import * as vscode from 'vscode';
import { chatSavingsTracker } from '../telemetry/chatSavingsTracker';
import { formatCompactTokens, formatCost } from './formatters';

export interface ModelSimulationEntry {
  id: string;
  name: string;
  provider: string;
  tier: 'flagship' | 'standard' | 'lightweight';
  inputPerMillion: number;
  outputPerMillion: number;
  unoptimizedCostUsd: number;
  optimizedCostUsd: number;
  dollarsSavedUsd: number;
}

export const SIMULATION_MODELS = [
  { id: 'claude-3.7-opus', name: 'Claude Opus (3 / 3.7)', provider: 'Anthropic', tier: 'flagship' as const, input: 15.0, output: 75.0 },
  { id: 'openai-o1', name: 'OpenAI o1', provider: 'OpenAI', tier: 'flagship' as const, input: 15.0, output: 60.0 },
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', tier: 'standard' as const, input: 3.0, output: 15.0 },
  { id: 'openai-gpt-4o', name: 'GPT-4o', provider: 'OpenAI', tier: 'standard' as const, input: 2.5, output: 10.0 },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'Google', tier: 'standard' as const, input: 1.25, output: 5.0 },
  { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', provider: 'Anthropic', tier: 'lightweight' as const, input: 0.80, output: 4.0 },
  { id: 'openai-gpt-4o-mini', name: 'GPT-4o-mini', provider: 'OpenAI', tier: 'lightweight' as const, input: 0.15, output: 0.60 },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'Google', tier: 'lightweight' as const, input: 0.10, output: 0.40 },
];

export function runSimulation(tokensSaved: number, estimatedTotalUncompressed?: number): ModelSimulationEntry[] {
  // If baseline is not provided, model an average 65% reduction
  const uncompressedTokens = estimatedTotalUncompressed && estimatedTotalUncompressed > tokensSaved
    ? estimatedTotalUncompressed
    : Math.round(tokensSaved / 0.65);

  const compressedTokens = Math.max(0, uncompressedTokens - tokensSaved);

  return SIMULATION_MODELS.map(m => {
    const unoptimizedCost = (uncompressedTokens / 1_000_000) * m.input;
    const optimizedCost = (compressedTokens / 1_000_000) * m.input;
    const dollarsSaved = Math.max(0, unoptimizedCost - optimizedCost);

    return {
      id: m.id,
      name: m.name,
      provider: m.provider,
      tier: m.tier,
      inputPerMillion: m.input,
      outputPerMillion: m.output,
      unoptimizedCostUsd: unoptimizedCost,
      optimizedCostUsd: optimizedCost,
      dollarsSavedUsd: dollarsSaved,
    };
  });
}

export function generateSimulationMarkdown(tokensSaved: number): string {
  const sim = runSimulation(tokensSaved);
  const now = new Date().toISOString().split('T')[0];

  const rows = sim.map(s =>
    `| **${s.name}** | ${s.provider} | ${s.tier.toUpperCase()} | $${s.inputPerMillion.toFixed(2)} | $${s.unoptimizedCostUsd.toFixed(4)} | $${s.optimizedCostUsd.toFixed(4)} | **+$${s.dollarsSavedUsd.toFixed(4)}** |`
  ).join('\n');

  return `# TokenSculpt — "What If" Multi-Model Cost Simulator
*Generated on ${now}*

### Simulated Savings: ~${tokensSaved.toLocaleString()} tokens (~65% reduction)

| Model | Provider | Tier | Rate / 1M | Without TokenSculpt | With TokenSculpt | Net Savings |
|---|---|---|---|---|---|---|
${rows}

> **Takeaway:** Running on flagship reasoning models like Claude Opus or OpenAI o1 yields **$${sim[0].dollarsSavedUsd.toFixed(2)}** in direct dollar savings per ~${tokensSaved.toLocaleString()} tokens pruned!
`;
}

export async function showCostSimulatorQuickPick(): Promise<void> {
  const sessionSaved = chatSavingsTracker.getSessionTokensSaved();
  const lifetimeSaved = chatSavingsTracker.getLifetimeTokensSaved();

  // If brand new session with no tokens yet, simulate a standard 250,000 token sprint
  const baseTokens = sessionSaved > 0 ? sessionSaved : (lifetimeSaved > 0 ? lifetimeSaved : 250_000);
  const isHypothetical = sessionSaved <= 0 && lifetimeSaved <= 0;

  const simulation = runSimulation(baseTokens);

  const items: vscode.QuickPickItem[] = simulation.map(s => ({
    label: `$(tag) ${s.name} (${s.provider})`,
    description: `Net Savings: +${formatCost(s.dollarsSavedUsd)} (${s.tier.toUpperCase()})`,
    detail: `Raw: $${s.unoptimizedCostUsd.toFixed(3)} → TokenSculpt: $${s.optimizedCostUsd.toFixed(3)} (Rate: $${s.inputPerMillion}/M tok)`,
  }));

  items.unshift({
    label: `$(graph) View Full Markdown Comparison Report`,
    description: `Simulating ${formatCompactTokens(baseTokens)} tokens ${isHypothetical ? '(benchmark baseline)' : '(from your session)'}`,
    detail: 'Open clean tabular report formatted for team and management review',
  });

  const selected = await vscode.window.showQuickPick(items, {
    title: `TokenSculpt Cost Simulator — ~${baseTokens.toLocaleString()} Tokens Saved`,
    placeHolder: 'Select a model to review cost arbitrage or open report',
  });

  if (!selected) { return; }

  if (selected.label.includes('Markdown Comparison Report')) {
    const report = generateSimulationMarkdown(baseTokens);
    const doc = await vscode.workspace.openTextDocument({
      content: report,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);
  }
}
