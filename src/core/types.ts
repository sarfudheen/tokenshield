export type MeasurementStatus = 'measured' | 'no-data' | 'unavailable' | 'disabled' | 'not-measurable';

export interface StrategyMeasurement {
  status: MeasurementStatus;
  percent?: number;
  tokensSaved?: number;
  costSavedUsd?: number;
  detail: string;
}

export type ModelTier = 'flagship' | 'standard' | 'lightweight';

export interface DiscoveredModel {
  id: string;
  name: string;
  vendor: string;
  family: string;
  maxInputTokens?: number;
  tier: ModelTier;
}

export interface ModelSavingsRecord {
  modelId: string;
  modelFamily: string;
  tier: ModelTier;
  tokensSaved: number;
  costSavedUsd: number;
  queryCount: number;
}

export interface SessionRoiSummary {
  elapsedMs: number;
  totalTokensSaved: number;
  totalCostSavedUsd: number;
  activeModel: DiscoveredModel;
  perModelSavings: Record<string, ModelSavingsRecord>;
  cacheHits: number;
  mcpLookups: number;
  filesPruned: number;
  diffEditsCount: number;
  guardrailStops: number;
  downshiftedTasksCount: number;
}
