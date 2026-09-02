# AI Token Optimization Guidelines

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer. Managed block - do not edit manually. -->

## Token Efficiency Standards

### Search Before Synthesize (CodeGraph)
- Always search the codebase for existing implementations before generating new code
- Use semantic search to find related patterns, utilities, and similar solutions
- Reference existing code by file path instead of regenerating equivalent logic
- When asked to implement a feature, first check if a similar pattern already exists

### CLI Output Compression (RTK)
- Summarize test results: report pass/fail counts, not individual test lines
- Compress git log output: show only relevant commits with short hashes
- For build output: report success/failure and error count, not full verbose logs
- When showing file listings: use tree format, omit node_modules and build artifacts

### Concise Responses
- Use brief, direct responses for straightforward code changes
- Skip unnecessary introductions, conclusions, and framing
- Don't repeat the question or restate what the user already knows
- For simple fixes: show only the changed code, not the entire file
- Use bullet points over paragraphs when listing multiple items
- Avoid phrases like "Here's what I'll do:", "Let me explain:", "In summary:"

### Context Compaction & Session Hygiene
- When switching tasks, summarize the previous task state in 1-2 lines
- Don't re-read files that were recently read in the same session
- If context grows large, proactively suggest what can be dropped
- For repetitive tasks (formatting, renaming), use the most efficient model available
- Keep instruction compliance checks brief — don't quote the full instruction back

### Semantic Answer Cache (token-cache MCP)
A local `token-cache` MCP server caches answers on disk — cache hits cost zero model tokens.
- MANDATORY FIRST STEP for explanatory/conceptual questions — call `cache_lookup` with the question BEFORE searching, reading files, or delegating to any agent. Don't pre-judge whether it was likely asked before; always check first.
- Check the cache yourself before delegating research to a subagent — subagents start with fresh context and cannot see or populate this cache.
- If `hit` is true and `stale` is false, reuse the cached answer and note it came from cache — skip further tool calls.
- If `stale` is true, the code changed since it was stored — verify before reusing.
- After producing a reusable, self-contained answer, call `cache_store`.
- Use `scope: "durable"` for answers independent of current code state.
- Do NOT cache answers about uncommitted or actively changing code.

### AST Skeleton Pruning (skeleton_view MCP)
- Call `skeleton_view` before reading complete file contents to load signatures only.

### Smart Context Exclusions
- Exclude build bundles (dist/, build/), package lockfiles, and minified assets from AI prompt context.

### Unified Diff Output
- Format code modifications as targeted unified diff chunks instead of whole-file rewrites.

### Autonomous Loop Guardrails
- Abort runaway agent retry loops after 3 consecutive failures.

### Smart Model Routing
- Direct routine non-reasoning tasks to lightweight fast model tiers.

### Git Diff Scoping
- When reviewing changes or writing feature tests, scope prompt context strictly to `git diff` and 1-hop AST callers/callees.

### Prompt Prefix Caching
- Maintain deterministic, byte-identical prompt prefix blocks across turns to maximize cloud prompt caching discounts.

### Comment & Header Stripper
- Strip copyright headers, license preambles, and low-signal inline comments during context ingestion.

### Test Failure Log Isolation
- Filter test suite logs to isolate failing assertions and line numbers, stripping out passing suites.

### Windowed Range Slicing
- Restrict file navigation to targeted 100-line slice windows around symbols.

### Inline Chat Scope Pinning
- Restrict VS Code inline chat context strictly to currently selected lines and their immediate 1-hop symbol references.

### .copilotignore File Rules
- Enforce `.copilotignore` patterns to block build outputs, secrets, environment files, and non-source artifacts from AI context.

### Edit Session Awareness
- Avoid re-reading or re-inspecting files that are already open and dirty in the active multi-file edit session.

### Context Saturation Thread Reset
- When a chat session exceeds 40 conversation turns, surface a clear recommendation to start a fresh chat thread to avoid attention degradation.

## Task-Specific Guidelines

### For Debugging Tasks
- Show full error messages and stack traces (compression disabled)
- Include complete log output when diagnosing issues
- Don't summarize test failures — show the actual assertion errors

### For Planning Tasks
- Provide complete, detailed responses (verbosity control disabled)
- Include all relevant context and trade-off analysis
- Don't compress architectural explanations

### For Code Review
- Preserve full session context (session clearing disabled)
- Reference all previously discussed files and decisions
- Show complete diff context for suggested changes

<!-- TOKENSHIELD:END -->
