import { createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useAuth } from "@/context/auth"

export default function AdminPage() {
  const auth = useAuth()
  const navigate = useNavigate()

  // Redirect non-admins
  if (auth.store.user?.role !== "admin") {
    navigate("/", { replace: true })
    return null
  }

  const [users, { refetch }] = createResource(() => auth.listUsers())
  const [newUsername, setNewUsername] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [newRole, setNewRole] = createSignal<"admin" | "user">("user")
  const [error, setError] = createSignal<string | undefined>()
  const [creating, setCreating] = createSignal(false)

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    setError(undefined)
    setCreating(true)
    const ok = await auth.createUser(newUsername(), newPassword(), newRole())
    setCreating(false)
    if (!ok) {
      setError("Failed to create user. Username may already exist.")
      return
    }
    setNewUsername("")
    setNewPassword("")
    setNewRole("user")
    refetch()
  }

  const handleDelete = async (id: string) => {
    await auth.deleteUser(id)
    refetch()
  }

  const handleRoleChange = async (id: string, role: "admin" | "user") => {
    await auth.changeRole(id, role)
    refetch()
  }

  return (
    <div class="mx-auto max-w-2xl p-8">
      <div class="mb-6 flex items-center justify-between">
        <h1 class="text-20-medium text-text-strong">User Management</h1>
        <button
          onClick={() => navigate("/")}
          class="text-13-regular text-text-muted hover:text-text-base"
        >
          ← Back
        </button>
      </div>

      {/* User list */}
      <div class="mb-8 rounded-lg border border-border-base bg-bg-muted">
        <div class="border-b border-border-base px-4 py-3">
          <p class="text-13-medium text-text-strong">Users</p>
        </div>
        <Show when={users()} fallback={<p class="px-4 py-3 text-13-regular text-text-muted">Loading...</p>}>
          <For each={users()}>
            {(user) => (
              <div class="flex items-center justify-between border-b border-border-base px-4 py-3 last:border-0">
                <div class="flex items-center gap-3">
                  <span class="text-13-medium text-text-strong">{user.username}</span>
                  <span class="text-12-regular text-text-muted">{user.role}</span>
                </div>
                <div class="flex items-center gap-2">
                  <Show when={user.id !== auth.store.user?.id}>
                    <select
                      value={user.role}
                      onChange={(e) => handleRoleChange(user.id, e.currentTarget.value as "admin" | "user")}
                      class="rounded border border-border-base bg-bg-base px-2 py-1 text-12-regular text-text-base"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      onClick={() => handleDelete(user.id)}
                      class="text-12-regular text-red-500 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </Show>
                  <Show when={user.id === auth.store.user?.id}>
                    <span class="text-12-regular text-text-muted">You</span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Create user form */}
      <div class="rounded-lg border border-border-base bg-bg-muted p-4">
        <p class="mb-4 text-13-medium text-text-strong">Add New User</p>
        <form onSubmit={handleCreate} class="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Username"
            required
            value={newUsername()}
            onInput={(e) => setNewUsername(e.currentTarget.value)}
            class="rounded-md border border-border-base bg-bg-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-accent-base"
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            required
            minLength={6}
            value={newPassword()}
            onInput={(e) => setNewPassword(e.currentTarget.value)}
            class="rounded-md border border-border-base bg-bg-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-accent-base"
          />
          <select
            value={newRole()}
            onChange={(e) => setNewRole(e.currentTarget.value as "admin" | "user")}
            class="rounded-md border border-border-base bg-bg-base px-3 py-2 text-13-regular text-text-base"
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
          <Show when={error()}>
            <p class="text-12-regular text-red-500">{error()}</p>
          </Show>
          <button
            type="submit"
            disabled={creating()}
            class="rounded-md bg-accent-base px-4 py-2 text-13-medium text-white disabled:opacity-50"
          >
            {creating() ? "Creating..." : "Create User"}
          </button>
        </form>
      </div>
    </div>
  )
}
