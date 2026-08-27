import * as assert from 'assert';

suite('RTK Gain Parser', () => {
  test('parses a real successful summary block', () => {
    const { parseRtkGainOutput } = require('../../src/strategies/rtkGain');
    const fixture = JSON.stringify({
      summary: {
        total_commands: 10, total_input: 5427, total_output: 3763,
        total_saved: 1664, avg_savings_pct: 30.6615072784227, total_time_ms: 67, avg_time_ms: 6,
      },
      daily: [], weekly: [], monthly: [],
    });
    const result = parseRtkGainOutput(fixture);
    assert.strictEqual(result.status, 'measured');
    assert.strictEqual(result.summary?.totalCommands, 10);
    assert.strictEqual(result.summary?.totalSavedTokens, 1664);
    assert.ok(Math.abs((result.summary?.avgSavingsPct ?? 0) - 30.6615072784227) < 1e-9);
  });

  test('reports no-data when total_commands is 0', () => {
    const { parseRtkGainOutput } = require('../../src/strategies/rtkGain');
    const fixture = JSON.stringify({
      summary: { total_commands: 0, total_input: 0, total_output: 0, total_saved: 0, avg_savings_pct: 0, total_time_ms: 0 },
      daily: [], weekly: [], monthly: [],
    });
    const result = parseRtkGainOutput(fixture);
    assert.strictEqual(result.status, 'no-data');
    assert.ok(!result.summary);
  });

  test('reports error on malformed JSON', () => {
    const { parseRtkGainOutput } = require('../../src/strategies/rtkGain');
    const result = parseRtkGainOutput('{not valid json');
    assert.strictEqual(result.status, 'error');
  });

  test('reports error when summary block is missing (schema drift)', () => {
    const { parseRtkGainOutput } = require('../../src/strategies/rtkGain');
    const result = parseRtkGainOutput(JSON.stringify({ daily: [] }));
    assert.strictEqual(result.status, 'error');
  });

  test('never fabricates a percentage when summary fields are the wrong type', () => {
    const { parseRtkGainOutput } = require('../../src/strategies/rtkGain');
    const result = parseRtkGainOutput(JSON.stringify({ summary: { total_commands: 'ten' } }));
    assert.strictEqual(result.status, 'error');
  });
});
