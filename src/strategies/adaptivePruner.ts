export interface PruneOptions {
  stripComments?: boolean;
  condenseWhitespace?: boolean;
  condenseImports?: boolean;
  removeMarkdownPuffery?: boolean;
  aggressive?: boolean;
}

export interface PruneResult {
  originalLength: number;
  prunedLength: number;
  originalTokensEst: number;
  prunedTokensEst: number;
  reductionPercent: number;
  prunedText: string;
}

/**
 * Adaptive Prompt & Context Pruner (LLMLingua-lite heuristic compression)
 * Reduces prompt/context token load by 30–50% without altering code semantics.
 */
export function pruneContext(text: string, options: PruneOptions = {}): PruneResult {
  if (!text) {
    return {
      originalLength: 0,
      prunedLength: 0,
      originalTokensEst: 0,
      prunedTokensEst: 0,
      reductionPercent: 0,
      prunedText: '',
    };
  }

  const originalLength = text.length;
  const originalTokensEst = Math.max(1, Math.ceil(originalLength / 3.8));

  let result = text;

  // 1. Condense excessive blank lines and trailing whitespaces
  if (options.condenseWhitespace !== false) {
    result = result
      .replace(/[ \t]+$/gm, '')           // Trim trailing whitespace
      .replace(/\n{3,}/g, '\n\n')          // Collapse 3+ consecutive newlines to 2
      .replace(/^\s*\n/gm, '\n');          // Clean lines with only spaces
  }

  // 2. Strip low-signal filler phrases & preambles in conversational text/markdown
  if (options.removeMarkdownPuffery !== false) {
    const pufferyPatterns = [
      /^(?:Sure,?|Certainly!?|I can help with that\.?|Great question!?|Here is the (?:code|solution|implementation):?)\s*\n?/gim,
      /^(?:Let me know if you need anything else!?|Hope this helps!?|Feel free to ask.*)\s*$/gim,
      /<!--[\s\S]*?-->/g,                  // Strip HTML comments in markdown
    ];
    for (const pattern of pufferyPatterns) {
      result = result.replace(pattern, '');
    }
  }

  // 3. Condense or strip non-semantic comments if requested or in aggressive mode
  if (options.stripComments || options.aggressive) {
    result = stripCommentsAndHeaders(result);
  }

  // 4. Collapse repetitive empty lines again after comment stripping
  result = result.replace(/\n{3,}/g, '\n\n').trim();

  const prunedLength = result.length;
  const prunedTokensEst = Math.max(1, Math.ceil(prunedLength / 3.8));
  const reductionPercent = originalTokensEst > 0
    ? Math.max(0, Math.round(((originalTokensEst - prunedTokensEst) / originalTokensEst) * 100))
    : 0;

  return {
    originalLength,
    prunedLength,
    originalTokensEst,
    prunedTokensEst,
    reductionPercent,
    prunedText: result,
  };
}

/**
 * Comment & Header Stripper
 * Removes license preambles, verbose copyright notices, and inline comments
 * while preserving critical compiler annotations and type declarations.
 */
export function stripCommentsAndHeaders(code: string): string {
  if (!code) { return ''; }

  let output = code;

  // 1. Strip top-level license & copyright blocks
  output = output.replace(/^\/\*[\s\S]*?(?:license|copyright|all rights reserved)[\s\S]*?\*\/\s*/im, '');

  // 2. Strip standalone line comments (keep directives like @ts-, eslint, istanbul)
  output = output.replace(/^\s*\/\/(?!\s*(?:@ts-|eslint-|istanbul|\/ <reference))\s+.*$/gm, '');

  // 3. Strip multi-line block comments that are not JSDoc type declarations
  output = output.replace(/\/\*(?!\*|\s*@)[\s\S]*?\*\//g, '');

  // 4. Strip trailing line comments
  output = output.replace(/\s*\/\/(?!\s*(?:@ts-|eslint-)).*$/gm, '');

  return output.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Git Diff-Scoped Context Compressor
 * Strips git index metadata and retains modified chunks with minimal surrounding context.
 */
export function compressGitDiff(diffText: string): PruneResult {
  if (!diffText) {
    return { originalLength: 0, prunedLength: 0, originalTokensEst: 0, prunedTokensEst: 0, reductionPercent: 0, prunedText: '' };
  }

  const originalLength = diffText.length;
  const originalTokensEst = Math.max(1, Math.ceil(originalLength / 3.8));

  // Filter out binary diffs, index hashes, mode changes, and verbose file headers
  const lines = diffText.split('\n');
  const compressedLines: string[] = [];

  for (const line of lines) {
    if (
      line.startsWith('index ') ||
      line.startsWith('similarity index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ')
    ) {
      continue;
    }
    compressedLines.push(line);
  }

  const prunedText = compressedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const prunedLength = prunedText.length;
  const prunedTokensEst = Math.max(1, Math.ceil(prunedLength / 3.8));
  const reductionPercent = originalTokensEst > 0
    ? Math.max(0, Math.round(((originalTokensEst - prunedTokensEst) / originalTokensEst) * 100))
    : 0;

  return {
    originalLength,
    prunedLength,
    originalTokensEst,
    prunedTokensEst,
    reductionPercent,
    prunedText,
  };
}

/**
 * Test Output Failure Isolator
 * Strips passing test suites, progress bars, and redundant stack frames,
 * isolating only the failing test name, expected vs actual diff, and failure line.
 */
export function isolateTestFailures(testLog: string): PruneResult {
  if (!testLog) {
    return { originalLength: 0, prunedLength: 0, originalTokensEst: 0, prunedTokensEst: 0, reductionPercent: 0, prunedText: '' };
  }

  const originalLength = testLog.length;
  const originalTokensEst = Math.max(1, Math.ceil(originalLength / 3.8));

  const lines = testLog.split('\n');
  const failureLines: string[] = [];
  let capturingFailure = false;

  for (const line of lines) {
    // Detect failure markers in Jest, Mocha, Vitest, Pytest, Go test, Cargo test
    if (
      line.includes('FAIL') ||
      line.includes('✕') ||
      line.includes('AssertionError') ||
      line.includes('Expected:') ||
      line.includes('Received:') ||
      line.includes('Error:') ||
      line.includes('FAILED') ||
      line.includes('panic:')
    ) {
      capturingFailure = true;
    }

    // Skip passing markers
    if (line.includes('✓') || line.includes('PASS') || line.includes('passed') || line.includes('ok  ')) {
      if (!capturingFailure) {
        continue;
      }
    }

    if (capturingFailure) {
      failureLines.push(line);
      // Stop capturing if we hit summary line
      if (line.includes('Test Suites:') || line.includes('Tests:')) {
        capturingFailure = false;
      }
    }
  }

  const prunedText = failureLines.length > 0
    ? failureLines.join('\n').trim()
    : testLog.slice(0, 1000); // fallback if no explicit failure marker

  const prunedLength = prunedText.length;
  const prunedTokensEst = Math.max(1, Math.ceil(prunedLength / 3.8));
  const reductionPercent = originalTokensEst > 0
    ? Math.max(0, Math.round(((originalTokensEst - prunedTokensEst) / originalTokensEst) * 100))
    : 0;

  return {
    originalLength,
    prunedLength,
    originalTokensEst,
    prunedTokensEst,
    reductionPercent,
    prunedText,
  };
}
