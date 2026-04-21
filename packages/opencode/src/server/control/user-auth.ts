import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { UserAuth } from "@/auth/user"
import { Database, like } from "@/storage"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"

const WORKSPACES_DIR = process.env.OPENCODE_WORKSPACES_DIR || path.join(os.homedir(), "workspaces")
const DEFAULT_WORKSPACE_NAME = "my-first-project"

async function createUserWorkspace(username: string): Promise<string> {
  const userDir = path.join(WORKSPACES_DIR, username, DEFAULT_WORKSPACE_NAME)
  await fs.mkdir(userDir, { recursive: true })
  return userDir
}

function getUserWorkspaceDir(username: string): string {
  return path.join(WORKSPACES_DIR, username)
}

function getDefaultWorkspace(username: string): string {
  return path.join(WORKSPACES_DIR, username, DEFAULT_WORKSPACE_NAME)
}

// Remove every DB row tied to the deleted user's workspace so a new user
// created with the same username starts with a clean sidebar and no
// carry-over chat history.
//
// Important subtlety: sessions are NOT always keyed by a per-workspace
// project row. Many sessions use the shared `project_id = "global"` and are
// only distinguished by the `directory` field. So dropping project rows
// alone is not enough — we also have to delete session rows whose directory
// is inside the user's workspace. Messages, parts, todos, session_entry,
// and permission rows cascade via FK constraints (enabled in db.ts via
// PRAGMA foreign_keys = ON).
function deleteUserData(username: string): void {
  const prefix = path.join(WORKSPACES_DIR, username) + path.sep
  Database.transaction((db) => {
    db.delete(SessionTable).where(like(SessionTable.directory, prefix + "%")).run()
    db.delete(ProjectTable).where(like(ProjectTable.worktree, prefix + "%")).run()
  })
}

async function renameUserWorkspace(username: string): Promise<void> {
  const userDir = path.join(WORKSPACES_DIR, username)
  const exists = await fs.stat(userDir).catch(() => null)
  if (!exists) return
  const date = new Date().toISOString().slice(0, 10)
  const baseName = `${username}_deleted_${date}`
  let target = path.join(WORKSPACES_DIR, baseName)
  // Handle multiple deletions on the same day
  let suffix = 1
  while (await fs.stat(target).catch(() => null)) {
    target = path.join(WORKSPACES_DIR, `${baseName}_${suffix}`)
    suffix++
  }
  await fs.rename(userDir, target)
}

function requireUser(authHeader: string | undefined) {
  const token = UserAuth.extractToken(authHeader)
  if (!token) return
  return UserAuth.validateSession(token)
}

function requireAdmin(authHeader: string | undefined) {
  const user = requireUser(authHeader)
  if (!user || user.role !== "admin") return
  return user
}

export function UserAuthRoutes(): Hono {
  return new Hono()
    .post(
      "/user/login",
      validator(
        "json",
        z.object({
          username: z.string().min(1),
          password: z.string().min(1),
        }),
      ),
      async (c) => {
        const { username, password } = c.req.valid("json")
        const result = UserAuth.login(username, password)
        if (!result) return c.json({ error: "Invalid username or password" }, 401)
        // Ensure workspace folder exists (handles users created before this feature)
        await createUserWorkspace(username)
        return c.json({
          ...result,
          workspaceDir: getUserWorkspaceDir(username),
          defaultWorkspace: getDefaultWorkspace(username),
        })
      },
    )
    .post("/user/logout", (c) => {
      const token = UserAuth.extractToken(c.req.header("Authorization"))
      if (token) UserAuth.logout(token)
      return c.json(true)
    })
    .get("/user/me", (c) => {
      const user = requireUser(c.req.header("Authorization"))
      if (!user) return c.json({ error: "Unauthorized" }, 401)
      return c.json({
        ...user,
        workspaceDir: getUserWorkspaceDir(user.username),
        defaultWorkspace: getDefaultWorkspace(user.username),
      })
    })
    .get("/user/list", async (c) => {
      const admin = requireAdmin(c.req.header("Authorization"))
      if (!admin) return c.json({ error: "Forbidden" }, 403)
      const users = UserAuth.listUsersWithMeta()
      const withCounts = await Promise.all(
        users.map(async (user) => {
          const userDir = path.join(WORKSPACES_DIR, user.username)
          const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => [])
          const workspaceCount = entries.filter((e) => e.isDirectory()).length
          return { ...user, workspaceCount }
        }),
      )
      return c.json(withCounts)
    })
    .post(
      "/user/create",
      validator(
        "json",
        z.object({
          username: z.string().min(1),
          password: z.string().min(6),
          role: z.enum(["admin", "user"]).default("user"),
        }),
      ),
      async (c) => {
        // Allow first user creation without auth (initial setup)
        const isFirstUser = UserAuth.count() === 0
        if (!isFirstUser) {
          const admin = requireAdmin(c.req.header("Authorization"))
          if (!admin) return c.json({ error: "Forbidden" }, 403)
        }
        const { username, password, role } = c.req.valid("json")
        const existingRole: UserAuth.Role = isFirstUser ? "admin" : role
        try {
          const id = UserAuth.create(username, password, existingRole)
          const workspaceDir = await createUserWorkspace(username)
          return c.json({ id, username, role: existingRole, workspaceDir })
        } catch (err) {
          if (err instanceof UserAuth.UsernameTakenError) {
            return c.json({ error: err.message }, 409)
          }
          throw err
        }
      },
    )
    .delete("/user/:id", async (c) => {
      const admin = requireAdmin(c.req.header("Authorization"))
      if (!admin) return c.json({ error: "Forbidden" }, 403)
      if (c.req.param("id") === admin.id) return c.json({ error: "Cannot delete yourself" }, 400)
      const user = UserAuth.findById(c.req.param("id"))
      if (user) {
        // Drop DB rows first (while we still know the username path) so that
        // re-creating a user with the same username starts with a clean
        // sidebar and no carry-over sessions or chat history.
        deleteUserData(user.username)
        await renameUserWorkspace(user.username)
      }
      UserAuth.deleteUser(c.req.param("id"))
      return c.json(true)
    })
    .put(
      "/user/:id/role",
      validator(
        "json",
        z.object({
          role: z.enum(["admin", "user"]),
        }),
      ),
      (c) => {
        const admin = requireAdmin(c.req.header("Authorization"))
        if (!admin) return c.json({ error: "Forbidden" }, 403)
        if (c.req.param("id") === admin.id) return c.json({ error: "Cannot change your own role" }, 400)
        UserAuth.changeRole(c.req.param("id"), c.req.valid("json").role)
        return c.json(true)
      },
    )
    // IMPORTANT: /user/me/password must be registered before /user/:id/password.
    // Hono matches routes in registration order and `:id` would otherwise catch
    // "me" and route the request to the admin-only reset-password handler.
    .put(
      "/user/me/password",
      validator(
        "json",
        z.object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(6),
        }),
      ),
      (c) => {
        const user = requireUser(c.req.header("Authorization"))
        if (!user) return c.json({ error: "Unauthorized" }, 401)
        const { currentPassword, newPassword } = c.req.valid("json")
        const ok = UserAuth.changeOwnPassword(user.id, currentPassword, newPassword)
        if (!ok) return c.json({ error: "Current password is incorrect" }, 400)
        return c.json(true)
      },
    )
    .put(
      "/user/:id/password",
      validator(
        "json",
        z.object({
          password: z.string().min(6),
        }),
      ),
      (c) => {
        const admin = requireAdmin(c.req.header("Authorization"))
        if (!admin) return c.json({ error: "Forbidden" }, 403)
        const target = UserAuth.findById(c.req.param("id"))
        if (!target) return c.json({ error: "User not found" }, 404)
        UserAuth.resetPassword(target.id, c.req.valid("json").password)
        return c.json(true)
      },
    )
    // ── MCP bridge endpoints ────────────────────────────────────────────────
    // Each user can register one remote MCP server (typically a laptop bridge
    // script) whose URL + bearer token we store in app_user. At chat time the
    // backend reads these and adds the server to the user's MCP tools.
    .get("/user/me/mcp", (c) => {
      const user = requireUser(c.req.header("Authorization"))
      if (!user) return c.json({ error: "Unauthorized" }, 401)
      const mcp = UserAuth.getMcp(user.id)
      if (!mcp) return c.json({ configured: false })
      return c.json({ configured: true, url: mcp.url, token: mcp.token })
    })
    .put(
      "/user/me/mcp",
      validator(
        "json",
        z.object({
          url: z.string().url(),
          token: z.string().min(1),
        }),
      ),
      (c) => {
        const user = requireUser(c.req.header("Authorization"))
        if (!user) return c.json({ error: "Unauthorized" }, 401)
        const { url, token } = c.req.valid("json")
        UserAuth.setMcp(user.id, { url, token })
        return c.json({ configured: true, url, token })
      },
    )
    .delete("/user/me/mcp", (c) => {
      const user = requireUser(c.req.header("Authorization"))
      if (!user) return c.json({ error: "Unauthorized" }, 401)
      UserAuth.setMcp(user.id, null)
      return c.json({ configured: false })
    })
    .post(
      "/user/me/mcp/test",
      validator(
        "json",
        z.object({
          url: z.string().url(),
          token: z.string().min(1),
        }),
      ),
      async (c) => {
        const user = requireUser(c.req.header("Authorization"))
        if (!user) return c.json({ error: "Unauthorized" }, 401)
        const { url, token } = c.req.valid("json")
        try {
          const res = await fetch(url, {
            method: "POST",
            signal: AbortSignal.timeout(5000),
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "t-open-workspace", version: "1.0.0" },
              },
            }),
          })
          if (!res.ok) {
            return c.json({ ok: false, error: `HTTP ${res.status}` }, 200)
          }
          const data = (await res.json().catch(() => null)) as { result?: { serverInfo?: { name?: string } } } | null
          const serverName = data?.result?.serverInfo?.name ?? "unknown"
          return c.json({ ok: true, serverName })
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error"
          return c.json({ ok: false, error: message }, 200)
        }
      },
    )
    .get("/user/workspaces", async (c) => {
      const user = requireUser(c.req.header("Authorization"))
      if (!user) return c.json({ error: "Unauthorized" }, 401)
      const userDir = getUserWorkspaceDir(user.username)
      const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => [])
      const workspaces = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({
          name: e.name,
          path: path.join(userDir, e.name),
        }))
      return c.json(workspaces)
    })
    .post(
      "/user/workspaces",
      validator(
        "json",
        z.object({
          name: z
            .string()
            .min(1)
            .regex(/^[a-zA-Z0-9_-]+$/, "Workspace name can only contain letters, numbers, hyphens and underscores"),
        }),
      ),
      async (c) => {
        const user = requireUser(c.req.header("Authorization"))
        if (!user) return c.json({ error: "Unauthorized" }, 401)
        const { name } = c.req.valid("json")
        const workspacePath = path.join(WORKSPACES_DIR, user.username, name)
        const exists = await fs.stat(workspacePath).catch(() => null)
        if (exists) return c.json({ error: "Workspace already exists" }, 400)
        await fs.mkdir(workspacePath, { recursive: true })
        return c.json({ name, path: workspacePath })
      },
    )
}
