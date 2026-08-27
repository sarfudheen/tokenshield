# TokenShield — AI Token & Cost Optimizer

<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="TokenShield Icon" />
</p>

<p align="center">
  <strong>Universal AI Token & Cost Optimization Platform for Developers, Teams, and Enterprises.</strong><br>
  <em>Compatible with Google Antigravity IDE, GitHub Copilot, Cursor, Windsurf, Claude Code, and Codex.</em>
</p>

<p align="center">
  <a href="#-step-by-step-installation-guide">Installation</a> •
  <a href="#-the-10-tokenshield-directives-cap-1-through-cap-10">Directives</a> •
  <a href="#-real-time-live-activity-ledger--telemetry">Telemetry</a> •
  <a href="#-commands--keybindings">Commands</a> •
  <a href="#-multi-editor-mcp-integration">MCP Integration</a>
</p>

---

## 🌟 Why TokenShield?

AI coding assistants (Copilot, Claude, Gemini, GPT-4o) frequently consume tens of thousands of redundant tokens by re-reading build bundles, lockfiles, verbose test logs, repetitive system instructions, and conversational filler.

**TokenShield solves this by acting as a zero-latency, 100% on-device efficiency layer** that enforces intelligent caching, AST structural pruning, context noise exclusion, and unified diff editing across all your favorite IDEs.

### 🏆 Key Benchmarked Gains:
- **~75–95% context reduction** during file navigation using AST Signatures (`skeleton_view`).
- **~92% output token savings** by enforcing unified diff patches instead of full 500-line file rewrites.
- **100% free answer reuse (<2ms latency)** via local on-disk semantic caching (`.aicache/`).
- **~500,000+ tokens blocked per workspace scan** by automatically excluding `dist/`, lockfiles, and minified bundles.
- **30–50% prompt compression** with the built-in Adaptive Context Pruner (`prune_context`).

---

## ⚡ The 10 TokenShield Directives (CAP-1 through CAP-10)

| Directive | Name | Real-World Mechanism | Measured Gain |
|---|---|---|---|
| **CAP-1** | **CodeGraph Indexing** | Semantic graph search before full file reads (`.codegraph/`) | **97% savings** vs wide grep |
| **CAP-2** | **RTK Output Compression** | CLI proxy trimming test spinners, build logs, and git outputs | **60–90%** CLI log reduction |
| **CAP-3** | **Dense Output (Caveman)** | Strips conversational pleasantries and filler prose from AI responses | **~35%** output token savings |
| **CAP-4** | **Context Hygiene** | Auto-compacts completed tasks and clears stale conversational history | Prevents 128k context bloat |
| **CAP-5** | **Semantic Answer Cache** | Local JSON-RPC 2.0 MCP server with TF-IDF cosine matching | **100% savings** on repeated queries |
| **CAP-6** | **AST Skeleton Extraction** | MCP tool (`skeleton_view`) providing types & signatures only | **75–95%** file inspection savings |
| **CAP-7** | **Smart Context Exclusion** | Auto-excludes `dist/**`, `package-lock.json`, minified bundles | **~500k tokens** kept out of prompt |
| **CAP-8** | **Diff-Only Output Mode** | Enforces unified diff patches (±3 context lines) | **~92%** reduction on file edits |
| **CAP-9** | **Agent Loop Guardrails** | Hard limits on retries (max 3) and file edits (max 10) | Stops runaway autonomous loops |
| **CAP-10** | **Smart Model Routing** | Auto-routes routine tasks to fast, lightweight models (Gemini Flash/Haiku) | **99% cost reduction** per query |

---

## 🚀 Step-by-Step Installation Guide

TokenShield can be installed seamlessly across all major AI coding environments:

### 1. Google Antigravity IDE
TokenShield has first-class native support for Antigravity IDE (Gemini Pro & Flash High models):

#### Method A: Direct VSIX Installation (Recommended)
1. Open Antigravity IDE.
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS).
3. Type **`Extensions: Install from VSIX...`** and press Enter.
4. Select `tokenshield-1.0.0.vsix` from your project folder.
5. Reload the window (`Ctrl+Shift+P` → `Developer: Reload Window`).

#### Method B: Extension Runtime Directory Sync
Copy the built extension folder directly into your Antigravity user directory:
```powershell
# Windows
Copy-Item -Path ".\dist\*" -Destination "$HOME\.antigravity-ide\extensions\tokenshield.tokenshield-1.0.0\dist\" -Recurse -Force
Copy-Item -Path ".\package.json" -Destination "$HOME\.antigravity-ide\extensions\tokenshield.tokenshield-1.0.0\package.json" -Force
```

---

### 2. Visual Studio Code & VS Code Insiders
Works with GitHub Copilot, Copilot Chat, and Codex:

#### Via Command Line:
```bash
code --install-extension tokenshield-1.0.0.vsix
```

#### Via VS Code GUI:
1. Open VS Code.
2. Click the **Extensions** icon in the Activity Bar (`Ctrl+Shift+X`).
3. Click the **`...` (Views and More Actions)** menu at the top-right of the Extensions panel.
4. Choose **`Install from VSIX...`**.
5. Select `tokenshield-1.0.0.vsix`.

---

### 3. Cursor IDE
Works with Cursor Tab, Composer, and Agent Mode:

#### Via Command Line:
```bash
cursor --install-extension tokenshield-1.0.0.vsix
```

#### Via Cursor GUI:
1. Open Cursor.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`) → type `Extensions: Install from VSIX...`.
3. Select `tokenshield-1.0.0.vsix`.

---

### 4. Windsurf IDE (Codeium)
1. Open Windsurf.
2. Press `Ctrl+Shift+P` → select `Extensions: Install from VSIX...`.
3. Select `tokenshield-1.0.0.vsix`.
4. Run `Developer: Reload Window`.

---

### 5. Claude Code CLI & Standalone AI Agents
TokenShield provides an on-disk MCP server (`dist/cache-server.js`) that gives Claude Code CLI immediate access to `cache_lookup`, `cache_store`, `skeleton_view`, and `prune_context`.

#### Configure Claude Code (`~/.claude.json`):
Add the project-scoped MCP server to your `~/.claude.json`:
```json
{
  "mcpServers": {
    "token-cache": {
      "command": "node",
      "args": [
        "/path/to/tokenshield/dist/cache-server.js",
        "/path/to/your/workspace"
      ]
    }
  }
}
```

---

### 6. Neovim, JetBrains & Other MCP-Compatible Editors
Run the standalone TokenShield stdio MCP server in any tool supporting the Model Context Protocol:
```bash
node dist/cache-server.js /absolute/path/to/workspace
```
Exposes 5 tools over stdio JSON-RPC 2.0:
1. `cache_lookup`: Query local semantic cache for instant zero-token answers.
2. `cache_store`: Store self-contained answers in `.aicache/semantic-cache.json`.
3. `cache_stats`: View total hits, entries, and estimated token savings.
4. `skeleton_view`: Retrieve AST structural signatures of source files.
5. `prune_context`: Heuristically compress verbose markdown, JSON, or code by 30–50%.

---

## 🔴 Real-Time Live Activity Ledger & Telemetry

TokenShield includes an interactive **Live Activity & Savings Ledger** that proves your exact return on investment in real time:

<p align="center">
  <img src="images/icon.png" width="48" height="48" alt="Dashboard" />
</p>

### What You See in the Dashboard:
- **Real Tokens Avoided**: Aggregated live across AST skeletons, diffs, caching, and context exclusions.
- **Direct Dollars Saved ($)**: Dynamically calculated based on your active model tier (Gemini Flash, GPT-4o, Claude 3.7).
- **Where & When Ledger**: Every optimization event logged with exact timestamp, target file, and token delta.

### How to Access:
- Press `Ctrl+Shift+P` → **`TokenShield: Show ROI Savings Dashboard`**
- Or click the **`$(sparkle) Saved:`** widget in the bottom status bar!

---

## ⌨️ Commands & Keybindings

| Command Name | Command ID | Description |
|---|---|---|
| **Show ROI Savings Dashboard** | `aiTokenOptimizer.showDashboard` | Opens the interactive visual ROI telemetry dashboard |
| **Show Live Per-Chat Savings** | `aiTokenOptimizer.showSessionBreakdown` | QuickPick menu of recent query optimization events |
| **Compress & Copy Context** | `aiTokenOptimizer.pruneSelection` | Prunes active file/selection (30–50% savings) & copies to clipboard |
| **Export Telemetry Report** | `aiTokenOptimizer.exportTelemetry` | Exports executive audit reports (CSV, JSON, Markdown) |
| **Configure Exclusions (CAP-7)** | `aiTokenOptimizer.configureExclusions` | Interactive multi-select picker for noise & bundle exclusions |
| **Select Optimization Profile** | `aiTokenOptimizer.selectProfile` | Switch between `full`, `debug`, `planning`, `review`, and `custom` |
| **Reindex CodeGraph** | `aiTokenOptimizer.reindex` | Triggers a fresh AST graph sync in `.codegraph/` |
| **Clear Semantic Cache** | `aiTokenOptimizer.clearCache` | Flushes `.aicache/semantic-cache.json` |

---

## ⚙️ Configuration Reference (`settings.json`)

Configure TokenShield via `.vscode/settings.json`:

```json
{
  "aiTokenOptimizer.enabled": true,
  "aiTokenOptimizer.profile": "full",
  "aiTokenOptimizer.autoApply": true,
  "aiTokenOptimizer.useVscodeStorage": true,
  "aiTokenOptimizer.telemetryEnabled": true,
  "aiTokenOptimizer.pricing": {
    "flagship": { "inputPerMillion": 15.0, "outputPerMillion": 75.0 },
    "standard": { "inputPerMillion": 3.0, "outputPerMillion": 15.0 },
    "lightweight": { "inputPerMillion": 0.15, "outputPerMillion": 0.60 }
  },
  "aiTokenOptimizer.guardrails": {
    "maxRetries": 3,
    "maxFilesPerTask": 10
  }
}
```

---

## 🔒 100% Security & Privacy Guarantee

- **Zero Cloud Leakage**: 100% on-device local execution. No code or telemetry ever leaves your computer.
- **Offline & Air-Gapped Friendly**: Works without internet access.
- **Zero Repo Clutter**: Configuration stored in `.vscode/` by default — never pollutes git commit history.

---

## 📄 License
MIT License. Built for developers and enterprise engineering teams.
