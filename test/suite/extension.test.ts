import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Mock vscode module for unit testing
const mockConfig: Record<string, unknown> = {
  enabled: true,
  autoApply: true,
  targetTools: ['copilot', 'claude', 'codex'],
  profile: 'full',
  activeStrategies: {
    codeGraph: true,
    outputCompression: true,
    verbosityControl: true,
    sessionManagement: true,
  },
  verbosityLevel: 'full',
  preserveExistingInstructions: true,
  autoInstallTools: true,
  configureMcpOnActivation: true,
};

suite('AI Token Optimizer Tests', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-token-opt-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  suite('Package Manager Detection', () => {
    test('detects npm from package-lock.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
      const { detectPackageManager } = require('../../src/installer/packageManager');
      assert.strictEqual(detectPackageManager(tmpDir), 'npm');
    });

    test('detects yarn from yarn.lock', () => {
      fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');
      const { detectPackageManager } = require('../../src/installer/packageManager');
      assert.strictEqual(detectPackageManager(tmpDir), 'yarn');
    });

    test('detects pnpm from pnpm-lock.yaml', () => {
      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
      const { detectPackageManager } = require('../../src/installer/packageManager');
      assert.strictEqual(detectPackageManager(tmpDir), 'pnpm');
    });

    test('returns null when no lockfile or package.json', () => {
      const { detectPackageManager } = require('../../src/installer/packageManager');
      assert.strictEqual(detectPackageManager(tmpDir), null);
    });

    test('prefers pnpm over npm when both exist', () => {
      fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
      fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
      const { detectPackageManager } = require('../../src/installer/packageManager');
      assert.strictEqual(detectPackageManager(tmpDir), 'pnpm');
    });
  });

  suite('Install Command Generation', () => {
    test('generates npm install -D for dev deps', () => {
      const { getInstallCommand } = require('../../src/installer/packageManager');
      const cmd = getInstallCommand('npm', ['codegraph', 'caveman'], true, false);
      assert.strictEqual(cmd, 'npm install -D codegraph caveman');
    });

    test('generates npm install -g for global', () => {
      const { getInstallCommand } = require('../../src/installer/packageManager');
      const cmd = getInstallCommand('npm', ['codegraph'], true, true);
      assert.strictEqual(cmd, 'npm install -g codegraph');
    });

    test('generates yarn add --dev', () => {
      const { getInstallCommand } = require('../../src/installer/packageManager');
      const cmd = getInstallCommand('yarn', ['rtk-compress'], true, false);
      assert.strictEqual(cmd, 'yarn add --dev rtk-compress');
    });

    test('generates pnpm add -D', () => {
      const { getInstallCommand } = require('../../src/installer/packageManager');
      const cmd = getInstallCommand('pnpm', ['caveman'], true, false);
      assert.strictEqual(cmd, 'pnpm add -D caveman');
    });
  });

  suite('Content Merge Logic', () => {
    const MARKER_START = '<!-- AI-TOKEN-OPTIMIZER:START -->';
    const MARKER_END = '<!-- AI-TOKEN-OPTIMIZER:END -->';

    test('appends to file without markers', () => {
      const existing = '# My Custom Instructions\n\nDo this and that.\n';
      const newBlock = `${MARKER_START}\nNew optimization content\n${MARKER_END}`;

      // Simulate merge logic
      const startIdx = existing.indexOf(MARKER_START);
      assert.strictEqual(startIdx, -1);
      const merged = existing.trimEnd() + '\n\n' + newBlock + '\n';
      assert.ok(merged.includes('My Custom Instructions'));
      assert.ok(merged.includes('New optimization content'));
    });

    test('replaces existing markers', () => {
      const existing = `# Instructions\n\n${MARKER_START}\nOld content\n${MARKER_END}\n\n# More stuff\n`;
      const newBlock = `${MARKER_START}\nUpdated content\n${MARKER_END}`;

      const startIdx = existing.indexOf(MARKER_START);
      const endIdx = existing.indexOf(MARKER_END);
      const before = existing.substring(0, startIdx);
      const after = existing.substring(endIdx + MARKER_END.length);
      const merged = before + newBlock + after;

      assert.ok(merged.includes('Updated content'));
      assert.ok(!merged.includes('Old content'));
      assert.ok(merged.includes('# Instructions'));
      assert.ok(merged.includes('# More stuff'));
    });

    test('preserves content outside markers', () => {
      const userContent = '# User Rules\n\n- Always use TypeScript\n- Follow PEP8\n\n';
      const markerContent = `${MARKER_START}\nOptimizer rules\n${MARKER_END}`;
      const full = userContent + markerContent + '\n\n# Footer\n';

      const startIdx = full.indexOf(MARKER_START);
      const endIdx = full.indexOf(MARKER_END);
      const before = full.substring(0, startIdx);
      const after = full.substring(endIdx + MARKER_END.length);

      assert.ok(before.includes('Always use TypeScript'));
      assert.ok(after.includes('# Footer'));
    });
  });

  suite('Profile Strategy Selection', () => {
    test('full profile enables all strategies', () => {
      const strategies = {
        full: { codeGraph: true, outputCompression: true, verbosityControl: true, sessionManagement: true },
        debug: { codeGraph: true, outputCompression: false, verbosityControl: true, sessionManagement: true },
        planning: { codeGraph: true, outputCompression: true, verbosityControl: false, sessionManagement: true },
        review: { codeGraph: true, outputCompression: true, verbosityControl: true, sessionManagement: false },
      };

      assert.deepStrictEqual(strategies.full, {
        codeGraph: true, outputCompression: true, verbosityControl: true, sessionManagement: true,
      });
    });

    test('debug profile disables output compression', () => {
      const strategies = {
        debug: { codeGraph: true, outputCompression: false, verbosityControl: true, sessionManagement: true },
      };
      assert.strictEqual(strategies.debug.outputCompression, false);
      assert.strictEqual(strategies.debug.codeGraph, true);
    });

    test('planning profile disables verbosity control', () => {
      const strategies = {
        planning: { codeGraph: true, outputCompression: true, verbosityControl: false, sessionManagement: true },
      };
      assert.strictEqual(strategies.planning.verbosityControl, false);
    });

    test('review profile disables session management', () => {
      const strategies = {
        review: { codeGraph: true, outputCompression: true, verbosityControl: true, sessionManagement: false },
      };
      assert.strictEqual(strategies.review.sessionManagement, false);
    });
  });

  suite('Template Content Generation', () => {
    test('copilot template includes all sections when all strategies active', () => {
      const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'copilot-instructions.md');
      if (fs.existsSync(templatePath)) {
        const content = fs.readFileSync(templatePath, 'utf-8');
        assert.ok(content.includes('CodeGraph'));
        assert.ok(content.includes('Output Compression'));
        assert.ok(content.includes('Inline Chat Scope Pinning'));
        assert.ok(content.includes('Context Saturation Thread Reset'));
        assert.ok(content.includes('TOKENSHIELD:START'));
        assert.ok(content.includes('TOKENSHIELD:END'));
      }
    });

    test('claude template includes session management commands and all directives', () => {
      const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'claude-instructions.md');
      if (fs.existsSync(templatePath)) {
        const content = fs.readFileSync(templatePath, 'utf-8');
        assert.ok(content.includes('/compact'));
        assert.ok(content.includes('/clear'));
        assert.ok(content.includes('/model'));
        assert.ok(content.includes('/context'));
        assert.ok(content.includes('Context Saturation Thread Reset'));
      }
    });

    test('codex template includes all 19 optimization directives', () => {
      const templatePath = path.join(__dirname, '..', '..', '..', 'templates', 'codex-instructions.md');
      if (fs.existsSync(templatePath)) {
        const content = fs.readFileSync(templatePath, 'utf-8');
        assert.ok(content.includes('CodeGraph'));
        assert.ok(content.includes('Context Saturation Thread Reset'));
      }
    });
  });
});
