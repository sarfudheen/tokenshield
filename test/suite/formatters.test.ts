import * as assert from 'assert';
import { formatCompactTokens, formatCost } from '../../src/ui/formatters';

suite('UI Formatters — Token & Cost Display', () => {
  test('formats tokens < 1,000 as raw numbers', () => {
    assert.strictEqual(formatCompactTokens(0), '0');
    assert.strictEqual(formatCompactTokens(450), '450');
    assert.strictEqual(formatCompactTokens(999), '999');
  });

  test('formats tokens in thousands as k', () => {
    assert.strictEqual(formatCompactTokens(1_000), '1.0k');
    assert.strictEqual(formatCompactTokens(12_500), '12.5k');
    assert.strictEqual(formatCompactTokens(999_999), '1000.0k');
  });

  test('formats tokens in millions as M', () => {
    assert.strictEqual(formatCompactTokens(1_000_000), '1.0M');
    assert.strictEqual(formatCompactTokens(1_500_000), '1.5M');
    assert.strictEqual(formatCompactTokens(25_400_000), '25.4M');
    assert.strictEqual(formatCompactTokens(999_900_000), '999.9M');
  });

  test('formats tokens in billions as B', () => {
    assert.strictEqual(formatCompactTokens(1_000_000_000), '1.0B');
    assert.strictEqual(formatCompactTokens(2_500_000_000), '2.5B');
  });

  test('formats costs correctly', () => {
    assert.strictEqual(formatCost(0), '$0.0000');
    assert.strictEqual(formatCost(0.00005), '<$0.0001');
    assert.strictEqual(formatCost(0.0015), '$0.0015');
    assert.strictEqual(formatCost(1.25), '$1.2500');
  });
});
