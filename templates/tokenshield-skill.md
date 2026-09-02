---
name: tokenshield-optimize
description: >
  Analyze current AI interaction patterns and suggest token/cost
  optimizations using TokenShield's 19 optimization features.
---

# TokenShield Optimization Skill

Invoke this skill when you want to optimize AI token usage and prompt efficiency for a specific development task.

## Optimization Workflow

1. Read instruction rules to identify active optimization features.
2. Check which features apply to the current task:
   - **File Exploration**: Apply AST Skeleton Pruning or Windowed Range Slicing.
   - **Code Editing**: Apply Diff-Only Output — never reprint unmodified code.
   - **Testing / Build**: Apply Test Failure Isolation — filter to failing lines only.
   - **Context Cleanup**: Apply Context Exclusions — ignore build and lock artifacts.
   - **Repeated Questions**: Apply Semantic Cache — reuse cached answers when available.
3. Report estimated token savings to the user after completing the task.
