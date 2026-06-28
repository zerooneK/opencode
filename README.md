<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

---

## Architecture

OpenCode is a **client/server** AI coding agent. The server runs headlessly (Hono on Bun/Node); the TUI, web app, desktop app, and JS SDK are all clients.

```
            ┌─────────────────────────────────────────────┐
            │              OpenCode Server                │
            │  (packages/opencode, Hono, headless)        │
            │                                             │
            │  ControlPlaneRoutes  InstanceRoutes  UIRoutes│
            │  (workspace/       (per-project    (serves   │
            │   account)          API + WS)      web UI)   │
            └──────┬───────────────┬───────────────┬───────┘
                   │               │               │
        ┌──────────┼───────────────┼───────────────┼──────────┐
        │          │               │               │          │
   ┌────▼───┐ ┌────▼───┐    ┌──────▼──────┐  ┌─────▼─────┐   │
   │  TUI   │ │  Web   │    │   Desktop   │  │  JS SDK   │   │
   │(Ink/   │ │(SolidJS│    │  (Tauri v2  │  │(generated │   │
   │ React) │ │  +Vite)│    │  / Electron)│  │  OpenAPI) │   │
   └────────┘ └────────┘    └─────────────┘  └───────────┘   │
                                                              │
                        Clients                               │
```

### Server

The Hono server (`packages/opencode/src/server/server.ts`) mounts three route groups:

- **`ControlPlaneRoutes`** — workspace / account control plane.
- **`InstanceRoutes`** — per-project instance API, **includes WebSocket** (`runtime.upgradeWebSocket`).
- **`UIRoutes`** — serves the bundled web UI.

Middleware order (non-workspace path): `ErrorMiddleware` → `CorsMiddleware` → `AuthMiddleware` → `UserAuthMiddleware` → `WorkspaceAccessMiddleware` → `LoggerMiddleware` → `CompressionMiddleware`, with `FenceMiddleware` applied per-route. OpenAPI spec is generated via `hono-openapi`.

### Dual-runtime (Bun + Node)

One codebase runs on both Bun (primary) and Node via conditional imports:

| Import      | Bun                          | Node                        |
| ----------- | ---------------------------- | --------------------------- |
| `#db`       | `db.bun.ts` (`bun:sqlite`)   | `db.node.ts` (`node:sqlite`)|
| `#pty`      | `pty.bun.ts`                 | `pty.node.ts`               |
| `#hono`     | `adapter.bun.ts`             | `adapter.node.ts`           |

---

## Packages

This is a **Bun workspaces + Turborepo** monorepo. Default branch is **`dev`** (not `main`). Requires **Bun 1.3+** (pinned to `bun@1.3.11`); the husky `pre-push` hook enforces this and runs `bun typecheck`.

| Package | Purpose |
| ------- | ------- |
| `packages/opencode` | CLI entry, headless server, agent loop, tools, storage. |
| `packages/app` (`@opencode-ai/app`) | SolidJS web UI (shared by browser + desktop). |
| `packages/desktop` (`@opencode-ai/desktop`) | Tauri v2 shell wrapping `packages/app`. |
| `packages/desktop-electron` (`@opencode-ai/desktop-electron`) | Electron-based desktop variant. |
| `packages/plugin` (`@opencode-ai/plugin`) | Public plugin API. |
| `packages/sdk/js` (`@opencode-ai/sdk`) | Generated JS/TS SDK (from server OpenAPI). |
| `packages/shared` (`@opencode-ai/shared`) | Shared utilities/types. |
| `packages/ui` (`@opencode-ai/ui`) | Shared UI component library (components, i18n, pierre). |
| `packages/web` (`@opencode-ai/web`) | Marketing site (Astro). |
| `packages/enterprise` (`@opencode-ai/enterprise`) | Enterprise product (Vite). |
| `packages/slack` (`@opencode-ai/slack`) | Slack integration. |
| `packages/function` (`@opencode-ai/function`) | Cloudflare Workers function. |
| `packages/console/*` (`@opencode-ai/console-*`) | Cloud console (app, core, function, mail, resource). |
| `packages/docs` (`@opencode-ai/docs`) | Mintlify docs site. |
| `packages/storybook` (`@opencode-ai/storybook`) | Storybook for component dev. |
| `@t-open/laptop-bridge` | Exposes a local laptop folder to T-Open Workspace via MCP. |

### Inside `packages/opencode/src`

| Directory | Purpose |
| --------- | ------- |
| `session/` | Conversation sessions, messages, parts, compaction, prompts. |
| `tool/` | Built-in tool implementations + prompts. |
| `provider/` | Model provider integrations. |
| `storage/` | Drizzle/SQLite DB + JSON migration. |
| `lsp/` | Language Server Protocol client. |
| `mcp/` | Model Context Protocol. |
| `ide/` | IDE/editor integration helpers. |
| `share/` | Session sharing. |
| `skill/` | Skill system. |
| `permission/` | Permission rules engine. |
| `snapshot/` | File snapshots/diffs. |
| `sync/` | State sync. |
| `worktree/` | Git worktree management. |
| `cli/cmd/tui/` | Terminal UI (React/Ink-based). |
| Plus | `agent`, `auth`, `bus`, `config`, `control-plane`, `env`, `file`, `git`, `project`, `plugin`, `pty`, `server`, `util`, `v2`. |

---

## Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks. This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

---

## Tools

Built-in tools under `packages/opencode/src/tool/`. **Each tool has a sibling `.txt` prompt file** (e.g. `bash.ts` ↔ `bash.txt`) loaded at runtime.

| Category | Tools |
| -------- | ----- |
| Shell | `bash` |
| Editing | `edit`, `multiedit`, `apply_patch` |
| Files | `read`, `write` |
| Search | `grep`, `glob`, `codesearch` |
| LSP | `lsp` |
| Web | `webfetch`, `websearch` |
| Tasks | `task` |
| Planning | `todo` (+ `todowrite`), `plan` (+ `plan-enter`/`plan-exit`) |
| Other | `question`, `skill`, `truncate`, `mcp-exa`, `invalid`, `external-directory`, `registry`, `schema`, `tool` |

---

## Providers

Bundled model providers under `packages/opencode/src/provider/`, using **AI SDK v6** (`@ai-sdk/provider` 3.x, `LanguageModelV3`). A custom `BUNDLED_PROVIDERS` map lazy-loads SDKs; a `custom()` loader handles auth/region logic (e.g. Bedrock region prefixes, Vertex auth). Model metadata is sourced from [models.dev](https://models.dev).

Anthropic · OpenAI · Google · Google Vertex (+ Vertex Anthropic) · Amazon Bedrock · Azure (+ cognitive-services) · xAI · OpenRouter · Groq · Mistral · DeepInfra · Cerebras · Cohere · TogetherAI · Perplexity · Vercel · Alibaba · Venice · GitLab · GitHub Copilot · Cloudflare Workers AI · Cloudflare AI Gateway · SAP AI Core · **OpenCode Zen** (`opencode`/`zenmux`)

---

## Data Layer

- **Drizzle ORM + SQLite**. `db.bun.ts` uses `bun:sqlite` (`drizzle-orm/bun-sqlite`); `db.node.ts` uses `node:sqlite` (`DatabaseSync`). WAL mode, migrations from `migration/` dir or bundled `OPENCODE_MIGRATIONS`.
- **snake_case field convention** throughout (e.g. `project_id`, `session_id`, `share_url`, `time_created` in `Timestamps`).
- **One-time JSON→SQLite migration** via `JsonMigration` (`storage/json-migration.ts`) — bulk-migrates `project/session/message/part/todo/permission/session_share` JSON files into tables in a single transaction with progress reporting.

---

## CLI

Entry point: `packages/opencode/src/index.ts` (yargs). First run triggers a one-time SQLite migration from legacy JSON state.

```bash
opencode                    # run in current directory (alias for `run`)
opencode run                # run against a directory
opencode serve --port 4096  # headless API server
opencode tui                # terminal UI
opencode web                # CLI that proxies app.opencode.ai (not for local UI work)
opencode mcp                # Model Context Protocol
opencode github             # GitHub integration
opencode pr                 # pull request helpers
opencode upgrade            # upgrade OpenCode
opencode uninstall          # uninstall
opencode stats              # usage stats
opencode db                 # database tools
opencode generate           # emit OpenAPI spec to stdout
opencode debug              # debugging helpers
opencode account            # console account
opencode providers          # list providers
opencode agent              # agent management
opencode models             # model management
opencode export             # export data
opencode import             # import data
opencode session            # session management
opencode plug               # plugin management
opencode acp                # Agent Communication Protocol
opencode completion         # shell completion
```

Global flags: `--print-logs`, `--log-level`, `--pure`.

---

## Development

### Setup

```bash
bun install              # install deps (triggers node-pty fix via postinstall)
bun dev [directory]       # run CLI against a dir (defaults to packages/opencode)
bun dev .                 # run OpenCode in this repo itself
```

### Running

```bash
bun dev serve --port 4096   # headless API server
bun dev generate            # emit OpenAPI spec to stdout
bun run dev:web             # Vite dev for packages/app
bun run dev:desktop         # Tauri dev for packages/desktop
bun run dev:console         # packages/console/app dev
bun run dev:storybook       # Storybook
```

### Local UI development

`bun dev web` proxies `https://app.opencode.ai`, so CSS/UI edits will **not** appear there. For local UI work, run the backend and app separately:

```bash
# backend
bun run --conditions=browser ./packages/opencode/src/index.ts serve --port 4096
# app (targets backend at :4096)
bun run --cwd packages/app dev -- --port 4444
```

### Lint / Format / Typecheck

```bash
bun lint            # oxlint (type-aware, config in .oxlintrc.json)
bun typecheck       # turbo typecheck across all packages
```

- **Typecheck**: always use `bun typecheck` (per-package) or `bun turbo typecheck` (root). **Never invoke `tsc` directly** — the repo uses `@typescript/native-preview` (`tsgo`).
- **Lint**: oxlint 1.60.0, type-aware, config in `.oxlintrc.json`.
- **Format**: Prettier 3.6.2, `semi: false`, `printWidth: 120`.

### Testing

> **Tests cannot run from the repo root.** `bunfig.toml` sets `[test].root = "./do-not-run-tests-from-root"` as a guard.

```bash
# Core (business logic & server) — run inside packages/opencode
bun test --timeout 30000

# App (web UI, SolidJS) — run inside packages/app
bun test --preload ./happydom.ts ./src

# Single test
bun test --timeout 30000 path/to/file.test.ts
bun test -t "<name substring>"
```

Convention: avoid mocks; test the real implementation.

### Standalone binary

```bash
./packages/opencode/script/build.ts --single
# → packages/opencode/dist/opencode-<platform>/bin/opencode
#    (e.g. opencode-darwin-arm64, opencode-linux-x64, opencode-windows-x64)
```

### Regenerating the SDK / OpenAPI

When touching the server (`packages/opencode/src/server/server.ts` and routes) or SDK, regenerate both:

```bash
./script/generate.ts                # builds JS SDK + updates packages/sdk/openapi.json + formats
./packages/sdk/js/script/build.ts   # JS SDK only
```

---

## Code Style

Enforced by convention (see `AGENTS.md`):

- Prefer `.catch(...)` over `try`/`catch` where possible; avoid the `any` type.
- No `else` statements — use early returns. No `let` — use `const` with ternaries instead of reassignment.
- Inline values used only once; avoid unnecessary destructuring (use dot notation to preserve context).
- Prefer Bun APIs (`Bun.file()`, `Bun.$`, `Bun.Glob`) and functional array methods (`flatMap`, `filter`, `map`) with type guards on `filter` to preserve inference.
- Rely on type inference; annotate types only at public/exported boundaries.
- Keep logic in one function unless splitting adds clear reuse or composition.
- Run independent tools/operations in parallel.

---

## Contributing

If you're interested in contributing, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

- **Issue-first policy:** every PR must reference an existing issue using `Fixes #123` / `Closes #123` in the description.
- UI and core product features require **design review** with the core team before implementation.
- **PR titles** follow conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, with an optional package scope (e.g. `fix(desktop):`, `feat(app):`).
- Keep PRs small and focused; explain what changed, why, and how it was verified.
- **Debugging caveat:** do not restart the app/server while debugging the web UI — start the OpenCode server first, then run the web app separately.

---

## Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

## Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

---

## FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [OpenCode Zen](https://opencode.ai/zen), OpenCode can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow OpenCode to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
