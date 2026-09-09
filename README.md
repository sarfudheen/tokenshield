# TokenShield — AI Token & Cost Optimizer (Copilot & Claude)

<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="TokenShield Icon" />
</p>

<p align="center">
  <strong>Universal AI Token & Cost Optimization Platform for Developers, Teams, and Enterprises.</strong><br>
  <em>Compatible with Google Antigravity IDE, GitHub Copilot, Cursor, Windsurf, Claude Code, and Codex.</em>
</p>

<p align="center">
  <a href="INSTALLATION.md"><strong>Full Installation Guide</strong></a> •
  <a href="#-the-20-optimization-features">20 Optimization Features</a> •
  <a href="#-status-bar-master-hub--lifetime-tracking">Status Bar Hub</a> •
  <a href="#-real-time-savings-dashboard--activity-log">Savings Dashboard</a> •
  <a href="#-multi-editor-mcp-auto-configuration">MCP Integration</a> •
  <a href="#-commands--keybindings">Commands</a> •
  <a href="#-configuration-reference-settingsjson">Configuration</a>
</p>

---

## 🌟 Why TokenShield?

AI coding assistants (Copilot, Claude, Gemini, GPT-4o) frequently consume tens of thousands of redundant tokens by re-reading build bundles, lockfiles, verbose test logs, repetitive system instructions, and conversational filler.

**TokenShield acts as a zero-latency, 100% on-device efficiency layer** that enforces intelligent caching, AST structural pruning, reversible context compression, context noise exclusion, and unified diff editing across all your favorite IDEs.

### 🏆 Key Benchmarked Gains:
- **~75–95% context reduction** during file navigation using AST Signatures (`skeleton_view`).
- **~92% output token savings** by enforcing unified diff patches instead of full 500-line file rewrites.
- **60–95% context reduction** on massive JSON dumps and tool logs using Headroom Reversible CCR (`headroom_compress`).
- **100% free answer reuse (<2ms latency)** via local on-disk semantic caching (`.aicache/`).
- **~500,000+ tokens blocked per workspace scan** by automatically excluding `dist/`, lockfiles, and minified bundles.
- **30–50% prompt compression** with the built-in Adaptive Context Pruner (`prune_context`).
- **Persistent Session & Lifetime Savings Tracking** across IDE restarts with status bar metrics and session archival.

---

## ⚡ The 20 Optimization Features

TokenShield comes equipped with 20 modular optimizations, active right out of the box:

| # | Category | Optimization Feature | How It Works | Measured Gain |
|---|---|---|---|---|
| 1 | **Code Search** | **CodeGraph Pre-Indexing** | Uses AST symbol graphs to find files instead of wide grep scans | **~97% savings** vs multi-file grep |
| 2 | **Terminal** | **CLI Output Compression** | Strips build spinners, git noise, and verbose logs via RTK/inline filters | **60–90%** terminal log reduction |
| 3 | **Prompt Filter** | **Concise AI Responses** | Strips conversational filler, apologies, and greetings from AI responses | **~35%** output token reduction |
| 4 | **Session** | **Context Compaction** | Prunes stale multi-turn history and drops redundant tool output | Prevents context window bloat |
| 5 | **Disk Cache** | **Semantic Cache** | Local semantic cache serving repeat answers instantly at $0.00 cost | **100% savings** on repeated queries |
| 6 | **AST Parser** | **AST Skeletons** | Extracts types, classes, and function signatures without full bodies | **75–95%** file inspection savings |
| 7 | **Exclusions** | **Smart Context Exclusions** | Auto-excludes `dist/**`, `package-lock.json`, and minified assets | **~500k tokens** blocked per scan |
| 8 | **Patch Editing** | **Diff-Only Output** | Outputs targeted diff hunks (±3 lines) rather than rewriting full files | **~92%** reduction on code changes |
| 9 | **Safety** | **Loop Guardrails** | Halts runaway retry loops after 3 consecutive autonomous failures | Prevents runaway credit burn |
| 10 | **Routing** | **Smart Model Routing** | Routes routine tasks (formatting, typos, minor edits) to lighter models | **Up to 99% cost reduction** |
| 11 | **Git Scope** | **Git Diff Scoping** | Scopes code reviews and unit test generation strictly to git diff lines | **~85% context reduction** |
| 12 | **Cloud Cache** | **Prompt Prefix Caching** | Maintains byte-stable instruction prefixes to unlock cloud KV cache hits | **Up to 90% cloud discounts** |
| 13 | **Minifier** | **License Header Stripper** | Strips copyright & license preambles (safe mode); preserves code comments | **15–30%** context reduction |
| 14 | **Test Runner** | **Test Failure Isolator** | Captures failing assertions and stack traces while stripping passing suites | **~95%** test log compression |
| 15 | **Range Slicer** | **Windowed Range Slicing** | Restricts large file reads to 100-line windows around symbol targets | **~80%** reduction on file lookups |
| 16 | **Editor Scope** | **Inline Chat Scope Lock** | Constrains inline editor chat strictly to selected lines and dependencies | **~85%** prompt reduction |
| 17 | **Rules** | **.copilotignore Generator** | Maintains project-level `.copilotignore` rules to block build noise | Blocks secrets and artifacts |
| 18 | **Session Cache** | **Edit Session Awareness** | Treats files open in multi-file edit sessions as already loaded | Avoids redundant tool re-reads |
| 19 | **Monitor** | **Context Saturation Monitor** | Proactively suggests a fresh chat thread when conversation exceeds 40 turns | Prevents quality degradation |
| 20 | **CCR Engine** | **Headroom Reversible CCR** | Reversible context compression & SmartCrusher for massive JSON/logs with local retrieval | **60–95%** context reduction |

> [!TIP]
> **Directive Compaction (Prompt ROI Optimization)**: While all 20 strategies remain individually configurable in TokenShield's engine, generated instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) output a streamlined, consolidated directive set (~35% smaller prompt footprint). Native editor behaviors (inline chat scoping, edit-session awareness, context saturation) are delegated to the host IDE, and complementary directives (range slicing into AST skeletons, `.copilotignore` into context exclusions) are merged to maximize cloud KV-cache efficiency and eliminate prompt overhead.


---

## 🚀 Step-by-Step Installation Guide

For detailed step-by-step setup, companion tool installation, and team configuration, see the [Full Installation Guide](INSTALLATION.md).

### 📥 Download VSIX

Download the latest `.vsix` binary from GitHub Releases (under **Assets**):

👉 **[Download Latest VSIX Release](https://github.com/sarfudheen/tokenshield/releases/latest)**

*(Or download specific versions from [All Releases](https://github.com/sarfudheen/tokenshield/releases).)*

### ⚡ Quick Install (VSIX)

Once downloaded, install the `.vsix` package into your editor:

#### 1. Google Antigravity IDE
1. Open Antigravity IDE.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) → **`Extensions: Install from VSIX...`**.
3. Select `tokenshield-1.0.17.vsix`.
4. Reload the window (`Ctrl+Shift+P` → `Developer: Reload Window`).

*Optional Direct Sync:*
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.antigravity-ide\extensions\tokenshield"
Copy-Item -Path ".\dist\*" -Destination "$HOME\.antigravity-ide\extensions\tokenshield\dist\" -Recurse -Force
Copy-Item -Path ".\package.json" -Destination "$HOME\.antigravity-ide\extensions\tokenshield\package.json" -Force
```

#### 2. Visual Studio Code & VS Code Insiders
```bash
code --install-extension tokenshield-1.0.17.vsix
```
Or via Extensions view (`Ctrl+Shift+X`) → `...` menu → **`Install from VSIX...`**.

#### 3. Cursor & Windsurf
```bash
cursor --install-extension tokenshield-1.0.17.vsix
# or
windsurf --install-extension tokenshield-1.0.17.vsix
```

#### 4. Claude Code CLI
TokenShield automatically configures Claude Code's MCP settings in `~/.claude.json`. Alternatively, point directly to the built-in MCP server:
```json
{
  "mcpServers": {
    "token-cache": {
      "command": "node",
      "args": ["/path/to/tokenshield/dist/cache-server.js", "/path/to/workspace"]
    }
  }
}
```

---

## 🛡️ Status Bar Master Hub & Lifetime Tracking

TokenShield features a consolidated status bar item displaying live savings metrics:

```
$(shield) TS: Full · 520k ↓ · $7.80
```

### Highlights:
- **Dual Tracking**: Tracks both **Active Session Savings** and **Persistent Lifetime Savings** stored safely on disk in `.aicache/lifetime-savings.json`.
- **1-Click Master Hub**: Clicking the status bar badge opens the **TokenShield Hub QuickPick** with instant access to:
  - Switching optimization profiles (`full`, `debug`, `planning`, `review`, `custom`)
  - 1-click toggling of any individual strategy (`TokenShield: Toggle Feature`)
  - Viewing live session breakdown & starting a fresh session (`TokenShield: Start New Session`)
  - Opening the full visual Savings Dashboard
  - Completely deactivating or reactivating TokenShield
  - Resetting all historical tracking data

---

## 🔌 Multi-Editor MCP Auto-Configuration

TokenShield automatically configures and maintains Model Context Protocol (MCP) integrations across your environments on activation:

- **VS Code Copilot:** Configures `mcp.servers` and `github.copilot.chat.mcp.servers` in `.vscode/settings.json`.
- **Antigravity IDE:** Configures `.agents/mcp_config.json`.
- **Claude Code:** Configures `~/.claude.json`.

### Configured On-Device Servers (100% Local):
1. **`token-cache`** *(Built-in)*: On-device semantic cache (`cache_lookup`, `cache_store`), AST signature extraction (`skeleton_view`), adaptive context pruning (`prune_context`).
2. **`headroom`** *(Reversible CCR)*: Local reversible context compression and SmartCrusher (`headroom_compress`, `headroom_retrieve`).
3. **`codegraph`** *(Semantic Graph)*: Local AST symbol graph query integration (`codegraph_explore`).

> [!NOTE]
> All configured MCP servers execute 100% locally via stdio on your machine. TokenShield makes **zero external network calls** and sends no code or queries to third-party cloud services.

Run `Ctrl+Shift+P` → **`TokenShield: Configure MCP Servers`** to re-run auto-discovery and configuration at any time.

---

## 🔴 Real-Time Savings Dashboard & Activity Log

TokenShield features a modern **Glassmorphism Savings Dashboard** that tracks your token savings and estimated spend reduction in real time:

- **Tokens Saved Counter**: Live session and lifetime savings aggregated across AST skeletons, semantic caching, exclusions, and diff modifications.
- **Estimated Spend Reduction ($)**: Calculated using active model rates (Gemini Flash, Haiku, GPT-4o, Claude Sonnet/Opus).
- **Live Activity Log**: Every single optimization event tracked with timestamps, target file, exact tokens saved, and mechanism.
- **Visual Donut & Progress Metrics**: Clean visual health bars and efficiency gauges for all 20 optimization features.
- **Context Exclusion Manager**: Inspect and toggle ignored directories, lockfiles, and custom patterns directly from the UI.

### How to Access:
- Press `Ctrl+Shift+P` → **`TokenShield: Open Savings Dashboard`**
- Or click the **`$(shield) TS:`** badge in the bottom status bar!

---

## ⌨️ Commands & Keybindings

All commands are registered under the clean `tokenshield.*` namespace:

| Command Title | Command ID | Description |
|---|---|---|
| **TokenShield: Hub** | `tokenshield.hub` | Open Master Hub QuickPick for fast profile switching, feature toggles, and status |
| **TokenShield: Open Savings Dashboard** | `tokenshield.dashboard` | Open visual savings dashboard with live activity log and metric donuts |
| **TokenShield: Toggle Feature (1-Click Switch)** | `tokenshield.toggleFeature` | Interactive QuickPick to instantly toggle any of the 20 optimization strategies |
| **TokenShield: Switch Profile** | `tokenshield.switchProfile` | Switch between `full`, `debug`, `planning`, `review`, and `custom` |
| **TokenShield: Toggle On/Off** | `tokenshield.toggle` | Globally pause or resume TokenShield optimizations |
| **TokenShield: Deactivate Completely** | `tokenshield.deactivateCompletely` | Cleanly strip all TokenShield directives from `.github`, `CLAUDE.md`, `AGENTS.md` |
| **TokenShield: Reactivate All Optimizations** | `tokenshield.reactivate` | Re-inject all optimization directives and re-enable active strategies |
| **TokenShield: Start New Session** | `tokenshield.newSession` | Archive current session savings to lifetime store and reset active counters |
| **TokenShield: Reset Complete Data (Wipe All History)** | `tokenshield.resetAllData` | Wipe all lifetime history, archived sessions, and event logs from disk |
| **TokenShield: Edit Context Exclusions** | `tokenshield.exclusions` | Interactive picker for build folder, lockfile, and bundle exclusions |
| **TokenShield: Configure MCP Servers** | `tokenshield.configureMcp` | Auto-discover and configure MCP servers for VS Code, Claude, and Antigravity |
| **TokenShield: Run Health Check** | `tokenshield.healthCheck` | Live diagnostic validation across all 20 optimization features and tools |
| **TokenShield: Flush Semantic Cache** | `tokenshield.flushCache` | Clears local disk cache in `.aicache/semantic-cache.json` |
| **TokenShield: Reindex Code Graph** | `tokenshield.reindex` | Triggers a fresh AST symbol graph index in `.codegraph/` |
| **TokenShield: Validate Code Graph** | `tokenshield.validateGraph` | Verify integrity of `.codegraph/` semantic symbol index |
| **TokenShield: Manage Graph Projects** | `tokenshield.manageProjects` | Manage multi-root CodeGraph project indices |
| **TokenShield: Export Savings Report** | `tokenshield.exportReport` | Exports clean savings reports in Markdown, JSON, or CSV format |
| **TokenShield: Regenerate Directives** | `tokenshield.regenerate` | Updates AI instruction files (`AGENTS.md`, `.github/`, `CLAUDE.md`, `.codex/`) |
| **TokenShield: Export Directives to Repo** | `tokenshield.exportToRepo` | Promote local `.vscode/` instructions to repository-tracked `.github/` files |
| **TokenShield: Initialize Project** | `tokenshield.init` | Analyzes workspace stack and generates customized instruction files |
| **TokenShield: Setup CLI Tools** | `tokenshield.setupTools` | Verifies and configures CLI acceleration tools (RTK, CodeGraph, Headroom) |
| **TokenShield: Prune & Copy to Clipboard** | `tokenshield.pruneAndCopy` | Compresses active file or selection (30–50% savings) to clipboard |
| **TokenShield: Compress Git Diff** | `tokenshield.compressDiff` | Compresses current git diff for token-efficient PR reviews |

---

## ⚙️ Configuration Reference (`settings.json`)

Configure TokenShield via `.vscode/settings.json` or user settings under the `tokenshield` namespace:

```json
{
  "tokenshield.enabled": true,
  "tokenshield.profile": "full",
  "tokenshield.autoApply": true,
  "tokenshield.useVscodeStorage": true,
  "tokenshield.githubInstructions": true,
  "tokenshield.githubStructureMode": "auto",
  "tokenshield.generateAgentFiles": false,
  "tokenshield.configureMcpOnActivation": true,
  "tokenshield.telemetry.enabled": true,
  "tokenshield.verbosityLevel": "full",
  "tokenshield.commentStrippingMode": "headers-only",
  "tokenshield.activeStrategies": {
    "codeGraph": true,
    "outputCompression": true,
    "verbosityControl": true,
    "sessionManagement": true,
    "semanticCache": true,
    "astSkeleton": true,
    "contextExclusion": true,
    "diffOnlyOutput": true,
    "agentGuardrails": true,
    "smartModelRouting": true,
    "gitDiffContext": true,
    "kvCacheAlignment": true,
    "commentStripper": true,
    "testFailureIsolator": true,
    "rangeSlicing": true,
    "inlineChatScopePinning": true,
    "copilotIgnoreGeneration": true,
    "copilotEditsAwareness": true,
    "threadResetTrigger": true,
    "headroomCompression": true
  },
  "tokenshield.guardrails": {
    "maxRetries": 3,
    "maxFilesPerTask": 10,
    "maxFileReads": 2
  },
  "tokenshield.pricing": {
    "flagship": { "inputPerMillion": 15.0, "outputPerMillion": 75.0 },
    "standard": { "inputPerMillion": 3.0, "outputPerMillion": 15.0 },
    "lightweight": { "inputPerMillion": 0.15, "outputPerMillion": 0.60 }
  }
}
```

---

## 🔒 100% Security & Privacy Guarantee

- **Zero Cloud Leakage**: 100% on-device local execution. No source code or telemetry ever leaves your machine.
- **Offline & Air-Gapped Friendly**: Fully functional without internet connectivity.
- **Zero Repo Clutter**: Local configuration stored in `.vscode/` by default — never touches git tracking unless explicitly exported.

---

## 📄 License
MIT License. Built for developers and modern software engineering teams.
