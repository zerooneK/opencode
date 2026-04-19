import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Effect } from "effect"
import { execFile } from "child_process"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"
import z from "zod"

const execFileP = promisify(execFile)
import { AppRuntime } from "../../effect/app-runtime"
import { File } from "../../file"
import { Ripgrep } from "../../file/ripgrep"
import { LSP } from "../../lsp"
import { Instance } from "../../project/instance"
import { lazy } from "../../util/lazy"

export const FileRoutes = lazy(() =>
  new Hono()
    .get(
      "/find",
      describeRoute({
        summary: "Find text",
        description: "Search for text patterns across files in the project using ripgrep.",
        operationId: "find.text",
        responses: {
          200: {
            description: "Matches",
            content: {
              "application/json": {
                schema: resolver(Ripgrep.Match.shape.data.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          pattern: z.string(),
        }),
      ),
      async (c) => {
        const pattern = c.req.valid("query").pattern
        const result = await AppRuntime.runPromise(
          Ripgrep.Service.use((svc) => svc.search({ cwd: Instance.directory, pattern, limit: 10 })),
        )
        return c.json(result.items)
      },
    )
    .get(
      "/find/file",
      describeRoute({
        summary: "Find files",
        description: "Search for files or directories by name or pattern in the project directory.",
        operationId: "find.files",
        responses: {
          200: {
            description: "File paths",
            content: {
              "application/json": {
                schema: resolver(z.string().array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
          dirs: z.enum(["true", "false"]).optional(),
          type: z.enum(["file", "directory"]).optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query").query
        const dirs = c.req.valid("query").dirs
        const type = c.req.valid("query").type
        const limit = c.req.valid("query").limit
        const results = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) =>
              svc.search({
                query,
                limit: limit ?? 10,
                dirs: dirs !== "false",
                type,
              }),
            )
          }),
        )
        return c.json(results)
      },
    )
    .get(
      "/find/symbol",
      describeRoute({
        summary: "Find symbols",
        description: "Search for workspace symbols like functions, classes, and variables using LSP.",
        operationId: "find.symbols",
        responses: {
          200: {
            description: "Symbols",
            content: {
              "application/json": {
                schema: resolver(LSP.Symbol.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          query: z.string(),
        }),
      ),
      async (c) => {
        return c.json([])
      },
    )
    .get(
      "/file",
      describeRoute({
        summary: "List files",
        description: "List files and directories in a specified path.",
        operationId: "file.list",
        responses: {
          200: {
            description: "Files and directories",
            content: {
              "application/json": {
                schema: resolver(File.Node.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.list(path))
          }),
        )
        return c.json(content)
      },
    )
    .get(
      "/file/content",
      describeRoute({
        summary: "Read file",
        description: "Read the content of a specified file.",
        operationId: "file.read",
        responses: {
          200: {
            description: "File content",
            content: {
              "application/json": {
                schema: resolver(File.Content),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const path = c.req.valid("query").path
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.read(path))
          }),
        )
        return c.json(content)
      },
    )
    .get(
      "/file/download",
      describeRoute({
        summary: "Download file as raw bytes",
        description: "Return the raw bytes of a file with an attachment Content-Disposition header.",
        operationId: "file.download",
        responses: {
          200: {
            description: "File bytes",
            content: {
              "application/octet-stream": {
                schema: { type: "string", format: "binary" },
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const filePath = c.req.valid("query").path
        const full = path.join(Instance.directory, filePath)

        if (!Instance.containsPath(full)) {
          return c.json({ error: "Access denied: path escapes project directory" }, 403)
        }

        const bytes = await fs.readFile(full).catch(() => null)
        if (!bytes) {
          return c.json({ error: "File not found" }, 404)
        }

        const name = path.basename(filePath)
        return new Response(bytes as unknown as BodyInit, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
            "Content-Length": String(bytes.byteLength),
          },
        })
      },
    )
    .get(
      "/file/preview",
      describeRoute({
        summary: "Convert an office document to HTML for preview",
        description: "Use pandoc to convert .docx files to HTML. Returns HTML string with embedded images.",
        operationId: "file.preview",
        responses: {
          200: {
            description: "HTML preview",
            content: {
              "text/html": {
                schema: { type: "string" },
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          path: z.string(),
        }),
      ),
      async (c) => {
        const filePath = c.req.valid("query").path
        const full = path.join(Instance.directory, filePath)

        if (!Instance.containsPath(full)) {
          return c.json({ error: "Access denied: path escapes project directory" }, 403)
        }

        const stat = await fs.stat(full).catch(() => null)
        if (!stat || !stat.isFile()) {
          return c.json({ error: "File not found" }, 404)
        }

        const ext = path.extname(full).toLowerCase()
        if (ext !== ".docx") {
          return c.json({ error: "Unsupported file type — preview is only available for .docx" }, 400)
        }

        // pandoc 2.19+ uses `--embed-resources --standalone`. Older versions
        // (e.g. pandoc 2.9 shipped with Ubuntu 22.04) only understand the
        // older `--self-contained` flag. Try the modern flags first; on
        // "Unknown option" fall back to `--self-contained`.
        const runPandoc = async (args: string[]) =>
          execFileP("pandoc", args, { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 })

        try {
          let result: Awaited<ReturnType<typeof runPandoc>>
          try {
            result = await runPandoc([full, "--from=docx", "--to=html5", "--embed-resources", "--standalone"])
          } catch (err) {
            const message = err instanceof Error ? err.message : ""
            if (message.includes("Unknown option")) {
              result = await runPandoc([full, "--from=docx", "--to=html5", "--self-contained"])
            } else {
              throw err
            }
          }
          return new Response(result.stdout, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message.includes("ENOENT")
                ? "pandoc is not installed on the server"
                : err.message
              : "Preview failed"
          return c.json({ error: message }, 500)
        }
      },
    )
    .get(
      "/file/status",
      describeRoute({
        summary: "Get file status",
        description: "Get the git status of all files in the project.",
        operationId: "file.status",
        responses: {
          200: {
            description: "File status",
            content: {
              "application/json": {
                schema: resolver(File.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const content = await AppRuntime.runPromise(
          Effect.gen(function* () {
            return yield* File.Service.use((svc) => svc.status())
          }),
        )
        return c.json(content)
      },
    ),
)
