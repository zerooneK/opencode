import fs from "node:fs/promises"
import path from "node:path"

function inside(root: string, candidate: string) {
  const withSep = root.endsWith(path.sep) ? root : root + path.sep
  return candidate === root || candidate.startsWith(withSep)
}

function escaped(rel: string): never {
  throw new Error(`Path escapes the shared folder: ${rel}`)
}

function normalize(root: string, rel: string) {
  return path.resolve(root, rel.replace(/^\/+/, ""))
}

function missing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

export async function resolveSharedRoot(input: string) {
  const real = await fs.realpath(input)
  const stat = await fs.stat(real)
  if (!stat.isDirectory()) throw new Error(`Folder does not exist or is not a directory: ${input}`)
  return real
}

export async function resolveSharedExistingPath(root: string, rel: string) {
  const real = await fs.realpath(normalize(root, rel))
  if (!inside(root, real)) escaped(rel)
  return real
}

export async function resolveSharedWritePath(root: string, rel: string) {
  const resolved = normalize(root, rel)
  const target = await fs.realpath(resolved).catch((error) => {
    if (missing(error)) return
    throw error
  })
  if (target) {
    if (!inside(root, target)) escaped(rel)
    return target
  }

  let current = path.dirname(resolved)
  while (true) {
    const parent = await fs.realpath(current).catch((error) => {
      if (missing(error)) return
      throw error
    })
    if (parent) {
      if (!inside(root, parent)) escaped(rel)
      return path.join(parent, path.relative(current, resolved))
    }
    const next = path.dirname(current)
    if (next === current) escaped(rel)
    current = next
  }
}
