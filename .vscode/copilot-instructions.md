# TokenShield Optimization Standards

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

## Active Optimization Directives

### Search Before Synthesize (CAP-1: CodeGraph)
- Search the codebase for existing patterns and implementations before writing new code.
- Prefer semantic symbol queries over brute-force file grepping.

### Concise CLI Output (CAP-2: RTK Compression)
- Use RTK commands (rtk git, rtk test, rtk ls) to compress CLI outputs by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.

### Response Verbosity Control (CAP-3: Caveman — full mode)
- Eliminate conversational preambles ("Sure!", "I can help with that", "Great question").
- Communicate code-first with direct answers. Target ~35% reduction in response tokens.

### Session Context Hygiene (CAP-4)
- Summarize previous state when switching tasks.
- Avoid re-reading recently inspected files within the same active session.

### Semantic Answer Cache (CAP-5: token-cache MCP)
- Call the `cache_lookup` tool before answering repeat or boilerplate questions.
- If a valid non-stale hit is found, reuse the cached answer directly to save 100% of model tokens.

### Smart Context Pruning (CAP-6: AST Skeleton)
- When exploring unfamiliar files, call `skeleton_view({ file: "path" })` to get signatures, interfaces, and types.
- Request full source bodies only for the exact functions/methods you need to edit (~90% context savings).

### Context Exclusion (CAP-7: CopilotIgnore)
- Lock files (*.lock, package-lock.json), minified bundles, build outputs, and sourcemaps are excluded from context.
- Never ingest or scan binary/lock files into your reasoning context.

### Diff-Only Modifications (CAP-8)
- When modifying code, produce ONLY the changed lines in unified diff format with ±3 lines of context.
- NEVER reprint unmodified file contents (~92% output token savings).

### Agent Loop Guardrails (CAP-9)
- Stop after 3 failed retry attempts on the same task and explain the blocker.
- Do not inspect the same file more than 2 times per turn.
- If modifying more than 10 files, pause and confirm with the user.

### Smart Model Routing (CAP-10)
- Lightweight tasks (renames, formatting, linting, docstrings): recommend fast/cost-effective models.
- Deep architectural, security, or complex debugging: preserve flagship reasoning models.

## Diagnostic Exceptions
- Always show complete error traces and assertion messages when diagnosing test/build failures.
- Never compress security vulnerability findings or critical alerts.

<!-- TOKENSHIELD:END -->
