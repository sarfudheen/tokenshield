import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, updateProfile, updateStrategies, Profile, TOTAL_STRATEGIES, StrategyState, PROFILE_STRATEGIES } from '../core/config';
import { PROFILE_DESCRIPTIONS, STRATEGY_DESCRIPTIONS, STRATEGY_CAP_LABELS } from '../core/constants';

export async function showProfilePicker(): Promise<void> {
  const config = getConfig();
  const enabledLabel = config.enabled
    ? '$(shield) Disable TokenSculpt'
    : '$(shield) Enable TokenSculpt';
  const enabledDesc = config.enabled
    ? 'Turn off all token optimizations'
    : 'Turn on token optimizations';

  const items: vscode.QuickPickItem[] = [
    { label: enabledLabel, description: enabledDesc },
    { label: '$(check-all) Run Health Check', description: `Live health-check across all ${TOTAL_STRATEGIES} optimization features` },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: PROFILE_DESCRIPTIONS.full,     description: config.profile === 'full'     ? '(active)' : '' },
    { label: PROFILE_DESCRIPTIONS.debug,    description: config.profile === 'debug'    ? '(active)' : '' },
    { label: PROFILE_DESCRIPTIONS.planning, description: config.profile === 'planning' ? '(active)' : '' },
    { label: PROFILE_DESCRIPTIONS.review,   description: config.profile === 'review'   ? '(active)' : '' },
    { label: PROFILE_DESCRIPTIONS.custom,   description: config.profile === 'custom'   ? '(active)' : '' },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(settings-gear) Toggle Individual Features...', description: '' },
    { label: '$(dashboard) Open Savings Dashboard', description: '' },
    { label: '$(refresh) Regenerate AI Instruction Files', description: '' },
    { label: '$(file-symlink-directory) Configure Context Exclusions...', description: '' },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `TokenSculpt: ${config.enabled ? 'ON' : 'OFF'}  |  Profile: ${config.profile.toUpperCase()}  |  Select action`,
    title: 'TokenSculpt Control Center',
  });

  if (!selected) {
    return;
  }

  if (selected.label.includes('Disable TokenSculpt') || selected.label.includes('Enable TokenSculpt')) {
    await vscode.commands.executeCommand('tokensculpt.toggle');
    return;
  }

  if (selected.label.includes('Health Check') || selected.label.includes('Validate All')) {
    await vscode.commands.executeCommand('tokensculpt.healthCheck');
    return;
  }

  if (selected.label.includes('Toggle Individual')) {
    await showSingleFeatureToggle();
    return;
  }

  if (selected.label.includes('Dashboard')) {
    await vscode.commands.executeCommand('tokensculpt.dashboard');
    return;
  }

  if (selected.label.includes('Regenerate')) {
    await vscode.commands.executeCommand('tokensculpt.regenerate');
    return;
  }

  if (selected.label.includes('Context Exclusions')) {
    await vscode.commands.executeCommand('tokensculpt.exclusions');
    return;
  }

  const profileMap: Record<string, Profile> = {};
  for (const [key, desc] of Object.entries(PROFILE_DESCRIPTIONS)) {
    profileMap[desc] = key as Profile;
  }

  const profile = profileMap[selected.label];
  if (profile) {
    await updateProfile(profile);
    vscode.window.showInformationMessage(`TokenSculpt: Switched to ${profile.toUpperCase()} profile`);
  }
}

export const STRATEGY_KEYS = Object.keys(PROFILE_STRATEGIES.full) as (keyof StrategyState)[];

export async function showSingleFeatureToggle(): Promise<void> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);

  const items: (vscode.QuickPickItem & { key: keyof StrategyState })[] = STRATEGY_KEYS.map((key) => {
    const isEnabled = !!strategies[key];
    const parts = STRATEGY_DESCRIPTIONS[key].split(' — ');
    const title = parts[0];
    const desc = parts[1] || '';
    return {
      key,
      label: isEnabled ? `$(pass-filled) ${title}` : `$(circle-slash) ${title}`,
      description: isEnabled ? '[ENABLED] — Click to turn OFF' : '[DISABLED] — Click to turn ON',
      detail: desc,
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Click any feature to toggle it ON or OFF instantly',
    title: 'TokenSculpt — 1-Click Feature Switch',
  });

  if (!selected) { return; }

  const currentVal = !!strategies[selected.key];
  const newVal = !currentVal;
  await updateStrategies({ [selected.key]: newVal });

  const featureName = STRATEGY_DESCRIPTIONS[selected.key].split(' — ')[0];
  vscode.window.showInformationMessage(
    `TokenSculpt: ${featureName} is now ${newVal ? 'ENABLED' : 'DISABLED'}`
  );
}
