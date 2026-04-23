# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow Rules (always follow these steps in order)

1. **Ask until the goal is clear** — Before doing anything, ask the user questions until you fully understand what they want. Do not guess.
2. **Plan in detail first** — Write out a step-by-step plan of every change you will make before touching any code.
3. **Explain in simple terms** — Describe the plan to the user in plain, easy language. No jargon.
4. **Execute the plan** — Make the changes exactly as planned.
5. **Update the changelog** — After all changes are done, create or update `CHANGELOG.md` with a short summary of what changed and why.
6. **Commit to git** — Make a git commit every time code is changed. Do not batch multiple sessions into one commit.

## Repo basics

- OpenCode is an open-source AI coding agent. Monorepo managed by Bun workspaces + Turborepo.
- Requires **Bun 1.3+** (pinned to `bun@1.3.11` in `package.json`). The `pre-push` husky hook enforces this range and runs `bun typecheck`.
- **Default branch is `dev`** (not `main`). Local `main` ref may not exist; diff against `dev` / `origin/dev`.
- Lint: `oxlint` (type-aware, config in `.oxlintrc.json`). Format: Prettier with `semi: false`, `printWidth: 120`.

## Common commands

From the repo root:

```bash
bun install                             # install deps (triggers node-pty fix)
bun dev [directory]                     # run the CLI against a dir (defaults to packages/opencode)
bun dev .                               # run OpenCode in this repo itself
bun dev serve --port 4096               # headless API server
bun dev web                             # CLI that proxies app.opencode.ai (not for local UI work)
bun dev generate                        # emits OpenAPI spec to stdout
bun lint                                # oxlint
bun typecheck                           # turbo typecheck across all packages
bun run dev:web                         # vite dev for packages/app
bun run dev:desktop                     # tauri dev for packages/desktop
bun run dev:console                     # packages/console/app dev
bun run dev:storybook                   # packages/storybook
```

`bun dev` is the local equivalent of the built `opencode` binary — same CLI surface.

### Local UI development

`bun dev web` proxies `https://app.opencode.ai`, so CSS/UI edits will NOT appear there. For local UI work run the backend and app separately:

```bash
# backend
bun run --conditions=browser ./packages/opencode/src/index.ts serve --port 4096
# app (targets backend at :4096)
bun run --cwd packages/app dev -- --port 4444
```

### Testing

- **Tests cannot run from the repo root.** `bunfig.toml` sets `[test].root = "./do-not-run-tests-from-root"` as a guard. Run from the package dir.
- Core: `bun test --timeout 30000` in `packages/opencode`.
- App: `bun test --preload ./happydom.ts ./src` in `packages/app`.
- Single test: `bun test --timeout 30000 path/to/file.test.ts` or `-t "<name substring>"`.
- Avoid mocks; test real implementation.

### Typecheck

- Always use `bun typecheck` (per-package) or `bun turbo typecheck` (root). Do **not** invoke `tsc` directly — the repo uses `@typescript/native-preview` (`tsgo`).

### Regenerating the SDK / OpenAPI

When touching the server (`packages/opencode/src/server/server.ts` and routes) or SDK, regenerate both:

```bash
./script/generate.ts                    # builds JS SDK + updates packages/sdk/openapi.json + formats
./packages/sdk/js/script/build.ts       # JS SDK only
```

### Standalone binary

```bash
./packages/opencode/script/build.ts --single
# runs at ./packages/opencode/dist/opencode-<platform>/bin/opencode
```

## Architecture

Client/server split: the server runs headlessly; TUI, web app, desktop app, and the JS SDK are all clients. The TUI renders in the terminal via SolidJS + opentui (not a typical browser UI).

### Packages you'll touch most

- `packages/opencode` — CLI entry, server, agent loop, tools, storage. Node/Bun dual-runtime via conditional imports:
  - `#db` → `src/storage/db.bun.ts` | `db.node.ts`
  - `#pty` → `src/pty/pty.bun.ts` | `pty.node.ts`
  - `#hono` → `src/server/adapter.bun.ts` | `adapter.node.ts`
- `packages/app` — SolidJS web UI (shared by the browser and the desktop shell).
- `packages/desktop` — Tauri v2 shell that wraps `packages/app`. Never call `invoke` manually; use generated bindings in `src/bindings.ts`.
- `packages/plugin` — source for `@opencode-ai/plugin` (public plugin API).
- `packages/sdk/js` — generated JS/TS SDK; regenerated from the server's OpenAPI.
- `packages/shared` — shared utilities/types consumed across packages.
- `packages/console/*`, `packages/web`, `packages/docs` — cloud console, marketing site, docs.

### Inside `packages/opencode/src`

- `index.ts` — yargs CLI entry; wires subcommands in `cli/cmd/*` (run, serve, web, tui, mcp, github, pr, upgrade, stats, db, etc.). Kicks off a one-time SQLite migration from legacy JSON state on first run.
- `server/` — Hono app. Three route groups mounted on one app: `ControlPlaneRoutes`, `InstanceRoutes` (includes WS), and `UIRoutes`. Middleware: auth → logger → compression → cors → fence.
- `session/` — agent loop: `session.ts`, `llm.ts`, `processor.ts`, `compaction.ts`, `overflow.ts`, `revert.ts`, prompt building in `prompt/` and `system.ts`.
- `tool/` — built-in tools (bash, edit/multiedit/apply_patch, read/write, grep/glob/codesearch, lsp, webfetch/websearch, task, todo, plan, question, skill). Each tool has a sibling `.txt` prompt file loaded at runtime.
- `provider/` — model provider abstraction (AI SDK v6 providers: Anthropic, OpenAI, Google, Bedrock, Vertex, Groq, xAI, OpenRouter, etc.) plus `auth.ts`, `models.ts`, OpenCode Zen gateway.
- `storage/` — SQLite via Drizzle (`bun-sqlite` on Bun, `better-sqlite3` on Node). `JsonMigration` migrates legacy on-disk JSON state.
- `lsp/`, `mcp/`, `ide/`, `share/`, `skill/`, `permission/`, `snapshot/`, `sync/`, `worktree/` — subsystems named after what they do.
- `cli/cmd/tui/` — the TUI itself (SolidJS + opentui). `app.tsx`, routes, components, plugins.

### Data layer conventions (Drizzle)

Use `snake_case` for field identifiers so Drizzle derives the column name — don't pass string column names:

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
```

## Code style (enforced by convention, see `AGENTS.md`)

- No `try`/`catch` where `.catch(...)` works; no `any`; no `else` (use early returns); no `let` (use `const` + ternaries).
- Inline values used once; avoid unnecessary destructuring (`obj.a` over `const { a } = obj`).
- Prefer Bun APIs (`Bun.file()`, `Bun.$`) and functional array methods with type guards.
- Rely on type inference; only annotate at public boundaries.
- Run tools in parallel when independent.

## Contributor workflow notes

- **PRs must reference an existing issue** (`Fixes #123`). UI/core-product features need a design review first.
- PR titles follow conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`), optional package scope (e.g. `fix(desktop):`).
- Never restart the app or server process while debugging the web UI.
