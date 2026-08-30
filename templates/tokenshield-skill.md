---
name: tokenshield-optimize
description: >
  Analyze current AI interaction patterns and suggest token/cost
  optimizations using TokenShield's 19 CAP directives.
---

# TokenShield Optimization Skill

Invoke this skill when you want to optimize AI token usage and prompt efficiency for a specific development task.

## Optimization Workflow

1. Read `.github/instructions/tokenshield.instructions.md` to identify active directives.
2. Check which CAP directives apply to the current user intent:
   - **File Exploration**: Apply CAP-6 (AST Skeleton Pruning) or CAP-15 (Windowed Range Slicing).
   - **Code Editing**: Apply CAP-8 (Diff-Only Output) — never reprint unmodified code.
   - **Testing / Build**: Apply CAP-14 (Test Log Failure Isolation) — filter to failing lines only.
   - **Context Cleanup**: Apply CAP-7 (Context Exclusions) — ignore build and lock artifacts.
   - **Repeated Questions**: Apply CAP-5 (Semantic Cache) — reuse cached answers when available.
3. Report estimated token savings to the user after completing the task.
