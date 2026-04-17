import { createSignal, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { useAuth } from "@/context/auth"

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
    <div class="flex min-h-screen items-center justify-center bg-bg-base">
      <div class="w-full max-w-sm rounded-lg border border-border-base bg-bg-muted p-8 shadow-sm">
        <div class="mb-8 text-center">
          <h1 class="text-20-medium text-text-strong">OpenCode</h1>
          <p class="mt-1 text-13-regular text-text-muted">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-13-medium text-text-base" for="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              autocomplete="username"
              required
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
              class="rounded-md border border-border-base bg-bg-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-accent-base"
              placeholder="Enter your username"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-13-medium text-text-base" for="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autocomplete="current-password"
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              class="rounded-md border border-border-base bg-bg-base px-3 py-2 text-13-regular text-text-strong outline-none focus:border-accent-base"
              placeholder="Enter your password"
            />
          </div>

          <Show when={error()}>
            <p class="text-12-regular text-red-500">{error()}</p>
          </Show>

          <button
            type="submit"
            disabled={loading()}
            class="mt-2 rounded-md bg-accent-base px-4 py-2 text-13-medium text-white disabled:opacity-50"
          >
            {loading() ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  )
}
