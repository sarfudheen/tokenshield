# AI Token Optimization Rules

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer. Managed block - do not edit manually. -->

## Token Efficiency Standards

### Search Before Synthesize (CodeGraph)
- Before writing new code, use available search tools to find existing implementations
- Query the code graph index for symbol locations instead of grepping file-by-file
- Reference existing patterns by path rather than regenerating equivalent logic
- Use `codegraph query` for natural-language file discovery when available

### CLI Output Compression (RTK)
- When running CLI commands, pipe through RTK if configured: results are pre-compressed
- Summarize test results: "43 tests passed, 2 failed" not individual lines
- For git operations: use short format (`--oneline`, `--stat`) by default
- Compress verbose build output to actionable summary

### Concise Responses
- Use /compact mode for routine code generation tasks
- Keep responses concise — communicate the same content in fewer words
- Skip boilerplate explanations for obvious changes
- For simple edits: show only the diff, not surrounding unchanged code
- Don't repeat context that's already in the conversation

### Context Compaction & Session Hygiene
- Use `/compact` for routine tasks to reduce response tokens
- Suggest `/clear` when switching between unrelated tasks
- Use Haiku/Sonnet via `/model` for lightweight operations (file navigation, simple renames, formatting)
- Use `/context` to audit and trim oversized context contributors
- When CLAUDE.md exceeds 10k tokens, suggest splitting into focused sections

### Semantic Answer Cache (token-cache MCP)
A local `token-cache` MCP server caches answers on disk — cache hits cost zero model tokens.
- MANDATORY FIRST STEP for any explanatory/conceptual question ("what is X", "how does X work", "why was X built") — call `cache_lookup` with the question BEFORE reading files, grepping, calling codegraph, or spawning a subagent. Do not decide first whether it "seems" repeated — always check; the check itself is nearly free.
- This applies even when you're about to delegate the research to a subagent/Task tool — check the cache yourself in the main thread first, because a subagent starts with a fresh context and no access to this MCP server, so it can never check or populate the cache on your behalf.
- If `hit` is true and `stale` is false, reuse the cached answer and note it came from cache — skip further tool calls entirely.
- If `stale` is true, the code changed since it was stored — verify before reusing.
- After producing a reusable, self-contained answer (including one assembled from subagent output), call `cache_store` with the original question and the final answer.
- Use `scope: "durable"` for answers independent of current code state.
- Do NOT cache answers about uncommitted or actively changing code.

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

## Task-Type Routing

### Lightweight Tasks (use lighter model)
- File navigation and search
- Simple rename/move operations
- Code formatting
- Boilerplate generation
- Documentation lookups

### Full-Power Tasks (use most capable model)
- Architectural decisions
- Complex debugging
- Multi-file refactoring
- Security reviews
- Performance optimization

## Constraints
- Disable output compression during active debugging (need full stack traces)
- Disable verbosity control during architectural planning (need complete analysis)
- Never compress error messages or security warnings
- Re-index CodeGraph after significant code changes (new files, moved modules)

<!-- TOKENSHIELD:END -->
