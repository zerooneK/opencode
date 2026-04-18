import { Provider } from "../provider"
import { NamedError } from "@opencode-ai/shared/util/error"
import { NotFoundError } from "../storage"
import { Session } from "../session"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorHandler, MiddlewareHandler } from "hono"
import { HTTPException } from "hono/http-exception"
import { Log } from "../util"
import { Flag } from "@/flag/flag"
import { basicAuth } from "hono/basic-auth"
import { cors } from "hono/cors"
import { compress } from "hono/compress"
import { UserAuth } from "@/auth/user"
import path from "path"
import os from "os"

const log = Log.create({ service: "server" })

export const ErrorMiddleware: ErrorHandler = (err, c) => {
  log.error("failed", {
    error: err,
  })
  if (err instanceof NamedError) {
    let status: ContentfulStatusCode
    if (err instanceof NotFoundError) status = 404
    else if (err instanceof Provider.ModelNotFoundError) status = 400
    else if (err.name === "ProviderAuthValidationFailed") status = 400
    else if (err.name.startsWith("Worktree")) status = 400
    else status = 500
    return c.json(err.toObject(), { status })
  }
  if (err instanceof Session.BusyError) {
    return c.json(new NamedError.Unknown({ message: err.message }).toObject(), { status: 400 })
  }
  if (err instanceof HTTPException) return err.getResponse()
  const message = err instanceof Error && err.stack ? err.stack : err.toString()
  return c.json(new NamedError.Unknown({ message }).toObject(), {
    status: 500,
  })
}

export const AuthMiddleware: MiddlewareHandler = (c, next) => {
  // Allow CORS preflight requests to succeed without auth.
  // Browser clients sending Authorization headers will preflight with OPTIONS.
  if (c.req.method === "OPTIONS") return next()
  const password = Flag.OPENCODE_SERVER_PASSWORD
  if (!password) return next()
  const username = Flag.OPENCODE_SERVER_USERNAME ?? "opencode"

  if (c.req.query("auth_token")) c.req.raw.headers.set("authorization", `Basic ${c.req.query("auth_token")}`)

  return basicAuth({ username, password })(c, next)
}

export const LoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const skip = c.req.path === "/log"
  if (!skip) {
    log.info("request", {
      method: c.req.method,
      path: c.req.path,
    })
  }
  const timer = log.time("request", {
    method: c.req.method,
    path: c.req.path,
  })
  await next()
  if (!skip) timer.stop()
}

export function CorsMiddleware(opts?: { cors?: string[] }): MiddlewareHandler {
  return cors({
    maxAge: 86_400,
    origin(input) {
      if (!input) return

      if (input.startsWith("http://localhost:")) return input
      if (input.startsWith("http://127.0.0.1:")) return input
      if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
        return input

      if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) return input
      if (opts?.cors?.includes(input)) return input
    },
  })
}

// Public routes that do not require user session auth
const PUBLIC_PATHS = new Set(["/user/login", "/user/create"])

export const UserAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next()
  if (PUBLIC_PATHS.has(c.req.path)) return next()
  // If no users exist yet (initial setup), allow through so first admin can be created
  if (UserAuth.count() === 0) return next()
  const token = UserAuth.extractToken(c.req.header("Authorization")) ?? c.req.query("user_token")
  const user = token ? UserAuth.validateSession(token) : undefined
  if (!user) return c.json({ error: "Unauthorized" }, 401)
  return next()
}

const WORKSPACES_DIR = process.env.OPENCODE_WORKSPACES_DIR || path.join(os.homedir(), "workspaces")

// Paths that don't involve directory access — skip workspace restriction
const WORKSPACE_SKIP_PATHS = new Set([
  "/user/login",
  "/user/create",
  "/user/logout",
  "/user/me",
  "/user/list",
  "/global/event",
  "/event",
  "/log",
  "/doc",
])

export const WorkspaceAccessMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next()

  const reqPath = c.req.path
  if (WORKSPACE_SKIP_PATHS.has(reqPath)) return next()
  // Skip user management routes (e.g. /user/:id, /user/:id/role)
  if (reqPath.startsWith("/user/")) return next()
  // Skip auth routes
  if (reqPath.startsWith("/auth/")) return next()

  // Get the authenticated user
  const token = UserAuth.extractToken(c.req.header("Authorization")) ?? c.req.query("user_token")
  const user = token ? UserAuth.validateSession(token) : undefined

  // No user or admin — allow everything
  if (!user || user.role === "admin") return next()

  // Check if request has a directory parameter (decode URI-encoded header values)
  const rawDirectory = c.req.query("directory") || c.req.header("x-opencode-directory")
  if (!rawDirectory) return next()

  const directory = (() => {
    try {
      return decodeURIComponent(rawDirectory)
    } catch {
      return rawDirectory
    }
  })()

  // Resolve the requested directory to an absolute path
  const resolved = path.resolve(directory)
  const userWorkspace = path.join(WORKSPACES_DIR, user.username)

  // Regular users can only access their own workspace folder
  if (!resolved.startsWith(userWorkspace + path.sep) && resolved !== userWorkspace) {
    return c.json({ error: "Access denied: you can only access your own workspace" }, 403)
  }

  return next()
}

const zipped = compress()
export const CompressionMiddleware: MiddlewareHandler = (c, next) => {
  const reqPath = c.req.path
  const method = c.req.method
  if (reqPath === "/event" || reqPath === "/global/event") return next()
  if (method === "POST" && /\/session\/[^/]+\/(message|prompt_async)$/.test(reqPath)) return next()
  return zipped(c, next)
}
