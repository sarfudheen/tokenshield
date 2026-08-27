# TokenShield — AI Token & Cost Optimizer

<p align="center">
  <img src="images/icon.png" width="128" height="128" alt="TokenShield Icon" />
</p>

A universal, high-performance VS Code extension engineered to optimize AI token consumption, control inference costs, and provide provable ROI metrics for **GitHub Copilot**, **Claude Code**, **OpenAI Codex**, and **Antigravity**.

---

## 🛡️ Enterprise Architecture Overview

TokenShield acts as an intelligent, zero-dependency efficiency proxy between developer workflows and AI coding assistants:

1. **Context Engineering**: Injects deterministic efficiency directives directly into AI instruction files (`.vscode/copilot-instructions.md`, `CLAUDE.md`, `.codex/instructions.md`, `AGENTS.md`).
2. **Local Semantic Caching**: Serves repeat and boilerplate questions from an on-disk semantic cache at **zero model tokens and zero latency**.
3. **AST Structural Pruning**: Extracts class/interface/type signatures via the `skeleton_view` MCP tool, saving **75–95% context tokens** during file navigation.
4. **Smart Context Exclusion**: Auto-excludes lockfiles (`package-lock.json`, `Cargo.lock`), minified bundles, and build artifacts from Copilot's automated agent scans.
5. **Output Compression & Diff Formatting**: Enforces unified diff patches on code edits (~92% output token savings) and pipes CLI/test commands through RTK output filters.

---

## ⚡ The Ten TokenShield Directives (CAP-1 through CAP-10)

| Directive | Name | Enterprise Mechanism | Target Impact |
|---|---|---|---|
| **CAP-1** | **CodeGraph Indexing** | Semantic graph search before full file reads | Prevents wide grep context bloat |
| **CAP-2** | **RTK Output Compression** | CLI proxy filtering test/build/git logs | **60–90%** CLI token reduction |
| **CAP-3** | **Caveman Verbosity** | Strict code-first responses, no preambles/pleasantries | **20–50%** response length reduction |
| **CAP-4** | **Context Hygiene** | Session boundary management and stale context pruning | Prevents multi-turn context creep |
| **CAP-5** | **Semantic Answer Cache** | Local JSON-RPC 2.0 MCP server with TF-IDF cosine matching | **100% savings** on repeated questions |
| **CAP-6** | **AST Skeleton Extraction** | MCP tool (`skeleton_view`) providing signatures-only views | **75–95%** file navigation savings |
| **CAP-7** | **Smart Context Exclusion** | Auto-detects and excludes lockfiles, minified files, dist/ | Prevents 10,000s of wasted scan tokens |
| **CAP-8** | **Diff-Only Output Mode** | Enforces unified diff formatting (±3 context lines) | **~92%** reduction on file edits |
| **CAP-9** | **Agent Loop Guardrails** | Hard limits on retries (max 3) and file edits (max 10) | Stops runaway autonomous loops |
| **CAP-10** | **Smart Model Routing** | Prompt classifier suggesting lightweight models for trivial tasks | **~80%** cost reduction per task |

---

## 🔒 Enterprise Security & Privacy Guarantees

- **100% On-Device Execution**: All calculations, semantic caching, AST extraction, and telemetry remain strictly on the developer's local machine.
- **Zero External Telemetry**: No code snippets, prompt data, or metrics are ever transmitted to external servers.
- **Zero Runtime Dependencies**: Written entirely against Node.js standard libraries (`fs`, `crypto`, `child_process`) and the native VS Code API.
- **Corporate Proxy Friendly**: Works completely offline without requiring open outbound ports.
- **Clean Repository State**: Stored in `.vscode/copilot-instructions.md` by default — never clutters your project's git commit history.

---

## 📊 Executive ROI Dashboard & Exporting

Open the live ROI dashboard at any time:
- **Shortcut**: `Ctrl+Shift+P` (or `Cmd+Shift+P`) → `TokenShield: Show ROI Savings Dashboard`
- **Status Bar**: Click the status bar widget `🛡️ TokenShield: Full (10/10)`

### One-Click Executive Reports
Export verifiable token and cost avoidance reports in **CSV**, **JSON**, or **Markdown** format to share with engineering leadership or justify AI tooling budgets.

---

## 🛠️ Building & Packaging for Internal Distribution

To create a standalone `.vsix` file for your organization's internal marketplace (or direct installation):

```bash
# 1. Install dev dependencies
npm install

# 2. Compile TypeScript
npm run compile

# 3. Bundle with esbuild
npm run build

# 4. Generate .vsix package
npx @vscode/vsce package --no-dependencies
```

Install the resulting `.vsix` in VS Code via:
`code --install-extension tokenshield-1.0.0.vsix`

---

## ⚙️ Configuration Settings

Configure via `.vscode/settings.json`:

```json
{
  "aiTokenOptimizer.enabled": true,
  "aiTokenOptimizer.profile": "full",
  "aiTokenOptimizer.useVscodeStorage": true,
  "aiTokenOptimizer.pricing": {
    "flagship": { "inputPerMillion": 15.0, "outputPerMillion": 75.0 },
    "standard": { "inputPerMillion": 3.0, "outputPerMillion": 15.0 },
    "lightweight": { "inputPerMillion": 0.15, "outputPerMillion": 0.60 }
  },
  "aiTokenOptimizer.guardrails": {
    "maxRetries": 3,
    "maxFilesPerTask": 10,
    "maxFileReads": 2
  }
}
```

---

## 🙏 Acknowledgements & Attribution

TokenShield was inspired by foundational ideas and strategies from the open-source project [`ai-token-optimize-vscode`](https://github.com/sbaala/ai-token-optimize-vscode) by Balachandar Saminathan and Vishal Gupta (MIT License). TokenShield expands upon those concepts with an enterprise-ready architecture, multi-assistant support (Copilot, Claude, Codex, Antigravity), AST skeleton extraction, live `vscode.lm` model tier detection, and an executive ROI analytics engine.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details.
