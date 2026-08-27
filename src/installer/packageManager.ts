import * as fs from 'fs';
import * as path from 'path';

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

export function detectPackageManager(workspacePath: string): PackageManager | null {
  if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) {
    return 'yarn';
  }
  if (fs.existsSync(path.join(workspacePath, 'package-lock.json'))) {
    return 'npm';
  }
  if (fs.existsSync(path.join(workspacePath, 'package.json'))) {
    return 'npm';
  }
  return null;
}

export function getInstallCommand(pm: PackageManager, packages: string[], isDev: boolean, global: boolean): string {
  if (global) {
    switch (pm) {
      case 'npm': return `npm install -g ${packages.join(' ')}`;
      case 'yarn': return `yarn global add ${packages.join(' ')}`;
      case 'pnpm': return `pnpm add -g ${packages.join(' ')}`;
    }
  }

  const devFlag = isDev ? ' -D' : '';
  switch (pm) {
    case 'npm': return `npm install${devFlag} ${packages.join(' ')}`;
    case 'yarn': return `yarn add${isDev ? ' --dev' : ''} ${packages.join(' ')}`;
    case 'pnpm': return `pnpm add${devFlag} ${packages.join(' ')}`;
  }
}

export function isPackageInstalled(workspacePath: string, packageName: string): boolean {
  const nodeModulesPath = path.join(workspacePath, 'node_modules', packageName);
  return fs.existsSync(nodeModulesPath);
}

export function isGloballyInstalled(packageName: string): boolean {
  try {
    const { execSync } = require('child_process');
    execSync(`which ${packageName}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
