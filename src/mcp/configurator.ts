import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isBinaryAvailable } from '../installer/installer';
import { MCP_CACHE_SERVER_NAME } from '../core/constants';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function detectExistingMcpConfig(workspacePath: string): { vscode: boolean; claude: boolean; antigravity: boolean } {
  const vscodeMcp = hasVsCodeMcpConfig(workspacePath);
  const claudeMcp = hasClaudeMcpConfig();
  const antigravityMcp = hasAntigravityMcpConfig(workspacePath);
  return { vscode: vscodeMcp, claude: claudeMcp, antigravity: antigravityMcp };
}

function hasVsCodeMcpConfig(workspacePath: string): boolean {
  const settingsPath = path.join(workspacePath, '.vscode', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return false;
  }
  try {
    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return !!content['mcp'] || !!content['github.copilot.chat.mcp'];
  } catch {
    return false;
  }
}

function hasClaudeMcpConfig(): boolean {
  const homedir = require('os').homedir();
  const claudeConfigPath = path.join(homedir, '.claude.json');
  return fs.existsSync(claudeConfigPath);
}

function hasAntigravityMcpConfig(workspacePath: string): boolean {
  const antigravityMcpPath = path.join(workspacePath, '.agents', 'mcp_config.json');
  return fs.existsSync(antigravityMcpPath);
}

function detectProjectLanguages(workspacePath: string): string[] {
  const languages: string[] = [];

  if (fs.existsSync(path.join(workspacePath, 'package.json'))) {
    languages.push('javascript', 'typescript');
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, 'package.json'), 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['react'] || allDeps['next']) { languages.push('react'); }
      if (allDeps['next']) { languages.push('nextjs'); }
      if (allDeps['vue']) { languages.push('vue'); }
      if (allDeps['express'] || allDeps['fastify']) { languages.push('node-server'); }
    } catch { /* ignore */ }
  }

  if (fs.existsSync(path.join(workspacePath, 'pyproject.toml')) || fs.existsSync(path.join(workspacePath, 'requirements.txt'))) {
    languages.push('python');
    try {
      const pyproject = fs.readFileSync(path.join(workspacePath, 'pyproject.toml'), 'utf-8');
      if (pyproject.includes('fastapi')) { languages.push('fastapi'); }
      if (pyproject.includes('django')) { languages.push('django'); }
      if (pyproject.includes('flask')) { languages.push('flask'); }
      if (pyproject.includes('pydantic')) { languages.push('pydantic'); }
      if (pyproject.includes('polars')) { languages.push('polars'); }
      if (pyproject.includes('pytest')) { languages.push('pytest'); }
    } catch { /* ignore */ }
  }

  if (fs.existsSync(path.join(workspacePath, 'go.mod'))) {
    languages.push('go');
  }
  if (fs.existsSync(path.join(workspacePath, 'Cargo.toml'))) {
    languages.push('rust');
  }

  return languages;
}

export async function configureMcpServers(outputChannel: vscode.OutputChannel, extensionPath: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    outputChannel.appendLine('[mcp] No workspace folder — skipping MCP configuration');
    return;
  }

  const wsPath = workspaceFolders[0].uri.fsPath;
  const languages = detectProjectLanguages(wsPath);
  outputChannel.appendLine(`[mcp] Detected languages/frameworks: ${languages.join(', ') || 'none'}`);

  // 1. Configure VS Code MCP settings for Copilot
  await configureVsCodeMcp(wsPath, languages, outputChannel, extensionPath);

  // 2. Configure Claude Code MCP
  await configureClaudeMcp(languages, outputChannel, extensionPath, wsPath);

  // 3. Configure Antigravity MCP (.agents/mcp_config.json)
  await configureAntigravityMcp(wsPath, outputChannel, extensionPath);
}

function resolveCacheServerPath(extensionPath: string, wsPath: string): string {
  const wsServer = path.join(wsPath, 'dist', 'cache-server.js');
  if (fs.existsSync(wsServer)) {
    return wsServer;
  }
  return path.join(extensionPath, 'dist', 'cache-server.js');
}

function cacheServerEntry(extensionPath: string, wsPath: string): Record<string, unknown> {
  const serverPath = resolveCacheServerPath(extensionPath, wsPath);
  return {
    command: 'node',
    args: [serverPath, wsPath],
    type: 'stdio',
  };
}

async function configureVsCodeMcp(wsPath: string, languages: string[], outputChannel: vscode.OutputChannel, extensionPath: string): Promise<void> {
  const settingsPath = path.join(wsPath, '.vscode', 'settings.json');
  let settings: Record<string, unknown> = {};

  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
      outputChannel.appendLine('[mcp] Could not parse .vscode/settings.json — creating fresh');
    }
  } else {
    const vscodePath = path.join(wsPath, '.vscode');
    if (!fs.existsSync(vscodePath)) {
      fs.mkdirSync(vscodePath, { recursive: true });
    }
  }

  const mcpServers: Record<string, unknown> = (settings['mcp'] as Record<string, unknown>)?.['servers'] as Record<string, unknown> || {};

  if ('rtk' in mcpServers) {
    delete mcpServers['rtk'];
  }
  if ('codegraph' in mcpServers) {
    delete mcpServers['codegraph'];
  }

  if (!mcpServers['context7']) {
    mcpServers['context7'] = {
      command: 'npx',
      args: ['-y', '@context7/mcp-server'],
      env: {},
    };
    outputChannel.appendLine('[mcp] Added Context7 MCP server for documentation lookup');
  }

  mcpServers[MCP_CACHE_SERVER_NAME] = cacheServerEntry(extensionPath, wsPath);
  outputChannel.appendLine('[mcp] Added token-cache MCP server (local semantic cache, AST skeleton, adaptive pruner)');

  settings['mcp'] = { servers: mcpServers };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  outputChannel.appendLine('[mcp] Updated .vscode/settings.json with MCP configuration');
}

export async function configureClaudeMcp(
  languages: string[],
  outputChannel: vscode.OutputChannel,
  extensionPath: string,
  wsPath: string,
  claudeConfigPath: string = path.join(require('os').homedir(), '.claude.json'),
): Promise<void> {
  if (!fs.existsSync(claudeConfigPath)) {
    outputChannel.appendLine('[mcp] ~/.claude.json not found — skipping Claude Code MCP configuration');
    return;
  }

  let root: Record<string, unknown>;
  try {
    root = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8'));
  } catch {
    outputChannel.appendLine('[mcp] Could not parse ~/.claude.json — skipping Claude Code MCP configuration');
    return;
  }

  const projects = (root['projects'] as Record<string, Record<string, unknown>>) || {};
  const project = projects[wsPath] || {};
  const servers = (project['mcpServers'] as Record<string, McpServerConfig>) || {};

  if ('rtk' in servers) {
    delete servers['rtk'];
  }
  if ('codegraph' in servers) {
    delete servers['codegraph'];
  }

  if (!servers['context7']) {
    servers['context7'] = {
      command: 'npx',
      args: ['-y', '@context7/mcp-server'],
    };
  }

  servers[MCP_CACHE_SERVER_NAME] = cacheServerEntry(extensionPath, wsPath) as unknown as McpServerConfig;
  outputChannel.appendLine(`[mcp] Added token-cache to Claude MCP config (project-scoped to ${wsPath})`);

  project['mcpServers'] = servers;
  projects[wsPath] = project;
  root['projects'] = projects;

  fs.writeFileSync(claudeConfigPath, JSON.stringify(root, null, 2), 'utf-8');
  outputChannel.appendLine('[mcp] Updated ~/.claude.json with project-scoped MCP configuration');
}

/**
 * Configure Antigravity MCP server across workspace and global Antigravity config roots
 */
export async function configureAntigravityMcp(
  wsPath: string,
  outputChannel: vscode.OutputChannel,
  extensionPath: string
): Promise<void> {
  const serverPath = resolveCacheServerPath(extensionPath, wsPath);
  const serverDef = {
    command: 'node',
    args: [serverPath, wsPath],
  };

  const updateConfigFile = (filePath: string, label: string) => {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      let config: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        try {
          config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
          config = {};
        }
      }
      const mcpServers = (config['mcpServers'] as Record<string, unknown>) || {};
      mcpServers[MCP_CACHE_SERVER_NAME] = serverDef;
      config['mcpServers'] = mcpServers;
      fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
      outputChannel.appendLine(`[mcp] Updated ${label} with TokenShield MCP server for Antigravity`);
    } catch (err) {
      outputChannel.appendLine(`[mcp] Failed to update ${label}: ${err}`);
    }
  };

  // 1. .agents/mcp_config.json
  updateConfigFile(path.join(wsPath, '.agents', 'mcp_config.json'), '.agents/mcp_config.json');

  // 2. Root mcp_config.json (if present or in workspace root)
  const rootMcpPath = path.join(wsPath, 'mcp_config.json');
  if (fs.existsSync(rootMcpPath)) {
    updateConfigFile(rootMcpPath, 'mcp_config.json');
  }

  // 3. Global Antigravity config (~/.gemini/config/mcp_config.json)
  const homedir = os.homedir();
  const globalGeminiDir = path.join(homedir, '.gemini', 'config');
  if (fs.existsSync(globalGeminiDir)) {
    updateConfigFile(path.join(globalGeminiDir, 'mcp_config.json'), '~/.gemini/config/mcp_config.json');
  }
}
