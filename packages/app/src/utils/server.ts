import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerConnection } from "@/context/server"

const TOKEN_KEY = "opencode-user-token"

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const basicAuth = (() => {
    if (!server.password) return
    return `Basic ${btoa(`${server.username ?? "opencode"}:${server.password}`)}`
  })()

  const baseFetch = config.fetch ?? globalThis.fetch.bind(globalThis)
  const authenticatedFetch: typeof fetch = (input, init) => {
    const isRequest = input instanceof Request
    const headers = isRequest ? new Headers((input as Request).headers) : new Headers(init?.headers)
    if (!headers.has("Authorization")) {
      const userToken = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null
      if (userToken) headers.set("Authorization", `Bearer ${userToken}`)
      else if (basicAuth) headers.set("Authorization", basicAuth)
    }
    if (isRequest) return baseFetch(new Request(input as Request, { headers }))
    return baseFetch(input, { ...init, headers })
  }

  const staticHeaders = {
    ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
  }

  return createOpencodeClient({
    ...config,
    fetch: authenticatedFetch,
    headers: staticHeaders,
    baseUrl: server.url,
  })
}
