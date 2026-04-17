import { createSignal, createResource, For, Show, createMemo, createEffect, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useLayout } from "@/context/layout"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"

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
    <Show when={typeof window !== "undefined"}>
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
          class="h-full flex flex-col overflow-hidden border-l border-border-weaker-base"
          style={{ "min-width": `${layout.fileExplorer.width()}px` }}
        >
          {/* Header — matches file tree panel header style */}
          <div class="shrink-0 flex items-center gap-2 px-3 h-[37px] border-b border-border-base">
            <Show when={previewing() || breadcrumbs().length > 0}>
              <IconButton
                icon="chevron-left"
                variant="ghost"
                class="h-5 w-5"
                onClick={() => (previewing() ? closePreview() : navigateBack())}
                aria-label="Go back"
              />
            </Show>
            <span class="text-12-medium text-text-strong truncate flex-1">
              {previewing()
                ? (previewFilePath() as string).split("/").pop()
                : "Files"}
            </span>
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-5 w-5"
              onClick={() => layout.fileExplorer.close()}
              aria-label="Close file explorer"
            />
          </div>

          {/* Breadcrumbs */}
          <Show when={!previewing() && breadcrumbs().length > 0}>
            <div class="shrink-0 flex items-center gap-1 px-3 py-1.5 text-11-regular text-text-weak border-b border-border-base overflow-x-auto">
              <button
                class="shrink-0 hover:text-text-strong transition-colors cursor-pointer bg-transparent border-none p-0 text-11-regular text-text-weak"
                onClick={navigateToRoot}
              >
                ~
              </button>
              <For each={breadcrumbs()}>
                {(crumb, index) => (
                  <>
                    <span class="shrink-0 text-text-weaker">/</span>
                    <button
                      class="shrink-0 hover:text-text-strong transition-colors truncate max-w-[120px] cursor-pointer bg-transparent border-none p-0 text-11-regular"
                      classList={{
                        "text-text-base": index() === breadcrumbs().length - 1,
                        "text-text-weak": index() !== breadcrumbs().length - 1,
                      }}
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

          {/* Content area — matches bg-background-stronger like file tree */}
          <div class="flex-1 min-h-0 overflow-y-auto bg-background-stronger">
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
            <div class="flex flex-col items-center justify-center py-8 gap-2 px-3">
              <span class="text-12-regular text-text-weak">{err()}</span>
              <button
                class="text-12-regular text-accent-base hover:underline cursor-pointer bg-transparent border-none p-0"
                onClick={() => refetch()}
              >
                Retry
              </button>
            </div>
          )}
        </Show>
        <Show when={!error()}>
          <Show
            when={!files.loading}
            fallback={
              <div class="px-3 py-2 text-12-regular text-text-weak">Loading...</div>
            }
          >
            <Show
              when={(files() ?? []).length > 0}
              fallback={
                <div class="h-full flex flex-col">
                  <div class="h-6 shrink-0" aria-hidden />
                  <div class="flex-1 pb-64 flex items-center justify-center text-center">
                    <div class="text-12-regular text-text-weak">No files</div>
                  </div>
                </div>
              }
            >
              <div class="flex flex-col pt-3 px-3">
                <For each={files()}>
                  {(file) => (
                    <button
                      class="flex items-center gap-2 py-1 hover:bg-surface-base transition-colors text-left w-full cursor-pointer bg-transparent border-none px-1 rounded-md"
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
                          class="text-icon-weaker ml-auto shrink-0"
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
          <div class="px-3 py-2 text-12-regular text-text-weak">Loading preview...</div>
        }
      >
        <Show
          when={fileContent()}
          fallback={
            <div class="h-full flex flex-col">
              <div class="h-6 shrink-0" aria-hidden />
              <div class="flex-1 pb-64 flex items-center justify-center text-center">
                <div class="text-12-regular text-text-weak">Unable to preview this file</div>
              </div>
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
                    <div class="h-full flex flex-col">
                      <div class="h-6 shrink-0" aria-hidden />
                      <div class="flex-1 pb-64 flex items-center justify-center text-center">
                        <div class="text-12-regular text-text-weak">Binary file</div>
                      </div>
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
