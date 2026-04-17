import { createEffect, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Splash } from "@opencode-ai/ui/logo"
import { useAuth } from "@/context/auth"

export default function AdminPage() {
  const auth = useAuth()
  const navigate = useNavigate()

  // Reactively redirect non-admins (also handles the case where auth finishes loading after mount)
  createEffect(() => {
    if (!auth.store.loading && auth.store.user?.role !== "admin") {
      navigate("/", { replace: true })
    }
  })

  const [users, { refetch }] = createResource(() => auth.listUsers())
  const [newUsername, setNewUsername] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [newRole, setNewRole] = createSignal<"admin" | "user">("user")
  const [error, setError] = createSignal<string | undefined>()
  const [success, setSuccess] = createSignal<string | undefined>()
  const [creating, setCreating] = createSignal(false)

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    setError(undefined)
    setSuccess(undefined)
    setCreating(true)
    const ok = await auth.createUser(newUsername(), newPassword(), newRole())
    setCreating(false)
    if (!ok) {
      setError("Failed to create user. Username may already exist.")
      return
    }
    setSuccess(`User "${newUsername()}" created successfully.`)
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
    <div class="h-dvh w-screen bg-background-base overflow-y-auto">
      <div class="mx-auto max-w-lg px-6 py-12">
        {/* Header */}
        <div class="mb-8 flex flex-col items-center gap-3">
          <Splash class="w-10 h-12" />
          <div class="text-center">
            <h1 class="text-16-medium text-text-strong">User Management</h1>
            <p class="mt-1 text-13-regular text-text-weak">Manage accounts and roles</p>
          </div>
        </div>

        {/* User list card */}
        <div class="w-full rounded-xl border border-border-base bg-surface-base shadow-sm mb-6">
          <div class="px-5 py-3.5 border-b border-border-base">
            <div class="flex items-center justify-between">
              <p class="text-13-medium text-text-strong">Users</p>
              <Show when={users()}>
                <span class="text-12-regular text-text-weak">{users()!.length} total</span>
              </Show>
            </div>
          </div>

          <Show
            when={users()}
            fallback={
              <div class="px-5 py-8 flex items-center justify-center">
                <p class="text-13-regular text-text-weak">Loading users...</p>
              </div>
            }
          >
            <div class="divide-y divide-border-base">
              <For each={users()}>
                {(user) => (
                  <div class="flex items-center justify-between px-5 py-3 transition-colors hover:bg-surface-raised-base-hover">
                    <div class="flex items-center gap-3 min-w-0">
                      {/* Avatar circle */}
                      <div
                        class="flex size-8 shrink-0 items-center justify-center rounded-full text-12-medium text-white uppercase"
                        classList={{
                          "bg-accent-base": user.role === "admin",
                          "bg-neutral-500": user.role !== "admin",
                        }}
                      >
                        {user.username.charAt(0)}
                      </div>
                      <div class="min-w-0">
                        <p class="text-13-medium text-text-strong truncate">{user.username}</p>
                        <p class="text-11-regular text-text-weak">
                          {user.role === "admin" ? "Administrator" : "User"}
                        </p>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <Show
                        when={user.id !== auth.store.user?.id}
                        fallback={
                          <span class="rounded-full bg-accent-base/10 px-2.5 py-0.5 text-11-medium text-accent-base">
                            You
                          </span>
                        }
                      >
                        <select
                          value={user.role}
                          onChange={(e) => handleRoleChange(user.id, e.currentTarget.value as "admin" | "user")}
                          class="h-7 rounded-lg border border-border-base bg-background-base px-2 text-12-regular text-text-base outline-none transition-colors focus:border-accent-base cursor-pointer"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          onClick={() => handleDelete(user.id)}
                          class="h-7 rounded-lg border border-red-500/20 bg-red-500/5 px-2.5 text-12-medium text-red-500 transition-colors hover:bg-red-500/10 hover:border-red-500/30"
                        >
                          Remove
                        </button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Create user card */}
        <div class="w-full rounded-xl border border-border-base bg-surface-base shadow-sm">
          <div class="px-5 py-3.5 border-b border-border-base">
            <p class="text-13-medium text-text-strong">Add New User</p>
          </div>
          <div class="p-5">
            <form onSubmit={handleCreate} class="flex flex-col gap-4">
              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-base" for="new-username">
                  Username
                </label>
                <input
                  id="new-username"
                  type="text"
                  placeholder="Enter username"
                  required
                  value={newUsername()}
                  onInput={(e) => setNewUsername(e.currentTarget.value)}
                  class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-base" for="new-password">
                  Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  placeholder="Minimum 6 characters"
                  required
                  minLength={6}
                  value={newPassword()}
                  onInput={(e) => setNewPassword(e.currentTarget.value)}
                  class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                />
              </div>

              <div class="flex flex-col gap-1.5">
                <label class="text-12-medium text-text-base" for="new-role">
                  Role
                </label>
                <select
                  id="new-role"
                  value={newRole()}
                  onChange={(e) => setNewRole(e.currentTarget.value as "admin" | "user")}
                  class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-base outline-none transition-colors focus:border-accent-base cursor-pointer"
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <Show when={error()}>
                <div class="rounded-lg bg-red-500/10 px-3 py-2">
                  <p class="text-12-regular text-red-500">{error()}</p>
                </div>
              </Show>

              <Show when={success()}>
                <div class="rounded-lg bg-green-500/10 px-3 py-2">
                  <p class="text-12-regular text-green-500">{success()}</p>
                </div>
              </Show>

              <button
                type="submit"
                disabled={creating()}
                class="mt-1 w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-13-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
              >
                {creating() ? "Creating..." : "Create User"}
              </button>
            </form>
          </div>
        </div>

        {/* Back link */}
        <div class="mt-6 flex justify-center">
          <button
            onClick={() => navigate("/")}
            class="text-13-regular text-text-weak transition-colors hover:text-text-base"
          >
            &larr; Back to app
          </button>
        </div>
      </div>
    </div>
  )
}
