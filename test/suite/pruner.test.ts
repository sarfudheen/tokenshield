import * as assert from 'assert';
import { pruneContext } from '../../src/strategies/adaptivePruner';

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
});
