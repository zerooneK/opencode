import { createContext, useContext, createResource, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useServer } from "./server"

type User = {
  id: string
  username: string
  role: "admin" | "user"
  workspaceDir?: string
  defaultWorkspace?: string
}

export type UserListItem = {
  id: string
  username: string
  role: "admin" | "user"
  created_at: number
  last_login: number | null
  workspaceCount: number
}

type AuthStore = {
  user: User | null
  token: string | null
  loading: boolean
}

const TOKEN_KEY = "opencode-user-token"

function AuthContext() {
  const server = useServer()
  const apiUrl = () => server.current?.http.url ?? ""

  const [store, setStore] = createStore<AuthStore>({
    user: null,
    token: localStorage.getItem(TOKEN_KEY),
    loading: true,
  })

  const authFetch = (path: string, opts: RequestInit = {}) =>
    fetch(`${apiUrl()}${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(store.token ? { Authorization: `Bearer ${store.token}` } : {}),
        ...(opts.headers as Record<string, string> | undefined),
      },
    })

  // Validate existing token on startup — but only once the server URL is known.
  // If we validate before the server context is ready, apiUrl() returns "" and the
  // request hits the Vite dev server instead of the backend, which causes the token
  // to be incorrectly deleted from localStorage.
  const [_init] = createResource(apiUrl, async (url) => {
    if (!url) return
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setStore("loading", false)
      return
    }
    const res = await authFetch("/user/me")
    if (!res.ok) {
      localStorage.removeItem(TOKEN_KEY)
      setStore({ user: null, token: null, loading: false })
      return
    }
    const data = (await res.json()) as User & { workspaceDir?: string; defaultWorkspace?: string }
    const user: User = { id: data.id, username: data.username, role: data.role, workspaceDir: data.workspaceDir, defaultWorkspace: data.defaultWorkspace }
    setStore({ user, loading: false })
  })

  const login = async (username: string, password: string): Promise<string | undefined> => {
    const res = await fetch(`${apiUrl()}/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
      const data = (await res.json()) as { error?: string }
      return data.error ?? "Login failed"
    }
    const data = (await res.json()) as { token: string; user: User; workspaceDir?: string; defaultWorkspace?: string }
    localStorage.setItem(TOKEN_KEY, data.token)
    const user = { ...data.user, workspaceDir: data.workspaceDir, defaultWorkspace: data.defaultWorkspace }
    setStore({ user, token: data.token, loading: false })
    return undefined
  }

  const logout = async () => {
    await authFetch("/user/logout", { method: "POST" }).catch(() => {})
    localStorage.removeItem(TOKEN_KEY)
    // Clear every app-owned localStorage key (global + per-workspace) so the
    // next user never sees the previous user's sidebar, layout, or cached data.
    clearAppLocalStorage()
    // Full page reload to reset all in-memory SolidJS stores. Without this,
    // providers like ServerProvider (mounted above the auth Show gate) still
    // hold the previous user's data in memory even after localStorage is cleared.
    window.location.replace("/login")
  }

  // Remove every key persisted by the app. Based on the storage prefixes in
  // utils/persist.ts: Persist.global uses "opencode.global.dat:", workspace
  // stores use "opencode.workspace.<head>.<sum>.dat:", legacy used "default.dat:".
  const clearAppLocalStorage = () => {
    const prefixes = ["opencode.global.dat:", "opencode.workspace.", "default.dat:"]
    const victims: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (prefixes.some((prefix) => key.startsWith(prefix))) victims.push(key)
    }
    for (const key of victims) {
      try {
        localStorage.removeItem(key)
      } catch {}
    }
  }

  const listUsers = async (): Promise<UserListItem[]> => {
    const res = await authFetch("/user/list")
    if (!res.ok) return []
    return res.json() as Promise<UserListItem[]>
  }

  // Returns undefined on success, or a user-facing error message on failure.
  const createUser = async (
    username: string,
    password: string,
    role: "admin" | "user",
  ): Promise<string | undefined> => {
    const res = await authFetch("/user/create", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    })
    if (res.ok) return undefined
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return body?.error ?? `Failed to create user (HTTP ${res.status})`
  }

  const deleteUser = async (id: string) => {
    const res = await authFetch(`/user/${id}`, { method: "DELETE" })
    return res.ok
  }

  const changeRole = async (id: string, role: "admin" | "user") => {
    const res = await authFetch(`/user/${id}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    })
    return res.ok
  }

  // Admin sets a new password for a user. The user's existing sessions are
  // invalidated server-side so they must sign in again.
  const resetUserPassword = async (id: string, newPassword: string): Promise<string | undefined> => {
    const res = await authFetch(`/user/${id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password: newPassword }),
    })
    if (res.ok) return undefined
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return body?.error ?? `Failed to reset password (HTTP ${res.status})`
  }

  // Current user changes their own password. Server verifies the current one.
  const changeOwnPassword = async (
    currentPassword: string,
    newPassword: string,
  ): Promise<string | undefined> => {
    const res = await authFetch("/user/me/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    if (res.ok) return undefined
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    return body?.error ?? `Failed to change password (HTTP ${res.status})`
  }

  const listWorkspaces = async (): Promise<Array<{ name: string; path: string }>> => {
    const res = await authFetch("/user/workspaces")
    if (!res.ok) return []
    return res.json() as Promise<Array<{ name: string; path: string }>>
  }

  const createWorkspace = async (name: string): Promise<{ name: string; path: string } | undefined> => {
    const res = await authFetch("/user/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return undefined
    return res.json() as Promise<{ name: string; path: string }>
  }

  return {
    store,
    login,
    logout,
    listUsers,
    createUser,
    deleteUser,
    changeRole,
    resetUserPassword,
    changeOwnPassword,
    listWorkspaces,
    createWorkspace,
  }
}

type AuthContextType = ReturnType<typeof AuthContext>
const ctx = createContext<AuthContextType>()

export function AuthProvider(props: ParentProps) {
  const value = AuthContext()
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>
}

export function useAuth() {
  const value = useContext(ctx)
  if (!value) throw new Error("useAuth must be used within AuthProvider")
  return value
}
