import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Minimal RepositoryMetrics factory for math/persistence tests.
function makeRepo(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    repositoryName: 'demo',
    sourceBytes: 400_000,
    totalFiles: 100,
    totalDirectories: 20,
    totalPackages: null,
    totalClasses: 40,
    totalInterfaces: 12,
    totalEnums: 3,
    totalMethods: 200,
    totalFunctions: 80,
    totalApis: null,
    totalDatabaseQueries: null,
    totalGraphNodes: 500,
    totalGraphRelationships: 1500,
    indexSizeBytes: 1_200_000,
    graphBuildTimeMs: null,
    languages: { typescript: 90, javascript: 10 },
    nodeKinds: { class: 40, interface: 12 },
    edgeKinds: { calls: 300 },
    source: 'sqlite',
    ...overrides,
  };
}

suite('Telemetry — Savings Estimator (Tier B, modeled)', () => {
  test('reduction is computed from file fraction and flagged as modeled', () => {
    const { estimateSavings, DEFAULT_ASSUMPTIONS } = require('../../src/telemetry/estimator');
    const est = estimateSavings(makeRepo(), DEFAULT_ASSUMPTIONS);

    assert.strictEqual(est.modeled, true);
    // 8 of 100 files retrieved → 92% files reduction.
    assert.strictEqual(est.estimatedFilesWithGraph, 8);
    assert.strictEqual(est.filesReductionPercent, 92);
    // whole-repo tokens = 400000 / 4 = 100000; graph = 8% of that = 8000.
    assert.strictEqual(est.estimatedPromptTokensWithoutGraph, 100_000);
    assert.strictEqual(est.estimatedPromptTokensWithGraph, 8_000);
    assert.strictEqual(est.tokenReductionPercent, 92);
    assert.ok(est.estimatedCostSavedUsd > 0);
  });

  test('never divides by zero or reports negative reduction on an empty repo', () => {
    const { estimateSavings } = require('../../src/telemetry/estimator');
    const est = estimateSavings(makeRepo({ totalFiles: 0, sourceBytes: 0 }));
    assert.ok(est.filesReductionPercent >= 0 && est.filesReductionPercent <= 100);
    assert.ok(est.tokenReductionPercent >= 0);
    assert.strictEqual(est.estimatedCostSavedUsd, 0);
  });

  test('caps with-graph files at total files when repo is tiny', () => {
    const { estimateSavings } = require('../../src/telemetry/estimator');
    const est = estimateSavings(makeRepo({ totalFiles: 3, sourceBytes: 12_000 }));
    assert.strictEqual(est.estimatedFilesWithGraph, 3);
    assert.strictEqual(est.filesReductionPercent, 0);
  });
});

suite('Telemetry — Rating bands', () => {
  test('maps values to excellent / good / needs-improvement', () => {
    const { rate } = require('../../src/telemetry');
    const band = { excellentAtLeast: 80, goodAtLeast: 50 };
    assert.strictEqual(rate(95, band), 'excellent');
    assert.strictEqual(rate(60, band), 'good');
    assert.strictEqual(rate(20, band), 'needs-improvement');
  });

  test('inverts bands when lower is better (e.g. latency)', () => {
    const { rate } = require('../../src/telemetry');
    const band = { excellentAtLeast: 150, goodAtLeast: 400, lowerIsBetter: true };
    assert.strictEqual(rate(120, band), 'excellent');
    assert.strictEqual(rate(300, band), 'good');
    assert.strictEqual(rate(900, band), 'needs-improvement');
  });
});

suite('Telemetry — Store persistence', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-telemetry-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('writes latest snapshot and appends history rows', () => {
    const { TelemetryStore } = require('../../src/telemetry/store');
    let t = 1000;
    const store = new TelemetryStore(tmpDir, () => t);

    store.recordRepositories([makeRepo()]);
    t = 2000;
    store.recordRepositories([makeRepo({ totalFiles: 110 })]);

    const latest = store.readLatest();
    assert.ok(latest);
    assert.strictEqual(latest.repositories[0].totalFiles, 110);
    assert.strictEqual(latest.updatedAt, 2000);

    const history = store.readHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].files, 100);
    assert.strictEqual(history[1].files, 110);
    assert.strictEqual(history[1].t, 2000);
  });

  test('creates a self-ignoring .gitignore in the telemetry dir', () => {
    const { TelemetryStore } = require('../../src/telemetry/store');
    new TelemetryStore(tmpDir).recordRepositories([makeRepo()]);
    const gitignore = path.join(tmpDir, '.aicache', 'telemetry', '.gitignore');
    assert.ok(fs.existsSync(gitignore));
    assert.strictEqual(fs.readFileSync(gitignore, 'utf-8').trim(), '*');
  });

  test('recording an empty list is a no-op', () => {
    const { TelemetryStore } = require('../../src/telemetry/store');
    const store = new TelemetryStore(tmpDir);
    store.recordRepositories([]);
    assert.strictEqual(store.readLatest(), null);
    assert.deepStrictEqual(store.readHistory(), []);
  });
});

suite('Telemetry — Historical analytics', () => {
  const DAY = 86_400_000;
  const NOW = 1_000_000_000_000;
  const row = (t: number, files: number, nodes: number): any => ({
    t, repo: 'demo', files, nodes, edges: nodes * 3, classes: 5, interfaces: 8,
    methods: files * 2, functions: files, indexBytes: files * 10_000,
  });
  const history = [
    row(NOW - 40 * DAY, 30, 300),
    row(NOW - 20 * DAY, 38, 380),
    row(NOW - 5 * DAY, 42, 420),
    row(NOW - 1 * DAY, 44, 460),
  ];

  test('lifetime window trends first→latest with delta and percent', () => {
    const { summarizeWindow } = require('../../src/telemetry/analytics');
    const s = summarizeWindow(history, 'demo', 'lifetime', NOW);
    assert.strictEqual(s.sampleCount, 4);
    assert.strictEqual(s.trends.files.first, 30);
    assert.strictEqual(s.trends.files.latest, 44);
    assert.strictEqual(s.trends.files.delta, 14);
    assert.strictEqual(s.trends.files.deltaPercent, 46.7);
    assert.deepStrictEqual(s.trends.files.series, [30, 38, 42, 44]);
  });

  test('time windows exclude out-of-range samples', () => {
    const { summarizeWindow } = require('../../src/telemetry/analytics');
    assert.strictEqual(summarizeWindow(history, 'demo', '30d', NOW).sampleCount, 3);
    assert.strictEqual(summarizeWindow(history, 'demo', '24h', NOW).sampleCount, 1);
  });

  test('repositoriesInHistory lists distinct repos', () => {
    const { repositoriesInHistory } = require('../../src/telemetry/analytics');
    assert.deepStrictEqual(repositoriesInHistory(history), ['demo']);
  });
});

suite('Telemetry — Sparkline SVG', () => {
  test('renders valid SVG with no NaN coordinates', () => {
    const { sparklineSvg } = require('../../src/telemetry/sparkline');
    const svg = sparklineSvg([30, 38, 42, 44]);
    assert.ok(svg.startsWith('<svg'));
    assert.ok(!svg.includes('NaN'));
  });

  test('handles flat and empty series without dividing by zero', () => {
    const { sparklineSvg } = require('../../src/telemetry/sparkline');
    assert.ok(!sparklineSvg([5, 5, 5]).includes('NaN'));
    assert.ok(sparklineSvg([]).startsWith('<svg'));
  });
});

suite('Telemetry — Export', () => {
  const repo: any = {
    repositoryName: 'demo', sourceBytes: 228000, totalFiles: 44, totalDirectories: 13,
    totalPackages: null, totalClasses: 9, totalInterfaces: 34, totalEnums: 0,
    totalMethods: 71, totalFunctions: 111, totalApis: null, totalDatabaseQueries: null,
    totalGraphNodes: 512, totalGraphRelationships: 1512, indexSizeBytes: 1288000,
    graphBuildTimeMs: null, languages: { typescript: 43 }, nodeKinds: {}, edgeKinds: {}, source: 'sqlite',
  };
  const input = {
    generatedAt: 1_000_000_000_000,
    repositories: [repo],
    estimates: [{ modeled: true, assumptions: { avgFilesRetrievedPerQuery: 8, charsPerToken: 4, usdPer1kPromptTokens: 0.003, baseline: 'whole-repository' }, estimatedFilesWithoutGraph: 44, estimatedFilesWithGraph: 8, estimatedPromptTokensWithoutGraph: 57000, estimatedPromptTokensWithGraph: 10363, estimatedContextKbWithoutGraph: 222.7, estimatedContextKbWithGraph: 40.5, filesReductionPercent: 81.8, tokenReductionPercent: 81.8, estimatedCostWithoutGraphUsd: 0.171, estimatedCostWithGraphUsd: 0.031, estimatedCostSavedUsd: 0.14 }],
    history: [{ t: 1_000_000_000_000, repo: 'demo', files: 44, nodes: 512, edges: 1512, classes: 9, interfaces: 34, methods: 71, functions: 111, indexBytes: 1288000 }],
  };

  test('JSON export is valid JSON and carries the modeled caveat', () => {
    const { exportTelemetry } = require('../../src/telemetry/export');
    const json = exportTelemetry(input, 'json');
    const parsed = JSON.parse(json);
    assert.ok(parsed.note.includes('modeled'));
    assert.strictEqual(parsed.repositories[0].totalFiles, 44);
  });

  test('CSV export escapes and includes header + snapshot', () => {
    const { exportTelemetry } = require('../../src/telemetry/export');
    const csv = exportTelemetry(input, 'csv');
    assert.ok(csv.includes('timestamp_iso'));
    assert.ok(csv.includes('est_token_reduction_pct'));
  });

  test('Markdown export labels savings as modeled', () => {
    const { exportTelemetry } = require('../../src/telemetry/export');
    const md = exportTelemetry(input, 'markdown');
    assert.ok(md.includes('# AI Token Optimizer'));
    assert.ok(/modeled/i.test(md));
  });
});

suite('Telemetry — CodeGraph DB reader (graceful degradation)', () => {
  test('locateDb returns null when no index exists', () => {
    const { locateDb } = require('../../src/telemetry/codegraphDb');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-nodb-'));
    try {
      assert.strictEqual(locateDb(tmp), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('query returns null on a nonexistent database rather than throwing', () => {
    const { query } = require('../../src/telemetry/codegraphDb');
    const result = query(path.join(os.tmpdir(), 'definitely-missing.db'), 'SELECT 1;');
    assert.strictEqual(result, null);
  });
});
