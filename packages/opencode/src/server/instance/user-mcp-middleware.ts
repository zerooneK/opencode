import type { MiddlewareHandler } from "hono"
import { MCP } from "../../mcp"
import { AppRuntime } from "../../effect/app-runtime"
import { UserAuth } from "../../auth/user"
import { Instance } from "../../project/instance"
import { Log } from "../../util"

// Per-user MCP server registration.
//
// Users can point their session at a laptop-bridge HTTP MCP server via
// /user/me/mcp. At chat time we need that MCP client to be registered with the
// user's Instance so tools like `read_local_file` are available.
//
// CRITICAL: MCP state is scoped PER INSTANCE, and each workspace directory is
// its own Instance (cached in project/instance.ts). If we only register the
// MCP in one directory, chat requests that land in a different workspace
// Instance won't see the MCP at all. So the cache key is (userId, directory).
// Each distinct Instance the user touches gets its own registration pass.
//
// MCP.add() is idempotent: calling it again replaces the existing client with
// the same name, reconnecting. We avoid that cost by caching the most recent
// URL we registered for each (userId, directory) pair, and single-flighting
// concurrent registrations for the same key — the frontend fires many
// parallel HTTP calls on a page load, each of which hits this middleware,
// and we don't want them all racing to initialize the bridge at once.

const log = Log.create({ service: "user-mcp-middleware" })

// Key = `${userId} ${directory}`. Value = most recently registered URL.
const lastRegistered = new Map<string, string>()
// While one registration for a given key is pending, concurrent requests
// share the same promise instead of firing their own MCP.add() calls.
const inFlight = new Map<string, Promise<void>>()
const cacheKey = (userId: string, directory: string) => `${userId} ${directory}`

// MCP client name shown to the model and surfaced in tool IDs. Kept short
// because the full tool name the AI sees is `<clientName>_<toolName>`.
// We don't need a user ID here: MCP state is per-Instance (i.e. per workspace
// directory), and each user's workspace is its own Instance, so there's no
// cross-user collision.
const MCP_CLIENT_NAME = "laptop"
const clientNameFor = (_userId: string) => MCP_CLIENT_NAME

async function register(input: {
  key: string
  username: string
  userId: string
  url: string
  token: string
  directory: string
  path: string
}) {
  log.info("attempting to register user MCP", {
    user: input.username,
    url: input.url,
    directory: input.directory,
    path: input.path,
  })

  try {
    const result = await AppRuntime.runPromise(
      MCP.Service.use((svc) =>
        svc.add(clientNameFor(input.userId), {
          type: "remote",
          url: input.url,
          enabled: true,
          headers: { Authorization: `Bearer ${input.token}` },
        }),
      ),
    )
    const entry =
      (result.status as Record<string, { status: string; error?: string }>)[
        clientNameFor(input.userId)
      ]
    if (entry?.status === "connected") {
      lastRegistered.set(input.key, input.url)
      log.info("registered user MCP", {
        user: input.username,
        url: input.url,
        directory: input.directory,
        status: JSON.stringify(result.status),
      })
    } else {
      log.warn("user MCP registration did not connect", {
        user: input.username,
        url: input.url,
        directory: input.directory,
        status: JSON.stringify(result.status),
      })
    }
  } catch (err) {
    log.warn("failed to register user MCP", {
      user: input.username,
      url: input.url,
      directory: input.directory,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export const UserMcpMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next()

  const token =
    UserAuth.extractToken(c.req.header("Authorization")) ?? c.req.query("user_token")
  const user = token ? UserAuth.validateSession(token) : undefined
  if (!user) return next()

  const mcp = UserAuth.getMcp(user.id)
  if (!mcp) return next()

  // Pull the Instance directory from the current ALS context. If Instance
  // isn't set (WorkspaceRouterMiddleware didn't wrap this request) we can't
  // register anything — just fall through.
  let directory: string
  try {
    directory = Instance.directory
  } catch {
    return next()
  }

  const key = cacheKey(user.id, directory)
  if (lastRegistered.get(key) === mcp.url) {
    // Already registered in this Instance with the current URL.
    return next()
  }

  // Single-flight: if another concurrent request is already registering for
  // this key, await that promise instead of starting a duplicate attempt.
  let pending = inFlight.get(key)
  if (!pending) {
    pending = register({
      key,
      username: user.username,
      userId: user.id,
      url: mcp.url,
      token: mcp.token,
      directory,
      path: c.req.path,
    }).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, pending)
  }
  await pending

  return next()
}
