import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawnSync } from 'child_process';
import { TOOLS_TO_INSTALL, ToolInstallEntry } from '../constants';
import { memoizeTtl } from '../cache/ttlCache';

export interface InstallResult {
  packageName: string;
  installed: boolean;
  alreadyInstalled: boolean;
  error?: string;
}

// Each check is a blocking `which` (up to 3s) — memoized so validators and
// dashboard refreshes don't repeatedly shell out for the same binary.
export function isBinaryAvailable(bin: string): boolean {
  return memoizeTtl(`which:${bin}`, 60_000, () => {
    try {
      execSync(`which ${bin}`, { stdio: 'ignore', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Called on workspace open.
 * 1. Generates .cavemanrc config file
 * 2. Logs availability of real tools (rg, git, jq)
 * 3. For each entry in TOOLS_TO_INSTALL, installs if missing (with user consent)
 */
export async function installAllTools(outputChannel: vscode.OutputChannel): Promise<InstallResult[]> {
  const results: InstallResult[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    outputChannel.appendLine('[installer] No workspace folder — skipping tool setup');
    return results;
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  generateCavemanConfig(wsPath, outputChannel);
  logToolAvailability(outputChannel);

  for (const tool of TOOLS_TO_INSTALL) {
    if (isBinaryAvailable(tool.name)) {
      results.push({ packageName: tool.name, installed: false, alreadyInstalled: true });
      outputChannel.appendLine(`[installer] ✓ ${tool.name} already installed`);
    } else {
      outputChannel.appendLine(`[installer] ○ ${tool.name} not found — offering install`);
      const choice = await vscode.window.showInformationMessage(
        `AI Token Optimizer: ${tool.name} not found.\n${tool.description}`,
        'Install Now',
        'Later'
      );
      if (choice === 'Install Now') {
        const result = await installTool(tool, outputChannel);
        results.push(result);
        if (result.installed && tool.name === 'codegraph') {
          await offerWireCodegraphAgents(outputChannel);
        }
      } else {
        results.push({ packageName: tool.name, installed: false, alreadyInstalled: false, error: 'User deferred' });
      }
    }
  }

  return results;
}

async function installTool(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel): Promise<InstallResult> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Installing ${tool.name}…`, cancellable: false },
    async () => {
      try {
        if (tool.method === 'npm-global' && tool.npmPackage) {
          return installViaNpm(tool.name, tool.npmPackage, outputChannel);
        }
        if (tool.method === 'brew' || tool.method === 'shell-script') {
          return installViaBrewOrShell(tool, outputChannel);
        }
        throw new Error(`Unknown install method: ${tool.method}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`[installer] ✗ ${tool.name} install error: ${msg}`);
        return { packageName: tool.name, installed: false, alreadyInstalled: false, error: msg };
      }
    }
  );
}

function installViaNpm(binaryName: string, npmPackage: string, outputChannel: vscode.OutputChannel): InstallResult {
  outputChannel.appendLine(`[installer] Running: npm install -g ${npmPackage}`);
  const result = spawnSync('npm', ['install', '-g', npmPackage], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    encoding: 'utf-8',
  });
  if (result.status === 0) {
    outputChannel.appendLine(`[installer] ✓ ${binaryName} installed`);
    vscode.window.showInformationMessage(`${binaryName} installed successfully.`);
    return { packageName: binaryName, installed: true, alreadyInstalled: false };
  }
  const errMsg = result.stderr?.trim() || result.error?.message || 'npm install failed';
  outputChannel.appendLine(`[installer] ✗ ${binaryName}: ${errMsg}`);
  vscode.window.showErrorMessage(`Failed to install ${binaryName}. Try: npm install -g ${npmPackage}`);
  return { packageName: binaryName, installed: false, alreadyInstalled: false, error: errMsg };
}

function installViaBrewOrShell(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel): InstallResult {
  const isMac = os.platform() === 'darwin';
  const hasBrewPkg = tool.brewPackage && isMac && isBinaryAvailable('brew');

  if (hasBrewPkg && tool.brewPackage) {
    outputChannel.appendLine(`[installer] Running: brew install ${tool.brewPackage}`);
    const result = spawnSync('brew', ['install', tool.brewPackage], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      outputChannel.appendLine(`[installer] ✓ ${tool.name} installed via brew`);
      runPostInstall(tool, outputChannel);
      return { packageName: tool.name, installed: true, alreadyInstalled: false };
    }
    const brewErr = result.stderr?.trim() || result.error?.message || 'brew install failed';
    outputChannel.appendLine(`[installer] brew failed, trying shell script: ${brewErr}`);
  }

  // Fall back to shell script
  if (tool.shellScriptUrl) {
    outputChannel.appendLine(`[installer] Running: curl -fsSL ${tool.shellScriptUrl} | sh`);
    const result = spawnSync('sh', ['-c', `curl -fsSL ${tool.shellScriptUrl} | sh`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      outputChannel.appendLine(`[installer] ✓ ${tool.name} installed via shell script`);
      runPostInstall(tool, outputChannel);
      return { packageName: tool.name, installed: true, alreadyInstalled: false };
    }
    const shellErr = result.stderr?.trim() || result.error?.message || 'shell install failed';
    outputChannel.appendLine(`[installer] ✗ ${tool.name}: ${shellErr}`);
    const installHint = isMac
      ? `brew install ${tool.brewPackage || tool.name}`
      : `curl -fsSL ${tool.shellScriptUrl} | sh`;
    vscode.window.showErrorMessage(`Failed to install ${tool.name}. Try manually: ${installHint}`);
    return { packageName: tool.name, installed: false, alreadyInstalled: false, error: shellErr };
  }

  const err = `No valid install method for ${tool.name} on ${os.platform()}`;
  outputChannel.appendLine(`[installer] ✗ ${err}`);
  return { packageName: tool.name, installed: false, alreadyInstalled: false, error: err };
}

/**
 * Run post-install setup (e.g. `rtk init -g --copilot` to wire VS Code Copilot hook).
 */
function runPostInstall(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel): void {
  if (!tool.postInstallArgs || tool.postInstallArgs.length === 0) { return; }
  const [cmd, ...args] = [tool.name, ...tool.postInstallArgs];
  outputChannel.appendLine(`[installer] Post-install: ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    encoding: 'utf-8',
    env: { ...process.env },
  });
  if (result.status === 0) {
    outputChannel.appendLine(`[installer] ✓ ${tool.name} post-install complete`);
    if (tool.name === 'rtk') {
      vscode.window.showInformationMessage(
        'RTK installed and wired to VS Code Copilot. Restart VS Code to activate command interception.',
        'Restart Now'
      ).then(choice => {
        if (choice === 'Restart Now') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    }
  } else {
    outputChannel.appendLine(`[installer] ⚠ Post-install failed: ${result.stderr?.trim() || result.error?.message || 'unknown error'}`);
  }
}

/**
 * After codegraph is installed, offer `codegraph install --yes` to wire MCP
 * server config for Claude Code, Cursor, Codex CLI, etc.
 */
async function offerWireCodegraphAgents(outputChannel: vscode.OutputChannel): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    'CodeGraph installed! Wire it to your AI agents (Claude Code, Cursor, Codex…)?',
    'Wire Agents',
    'Skip'
  );
  if (choice === 'Wire Agents') {
    outputChannel.appendLine('[installer] Running: codegraph install --yes');
    const result = spawnSync('codegraph', ['install', '--yes'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      encoding: 'utf-8',
    });
    if (result.status === 0) {
      outputChannel.appendLine('[installer] ✓ CodeGraph agent wiring complete');
      vscode.window.showInformationMessage('CodeGraph wired. Restart your agents to activate.');
    } else {
      outputChannel.appendLine(`[installer] ⚠ Agent wiring failed (run "codegraph install" manually): ${result.stderr}`);
    }
  }
}

function generateCavemanConfig(wsPath: string, outputChannel: vscode.OutputChannel): void {
  const cavemanrcPath = path.join(wsPath, '.cavemanrc');
  if (!fs.existsSync(cavemanrcPath)) {
    const verbosityLevel = vscode.workspace.getConfiguration('aiTokenOptimizer').get('verbosityLevel', 'full');
    fs.writeFileSync(cavemanrcPath, JSON.stringify({
      mode: verbosityLevel,
      rules: { skipIntroductions: true, skipConclusions: true, compactCodeBlocks: true, bulletOverParagraph: true },
    }, null, 2), 'utf-8');
    outputChannel.appendLine('[installer] Created .cavemanrc (verbosity config)');
  }
}

function logToolAvailability(outputChannel: vscode.OutputChannel): void {
  const tools = [
    { bin: 'rtk',       label: 'rtk',        desc: 'CLI output compression proxy (brew install rtk)' },
    { bin: 'codegraph', label: 'codegraph',   desc: 'semantic code indexing (npm i -g @colbymchenry/codegraph)' },
    { bin: 'rg',        label: 'ripgrep',     desc: 'fast code search' },
    { bin: 'git',       label: 'git',         desc: 'version control' },
    { bin: 'jq',        label: 'jq',          desc: 'JSON compression' },
  ];
  outputChannel.appendLine('[installer] Tool availability:');
  for (const t of tools) {
    const ok = isBinaryAvailable(t.bin);
    outputChannel.appendLine(`  ${ok ? '✓' : '○'} ${t.label.padEnd(12)} — ${ok ? 'available' : `not found (${t.desc})`}`);
  }
}
