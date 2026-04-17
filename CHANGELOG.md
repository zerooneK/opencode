# Changelog

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
