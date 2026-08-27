// Standalone MCP stdio server — bundled separately to dist/cache-server.js and
// launched by AI tools as `node cache-server.js <workspaceRoot>`. Never imports
// vscode. stdout carries only newline-delimited JSON-RPC 2.0; logs go to stderr.
import * as readline from 'readline';
import { SemanticCacheStore, CacheScope } from '../cache/store';
import { CallLogStore } from '../cache/callLog';
import { recordDiskEvent } from '../cache/eventLog';
import { getFileSkeleton } from '../strategies/skeleton';
import { pruneContext, compressGitDiff, isolateTestFailures, stripCommentsAndHeaders } from '../strategies/adaptivePruner';

const SERVER_NAME = 'token-cache';
const SERVER_VERSION = '0.4.0';
const PROTOCOL_VERSION = '2024-11-05';

const workspaceRoot = process.argv[2] || process.cwd();

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITIONS = [
  {
    name: 'cache_lookup',
    description:
      'Look up a previously cached answer for a question about this workspace. ' +
      'Call this BEFORE answering a question that may have been answered before. ' +
      'Returns { hit, answer, exact, similarity, stale, storedAt }. If hit is true and ' +
      'stale is false, reuse the answer instead of regenerating it. A stale hit means ' +
      'the code has changed since the answer was stored — verify before reusing.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question to look up' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cache_store',
    description:
      'Store a reusable, self-contained answer in the local semantic cache so repeated ' +
      'or similar questions can be served without regenerating. Use scope "durable" for ' +
      'answers independent of current code state (concepts, how-tos), "code" (default) for ' +
      'answers about this codebase. Do NOT store answers about uncommitted or actively changing code.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The question being answered' },
        answer: { type: 'string', description: 'The full answer text to cache' },
        scope: { type: 'string', enum: ['code', 'durable'], description: 'Staleness scope (default: code)' },
      },
      required: ['query', 'answer'],
    },
  },
  {
    name: 'cache_stats',
    description: 'Report semantic cache statistics: entry count, total hits, estimated tokens saved.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'skeleton_view',
    description:
      'CAP-6: Retrieve an AST skeleton (signatures, types, interfaces, classes) of a source file ' +
      'without loading full function implementations. Saves 75-95% tokens compared to full file reads. ' +
      'Always call this first when exploring code; specify expandFunctions to get implementation for specific functions.',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Workspace-relative or absolute file path' },
        expandFunctions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional names of functions/methods to expand with full body implementation',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'prune_context',
    description:
      'Adaptive prompt & context pruner: compresses large prompt texts, markdown docs, and code snippets ' +
      'by removing redundant whitespace, boilerplate comments, and noise. Saves 30-50% tokens without semantic loss.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The raw text, markdown, or code snippet to compress' },
        aggressive: { type: 'boolean', description: 'Strip non-essential comments and aggressive whitespace' },
      },
      required: ['text'],
    },
  },
  {
    name: 'prune_git_diff',
    description:
      'CAP-11: Compress a git diff payload by removing binary headers, index hashes, and redundant metadata. Saves ~85% tokens on PR and code review context.',
    inputSchema: {
      type: 'object',
      properties: {
        diff: { type: 'string', description: 'Raw git diff output' },
      },
      required: ['diff'],
    },
  },
  {
    name: 'strip_comments',
    description:
      'CAP-13: Strip copyright license preambles, JSDoc filler, and standalone line comments from source code while preserving compiler directives.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code text' },
      },
      required: ['code'],
    },
  },
  {
    name: 'isolate_test_failures',
    description:
      'CAP-14: Filter verbose test runner logs (Jest, Mocha, Vitest, Pytest, Go) to isolate only the failing assertions, line numbers, and diffs.',
    inputSchema: {
      type: 'object',
      properties: {
        log: { type: 'string', description: 'Raw terminal test runner output' },
      },
      required: ['log'],
    },
  },
];

// New store per call: re-reads the file from disk so this process stays
// coherent with the extension (e.g. after a clearCache command).
function callTool(name: string, args: Record<string, unknown>): unknown {
  const store = new SemanticCacheStore(workspaceRoot);
  const callLog = new CallLogStore(workspaceRoot);
  switch (name) {
    case 'cache_lookup': {
      if (typeof args.query !== 'string' || args.query.length === 0) {
        throw new Error('cache_lookup requires a non-empty "query" string');
      }
      const result = store.lookup(args.query);
      callLog.recordLookup(result);
      if (result.hit && result.answer) {
        const saved = Math.max(1, Math.ceil(result.answer.length / 3.8));
        recordDiskEvent(workspaceRoot, {
          directive: 'CAP-5: Semantic Cache',
          source: args.query.length > 50 ? args.query.slice(0, 47) + '...' : args.query,
          tokensSaved: saved,
          details: `Answer (${result.answer.length} bytes, ~${saved} tok) served from local disk at $0.00 (${result.exact ? 'exact' : 'fuzzy'} match in <2ms)`,
        });
      }
      return result;
    }
    case 'cache_store': {
      if (typeof args.query !== 'string' || typeof args.answer !== 'string') {
        throw new Error('cache_store requires "query" and "answer" strings');
      }
      if (args.answer.length > 50_000) {
        throw new Error('cache_store rejected: answer exceeds 50KB maximum size');
      }
      const scope: CacheScope = args.scope === 'durable' ? 'durable' : 'code';
      const entry = store.store(args.query, args.answer, scope);
      callLog.recordStore();
      const saved = Math.max(1, Math.ceil(args.answer.length / 3.8));
      recordDiskEvent(workspaceRoot, {
        directive: 'CAP-5: Semantic Cache',
        source: args.query.length > 50 ? args.query.slice(0, 47) + '...' : args.query,
        tokensSaved: saved,
        details: `Stored reusable ${scope} answer (~${saved} tok avoided on next hit) in .aicache/semantic-cache.json`,
      });
      return { stored: true, id: entry.id, scope: entry.scope };
    }
    case 'cache_stats':
      return store.stats();
    case 'skeleton_view': {
      if (typeof args.file !== 'string' || args.file.length === 0) {
        throw new Error('skeleton_view requires a "file" path');
      }
      const expand = Array.isArray(args.expandFunctions) ? (args.expandFunctions as string[]) : [];
      const result = getFileSkeleton(workspaceRoot, args.file, expand);
      if (!result) {
        throw new Error(`File not found or unreadable: ${args.file}`);
      }
      const origTok = result.originalTokensEst;
      const skelTok = result.skeletonTokensEst;
      const saved = Math.max(0, origTok - skelTok);
      recordDiskEvent(workspaceRoot, {
        directive: 'CAP-6: AST Skeleton',
        source: args.file,
        tokensSaved: saved,
        details: `Extracted interface signatures (${result.originalBytes} B ➔ ${result.skeletonBytes} B, ${result.reductionPercent}% tokens saved)`,
      });
      return result;
    }
    case 'prune_context': {
      if (typeof args.text !== 'string') {
        throw new Error('prune_context requires a "text" string');
      }
      const result = pruneContext(args.text, { aggressive: !!args.aggressive });
      const saved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
      if (saved > 0) {
        recordDiskEvent(workspaceRoot, {
          directive: 'CAP-3: Dense Output',
          source: 'Prompt Context',
          tokensSaved: saved,
          details: `Pruned context (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} ➔ ${result.prunedTokensEst} tok)`,
        });
      }
      return result;
    }
    case 'prune_git_diff': {
      if (typeof args.diff !== 'string') {
        throw new Error('prune_git_diff requires a "diff" string');
      }
      const result = compressGitDiff(args.diff);
      const saved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
      if (saved > 0) {
        recordDiskEvent(workspaceRoot, {
          directive: 'CAP-11: Git Diff Context',
          source: 'rtk git diff HEAD',
          tokensSaved: saved,
          details: `Compressed git diff (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} ➔ ${result.prunedTokensEst} tok)`,
        });
      }
      return result;
    }
    case 'strip_comments': {
      if (typeof args.code !== 'string') {
        throw new Error('strip_comments requires a "code" string');
      }
      const pruned = stripCommentsAndHeaders(args.code);
      const saved = Math.max(0, Math.ceil((args.code.length - pruned.length) / 3.8));
      if (saved > 0) {
        recordDiskEvent(workspaceRoot, {
          directive: 'CAP-13: Comment Stripper',
          source: 'Source Code',
          tokensSaved: saved,
          details: `Stripped license headers & filler comments (${args.code.length} B ➔ ${pruned.length} B)`,
        });
      }
      return { code: pruned, originalLength: args.code.length, prunedLength: pruned.length };
    }
    case 'isolate_test_failures': {
      if (typeof args.log !== 'string') {
        throw new Error('isolate_test_failures requires a "log" string');
      }
      const result = isolateTestFailures(args.log);
      const saved = Math.max(0, result.originalTokensEst - result.prunedTokensEst);
      if (saved > 0) {
        recordDiskEvent(workspaceRoot, {
          directive: 'CAP-14: Test Failure Isolator',
          source: 'Test Runner Log',
          tokensSaved: saved,
          details: `Isolated failing assertions (-${result.reductionPercent}% tokens saved: ${result.originalTokensEst} ➔ ${result.prunedTokensEst} tok)`,
        });
      }
      return result;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleRequest(request: JsonRpcRequest): unknown | undefined {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOL_DEFINITIONS };
    case 'tools/call': {
      const params = request.params || {};
      const name = params.name as string;
      const args = (params.arguments as Record<string, unknown>) || {};
      try {
        const result = callTool(name, args);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    default:
      throw { code: -32601, message: `Method not found: ${request.method}` };
  }
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) { return; }

  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  if (request.id === undefined || request.id === null) {
    return;
  }

  try {
    const result = handleRequest(request);
    send({ jsonrpc: '2.0', id: request.id, result });
  } catch (err) {
    const rpcError = err as { code?: number; message?: string };
    send({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: typeof rpcError.code === 'number' ? rpcError.code : -32603,
        message: rpcError.message || 'Internal error',
      },
    });
  }
});

rl.on('close', () => process.exit(0));

process.stderr.write(`[${SERVER_NAME}] serving semantic cache, AST skeleton, and prompt pruner tools for ${workspaceRoot}\n`);
