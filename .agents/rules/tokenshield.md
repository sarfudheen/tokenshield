<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# Antigravity TokenShield Optimizations

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
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.

### Smart Context Exclusions
- **MANDATORY**: Exclude lock files (`*.lock`, `package-lock.json`), build outputs (`dist/`, `build/`), and minified assets.

### Unified Diff Formatting
- **MANDATORY**: Always propose code edits as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified files or entire classes.

### Autonomous Loop Guardrails
- **MANDATORY**: Abort retry cycles after 3 failures and summarize blocker.

### Smart Model Routing
- Leverage fast Flash/Haiku models for simple non-reasoning steps.

<!-- TOKENSHIELD:END -->
