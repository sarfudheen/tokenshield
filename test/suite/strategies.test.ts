import * as assert from 'assert';

// Mock vscode module for headless testing
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (request: string) {
  if (request === 'vscode') {
    return {
      window: { showInformationMessage: async () => undefined },
      workspace: {
        getConfiguration: () => ({
          get: (_k: string, d: unknown) => d,
          inspect: () => undefined,
          update: async () => {},
        }),
      },
      ConfigurationTarget: { Workspace: 1, Global: 2 },
    };
  }
  return originalRequire.apply(this, arguments);
};

import { extractCodeSkeleton, regexLineSlicer } from '../../src/strategies/skeleton';
import { classifyTask } from '../../src/strategies/modelRouting';
import { detectProjectExclusions } from '../../src/strategies/contextExclusion';
import { getGuardrailTracker } from '../../src/strategies/guardrails';
import { SecretSanitizer, REDACTED_PLACEHOLDER } from '../../src/cache/sanitizer';

suite('Enhanced Strategies (AST Skeletons through Model Routing)', () => {
  suite('AST Skeleton Extraction', () => {
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
    test('handles braces inside strings and comments without desyncing brace depth', () => {
      const tsCode = `
export function formatTemplate(input: string): string {
  const json = "{ \\"nested\\": { \\"value\\": 123 } }";
  // inline comment with { brace }
  const message = \`Hello \${input} {test}\`;
  return message;
}

export function nextFunction(): void {
  console.log("second");
}
`;
      const skeleton = extractCodeSkeleton(tsCode, 'template.ts');
      assert.ok(skeleton.includes('formatTemplate'));
      assert.ok(skeleton.includes('nextFunction'));
      assert.ok(skeleton.includes('{ /* ... */ }'));
      assert.ok(!skeleton.includes('console.log("second")'));
    });

    test('extracts Kotlin classes and fun signatures', () => {
      const ktCode = `
package com.example.service

import java.util.*

class UserService {
    fun fetchUser(id: String): User {
        val user = repo.findById(id)
        return user
    }
}
`;
      const skeleton = extractCodeSkeleton(ktCode, 'UserService.kt');
      assert.ok(skeleton.includes('class UserService'));
      assert.ok(skeleton.includes('fun fetchUser'));
      assert.ok(!skeleton.includes('val user = repo.findById'));
    });

    test('extracts Swift structs and func signatures', () => {
      const swiftCode = `
import Foundation

struct NetworkManager {
    func executeRequest(url: URL) -> Data {
        let session = URLSession.shared
        return Data()
    }
}
`;
      const skeleton = extractCodeSkeleton(swiftCode, 'Network.swift');
      assert.ok(skeleton.includes('struct NetworkManager'));
      assert.ok(skeleton.includes('func executeRequest'));
      assert.ok(!skeleton.includes('let session = URLSession.shared'));
    });

    test('extracts Ruby classes and def signatures', () => {
      const rbCode = `
class PaymentGateway
  def process_payment(amount)
    charge = Stripe::Charge.create(amount: amount)
    charge.status
  end
end
`;
      const skeleton = extractCodeSkeleton(rbCode, 'gateway.rb');
      assert.ok(skeleton.includes('class PaymentGateway'));
      assert.ok(skeleton.includes('def process_payment'));
      assert.ok(!skeleton.includes('Stripe::Charge.create'));
    });

    test('extracts PHP classes and function signatures', () => {
      const phpCode = `
namespace App\\Http;

class ApiController {
    public function handleRequest($request) {
        $data = $request->all();
        return response()->json($data);
    }
}
`;
      const skeleton = extractCodeSkeleton(phpCode, 'ApiController.php');
      assert.ok(skeleton.includes('class ApiController'));
      assert.ok(skeleton.includes('public function handleRequest'));
      assert.ok(!skeleton.includes('$request->all()'));
    });

    test('regexLineSlicer falls back cleanly on broken syntax', () => {
      const brokenCode = `
export class BrokenComponent {
  public methodWithoutClosingBrace( {
    const x = 12;
export function validFunction(): string {
`;
      const fallback = regexLineSlicer(brokenCode);
      assert.ok(fallback.includes('export class BrokenComponent'));
      assert.ok(fallback.includes('validFunction'));
    });
  });

  suite('Secret Sanitizer', () => {
    test('detects and redacts AWS access keys', () => {
      const input = 'deploy with key AKIAIOSFODNN7EXAMPLE and secret';
      const result = SecretSanitizer.redact(input);
      assert.ok(!result.includes('AKIAIOSFODNN7EXAMPLE'));
      assert.ok(result.includes(REDACTED_PLACEHOLDER));
    });

    test('detects and redacts GitHub personal access tokens', () => {
      const input = 'export GITHUB_TOKEN="ghp_111111111122222222223333333333444444"';
      const result = SecretSanitizer.redact(input);
      assert.ok(!result.includes('ghp_111111111122222222223333333333444444'));
      assert.ok(result.includes(REDACTED_PLACEHOLDER));
    });

    test('detects and redacts OpenAI and Anthropic API keys', () => {
      const input = 'OpenAI: sk-abcdef1234567890abcdef123456, Claude: sk-ant-api03-abcdef1234567890abcdef123456';
      const result = SecretSanitizer.redact(input);
      assert.ok(!result.includes('sk-abcdef1234567890abcdef123456'));
      assert.ok(!result.includes('sk-ant-api03-abcdef1234567890abcdef123456'));
      assert.ok(result.includes(REDACTED_PLACEHOLDER));
    });

    test('detects and redacts PEM private keys', () => {
      const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+exampleFakeKeyDataHereForTestingPurposesOnly123456
-----END RSA PRIVATE KEY-----`;
      const result = SecretSanitizer.redact(input);
      assert.ok(!result.includes('MIIEowIBAAKCAQEA0Y1'));
      assert.ok(result.includes(REDACTED_PLACEHOLDER));
    });

    test('detects and redacts generic password and secret assignments', () => {
      const input = 'const dbConfig = { password: "superSecretPassword123!", api_key: "abcdef9876543210" };';
      const result = SecretSanitizer.redact(input);
      assert.ok(!result.includes('superSecretPassword123!'));
      assert.ok(!result.includes('abcdef9876543210'));
      assert.ok(result.includes(REDACTED_PLACEHOLDER));
    });

    test('leaves normal non-secret code intact', () => {
      const input = 'function calculateTotal(price, qty) { return price * qty; }';
      const result = SecretSanitizer.redact(input);
      assert.strictEqual(result, input);
      assert.strictEqual(SecretSanitizer.containsSecrets(input), false);
    });
  });

  suite('Context Exclusion', () => {
    test('detects standard exclusion patterns', () => {
      const patterns = detectProjectExclusions(process.cwd());
      assert.ok(patterns.includes('*.lock'));
      assert.ok(patterns.includes('*.min.js'));
      assert.ok(patterns.includes('node_modules/**'));
    });
  });

  suite('Agent Guardrails', () => {
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

  suite('Smart Model Routing', () => {
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
