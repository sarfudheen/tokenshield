import { ExtensionConfig, PricingTable } from '../core/config';
import { DiscoveredModel, ModelSavingsRecord, SessionRoiSummary } from '../core/types';
import { getActiveModel } from '../models/modelDetector';

export class EnterpriseRoiEngine {
  private sessionStartTime: number;
  private modelSavings: Map<string, ModelSavingsRecord> = new Map();
  private cacheHitsCount = 0;
  private cacheTokensSaved = 0;
  private skeletonTokensSaved = 0;
  private skeletonFilesCount = 0;
  private diffEditsCount = 0;
  private diffTokensSaved = 0;
  private rtkTokensSaved = 0;
  private exclusionTokensSaved = 0;
  private guardrailStops = 0;
  private guardrailTokensSaved = 0;
  private downshiftedCount = 0;
  private downshiftedCostArbitrage = 0;

  constructor() {
    this.sessionStartTime = Date.now();
  }

  recordCacheHit(tokensSaved: number, model: DiscoveredModel, pricing: PricingTable): void {
    this.cacheHitsCount++;
    this.cacheTokensSaved += tokensSaved;
    this.addModelTokens(model, tokensSaved, pricing);
  }

  recordSkeletonRead(tokensSaved: number, model: DiscoveredModel, pricing: PricingTable): void {
    this.skeletonFilesCount++;
    this.skeletonTokensSaved += tokensSaved;
    this.addModelTokens(model, tokensSaved, pricing);
  }

  recordDiffEdit(tokensSaved: number, model: DiscoveredModel, pricing: PricingTable): void {
    this.diffEditsCount++;
    this.diffTokensSaved += tokensSaved;
    this.addModelTokens(model, tokensSaved, pricing);
  }

  recordRtkGain(tokensSaved: number, model: DiscoveredModel, pricing: PricingTable): void {
    this.rtkTokensSaved += tokensSaved;
    this.addModelTokens(model, tokensSaved, pricing);
  }

  recordContextExclusion(tokensSaved: number): void {
    this.exclusionTokensSaved = tokensSaved;
  }

  recordGuardrailStop(tokensSaved: number, model: DiscoveredModel, pricing: PricingTable): void {
    this.guardrailStops++;
    this.guardrailTokensSaved += tokensSaved;
    this.addModelTokens(model, tokensSaved, pricing);
  }

  recordDownshift(tokens: number, flagshipRate: number, lightweightRate: number): void {
    this.downshiftedCount++;
    // Cost difference between running on flagship vs lightweight
    const saved = (tokens / 1_000_000) * (flagshipRate - lightweightRate);
    this.downshiftedCostArbitrage += Math.max(0, saved);
  }

  private addModelTokens(model: DiscoveredModel, tokens: number, pricing: PricingTable): void {
    const key = model.family;
    const tierPricing = pricing[model.tier];
    const cost = (tokens / 1_000_000) * tierPricing.inputPerMillion;

    const existing = this.modelSavings.get(key) || {
      modelId: model.id,
      modelFamily: model.family,
      tier: model.tier,
      tokensSaved: 0,
      costSavedUsd: 0,
      queryCount: 0,
    };

    existing.tokensSaved += tokens;
    existing.costSavedUsd += cost;
    existing.queryCount += 1;
    this.modelSavings.set(key, existing);
  }

  async getSessionSummary(config: ExtensionConfig): Promise<SessionRoiSummary> {
    const activeModel = await getActiveModel();
    const pricing = config.pricing;

    // Total tokens saved = cache + skeleton + diff + rtk + exclusion + guardrail
    const totalTokens = this.cacheTokensSaved +
      this.skeletonTokensSaved +
      this.diffTokensSaved +
      this.rtkTokensSaved +
      this.exclusionTokensSaved +
      this.guardrailTokensSaved;

    let totalCost = this.downshiftedCostArbitrage;
    for (const record of this.modelSavings.values()) {
      totalCost += record.costSavedUsd;
    }

    // If no model specific calls yet, estimate using active model rate
    if (totalCost === 0 && totalTokens > 0) {
      const activeRate = pricing[activeModel.tier].inputPerMillion;
      totalCost = (totalTokens / 1_000_000) * activeRate;
    }

    const perModel: Record<string, ModelSavingsRecord> = {};
    for (const [k, v] of this.modelSavings.entries()) {
      perModel[k] = { ...v };
    }

    return {
      elapsedMs: Date.now() - this.sessionStartTime,
      totalTokensSaved: totalTokens,
      totalCostSavedUsd: totalCost,
      activeModel,
      perModelSavings: perModel,
      cacheHits: this.cacheHitsCount,
      mcpLookups: this.cacheHitsCount,
      filesPruned: this.skeletonFilesCount,
      diffEditsCount: this.diffEditsCount,
      guardrailStops: this.guardrailStops,
      downshiftedTasksCount: this.downshiftedCount,
    };
  }
}

// Global engine singleton
let engineInstance: EnterpriseRoiEngine | undefined;

export function getRoiEngine(): EnterpriseRoiEngine {
  if (!engineInstance) {
    engineInstance = new EnterpriseRoiEngine();
  }
  return engineInstance;
}
