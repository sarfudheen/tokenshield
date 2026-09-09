# Changelog

All notable changes to the "TokenShield" extension will be documented in this file.

## [1.0.17] - 2026-09-09

### Added
- **KV-Cache Hit Maximizer & Prompt Normalizer (`align_prefix_cache`)**:
  - Added new MCP tool `align_prefix_cache` to `token-cache` server (v0.5.0).
  - Scans prompt contexts to extract volatile elements (ISO timestamps, turn counters, ephemeral session UUIDs) and relocates them to the suffix under `<!-- TOKENSHIELD:EPHEMERAL_SUFFIX -->`, guaranteeing a byte-stable static prefix for 75–90% cloud KV-cache discounts.
  - Added optional 1,024-token cache block boundary padding (`padToBlock`).
  - Added prompt cacheability analyzer and health check verification (`analyzePromptCacheability`) in `TokenShield: Health Check`.
  - Mapped `Prefix Cache` savings events to the real-time Dashboard visualizer and activity feed.
- **Headroom Zero-Telemetry Air-Gap Safeguard**:
  - Injected `HEADROOM_BEACON='off'`, `HEADROOM_TELEMETRY='off'`, `HEADROOM_OFFLINE='1'`, and `DO_NOT_TRACK='1'` into all Headroom MCP configurations across VS Code (`.vscode/settings.json`), Claude Code (`~/.claude.json`), and Antigravity (`.agents/mcp_config.json`, `~/.gemini/config/mcp_config.json`).
  - Enforced zero-telemetry process environment guard on extension activation in `src/extension.ts` to ensure 100% on-device air-gapped operation.
- **Safe Comment Stripping Modes (`tokenshield.commentStrippingMode`)**:
  - `'headers-only'` mode (default): Strips copyright license headers and preambles while preserving inline code comments, preventing degradation of LLM bug-fixing and code reasoning accuracy (addressing findings from arXiv 2025 research).
  - `'aggressive'` mode: Strips both headers and inline filler comments.
  - `'off'` mode: Disables comment stripping entirely.
  - Disabled `commentStripper` in the `review` profile by default (reviewers require comments to evaluate intent).
  - Updated `cache-server` MCP `strip_comments` tool with `headersOnly` boolean flag (defaults to `true`).
- **Antigravity IDE Support**:
  - Full first-class generator for Google Antigravity IDE (`AntigravityGenerator`).
  - Auto-manages `AGENTS.md` and `.agents/rules/tokenshield.md`.
  - Configures on-device MCP servers in `.agents/mcp_config.json`.
- **Dynamic Model Routing Pricing Table**:
  - Replaced fabricated flat rate ($0.01) with actual rate calculations via `PricingTable` (`pricing.flagship`, `pricing.standard`, `pricing.lightweight` per million tokens).
  - Modeled savings based on estimated average tokens per task (~2000 tokens/task).
- **Headroom SDK Availability Guard**:
  - Added `isHeadroomSdkAvailable()` check using `require.resolve('headroom-ai')`.
  - Prevents emitting Headroom MCP directives when the package is not installed.
- **Prompt Prefix Caching (Top Placement)**:
  - `mergeContent` now inserts new TokenShield blocks at the **TOP** of instruction files (when no markers exist).
  - Aligns with cloud LLM prompt caching mechanisms (Anthropic, OpenAI, Gemini) to unlock 50–90% input token cost discounts.

### Changed
- **Directive Compaction & ROI Optimization**:
  - Consolidated and compacted prompt directives across all generators (`copilot.ts`, `claude.ts`, `antigravity.ts`, `codex.ts`), reducing instruction token overhead by ~35%.
  - Omitted directives natively handled by modern IDEs (`inlineChatScopePinning`, `copilotEditsAwareness`, `threadResetTrigger`).
  - Merged complementary directives: `rangeSlicing` into `astSkeleton`, and `copilotIgnoreGeneration` into `contextExclusion`.
  - Softened AST skeleton guidance from `FORBIDDEN` to `PREFERRED`, eliminating LLM refusals when inspecting function implementations during debugging.

## [1.0.0] - 2026-08-30

### Added
- 20 modular optimization strategies covering AST skeletons, semantic caching, exclusions, and loop guardrails.
- Unified status bar master hub with active session and lifetime persistent tracking.
- Webview Savings Dashboard with real-time donut charts and activity log.
- Automated multi-editor MCP auto-configuration for VS Code, Antigravity, and Claude Code.

## [0.1.0] - 2026-06-23

### Added
- Initial release
- Four token-reduction strategies (CodeGraph, RTK, Caveman, Session Management)
- Auto-generation of instruction files for Copilot, Claude Code, and Codex
- Profile-based strategy selection (Full, Debug, Planning, Review, Custom)
- Silent installation of optimization tools (codegraph, rtk-compress, caveman)
- MCP server configuration (Context7, CodeGraph)
- Before/after token savings dashboard
- Status bar indicator with click-to-configure
- CodeGraph file watcher with 30-second debounce reindexing
- Marker-based merge to preserve existing instruction file content
- Workspace-level configuration support
