# TokenShield Installation & Setup Guide

Comprehensive installation, configuration, and verification guide for **TokenShield (v1.0.17)** across **Google Antigravity IDE**, **VS Code**, **Cursor**, **Windsurf**, and **Claude Code CLI**.

---

## 📋 System Requirements & Prerequisites

| Requirement | Minimum | Recommended | Notes |
|---|---|---|---|
| **IDE Host** | VS Code 1.85.0+ | Latest Stable / Antigravity IDE | Compatible with Antigravity, Cursor, Windsurf, VS Code Insiders |
| **Node.js** | v18.0.0+ | v20 LTS+ | Required for MCP local cache server and CodeGraph CLI |
| **Python** *(Optional)* | 3.10+ | 3.11+ | Only required if utilizing Headroom Context Compression (`pip install headroom-ai[all]`) |
| **Git** | 2.30+ | Latest | Required for git-diff scoping and patch optimization |

---

## 📦 Method 1: Installing the Extension (VSIX)
 
The extension bundle is distributed as a self-contained `.vsix` archive (e.g. `tokenshield-1.0.17.vsix`), downloadable directly from:
👉 **[GitHub Releases (Latest)](https://github.com/sarfudheen/tokenshield/releases/latest)** (expand **Assets** to download `.vsix`)

### A. Google Antigravity IDE

#### Via Graphical Interface:
1. Open **Antigravity IDE**.
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS) to open the Command Palette.
3. Type and select **`Extensions: Install from VSIX...`**.
4. Browse to the workspace root and select `tokenshield-1.0.17.vsix`.
5. Once installed, reload the window (`Developer: Reload Window`).

#### Via Extension Directory Link / Sync:
If running from source or portable Antigravity setups:
```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force -Path "$HOME\.antigravity-ide\extensions\tokenshield"
Copy-Item -Path ".\dist\*" -Destination "$HOME\.antigravity-ide\extensions\tokenshield\dist\" -Recurse -Force
Copy-Item -Path ".\package.json" -Destination "$HOME\.antigravity-ide\extensions\tokenshield\package.json" -Force
```
```bash
# macOS / Linux
mkdir -p ~/.antigravity-ide/extensions/tokenshield
cp -R ./dist ~/.antigravity-ide/extensions/tokenshield/
cp ./package.json ~/.antigravity-ide/extensions/tokenshield/
```

---

### B. Visual Studio Code & VS Code Insiders

#### Via Terminal:
```bash
# VS Code Stable
code --install-extension tokenshield-1.0.17.vsix

# VS Code Insiders
code-insiders --install-extension tokenshield-1.0.17.vsix
```

#### Via Extensions View:
1. Open VS Code and open the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
2. Click the **`...`** (Views and More Actions) menu in the top-right corner.
3. Select **`Install from VSIX...`**.
4. Choose `tokenshield-1.0.17.vsix`.

---

### C. Cursor & Windsurf IDE

#### Cursor:
```bash
cursor --install-extension tokenshield-1.0.17.vsix
```
Or use the Cursor Command Palette (`Ctrl+Shift+P`) → **`Extensions: Install from VSIX...`**.

#### Windsurf:
```bash
windsurf --install-extension tokenshield-1.0.17.vsix
```

---

## 🛠️ Method 2: Building from Source

If you cloned the repository and wish to compile the latest version from source:

```bash
# 1. Clone repository
git clone https://github.com/sarfudheen/tokenshield.git
cd tokenshield

# 2. Install development dependencies
npm install

# 3. Compile TypeScript & bundle with esbuild
npm run build

# 4. Package extension into VSIX
npm run package
```

The compiled package `tokenshield-1.0.17.vsix` will be generated in the root directory.

---

## 🚀 Companion CLI Acceleration Tools (Optional but Recommended)

TokenShield delivers immediate ~30–50% token savings through instructions alone. Installing the following companion CLI tools unlocks up to **90%+ savings**:

### 1. CodeGraph (`@colbymchenry/codegraph`)
Enables semantic code graph indexing, eliminating multi-file grep token burn.
```bash
npm install -g @colbymchenry/codegraph
```
- **Initialize in workspace:**
  ```bash
  codegraph init
  codegraph sync
  ```
- **Test binary:**
  ```bash
  codegraph --version
  ```

### 2. RTK CLI Proxy (`rtk`)
Compresses git diffs, build outputs, and terminal logs by 60–90%.
- **macOS / Linux (Homebrew):**
  ```bash
  brew install rtk
  rtk init -g --copilot
  ```
- **Linux / macOS (Shell Script):**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh
  rtk init -g --copilot
  ```
- **Windows (Cargo):**
  ```powershell
  cargo install rtk
  rtk init -g --copilot
  ```

### 3. Headroom AI (`headroom-ai`)
Reversible context compression (CCR) & SmartCrusher for bulky JSON/trace tool outputs.
```bash
pip install "headroom-ai[all]"
```
- **Verify installation:**
  ```bash
  headroom --version
  ```

> [!TIP]
> Run `Ctrl+Shift+P` → **`TokenShield: Setup CLI Tools`** inside the IDE to automatically check and install missing tools.

---

## 🔌 Automated Multi-Editor MCP Configuration

TokenShield automatically configures Model Context Protocol (MCP) servers upon extension activation (configurable via `tokenshield.configureMcpOnActivation`).

### Supported On-Device MCP Servers (100% Local)

1. **`token-cache`** *(Built-in)*:
   - Provides on-disk semantic caching (`cache_lookup`, `cache_store`), AST signature viewing (`skeleton_view`), and context pruning (`prune_context`).
   - Server path: `dist/cache-server.js`.
2. **`headroom`** *(Reversible CCR)*:
   - Provides JSON and tool output compression (`headroom_compress`, `headroom_retrieve`).
3. **`codegraph`** *(Semantic Graph)*:
   - Provides AST symbol query integration (`codegraph_explore`).

> [!NOTE]
> All MCP servers execute 100% locally via stdio on your machine. TokenShield makes **zero external network calls** and never sends code, metadata, or queries to third-party cloud services.

### Automatic Configuration Targets

- **VS Code Copilot:** Updated in `.vscode/settings.json` under `mcp.servers` and `github.copilot.chat.mcp.servers`.
- **Google Antigravity IDE:** Updated in `.agents/mcp_config.json`.
- **Claude Code CLI:** Updated in `~/.claude.json`.

To manually trigger or refresh MCP configuration at any time:
- Press `Ctrl+Shift+P` → **`TokenShield: Configure MCP Servers`**.

---

## ⚙️ Initial Workspace Configuration

Upon opening any workspace, TokenShield will automatically:
1. Detect project frameworks and languages.
2. Initialize `.copilotignore` with smart exclusion patterns (ignoring `node_modules/`, `dist/`, `.git/`, lockfiles, minified bundles, etc.).
3. Generate optimization directives in:
   - **Antigravity IDE:** `AGENTS.md` & `.agents/rules/tokenshield.md`
   - **GitHub Copilot:** `.vscode/copilot-instructions.md` (or `.github/copilot-instructions.md`)
   - **Claude Code:** `CLAUDE.md`
   - **OpenAI Codex:** `.codex/instructions.md`
4. Activate the **Master Hub Status Bar** widget:
   ```
   $(shield) TS: Full · 0 ↓ · $0.00
   ```

### Choosing an Optimization Profile

Run `Ctrl+Shift+P` → **`TokenShield: Switch Profile`**:
- **Full Optimization (Default):** All 20 strategies active for maximum token and cost reduction.
- **Debug Mode:** Temporarily disables terminal log compression and diff-only output for full stack traces.
- **Planning Mode:** Relaxes verbosity restrictions for in-depth architectural discussions.
- **Review Mode:** Preserves full session conversation history for thorough multi-turn code review.
- **Custom:** Manually toggle any of the 20 strategies in `.vscode/settings.json`.

---

## 🔍 Verification & Health Check

To verify that TokenShield is functioning properly:

1. **Run Health Check:**
   - Press `Ctrl+Shift+P` → **`TokenShield: Run Health Check`**.
   - Review diagnostic status across all 20 strategies, MCP servers, and tool binaries.

2. **Open Savings Dashboard:**
   - Press `Ctrl+Shift+P` → **`TokenShield: Open Savings Dashboard`**.
   - Or click the status bar item `$(shield) TS: ...`.
   - Inspect the real-time counters, active model pricing, strategy donut charts, and live activity log.

3. **Verify Context Exclusions:**
   - Press `Ctrl+Shift+P` → **`TokenShield: Edit Context Exclusions`**.
   - Ensure unwanted build artifacts and lockfiles are correctly excluded from AI scans.

---

## 🏢 Team & Enterprise Repository Integration

By default, TokenShield stores workspace instructions locally in `.vscode/` so that developer machines remain clean and git history is untouched.

To share TokenShield optimization rules across your entire engineering team:
1. Run `Ctrl+Shift+P` → **`TokenShield: Export Directives to Repo`**.
2. Commit `.github/copilot-instructions.md` (or `.github/instructions/tokenshield.instructions.md`), `CLAUDE.md`, and `AGENTS.md` to your repository.
3. Every team member using Copilot, Antigravity, or Claude Code will immediately benefit from TokenShield rules without needing extra setup.

---

## ❓ Troubleshooting & FAQs

### Q1: The status bar displays `TS: DEACTIVATED`.
- **Fix:** Click the status bar or run `TokenShield: Reactivate All Optimizations` (`tokenshield.reactivate`).

### Q2: CodeGraph or RTK shows "Not Installed" in the dashboard.
- **Fix:** Ensure `@colbymchenry/codegraph` and `rtk` are installed globally and added to your system `$PATH`. Run `codegraph --version` and `rtk --version` in your terminal to verify.

### Q3: How do I completely wipe all tracking and reset TokenShield?
- **Fix:** Run `TokenShield: Reset Complete Data (Wipe All History)` to clear session logs, lifetime records in `.aicache/`, and reset all counters.

### Q4: How do I remove TokenShield directives before committing?
- **Fix:** Run `TokenShield: Deactivate Completely (Strip All Directives)`. This cleanly removes all `<!-- TOKENSHIELD:START -->` managed blocks while leaving your custom instructions intact.
