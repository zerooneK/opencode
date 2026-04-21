import { Component, createEffect, createResource, createSignal, Match, Show, Switch } from "solid-js"
import { useAuth } from "@/context/auth"

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; serverName: string }
  | { kind: "error"; message: string }

export const SettingsMcp: Component = () => {
  const auth = useAuth()

  const [stored, { refetch }] = createResource(() => auth.getMcp())
  const [url, setUrl] = createSignal("")
  const [token, setToken] = createSignal("")
  const [savedMessage, setSavedMessage] = createSignal<string | undefined>()
  const [saveError, setSaveError] = createSignal<string | undefined>()
  const [saving, setSaving] = createSignal(false)
  const [testState, setTestState] = createSignal<TestState>({ kind: "idle" })

  // When the fetched config loads, pre-fill the inputs so the user sees their
  // current settings. Done inside createEffect so we re-sync whenever the
  // resource resolves or refetches.
  createEffect(() => {
    const current = stored()
    if (!current) return
    setUrl(current.url)
    setToken(current.token)
  })

  const handleTest = async () => {
    setTestState({ kind: "testing" })
    const result = await auth.testMcp(url().trim(), token().trim())
    if (result.ok) {
      setTestState({ kind: "ok", serverName: result.serverName ?? "" })
      return
    }
    setTestState({ kind: "error", message: result.error ?? "Test failed" })
  }

  const handleSave = async () => {
    setSavedMessage(undefined)
    setSaveError(undefined)
    setSaving(true)
    const err = await auth.saveMcp(url().trim(), token().trim())
    setSaving(false)
    if (err) {
      setSaveError(err)
      return
    }
    setSavedMessage("Saved. Your laptop bridge is now active.")
    refetch()
  }

  const handleClear = async () => {
    setSavedMessage(undefined)
    setSaveError(undefined)
    setSaving(true)
    const err = await auth.clearMcp()
    setSaving(false)
    if (err) {
      setSaveError(err)
      return
    }
    setUrl("")
    setToken("")
    setTestState({ kind: "idle" })
    setSavedMessage("Cleared.")
    refetch()
  }

  return (
    <div class="flex flex-col gap-6 p-6 overflow-y-auto">
      <div>
        <h2 class="text-16-medium text-text-strong">My Laptop</h2>
        <p class="mt-2 text-13-regular text-text-weak leading-relaxed">
          Let the AI read and write files in a folder on your laptop while you chat. Run the laptop
          bridge script, then paste the URL and token below.
        </p>
      </div>

      <div class="rounded-xl border border-border-base bg-surface-base px-5 py-4">
        <div class="flex flex-col gap-1 mb-3">
          <p class="text-13-medium text-text-strong">How to run the bridge</p>
        </div>
        <ol class="list-decimal list-inside text-13-regular text-text-base leading-relaxed space-y-1">
          <li>Make sure Bun is installed on your laptop.</li>
          <li>
            Download or copy <code class="text-12-regular">bridge.ts</code> from{" "}
            <code class="text-12-regular">packages/laptop-bridge/</code>.
          </li>
          <li>
            Open a terminal and run:{" "}
            <code class="text-12-regular text-text-strong">bun bridge.ts ~/Documents</code>
          </li>
          <li>Copy the URL and Token it prints into the fields below.</li>
          <li>Keep the terminal open while you chat.</li>
        </ol>
      </div>

      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-base" for="mcp-url">
            Bridge URL
          </label>
          <input
            id="mcp-url"
            type="url"
            placeholder="http://192.168.1.47:3928/mcp"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-12-medium text-text-base" for="mcp-token">
            Token
          </label>
          <input
            id="mcp-token"
            type="text"
            placeholder="Printed by the bridge"
            value={token()}
            onInput={(e) => setToken(e.currentTarget.value)}
            class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base font-mono"
          />
        </div>

        <div class="flex items-center gap-2">
          <button
            onClick={handleTest}
            disabled={!url() || !token() || testState().kind === "testing"}
            class="h-8 rounded-lg border border-border-base bg-background-base px-3 text-12-medium text-text-base transition-colors hover:bg-surface-raised-base-hover disabled:opacity-50"
          >
            {testState().kind === "testing" ? "Testing..." : "Test connection"}
          </button>
          <button
            onClick={handleSave}
            disabled={!url() || !token() || saving()}
            class="h-8 rounded-lg bg-neutral-800 px-3 text-12-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
          >
            {saving() ? "Saving..." : "Save"}
          </button>
          <Show when={stored()}>
            <button
              onClick={handleClear}
              disabled={saving()}
              class="h-8 rounded-lg border border-red-500/20 bg-red-500/5 px-3 text-12-medium text-red-500 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Disconnect
            </button>
          </Show>
        </div>

        <Switch>
          <Match when={testState().kind === "ok"}>
            <div class="rounded-lg bg-green-500/10 px-3 py-2">
              <p class="text-12-regular text-green-500">
                ✓ Connected{" "}
                <Show
                  when={
                    testState().kind === "ok" &&
                    (testState() as Extract<TestState, { kind: "ok" }>).serverName
                  }
                >
                  <span class="text-text-weak">
                    ({(testState() as Extract<TestState, { kind: "ok" }>).serverName})
                  </span>
                </Show>
              </p>
            </div>
          </Match>
          <Match when={testState().kind === "error"}>
            <div class="rounded-lg bg-red-500/10 px-3 py-2">
              <p class="text-12-regular text-red-500">
                ✗ {(testState() as Extract<TestState, { kind: "error" }>).message}
              </p>
            </div>
          </Match>
        </Switch>

        <Show when={savedMessage()}>
          <div class="rounded-lg bg-green-500/10 px-3 py-2">
            <p class="text-12-regular text-green-500">{savedMessage()}</p>
          </div>
        </Show>

        <Show when={saveError()}>
          <div class="rounded-lg bg-red-500/10 px-3 py-2">
            <p class="text-12-regular text-red-500">{saveError()}</p>
          </div>
        </Show>
      </div>

      <div class="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p class="text-12-regular text-amber-600 leading-relaxed">
          <strong>Windows Firewall:</strong> first time you run the bridge, Windows may pop up a
          security prompt. Click <strong>Allow access</strong> so the server can reach your laptop.
        </p>
      </div>
    </div>
  )
}
