import * as vscode from 'vscode';

export type Profile = 'full' | 'debug' | 'planning' | 'review' | 'custom';
export type VerbosityLevel = 'light' | 'full' | 'ultra';
export type TargetTool = 'copilot' | 'claude' | 'codex' | 'antigravity';

export interface StrategyState {
  codeGraph: boolean;
  outputCompression: boolean;
  verbosityControl: boolean;
  sessionManagement: boolean;
  semanticCache: boolean;
  astSkeleton: boolean;
  contextExclusion: boolean;
  diffOnlyOutput: boolean;
  agentGuardrails: boolean;
  smartModelRouting: boolean;
  gitDiffContext: boolean;
  kvCacheAlignment: boolean;
  commentStripper: boolean;
  testFailureIsolator: boolean;
  rangeSlicing: boolean;
}

export interface ModelPricing {
  /** Cost per 1M prompt/input tokens in USD */
  inputPerMillion: number;
  /** Cost per 1M completion/output tokens in USD */
  outputPerMillion: number;
}

export interface PricingTable {
  flagship: ModelPricing;    // e.g. Claude Opus, o1 ($15 / $75)
  standard: ModelPricing;    // e.g. Claude Sonnet, GPT-4o ($3 / $15)
  lightweight: ModelPricing; // e.g. GPT-4o-mini, Haiku, Flash ($0.15 / $0.60)
}

export interface GuardrailConfig {
  maxRetries: number;
  maxFilesPerTask: number;
  maxFileReads: number;
}

export interface CodeGraphProject {
  name: string;
  path: string;
  enabled: boolean;
}

export interface ExtensionConfig {
  enabled: boolean;
  autoApply: boolean;
  targetTools: TargetTool[];
  profile: Profile;
  activeStrategies: StrategyState;
  verbosityLevel: VerbosityLevel;
  preserveExistingInstructions: boolean;
  autoInstallTools: boolean;
  configureMcpOnActivation: boolean;
  codeGraphProjects: CodeGraphProject[];
  telemetryEnabled: boolean;
  guardrails: GuardrailConfig;
  pricing: PricingTable;
  useVscodeStorage: boolean;
}

export const DEFAULT_PRICING: PricingTable = {
  flagship: { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  standard: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  lightweight: { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

export const TOTAL_STRATEGIES = 15;

export const PROFILE_STRATEGIES: Record<Profile, StrategyState> = {
  full: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,
    testFailureIsolator: true, rangeSlicing: true,
  },
  debug: {
    codeGraph: true, outputCompression: false, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: false,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: false,
    testFailureIsolator: true, rangeSlicing: true,
  },
  planning: {
    codeGraph: true, outputCompression: true, verbosityControl: false,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: false, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,
    testFailureIsolator: false, rangeSlicing: true,
  },
  review: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: false, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,
    testFailureIsolator: true, rangeSlicing: true,
  },
  custom: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,
    testFailureIsolator: true, rangeSlicing: true,
  },
};

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('aiTokenOptimizer');
  return {
    enabled: config.get<boolean>('enabled', true),
    autoApply: config.get<boolean>('autoApply', true),
    targetTools: config.get<TargetTool[]>('targetTools', ['copilot']),
    profile: config.get<Profile>('profile', 'full'),
    activeStrategies: config.get<StrategyState>('activeStrategies', PROFILE_STRATEGIES.full),
    verbosityLevel: config.get<VerbosityLevel>('verbosityLevel', 'full'),
    preserveExistingInstructions: config.get<boolean>('preserveExistingInstructions', true),
    autoInstallTools: config.get<boolean>('autoInstallTools', true),
    configureMcpOnActivation: config.get<boolean>('configureMcpOnActivation', true),
    codeGraphProjects: config.get<CodeGraphProject[]>('codeGraphProjects', []),
    telemetryEnabled: config.get<boolean>('telemetry.enabled', true),
    guardrails: config.get<GuardrailConfig>('guardrails', {
      maxRetries: 3,
      maxFilesPerTask: 10,
      maxFileReads: 2,
    }),
    pricing: config.get<PricingTable>('pricing', DEFAULT_PRICING),
    useVscodeStorage: config.get<boolean>('useVscodeStorage', true),
  };
}

export function getEffectiveStrategies(config: ExtensionConfig): StrategyState {
  if (config.profile === 'custom') {
    return config.activeStrategies;
  }
  return PROFILE_STRATEGIES[config.profile];
}

export function countActiveStrategies(strategies: StrategyState): number {
  return Object.values(strategies).filter(Boolean).length;
}

export async function updateProfile(profile: Profile): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiTokenOptimizer');
  await config.update('profile', profile, vscode.ConfigurationTarget.Workspace);
}

export async function updateStrategies(strategies: Partial<StrategyState>): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiTokenOptimizer');
  const current = config.get<StrategyState>('activeStrategies', PROFILE_STRATEGIES.full);
  await config.update('activeStrategies', { ...current, ...strategies }, vscode.ConfigurationTarget.Workspace);
  await config.update('profile', 'custom', vscode.ConfigurationTarget.Workspace);
}

export async function saveCodeGraphProjects(projects: CodeGraphProject[]): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiTokenOptimizer');
  await config.update('codeGraphProjects', projects, vscode.ConfigurationTarget.Workspace);
}
