import * as vscode from 'vscode';
import { PromptTemplateStore, PromptTemplate } from '../cache/promptTemplates';

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export async function savePromptTemplateCommand(outputChannel?: vscode.OutputChannel): Promise<void> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {
    vscode.window.showWarningMessage('TokenSculpt: Open a workspace to save prompt templates.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  let prefillPrompt = '';
  if (editor && !editor.selection.isEmpty) {
    prefillPrompt = editor.document.getText(editor.selection);
  }

  const name = await vscode.window.showInputBox({
    title: 'TokenSculpt: Save Prompt Template',
    prompt: 'Enter a name for the prompt template',
    placeHolder: 'e.g. Unit Test Generator, Zero-Boilerplate Refactor',
    validateInput: val => (val.trim().length === 0 ? 'Name cannot be empty' : null),
  });
  if (!name) { return; }

  const description = await vscode.window.showInputBox({
    title: 'TokenSculpt: Prompt Description',
    prompt: 'Briefly describe what this prompt does',
    placeHolder: 'e.g. Produces boundary-focused unit tests without conversational preamble',
  }) || '';

  const prompt = await vscode.window.showInputBox({
    title: 'TokenSculpt: Prompt Content',
    prompt: 'Enter the prompt text',
    value: prefillPrompt,
    placeHolder: 'e.g. Refactor this code strictly as a unified diff...',
    validateInput: val => (val.trim().length === 0 ? 'Prompt content cannot be empty' : null),
  });
  if (!prompt) { return; }

  const store = new PromptTemplateStore(wsRoot);
  const saved = store.save({
    name,
    description,
    prompt,
    tags: ['custom'],
  });

  outputChannel?.appendLine(`[templates] Saved prompt template: "${saved.name}" (${saved.id})`);
  vscode.window.showInformationMessage(`TokenSculpt: Prompt template "${saved.name}" saved.`);
}

export async function usePromptTemplateCommand(outputChannel?: vscode.OutputChannel): Promise<void> {
  const wsRoot = getWorkspaceRoot();
  if (!wsRoot) {
    vscode.window.showWarningMessage('TokenSculpt: Open a workspace to use prompt templates.');
    return;
  }

  const store = new PromptTemplateStore(wsRoot);
  const templates = store.list();

  if (templates.length === 0) {
    vscode.window.showInformationMessage('TokenSculpt: No prompt templates found.');
    return;
  }

  const items: (vscode.QuickPickItem & { template: PromptTemplate })[] = templates.map(t => ({
    label: `$(symbol-keyword) ${t.name}`,
    description: t.tags ? `[${t.tags.join(', ')}]` : '',
    detail: t.description ? `${t.description} — "${t.prompt.slice(0, 80)}..."` : t.prompt.slice(0, 100),
    template: t,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    title: 'TokenSculpt: Select Prompt Template',
    placeHolder: 'Choose a token-optimized prompt template',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!selected) { return; }

  const action = await vscode.window.showQuickPick([
    { label: '$(clippy) Copy to Clipboard', id: 'copy' },
    { label: '$(edit) Insert into Active Editor', id: 'insert' },
    { label: '$(file-text) Open in New File', id: 'open' },
  ], {
    title: `Template: ${selected.template.name}`,
    placeHolder: 'What would you like to do with this template?',
  });

  if (!action) { return; }

  if (action.id === 'copy') {
    await vscode.env.clipboard.writeText(selected.template.prompt);
    vscode.window.showInformationMessage(`TokenSculpt: Copied "${selected.template.name}" to clipboard.`);
  } else if (action.id === 'insert') {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await editor.edit(editBuilder => {
        editBuilder.insert(editor.selection.active, selected.template.prompt);
      });
    } else {
      await vscode.env.clipboard.writeText(selected.template.prompt);
      vscode.window.showInformationMessage(`No active editor. Copied "${selected.template.name}" to clipboard.`);
    }
  } else if (action.id === 'open') {
    const doc = await vscode.workspace.openTextDocument({
      content: selected.template.prompt,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);
  }
}
