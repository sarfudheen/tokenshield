import * as vscode from 'vscode';
import { getConfig, getEffectiveStrategies, countActiveStrategies, updateProfile, updateStrategies, Profile, TOTAL_STRATEGIES, StrategyState, PROFILE_STRATEGIES } from '../core/config';
import { PROFILE_DESCRIPTIONS, STRATEGY_DESCRIPTIONS, STRATEGY_CAP_LABELS } from '../core/constants';

export async function showProfilePicker(): Promise<void> {
  const config = getConfig();
  const enabledLabel = config.enabled
    ? '$(shield) Disable TokenShield'
    : '$(shield) Enable TokenShield';
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
    placeHolder: `TokenShield: ${config.enabled ? 'ON' : 'OFF'}  |  Profile: ${config.profile.toUpperCase()}  |  Select action`,
    title: 'TokenShield Control Center',
  });

  if (!selected) {
    return;
  }

  if (selected.label.includes('Disable TokenShield') || selected.label.includes('Enable TokenShield')) {
    await vscode.commands.executeCommand('tokenshield.toggle');
    return;
  }

  if (selected.label.includes('Validate All')) {
    await vscode.commands.executeCommand('tokenshield.healthCheck');
    return;
  }

  if (selected.label.includes('Toggle Individual')) {
    await showStrategyToggle();
    return;
  }

  if (selected.label.includes('Dashboard')) {
    await vscode.commands.executeCommand('tokenshield.dashboard');
    return;
  }

  if (selected.label.includes('Regenerate')) {
    await vscode.commands.executeCommand('tokenshield.regenerate');
    return;
  }

  if (selected.label.includes('Context Exclusions')) {
    await vscode.commands.executeCommand('tokenshield.exclusions');
    return;
  }

  const profileMap: Record<string, Profile> = {};
  for (const [key, desc] of Object.entries(PROFILE_DESCRIPTIONS)) {
    profileMap[desc] = key as Profile;
  }

  const profile = profileMap[selected.label];
  if (profile) {
    await updateProfile(profile);
    vscode.window.showInformationMessage(`TokenShield: Switched to ${profile.toUpperCase()} profile`);
  }
}

const STRATEGY_KEYS = Object.keys(PROFILE_STRATEGIES.full) as (keyof StrategyState)[];

async function showStrategyToggle(): Promise<void> {
  const config = getConfig();
  const strategies = getEffectiveStrategies(config);

  const items: vscode.QuickPickItem[] = STRATEGY_KEYS.map((key) => {
    const parts = STRATEGY_DESCRIPTIONS[key].split(' — ');
    return {
      label: `${strategies[key] ? '$(check)' : '$(circle-large-outline)'} ${parts[0]}`,
      description: parts[1] || '',
      picked: strategies[key],
    };
  });

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Toggle optimization features (modifications switch profile to Custom)',
    title: 'TokenShield — Optimization Features',
    canPickMany: true,
  });

  if (!selected) {
    return;
  }

  const newStrategies: Record<string, boolean> = {};
  for (const key of STRATEGY_KEYS) {
    const featureName = STRATEGY_DESCRIPTIONS[key].split(' — ')[0];
    newStrategies[key] = selected.some((i) => i.label.includes(featureName));
  }

  await updateStrategies(newStrategies);
  const activeCount = Object.values(newStrategies).filter(Boolean).length;
  vscode.window.showInformationMessage(
    `TokenShield: ${activeCount}/${TOTAL_STRATEGIES} features active`
  );
}
