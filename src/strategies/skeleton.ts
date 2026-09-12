import * as fs from 'fs';
import * as path from 'path';

export interface SkeletonResult {
  file: string;
  originalBytes: number;
  skeletonBytes: number;
  originalTokensEst: number;
  skeletonTokensEst: number;
  reductionPercent: number;
  skeletonContent: string;
}

/**
 * Extracts a compact structural skeleton (signatures, types, interfaces, classes)
 * from code in various languages by stripping function and method implementation bodies.
 */
export function extractCodeSkeleton(
  sourceCode: string,
  filePath: string,
  expandFunctions: string[] = []
): string {
  const ext = path.extname(filePath).toLowerCase();

  try {
    let skeleton: string;
    switch (ext) {
      case '.ts':
      case '.tsx':
      case '.js':
      case '.jsx':
        skeleton = extractJsTsSkeleton(sourceCode, expandFunctions);
        break;
      case '.py':
        skeleton = extractPythonSkeleton(sourceCode, expandFunctions);
        break;
      case '.go':
        skeleton = extractGoSkeleton(sourceCode, expandFunctions);
        break;
      case '.rs':
        skeleton = extractRustSkeleton(sourceCode, expandFunctions);
        break;
      case '.java':
      case '.cpp':
      case '.c':
      case '.cs':
        skeleton = extractCStyleSkeleton(sourceCode, expandFunctions);
        break;
      case '.kt':
      case '.kts':
        skeleton = extractKotlinSkeleton(sourceCode, expandFunctions);
        break;
      case '.swift':
        skeleton = extractSwiftSkeleton(sourceCode, expandFunctions);
        break;
      case '.rb':
        skeleton = extractRubySkeleton(sourceCode, expandFunctions);
        break;
      case '.php':
        skeleton = extractPhpSkeleton(sourceCode, expandFunctions);
        break;
      case '.json':
        skeleton = extractJsonSkeleton(sourceCode);
        break;
      default:
        skeleton = extractGenericSkeleton(sourceCode);
        break;
    }

    // Sanity boundary: if parsing produced an empty result from non-empty source, fall back
    if ((!skeleton || skeleton.trim().length === 0) && sourceCode.trim().length > 0) {
      skeleton = regexLineSlicer(sourceCode);
    }
    return skeleton;
  } catch {
    // Graceful fallback on syntax or parsing failure
    const fallback = regexLineSlicer(sourceCode);
    return fallback && fallback.trim().length > 0 ? fallback : extractGenericSkeleton(sourceCode);
  }
}

/**
 * Strips JS/TS function and method bodies while preserving type declarations,
 * interfaces, class structures, imports, exports, and signatures.
 */
function extractJsTsSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inComment = false;
  let braceDepth = 0;
  let inFunctionBody = false;
  let functionStartDepth = 0;
  let currentFunctionName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Multi-line comment tracking
    if (trimmed.startsWith('/*')) { inComment = true; }
    if (inComment) {
      result.push(line);
      if (trimmed.endsWith('*/') || line.includes('*/')) { inComment = false; }
      continue;
    }

    // Preserve imports, exports, interfaces, type aliases, declare statements
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('declare ') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*')
    ) {
      if (!inFunctionBody) {
        result.push(line);
      }
      continue;
    }

    // Check if this line starts a function/method
    const fnMatch = line.match(/(?:async\s+)?(?:function\*?\s+([a-zA-Z0-9_$]+)|([a-zA-Z0-9_$]+)\s*\([^)]*\)\s*(?::\s*[^;{]+)?\s*\{|(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>\s*\{)/);
    
    if (fnMatch && !inFunctionBody) {
      const name = fnMatch[1] || fnMatch[2] || fnMatch[3] || '';
      currentFunctionName = name;

      if (expand.includes(name)) {
        // User wants this function expanded — include entire body
        result.push(line);
        continue;
      }

      // Convert function to signature with ellipsis
      const openBraceIdx = line.indexOf('{');
      if (openBraceIdx !== -1) {
        const signature = line.substring(0, openBraceIdx).trimEnd();
        const indent = line.match(/^\s*/)?.[0] || '';
        result.push(`${signature} { /* ... */ }`);
        inFunctionBody = true;
        functionStartDepth = braceDepth;
      } else {
        result.push(line);
      }
    }

    // Track braces (strip strings and inline comments to prevent brace desync)
    const lineForBraces = line
      .replace(/\/\/.*$/, '')
      .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');

    for (const char of lineForBraces) {
      if (char === '{') { braceDepth++; }
      else if (char === '}') {
        braceDepth--;
        if (inFunctionBody && braceDepth <= functionStartDepth) {
          inFunctionBody = false;
        }
      }
    }

    if (!inFunctionBody && !fnMatch) {
      // Keep class declarations, property declarations, enums, etc.
      if (trimmed.startsWith('class ') ||
          trimmed.startsWith('export class ') ||
          trimmed.startsWith('enum ') ||
          trimmed.startsWith('export enum ') ||
          trimmed.startsWith('export const ') ||
          trimmed.startsWith('export let ') ||
          trimmed.startsWith('export default ') ||
          trimmed.length === 0 ||
          braceDepth === 0 ||
          trimmed === '}' ||
          trimmed === '};') {
        result.push(line);
      }
    }
  }

  return result.join('\n');
}

/**
 * Strips Python function and method bodies, keeping class definitions,
 * def lines, type hints, docstrings, and imports.
 */
function extractPythonSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inSkippedBody = false;
  let bodyIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = line.search(/\S/);

    if (trimmed.startsWith('#') || trimmed.length === 0) {
      if (!inSkippedBody) { result.push(line); }
      continue;
    }

    if (inSkippedBody) {
      if (indent <= bodyIndent && trimmed.length > 0) {
        inSkippedBody = false;
      } else {
        continue;
      }
    }

    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      const match = trimmed.match(/(?:async\s+)?def\s+([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (expand.includes(name)) {
        result.push(line);
      } else {
        result.push(line);
        const nextIndent = ' '.repeat(indent + 4);
        result.push(`${nextIndent}...`);
        inSkippedBody = true;
        bodyIndent = indent;
      }
      continue;
    }

    // Keep imports, class declarations, decorators, constants
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Go skeleton: keeps package, imports, struct definitions, interface definitions,
 * and func signatures with bodies replaced by { ... }.
 */
function extractGoSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inBody && (trimmed.startsWith('func ') || trimmed.startsWith('func ('))) {
      const match = trimmed.match(/func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (!expand.includes(name) && line.includes('{')) {
        const sig = line.substring(0, line.lastIndexOf('{')).trimEnd();
        result.push(`${sig} { ... }`);
        inBody = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth <= 0) { inBody = false; }
        continue;
      }
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Rust skeleton: keeps use, mod, struct, enum, trait, type, and fn signatures.
 */
function extractRustSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inBody && (trimmed.startsWith('pub fn ') || trimmed.startsWith('fn ') || trimmed.startsWith('pub async fn ') || trimmed.startsWith('async fn '))) {
      const match = trimmed.match(/(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (!expand.includes(name) && line.includes('{')) {
        const sig = line.substring(0, line.lastIndexOf('{')).trimEnd();
        result.push(`${sig} { /* ... */ }`);
        inBody = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth <= 0) { inBody = false; }
        continue;
      }
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * C/C++/Java/C# style skeleton.
 */
function extractCStyleSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isMethod = /\b(?:public|private|protected|static|virtual|override|void|int|string|bool|float|double)\b.*\([^)]*\)\s*\{?/.test(trimmed);

    if (!inBody && isMethod && line.includes('{') && !trimmed.startsWith('class ') && !trimmed.startsWith('interface ')) {
      const sig = line.substring(0, line.lastIndexOf('{')).trimEnd();
      result.push(`${sig} { /* ... */ }`);
      inBody = true;
      depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * JSON skeleton: truncates large arrays and deep objects.
 */
function extractJsonSkeleton(code: string): string {
  try {
    const parsed = JSON.parse(code);
    const summarize = (val: unknown, depth = 0): unknown => {
      if (depth > 2) { return Array.isArray(val) ? `[...${val.length} items]` : '{...}'; }
      if (Array.isArray(val)) {
        if (val.length <= 3) { return val.map(x => summarize(x, depth + 1)); }
        return [summarize(val[0], depth + 1), `... ${val.length - 1} more items`];
      }
      if (val && typeof val === 'object') {
        const res: Record<string, unknown> = {};
        const keys = Object.keys(val as Record<string, unknown>);
        for (const k of keys.slice(0, 10)) {
          res[k] = summarize((val as Record<string, unknown>)[k], depth + 1);
        }
        if (keys.length > 10) { res['...'] = `${keys.length - 10} more keys`; }
        return res;
      }
      return val;
    };
    return JSON.stringify(summarize(parsed), null, 2);
  } catch {
    return code.slice(0, 500) + '\n/* ... truncated ... */';
  }
}

/**
 * Kotlin skeleton: keeps package, imports, class/interface/object headers, and fun signatures.
 */
function extractKotlinSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inBody && (trimmed.startsWith('fun ') || trimmed.startsWith('suspend fun ') || trimmed.includes(' fun '))) {
      const match = trimmed.match(/(?:fun\s+)([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (!expand.includes(name) && line.includes('{')) {
        const sig = line.substring(0, line.indexOf('{')).trimEnd();
        result.push(`${sig} { /* ... */ }`);
        inBody = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth <= 0) { inBody = false; }
        continue;
      }
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Swift skeleton: keeps import, protocols, structs, classes, extensions, and func signatures.
 */
function extractSwiftSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inBody && (trimmed.startsWith('func ') || trimmed.includes(' func '))) {
      const match = trimmed.match(/func\s+([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (!expand.includes(name) && line.includes('{')) {
        const sig = line.substring(0, line.indexOf('{')).trimEnd();
        result.push(`${sig} { /* ... */ }`);
        inBody = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth <= 0) { inBody = false; }
        continue;
      }
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Ruby skeleton: keeps require, class, module definitions and def signatures.
 */
function extractRubySkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inDef = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const indent = line.search(/\S/);

    if (trimmed.startsWith('def ')) {
      const match = trimmed.match(/def\s+([a-zA-Z0-9_?!.]+)/);
      const name = match ? match[1] : '';
      if (expand.includes(name)) {
        result.push(line);
      } else {
        result.push(line);
        const nextIndent = ' '.repeat(Math.max(0, indent + 2));
        result.push(`${nextIndent}...`);
        inDef = true;
      }
      continue;
    }

    if (inDef) {
      if (trimmed === 'end') {
        inDef = false;
        result.push(line);
      }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * PHP skeleton: keeps namespace, use, classes, interfaces, traits, and function signatures.
 */
function extractPhpSkeleton(code: string, expand: string[]): string {
  const lines = code.split('\n');
  const result: string[] = [];
  let inBody = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const isFn = (trimmed.startsWith('function ') || trimmed.includes(' function ')) && !trimmed.startsWith('//');
    if (!inBody && isFn) {
      const match = trimmed.match(/function\s+([a-zA-Z0-9_]+)/);
      const name = match ? match[1] : '';
      if (!expand.includes(name) && line.includes('{')) {
        const sig = line.substring(0, line.indexOf('{')).trimEnd();
        result.push(`${sig} { /* ... */ }`);
        inBody = true;
        depth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        if (depth <= 0) { inBody = false; }
        continue;
      }
    }

    if (inBody) {
      depth += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      if (depth <= 0) { inBody = false; }
      continue;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Fallback regex-based line slicer when language-specific structural parsing encounters
 * active syntax errors or fails completely (Issue 3 fallback).
 */
export function regexLineSlicer(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      result.push(line);
      continue;
    }
    // Imports, packages, modules
    if (/^(?:import|export|from|package|namespace|using|use|require)\b/.test(trimmed)) {
      result.push(line);
      continue;
    }
    // Class, interface, type, struct, enum declarations
    if (/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:public\s+|private\s+|protected\s+)?(?:class|interface|type|enum|struct|trait|protocol|object)\b/.test(trimmed)) {
      result.push(line);
      continue;
    }
    // Functions, methods, definitions
    if (/^(?:export\s+)?(?:async\s+)?(?:public\s+|private\s+|protected\s+|static\s+|suspend\s+)*(?:function\*?|def|func|fn|fun)\b/.test(trimmed)) {
      if (line.includes('{')) {
        const sig = line.substring(0, line.indexOf('{')).trimEnd();
        result.push(`${sig} { /* ... */ }`);
      } else {
        result.push(line);
      }
      continue;
    }
    // Variable / constant declarations at top level
    if (/^(?:export\s+)?(?:const|let|var|val)\s+[a-zA-Z0-9_$]+\s*[:=]/.test(trimmed)) {
      result.push(line);
      continue;
    }
  }
  return result.join('\n');
}

function extractGenericSkeleton(code: string): string {
  const lines = code.split('\n');
  if (lines.length <= 50) { return code; }
  return [
    ...lines.slice(0, 30),
    `/* ... (${lines.length - 40} lines omitted by TokenShield AST skeleton extractor) ... */`,
    ...lines.slice(-10),
  ].join('\n');
}

/**
 * Generate full skeleton stats for a file on disk with 1MB size bounding (Issue 6).
 */
export function getFileSkeleton(
  workspaceRoot: string,
  relativePath: string,
  expandFunctions: string[] = []
): SkeletonResult | null {
  const absPath = path.isAbsolute(relativePath) ? relativePath : path.join(workspaceRoot, relativePath);
  if (!fs.existsSync(absPath)) {
    return null;
  }

  try {
    const stats = fs.statSync(absPath);
    const MAX_SKELETON_FILE_BYTES = 1024 * 1024; // 1 MB ceiling

    if (stats.size > MAX_SKELETON_FILE_BYTES) {
      // Memory bloat guard: summarize oversized files instead of full in-memory AST split
      const origBytes = stats.size;
      const origTokens = Math.ceil(origBytes / 4);
      const rawHead = fs.readFileSync(absPath, 'utf-8').slice(0, 4000);
      const summaryContent = `// [TokenSculpt Guard: File size (${(origBytes / 1024).toFixed(0)} KB) exceeds 1MB threshold]\n` +
        `// Path: ${relativePath}\n// Header preview:\n` +
        rawHead.split('\n').slice(0, 40).join('\n') +
        `\n// [... ${(origBytes / 1024).toFixed(0)} KB omitted to conserve memory ...]`;
      const skelBytes = Buffer.byteLength(summaryContent, 'utf-8');
      const skelTokens = Math.ceil(skelBytes / 4);
      const reduction = Math.max(0, Math.round(((origBytes - skelBytes) / origBytes) * 100));
      return {
        file: relativePath,
        originalBytes: origBytes,
        skeletonBytes: skelBytes,
        originalTokensEst: origTokens,
        skeletonTokensEst: skelTokens,
        reductionPercent: reduction,
        skeletonContent: summaryContent,
      };
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const skeleton = extractCodeSkeleton(content, absPath, expandFunctions);

    const origBytes = Buffer.byteLength(content, 'utf-8');
    const skelBytes = Buffer.byteLength(skeleton, 'utf-8');
    const origTokens = Math.ceil(origBytes / 4);
    const skelTokens = Math.ceil(skelBytes / 4);
    const reduction = origBytes > 0 ? Math.round(((origBytes - skelBytes) / origBytes) * 100) : 0;

    return {
      file: relativePath,
      originalBytes: origBytes,
      skeletonBytes: skelBytes,
      originalTokensEst: origTokens,
      skeletonTokensEst: skelTokens,
      reductionPercent: Math.max(0, reduction),
      skeletonContent: skeleton,
    };
  } catch {
    return null;
  }
}
