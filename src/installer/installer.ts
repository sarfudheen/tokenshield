import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawnSync } from 'child_process';
import { TOOLS_TO_INSTALL, ToolInstallEntry } from '../core/constants';
import { memoizeTtl } from '../cache/ttlCache';

export interface InstallResult {
  packageName: string;
  installed: boolean;
  alreadyInstalled: boolean;
  error?: string;
}

/**
 * Check if binary is available across Windows, macOS, and Linux.
 */
export function isBinaryAvailable(bin: string): boolean {
  return memoizeTtl(`which:${bin}`, 60_000, () => {
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? `where.exe ${bin}` : `which ${bin}`;
      execSync(cmd, { stdio: 'ignore', timeout: 3000, shell: true });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Called on demand or via command palette.
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
        `TokenShield: ${tool.name} is not installed.\n${tool.description}`,
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
    { location: vscode.ProgressLocation.Notification, title: `TokenShield: Installing ${tool.name}…`, cancellable: false },
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
  const isWindows = process.platform === 'win32';
  const result = spawnSync('npm', ['install', '-g', npmPackage], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    encoding: 'utf-8',
    shell: isWindows,
  });
  if (result.status === 0) {
    outputChannel.appendLine(`[installer] ✓ ${binaryName} installed`);
    vscode.window.showInformationMessage(`TokenShield: ${binaryName} installed successfully.`);
    return { packageName: binaryName, installed: true, alreadyInstalled: false };
  }
  const errMsg = result.stderr?.trim() || result.error?.message || 'npm install failed';
  outputChannel.appendLine(`[installer] ✗ ${binaryName}: ${errMsg}`);
  vscode.window.showWarningMessage(`Could not auto-install ${binaryName}. Run manually in terminal: npm install -g ${npmPackage}`);
  return { packageName: binaryName, installed: false, alreadyInstalled: false, error: errMsg };
}

function installViaBrewOrShell(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel): InstallResult {
  const isMac = os.platform() === 'darwin';
  const isWindows = process.platform === 'win32';
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
    outputChannel.appendLine(`[installer] brew failed, trying fallback: ${brewErr}`);
  }

  if (isWindows) {
    // Windows fallback for rtk
    outputChannel.appendLine(`[installer] Optional CLI tool ${tool.name} can be installed manually on Windows.`);
    vscode.window.showInformationMessage(
      `TokenShield: ${tool.name} is an optional CLI helper. TokenShield works in instruction mode out-of-the-box without it.`,
      'Got it'
    );
    return { packageName: tool.name, installed: false, alreadyInstalled: false, error: 'Windows manual install' };
  }

  // Mac / Linux shell script fallback
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
    return { packageName: tool.name, installed: false, alreadyInstalled: false, error: shellErr };
  }

  const err = `No valid install method for ${tool.name} on ${os.platform()}`;
  outputChannel.appendLine(`[installer] ✗ ${err}`);
  return { packageName: tool.name, installed: false, alreadyInstalled: false, error: err };
}

function runPostInstall(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel): void {
  if (!tool.postInstallArgs || tool.postInstallArgs.length === 0) { return; }
  const [cmd, ...args] = [tool.name, ...tool.postInstallArgs];
  outputChannel.appendLine(`[installer] Post-install: ${cmd} ${args.join(' ')}`);
  const isWindows = process.platform === 'win32';
  const result = spawnSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    encoding: 'utf-8',
    shell: isWindows,
    env: { ...process.env },
  });
  if (result.status === 0) {
    outputChannel.appendLine(`[installer] ✓ ${tool.name} post-install complete`);
  } else {
    outputChannel.appendLine(`[installer] ⚠ Post-install: ${result.stderr?.trim() || result.error?.message || 'deferred'}`);
  }
}

async function offerWireCodegraphAgents(outputChannel: vscode.OutputChannel): Promise<void> {
  const isWindows = process.platform === 'win32';
  const result = spawnSync('codegraph', ['install', '--yes'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
    encoding: 'utf-8',
    shell: isWindows,
  });
  if (result.status === 0) {
    outputChannel.appendLine('[installer] ✓ CodeGraph agent wiring complete');
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
    { bin: 'rtk',       label: 'rtk',        desc: 'CLI output compression proxy' },
    { bin: 'codegraph', label: 'codegraph',   desc: 'semantic code indexing' },
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
