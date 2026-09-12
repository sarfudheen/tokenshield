import * as vscode from 'vscode';
import * as path from 'path';
import { readDiskEvents } from '../cache/eventLog';
import { DiffContentProvider, registerDiffContentProvider } from './dashboard';

export class TokenSculptSavingsCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      return [];
    }

    const wsPath = wsFolders[0].uri.fsPath;
    const docPath = document.uri.fsPath;
    const docBaseName = path.basename(docPath);

    const diskEvents = readDiskEvents(wsPath);
    let matchedTokens = 0;
    let matchingEvent: any = null;

    for (const ev of diskEvents) {
      if (
        ev.source &&
        (ev.source.includes(docBaseName) || docPath.endsWith(ev.source) || ev.source.endsWith(docBaseName))
      ) {
        matchedTokens += ev.tokensSaved;
        if (!matchingEvent) {
          matchingEvent = ev;
        }
      }
    }

    if (matchedTokens <= 0 || !matchingEvent) {
      return [];
    }

    const topRange = new vscode.Range(0, 0, 0, 0);
    const codeLens = new vscode.CodeLens(topRange, {
      title: `⚡ TokenSculpt: ~${matchedTokens.toLocaleString()} tokens saved on this file | View Audit Diff`,
      command: 'tokensculpt.openFileSavingsDiff',
      arguments: [matchingEvent, document.uri],
      tooltip: `TokenSculpt pruned redundant context for ${docBaseName}, saving ~${matchedTokens} tokens in this session. Click to view before/after diff.`,
    });

    return [codeLens];
  }
}

export function registerSavingsCodeLens(context: vscode.ExtensionContext): TokenSculptSavingsCodeLensProvider {
  const provider = new TokenSculptSavingsCodeLensProvider();

  const selector: vscode.DocumentSelector = [
    { scheme: 'file', language: '*' },
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.commands.registerCommand('tokensculpt.openFileSavingsDiff', async (event: any, fileUri: vscode.Uri) => {
      try {
        registerDiffContentProvider(context);
        const diffProvider = DiffContentProvider.getInstance();
        const baseName = path.basename(fileUri.fsPath);
        const ext = path.extname(fileUri.fsPath) || '.ts';
        const nonce = Date.now();

        const beforeUri = vscode.Uri.parse(
          `${DiffContentProvider.scheme}:/${encodeURIComponent(baseName)} (Before TokenSculpt)${ext}?${nonce}`
        );
        const afterUri = vscode.Uri.parse(
          `${DiffContentProvider.scheme}:/${encodeURIComponent(baseName)} (After TokenSculpt)${ext}?${nonce}`
        );

        diffProvider.setContent(beforeUri, event.beforeContent || '// Original context');
        diffProvider.setContent(afterUri, event.afterContent || '// Compressed context');

        await vscode.commands.executeCommand(
          'vscode.diff',
          beforeUri,
          afterUri,
          `TokenSculpt Audit: ${event.directive || 'Savings'} (${baseName})`,
          { preview: true }
        );
      } catch (err) {
        vscode.window.showErrorMessage(`TokenSculpt: Could not display diff: ${err}`);
      }
    })
  );

  return provider;
}
