# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run watch         # esbuild watch mode (continuous compilation to dist/extension.js)
npm run build          # production build (minified, no sourcemaps)
npm run compile        # tsc -p ./ — type-checks src/ and test/, emits to dist/ (required before npm test)
npm run lint            # eslint src --ext ts
npm run compile && npm test   # compile then run the VS Code integration test suite
npm run package          # vsce package → produces the .vsix
```

There is no single-test filter — `npm test` runs `dist/test/suite/index.js` (Mocha, via `@vscode/test-electron`), which downloads/launches a VS Code instance and runs all suites in `test/suite/`. To iterate on one suite, temporarily narrow the `files` glob in [test/suite/index.ts](test/suite/index.ts) or `.only()` a `suite()`/`test()` block, then run `npm run compile && npm test`.

Press **F5** in VS Code to launch the Extension Development Host for manual testing.

## Architecture

This is a VS Code extension (`src/extension.ts` is the bundled entry point, built with esbuild to `dist/extension.js`, `vscode` module externalized). It has **no runtime dependencies** — only devDependencies — so all logic is hand-written against Node's `fs`/`child_process` APIs and the `vscode` API.

### What it does

On workspace open (`onStartupFinished`), it writes token-optimization instructions into whichever AI tool config files are present/targeted, then optionally installs supporting CLI tools and wires MCP servers:

1. **Generators** (`src/generators/`) write optimization rules into `.github/copilot-instructions.md`, `CLAUDE.md`, and `.codex/instructions.md`.
2. **Installer** (`src/installer/`) silently installs `@colbymchenry/codegraph` (npm, global) and `rtk` (brew/curl shell script, a Rust binary — **not** an npm package despite what older docs/tests may imply).
3. **MCP configurator** (`src/mcp/configurator.ts`) writes `context7` and `codegraph` MCP server entries into `.vscode/settings.json` and `~/.config/claude/mcp.json`. It actively **deletes** any `rtk` MCP entry it finds, because RTK integrates via a Copilot PreToolUse hook, not MCP.
4. **CodeGraph watcher** (`src/strategies/codegraph.ts`) watches source files per configured project, debounces 30s, then runs `codegraph init` (first time) or `codegraph sync` (incremental) and reflects status in the status bar.
5. **Validator** (`src/strategies/validator.ts`) checks all optimization strategies are actually configured/active and reports via the Output channel (`tokenshield.healthCheck`).
6. **Telemetry** (`src/telemetry/`) is a pluggable metric-collector layer surfaced in the dashboard. `RepositoryMetricsCollector` reads real structural facts (files, classes, interfaces, methods, functions, nodes, edges, languages, index size) straight from `.codegraph/codegraph.db` via the `sqlite3` CLI, falling back to `codegraph status` totals when sqlite3 is absent. `estimator.ts` layers a **modeled** savings estimate on top (whole-repo baseline vs. graph-scoped slice); it is always tagged `modeled: true` and labeled as an estimate in the UI. `TelemetryStore` persists a latest snapshot + append-only history (`history.jsonl`) under `.aicache/telemetry/`. `analytics.ts` windows that history (24h/7d/30d/lifetime) into real repository-growth trends; `sparkline.ts` renders them as static inline SVG; `export.ts` serializes to JSON/CSV/Markdown (no Excel/PDF — those need forbidden runtime deps; CSV opens in Excel). The `tokenshield.exportReport` command drives export.

Full data-flow/sequence diagrams for every one of the above live in [ARCHITECTURE.md](ARCHITECTURE.md) — read it before making non-trivial changes to activation, installer, MCP, or codegraph-watcher logic.

### Observability honesty rule

This extension is **not in the LLM request path** — the actual model call and CodeGraph retrieval happen inside Copilot/Claude Code/Codex, which it cannot instrument. So per-request LLM metrics (prompt/completion tokens, latency, cost) and per-query retrieval metrics are **not observable** here and must never be fabricated. `src/strategies/measurement.ts` and the telemetry layer both follow this: real numbers are read from local state; unobservable ones are reported as `null`/`n/a`; and anything derived from assumptions is tagged `modeled` and labeled as an estimate. Preserve this distinction — do not turn an estimate into a number that reads as measured.

### Key architectural rules to preserve

- **Marker-based merge, not overwrite.** Instruction files are only ever modified between `

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# TokenShield Optimizations for Claude Code

## Active Optimizations

### CodeGraph Pre-Indexing
- **MANDATORY**: Query `codegraph_explore` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.

### CLI Output Compression (RTK)
- **MANDATORY**: Pipe shell executions through `rtk` filters (`rtk git`, `rtk test`, `rtk ls`).
- **FORBIDDEN**: Never run raw `git` commands directly in terminal.

### Concise Direct Responses
- **MANDATORY**: Answer code-first and densely. Zero preambles, summaries, or conversational sign-offs.

### Context Compaction & Session Hygiene
- **MANDATORY**: Maintain tight session scope. Never re-read previously inspected files in the same turn.

### Local Semantic Cache
- **MANDATORY**: Query `cache_lookup` tool for repeated/boilerplate questions before generating new tokens.

### AST Skeleton Pruning
- **MANDATORY**: Call `skeleton_view` tool first when navigating large source files (>100 lines).
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them (~90% context reduction).

### Smart Context Exclusions
- **MANDATORY**: Exclude build/dist artifacts, lockfiles, and minified bundles.

### Unified Diff Formatting
- **MANDATORY**: Always provide targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified source files or entire classes.

### Autonomous Loop Guardrails
- **MANDATORY**: Halt and ask user clarification after 3 failed attempts.

### Smart Model Routing
- Recommend lightweight Claude models (Haiku) for boilerplate/trivial edits.

### Git Diff Context Scoping
- **MANDATORY**: Scope review & test tasks strictly to `git diff` lines + 1-hop callers.

### Deterministic Prefix Caching
- Maintain stable instruction prefix order across turns to maximize KV cache hits.

### Comment & Header Stripping
- Strip copyright headers and filler comments on ingestion.

### Test Failure Log Isolation
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.

### Windowed Range Slicing
- **MANDATORY**: Inspect 100-line windows around target symbols instead of full files.

### Inline Chat Scope Pinning
- **MANDATORY**: Restrict context to selected editor lines and direct references.

### .copilotignore Compliance
- **MANDATORY**: Never read or reference ignored paths.

### Edit Session Awareness
- **MANDATORY**: Do not re-read files already open in the active edit session.

### Context Saturation Thread Reset
- Surface a fresh-thread prompt when conversation exceeds 40 messages.

<!-- TOKENSHIELD:END -->

` markers (`src/generators/base.ts` `mergeContent`). User content outside the markers must never be touched. If markers are absent, the block is appended; if `preserveExistingInstructions` is false, the whole file is overwritten.
- **Profiles gate strategies, not the other way around.** `full` / `debug` / `planning` / `review` / `custom` map to `{ codeGraph, outputCompression, verbosityControl, sessionManagement }` in `config.ts`. Debug disables output compression (need full logs), planning disables verbosity control (need full analysis), review disables session management (need full context history). Don't hardcode strategy behavior in generators — always go through `getEffectiveStrategies(profile)`.
- **RTK is hooks, not MCP.** Never add an `rtk` entry to an MCP servers config; the configurator's job is partly to remove stray ones.
- **CodeGraph install vs. MCP-expose are separate steps.** Installing the npm package puts the `codegraph` binary on `$PATH` (CLI). Adding the MCP server entry (`codegraph mcp` as a stdio subprocess) is what lets Copilot/Claude actually call `codegraph_explore`. Both must happen for AI tools to use it.
- **Graceful degradation.** If `codegraph`/`rtk` binaries aren't installed, instruction files are still generated with optimization guidance (telling the AI to invoke `rtk`/`codegraph` commands directly); nothing should hard-fail activation because a binary is missing.
- **Per-project indexing.** `tokenshield.codeGraphProjects` (array of `{ name, path, enabled }`) scopes which folders get indexed in multi-repo workspaces; empty means index all workspace folders.

### Templates

`templates/*.md` hold the raw markdown fragments (`claude-instructions.md`, `copilot-instructions.md`, `codex-instructions.md`) that generators assemble/inject — check these when changing wording of optimization guidance rather than hunting through generator code for inline strings.
