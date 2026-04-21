# Changelog

## 2026-04-21 (56)

### Feat: laptop bridge reads `.docx`, `.xlsx`/`.xls`, and `.pdf`

The AI can now read Word docs, Excel spreadsheets, and PDFs from the user's laptop — not just plain text. This matches the file types office users actually store: meeting notes in Word, budgets in Excel, contracts/reports in PDF.

- `packages/laptop-bridge/package.json` — added `mammoth@^1.8.0` (DOCX → text), `xlsx@^0.18.5` (spreadsheet → CSV), `pdf-parse@^1.1.1` (PDF → text).
- `packages/laptop-bridge/bridge.ts` — new `readFileAsText()` helper that dispatches by extension. Text files unchanged. DOCX runs through mammoth's `extractRawText`. XLSX/XLS loads every sheet and emits a `=== Sheet: <name> ===` header followed by CSV rows. PDF buffers the file and runs `pdf-parse`. Parsers are dynamically imported the first time they're needed so startup stays fast for users who only ever read text files.
- `read_file` tool description now lists supported formats so the AI knows it can pull `.docx` / `.xlsx` / `.pdf` directly without asking the user to convert.

Smoke-tested end-to-end against a Word doc, an Excel workbook with a `Data` sheet, and a minimal PDF — all three returned correct text.

**User action:** restart the bridge (`bun bridge.ts ~/Documents`) so the new deps load. No backend or frontend restart needed.

---

## 2026-04-21 (55)

### Chore: shorter MCP tool names — `laptop_read_file` instead of `user-bridge-<uuid>_read_local_file`

The AI now sees tool IDs like `laptop_read_file`, `laptop_write_file`, `laptop_list_files` — way easier to read than the previous `user-bridge-3c2d741d-b225-4ddb-8348-26ee86ff2399_list_local_files`. Function unchanged.

- `packages/laptop-bridge/bridge.ts` — renamed `read_local_file` → `read_file`, `write_local_file` → `write_file`, `list_local_files` → `list_files`. Kept the "this is the user's laptop, not the server" emphasis in the descriptions so free models still pick them reliably.
- `packages/opencode/src/server/instance/user-mcp-middleware.ts` — MCP client name is now `"laptop"` instead of `"user-bridge-<userId>"`. Safe because MCP state is per-Instance and each user's workspace is its own Instance, so there's no cross-user collision.
- `packages/laptop-bridge/test.sh` — updated to the new tool names.

Bridge + middleware restart required to pick up the change.

---

## 2026-04-21 (54)

### Polish: MCP bridge small issues

Three small items spotted while testing MCP end-to-end.

**Issue 3 — small_model defaulted to paid Claude Haiku.**
OpenCode picks `claude-haiku-4-5` as the default `small_model` (for title/summary/compaction agents) via a hardcoded priority list in `provider.ts` when `cfg.small_model` is unset. With only free-tier OpenRouter credits, those title generations returned HTTP 402 "Insufficient credits" in the logs. Fix: pin `small_model` in `~/.config/opencode/opencode.json` to the same free model as the main chat.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "small_model": "openrouter/minimax/minimax-m2.5:free"
}
```

**Issue 1 — thundering herd on first chat.**
The frontend fires many parallel HTTP requests on a page load (agents, providers, config, path, vcs, permissions, commands, question, session polling, ...). All of them hit `UserMcpMiddleware` simultaneously and each one saw an empty `lastRegistered`, so each one started its own `MCP.add()`. The bridge's brand-new fresh-per-session transports couldn't handle the concurrent initializes cleanly and most reported `needs_auth` until one succeeded.

Fix (`packages/opencode/src/server/instance/user-mcp-middleware.ts`): added a single-flight promise map keyed by `(userId, directory)`. The first request for a given key starts the registration; concurrent requests `await` the same promise instead of launching a duplicate. Once settled, `inFlight` clears and `lastRegistered` records the URL so subsequent requests skip.

**Issue 2 — `GET /mcp` returns `{}` for runtime-added bridges. BY DESIGN.**
Investigated, then closed as intentional.

`MCP.status()` in upstream opencode (`packages/opencode/src/mcp/mcp.ts:571`) iterates `cfg.mcp` (opencode.json-declared servers) only, not the in-memory `s.clients`. Runtime-added per-user bridges live in `s.clients` and `s.status` but don't appear in `cfg.mcp`, so they're invisible to the public `/mcp` endpoint. This is correct for privacy — admin shouldn't see user1's bridge URL via `/mcp`.

The AI still receives the tools (tool listing goes through `MCP.Service.tools()` which reads `s.clients` directly), so nothing breaks in the chat flow. The Settings page's "Test connection" button is the right UX for showing per-user status.

No code change. Just documentation so the next developer isn't confused by the "empty" response.

---

## 2026-04-21 (53)

### Fix: MCP bridge actually reaches the AI

Three bugs found during pilot-day end-to-end testing — each of which made the AI not see the `read_local_file` / `write_local_file` / `list_local_files` tools even though the MCP config was saved and the bridge was running:

1. **Bridge rejected second `initialize` with "Server already initialized".** The bridge used a single shared `McpServer` + `Transport` for every HTTP request; the SDK's server is one-shot and rejects duplicate initializes. Fix: create a fresh `McpServer` + `WebStandardStreamableHTTPServerTransport` **per session**, track them in a `Map<sessionId, ...>`, and route subsequent requests by `Mcp-Session-Id` header. `onsessionclosed` cleans up.
2. **Middleware cached the URL even when registration failed.** `lastRegistered.set(userId, url)` ran on any `MCP.add()` call regardless of actual connection status. A first-time failure (bad token, bridge down) poisoned the cache so every later request silently skipped retry. Fix: only cache when `result.status[name].status === "connected"`; log a clear `did not connect` warning otherwise.
3. **MCP state is per-Instance, and each workspace directory is its own Instance.** Caching by `userId` alone registered MCP in one Instance (the first request's directory) but chat requests live in a different Instance (the workspace directory) and never saw the MCP. Fix: cache key is now `(userId, directory)`. `Instance.directory` is read from ALS inside the middleware.

**Also:** strengthened tool descriptions on the bridge so free models (MiniMax, Gemma) reliably pick `read_local_file` when the user mentions "laptop", "บนเครื่องฉัน", or "local file".

**Files:**
- `packages/laptop-bridge/bridge.ts` — per-session server+transport
- `packages/opencode/src/server/instance/user-mcp-middleware.ts` — connected-only cache, per-directory key, directory field in logs
- `packages/app/src/components/settings-mcp.tsx` — use `createEffect` instead of top-level call so stored URL+token pre-fill the inputs reactively

Verified end-to-end: admin user with laptop bridge running → chat "ใช้ list_local_files แสดงไฟล์ใน laptop" → AI calls `user-bridge-<id>-list_local_files` → returns the file list.

---

## 2026-04-21 (52)

### Feat: MCP bridge — AI can read/write files on the user's laptop

Path 3 of the MCP plan: the server-side AI connects to a small HTTP MCP server running on each user's laptop. Each user picks ONE folder on their laptop to expose; the AI gets three tools: `read_local_file`, `write_local_file`, `list_local_files`. Bearer-token authentication prevents anyone else on the LAN from accessing the folder.

**New package — `packages/laptop-bridge`:**
- Single-file Bun script (`bridge.ts`) users run on their laptop.
- Prints its LAN URL and a random bearer token on startup.
- Uses `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport` in stateful mode (session IDs) so OpenCode's existing `StreamableHTTPClientTransport` can connect without extra code.
- `safePath()` refuses any path that escapes the chosen folder.

**Server — per-user MCP config:**
- New migration `20260421060000_add_user_mcp` adds `mcp_url`, `mcp_token` columns to `app_user`.
- `UserAuth.getMcp(id)` and `UserAuth.setMcp(id, cfg | null)` read/write.
- New routes in `packages/opencode/src/server/control/user-auth.ts`:
  - `GET /user/me/mcp` — returns the current config (or `{ configured: false }`)
  - `PUT /user/me/mcp` — save
  - `DELETE /user/me/mcp` — clear
  - `POST /user/me/mcp/test` — server-side probe that sends an MCP `initialize` and returns the server name or an error message

**Runtime registration — `packages/opencode/src/server/instance/user-mcp-middleware.ts`:**
- New Hono middleware, registered after `WorkspaceRouterMiddleware` inside `InstanceRoutes`.
- On each request, looks up the caller's MCP config and calls `MCP.Service.add("user-bridge-<userId>", { type: "remote", url, headers: { Authorization: "Bearer …" } })`.
- In-memory `lastRegistered` map skips re-registration if the URL hasn't changed since the last call — avoids reconnecting on every chat message.
- Failures are logged but never block the request.

**Frontend — Settings tab:**
- New `SettingsMcp` component at `packages/app/src/components/settings-mcp.tsx` with a URL input, token input, Test connection button, Save button, and Disconnect button.
- Added as a "My Laptop" tab in `DialogSettings`.
- `useAuth()` gained `getMcp`, `saveMcp`, `clearMcp`, `testMcp`.
- Includes a Windows Firewall note so pilot users know what to expect on first run.

---

## 2026-04-20 (51)

### Chore: rebrand to "T-Open Workspace"

Local-only cosmetic change. Pixel-art "T" replaces the OpenCode square in `Mark` and `Splash` components at `packages/ui/src/components/logo.tsx`, using the existing `var(--icon-strong-base)` color so it stays theme-aware. Browser tab title at `packages/app/index.html` and login-page heading at `packages/app/src/pages/login.tsx` now read "T-Open Workspace".

`Logo` (the word mark) and deep-in-menu i18n strings were not touched.

---

## 2026-04-20 (50)

### Feat: HTML preview loads linked CSS/JS and handles anchor links

**Before:** Opening a `.html` file showed the HTML structure but no styles (`<link rel="stylesheet" href="styles.css">`) or scripts (`<script src="script.js">`) — the `srcdoc` iframe has a null base URL so relative paths couldn't resolve. Clicking `<a href="#section">` anchors escaped the iframe and navigated the parent page, wiping the preview.

**After:** `packages/app/src/pages/session/file-tabs.tsx` `inlineHtmlResources(html, path)` now:
- Finds `<link rel="stylesheet" href="relative">` and `<script src="relative">` with relative paths
- Fetches each linked file from the same workspace directory via the SDK
- Replaces each tag with inline `<style>…</style>` / `<script>…</script>`
- Injects a `<base target="_self">` and a small click-handler script into `<head>` that catches hash-only `<a href="#x">` clicks and scrolls to the element instead of letting the click escape the iframe

Absolute `http(s)://` and protocol-relative (`//`) links pass through untouched. Images, CSS `@import`, and `background-image: url()` are not handled — good-enough for static landing-page demos.

---

## 2026-04-18 (49)

### Feat: cost control — hide AI model picker from regular users

**Problem:** Regular users saw the full model dropdown at the bottom of chat and could pick any model including expensive ones (Claude Opus, GPT-4). No budget cap, no admin oversight. A team of 20 users picking premium models could cost $500–1000/month in API fees instead of $50–100 with reasonable defaults.

**Fix:** In `packages/app/src/components/prompt-input.tsx`, wrap the model picker and variant picker with `<Show when={!isRegularUser()}>`. Admin still sees the full picker and can choose any model. Regular users see nothing — they use whatever the provider fallback picks (cheapest/first-configured model). Admins can set a preferred default via the OpenCode config.

Flow for regular users:
1. Login → agent list loads
2. `local.agent.current()` returns first agent automatically
3. `local.model.current()` returns fallback model (first model of first connected provider, or configured default)
4. Submit works normally — user never sees the choice

This is UI-level cost control. A power user could still hit the backend API directly with any model, but for a trusted internal team this is sufficient.

**Phase 2** (future): per-user budget caps, admin-configured model whitelist, usage dashboard.

---

## 2026-04-18 (48)

### Topic 4 (3/3): Admin panel — polish

Small UX improvements to make the admin panel feel finished.

- **Sticky top bar** with "← Back to chat" on the left and "User Management" label in the center. Much easier to escape the admin page than the old footer link.
- **Splash loading state** for the user list (pulsing logo instead of plain "Loading users..." text).
- **Escape key closes dialogs** — press Esc to dismiss the delete / reset-password / change-password modals.
- Removed the old footer back-link (redundant with the top bar).

`packages/app/src/pages/admin.tsx` only.

---

## 2026-04-18 (47)

### Topic 4 (2/3): Admin panel — visibility

Admin can now see at a glance who's active, when each user joined, and how many workspaces they have, plus search the list.

**New features:**
- **Stats bar at top** — three cards: total users, active today (last login < 24h), total workspaces across all users.
- **Per-user metadata** — each row now shows "N workspace(s) · Last active X ago · Joined YYYY-MM-DD". Last-active reads "Never" for users the admin just created who haven't signed in yet.
- **Search box** — live filter users by username (substring match, case-insensitive). Shows "No users match '…'" when the filter returns nothing.

**Backend:**
- `packages/opencode/src/auth/user.ts` — added `listUsersWithMeta()` which joins `UserSessionTable` to compute `last_login = MAX(session.time_created)` per user, and returns `created_at` from `UserTable.time_created`.
- `packages/opencode/src/server/control/user-auth.ts` — `GET /user/list` now returns `UserListItem[]` including `created_at`, `last_login`, and `workspaceCount` (computed per-user by scanning `~/workspaces/<username>/`).

**Frontend:**
- `packages/app/src/context/auth.tsx` — exported `UserListItem` type; `listUsers()` returns the richer shape.
- `packages/app/src/pages/admin.tsx` — stats bar + search input + metadata line per user; `formatRelative()` renders timestamps as `Xm ago` / `Xh ago` / `Xd ago` / `YYYY-MM-DD` for dates older than 30 days. Page width bumped from `max-w-lg` to `max-w-2xl` to fit the extra metadata comfortably.

---

## 2026-04-18 (46)

### Topic 4 (1/3): Admin panel — safety & password management

Admin can now manage passwords without deleting + recreating accounts, and destructive actions require confirmation.

**New features:**
- **Reset user password** — admin sets a new password for any user; that user's existing sessions are invalidated so they must sign in again with the new password.
- **Change own password** — admin can rotate their own password via a modal that verifies the current one first.
- **Confirm dialog on Remove** — clicking Remove no longer deletes instantly; a modal explains that the account will be deleted and the workspace renamed to `<username>_deleted_YYYY-MM-DD` before requiring explicit confirmation.
- **Duplicate-username error** — creating a user with an existing username now shows "Username '…' is already taken" instead of a generic failure.

**Backend:**
- `packages/opencode/src/auth/user.ts` — added `resetPassword(id, newPassword)` (invalidates sessions), `changeOwnPassword(id, currentPassword, newPassword)` (returns false on wrong current password), and `UsernameTakenError`.
- `packages/opencode/src/server/control/user-auth.ts` — routes `PUT /user/:id/password` and `PUT /user/me/password`; `POST /user/create` now returns `409` with a JSON error on duplicate username.

**Frontend:**
- `packages/app/src/context/auth.tsx` — `createUser` now returns `string | undefined` (error message or success); added `resetUserPassword(id, newPassword)` and `changeOwnPassword(current, new)`.
- `packages/app/src/pages/admin.tsx` — added "My account" card at the top with Change-password action; per-user rows now show Reset-password + Remove buttons that open a confirmation/input modal instead of acting immediately; server errors surface in the dialog.

---

## 2026-04-18 (45)

### Fix: .docx preview broken on pandoc < 2.19 ("Unknown option --embed-resources")

**Problem:** The `.docx` preview route used `--embed-resources --standalone`, which was only added in pandoc 2.19 (2022). Pandoc 2.9 (the default on Ubuntu 22.04 and many other distros) rejected the flag and the preview tab showed the raw pandoc error.

**Fix (`packages/opencode/src/server/instance/file.ts`):** Try the modern `--embed-resources --standalone` first. If pandoc responds with "Unknown option", retry automatically with the older `--self-contained` flag (equivalent behavior, supported from pandoc 2.0 through 3.x). No server config needed.

---

## 2026-04-18 (44)

### Feat: preview .docx files inside the app via pandoc

**Before:** Opening a `.docx` file showed a "binary file cannot be displayed" message. Users had to download to Word just to check content.

**After:** `.docx` files render as HTML inside a sandboxed iframe (same iframe we already use for HTML preview). Conversion runs server-side through pandoc, which the user has installed anyway for creating `.docx`. Images, headings, lists, tables, and inline formatting come through. Complex multi-column layouts and embedded charts may look simpler than in Word.

**Backend (`packages/opencode/src/server/instance/file.ts`):**
- `GET /file/preview?path=X` — converts `.docx` to HTML5 with `pandoc --embed-resources --standalone`. Runs via `child_process.execFile` (argv array, no shell — command injection safe). 30-second timeout, 50 MB output cap, gated by `Instance.containsPath`. Clear error if pandoc isn't installed (`"pandoc is not installed on the server"`).

**Frontend (`packages/app/src/pages/session/file-tabs.tsx`):**
- Added `isDocxFile` detection.
- `createResource` fetches `/file/preview` when the tab path is a `.docx`, passes auth token + `directory` query param.
- `.docx` always renders in preview mode (no toggle) — showing raw bytes as "code" is useless. Download button still works.
- Loading spinner while pandoc runs; friendly error message if conversion fails.

`.xlsx` preview is not included — different tool chain (LibreOffice headless or SheetJS). Can be added in a follow-up if needed.

---

## 2026-04-18 (43)

### Fix: download button produced 0-byte file for .docx, .xlsx, .pdf and other binary files

**Root cause:** `File.Service.read` on the server (`packages/opencode/src/file/file.ts:531`) is an LLM-oriented reader: it returns empty `content: ""` for any binary file because feeding binary bytes into a model is useless. The frontend's download button was building a `Blob` from that empty in-memory text, so every binary file downloaded as 0 KB. The file on disk was fine the whole time; the transport was broken.

**Fix:**
- **Backend (`packages/opencode/src/server/instance/file.ts`)** — Added `GET /file/download?path=X`. Reads real bytes with `fs/promises.readFile`, enforces `Instance.containsPath` (so the workspace-access middleware can still gate regular users to their own folder), responds with `Content-Type: application/octet-stream` + `Content-Disposition: attachment; filename*=UTF-8''...` + `Content-Length`.
- **Frontend (`packages/app/src/pages/session/file-tabs.tsx`)** — Rewrote `downloadFile()` to `fetch` from the new endpoint with the Bearer token + `directory` query param, then download the returned `Blob`. Shows a toast on failure.
- **i18n** — added `toast.file.downloadFailed.title` in EN + TH.

---

## 2026-04-18 (42)

### Feat: render markdown files as formatted text + download button for any file

**Markdown preview:**
Opening a `.md` / `.markdown` / `.mdown` file now renders it as formatted text (headings, bold, lists, code blocks with syntax highlighting) by default. Same Preview / Code toggle pattern as HTML.

Reused the existing `<Markdown>` component from `@opencode-ai/ui/markdown` (same renderer that shows AI chat messages — `marked` + `marked-shiki` + `DOMPurify`). No new library added.

**Download button:**
Added a "Download" / "ดาวน์โหลด" button to the file-tab toolbar. Works for every file type (HTML, MD, TXT, images, etc.) and saves the file with its original filename/extension.

Implementation: Blob → `URL.createObjectURL` → temporary `<a download>` click → revoke URL. No server round-trip — uses the content already in memory.

**Files:**
- `packages/app/src/pages/session/file-tabs.tsx` — add `isMarkdownFile`, unify `viewMode` signal across HTML + MD, add `downloadFile()`, render toolbar with Preview / Code / Download.
- `packages/app/src/i18n/en.ts` + `th.ts` — rename `session.file.htmlView.*` → `session.file.view.*` (shared by HTML + MD) and add `session.file.download`.

---

## 2026-04-18 (41)

### Fix: regular user still sees admin's workspaces after admin logs out

**Problem:** After admin logs out and a regular user logs in on the same browser tab, the sidebar showed the admin's workspaces (e.g. `~/workspaces/admin/my-first-proj…`). Clicking them gave "Access denied — you can only access your own workspace".

**Root cause:** The old `logout()` only cleared a couple of `localStorage` keys (`server.v3`, `layout.v6`) but did NOT reset the in-memory SolidJS stores. `ServerProvider` is mounted above the auth `<Show>` gate and stays alive across login/logout, so `server.projects` kept holding the admin's list in memory. When the user logged in, that state leaked straight into the sidebar.

Additional leaks we weren't clearing: `layout.page.v1` (workspace names, expansion state), `globalSync.project.v1` (cached project metadata), prompt history, model selection, permission cache, comments, command catalog.

**Fix:** `packages/app/src/context/auth.tsx`
- `logout()` now wipes every localStorage key that starts with `opencode.global.dat:`, `opencode.workspace.`, or `default.dat:` (the three prefixes used by `Persist.global` / workspace stores / legacy).
- Then does a hard `window.location.replace("/login")`. A full page reload is the only reliable way to reset in-memory stores that live above the auth gate.

---

## 2026-04-18 (40)

### Feat: render HTML files as a webpage instead of source code

**Problem:** Clicking an HTML file (e.g. an AI-generated report) showed raw HTML source highlighted as code. For non-tech users that wanted to see the webpage (fonts, colors, layout), this was the opposite of useful.

**Fix:** When the opened file path ends in `.html` or `.htm`, render it inside a sandboxed `<iframe srcdoc>` by default. A small `Preview / Code` toggle at the top of the tab lets users switch back to the source view if they want to inspect markup.

- `packages/app/src/pages/session/file-tabs.tsx` — detect `.html` / `.htm`, render iframe in preview mode, show toggle buttons; sandbox: `allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox` (no `allow-same-origin`, so the iframe cannot touch parent cookies/storage).
- `packages/app/src/i18n/en.ts` + `th.ts` — new keys `session.file.htmlView.preview` ("Preview" / "แสดงผล") and `session.file.htmlView.code` ("Code" / "โค้ด").

Default mode is "preview" because that's what a non-tech user expects; both modes are available to all users.

---

## 2026-04-18 (39)

### Fix: regular users can now preview files by clicking

**Problem:** After Topic 2 hid the review panel for regular users, clicking a file in the "All files" tree did nothing visible. The file tab was being created in state, but the tabs container that hosts `FileTabContent` is inside the same side-panel div that gets `inert` + `pointer-events-none` + `aria-hidden` when `reviewOpen()` is false. By forcing `reviewOpen()` to always return false for regular users, we accidentally disabled the entire file-preview area.

**Fix:** Separate "review panel is open" from "review feature is enabled":
- `packages/app/src/pages/session.tsx` — restore `desktopReviewOpen` to its original form (no role gate).
- `packages/app/src/pages/session/session-side-panel.tsx` — restore `reviewOpen` to its original form. Instead, make `reviewTab` return false for regular users. This hides the "Review" tab trigger + content inside the tabs list (and via `createSessionTabs`, prevents `activeTab` from ever resolving to `"review"` for regular users), while still allowing the panel to open so file-tab previews render.

Flow for regular users now:
1. Click file in tree → `openTab(tab)` + `openReviewPanel()`
2. Panel opens (state allowed, rendering allowed)
3. `reviewTab()` = false → no Review tab visible
4. `activeTab` resolves to the file tab
5. `FileTabContent` renders the file content — users can now preview files

---

## 2026-04-18 (38)

### Topic 2: Hide developer UI for regular users

Simplify the interface for non-admin users so the app feels like a plain chat tool instead of a developer environment. Regular users (role=user) no longer see Git, terminal, or code-review features. Admins keep the full UI.

**Hidden from regular users:**
- Terminal button in titlebar (`session-header.tsx`)
- Terminal panel (even if state was previously opened as admin)
- Review button in titlebar
- Review panel rendering (forces closed; blocks "Create Git repository" card, "Latest turn changes", diff viewer)
- Branch display on new-session view ("main branch / สาขาหลัก" + full directory path)
- File-tree "Changes" tab (only shows "All files")
- VCS indicators (A/D/M badges and dot colors) next to file names
- Hidden files and folders (anything starting with ".") like `.git`, `.opencode`, `.env`

**Files changed:**
- `packages/app/src/components/session/session-header.tsx` — wrap terminal + review buttons in `<Show when={!isRegularUser()}>`
- `packages/app/src/pages/session.tsx` — `desktopReviewOpen` returns false for regular users
- `packages/app/src/pages/session/session-side-panel.tsx` — hide "Changes" tab, pass no `modified`/`kinds` to FileTree for users, set `hideHidden={true}`, force "all" tab
- `packages/app/src/pages/session/terminal-panel.tsx` — `opened` returns false for regular users
- `packages/app/src/components/session/session-new-view.tsx` — hide branch + full path for regular users, show only workspace name
- `packages/app/src/components/file-tree.tsx` — add `hideHidden?: boolean` prop; filters nodes whose names start with "."

The underlying state (reviewPanel.opened, terminal.opened, fileTree.tab) is not cleared, so re-promoting a user to admin restores the exact previous layout.

---

## 2026-04-18 (37)

### Fix: empty sidebar and missing agent list after login redirect

**Problem (Bug 1 — empty sidebar):** After login, regular users were redirected to their workspace URL (`/<base64(dir)>/session`). The sidebar stayed empty because nothing called `layout.projects.open(dir)` — the login redirect only navigated. The existing `autoselecting` logic is skipped whenever the URL already contains a directory (`state.autoselect = !initialDirectory`).

**Problem (Bug 2 — "Select an agent and model" toast on send):** The agents request (`GET /agent`) was never fired for regular users. In `bootstrapDirectory`, agents were loaded via `queryClient.ensureQueryData`, while every other slow task uses a direct `retry(...)` call or `fetchQuery`. `PromptInput` also calls `useQuery(loadAgentsQuery, { queryFn: skipToken })` for loading state, which registers the query as "tracked" in the cache before bootstrap runs. `ensureQueryData` then treated the tracked query as already-ensured and skipped the real fetch, so `sync.data.agent` stayed empty and `local.agent.current()` returned `undefined`.

**Fixes:**
- `packages/app/src/pages/layout.tsx` — Added a `createEffect` that auto-opens the project when the URL contains a directory not already in `layout.projects.list()`. Covers login redirect, bookmarks, and page refresh.
- `packages/app/src/context/global-sync/bootstrap.ts` — Changed agents slow task from `ensureQueryData` to `fetchQuery`, matching the providers pattern. `fetchQuery` always runs the provided `queryFn`.

---

## 2026-04-18 (36)

### Fix: workspace access middleware blocking all requests for regular users

**Problem:** Regular users got 403 "Access denied" errors on all requests (can't create sessions, can't send messages). Two causes:

1. **URL-encoded directory header not decoded** — The SDK sends the `x-opencode-directory` header as `encodeURIComponent(path)`, but the middleware didn't decode it. So `%2Fhome%2Fzeroone%2Fworkspaces%2Fuser%2F...` was treated as a relative path by `path.resolve()`, failing the workspace prefix check.
2. **Directory picker using wrong starting directory** — The directory picker dialog started from the server's home directory (`/home/zeroone`) instead of the user's workspace directory, causing 403 errors from the `/find/file` endpoint.

**Fixes:**
- `packages/opencode/src/server/middleware.ts` — Added `decodeURIComponent()` to the directory extraction in `WorkspaceAccessMiddleware`, matching how `WorkspaceRouterMiddleware` already handles it.
- `packages/app/src/components/dialog-select-directory.tsx` — Regular users now start browsing from their workspace directory instead of the server's home directory.

---

## 2026-04-18 (35)

### Show titlebar icons for all users, not just admin

Removed admin-only restriction on titlebar icons (copy path, terminal, review, file tree). All users can now see and use these features.

---

## 2026-04-18 (34)

### Fix: new user redirected to previous user's workspace after login

**Problem:** After logging out and logging in as a different user, the app redirected to the previous user's workspace instead of the new user's workspace. This happened because the layout auto-select logic (`autoselecting` in `layout.tsx`) reads `server.projects.last()` from localStorage, which still had the old user's data.

**Fix:** On logout, clear the persisted server and layout data from localStorage so the next user starts with a clean state.

- `packages/app/src/context/auth.tsx` — `logout()` now calls `removePersisted()` for server and layout stores.

---

## 2026-04-18 (33)

### Auto-create workspace folder on login for existing users

The login endpoint now ensures the user's workspace folder exists before returning. This handles users that were created before the workspace feature was added — their folder is automatically created on first login after the update.

---

## 2026-04-18 (32)

### Step 4: Add workspace management UI and API

Regular users now see "My Workspaces" on the home page with a "New Workspace" button to create additional workspaces. Admin users see the original project list.

**Backend (`packages/opencode/src/server/control/user-auth.ts`):**
- `GET /user/workspaces` — lists all workspace folders for the current user
- `POST /user/workspaces` — creates a new workspace folder (name must be letters, numbers, hyphens, underscores)

**Frontend:**
- `packages/app/src/context/auth.tsx` — added `listWorkspaces()` and `createWorkspace()` functions
- `packages/app/src/pages/home.tsx` — regular users see their workspace list + create form; admin users see original project list

---

## 2026-04-18 (31)

### Step 3: Restrict regular users to their own workspace folder

Regular users (non-admin) can now only access directories inside their own workspace folder (`/workspaces/<username>/`). Admin users have no restriction.

- `packages/opencode/src/server/middleware.ts` — Added `WorkspaceAccessMiddleware` that checks the `directory` query param against the user's allowed workspace path. Returns 403 if a regular user tries to access another user's folder or any other server directory.
- `packages/opencode/src/server/server.ts` — Added `WorkspaceAccessMiddleware` to the middleware chain after `UserAuthMiddleware`.

---

## 2026-04-18 (30)

### Rename workspace folder on user deletion

When admin deletes a user, the workspace folder is renamed from `boy/` to `boy_deleted_2026-04-18/` instead of being deleted. This protects data and prevents a newly created user with the same username from seeing the old user's files.

- Handles multiple deletions on the same day (`boy_deleted_2026-04-18_1`, `_2`, etc.)
- If the folder doesn't exist, does nothing (no error)
- Files are preserved — admin can access them via SSH

---

## 2026-04-18 (29)

### Step 2: Auto-redirect user to their workspace after login

After login, users are now redirected to their default workspace (`/my-first-project/session`) instead of the home page. This means new users land directly in their workspace and can start chatting immediately.

- `packages/app/src/context/auth.tsx` — `User` type now includes `workspaceDir` and `defaultWorkspace`. Login and `/user/me` responses store these values.
- `packages/app/src/pages/login.tsx` — After login, redirects to `/<base64(defaultWorkspace)>/session` instead of `/`. Falls back to `/` if no workspace exists (e.g. admin).

---

## 2026-04-18 (28)

### Step 1: Auto-create workspace folder on user creation

When admin creates a new user, the server automatically creates a workspace directory at `<WORKSPACES_DIR>/<username>/my-first-project/`. The workspace path is configurable via `OPENCODE_WORKSPACES_DIR` env var (defaults to `~/workspaces`).

- `POST /user/create` — creates workspace folder, returns `workspaceDir` in response
- `POST /user/login` — now returns `workspaceDir` and `defaultWorkspace` paths
- `GET /user/me` — now returns `workspaceDir` and `defaultWorkspace` paths
- Deploy files updated with `OPENCODE_WORKSPACES_DIR` support

---

## 2026-04-18 (27)

### Add systemd deployment files

Added `deploy/` folder with systemd service files and a setup script for running OpenCode on a Linux server:
- `opencode-backend.service` — runs the backend API (port 4096), auto-restarts on crash
- `opencode-web.service` — runs the web UI (port 3927), depends on backend, auto-restarts on crash
- `setup.sh` — installs both services, replaces placeholder values with actual server config

---

## 2026-04-17 (26)

### Fix review panel auto-opening for non-admin users

- `packages/app/src/context/layout.tsx` — Changed the fallback value in `setReviewPanelOpened` from `true` to `false`. When the `review` store object exists but `panelOpened` is undefined, it was defaulting to `true` (open). Now it correctly defaults to `false` (closed).

---

## 2026-04-17 (25)

### Fix duplicate search bar and icons in titlebar

**Problem:** The titlebar showed duplicate search bars and duplicate icon buttons (copy path, terminal, review, file tree). The `SessionHeader` component uses SolidJS `Portal` to inject content into `#opencode-titlebar-center` and `#opencode-titlebar-right` divs. When the auth flow causes the Router to re-create, a new `SessionHeader` mounts and appends a second set of portal content — but the old content is never removed.

**Fix:** `packages/app/src/components/session/session-header.tsx` — Clear the portal target element (`el.textContent = ""`) before the `Portal` mounts its content. This ensures any leftover content from a previous mount is removed.

---

## 2026-04-17 (24)

### Fix typecheck error in UserAuthMiddleware

- `packages/opencode/src/server/middleware.ts` — Made `UserAuthMiddleware` `async` so the `c.json()` return (a `Response`) is wrapped in a `Promise`, matching the `MiddlewareHandler` type signature.

---

## 2026-04-17 (23)

### Fix typecheck error in authenticatedFetch

- `packages/app/src/utils/server.ts` — Bun's `fetch` type now requires a `preconnect` static property. Changed from inline `typeof fetch` annotation to `as typeof fetch` cast to satisfy the type checker.

---

## 2026-04-17 (22)

### Remove file explorer panel feature

Removed the custom file explorer panel since the built-in file tree already provides workspace file browsing. Reverted all related changes:
- Deleted `packages/app/src/components/session/file-explorer-panel.tsx`
- Removed `fileExplorer` state from `packages/app/src/context/layout.tsx`
- Removed folder toggle button from `packages/app/src/components/session/session-header.tsx`
- Reverted session panel width calculation in `packages/app/src/pages/session.tsx`

---

## 2026-04-17 (21)

### Match file explorer panel style to existing file tree panel

- Content area now uses `bg-background-stronger` (same darker background as file tree)
- Header uses `IconButton` with `h-5 w-5` sizing to match existing panel buttons
- Padding, spacing, empty states, and loading text all match the file tree panel
- Disabled DebugBar overlay in dev mode (`packages/app/src/pages/layout.tsx`)

---

## 2026-04-17 (20)

### Fix file explorer panel not showing content

- Lazy resource loading — files only fetch when panel opens
- Error handling with Retry button
- Fixed inner content collapse during width animation (added min-width)
- Added `fileExplorer` to store initial state for proper reactivity

---

## 2026-04-17 (19)

### Add file explorer panel (right side)

A new file explorer panel that slides in from the right side of the session view. All users can access it via the folder icon in the titlebar.

- **`packages/app/src/components/session/file-explorer-panel.tsx`** — New component: lists workspace files, supports directory navigation with breadcrumbs, and previews file content (text + images) on click.
- **`packages/app/src/context/layout.tsx`** — Added `fileExplorer` state (opened, width, toggle, resize) with default width of 320px.
- **`packages/app/src/components/session/session-header.tsx`** — Added folder icon toggle button in the titlebar, visible to all users (outside the admin-only block).
- **`packages/app/src/pages/session.tsx`** — Rendered `FileExplorerPanel` after `SessionSidePanel` and updated session panel width calculation to account for the file explorer width.

---

## 2026-04-17 (18)

### Fix terminal WebSocket connection failing with 401 Unauthorized

**Problem:** The terminal panel failed to connect with `WebSocket connection failed` in the console. The browser's WebSocket API doesn't support custom headers, so the user's Bearer token was never sent — `UserAuthMiddleware` rejected the connection.

**Fixes:**
- `packages/opencode/src/server/middleware.ts` — `UserAuthMiddleware` now also checks for a `user_token` query parameter as a fallback when no Authorization header is present.
- `packages/app/src/components/terminal.tsx` — The terminal WebSocket URL now includes `?user_token=<token>` so the server can authenticate the connection.

---

## 2026-04-17 (17)

### Disable review panel auto-open on session start

- `packages/app/src/context/layout.tsx` — Changed the default value of `reviewPanelOpened` from `true` to `false`. The review panel (right side) no longer opens automatically when entering a session.

---

## 2026-04-17 (16)

### Fix first login requiring two attempts

**Problem:** When a new user logged in for the first time, the page appeared to refresh back to the login form, requiring them to sign in twice.

**Root cause:** When `auth.login()` sets `auth.store.user`, SolidJS reactivity fires immediately — `AuthenticatedApp` switches from its fallback branch (Router without SDK providers) to its `when` branch (Router WITH SDK providers). This destroys and recreates the entire Router. The `navigate("/")` call in LoginPage runs on the OLD Router's navigate function, which is already disconnected. The NEW Router mounts at `/login` and shows a fresh login form.

**Fix:** `packages/app/src/pages/login.tsx` — Added a `createEffect` that reactively checks if the user is already authenticated and redirects to `/`. This handles the case where the Router remounts after login — the effect fires on the new LoginPage instance and immediately redirects.

---

## 2026-04-17 (15)

### Hide all titlebar-right icons (status, terminal, review, file tree) for non-admin users

- `packages/app/src/components/session/session-header.tsx` — Wrapped the status popover, terminal toggle, review panel toggle, and file tree toggle icons in the titlebar right section with an admin role check. Non-admin users now see a clean titlebar with only the search bar.

---

## 2026-04-17 (14)

### Move debug bar to top-right and add logout button to sidebar

- `packages/app/src/components/debug-bar.tsx` — Moved the dev performance metrics panel from `bottom-3 right-3` to `top-12 right-3` so it sits below the titlebar instead of overlapping the prompt input.
- `packages/app/src/pages/layout/sidebar-shell.tsx` — Added a "Sign out" button to the bottom of the sidebar rail, above the settings gear icon. Uses the `align-right` icon.
- `packages/app/src/pages/layout.tsx` — Connected the logout handler: calls `auth.logout()` then navigates to `/login`.

---

## 2026-04-17 (13)

### Redesign admin page UI to match app theme

- `packages/app/src/pages/admin.tsx` — Full visual overhaul:
  - Centered layout with logo header matching the login page style
  - Cards use `bg-surface-base` with `rounded-xl` borders and `shadow-sm`
  - User rows have avatar circles (accent color for admins, neutral for users), proper labels, and hover states
  - Role select and delete button are compact inline controls
  - "You" badge shown for the current user instead of disabled controls
  - Create user form has proper labels, consistent input styling, and a success message
  - Back link moved to bottom center
  - Added user count badge in the card header

---

## 2026-04-17 (12)

### Hide copy-path and open-in-editor icons for non-admin users

- `packages/app/src/components/session/session-header.tsx` — The "Copy path" button and "Open in editor" (VS Code, Cursor, etc.) dropdown in the titlebar right section are now only visible to users with the `admin` role. Other toolbar icons (status, terminal, review panel, file tree) remain visible to all users since they control UI panels.

---

## 2026-04-17 (11)

### Fix search bar and titlebar-right icons missing in session view

**Problem:** After the auth component tree restructuring, the search bar (center of titlebar) and the copy-path/open-in-editor icons (right of titlebar) stopped appearing in session views. These are rendered by `session-header.tsx` via `Portal` into `#opencode-titlebar-center` and `#opencode-titlebar-right` divs. The `createMemo(() => document.getElementById(...))` calls had no reactive dependencies — they ran once during initialization, and if the titlebar DOM elements weren't ready yet, they cached `null` permanently.

**Fix:** `packages/app/src/components/session/session-header.tsx` — Added an `onMount` signal so the `createMemo` re-evaluates after the component is fully mounted, ensuring the titlebar portal targets are found.

---

## 2026-04-17 (10)

### Fix TypeError: Cannot read properties of undefined (reading 'worktree')

**Problem:** After signing in, `sidebar-workspace.tsx` crashed with `TypeError: Cannot read properties of undefined (reading 'worktree')`. The `SidebarPanel` in `layout.tsx` passed `project()!` (non-null assertion) to `LocalWorkspace` and `SortableWorkspace`, but `project()` is `Accessor<LocalProject | undefined>` — it returns `undefined` during the brief window after login when sync data hasn't loaded yet.

**Fix:** `packages/app/src/pages/layout.tsx` — Replaced both `project()!` usages with `<Show when={project()}>` guards that use SolidJS callback children `{(p) => ...}` to provide a guaranteed non-null project value. The sidebar components now simply don't render until project data is available.

---

## 2026-04-17 (9)

### Fix SDK providers being destroyed when navigating to admin page

**Problem:** `GlobalSDKProvider` and `GlobalSyncProvider` were inside `RouterRoot`. When navigating to `/admin` (an auth page), `RouterRoot` stopped rendering them — destroying all sync and sidebar state. Navigating back caused a crash because `sidebar-workspace.tsx` tried to read `.worktree` from data that hadn't reloaded yet.

**Fix:** Introduced `AuthenticatedApp` component that wraps `GlobalSDKProvider` + `GlobalSyncProvider` once at the session level (outside the router's per-route logic). It mounts them when the user is confirmed logged in and keeps them mounted for the whole session — even when visiting `/admin`. `RouterRoot` goes back to only handling `AppShellProviders` wrapping for non-auth routes.

---

## 2026-04-17 (8)

### Restrict admin page to admin role + add titlebar icon

- `packages/app/src/components/titlebar.tsx` — Added a `settings-gear` icon button in the top-right of the titlebar, only visible when the logged-in user has the `admin` role. Clicking it navigates to `/admin`.
- `packages/app/src/pages/admin.tsx` — Replaced the one-shot `if` guard with a reactive `createEffect` that redirects non-admins to `/` even if auth finishes loading after the component mounts.

---

## 2026-04-17 (7)

### Fix GlobalSDKProvider and GlobalSyncProvider mounting before auth is confirmed

**Root cause:** `GlobalSDKProvider` and `GlobalSyncProvider` were mounted outside `AuthGate` in `app.tsx`. They fire API requests the moment they mount — even when no user is logged in and the token is null — causing 401 errors on every endpoint from the first page load.

**Fix:** `packages/app/src/app.tsx`
- Moved `GlobalSDKProvider` and `GlobalSyncProvider` inside `RouterRoot`, wrapped in the auth check
- `RouterRoot` now handles the full auth flow for all non-login routes: show spinner while loading → redirect to `/login` if not authenticated → mount SDK providers and render the app only when a valid user exists
- Removed `GlobalSDKProvider`/`GlobalSyncProvider` from the outer `AppInterface` wrapper
- Removed the redundant `AuthGate` wrapper from the `/` route (RouterRoot now protects all routes uniformly)

---

## 2026-04-17 (6)

### Fix token being deleted on startup before server URL is ready

**Root cause:** In `auth.tsx`, `createResource` ran the token-validation fetch immediately on mount. At that moment `apiUrl()` returns `""` because the server context hasn't initialized yet. The `authFetch("/user/me")` call hit the Vite dev server (`localhost:4444`) instead of the backend, got a non-OK response, and deleted the token from localStorage. Every subsequent SDK request then had no Bearer token → 401 on everything.

**Fix:** `packages/app/src/context/auth.tsx` — Pass `apiUrl` as the resource *source* to `createResource`. SolidJS will only run (and re-run) the async function when `apiUrl()` returns a non-empty value, ensuring the validation never fires against the wrong origin.

---

## 2026-04-17 (5)

### Fix Bearer token not being sent — Request object headers lost

The SDK's generated client calls `fetch(request)` passing a pre-built `Request` object as the first argument with `init` as `undefined`. The previous `authenticatedFetch` wrapper read `init?.headers` which was always `undefined` in this case, so the Authorization header was never injected and the original request headers were dropped.

- `packages/app/src/utils/server.ts` — Detect when `input` is a `Request` instance, copy headers from the request object itself, inject the Bearer token, then reconstruct the request with `new Request(input, { headers })`.

---

## 2026-04-17 (4)

### Fix CORS + 401 errors on all API calls after login

**Problem:** After logging in, every SDK request from the app failed with CORS errors and 401 Unauthorized. Two bugs caused this:
1. The SDK client (`createSdkForServer`) never included the user's Bearer token, so all requests were unauthenticated.
2. `CorsMiddleware` ran *after* `UserAuthMiddleware`, so 401 responses were sent before CORS headers could be added — the browser saw both a CORS error and a 401.

**Fixes:**
- `packages/opencode/src/server/server.ts` — Moved `CorsMiddleware` before `UserAuthMiddleware` so CORS headers are always present on every response, including errors.
- `packages/app/src/utils/server.ts` — Wrapped the fetch function in `createSdkForServer` to dynamically read `opencode-user-token` from localStorage and inject `Authorization: Bearer <token>` on every SDK request.

---

## 2026-04-17 (3)

### Fix "Sign in" button style on login page

- `packages/app/src/pages/login.tsx` — Changed button background from `bg-accent-base` (was nearly invisible) to `bg-neutral-800` with `hover:bg-neutral-700` so it looks like a proper solid filled button

---

## 2026-04-17 (2)

### Add user login system with roles (admin/user)

**Backend:**
- `packages/opencode/src/auth/user.sql.ts` — New Drizzle tables: `app_user` (id, username, password, role) and `app_user_session` (token, user_id, expires_at)
- `packages/opencode/migration/20260417120000_add_users/migration.sql` — SQL migration to create both tables
- `packages/opencode/src/auth/user.ts` — User service: create, login, logout, validateSession, listUsers, deleteUser, changeRole. Passwords hashed with PBKDF2 (crypto module, cross-runtime)
- `packages/opencode/src/server/control/user-auth.ts` — New routes: POST /user/login, POST /user/logout, GET /user/me, GET /user/list, POST /user/create, DELETE /user/:id, PUT /user/:id/role
- `packages/opencode/src/server/control/index.ts` — Registered UserAuthRoutes
- `packages/opencode/src/server/middleware.ts` — Added UserAuthMiddleware: checks Bearer token on all routes except /user/login and /user/create; allows through when no users exist yet (initial setup)
- `packages/opencode/src/server/server.ts` — Added UserAuthMiddleware to the middleware stack

**Frontend:**
- `packages/app/src/context/auth.tsx` — Auth context: stores current user + token in localStorage, provides login/logout/listUsers/createUser/deleteUser/changeRole functions
- `packages/app/src/pages/login.tsx` — Clean login form page (username + password)
- `packages/app/src/pages/admin.tsx` — Admin panel: list users, add users, delete users, change roles
- `packages/app/src/app.tsx` — Added AuthProvider, AuthGate (redirects to /login if not authenticated), /login route, /admin route

**Why:** Team deployment needs individual user accounts with role-based access. First user created automatically becomes admin.

---

## 2026-04-17

### Set orchestrator as default agent and hide agent selector

- `.opencode/opencode.jsonc` — added `default_agent: "orchestrator"` so the orchestrator is always the entry point for users
- `packages/opencode/src/agent/agent.ts` — marked `build` and `plan` agents as `hidden: true` so they no longer appear in UI lists but still work in the background when called by the orchestrator
- `packages/app/src/components/prompt-input.tsx` — removed the agent selector dropdown from the chat input bar so users only talk to the orchestrator

**Why:** Normal users should not need to pick agents manually. The orchestrator handles routing silently behind the scenes, giving a simpler ChatGPT-like experience.
