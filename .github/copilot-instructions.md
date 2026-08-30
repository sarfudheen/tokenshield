# TokenShield Optimization Standards

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# TokenShield Optimization Standards

## Active Optimization Directives

### Code Search & Navigation (CAP-1: CodeGraph)
- **MANDATORY**: When locating symbols, callers, or implementations, ALWAYS query CodeGraph (`codegraph_explore` or `codegraph`) before grepping.
- **FORBIDDEN**: NEVER perform brute-force directory grep searches when CodeGraph semantic indexing is available.

### Mandatory CLI Execution: RTK Proxy (CAP-2: RTK Compression)
- **MANDATORY**: When proposing or running terminal commands for `git`, `test`, `build`, `ls`, or `grep`, ALWAYS prefix them with `rtk` (e.g. `rtk git status`, `rtk git diff`, `rtk test`, `rtk ls`).
- **FORBIDDEN**: NEVER execute or propose raw `git` commands (`git status`, `git diff`, `git log`) directly in terminal. Always route through `rtk git <cmd>` to compress token output by 60-90%.
- Report only test failure details and status summaries rather than full stdout logs.

### Response Verbosity Control (CAP-3: Caveman — full mode)
- **MANDATORY**: Answer code-first and immediately. Provide dense, direct solutions targeting ~35% response token reduction.
- **FORBIDDEN**: NEVER output conversational preambles ("Sure!", "I can help with that", "Great question", "Certainly!"), recap summaries, or conversational sign-offs.

### Session Context Hygiene (CAP-4)
- **MANDATORY**: Reuse previously loaded symbols from working memory. Keep state summaries minimal when switching tasks.
- **FORBIDDEN**: NEVER re-read or re-fetch files already inspected in the active turn or session.

### Semantic Answer Cache (CAP-5: token-cache MCP)
- **MANDATORY**: For boilerplate, configuration, or repeat questions, ALWAYS invoke `cache_lookup` before generating an answer.
- **FORBIDDEN**: NEVER query the full model if a valid cached response is available locally (100% token savings).

### Smart Context Pruning (CAP-6: AST Skeleton)
- **MANDATORY**: When exploring unfamiliar or large files (>100 lines), ALWAYS invoke `skeleton_view({ file: "path" })` first to inspect signatures, interfaces, and types.
- **FORBIDDEN**: NEVER ingest full implementation bodies unless you are directly editing that exact function (~90% context savings).

### Context Exclusion (CAP-7)
- **MANDATORY**: Respect all active exclusion filters (`.copilotignore`, `settings.json`).
- **FORBIDDEN**: NEVER ingest, scan, or reference lock files (`*.lock`, `package-lock.json`), minified bundles, build outputs (`dist/`, `target/`), or sourcemaps.

### Diff-Only Modifications (CAP-8)
- **MANDATORY**: Always propose code modifications strictly as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: NEVER reprint full, unmodified source files or classes (~92% output token savings).

### Agent Loop Guardrails (CAP-9)
- **MANDATORY**: Halt execution after 3 failed retry attempts on the same task and explain the blocker.
- **FORBIDDEN**: NEVER enter infinite retry loops or inspect the same file more than 2 times per turn.
- If modifying more than 10 files, pause and confirm with the user.

### Smart Model Routing (CAP-10)
- **MANDATORY**: For lightweight tasks (renames, formatting, linting, docstrings), suggest fast/cost-effective models.
- Preserve flagship reasoning models exclusively for deep architectural or complex debugging tasks.

### Git Diff-Scoped Context (CAP-11)
- **MANDATORY**: Scope review, PR analysis, and test writing strictly to `git diff` output and direct 1-hop AST callers/callees.
- **FORBIDDEN**: NEVER ingest entire files when only the changed lines are relevant.

### Deterministic Prompt Prefix Caching (CAP-12: API/Agent Mode)
- *Applies when using raw API calls or custom agent frameworks (Cursor, custom scripts).*
- Keep system prompt and instruction blocks byte-identical across turns to maximise cloud KV-cache hits.
- Place stable context (instructions, project summary) before dynamic context (file content, user query).

### Comment & Header Stripping (CAP-13)
- **MANDATORY**: Strip license preambles, copyright headers, and filler comments when ingesting code into prompt context.
- Preserve doc-comments (JSDoc, docstrings) that describe runtime behavior.

### Test Log Failure Isolation (CAP-14)
- **MANDATORY**: When reporting test execution results, output ONLY failing assertions, error stacks, and file:line locations.
- **FORBIDDEN**: NEVER include passing test suite lines or full raw stdout in context.

### Windowed Range Slicing (CAP-15)
- **MANDATORY**: Read targeted 100-line windows around the exact symbol you are modifying.
- **FORBIDDEN**: NEVER dump entire 500+ line files into context when only a function or class is needed.

### Inline Chat Scope Pinning (CAP-16)
- **MANDATORY**: Constrain inline chat context strictly to the selected lines and their direct symbol references.
- **FORBIDDEN**: NEVER read or infer from unselected parts of the file unless explicitly referenced.

### .copilotignore Context Blocking (CAP-17)
- **MANDATORY**: Strictly respect `.copilotignore` exclusion rules exactly like `.gitignore`.
- **FORBIDDEN**: NEVER read, reference, or include content from ignored paths (build outputs, lock files, secrets).

### Copilot Edits Session Awareness (CAP-18)
- **MANDATORY**: Treat all files currently open in a Copilot Edits session as already loaded.
- **FORBIDDEN**: NEVER re-read active edit session files via secondary tool calls. Propose incremental edits only.

### Thread Reset Trigger (CAP-19)
- **MANDATORY**: When a conversation exceeds 40 messages or 30 minutes, proactively advise the user to start a fresh chat thread to prevent context saturation.

## Diagnostic Exceptions
- Always show complete error traces and assertion messages when diagnosing test/build failures.
- Never compress security vulnerability findings or critical alerts.

<!-- TOKENSHIELD:END -->
