/**
 * TokenShield — KV-Cache Hit Maximizer & Prompt Normalizer
 *
 * Modern frontier LLMs (Anthropic Claude 3.5+, OpenAI GPT-4o+, Google Gemini)
 * offer a 75% to 90% discount on cached input tokens.
 *
 * Prompt caching requires exact byte-prefix matching (usually 1,024-token minimums).
 * Dynamic timestamps, shifting headers, or ephemeral session IDs at the top of a prompt
 * invalidate the entire cache downstream.
 *
 * This module normalizes prompts into:
 *   1. A deterministic, byte-stable static prefix (instructions, rules, tools)
 *   2. An ephemeral suffix (turn timestamps, dynamic counters, user query)
 */

export interface CacheabilityAnalysis {
  totalTokensEst: number;
  staticPrefixTokensEst: number;
  volatileTokensEst: number;
  cacheEfficiencyScore: number; // 0 to 100%
  hasTopLevelVolatileTokens: boolean;
  volatileElementsFound: string[];
  isCacheThresholdMet: boolean; // Anthropic/OpenAI 1024-token threshold
  estimatedDiscountPct: number;
}

export interface PromptCacheNormalizationResult {
  normalizedText: string;
  originalTokensEst: number;
  staticPrefixTokensEst: number;
  volatileSuffixTokensEst: number;
  cacheEfficiencyScore: number;
  volatileElementsExtracted: string[];
  isCacheThresholdMet: boolean;
  estimatedDiscountPct: number;
}

const VOLATILE_PATTERNS = [
  // ISO Timestamps & local time lines
  /(?:The current local time is|Current time|Timestamp|Current date)[:=]?\s*[\d\-T:.Z+ ]{10,35}/gi,
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
  // Turn / Session counters at top of context
  /(?:Turn|Message|Step)\s*#?\d+\s*(?:\(.*\))?[:=]?/gi,
  /(?:Conversation|Session)\s*ID[:=]\s*[0-9a-fA-F\-]{8,36}/gi,
  // Ephemeral UUID patterns in header blocks
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
];

/**
 * Estimate token count using TokenShield's 3.8 char/token standard.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) { return 0; }
  return Math.max(1, Math.ceil(text.length / 3.8));
}

/**
 * Analyzes a prompt text for KV-cache efficiency and checks for top-of-file cache breakers.
 */
export function analyzePromptCacheability(prompt: string): CacheabilityAnalysis {
  const totalTokensEst = estimateTokens(prompt);
  const volatileElementsFound: string[] = [];

  // Check the first 2,000 chars (the critical prefix zone)
  const prefixSample = prompt.slice(0, 2000);
  let hasTopLevelVolatileTokens = false;

  for (const pattern of VOLATILE_PATTERNS) {
    const matches = prefixSample.match(pattern);
    if (matches && matches.length > 0) {
      hasTopLevelVolatileTokens = true;
      for (const m of matches) {
        const clean = m.trim();
        if (clean && !volatileElementsFound.includes(clean)) {
          volatileElementsFound.push(clean.length > 40 ? clean.slice(0, 37) + '...' : clean);
        }
      }
    }
  }

  // Calculate efficiency
  const volatileCharCount = volatileElementsFound.reduce((acc, el) => acc + el.length, 0);
  const volatileTokensEst = estimateTokens(prompt.slice(0, volatileCharCount));
  const staticPrefixTokensEst = Math.max(0, totalTokensEst - volatileTokensEst);

  const isCacheThresholdMet = totalTokensEst >= 1024;
  let cacheEfficiencyScore = isCacheThresholdMet ? 90 : 30;
  if (hasTopLevelVolatileTokens) {
    // Top-level volatile tokens invalidate everything below them
    cacheEfficiencyScore = Math.max(10, Math.round(cacheEfficiencyScore * 0.2));
  }

  const estimatedDiscountPct = hasTopLevelVolatileTokens ? 0 : (isCacheThresholdMet ? 90 : 0);

  return {
    totalTokensEst,
    staticPrefixTokensEst,
    volatileTokensEst,
    cacheEfficiencyScore,
    hasTopLevelVolatileTokens,
    volatileElementsFound,
    isCacheThresholdMet,
    estimatedDiscountPct,
  };
}

/**
 * Normalizes prompt context for maximum KV-cache hits:
 * Extracts volatile ephemeral headers from the prefix and relocates them to the suffix.
 */
export function normalizePromptForCache(prompt: string): PromptCacheNormalizationResult {
  if (!prompt || prompt.trim().length === 0) {
    return {
      normalizedText: prompt || '',
      originalTokensEst: 0,
      staticPrefixTokensEst: 0,
      volatileSuffixTokensEst: 0,
      cacheEfficiencyScore: 100,
      volatileElementsExtracted: [],
      isCacheThresholdMet: false,
      estimatedDiscountPct: 0,
    };
  }

  const lines = prompt.split(/\r?\n/);
  const staticLines: string[] = [];
  const extractedVolatile: string[] = [];

  let inPrefixHeaderZone = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // The header prefix zone is considered the first 50 lines or until standard markdown headings start
    if (i > 50 && line.startsWith('# ')) {
      inPrefixHeaderZone = false;
    }

    if (inPrefixHeaderZone) {
      let isVolatile = false;
      for (const pattern of VOLATILE_PATTERNS) {
        // Reset regex state
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          isVolatile = true;
          extractedVolatile.push(line.trim());
          break;
        }
      }

      if (isVolatile) {
        continue; // Exclude from static prefix
      }
    }

    staticLines.push(line);
  }

  // Construct normalized text: Static Prefix FIRST, Ephemeral Suffix LAST
  let normalizedText = staticLines.join('\n').trim();
  if (extractedVolatile.length > 0) {
    normalizedText += '\n\n<!-- TOKENSHIELD:EPHEMERAL_SUFFIX -->\n' +
      '### Ephemeral Turn Metadata\n' +
      extractedVolatile.map(v => `- ${v}`).join('\n');
  }

  const originalTokensEst = estimateTokens(prompt);
  const staticPrefixTokensEst = estimateTokens(staticLines.join('\n'));
  const volatileSuffixTokensEst = estimateTokens(extractedVolatile.join('\n'));
  const isCacheThresholdMet = staticPrefixTokensEst >= 1024;
  const estimatedDiscountPct = isCacheThresholdMet ? 90 : 0;
  const cacheEfficiencyScore = isCacheThresholdMet ? 95 : 60;

  return {
    normalizedText,
    originalTokensEst,
    staticPrefixTokensEst,
    volatileSuffixTokensEst,
    cacheEfficiencyScore,
    volatileElementsExtracted: extractedVolatile,
    isCacheThresholdMet,
    estimatedDiscountPct,
  };
}

/**
 * Pads a static prefix to the nearest 1,024-token cache boundary using clean comments
 * to ensure providers commit the block to persistent KV memory.
 */
export function padToCacheBoundary(text: string, blockSizeTokens: number = 1024): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens < blockSizeTokens) {
    const tokensNeeded = blockSizeTokens - currentTokens;
    const charsNeeded = Math.ceil(tokensNeeded * 3.8);
    const paddingLine = `\n<!-- TokenShield KV-Cache Boundary Pad [Target: ${blockSizeTokens} tok]: ${'-'.repeat(Math.max(10, charsNeeded - 60))} -->\n`;
    return text + paddingLine;
  }
  return text;
}
