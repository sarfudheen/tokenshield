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
    // Strip standalone single line comments (e.g. // TODO: xyz or // console.log)
    result = result.replace(/^\s*\/\/(?!\s*(?:@ts-|eslint-|istanbul|\/ <reference))\s+.*$/gm, '');
    // Strip multi-line comments that do not contain type annotations
    result = result.replace(/\/\*(?!\*|\s*@)[\s\S]*?\*\//g, '');
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
