import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

suite('Semantic Cache', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-cache-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  suite('Query Normalization', () => {
    test('lowercases, drops stopwords and short tokens', () => {
      const { normalizeQuery } = require('../../src/cache/similarity');
      const tokens = normalizeQuery('How do I clear the Cache?');
      assert.ok(!tokens.includes('how'));
      assert.ok(!tokens.includes('the'));
      assert.ok(tokens.includes('clear'));
      assert.ok(tokens.some((t: string) => t.startsWith('cach')));
    });

    test('splits camelCase identifiers', () => {
      const { normalizeQuery } = require('../../src/cache/similarity');
      const tokens = normalizeQuery('what does getUserData return');
      assert.ok(tokens.includes('get'));
      assert.ok(tokens.includes('user'));
      assert.ok(tokens.includes('data'));
    });

    test('stems common suffixes consistently', () => {
      const { normalizeQuery } = require('../../src/cache/similarity');
      assert.deepStrictEqual(normalizeQuery('clearing'), normalizeQuery('clear'));
      assert.deepStrictEqual(normalizeQuery('cached'), normalizeQuery('caches'));
    });
  });

  suite('Cache Key', () => {
    test('is order-insensitive', () => {
      const { normalizeQuery, cacheKey } = require('../../src/cache/similarity');
      const a = cacheKey(normalizeQuery('how do I clear the cache'));
      const b = cacheKey(normalizeQuery('clear cache how'));
      assert.strictEqual(a, b);
    });

    test('differs for different queries', () => {
      const { normalizeQuery, cacheKey } = require('../../src/cache/similarity');
      const a = cacheKey(normalizeQuery('clear the cache'));
      const b = cacheKey(normalizeQuery('install the tools'));
      assert.notStrictEqual(a, b);
    });
  });

  suite('Similarity Matching', () => {
    test('paraphrased queries match', () => {
      const { normalizeQuery, buildIdf, isMatch } = require('../../src/cache/similarity');
      const a = normalizeQuery('how do I clear the semantic cache data');
      const b = normalizeQuery('how to clear cached semantic data');
      const idf = buildIdf([a, b]);
      assert.strictEqual(isMatch(a, b, idf), true);
    });

    test('unrelated queries do not match', () => {
      const { normalizeQuery, buildIdf, isMatch } = require('../../src/cache/similarity');
      const a = normalizeQuery('how do I clear the semantic cache');
      const b = normalizeQuery('what is the deployment pipeline for production releases');
      const idf = buildIdf([a, b]);
      assert.strictEqual(isMatch(a, b, idf), false);
    });

    test('single-token queries never fuzzy-match', () => {
      const { normalizeQuery, buildIdf, isMatch } = require('../../src/cache/similarity');
      const a = normalizeQuery('cache');
      const b = normalizeQuery('caching');
      const idf = buildIdf([a, b]);
      assert.strictEqual(isMatch(a, b, idf), false);
    });

    test('two-token queries can fuzzy-match when topically related', () => {
      const { normalizeQuery, buildIdf, isMatch } = require('../../src/cache/similarity');
      const a = normalizeQuery('vscode extension');
      const b = normalizeQuery('how does this vscode extension work');
      const idf = buildIdf([a, b]);
      assert.strictEqual(isMatch(a, b, idf), true);
    });

    test('two-token queries on different topics do not fuzzy-match', () => {
      const { normalizeQuery, buildIdf, isMatch } = require('../../src/cache/similarity');
      const a = normalizeQuery('vscode extension');
      const b = normalizeQuery('install tools');
      const idf = buildIdf([a, b]);
      assert.strictEqual(isMatch(a, b, idf), false);
    });
  });

  suite('SemanticCacheStore', () => {
    test('store then exact lookup roundtrip', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('what is rtk', 'a CLI proxy that compresses output');
      const result = store.lookup('what is rtk');
      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.exact, true);
      assert.strictEqual(result.answer, 'a CLI proxy that compresses output');
    });

    test('fuzzy lookup hits on paraphrase', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('how does the marker based merge logic work', 'it splices between START/END markers');
      const result = store.lookup('how does the marker based merging logic actually work in generators');
      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.exact, false);
      assert.strictEqual(result.answer, 'it splices between START/END markers');
    });

    test('misses on unrelated query', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('what is rtk output compression', 'a CLI proxy');
      const result = store.lookup('where are the unit tests for the dashboard panel');
      assert.strictEqual(result.hit, false);
    });

    test('creates self-ignoring .aicache directory', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      new SemanticCacheStore(tmpDir).store('q one two three', 'a');
      const gitignore = fs.readFileSync(path.join(tmpDir, '.aicache', '.gitignore'), 'utf-8');
      assert.strictEqual(gitignore.trim(), '*');
    });

    test('recovers from corrupt cache file', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const dir = path.join(tmpDir, '.aicache');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'semantic-cache.json'), '{not json!!', 'utf-8');
      const store = new SemanticCacheStore(tmpDir);
      assert.strictEqual(store.lookup('anything at all here').hit, false);
      store.store('recovery works fine now', 'yes');
      assert.strictEqual(store.lookup('recovery works fine now').hit, true);
    });

    test('purges entries older than 14 days on save', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      let fakeNow = Date.now();
      const store = new SemanticCacheStore(tmpDir, () => fakeNow);
      store.store('old question about something', 'old answer');
      fakeNow += 15 * 24 * 60 * 60 * 1000; // 15 days later
      store.store('new question about anything', 'new answer');
      assert.strictEqual(store.lookup('old question about something').hit, false);
      assert.strictEqual(store.lookup('new question about anything').hit, true);
    });

    test('evicts LRU beyond max entries', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const dir = path.join(tmpDir, '.aicache');
      fs.mkdirSync(dir, { recursive: true });
      const now = Date.now();
      // Pre-seed a full cache (300 entries) with entry-0 as least recently used
      const entries = [];
      for (let i = 0; i < 300; i++) {
        entries.push({
          id: `id-${i}`, query: `q ${i}`, tokens: [`token${i}a`, `token${i}b`, `token${i}c`],
          answer: 'a', scope: 'durable', gitHead: null,
          createdAt: now - i, lastAccessedAt: now - i, hits: 0,
        });
      }
      fs.writeFileSync(path.join(dir, 'semantic-cache.json'), JSON.stringify({ version: 1, entries }), 'utf-8');

      const store = new SemanticCacheStore(tmpDir);
      store.store('brand new incoming entry', 'newest');
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'semantic-cache.json'), 'utf-8'));
      assert.strictEqual(saved.entries.length, 300);
      assert.ok(!saved.entries.some((e: { id: string }) => e.id === 'id-299'), 'LRU entry should be evicted');
      assert.ok(saved.entries.some((e: { answer: string }) => e.answer === 'newest'));
    });

    test('flags stale hits when git HEAD moved', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('what does the activate function do', 'registers commands');
      // Simulate the entry having been stored at a different HEAD
      const filePath = path.join(tmpDir, '.aicache', 'semantic-cache.json');
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.entries[0].gitHead = 'deadbeef0000000000000000000000000000dead';
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');

      const result = new SemanticCacheStore(tmpDir).lookup('what does the activate function do');
      assert.strictEqual(result.hit, true);
      assert.strictEqual(result.stale, true);
    });

    test('stats reflect entries and hits', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('question number one here', 'answer'.repeat(10));
      store.lookup('question number one here');
      store.lookup('question number one here');
      const stats = store.stats();
      assert.strictEqual(stats.entries, 1);
      assert.strictEqual(stats.totalHits, 2);
      assert.ok(stats.estTokensSaved > 0);
    });

    test('clear empties the cache', () => {
      const { SemanticCacheStore } = require('../../src/cache/store');
      const store = new SemanticCacheStore(tmpDir);
      store.store('something to be cleared away', 'gone soon');
      store.clear();
      assert.strictEqual(store.lookup('something to be cleared away').hit, false);
      assert.strictEqual(store.stats().entries, 0);
    });
  });

  suite('TTL Memoizer', () => {
    test('returns cached value within TTL and recomputes after expiry', () => {
      const { memoizeTtl, invalidateTtl } = require('../../src/cache/ttlCache');
      invalidateTtl();
      let fakeNow = 1_000_000;
      let calls = 0;
      const compute = () => { calls++; return calls; };

      assert.strictEqual(memoizeTtl('t:key', 5000, compute, () => fakeNow), 1);
      fakeNow += 4000;
      assert.strictEqual(memoizeTtl('t:key', 5000, compute, () => fakeNow), 1);
      fakeNow += 2000;
      assert.strictEqual(memoizeTtl('t:key', 5000, compute, () => fakeNow), 2);
    });

    test('prefix invalidation drops only matching keys', () => {
      const { memoizeTtl, invalidateTtl } = require('../../src/cache/ttlCache');
      invalidateTtl();
      const now = () => 0;
      memoizeTtl('measure:codegraph:a', 10_000, () => 'cg', now);
      memoizeTtl('measure:rtk:a', 10_000, () => 'rtk', now);

      invalidateTtl('measure:codegraph');
      let cgCalls = 0;
      memoizeTtl('measure:codegraph:a', 10_000, () => { cgCalls++; return 'cg2'; }, now);
      assert.strictEqual(cgCalls, 1, 'codegraph key should have been invalidated');
      assert.strictEqual(memoizeTtl('measure:rtk:a', 10_000, () => 'rtk2', now), 'rtk', 'rtk key should survive');
    });
  });
});
