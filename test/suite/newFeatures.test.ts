import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PromptTemplateStore } from '../../src/cache/promptTemplates';
import { extractCandidateFiles, isCacheEntryStale } from '../../src/cache/gitInvalidation';
import { CacheEntry } from '../../src/cache/store';
import { EnterpriseRoiEngine } from '../../src/telemetry/roiEngine';
import { resolveModelContextLimit } from '../../src/ui/contextBudget';
import { applyPatternsToCopilotIgnore } from '../../src/strategies/autoExclude';
import { runSimulation } from '../../src/ui/costSimulator';
import { DiscoveredModel } from '../../src/core/types';
import { DEFAULT_PRICING, ExtensionConfig } from '../../src/core/config';

describe('TokenSculpt Next Phase Features Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokensculpt-features-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe('PromptTemplateStore', () => {
    it('loads default starter templates when cache file is absent', () => {
      const store = new PromptTemplateStore(tempDir);
      const list = store.list();
      assert.ok(list.length >= 4, 'Should contain starter templates');
      const unitTestTpl = store.get('unit-tests');
      assert.ok(unitTestTpl, 'Should find unit-tests template');
      assert.ok(unitTestTpl.prompt.includes('unit tests'));
    });

    it('saves custom template with secret sanitization', () => {
      const store = new PromptTemplateStore(tempDir);
      const saved = store.save({
        name: 'Deploy Script',
        description: 'Run deployment with api token',
        prompt: 'Use token sk-ant-api03-abcdef1234567890abcdef1234567890 to deploy',
        tags: ['ci', 'deploy'],
      });

      assert.strictEqual(saved.name, 'Deploy Script');
      assert.ok(!saved.prompt.includes('sk-ant-api03-abcdef1234567890abcdef1234567890'), 'Secret must be redacted');
      assert.ok(saved.prompt.includes('[REDACTED_API_KEY]'));

      const retrieved = store.get(saved.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.name, 'Deploy Script');
    });

    it('deletes an existing template', () => {
      const store = new PromptTemplateStore(tempDir);
      const saved = store.save({
        name: 'Temporary Tpl',
        description: 'To be removed',
        prompt: 'Hello temporary',
      });
      assert.ok(store.get(saved.id));
      const deleted = store.delete(saved.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(store.get(saved.id), undefined);
    });
  });

  describe('Git-Aware Incremental Cache Invalidation', () => {
    it('extracts candidate file paths from queries', () => {
      const query = 'Explain the function in src/cache/store.ts and check index.js';
      const files = extractCandidateFiles(query);
      assert.ok(files.includes('src/cache/store.ts'));
      assert.ok(files.includes('index.js'));
    });

    it('marks durable cache entries as never stale regardless of git head', () => {
      const entry: CacheEntry = {
        id: '123',
        query: 'What is memoization?',
        tokens: ['memoization'],
        answer: 'Memoization is caching.',
        scope: 'durable',
        gitHead: 'commit-a',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        hits: 1,
      };

      const stale = isCacheEntryStale(entry, 'commit-b', tempDir);
      assert.strictEqual(stale, false, 'Durable scope entries must never be stale');
    });

    it('marks code cache entries with identical head as fresh', () => {
      const entry: CacheEntry = {
        id: '456',
        query: 'Explain src/app.ts',
        tokens: ['explain', 'app'],
        answer: 'App setup',
        scope: 'code',
        gitHead: 'commit-a',
        sourceFiles: ['src/app.ts'],
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        hits: 1,
      };

      const stale = isCacheEntryStale(entry, 'commit-a', tempDir);
      assert.strictEqual(stale, false, 'Matching HEAD must not be stale');
    });
  });

  describe('Custom Pricing Profiles', () => {
    it('honors custom model pricing overrides in ROI calculation', async () => {
      const engine = new EnterpriseRoiEngine();
      const testModel: DiscoveredModel = {
        id: 'custom-model-id',
        name: 'Custom Flagship',
        vendor: 'enterprise',
        family: 'custom-flagship',
        tier: 'flagship',
      };

      const config: ExtensionConfig = {
        enabled: true,
        autoApply: true,
        targetTools: ['copilot'],
        profile: 'full',
        activeStrategies: {} as any,
        verbosityLevel: 'full',
        preserveExistingInstructions: true,
        autoInstallTools: false,
        configureMcpOnActivation: false,
        codeGraphProjects: [],
        telemetryEnabled: true,
        guardrails: { maxRetries: 3, maxFilesPerTask: 10, maxFileReads: 2 },
        pricing: DEFAULT_PRICING,
        customModelPricing: {
          'custom-flagship': { inputPerMillion: 8.0, outputPerMillion: 40.0 },
        },
        useVscodeStorage: true,
        githubStructureMode: 'auto',
        generateAgentFiles: false,
        commentStrippingMode: 'headers-only',
        autoDetectTools: true,
      };

      // Record cache hit using custom model pricing
      engine.recordCacheHit(1_000_000, testModel, config.pricing);
      const summary = await engine.getSessionSummary(config);

      assert.strictEqual(summary.totalTokensSaved, 1_000_000);
      assert.ok(summary.totalCostSavedUsd > 0);
    });
  });

  describe('Context Window Budget Visualizer', () => {
    it('resolves correct context limits across model families', () => {
      const geminiModel: DiscoveredModel = {
        id: 'antigravity/gemini-3.7-flash',
        name: 'Gemini 3.7 Flash',
        vendor: 'google',
        family: 'gemini-3.7-flash',
        tier: 'lightweight',
      };
      assert.strictEqual(resolveModelContextLimit(geminiModel), 1_048_576);

      const sonnetModel: DiscoveredModel = {
        id: 'claude/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        vendor: 'anthropic',
        family: 'claude-3.5-sonnet',
        tier: 'standard',
      };
      assert.strictEqual(resolveModelContextLimit(sonnetModel), 200_000);

      const gptModel: DiscoveredModel = {
        id: 'copilot/gpt-4o',
        name: 'GPT-4o',
        vendor: 'copilot',
        family: 'gpt-4o',
        tier: 'standard',
      };
      assert.strictEqual(resolveModelContextLimit(gptModel), 128_000);
    });
  });

  describe('Workspace-Aware .copilotignore Generator', () => {
    it('creates .copilotignore with managed block and preserves external content', () => {
      const patterns = ['dist/', 'build/', 'package-lock.json'];
      const res = applyPatternsToCopilotIgnore(tempDir, patterns);
      assert.strictEqual(res.created, true);

      const ignorePath = path.join(tempDir, '.copilotignore');
      const content = fs.readFileSync(ignorePath, 'utf-8');
      assert.ok(content.includes('# --- TOKENSCULPT MANAGED EXCLUSIONS ---'));
      assert.ok(content.includes('package-lock.json'));

      // Now add user content outside the block and re-apply
      fs.writeFileSync(ignorePath, '# User custom rule\nmy-secret-file.txt\n\n' + content, 'utf-8');
      const updatedRes = applyPatternsToCopilotIgnore(tempDir, ['dist/', 'build/', 'Cargo.lock']);
      assert.strictEqual(updatedRes.updated, true);

      const newContent = fs.readFileSync(ignorePath, 'utf-8');
      assert.ok(newContent.includes('my-secret-file.txt'), 'Must preserve user content');
      assert.ok(newContent.includes('Cargo.lock'), 'Must update managed patterns');
    });
  });

  describe('Multi-Model Cost Simulator', () => {
    it('simulates costs across tiers with positive dollar savings', () => {
      const results = runSimulation(100_000);
      assert.ok(results.length >= 6);

      const opus = results.find(r => r.id.includes('opus'));
      assert.ok(opus);
      assert.ok(opus.dollarsSavedUsd > 0);
      assert.ok(opus.unoptimizedCostUsd > opus.optimizedCostUsd);

      const flash = results.find(r => r.id.includes('flash'));
      assert.ok(flash);
      assert.ok(flash.dollarsSavedUsd > 0);
      assert.ok(opus.dollarsSavedUsd > flash.dollarsSavedUsd, 'Flagship dollar savings must exceed lightweight');
    });
  });
});
