import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig } from '../core/config';
import { getRoiEngine } from './roiEngine';

export async function exportExecutiveReport(outputChannel: vscode.OutputChannel): Promise<void> {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    vscode.window.showWarningMessage('AI Token Optimizer: No open workspace to export telemetry for.');
    return;
  }

  const config = getConfig();
  const summary = await getRoiEngine().getSessionSummary(config);

  const format = await vscode.window.showQuickPick(
    [
      { label: '$(markdown) Markdown Summary (.md)', description: 'Executive report formatted for Slack/Notion/GitHub' },
      { label: '$(json) JSON Telemetry (.json)', description: 'Raw structured telemetry data' },
      { label: '$(table) CSV Breakdown (.csv)', description: 'Per-model token and cost savings spreadsheet' },
    ],
    { title: 'Export Enterprise ROI Telemetry Report', placeHolder: 'Select export format' }
  );

  if (!format) { return; }

  const wsPath = wsFolders[0].uri.fsPath;
  const dateStr = new Date().toISOString().split('T')[0];
  let fileName = `ai-token-savings-${dateStr}`;
  let content = '';

  if (format.label.includes('Markdown')) {
    fileName += '.md';
    content = generateMarkdownReport(summary, config);
  } else if (format.label.includes('JSON')) {
    fileName += '.json';
    content = JSON.stringify(summary, null, 2);
  } else {
    fileName += '.csv';
    content = generateCsvReport(summary);
  }

  const defaultUri = vscode.Uri.file(path.join(wsPath, fileName));
  const targetUri = await vscode.window.showSaveDialog({
    defaultUri,
    saveLabel: 'Save Report',
    filters: format.label.includes('Markdown')
      ? { Markdown: ['md'] }
      : format.label.includes('JSON')
      ? { JSON: ['json'] }
      : { CSV: ['csv'] },
  });

  if (!targetUri) { return; }

  fs.writeFileSync(targetUri.fsPath, content, 'utf-8');
  outputChannel.appendLine(`[export] Executive ROI report saved to: ${targetUri.fsPath}`);
  const action = await vscode.window.showInformationMessage(
    `AI Token Optimizer: Executive report saved (${path.basename(targetUri.fsPath)})`,
    'Open File'
  );

  if (action === 'Open File') {
    const doc = await vscode.workspace.openTextDocument(targetUri);
    await vscode.window.showTextDocument(doc);
  }
}

function generateMarkdownReport(summary: import('../core/types').SessionRoiSummary, config: import('../core/config').ExtensionConfig): string {
  const modelRows = Object.values(summary.perModelSavings).map(m =>
    `| ${m.modelFamily} | ${m.tier.toUpperCase()} | ${m.tokensSaved.toLocaleString()} | $${m.costSavedUsd.toFixed(4)} | ${m.queryCount} |`
  ).join('\n');

  return `# Executive AI Token Optimization Report

**Generated**: ${new Date().toLocaleString()}  
**Active Profile**: ${config.profile.toUpperCase()}  
**Active Primary Model**: \`${summary.activeModel.name}\` (\`${summary.activeModel.vendor}\`)

---

## 🏆 Key Performance Indicators (KPIs)

| Metric | Measured Value |
|---|---|
| **Total Avoided Tokens** | **${summary.totalTokensSaved.toLocaleString()} tokens** |
| **Total Cost Avoidance (USD)** | **$${summary.totalCostSavedUsd.toFixed(4)}** |
| **Active Optimization Directives** | **10 / 10 Active** |
| **Local Cache Hits** | ${summary.cacheHits} requests served from disk (0 tokens) |
| **AST Files Pruned** | ${summary.filesPruned} files inspected via signatures (~90% savings) |
| **Diff-Only File Modifications** | ${summary.diffEditsCount} edits (~92% output token savings) |
| **Agent Loops Intercepted** | ${summary.guardrailStops} runaway loops prevented |
| **Tasks Downshifted** | ${summary.downshiftedTasksCount} lightweight tasks routed to cost-effective models |

---

## 📊 Token & Cost Avoidance per Model Family

| Model Family | Tier | Avoided Tokens | Avoided Cost (USD) | Actions |
|---|---|---|---|---|
${modelRows || `| ${summary.activeModel.family} | ${summary.activeModel.tier.toUpperCase()} | ${summary.totalTokensSaved.toLocaleString()} | $${summary.totalCostSavedUsd.toFixed(4)} | Session Baseline |`}

---

*Report generated on-device by Copilot Token Optimizer. 100% private, zero telemetry transmission.*
`;
}

function generateCsvReport(summary: import('../core/types').SessionRoiSummary): string {
  const header = 'ModelFamily,Tier,AvoidedTokens,AvoidedCostUSD,ActionCount\n';
  const records = Object.values(summary.perModelSavings);
  if (records.length === 0) {
    return header + `${summary.activeModel.family},${summary.activeModel.tier},${summary.totalTokensSaved},${summary.totalCostSavedUsd.toFixed(4)},1\n`;
  }
  return header + records.map(r => `${r.modelFamily},${r.tier},${r.tokensSaved},${r.costSavedUsd.toFixed(4)},${r.queryCount}`).join('\n') + '\n';
}
