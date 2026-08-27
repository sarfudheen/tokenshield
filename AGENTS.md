# Antigravity TokenShield Directives

<!-- TOKENSHIELD:START -->
<!-- TokenShield: AI Token & Cost Optimizer (v1.0.0). Managed block - do not edit manually. -->

## Active Directives

### CodeGraph Pre-Indexing (CAP-1)
- Query codegraph_explore / graph index before running wide grep searches.

### RTK Command Output Filtering (CAP-2)
- Execute shell tasks through RTK filters when running tests or git inspections.

### Dense Precision Output (CAP-3)
- Answer directly with actionable diffs and zero pleasantries.

### Session Hygiene (CAP-4)
- Keep task state concise and avoid repeated context accumulation.

### Local MCP Semantic Cache (CAP-5)
- Query token-cache tool `cache_lookup` to reuse proven answers from local disk.

### AST Skeleton Pruning (CAP-6)
- Call `skeleton_view` MCP tool first when navigating repository files to load signatures only (~90% savings).

### Context Exclusions (CAP-7)
- Exclude generated assets, lockfiles (*.lock, package-lock.json), and bundle artifacts (dist/, build/) from context.

### Unified Diff Formatting (CAP-8)
- Always propose code edits as targeted unified diff chunks with line context.

### Autonomous Guardrails (CAP-9)
- Abort infinite retry cycles after 3 failures and summarize blocker.

### Model Routing (CAP-10)
- Leverage fast Flash/Haiku models for simple non-reasoning steps.

<!-- TOKENSHIELD:END -->
