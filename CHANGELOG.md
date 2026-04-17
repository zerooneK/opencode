# Changelog

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
