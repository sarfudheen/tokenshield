/**
 * Formatters for tokens, costs, and percentage metrics across TokenShield UI.
 */

/**
 * Formats a token count into a human-readable compact string:
 * - < 1,000 -> "950"
 * - >= 1,000 -> "12.5k"
 * - >= 1,000,000 -> "1.5M"
 * - >= 1,000,000,000 -> "2.1B"
 */
export function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  }
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return `${tokens}`;
}

/**
 * Formats USD cost:
 * - 0 -> "$0.0000"
 * - > 0 and < 0.0001 -> "<$0.0001"
 * - >= 0.0001 -> "$0.0015"
 */
export function formatCost(cost: number): string {
  if (cost < 0.0001 && cost > 0) {
    return '<$0.0001';
  }
  return `$${cost.toFixed(4)}`;
}
