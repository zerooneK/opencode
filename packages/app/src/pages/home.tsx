import { createMemo, createResource, createSignal, For, Match, Show, Switch } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { useLayout } from "@/context/layout"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/shared/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { usePlatform } from "@/context/platform"
import { DateTime } from "luxon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { DialogSelectDirectory } from "@/components/dialog-select-directory"
import { DialogSelectServer } from "@/components/dialog-select-server"
import { useServer } from "@/context/server"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useAuth } from "@/context/auth"

export default function Home() {
  const sync = useGlobalSync()
  const layout = useLayout()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const server = useServer()
  const language = useLanguage()
  const auth = useAuth()
  const homedir = createMemo(() => sync.data.path.home)
  const isRegularUser = createMemo(() => auth.store.user?.role === "user")

  const [workspaces, { refetch: refetchWorkspaces }] = createResource(
    () => isRegularUser(),
    () => auth.listWorkspaces(),
  )

  const [newWorkspaceName, setNewWorkspaceName] = createSignal("")
  const [creatingWorkspace, setCreatingWorkspace] = createSignal(false)
  const [workspaceError, setWorkspaceError] = createSignal<string | undefined>()
  const [showNewWorkspaceForm, setShowNewWorkspaceForm] = createSignal(false)

  const handleCreateWorkspace = async (e: Event) => {
    e.preventDefault()
    setWorkspaceError(undefined)
    setCreatingWorkspace(true)
    const result = await auth.createWorkspace(newWorkspaceName())
    setCreatingWorkspace(false)
    if (!result) {
      setWorkspaceError("Failed to create workspace. Name may already exist.")
      return
    }
    setNewWorkspaceName("")
    setShowNewWorkspaceForm(false)
    refetchWorkspaces()
    openProject(result.path)
  }
  const recent = createMemo(() => {
    return sync.data.project
      .slice()
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
      .slice(0, 5)
  })

  const serverDotClass = createMemo(() => {
    const healthy = server.healthy()
    if (healthy === true) return "bg-icon-success-base"
    if (healthy === false) return "bg-icon-critical-base"
    return "bg-border-weak-base"
  })

  function openProject(directory: string) {
    layout.projects.open(directory)
    server.projects.touch(directory)
    navigate(`/${base64Encode(directory)}`)
  }

  async function chooseProject() {
    function resolve(result: string | string[] | null) {
      if (Array.isArray(result)) {
        for (const directory of result) {
          openProject(directory)
        }
      } else if (result) {
        openProject(result)
      }
    }

    if (platform.openDirectoryPickerDialog && server.isLocal()) {
      const result = await platform.openDirectoryPickerDialog?.({
        title: language.t("command.project.open"),
        multiple: true,
      })
      resolve(result)
    } else {
      dialog.show(
        () => <DialogSelectDirectory multiple={true} onSelect={resolve} />,
        () => resolve(null),
      )
    }
  }

  return (
    <div class="mx-auto mt-55 w-full md:w-auto px-4">
      <Logo class="md:w-xl opacity-12" />
      <Button
        size="large"
        variant="ghost"
        class="mt-4 mx-auto text-14-regular text-text-weak"
        onClick={() => dialog.show(() => <DialogSelectServer />)}
      >
        <div
          classList={{
            "size-2 rounded-full": true,
            [serverDotClass()]: true,
          }}
        />
        {server.name}
      </Button>

      {/* Regular user: show their workspaces */}
      <Show when={isRegularUser()}>
        <div class="mt-20 w-full flex flex-col gap-4">
          <div class="flex gap-2 items-center justify-between pl-3">
            <div class="text-14-medium text-text-strong">My Workspaces</div>
            <Button
              icon="folder-add-left"
              size="normal"
              class="pl-2 pr-3"
              onClick={() => setShowNewWorkspaceForm(!showNewWorkspaceForm())}
            >
              New Workspace
            </Button>
          </div>

          {/* New workspace form */}
          <Show when={showNewWorkspaceForm()}>
            <div class="rounded-xl border border-border-base bg-surface-base p-4 shadow-sm">
              <form onSubmit={handleCreateWorkspace} class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-12-medium text-text-base" for="workspace-name">
                    Workspace Name
                  </label>
                  <input
                    id="workspace-name"
                    type="text"
                    required
                    autofocus
                    placeholder="e.g. my-project"
                    value={newWorkspaceName()}
                    onInput={(e) => setNewWorkspaceName(e.currentTarget.value)}
                    class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                  />
                  <p class="text-11-regular text-text-weak">Letters, numbers, hyphens and underscores only</p>
                </div>
                <Show when={workspaceError()}>
                  <div class="rounded-lg bg-red-500/10 px-3 py-2">
                    <p class="text-12-regular text-red-500">{workspaceError()}</p>
                  </div>
                </Show>
                <div class="flex gap-2 justify-end">
                  <Button variant="ghost" size="normal" onClick={() => setShowNewWorkspaceForm(false)}>
                    Cancel
                  </Button>
                  <button
                    type="submit"
                    disabled={creatingWorkspace()}
                    class="rounded-lg bg-neutral-800 px-4 py-2 text-13-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
                  >
                    {creatingWorkspace() ? "Creating..." : "Create"}
                  </button>
                </div>
              </form>
            </div>
          </Show>

          {/* Workspace list */}
          <Show
            when={workspaces() && workspaces()!.length > 0}
            fallback={
              <div class="flex flex-col items-center gap-2 py-8">
                <Icon name="folder-add-left" size="large" />
                <p class="text-13-regular text-text-weak">No workspaces yet. Create one to get started.</p>
              </div>
            }
          >
            <ul class="flex flex-col gap-2">
              <For each={workspaces()}>
                {(workspace) => (
                  <Button
                    size="large"
                    variant="ghost"
                    class="text-14-mono text-left justify-between px-3"
                    onClick={() => openProject(workspace.path)}
                  >
                    <div class="flex items-center gap-2">
                      <Icon name="folder" size="small" />
                      {workspace.name}
                    </div>
                  </Button>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </Show>

      {/* Admin: show original project list */}
      <Show when={!isRegularUser()}>
        <Switch>
          <Match when={sync.data.project.length > 0}>
            <div class="mt-20 w-full flex flex-col gap-4">
              <div class="flex gap-2 items-center justify-between pl-3">
                <div class="text-14-medium text-text-strong">{language.t("home.recentProjects")}</div>
                <Button icon="folder-add-left" size="normal" class="pl-2 pr-3" onClick={chooseProject}>
                  {language.t("command.project.open")}
                </Button>
              </div>
              <ul class="flex flex-col gap-2">
                <For each={recent()}>
                  {(project) => (
                    <Button
                      size="large"
                      variant="ghost"
                      class="text-14-mono text-left justify-between px-3"
                      onClick={() => openProject(project.worktree)}
                    >
                      {project.worktree.replace(homedir(), "~")}
                      <div class="text-14-regular text-text-weak">
                        {DateTime.fromMillis(project.time.updated ?? project.time.created).toRelative()}
                      </div>
                    </Button>
                  )}
                </For>
              </ul>
            </div>
          </Match>
          <Match when={!sync.ready}>
            <div class="mt-30 mx-auto flex flex-col items-center gap-3">
              <div class="text-12-regular text-text-weak">{language.t("common.loading")}</div>
              <Button class="px-3" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
          <Match when={true}>
            <div class="mt-30 mx-auto flex flex-col items-center gap-3">
              <Icon name="folder-add-left" size="large" />
              <div class="flex flex-col gap-1 items-center justify-center">
                <div class="text-14-medium text-text-strong">{language.t("home.empty.title")}</div>
                <div class="text-12-regular text-text-weak">{language.t("home.empty.description")}</div>
              </div>
              <Button class="px-3 mt-1" onClick={chooseProject}>
                {language.t("command.project.open")}
              </Button>
            </div>
          </Match>
        </Switch>
      </Show>
    </div>
  )
}
