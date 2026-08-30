<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

# Antigravity TokenShield Directives

## Active Directives

### CodeGraph Pre-Indexing (CAP-1)
- **MANDATORY**: Query `codegraph_explore` before broad grep searches.
- **FORBIDDEN**: Never run wide file greps when CodeGraph index is available.

### RTK Command Output Filtering (CAP-2)
- **MANDATORY**: Execute shell commands through RTK filters (`rtk git`, `rtk test`, `rtk ls`).
- **FORBIDDEN**: Never invoke raw `git` commands directly in terminal.

### Dense Precision Output (CAP-3)
- **MANDATORY**: Answer directly with actionable diffs and zero pleasantries.
- **FORBIDDEN**: Never include preambles, intros, or chit-chat.

### Session Hygiene (CAP-4)
- **MANDATORY**: Keep task state concise and reuse loaded symbol memory.
- **FORBIDDEN**: Never re-read previously inspected files in the same turn.

### Local MCP Semantic Cache (CAP-5)
- **MANDATORY**: Query `cache_lookup` tool for repeated/boilerplate answers.

### AST Skeleton Pruning (CAP-6)
- **MANDATORY**: Call `skeleton_view` MCP tool first when navigating files to load signatures only (~90% savings).
- **FORBIDDEN**: Never ingest full function bodies unless actively modifying them.

### Context Exclusions (CAP-7)
- **MANDATORY**: Exclude lock files (`*.lock`, `package-lock.json`), build outputs (`dist/`, `build/`), and minified assets.

### Unified Diff Formatting (CAP-8)
- **MANDATORY**: Always propose code edits as targeted unified diff chunks with ±3 lines of context.
- **FORBIDDEN**: Never reprint unmodified files or entire classes.

### Autonomous Guardrails (CAP-9)
- **MANDATORY**: Abort retry cycles after 3 failures and summarize blocker.

### Model Routing (CAP-10)
- Leverage fast Flash/Haiku models for simple non-reasoning steps.

### Git Diff Context (CAP-11)
- **MANDATORY**: Scope review & test tasks strictly to `git diff` lines + 1-hop callers.

### Deterministic Prompt Prefix Caching (CAP-12)
- Maintain stable instruction prefix order across turns to maximize KV cache hits.

### Comment Stripping (CAP-13)
- Strip copyright headers and filler comments on ingestion.

### Test Log Isolation (CAP-14)
- **MANDATORY**: Report only failing test lines, assertions, and line numbers.

### Range Slicing (CAP-15)
- **MANDATORY**: Inspect 100-line windows around target symbols instead of full files.

### Inline Chat Scope (CAP-16)
- **MANDATORY**: Restrict context to selected editor lines and direct references.

### .copilotignore Compliance (CAP-17)
- **MANDATORY**: Never read or reference ignored paths.

### Edit Session Awareness (CAP-18)
- **MANDATORY**: Do not re-read files already open in the active edit session.

### Thread Reset Trigger (CAP-19)
- Surface a fresh-thread prompt when conversation exceeds 40 messages.

<!-- TOKENSHIELD:END -->
