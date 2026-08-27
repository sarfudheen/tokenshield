// Tier-B savings MODEL. Everything here is an estimate derived from the real
// repository metrics plus explicit assumptions — it is never presented as a
// measurement. The extension does not sit in the LLM request path, so real
// per-request token counts are not observable; this models the envelope
// instead, and every output is tagged `modeled: true` so the UI must label it.
import { DEFAULT_ASSUMPTIONS, RepositoryMetrics, SavingsAssumptions, SavingsEstimate } from './types';

function pctReduction(without: number, withGraph: number): number {
  if (without <= 0) { return 0; }
  return Math.max(0, Math.min(100, ((without - withGraph) / without) * 100));
}

/**
 * Models "load the whole repository" (no graph) vs. "load ~N graph-scoped
 * files" for a single representative request. The with-graph token figure is
 * scaled from the whole-repo figure by the fraction of files a graph retrieval
 * touches — a proportional approximation, stated as such via the assumptions.
 */
export function estimateSavings(
  repo: RepositoryMetrics,
  assumptions: SavingsAssumptions = DEFAULT_ASSUMPTIONS,
): SavingsEstimate {
  const { avgFilesRetrievedPerQuery, charsPerToken, usdPer1kPromptTokens } = assumptions;

  const filesWithout = Math.max(repo.totalFiles, 1);
  const filesWith = Math.min(avgFilesRetrievedPerQuery, filesWithout);
  const retrievalFraction = filesWith / filesWithout;

  const tokensWithout = Math.round(repo.sourceBytes / charsPerToken);
  const tokensWith = Math.round(tokensWithout * retrievalFraction);

  const bytesToKb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;
  const costOf = (tokens: number) => (tokens / 1000) * usdPer1kPromptTokens;

  const costWithout = costOf(tokensWithout);
  const costWith = costOf(tokensWith);

  return {
    modeled: true,
    assumptions,
    estimatedFilesWithoutGraph: filesWithout,
    estimatedFilesWithGraph: filesWith,
    estimatedPromptTokensWithoutGraph: tokensWithout,
    estimatedPromptTokensWithGraph: tokensWith,
    estimatedContextKbWithoutGraph: bytesToKb(repo.sourceBytes),
    estimatedContextKbWithGraph: bytesToKb(repo.sourceBytes * retrievalFraction),
    filesReductionPercent: Math.round(pctReduction(filesWithout, filesWith) * 10) / 10,
    tokenReductionPercent: Math.round(pctReduction(tokensWithout, tokensWith) * 10) / 10,
    estimatedCostWithoutGraphUsd: Math.round(costWithout * 10000) / 10000,
    estimatedCostWithGraphUsd: Math.round(costWith * 10000) / 10000,
    estimatedCostSavedUsd: Math.round((costWithout - costWith) * 10000) / 10000,
  };
}
