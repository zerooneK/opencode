import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { UserAuth } from "@/auth/user"

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
      (c) => {
        const { username, password } = c.req.valid("json")
        const result = UserAuth.login(username, password)
        if (!result) return c.json({ error: "Invalid username or password" }, 401)
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
    .get("/user/list", (c) => {
      const admin = requireAdmin(c.req.header("Authorization"))
      if (!admin) return c.json({ error: "Forbidden" }, 403)
      return c.json(UserAuth.listUsers())
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
        const id = UserAuth.create(username, password, existingRole)
        const workspaceDir = await createUserWorkspace(username)
        return c.json({ id, username, role: existingRole, workspaceDir })
      },
    )
    .delete("/user/:id", async (c) => {
      const admin = requireAdmin(c.req.header("Authorization"))
      if (!admin) return c.json({ error: "Forbidden" }, 403)
      if (c.req.param("id") === admin.id) return c.json({ error: "Cannot delete yourself" }, 400)
      const user = UserAuth.findById(c.req.param("id"))
      if (user) await renameUserWorkspace(user.username)
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
}
