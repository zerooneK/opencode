import { randomBytes, pbkdf2Sync } from "crypto"
import { Database, eq, sql } from "../storage"
import { UserTable, UserSessionTable } from "./user.sql"

// 30 days in milliseconds
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex")
  const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":")
  const verify = pbkdf2Sync(password, salt, 100_000, 64, "sha512").toString("hex")
  return hash === verify
}

export namespace UserAuth {
  export type Role = "admin" | "user"

  export type User = {
    id: string
    username: string
    role: Role
  }

  export function count(): number {
    return Database.use((db) => db.select().from(UserTable).all().length)
  }

  export function create(username: string, password: string, role: Role = "user"): string {
    if (findByUsername(username)) throw new UsernameTakenError(username)
    const id = crypto.randomUUID()
    Database.transaction((db) => {
      db.insert(UserTable)
        .values({ id, username, password: hashPassword(password), role })
        .run()
    })
    return id
  }

  export function findByUsername(username: string) {
    return Database.use((db) =>
      db.select().from(UserTable).where(eq(UserTable.username, username)).get(),
    )
  }

  export function findById(id: string) {
    return Database.use((db) => db.select().from(UserTable).where(eq(UserTable.id, id)).get())
  }

  export function login(username: string, password: string): { token: string; user: User } | undefined {
    const row = findByUsername(username)
    if (!row) return
    if (!verifyPassword(password, row.password)) return
    const token = randomBytes(32).toString("hex")
    Database.transaction((db) => {
      db.insert(UserSessionTable)
        .values({ id: token, user_id: row.id, expires_at: Date.now() + SESSION_TTL })
        .run()
    })
    return { token, user: { id: row.id, username: row.username, role: row.role } }
  }

  export function logout(token: string): void {
    Database.transaction((db) => {
      db.delete(UserSessionTable).where(eq(UserSessionTable.id, token)).run()
    })
  }

  export function validateSession(token: string): User | undefined {
    const session = Database.use((db) =>
      db.select().from(UserSessionTable).where(eq(UserSessionTable.id, token)).get(),
    )
    if (!session) return
    if (session.expires_at < Date.now()) {
      logout(token)
      return
    }
    const row = findById(session.user_id)
    if (!row) return
    return { id: row.id, username: row.username, role: row.role }
  }

  export function listUsers(): User[] {
    return Database.use((db) =>
      db
        .select({ id: UserTable.id, username: UserTable.username, role: UserTable.role })
        .from(UserTable)
        .all(),
    )
  }

  export type UserWithMeta = User & {
    created_at: number
    last_login: number | null
  }

  // Like `listUsers` but also returns creation time and last-login time.
  // last_login is the most recent session.time_created for that user (null if
  // the user has never signed in — happens when admin just created them).
  export function listUsersWithMeta(): UserWithMeta[] {
    return Database.use((db) => {
      const users = db
        .select({
          id: UserTable.id,
          username: UserTable.username,
          role: UserTable.role,
          created_at: UserTable.time_created,
        })
        .from(UserTable)
        .all()
      const sessions = db
        .select({
          user_id: UserSessionTable.user_id,
          last_login: sql<number>`MAX(${UserSessionTable.time_created})`.mapWith(Number),
        })
        .from(UserSessionTable)
        .groupBy(UserSessionTable.user_id)
        .all()
      const byUser = new Map(sessions.map((s) => [s.user_id, s.last_login]))
      return users.map((u) => ({ ...u, last_login: byUser.get(u.id) ?? null }))
    })
  }

  export function deleteUser(id: string): void {
    Database.transaction((db) => {
      db.delete(UserTable).where(eq(UserTable.id, id)).run()
    })
  }

  export function changeRole(id: string, role: Role): void {
    Database.transaction((db) => {
      db.update(UserTable).set({ role }).where(eq(UserTable.id, id)).run()
    })
  }

  // The user's configured laptop-bridge endpoint. Returned to the web UI when
  // rendering the settings page, and used by the server to register the MCP
  // server at chat time.
  export type McpConfig = {
    url: string
    token: string
  }

  export function getMcp(id: string): McpConfig | undefined {
    const row = Database.use((db) =>
      db
        .select({ url: UserTable.mcp_url, token: UserTable.mcp_token })
        .from(UserTable)
        .where(eq(UserTable.id, id))
        .get(),
    )
    if (!row || !row.url || !row.token) return undefined
    return { url: row.url, token: row.token }
  }

  export function setMcp(id: string, mcp: McpConfig | null): void {
    Database.transaction((db) => {
      db.update(UserTable)
        .set({ mcp_url: mcp?.url ?? null, mcp_token: mcp?.token ?? null })
        .where(eq(UserTable.id, id))
        .run()
    })
  }

  // Admin-initiated: overwrite a user's password without knowing the old one.
  // Also invalidates all of that user's sessions so they must sign in again.
  export function resetPassword(id: string, newPassword: string): void {
    Database.transaction((db) => {
      db.update(UserTable).set({ password: hashPassword(newPassword) }).where(eq(UserTable.id, id)).run()
      db.delete(UserSessionTable).where(eq(UserSessionTable.user_id, id)).run()
    })
  }

  // User-initiated: change own password after verifying the current one.
  // Returns false if the current password is wrong.
  export function changeOwnPassword(id: string, currentPassword: string, newPassword: string): boolean {
    const row = findById(id)
    if (!row) return false
    if (!verifyPassword(currentPassword, row.password)) return false
    Database.transaction((db) => {
      db.update(UserTable).set({ password: hashPassword(newPassword) }).where(eq(UserTable.id, id)).run()
    })
    return true
  }

  // Thrown by `create` when the username already exists.
  export class UsernameTakenError extends Error {
    constructor(username: string) {
      super(`Username "${username}" is already taken`)
      this.name = "UsernameTakenError"
    }
  }

  export function extractToken(authHeader: string | undefined): string | undefined {
    if (!authHeader?.startsWith("Bearer ")) return
    return authHeader.slice(7)
  }
}
