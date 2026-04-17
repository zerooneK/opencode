import { createSignal, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useAuth } from "@/context/auth"
import { Splash } from "@opencode-ai/ui/logo"

export default function LoginPage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [error, setError] = createSignal<string | undefined>()
  const [loading, setLoading] = createSignal(false)

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    setError(undefined)
    setLoading(true)
    const err = await auth.login(username(), password())
    setLoading(false)
    if (err) {
      setError(err)
      return
    }
    navigate("/", { replace: true })
  }

  return (
    <div class="h-dvh w-screen flex items-center justify-center bg-background-base">
      <div class="flex flex-col items-center w-full max-w-sm px-6">
        {/* Logo */}
        <div class="mb-8 flex flex-col items-center gap-3">
          <Splash class="w-12 h-15" />
          <div class="text-center">
            <h1 class="text-16-medium text-text-strong">OpenCode</h1>
            <p class="mt-1 text-13-regular text-text-weak">Sign in to continue</p>
          </div>
        </div>

        {/* Card */}
        <div class="w-full rounded-xl border border-border-base bg-surface-base p-6 shadow-sm">
          <form onSubmit={handleSubmit} class="flex flex-col gap-4">
            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-base" for="username">
                Username
              </label>
              <input
                id="username"
                type="text"
                autocomplete="username"
                required
                autofocus
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                placeholder="Enter your username"
              />
            </div>

            <div class="flex flex-col gap-1.5">
              <label class="text-12-medium text-text-base" for="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autocomplete="current-password"
                required
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full rounded-lg border border-border-base bg-background-base px-3 py-2 text-13-regular text-text-strong placeholder:text-text-weak outline-none transition-colors focus:border-accent-base"
                placeholder="Enter your password"
              />
            </div>

            <Show when={error()}>
              <div class="rounded-lg bg-red-500/10 px-3 py-2">
                <p class="text-12-regular text-red-500">{error()}</p>
              </div>
            </Show>

            <button
              type="submit"
              disabled={loading()}
              class="mt-1 w-full rounded-lg bg-neutral-800 px-4 py-2.5 text-13-medium text-white transition-opacity hover:bg-neutral-700 disabled:opacity-50"
            >
              {loading() ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
