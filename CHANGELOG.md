# Changelog

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
