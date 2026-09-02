<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# OpenAI Codex Guidelines

## Active Optimizations

### CodeGraph Search
- **MANDATORY**: Query `codegraph_explore` before reading files.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.

### CLI Output Compression (RTK)
- **MANDATORY**: Pipe shell executions through `rtk` filters (`rtk git`, `rtk test`, `rtk ls`).
- **FORBIDDEN**: Never run raw `git` commands directly in terminal.

### Concise Direct Responses
- **MANDATORY**: Return code and diffs directly with zero pleasantries or summaries.

### Context Compaction & Session Hygiene
- **MANDATORY**: Avoid re-reading recently inspected files in the same turn.

### Local Semantic Cache
- **MANDATORY**: Query `cache_lookup` tool before answering repeat/boilerplate questions.

### AST Skeleton Pruning
- **MANDATORY**: Use `skeleton_view` to inspect type definitions and structure.
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.

### Smart Context Exclusions
- **MANDATORY**: Exclude build/dist artifacts, lockfiles, and minified bundles.

### Diff Edits
- **MANDATORY**: Propose edits strictly as targeted unified diff chunks.
- **FORBIDDEN**: Never reprint unmodified source files.

### Autonomous Loop Guardrails
- **MANDATORY**: Limit consecutive retries to 3 and summarize blocker.

### Smart Model Routing
- Suggest lightweight models for boilerplate/formatting edits.

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
