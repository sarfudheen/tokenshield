import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CodeGraphProject, getConfig, saveCodeGraphProjects } from '../config';

/**
 * Resolves an absolute path from a potentially relative (workspace-relative) path.
 */
export function resolvePath(projectPath: string): string {
  if (path.isAbsolute(projectPath)) {
    return projectPath;
  }
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (wsFolder) {
    return path.resolve(wsFolder, projectPath);
  }
  return path.resolve(os.homedir(), projectPath);
}

/**
 * Build a QuickPickItem list from current projects + workspace folders not yet added.
 */
function buildPickItems(projects: CodeGraphProject[]): vscode.QuickPickItem[] {
  const items: vscode.QuickPickItem[] = [];

  // Existing configured projects
  if (projects.length > 0) {
    items.push({ label: 'Configured Projects', kind: vscode.QuickPickItemKind.Separator });
    for (const p of projects) {
      items.push({
        label: `${p.enabled ? '$(check)' : '$(circle-large-outline)'} ${p.name}`,
        description: p.path,
        detail: p.enabled ? 'Indexed — click to toggle off' : 'Disabled — click to toggle on',
      });
    }
  }

  // Open workspace folders not yet configured
  const wsFolders = vscode.workspace.workspaceFolders ?? [];
  const configuredPaths = new Set(projects.map(p => resolvePath(p.path)));
  const unconfigured = wsFolders.filter(f => !configuredPaths.has(f.uri.fsPath));

  if (unconfigured.length > 0) {
    items.push({ label: 'Open Workspace Folders', kind: vscode.QuickPickItemKind.Separator });
    for (const f of unconfigured) {
      items.push({
        label: `$(folder) ${f.name}`,
        description: f.uri.fsPath,
        detail: 'Not yet configured — select to add',
      });
    }
  }

  // Actions
  items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
  items.push({ label: '$(folder-opened) Add folder from filesystem...', description: '' });
  items.push({ label: '$(trash) Remove a project...', description: '' });

  return items;
}

export async function showProjectPicker(outputChannel: vscode.OutputChannel): Promise<void> {
  const config = getConfig();
  let projects = [...config.codeGraphProjects];

  const selected = await vscode.window.showQuickPick(buildPickItems(projects), {
    title: 'AI Token Optimizer — CodeGraph Projects',
    placeHolder: 'Select a project to toggle indexing, or add a new folder',
  });

  if (!selected) {
    return;
  }

  // Add from filesystem
  if (selected.label.includes('Add folder from filesystem')) {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: true,
      openLabel: 'Add to CodeGraph Index',
      title: 'Select project folders to index',
    });

    if (!uris || uris.length === 0) {
      return;
    }

    for (const uri of uris) {
      const name = path.basename(uri.fsPath);
      if (!projects.find(p => resolvePath(p.path) === uri.fsPath)) {
        projects.push({ name, path: uri.fsPath, enabled: true });
        outputChannel.appendLine(`[codegraph-projects] Added: ${name} → ${uri.fsPath}`);
      }
    }

    await saveCodeGraphProjects(projects);
    vscode.window.showInformationMessage(`Added ${uris.length} project(s) to CodeGraph index`);
    return;
  }

  // Remove a project
  if (selected.label.includes('Remove a project')) {
    if (projects.length === 0) {
      vscode.window.showInformationMessage('No projects configured yet.');
      return;
    }

    const toRemove = await vscode.window.showQuickPick(
      projects.map(p => ({ label: p.name, description: p.path })),
      { title: 'Select project to remove', placeHolder: 'Project to remove from CodeGraph indexing' }
    );

    if (!toRemove) {
      return;
    }

    projects = projects.filter(p => p.name !== toRemove.label || p.path !== toRemove.description);
    await saveCodeGraphProjects(projects);
    vscode.window.showInformationMessage(`Removed "${toRemove.label}" from CodeGraph projects`);
    return;
  }

  // Toggle an existing configured project
  const matchedProject = projects.find(p => selected.description === p.path);
  if (matchedProject) {
    matchedProject.enabled = !matchedProject.enabled;
    await saveCodeGraphProjects(projects);
    vscode.window.showInformationMessage(
      `"${matchedProject.name}" indexing ${matchedProject.enabled ? 'enabled' : 'disabled'}`
    );
    return;
  }

  // Add an unconfigured workspace folder
  const wsFolder = (vscode.workspace.workspaceFolders ?? []).find(f => f.uri.fsPath === selected.description);
  if (wsFolder) {
    projects.push({ name: wsFolder.name, path: wsFolder.uri.fsPath, enabled: true });
    await saveCodeGraphProjects(projects);
    vscode.window.showInformationMessage(`"${wsFolder.name}" added to CodeGraph projects`);
  }
}

/**
 * Returns the list of enabled project paths to index.
 * Falls back to the primary workspace folder when no projects are configured.
 */
export function getProjectsToIndex(): { name: string; absPath: string }[] {
  const config = getConfig();

  if (config.codeGraphProjects.length > 0) {
    return config.codeGraphProjects
      .filter(p => p.enabled)
      .map(p => ({ name: p.name, absPath: resolvePath(p.path) }))
      .filter(p => fs.existsSync(p.absPath));
  }

  // Default: all open workspace folders
  return (vscode.workspace.workspaceFolders ?? []).map(f => ({
    name: f.name,
    absPath: f.uri.fsPath,
  }));
}
