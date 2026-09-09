import * as assert from 'assert';
import {
  analyzePromptCacheability,
  normalizePromptForCache,
  padToCacheBoundary,
  estimateTokens,
} from '../../src/strategies/kvCacheOptimizer';

suite('KV-Cache Hit Maximizer & Prompt Normalizer', () => {
  suite('analyzePromptCacheability', () => {
    test('detects top-level volatile timestamps and turn headers', () => {
      const prompt = `The current local time is: 2026-09-09T14:00:00Z
Session ID: 550e8400-e29b-41d4-a716-446655440000
Turn #14

# System Instructions
You are an expert assistant. Always follow these rules:
1. Be concise.
2. Return code in unified diffs.`;

      const analysis = analyzePromptCacheability(prompt);
      assert.strictEqual(analysis.hasTopLevelVolatileTokens, true);
      assert.ok(analysis.volatileElementsFound.length >= 2);
      assert.ok(analysis.cacheEfficiencyScore < 50, 'Cache score should be degraded by top-level volatile tokens');
    });

    test('rates clean static prompts with high cache efficiency score', () => {
      // Repeat static rules to exceed 1,024 tokens (~3,900 chars)
      const staticRules = `# System Instructions
You are an expert programming assistant operating in TokenShield environment.
Follow all user rules precisely. Never include chit-chat.
Propose edits as unified diffs.
Maintain 100% on-device execution.
`.repeat(20);

      const analysis = analyzePromptCacheability(staticRules);
      assert.strictEqual(analysis.hasTopLevelVolatileTokens, false);
      assert.strictEqual(analysis.volatileElementsFound.length, 0);
      assert.strictEqual(analysis.isCacheThresholdMet, true);
      assert.strictEqual(analysis.estimatedDiscountPct, 90);
      assert.strictEqual(analysis.cacheEfficiencyScore, 90);
    });

    test('recognizes small prompts below the 1024-token threshold', () => {
      const shortPrompt = '# Rules\nDo something quickly.';
      const analysis = analyzePromptCacheability(shortPrompt);
      assert.strictEqual(analysis.isCacheThresholdMet, false);
      assert.strictEqual(analysis.estimatedDiscountPct, 0);
    });
  });

  suite('normalizePromptForCache', () => {
    test('relocates volatile headers from top of prompt down to suffix', () => {
      const prompt = `The current local time is: 2026-09-09T14:00:00Z
Turn #5 (User Turn)

# Antigravity Rules
- Rule 1: Always be concise.
- Rule 2: Use CodeGraph before broad search.
- Rule 3: Propose targeted unified diffs.`;

      const result = normalizePromptForCache(prompt);
      assert.ok(result.volatileElementsExtracted.length >= 1);
      assert.ok(!result.normalizedText.startsWith('The current local time is'));
      assert.ok(result.normalizedText.startsWith('# Antigravity Rules'));
      assert.ok(result.normalizedText.includes('<!-- TOKENSHIELD:EPHEMERAL_SUFFIX -->'));
      assert.ok(result.normalizedText.includes('Ephemeral Turn Metadata'));
      assert.ok(result.normalizedText.includes('The current local time is'));
    });

    test('preserves empty or whitespace prompts safely', () => {
      const result = normalizePromptForCache('');
      assert.strictEqual(result.normalizedText, '');
      assert.strictEqual(result.originalTokensEst, 0);
    });

    test('leaves already-clean static prompts unchanged', () => {
      const cleanPrompt = `# Antigravity Rules
- Rule 1: Always be concise.
- Rule 2: Use CodeGraph before broad search.`;

      const result = normalizePromptForCache(cleanPrompt);
      assert.strictEqual(result.volatileElementsExtracted.length, 0);
      assert.strictEqual(result.normalizedText, cleanPrompt);
    });
  });

  suite('padToCacheBoundary', () => {
    test('pads text shorter than blockSizeTokens to boundary', () => {
      const text = '# Small Rule\nDo this.';
      const padded = padToCacheBoundary(text, 100);
      const paddedTokens = estimateTokens(padded);
      assert.ok(paddedTokens >= 100);
      assert.ok(padded.includes('TokenShield KV-Cache Boundary Pad'));
    });

    test('does not pad text that already exceeds blockSizeTokens', () => {
      const largeText = 'A'.repeat(5000);
      const originalTokens = estimateTokens(largeText);
      const padded = padToCacheBoundary(largeText, 100);
      assert.strictEqual(padded, largeText);
    });
  });
});
