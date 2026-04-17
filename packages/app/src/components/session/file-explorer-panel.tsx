import { createSignal, createResource, For, Show, createMemo, createEffect, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

type FileNode = {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

type FileContent = {
  type: "text" | "binary"
  content: string
  encoding?: "base64"
  mimeType?: string
}

export function FileExplorerPanel() {
  const sdk = useSDK()
  const layout = useLayout()
  const [currentPath, setCurrentPath] = createSignal<string | false>(false)
  const [previewFilePath, setPreviewFilePath] = createSignal<string | false>(false)
  const [breadcrumbs, setBreadcrumbs] = createSignal<string[]>([])
  const [error, setError] = createSignal<string | undefined>()

  // Only start fetching when panel opens
  createEffect(
    on(
      () => layout.fileExplorer.opened(),
      (opened) => {
        if (opened && currentPath() === false) {
          setCurrentPath(".")
        }
      },
    ),
  )

  const [files, { refetch }] = createResource(currentPath, async (path) => {
    if (path === false) return []
    setError(undefined)
    const res = await sdk.client.file.list({ path }).catch((err: unknown) => {
      console.error("[file-explorer] list failed", err)
      setError("Failed to load files")
      return undefined
    })
    return (res?.data ?? []) as FileNode[]
  })

  const [fileContent] = createResource(previewFilePath, async (path) => {
    if (path === false) return undefined
    const res = await sdk.client.file.read({ path }).catch((err: unknown) => {
      console.error("[file-explorer] read failed", err)
      return undefined
    })
    return (res?.data ?? undefined) as FileContent | undefined
  })

  const navigateToDir = (dirPath: string, dirName: string) => {
    setBreadcrumbs((prev) => [...prev, dirName])
    setCurrentPath(dirPath)
    setPreviewFilePath(false)
  }

  const navigateBack = () => {
    const crumbs = breadcrumbs()
    if (crumbs.length === 0) return
    const newCrumbs = crumbs.slice(0, -1)
    setBreadcrumbs(newCrumbs)
    setCurrentPath(newCrumbs.length === 0 ? "." : newCrumbs.join("/"))
    setPreviewFilePath(false)
  }

  const navigateToRoot = () => {
    setBreadcrumbs([])
    setCurrentPath(".")
    setPreviewFilePath(false)
  }

  const closePreview = () => {
    setPreviewFilePath(false)
  }

  const opened = () => layout.fileExplorer.opened()
  const panelWidth = createMemo(() => (opened() ? `${layout.fileExplorer.width()}px` : "0px"))
  const previewing = () => previewFilePath() !== false

  return (
    <Show when={typeof window !== "undefined" && typeof document !== "undefined"}>
      <aside
        id="file-explorer-panel"
        aria-label="File Explorer"
        aria-hidden={!opened()}
        inert={!opened()}
        class="relative min-w-0 h-full flex shrink-0 overflow-hidden bg-background-base"
        classList={{
          "pointer-events-none": !opened(),
          "transition-[width] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
            true,
        }}
        style={{ width: panelWidth() }}
      >
        <div
          class="h-full flex flex-col border-l border-border-weaker-base overflow-hidden"
          style={{ "min-width": `${layout.fileExplorer.width()}px` }}
        >
          {/* Header */}
          <div class="shrink-0 flex items-center justify-between px-3 h-10 border-b border-border-base">
            <div class="flex items-center gap-2 min-w-0">
              <Show when={previewing()}>
                <Button
                  variant="ghost"
                  class="titlebar-icon w-6 h-6 p-0 box-border shrink-0"
                  onClick={closePreview}
                  aria-label="Back to file list"
                >
                  <Icon size="small" name="chevron-left" />
                </Button>
              </Show>
              <Show when={!previewing() && breadcrumbs().length > 0}>
                <Button
                  variant="ghost"
                  class="titlebar-icon w-6 h-6 p-0 box-border shrink-0"
                  onClick={navigateBack}
                  aria-label="Go back"
                >
                  <Icon size="small" name="chevron-left" />
                </Button>
              </Show>
              <span class="text-12-medium text-text-strong truncate">
                {previewing()
                  ? (previewFilePath() as string).split("/").pop()
                  : "Files"}
              </span>
            </div>
            <Button
              variant="ghost"
              class="titlebar-icon w-6 h-6 p-0 box-border shrink-0"
              onClick={() => layout.fileExplorer.close()}
              aria-label="Close file explorer"
            >
              <Icon size="small" name="close-small" />
            </Button>
          </div>

          {/* Breadcrumbs */}
          <Show when={!previewing() && breadcrumbs().length > 0}>
            <div class="shrink-0 flex items-center gap-1 px-3 py-1.5 text-11-regular text-text-weak border-b border-border-base overflow-x-auto">
              <button
                class="shrink-0 hover:text-text-strong transition-colors cursor-pointer bg-transparent border-none p-0"
                onClick={navigateToRoot}
              >
                ~
              </button>
              <For each={breadcrumbs()}>
                {(crumb, index) => (
                  <>
                    <span class="shrink-0 text-text-weaker">/</span>
                    <button
                      class="shrink-0 hover:text-text-strong transition-colors truncate max-w-[120px] cursor-pointer bg-transparent border-none p-0"
                      classList={{ "text-text-base": index() === breadcrumbs().length - 1 }}
                      onClick={() => {
                        const newCrumbs = breadcrumbs().slice(0, index() + 1)
                        setBreadcrumbs(newCrumbs)
                        setCurrentPath(newCrumbs.join("/"))
                        setPreviewFilePath(false)
                      }}
                    >
                      {crumb}
                    </button>
                  </>
                )}
              </For>
            </div>
          </Show>

          {/* Content */}
          <div class="flex-1 min-h-0 overflow-y-auto">
            <Show when={previewing()} fallback={<FileList />}>
              <FilePreview />
            </Show>
          </div>
        </div>
      </aside>
    </Show>
  )

  function FileList() {
    return (
      <>
        <Show when={error()}>
          {(err) => (
            <div class="flex flex-col items-center justify-center py-8 gap-2">
              <span class="text-12-regular text-text-weak">{err()}</span>
              <Button variant="ghost" onClick={() => refetch()} class="text-12-regular">
                Retry
              </Button>
            </div>
          )}
        </Show>
        <Show when={!error()}>
          <Show
            when={!files.loading}
            fallback={
              <div class="flex items-center justify-center py-8">
                <span class="text-12-regular text-text-weak">Loading...</span>
              </div>
            }
          >
            <Show
              when={(files() ?? []).length > 0}
              fallback={
                <div class="flex items-center justify-center py-8">
                  <span class="text-12-regular text-text-weak">No files</span>
                </div>
              }
            >
              <div class="flex flex-col py-1">
                <For each={files()}>
                  {(file) => (
                    <button
                      class="flex items-center gap-2.5 px-3 py-1.5 hover:bg-surface-base transition-colors text-left w-full group cursor-pointer bg-transparent border-none"
                      onClick={() => {
                        if (file.type === "directory") {
                          navigateToDir(file.path, file.name)
                        } else {
                          setPreviewFilePath(file.path)
                        }
                      }}
                    >
                      <div class="flex items-center justify-center w-4 h-4 shrink-0">
                        <Icon
                          size="small"
                          name={file.type === "directory" ? "folder" : "code-lines"}
                          class={file.type === "directory" ? "text-accent-base" : "text-icon-weak"}
                        />
                      </div>
                      <span
                        class="text-12-regular truncate"
                        classList={{
                          "text-text-strong": file.type === "directory",
                          "text-text-base": file.type === "file",
                        }}
                      >
                        {file.name}
                      </span>
                      <Show when={file.type === "directory"}>
                        <Icon
                          size="small"
                          name="chevron-right"
                          class="text-icon-weaker ml-auto opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        />
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </>
    )
  }

  function FilePreview() {
    return (
      <Show
        when={!fileContent.loading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <span class="text-12-regular text-text-weak">Loading preview...</span>
          </div>
        }
      >
        <Show
          when={fileContent()}
          fallback={
            <div class="flex items-center justify-center py-8">
              <span class="text-12-regular text-text-weak">Unable to preview this file</span>
            </div>
          }
        >
          {(content) => (
            <Show
              when={content().type === "text"}
              fallback={
                <Show
                  when={content().encoding === "base64" && content().mimeType?.startsWith("image/")}
                  fallback={
                    <div class="flex flex-col items-center justify-center py-8 gap-2">
                      <Icon name="code-lines" size="large" class="text-icon-weak" />
                      <span class="text-12-regular text-text-weak">Binary file</span>
                    </div>
                  }
                >
                  <div class="p-3">
                    <img
                      src={`data:${content().mimeType};base64,${content().content}`}
                      alt={previewFilePath() !== false ? (previewFilePath() as string).split("/").pop() : ""}
                      class="max-w-full rounded-lg border border-border-base"
                    />
                  </div>
                </Show>
              }
            >
              <pre class="p-3 text-11-regular text-text-base font-mono whitespace-pre-wrap break-words overflow-x-auto">
                {content().content}
              </pre>
            </Show>
          )}
        </Show>
      </Show>
    )
  }
}
