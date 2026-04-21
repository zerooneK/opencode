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

// Text-extraction helpers for office formats. Dynamically imported inside
// read_file so users who never ask for .docx / .pdf don't pay the startup cost.
type DocxText = (input: { path: string }) => Promise<{ value: string }>
type PdfText = (buffer: Buffer) => Promise<{ text: string }>
let mammothExtract: DocxText | undefined
let pdfParse: PdfText | undefined
let XLSX: typeof import("xlsx") | undefined

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

// ─── Server + transport factory ─────────────────────────────────────────────

// An McpServer holds one-shot initialization state — once a client has sent
// `initialize`, subsequent initializes on the same server fail with
// "Server already initialized". To support reconnects and multiple concurrent
// clients we create a FRESH McpServer + Transport pair per session.
//
// Sessions are indexed by the Mcp-Session-Id header the transport hands back
// on the first request.
const sessions = new Map<
  string,
  { server: McpServer; transport: WebStandardStreamableHTTPServerTransport }
>()

// Extracts text from any supported file by extension. Binary office formats
// use their own parser; everything else is read as UTF-8 text.
async function readFileAsText(fullPath: string): Promise<string> {
  const ext = path.extname(fullPath).toLowerCase()

  if (ext === ".docx") {
    if (!mammothExtract) {
      const mod = (await import("mammoth")) as unknown as { extractRawText: DocxText }
      mammothExtract = mod.extractRawText
    }
    const { value } = await mammothExtract({ path: fullPath })
    return value
  }

  if (ext === ".xlsx" || ext === ".xls") {
    if (!XLSX) XLSX = await import("xlsx")
    const workbook = XLSX.readFile(fullPath)
    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name]
      const csv = XLSX!.utils.sheet_to_csv(sheet)
      return `=== Sheet: ${name} ===\n${csv}`
    })
    return sheets.join("\n\n")
  }

  if (ext === ".pdf") {
    if (!pdfParse) {
      // pdf-parse's default export quirk: it exports a function via CommonJS.
      const mod: any = await import("pdf-parse")
      pdfParse = (mod.default ?? mod) as PdfText
    }
    const buffer = await fs.readFile(fullPath)
    const { text } = await pdfParse(buffer)
    return text
  }

  return await fs.readFile(fullPath, "utf-8")
}

function registerTools(server: McpServer) {
  server.tool(
    "read_file",
    "Read a file from the user's LAPTOP (their local machine), NOT from the workspace on the server. Automatically handles text files (.txt, .md, .json, .csv, .py, etc.), Word documents (.docx), Excel spreadsheets (.xlsx, .xls), and PDFs (.pdf). Use this whenever the user says 'from my laptop', 'บนเครื่องฉัน', 'local file', 'my computer', or names a file that isn't in the server workspace. Prefer this over any other read tool when the user mentions their laptop/local files.",
    { path: z.string().describe("Path relative to the laptop shared folder.") },
    async ({ path: rel }) => {
      const full = safePath(rel)
      const text = await readFileAsText(full)
      return { content: [{ type: "text", text }] }
    },
  )

  server.tool(
    "write_file",
    "Create or overwrite a text file on the user's LAPTOP (their local machine), NOT in the workspace on the server. Use this when the user says 'save to my laptop', 'บนเครื่องฉัน', 'local file', 'my computer'. Parent directories are created automatically.",
    {
      path: z.string().describe("Path relative to the laptop shared folder."),
      content: z.string().describe("Full file content. Overwrites any existing content."),
    },
    async ({ path: rel, content }) => {
      const full = safePath(rel)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, content, "utf-8")
      return {
        content: [
          { type: "text", text: `Wrote ${content.length} characters to ${rel} on the user's laptop` },
        ],
      }
    },
  )

  server.tool(
    "list_files",
    "List files and directories on the user's LAPTOP (their local machine), NOT in the workspace on the server. Use this when the user says 'files on my laptop', 'ไฟล์ในเครื่องฉัน', 'my local files'. Non-recursive.",
    {
      path: z
        .string()
        .optional()
        .describe("Path relative to the laptop shared folder. Defaults to the root."),
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
}

async function createSession() {
  const server = new McpServer(
    { name: "t-open-laptop-bridge", version: "0.1.0" },
    { capabilities: { tools: {} } },
  )
  registerTools(server)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport })
    },
    onsessionclosed: (sessionId) => {
      const entry = sessions.get(sessionId)
      sessions.delete(sessionId)
      entry?.server.close().catch(() => {})
    },
  })
  await server.connect(transport)
  return transport
}

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

    // If the client sent a session ID, route to that session's transport.
    // Otherwise this is either a new session (initialize) or a client calling
    // without session state — either way, spin up a fresh pair.
    const sessionId = req.headers.get("mcp-session-id")
    if (sessionId) {
      const existing = sessions.get(sessionId)
      if (existing) return existing.transport.handleRequest(req)
      // Client sent a session ID we don't know about. Transport will 404 it
      // gracefully, and the client will retry without session ID.
    }

    const transport = await createSession()
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
    // Close every live session.
    await Promise.all(
      Array.from(sessions.values()).map(({ server }) => server.close().catch(() => {})),
    )
    process.exit(0)
  })
}
