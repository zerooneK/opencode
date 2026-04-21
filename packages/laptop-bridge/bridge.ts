#!/usr/bin/env bun
/**
 * T-Open Workspace — Laptop Bridge
 *
 * Exposes ONE folder on your laptop to the T-Open Workspace server so the AI
 * can read/write/list files there while you chat. Uses the MCP protocol over
 * HTTP. Requires a bearer token — only the server that knows the token can
 * read your files.
 *
 * Run it like:
 *   bun bridge.ts ~/Documents
 *   bun bridge.ts ~/Documents --port 3928
 *
 * The script prints a URL and token. Paste both into Settings in the web UI.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { z } from "zod"

// ─── CLI args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
  console.log(`
T-Open Workspace — Laptop Bridge

Usage:
  bun bridge.ts <folder> [--port <number>]

Examples:
  bun bridge.ts ~/Documents
  bun bridge.ts ~/Documents --port 3928

The folder you pick is the ONLY place the AI can read/write. Nothing else on
your laptop is exposed.
`)
  process.exit(args.length === 0 ? 1 : 0)
}

const folderArg = args[0]
const portIdx = args.indexOf("--port")
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 3928
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port: ${args[portIdx + 1]}`)
  process.exit(1)
}

const rootFolder = path.resolve(folderArg.replace(/^~\//, `${os.homedir()}/`))
const rootStat = await fs.stat(rootFolder).catch(() => null)
if (!rootStat || !rootStat.isDirectory()) {
  console.error(`Folder does not exist or is not a directory: ${rootFolder}`)
  process.exit(1)
}

// ─── Token ──────────────────────────────────────────────────────────────────

const token = randomBytes(12).toString("base64url")

// ─── Path safety ────────────────────────────────────────────────────────────

/**
 * Resolve `rel` relative to the shared folder and refuse anything that
 * escapes it (via `..`, absolute paths, symlinks pointing outside, etc).
 */
function safePath(rel: string): string {
  const cleaned = rel.replace(/^\/+/, "")
  const resolved = path.resolve(rootFolder, cleaned)
  const withSep = rootFolder.endsWith(path.sep) ? rootFolder : rootFolder + path.sep
  if (resolved !== rootFolder && !resolved.startsWith(withSep)) {
    throw new Error(`Path escapes the shared folder: ${rel}`)
  }
  return resolved
}

// ─── Tools ──────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "t-open-laptop-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
)

server.tool(
  "read_local_file",
  "Read a text file from the user's local shared folder.",
  { path: z.string().describe("Path relative to the shared folder.") },
  async ({ path: rel }) => {
    const full = safePath(rel)
    const content = await fs.readFile(full, "utf-8")
    return { content: [{ type: "text", text: content }] }
  },
)

server.tool(
  "write_local_file",
  "Create or overwrite a text file in the user's local shared folder. Parent directories are created automatically.",
  {
    path: z.string().describe("Path relative to the shared folder."),
    content: z.string().describe("Full file content. Overwrites any existing content."),
  },
  async ({ path: rel, content }) => {
    const full = safePath(rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf-8")
    return {
      content: [{ type: "text", text: `Wrote ${content.length} characters to ${rel}` }],
    }
  },
)

server.tool(
  "list_local_files",
  "List files and directories inside the shared folder (non-recursive).",
  {
    path: z
      .string()
      .optional()
      .describe("Path relative to the shared folder. Defaults to the root."),
  },
  async ({ path: rel }) => {
    const full = safePath(rel ?? "")
    const entries = await fs.readdir(full, { withFileTypes: true })
    const lines = entries
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map((e) => `${e.isDirectory() ? "[DIR]" : "     "} ${e.name}`)
    return {
      content: [{ type: "text", text: lines.join("\n") || "(empty)" }],
    }
  },
)

// ─── HTTP transport ─────────────────────────────────────────────────────────

// Stateful mode: the transport persists across requests and uses
// Mcp-Session-Id headers. The SDK explicitly forbids reusing a stateless
// transport across requests, and OpenCode's StreamableHTTPClientTransport
// negotiates sessions automatically, so this is the natural fit.
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
  enableJsonResponse: true, // no SSE streams; simple JSON responses
})
await server.connect(transport)

// ─── Bun server ─────────────────────────────────────────────────────────────

const bun = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 })
    }
    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 })
    }

    const auth = req.headers.get("authorization") ?? ""
    if (auth !== `Bearer ${token}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    }

    return transport.handleRequest(req)
  },
})

// ─── Print the connection info ──────────────────────────────────────────────

function pickLanIp(): string {
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.internal) continue
      if (iface.family !== "IPv4") continue
      return iface.address
    }
  }
  return "localhost"
}

const ip = pickLanIp()

console.log(
  [
    "",
    "🌉 T-Open Workspace — Laptop Bridge",
    "",
    `   Folder : ${rootFolder}`,
    `   URL    : http://${ip}:${bun.port}/mcp`,
    `   Token  : ${token}`,
    "",
    "Paste the URL and Token into T-Open Workspace → Settings.",
    "Keep this window open while you want the AI to access this folder.",
    "Press Ctrl+C to stop.",
    "",
  ].join("\n"),
)

// ─── Graceful shutdown ──────────────────────────────────────────────────────

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log("\nShutting down...")
    bun.stop()
    await server.close().catch(() => {})
    process.exit(0)
  })
}
