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
    await authFetch("/user/logout", { method: "POST" })
    localStorage.removeItem(TOKEN_KEY)
    setStore({ user: null, token: null, loading: false })
  }

  const listUsers = async (): Promise<User[]> => {
    const res = await authFetch("/user/list")
    if (!res.ok) return []
    return res.json() as Promise<User[]>
  }

  const createUser = async (username: string, password: string, role: "admin" | "user") => {
    const res = await authFetch("/user/create", {
      method: "POST",
      body: JSON.stringify({ username, password, role }),
    })
    return res.ok
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

  return { store, login, logout, listUsers, createUser, deleteUser, changeRole, listWorkspaces, createWorkspace }
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
