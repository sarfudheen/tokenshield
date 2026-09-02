# AI Token Optimization Guidelines

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer. Managed block - do not edit manually. -->

## Token Efficiency Standards

### Search Before Synthesize (CodeGraph)
- Search existing codebase for similar patterns before generating new code
- Reference existing implementations by file path instead of duplicating logic
- Use indexed search when available for faster file discovery

### CLI Output Compression (RTK)
- Summarize CLI output: report counts and status, not individual lines
- Use compact formats for git logs, test results, and build output
- When errors occur, show only the relevant error — not the full verbose log

### Concise Direct Responses
- Keep responses brief and direct for routine code changes
- Show only modified code sections, not entire files
- Use bullet points over paragraphs
- Skip unnecessary preambles and summaries

### Context Compaction & Session Hygiene
- Summarize completed task context before moving to new tasks
- Don't re-read recently accessed files
- Suggest context trimming when conversation grows large
- Use efficient model routing for simple vs complex tasks

### Local Semantic Cache (token-cache MCP)
Local `token-cache` MCP server — cached answers cost zero model tokens.
- Mandatory first step for explanatory questions: call `cache_lookup` BEFORE searching/reading/delegating — don't pre-judge whether it seems repeated.
- Check the cache yourself before delegating to a subagent; subagents can't see or populate this cache.
- Reuse non-stale hits; verify stale ones (code changed since stored).
- Call `cache_store` after reusable, self-contained answers (`scope: "durable"` if code-independent).
- Never cache answers about uncommitted or actively changing code.

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

## Constraints
- Full verbosity for debugging sessions (need complete error context)
- Full detail for architectural planning (need thorough analysis)
- Never compress security-related output

<!-- TOKENSHIELD:END -->
