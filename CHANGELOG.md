# Changelog

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
