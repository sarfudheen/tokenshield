import * as assert from 'assert';

suite('Session Tracker', () => {
  suite('formatDuration', () => {
    test('formats seconds only', () => {
      const { formatDuration } = require('../../src/session/tracker');
      assert.strictEqual(formatDuration(45_000), '45s');
    });

    test('formats minutes and seconds', () => {
      const { formatDuration } = require('../../src/session/tracker');
      assert.strictEqual(formatDuration(125_000), '2m 5s');
    });

    test('formats hours and minutes', () => {
      const { formatDuration } = require('../../src/session/tracker');
      assert.strictEqual(formatDuration(2 * 3600_000 + 5 * 60_000), '2h 5m');
    });
  });

  suite('getSessionSummary', () => {
    test('reports inactive before startSession is called', () => {
      // Fresh module instance so no prior test's startSession() leaks in
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { getSessionSummary } = require('../../src/session/tracker');
      const summary = getSessionSummary(null);
      assert.strictEqual(summary.active, false);
      assert.strictEqual(summary.elapsedMs, 0);
    });

    test('elapsed time grows with injected clock', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      let fakeNow = 1_000_000;
      startSession(null, () => fakeNow);
      fakeNow += 90_000;
      const summary = getSessionSummary(null, () => fakeNow);
      assert.strictEqual(summary.active, true);
      assert.strictEqual(summary.elapsedMs, 90_000);
    });

    test('computes cache hits and tokens saved as a delta since session start', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      startSession({ entries: 3, totalHits: 5, estTokensSaved: 50 });
      const current = { entries: 4, totalHits: 12, estTokensSaved: 130 };
      const summary = getSessionSummary(current);
      assert.strictEqual(summary.cacheHitsThisSession, 7);
      assert.strictEqual(summary.tokensSavedThisSession, 80);
    });

    test('clamps negative deltas to 0 when the cache was cleared mid-session', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      startSession({ entries: 10, totalHits: 20, estTokensSaved: 200 });
      const clearedThenPartial = { entries: 1, totalHits: 2, estTokensSaved: 10 };
      const summary = getSessionSummary(clearedThenPartial);
      assert.strictEqual(summary.cacheHitsThisSession, 0);
      assert.strictEqual(summary.tokensSavedThisSession, 0);
    });

    test('reindexCount increments via recordReindex', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, recordReindex, getSessionSummary } = require('../../src/session/tracker');
      startSession(null);
      recordReindex();
      recordReindex();
      assert.strictEqual(getSessionSummary(null).reindexCount, 2);
    });

    test('computes MCP call-log deltas since session start', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      startSession(null, Date.now, { lookups: 2, hits: 1, misses: 1, staleHits: 0, stores: 1 });
      const current = { lookups: 5, hits: 3, misses: 2, staleHits: 0, stores: 2 };
      const summary = getSessionSummary(null, Date.now, current);
      assert.strictEqual(summary.mcpLookupsThisSession, 3);
      assert.strictEqual(summary.mcpHitsThisSession, 2);
      assert.strictEqual(summary.mcpMissesThisSession, 1);
      assert.strictEqual(summary.mcpStoresThisSession, 1);
    });

    test('clamps MCP call-log deltas to 0 when counts drop mid-session', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      startSession(null, Date.now, { lookups: 10, hits: 5, misses: 5, staleHits: 0, stores: 4 });
      const current = { lookups: 1, hits: 0, misses: 1, staleHits: 0, stores: 0 };
      const summary = getSessionSummary(null, Date.now, current);
      assert.strictEqual(summary.mcpLookupsThisSession, 0);
      assert.strictEqual(summary.mcpHitsThisSession, 0);
      assert.strictEqual(summary.mcpStoresThisSession, 0);
    });

    test('MCP deltas default to 0 when call counts are omitted (backward-compatible callers)', () => {
      delete require.cache[require.resolve('../../src/session/tracker')];
      const { startSession, getSessionSummary } = require('../../src/session/tracker');
      startSession(null, () => 1_000_000);
      const summary = getSessionSummary(null, () => 1_050_000);
      assert.strictEqual(summary.elapsedMs, 50_000);
      assert.strictEqual(summary.mcpLookupsThisSession, 0);
      assert.strictEqual(summary.mcpStoresThisSession, 0);
    });
  });
});
