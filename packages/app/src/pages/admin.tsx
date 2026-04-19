import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Splash } from "@opencode-ai/ui/logo"
import { useAuth } from "@/context/auth"

const DAY_MS = 24 * 60 * 60 * 1000

function formatRelative(ts: number | null): string {
  if (!ts) return "Never"
  const diff = Date.now() - ts
  if (diff < 60_000) return "Just now"
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / (60 * 60_000))}h ago`
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)}d ago`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type DialogState =
  | { kind: "none" }
  | { kind: "delete"; userId: string; username: string }
  | { kind: "resetPassword"; userId: string; username: string }
  | { kind: "changeOwnPassword" }

const asDelete = (s: DialogState) => (s.kind === "delete" ? s : null)
const asResetPassword = (s: DialogState) => (s.kind === "resetPassword" ? s : null)

export default function AdminPage() {
  const auth = useAuth()
  const navigate = useNavigate()

  createEffect(() => {
    if (!auth.store.loading && auth.store.user?.role !== "admin") {
      navigate("/", { replace: true })
    }
  })

  const [users, { refetch }] = createResource(() => auth.listUsers())
  const [search, setSearch] = createSignal("")

  const filteredUsers = createMemo(() => {
    const list = users() ?? []
    const q = search().trim().toLowerCase()
    if (!q) return list
    return list.filter((u) => u.username.toLowerCase().includes(q))
  })

  const stats = createMemo(() => {
    const list = users() ?? []
    const activeToday = list.filter((u) => u.last_login && Date.now() - u.last_login < DAY_MS).length
    const totalWorkspaces = list.reduce((sum, u) => sum + u.workspaceCount, 0)
    return { total: list.length, activeToday, totalWorkspaces }
  })

  const [newUsername, setNewUsername] = createSignal("")
  const [newPassword, setNewPassword] = createSignal("")
  const [newRole, setNewRole] = createSignal<"admin" | "user">("user")
  const [createError, setCreateError] = createSignal<string | undefined>()
  const [createSuccess, setCreateSuccess] = createSignal<string | undefined>()
  const [creating, setCreating] = createSignal(false)

  const [dialog, setDialog] = createSignal<DialogState>({ kind: "none" })
  const [dialogError, setDialogError] = createSignal<string | undefined>()
  const [dialogBusy, setDialogBusy] = createSignal(false)
  const [resetPasswordValue, setResetPasswordValue] = createSignal("")
  const [currentPasswordValue, setCurrentPasswordValue] = createSignal("")
  const [newPasswordValue, setNewPasswordValue] = createSignal("")

  const openDialog = (state: DialogState) => {
    setDialogError(undefined)
    setResetPasswordValue("")
    setCurrentPasswordValue("")
    setNewPasswordValue("")
    setDialog(state)
  }

  const closeDialog = () => {
    if (dialogBusy()) return
    setDialog({ kind: "none" })
  }

  const handleCreate = async (e: Event) => {
    e.preventDefault()
    setCreateError(undefined)
    setCreateSuccess(undefined)
    setCreating(true)
    const err = await auth.createUser(newUsername(), newPassword(), newRole())
    setCreating(false)
    if (err) {
      setCreateError(err)
      return
    }
    setCreateSuccess(`User "${newUsername()}" created successfully.`)
    setNewUsername("")
    setNewPassword("")
    setNewRole("user")
    refetch()
  }

  const handleRoleChange = async (id: string, role: "admin" | "user") => {
    await auth.changeRole(id, role)
    refetch()
  }

  const handleConfirmDelete = async () => {
    const state = dialog()
    if (state.kind !== "delete") return
    setDialogBusy(true)
    setDialogError(undefined)
    const ok = await auth.deleteUser(state.userId)
    setDialogBusy(false)
    if (!ok) {
      setDialogError("Failed to remove user")
      return
    }
    setDialog({ kind: "none" })
    refetch()
  }

  const handleConfirmResetPassword = async () => {
    const state = dialog()
    if (state.kind !== "resetPassword") return
    if (resetPasswordValue().length < 6) {
      setDialogError("Password must be at least 6 characters")
      return
    }
    setDialogBusy(true)
    setDialogError(undefined)
    const err = await auth.resetUserPassword(state.userId, resetPasswordValue())
    setDialogBusy(false)
    if (err) {
      setDialogError(err)
      return
    }
    setDialog({ kind: "none" })
  }

  const handleConfirmChangeOwnPassword = async () => {
    if (newPasswordValue().length < 6) {
      setDialogError("New password must be at least 6 characters")
      return
    }
    setDialogBusy(true)
    setDialogError(undefined)
    const err = await auth.changeOwnPassword(currentPasswordValue(), newPasswordValue())
    setDialogBusy(false)
    if (err) {
      setDialogError(err)
      return
    }
    setDialog({ kind: "none" })
  }

  return (
    <div class="h-dvh w-screen bg-background-base overflow-y-auto">
      <div class="mx-auto max-w-2xl px-6 py-12">
        {/* Header */}
        <div class="mb-8 flex flex-col items-center gap-3">
          <Splash class="w-10 h-12" />
          <div class="text-center">
            <h1 class="text-16-medium text-text-strong">User Management</h1>
            <p class="mt-1 text-13-regular text-text-weak">Manage accounts and roles</p>
          </div>
        </div>

        {/* Self-account card */}
        <Show when={auth.store.user}>
          {(me) => (
            <div class="w-full rounded-xl border border-border-base bg-surface-base shadow-sm mb-6">
              <div class="px-5 py-3.5 border-b border-border-base">
                <p class="text-13-medium text-text-strong">My account</p>
              </div>
              <div class="flex items-center justify-between px-5 py-3">
                <div class="flex items-center gap-3 min-w-0">
                  <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-base text-12-medium text-white uppercase">
                    {me().username.charAt(0)}
                  </div>
                  <div class="min-w-0">
                    <p class="text-13-medium text-text-strong truncate">{me().username}</p>
                    <p class="text-11-regular text-text-weak">Administrator</p>
                  </div>
                </div>
                <button
                  onClick={() => openDialog({ kind: "changeOwnPassword" })}
                  class="h-7 rounded-lg border border-border-base bg-background-base px-2.5 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover"
                >
                  Change password
                </button>
              </div>
            </div>
          )}
        </Show>

        {/* Stats bar */}
        <Show when={users()}>
          <div class="w-full grid grid-cols-3 gap-3 mb-6">
            <div class="rounded-xl border border-border-base bg-surface-base px-4 py-3">
              <p class="text-11-regular text-text-weak">Users</p>
              <p class="text-16-medium text-text-strong mt-0.5">{stats().total}</p>
            </div>
            <div class="rounded-xl border border-border-base bg-surface-base px-4 py-3">
              <p class="text-11-regular text-text-weak">Active today</p>
              <p class="text-16-medium text-text-strong mt-0.5">{stats().activeToday}</p>
            </div>
            <div class="rounded-xl border border-border-base bg-surface-base px-4 py-3">
              <p class="text-11-regular text-text-weak">Workspaces</p>
              <p class="text-16-medium text-text-strong mt-0.5">{stats().totalWorkspaces}</p>
            </div>
          </div>
        </Show>

        {/* User list card */}
        <div class="w-full rounded-xl border border-border-base bg-surface-base shadow-sm mb-6">
          <div class="px-5 py-3.5 border-b border-border-base">
            <div class="flex items-center justify-between gap-3">
              <p class="text-13-medium text-text-strong shrink-0">Users</p>
              <input
                type="search"
                placeholder="Search username..."
                value={search()}
                onInput={(e) => setSearch(e.currentTarget.value)}
                class="h-7 max-w-48 rounded-lg border border-border-base bg-background-base px-2.5 text-12-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
              />
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
            <Show
              when={filteredUsers().length > 0}
              fallback={
                <div class="px-5 py-8 flex items-center justify-center">
                  <p class="text-13-regular text-text-weak">No users match "{search()}"</p>
                </div>
              }
            >
              <div class="divide-y divide-border-base">
                <For each={filteredUsers()}>
                  {(user) => (
                    <div class="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-raised-base-hover">
                      <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          class="flex size-8 shrink-0 items-center justify-center rounded-full text-12-medium text-white uppercase"
                          classList={{
                            "bg-accent-base": user.role === "admin",
                            "bg-neutral-500": user.role !== "admin",
                          }}
                        >
                          {user.username.charAt(0)}
                        </div>
                        <div class="min-w-0 flex-1">
                          <p class="text-13-medium text-text-strong truncate">{user.username}</p>
                          <p class="text-11-regular text-text-weak">
                            {user.role === "admin" ? "Administrator" : "User"}
                            <span class="mx-1.5">·</span>
                            {user.workspaceCount} {user.workspaceCount === 1 ? "workspace" : "workspaces"}
                            <span class="mx-1.5">·</span>
                            Last active {formatRelative(user.last_login)}
                            <span class="mx-1.5">·</span>
                            Joined {formatDate(user.created_at)}
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
                            onClick={() =>
                              openDialog({ kind: "resetPassword", userId: user.id, username: user.username })
                            }
                            class="h-7 rounded-lg border border-border-base bg-background-base px-2.5 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover"
                          >
                            Reset password
                          </button>
                          <button
                            onClick={() =>
                              openDialog({ kind: "delete", userId: user.id, username: user.username })
                            }
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

              <Show when={createError()}>
                <div class="rounded-lg bg-red-500/10 px-3 py-2">
                  <p class="text-12-regular text-red-500">{createError()}</p>
                </div>
              </Show>

              <Show when={createSuccess()}>
                <div class="rounded-lg bg-green-500/10 px-3 py-2">
                  <p class="text-12-regular text-green-500">{createSuccess()}</p>
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

      {/* Modal overlay */}
      <Show when={dialog().kind !== "none"}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={closeDialog}
        >
          <div
            class="w-full max-w-sm rounded-xl border border-border-base bg-surface-base shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={asDelete(dialog())}>
              {(state) => (
                <div class="p-5 flex flex-col gap-4">
                  <div>
                    <h2 class="text-14-medium text-text-strong">Remove user?</h2>
                    <p class="mt-2 text-13-regular text-text-weak leading-relaxed">
                      This will permanently delete the account "<strong>{state().username}</strong>". Their workspace folder will be renamed to{" "}
                      <code class="text-text-base">{state().username}_deleted_YYYY-MM-DD</code> so no files are lost.
                    </p>
                  </div>
                  <Show when={dialogError()}>
                    <div class="rounded-lg bg-red-500/10 px-3 py-2">
                      <p class="text-12-regular text-red-500">{dialogError()}</p>
                    </div>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <button
                      onClick={closeDialog}
                      disabled={dialogBusy()}
                      class="h-8 rounded-lg border border-border-base bg-background-base px-3 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmDelete}
                      disabled={dialogBusy()}
                      class="h-8 rounded-lg bg-red-500 px-3 text-12-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                    >
                      {dialogBusy() ? "Removing..." : "Remove user"}
                    </button>
                  </div>
                </div>
              )}
            </Show>

            <Show when={asResetPassword(dialog())}>
              {(state) => (
                <div class="p-5 flex flex-col gap-4">
                  <div>
                    <h2 class="text-14-medium text-text-strong">Reset password</h2>
                    <p class="mt-2 text-13-regular text-text-weak leading-relaxed">
                      Set a new password for "<strong>{state().username}</strong>". They will be signed out and must use this new password to log back in.
                    </p>
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label class="text-12-medium text-text-base" for="reset-password">
                      New password
                    </label>
                    <input
                      id="reset-password"
                      type="password"
                      placeholder="Minimum 6 characters"
                      minLength={6}
                      value={resetPasswordValue()}
                      onInput={(e) => setResetPasswordValue(e.currentTarget.value)}
                      class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                    />
                  </div>
                  <Show when={dialogError()}>
                    <div class="rounded-lg bg-red-500/10 px-3 py-2">
                      <p class="text-12-regular text-red-500">{dialogError()}</p>
                    </div>
                  </Show>
                  <div class="flex justify-end gap-2">
                    <button
                      onClick={closeDialog}
                      disabled={dialogBusy()}
                      class="h-8 rounded-lg border border-border-base bg-background-base px-3 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmResetPassword}
                      disabled={dialogBusy()}
                      class="h-8 rounded-lg bg-neutral-800 px-3 text-12-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
                    >
                      {dialogBusy() ? "Saving..." : "Reset password"}
                    </button>
                  </div>
                </div>
              )}
            </Show>

            <Show when={dialog().kind === "changeOwnPassword"}>
              <div class="p-5 flex flex-col gap-4">
                <div>
                  <h2 class="text-14-medium text-text-strong">Change my password</h2>
                  <p class="mt-2 text-13-regular text-text-weak leading-relaxed">
                    Enter your current password, then pick a new one.
                  </p>
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-12-medium text-text-base" for="current-password">
                    Current password
                  </label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPasswordValue()}
                    onInput={(e) => setCurrentPasswordValue(e.currentTarget.value)}
                    class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-12-medium text-text-base" for="new-password-own">
                    New password
                  </label>
                  <input
                    id="new-password-own"
                    type="password"
                    placeholder="Minimum 6 characters"
                    minLength={6}
                    value={newPasswordValue()}
                    onInput={(e) => setNewPasswordValue(e.currentTarget.value)}
                    class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                  />
                </div>
                <Show when={dialogError()}>
                  <div class="rounded-lg bg-red-500/10 px-3 py-2">
                    <p class="text-12-regular text-red-500">{dialogError()}</p>
                  </div>
                </Show>
                <div class="flex justify-end gap-2">
                  <button
                    onClick={closeDialog}
                    disabled={dialogBusy()}
                    class="h-8 rounded-lg border border-border-base bg-background-base px-3 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmChangeOwnPassword}
                    disabled={dialogBusy()}
                    class="h-8 rounded-lg bg-neutral-800 px-3 text-12-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {dialogBusy() ? "Saving..." : "Change password"}
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
