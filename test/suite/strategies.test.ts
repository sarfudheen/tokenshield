import * as assert from 'assert';
import { extractCodeSkeleton } from '../../src/strategies/skeleton';
import { classifyTask } from '../../src/strategies/modelRouting';
import { detectProjectExclusions } from '../../src/strategies/contextExclusion';
import { getGuardrailTracker } from '../../src/strategies/guardrails';

suite('Enhanced Strategies (CAP-6 through CAP-10)', () => {
  suite('CAP-6: AST Skeleton Extraction', () => {
    test('extracts TypeScript interface and function signatures, stripping bodies', () => {
      const tsCode = `
import { Config } from './config';

export interface User {
  id: string;
  name: string;
}

export function calculateTax(income: number, rate: number): number {
  const deductions = 5000;
  const taxable = income - deductions;
  if (taxable <= 0) {
    return 0;
  }
  return taxable * rate;
}
`;
      const skeleton = extractCodeSkeleton(tsCode, 'tax.ts');
      assert.ok(skeleton.includes('export interface User'));
      assert.ok(skeleton.includes('calculateTax'));
      assert.ok(skeleton.includes('{ /* ... */ }'));
      assert.ok(!skeleton.includes('const deductions = 5000'));
    });

    test('extracts Python classes and def signatures', () => {
      const pyCode = `
class DataProcessor:
    """Processes large datasets."""
    def __init__(self, name: str):
        self.name = name
        self.data = []

    def process(self, items: list) -> dict:
        result = {}
        for item in items:
            result[item] = len(item)
        return result
`;
      const skeleton = extractCodeSkeleton(pyCode, 'processor.py');
      assert.ok(skeleton.includes('class DataProcessor:'));
      assert.ok(skeleton.includes('def __init__'));
      assert.ok(skeleton.includes('def process'));
      assert.ok(!skeleton.includes('result[item] = len(item)'));
    });
  });

  suite('CAP-7: Context Exclusion', () => {
    test('detects standard exclusion patterns', () => {
      const patterns = detectProjectExclusions(process.cwd());
      assert.ok(patterns.includes('*.lock'));
      assert.ok(patterns.includes('*.min.js'));
      assert.ok(patterns.includes('node_modules/**'));
    });
  });

  suite('CAP-9: Agent Guardrails', () => {
    test('tracks guardrail events and savings', () => {
      const tracker = getGuardrailTracker();
      tracker.reset();
      tracker.recordEvent({
        type: 'max-retries',
        detail: 'Exceeded 3 retry attempts',
        estimatedTokensSaved: 1500,
      });

      const stats = tracker.getStats();
      assert.strictEqual(stats.totalTriggers, 1);
      assert.strictEqual(stats.estimatedTokensSaved, 1500);
    });
  });

  suite('CAP-10: Smart Model Routing', () => {
    test('classifies simple prompt as lightweight', () => {
      assert.strictEqual(classifyTask('rename variable foo to bar'), 'lightweight');
      assert.strictEqual(classifyTask('fix typo in comment'), 'lightweight');
      assert.strictEqual(classifyTask('format this json'), 'lightweight');
    });

    test('classifies complex prompt as full-power', () => {
      assert.strictEqual(classifyTask('architect a distributed cache system'), 'full-power');
      assert.strictEqual(classifyTask('debug multi-file memory leak'), 'full-power');
      assert.strictEqual(classifyTask('security review on auth handler'), 'full-power');
    });
  });
});
