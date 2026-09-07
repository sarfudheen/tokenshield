import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { readLifetimeData, saveLifetimeData, clearLifetimeData, LifetimeData } from '../../src/cache/lifetimeStore';
import { recordDiskEvent } from '../../src/cache/eventLog';

suite('Lifetime Data Store (persistence & session management)', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenshield-lifetime-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns default lifetime data when no cache exists', () => {
    const data = readLifetimeData(tmpDir);
    assert.strictEqual(data.version, 1);
    assert.strictEqual(data.currentSessionNumber, 1);
    assert.strictEqual(data.lifetimeTokensSaved, 0);
    assert.strictEqual(data.lifetimeCostSavedUsd, 0);
    assert.deepStrictEqual(data.pastSessions, []);
  });

  test('bootstraps lifetime totals from existing events.json', () => {
    recordDiskEvent(tmpDir, {
      directive: 'AST Skeletons',
      source: 'src/index.ts',
      tokensSaved: 1200,
      costSavedUsd: 0.00018,
      details: 'test event 1',
      sessionNumber: 1,
    });

    recordDiskEvent(tmpDir, {
      directive: 'CLI Output Compression',
      source: 'rtk',
      tokensSaved: 800,
      costSavedUsd: 0.00012,
      details: 'test event 2',
      sessionNumber: 2,
    });

    const data = readLifetimeData(tmpDir);
    assert.strictEqual(data.currentSessionNumber, 2);
    assert.strictEqual(data.lifetimeTokensSaved, 2000);
    assert.strictEqual(Math.round(data.lifetimeCostSavedUsd * 100000) / 100000, 0.0003);
  });

  test('saves and reloads lifetime data accurately', () => {
    const payload: LifetimeData = {
      version: 1,
      currentSessionNumber: 5,
      currentSessionStartedAt: new Date(1000).toISOString(),
      lifetimeTokensSaved: 50000,
      lifetimeCostSavedUsd: 0.0075,
      pastSessions: [
        {
          sessionNumber: 4,
          startedAt: new Date(500).toISOString(),
          endedAt: new Date(999).toISOString(),
          totalTokensSaved: 12000,
          totalCostSavedUsd: 0.0018,
          eventsCount: 3,
          modelName: 'Gemini 3.8 Flash',
          events: [],
        },
      ],
    };

    saveLifetimeData(tmpDir, payload);
    const loaded = readLifetimeData(tmpDir);

    assert.strictEqual(loaded.version, 1);
    assert.strictEqual(loaded.currentSessionNumber, 5);
    assert.strictEqual(loaded.lifetimeTokensSaved, 50000);
    assert.strictEqual(loaded.lifetimeCostSavedUsd, 0.0075);
    assert.strictEqual(loaded.pastSessions.length, 1);
    assert.strictEqual(loaded.pastSessions[0].sessionNumber, 4);
    assert.strictEqual(loaded.pastSessions[0].totalTokensSaved, 12000);
  });

  test('clears lifetime data completely', () => {
    const payload: LifetimeData = {
      version: 1,
      currentSessionNumber: 3,
      currentSessionStartedAt: new Date().toISOString(),
      lifetimeTokensSaved: 10000,
      lifetimeCostSavedUsd: 0.0015,
      pastSessions: [],
    };

    saveLifetimeData(tmpDir, payload);
    assert.strictEqual(readLifetimeData(tmpDir).lifetimeTokensSaved, 10000);

    clearLifetimeData(tmpDir);
    assert.strictEqual(readLifetimeData(tmpDir).lifetimeTokensSaved, 0);
  });
});
