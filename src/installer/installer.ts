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
 * Check if a binary is available across Windows, macOS, and Linux.
 */
export function isBinaryAvailable(bin: string): boolean {
  return memoizeTtl(`which:${bin}`, 30_000, () => {
    try {
      const isWindows = process.platform === 'win32';
      const cmd = isWindows ? `where.exe ${bin}` : `which ${bin}`;
      execSync(cmd, { stdio: 'ignore', timeout: 3000, shell: isWindows });
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Automatically check and install all supporting CLI tools.
 */
export async function installAllTools(outputChannel: vscode.OutputChannel, isInteractive = false): Promise<InstallResult[]> {
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
      outputChannel.appendLine(`[installer] ✓ ${tool.name} available on system`);
    } else {
      outputChannel.appendLine(`[installer] ○ ${tool.name} missing — attempting automatic installation...`);
      const result = await installTool(tool, outputChannel, isInteractive);
      results.push(result);
      if (result.installed && tool.name === 'codegraph') {
        await offerWireCodegraphAgents(outputChannel);
      }
    }
  }

  return results;
}

async function installTool(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel, isInteractive = false): Promise<InstallResult> {
  const title = `TokenShield: Installing ${tool.name}…`;
  
  const doInstall = async () => {
    try {
      if (tool.method === 'npm-global' && tool.npmPackage) {
        return installViaNpm(tool.name, tool.npmPackage, outputChannel, isInteractive);
      }
      if (tool.method === 'brew' || tool.method === 'shell-script') {
        return installViaBrewOrShell(tool, outputChannel, isInteractive);
      }
      throw new Error(`Unsupported install method: ${tool.method}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[installer] ✗ ${tool.name} install error: ${msg}`);
      return { packageName: tool.name, installed: false, alreadyInstalled: false, error: msg };
    }
  };

  if (isInteractive) {
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title, cancellable: false },
      doInstall
    );
  }

  return doInstall();
}

function installViaNpm(binaryName: string, npmPackage: string, outputChannel: vscode.OutputChannel, isInteractive: boolean): InstallResult {
  outputChannel.appendLine(`[installer] Running: npm install -g ${npmPackage}`);
  const isWindows = process.platform === 'win32';
  try {
    const result = spawnSync('npm', ['install', '-g', npmPackage], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
      encoding: 'utf-8',
      shell: isWindows,
    });
    if (result.status === 0) {
      outputChannel.appendLine(`[installer] ✓ ${binaryName} installed successfully`);
      if (isInteractive) {
        vscode.window.showInformationMessage(`TokenShield: ${binaryName} installed successfully.`);
      }
      return { packageName: binaryName, installed: true, alreadyInstalled: false };
    }
    const errMsg = result.stderr?.trim() || result.error?.message || 'npm install failed';
    outputChannel.appendLine(`[installer] ✗ ${binaryName} installation failed: ${errMsg}`);
    if (isInteractive) {
      vscode.window.showWarningMessage(`Could not auto-install ${binaryName}. Run manually: npm install -g ${npmPackage}`);
    }
    return { packageName: binaryName, installed: false, alreadyInstalled: false, error: errMsg };
  } catch (e: any) {
    outputChannel.appendLine(`[installer] ✗ ${binaryName} spawn failed: ${e.message}`);
    return { packageName: binaryName, installed: false, alreadyInstalled: false, error: e.message };
  }
}

function installViaBrewOrShell(tool: ToolInstallEntry, outputChannel: vscode.OutputChannel, isInteractive: boolean): InstallResult {
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
    outputChannel.appendLine(`[installer] brew failed: ${brewErr}`);
  }

  if (isWindows) {
    outputChannel.appendLine(`[installer] Note: ${tool.name} is a native POSIX binary. Running in instruction mode on Windows.`);
    return { packageName: tool.name, installed: false, alreadyInstalled: false, error: 'Platform instruction mode' };
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
