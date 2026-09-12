import * as vscode from 'vscode';
import { resolveTargetTools } from './ideDetector';

export type Profile = 'full' | 'debug' | 'planning' | 'review' | 'custom';
export type VerbosityLevel = 'light' | 'full' | 'ultra';
export type TargetTool = 'copilot' | 'claude' | 'codex' | 'antigravity';
export type CommentStrippingMode = 'headers-only' | 'aggressive' | 'off';

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
  inlineChatScopePinning: boolean;   // VS Code inline chat scope constraint
  copilotIgnoreGeneration: boolean;  // .copilotignore file generation
  copilotEditsAwareness: boolean;    // Copilot Edits session awareness
  threadResetTrigger: boolean;       // Proactive thread reset nudge
  headroomCompression: boolean;      // Reversible Headroom context compression (CCR)
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

export type GithubStructureMode = 'auto' | 'flat' | 'structured';

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
  githubStructureMode: GithubStructureMode;
  generateAgentFiles: boolean;
  commentStrippingMode: CommentStrippingMode;
  autoDetectTools: boolean;
}

export const DEFAULT_PRICING: PricingTable = {
  flagship: { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  standard: { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  lightweight: { inputPerMillion: 0.15, outputPerMillion: 0.60 },
};

export const PROFILE_STRATEGIES: Record<Profile, StrategyState> = {
  full: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,  // mode controlled by commentStrippingMode setting
    testFailureIsolator: true, rangeSlicing: true,
    inlineChatScopePinning: true, copilotIgnoreGeneration: true,
    copilotEditsAwareness: true, threadResetTrigger: true,
    headroomCompression: true,
  },
  debug: {
    codeGraph: true, outputCompression: false, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: false,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: false,
    testFailureIsolator: true, rangeSlicing: true,
    inlineChatScopePinning: true, copilotIgnoreGeneration: true,
    copilotEditsAwareness: true, threadResetTrigger: false,
    headroomCompression: false,
  },
  planning: {
    codeGraph: true, outputCompression: true, verbosityControl: false,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: false, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,  // mode controlled by commentStrippingMode setting
    testFailureIsolator: false, rangeSlicing: true,
    inlineChatScopePinning: true, copilotIgnoreGeneration: true,
    copilotEditsAwareness: true, threadResetTrigger: true,
    headroomCompression: true,
  },
  review: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: false, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: false,  // disabled for review: reviewers need comments for intent
    testFailureIsolator: true, rangeSlicing: true,
    inlineChatScopePinning: true, copilotIgnoreGeneration: true,
    copilotEditsAwareness: true, threadResetTrigger: true,
    headroomCompression: true,
  },
  custom: {
    codeGraph: true, outputCompression: true, verbosityControl: true,
    sessionManagement: true, semanticCache: true,
    astSkeleton: true, contextExclusion: true, diffOnlyOutput: true,
    agentGuardrails: true, smartModelRouting: true,
    gitDiffContext: true, kvCacheAlignment: true, commentStripper: true,
    testFailureIsolator: true, rangeSlicing: true,
    inlineChatScopePinning: true, copilotIgnoreGeneration: true,
    copilotEditsAwareness: true, threadResetTrigger: true,
    headroomCompression: true,
  },
};

export const TOTAL_STRATEGIES = Object.keys(PROFILE_STRATEGIES.full).length;

export function getConfig(): ExtensionConfig {
  const sculptConfig = vscode.workspace.getConfiguration('tokensculpt');
  const legacyConfig = vscode.workspace.getConfiguration('tokenshield');

  function getSetting<T>(key: string, defaultVal: T): T {
    const inspectSculpt = sculptConfig.inspect<T>(key);
    if (inspectSculpt && (inspectSculpt.globalValue !== undefined || inspectSculpt.workspaceValue !== undefined || inspectSculpt.workspaceFolderValue !== undefined)) {
      return sculptConfig.get<T>(key, defaultVal);
    }
    const inspectLegacy = legacyConfig.inspect<T>(key);
    if (inspectLegacy && (inspectLegacy.globalValue !== undefined || inspectLegacy.workspaceValue !== undefined || inspectLegacy.workspaceFolderValue !== undefined)) {
      return legacyConfig.get<T>(key, defaultVal);
    }
    return sculptConfig.get<T>(key, defaultVal);
  }

  return {
    enabled: getSetting<boolean>('enabled', true),
    autoApply: getSetting<boolean>('autoApply', true),
    targetTools: resolveTargetTools(
      getSetting<TargetTool[]>('targetTools', []),
      getSetting<boolean>('autoDetectTools', true),
    ),
    profile: getSetting<Profile>('profile', 'full'),
    activeStrategies: getSetting<StrategyState>('activeStrategies', PROFILE_STRATEGIES.full),
    verbosityLevel: getSetting<VerbosityLevel>('verbosityLevel', 'full'),
    preserveExistingInstructions: getSetting<boolean>('preserveExistingInstructions', true),
    autoInstallTools: getSetting<boolean>('autoInstallTools', true),
    configureMcpOnActivation: getSetting<boolean>('configureMcpOnActivation', true),
    codeGraphProjects: getSetting<CodeGraphProject[]>('codeGraphProjects', []),
    telemetryEnabled: getSetting<boolean>('telemetry.enabled', true),
    guardrails: getSetting<GuardrailConfig>('guardrails', {
      maxRetries: 3,
      maxFilesPerTask: 10,
      maxFileReads: 2,
    }),
    pricing: getSetting<PricingTable>('pricing', DEFAULT_PRICING),
    useVscodeStorage: getSetting<boolean>('useVscodeStorage', true),
    githubStructureMode: getSetting<GithubStructureMode>('githubStructureMode', 'auto'),
    generateAgentFiles: getSetting<boolean>('generateAgentFiles', false),
    commentStrippingMode: getSetting<CommentStrippingMode>('commentStrippingMode', 'headers-only'),
    autoDetectTools: getSetting<boolean>('autoDetectTools', true),
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
  const config = vscode.workspace.getConfiguration('tokensculpt');
  await config.update('profile', profile, vscode.ConfigurationTarget.Workspace);
}

export async function updateStrategies(strategies: Partial<StrategyState>): Promise<void> {
  const config = vscode.workspace.getConfiguration('tokensculpt');
  const current = config.get<StrategyState>('activeStrategies', PROFILE_STRATEGIES.full);
  await config.update('activeStrategies', { ...current, ...strategies }, vscode.ConfigurationTarget.Workspace);
  await config.update('profile', 'custom', vscode.ConfigurationTarget.Workspace);
}

export async function saveCodeGraphProjects(projects: CodeGraphProject[]): Promise<void> {
  const config = vscode.workspace.getConfiguration('tokensculpt');
  await config.update('codeGraphProjects', projects, vscode.ConfigurationTarget.Workspace);
}
