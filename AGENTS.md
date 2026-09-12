<!-- TOKENSCULPT:START -->
<!-- TokenSculpt: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# Antigravity TokenSculpt Optimizations

## Active Optimizations

### CodeGraph Pre-Indexing
- **MANDATORY**: Query `codegraph_explore` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.

### CLI Output Compression (RTK)
- **MANDATORY**: Execute shell commands through RTK filters (`rtk git`, `rtk test`, `rtk ls`).
- **FORBIDDEN**: Never invoke raw `git` commands directly in terminal.

### Concise Direct Responses
- **MANDATORY**: Answer directly with actionable diffs and zero pleasantries.
- **FORBIDDEN**: Never include preambles, intros, or chit-chat.

### Context Compaction & Session Hygiene
- **MANDATORY**: Keep task state concise and reuse loaded symbol memory.
- **FORBIDDEN**: Never re-read previously inspected files in the same turn.

### Local Semantic Cache
- **MANDATORY**: Query `cache_lookup` tool for repeated/boilerplate answers.

### AST Skeleton Pruning
- **MANDATORY**: Call `skeleton_view` MCP tool first when navigating files to load signatures only (~90% savings).
- **PREFERRED**: Avoid ingesting full function bodies unless actively modifying them or tracing call-site logic.
- When full reads are needed, restrict to 100-line windows around target symbols.

### Smart Context Exclusions
- **MANDATORY**: Exclude lock files (`*.lock`, `package-lock.json`), build outputs (`dist/`, `build/`), and minified assets.
- Enforce `.copilotignore` patterns to block non-source artifacts from AI context.

### Unified Diff Formatting
- **MANDATORY**: Always propose code edits as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified files or entire classes.

### Autonomous Loop Guardrails
- **MANDATORY**: Abort retry cycles after 3 failures and summarize blocker.

### Smart Model Routing
- Leverage fast Flash/Haiku models for simple non-reasoning steps.

### Git Diff Context Scoping
- **MANDATORY**: Scope review & test tasks strictly to `git diff` lines + 1-hop callers.

### Deterministic Prefix Caching
- Maintain stable instruction prefix order across turns to maximize KV cache hits.
- Sink volatile turn metadata (timestamps, turn counters, ephemeral run IDs) to message suffix.

### License Header Stripping
- Strip copyright license headers and preamble blocks. Preserve inline comments.

### Test Failure Log Isolation
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.

<!-- TOKENSCULPT:END -->
