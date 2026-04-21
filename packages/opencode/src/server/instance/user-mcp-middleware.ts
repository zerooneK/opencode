import type { MiddlewareHandler } from "hono"
import { MCP } from "../../mcp"
import { AppRuntime } from "../../effect/app-runtime"
import { UserAuth } from "../../auth/user"
import { Log } from "../../util"

// Per-user MCP server registration.
//
// Users can point their session at a laptop-bridge HTTP MCP server via
// /user/me/mcp. At chat time we need that MCP client to be registered with the
// user's Instance so tools like `read_local_file` are available.
//
// MCP.add() replaces any existing client with the same name, so calling it on
// every request would work but reconnects on each hit. We cache the last
// registered URL per user in memory and only re-register when the URL changes
// or on first request.
//
// This middleware runs AFTER WorkspaceRouterMiddleware so Instance.provide()
// has already set up the Effect context that MCP.Service depends on.

const log = Log.create({ service: "user-mcp-middleware" })

// Maps userId -> the URL we most recently registered with MCP.add().
// Kept in the process; resets on server restart (MCP.add is re-called on first
// request after restart).
const lastRegistered = new Map<string, string>()

const clientNameFor = (userId: string) => `user-bridge-${userId}`

export const UserMcpMiddleware: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") return next()

  const token =
    UserAuth.extractToken(c.req.header("Authorization")) ?? c.req.query("user_token")
  const user = token ? UserAuth.validateSession(token) : undefined
  if (!user) return next()

  const mcp = UserAuth.getMcp(user.id)

  // User has no laptop bridge configured yet. Nothing to do — don't touch the
  // MCP service so we avoid wasted work on every request.
  if (!mcp) return next()

  if (lastRegistered.get(user.id) === mcp.url) {
    // Already registered for this user+URL combination in this process.
    return next()
  }

  try {
    await AppRuntime.runPromise(
      MCP.Service.use((svc) =>
        svc.add(clientNameFor(user.id), {
          type: "remote",
          url: mcp.url,
          enabled: true,
          headers: { Authorization: `Bearer ${mcp.token}` },
        }),
      ),
    )
    lastRegistered.set(user.id, mcp.url)
    log.info("registered user MCP", { user: user.username, url: mcp.url })
  } catch (err) {
    log.warn("failed to register user MCP", {
      user: user.username,
      error: err instanceof Error ? err.message : String(err),
    })
    // Don't block the request — the user's chat should still work, just
    // without their laptop tools.
  }

  return next()
}
