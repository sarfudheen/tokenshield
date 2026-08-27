import * as assert from 'assert';
import { pruneContext, compressGitDiff, isolateTestFailures, stripCommentsAndHeaders } from '../../src/strategies/adaptivePruner';

suite('Adaptive Context Pruner Tests', () => {
  test('prunes excessive blank lines and trailing spaces', () => {
    const raw = `function calculate() {   \n\n\n\n  return 42;\n\n\n}`;
    const res = pruneContext(raw);
    assert.strictEqual(res.prunedText, `function calculate() {\n\n  return 42;\n}`);
    assert.ok(res.reductionPercent > 0);
  });

  test('strips conversational puffery from markdown prompts', () => {
    const raw = `Sure! I can help with that.\n\nHere is the implementation:\n\`\`\`ts\nconst x = 1;\n\`\`\`\nHope this helps!`;
    const res = pruneContext(raw, { removeMarkdownPuffery: true });
    assert.ok(!res.prunedText.includes('Sure! I can help with that.'));
    assert.ok(!res.prunedText.includes('Hope this helps!'));
    assert.ok(res.prunedText.includes('const x = 1;'));
  });

  test('strips non-essential comments in aggressive mode', () => {
    const raw = `// TODO: refactor this later\nconst auth = true;\n/* multi-line comment */\nconst port = 8080;`;
    const res = pruneContext(raw, { aggressive: true });
    assert.ok(!res.prunedText.includes('TODO: refactor'));
    assert.ok(!res.prunedText.includes('multi-line comment'));
    assert.ok(res.prunedText.includes('const auth = true;'));
    assert.ok(res.prunedText.includes('const port = 8080;'));
  });

  test('CAP-13: strips copyright and license preambles', () => {
    const code = `/* Copyright (c) 2026 Acme Corp. All rights reserved. Licensed under MIT. */\n// Standard helper\nexport const add = (a: number, b: number) => a + b;`;
    const stripped = stripCommentsAndHeaders(code);
    assert.ok(!stripped.includes('Copyright'));
    assert.ok(!stripped.includes('Standard helper'));
    assert.ok(stripped.includes('export const add = (a: number, b: number) => a + b;'));
  });

  test('CAP-11: compresses git diff output', () => {
    const diff = `diff --git a/src/app.ts b/src/app.ts\nindex 8e4347b..f4e7da9 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,3 +1,3 @@\n-const old = 1;\n+const next = 2;`;
    const res = compressGitDiff(diff);
    assert.ok(!res.prunedText.includes('index 8e4347b'));
    assert.ok(res.prunedText.includes('+const next = 2;'));
    assert.ok(res.reductionPercent > 0);
  });

  test('CAP-14: isolates test failures from test logs', () => {
    const log = `PASS test/suite/a.test.ts\nPASS test/suite/b.test.ts\nFAIL test/suite/c.test.ts\n  ● should calculate correct total\n    AssertionError: Expected: 10, Received: 0\nTest Suites: 1 failed, 2 passed, 3 total`;
    const res = isolateTestFailures(log);
    assert.ok(!res.prunedText.includes('PASS test/suite/a.test.ts'));
    assert.ok(res.prunedText.includes('FAIL test/suite/c.test.ts'));
    assert.ok(res.prunedText.includes('AssertionError'));
  });
});
