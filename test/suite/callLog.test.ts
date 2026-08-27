import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('MCP Call Log (token-cache telemetry)', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-calllog-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('starts at all-zero counts', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    assert.deepStrictEqual(store.counts(), { lookups: 0, hits: 0, misses: 0, staleHits: 0, stores: 0, skeletonViews: 0, prunes: 0 });
  });

  test('recordLookup with a hit increments lookups and hits', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordLookup({ hit: true });
    const counts = store.counts();
    assert.strictEqual(counts.lookups, 1);
    assert.strictEqual(counts.hits, 1);
    assert.strictEqual(counts.misses, 0);
  });

  test('recordLookup with a stale hit increments staleHits too', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordLookup({ hit: true, stale: true });
    const counts = store.counts();
    assert.strictEqual(counts.hits, 1);
    assert.strictEqual(counts.staleHits, 1);
  });

  test('recordLookup with a miss increments lookups and misses, not hits', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordLookup({ hit: false });
    const counts = store.counts();
    assert.strictEqual(counts.lookups, 1);
    assert.strictEqual(counts.misses, 1);
    assert.strictEqual(counts.hits, 0);
  });

  test('recordStore increments stores only', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordStore();
    const counts = store.counts();
    assert.strictEqual(counts.stores, 1);
    assert.strictEqual(counts.lookups, 0);
  });

  test('recordSkeleton increments skeletonViews only', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordSkeleton();
    const counts = store.counts();
    assert.strictEqual(counts.skeletonViews, 1);
    assert.strictEqual(counts.lookups, 0);
  });

  test('recordPrune increments prunes only', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const store = new CallLogStore(tmpDir);
    store.recordPrune();
    const counts = store.counts();
    assert.strictEqual(counts.prunes, 1);
  });

  test('counts persist across a new instance pointed at the same workspace', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    new CallLogStore(tmpDir).recordLookup({ hit: true });
    const reopened = new CallLogStore(tmpDir);
    assert.strictEqual(reopened.counts().hits, 1);
  });

  test('recovers from a corrupt call-log file', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const dir = path.join(tmpDir, '.aicache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'call-log.json'), '{not json!!', 'utf-8');
    const store = new CallLogStore(tmpDir);
    assert.deepStrictEqual(store.counts(), { lookups: 0, hits: 0, misses: 0, staleHits: 0, stores: 0, skeletonViews: 0, prunes: 0 });
    store.recordStore();
    assert.strictEqual(store.counts().stores, 1);
  });

  test('reuses the shared .aicache/.gitignore without clobbering it', () => {
    const { CallLogStore } = require('../../src/cache/callLog');
    const dir = path.join(tmpDir, '.aicache');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.gitignore'), '*\n', 'utf-8');
    new CallLogStore(tmpDir).recordStore();
    assert.strictEqual(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8'), '*\n');
  });
});
