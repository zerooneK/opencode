import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resolveSharedExistingPath, resolveSharedRoot, resolveSharedWritePath } from "./path"

async function tmpdir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "laptop-bridge-"))
  return {
    dir,
    async [Symbol.asyncDispose]() {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

const linkType = process.platform === "win32" ? "junction" : "dir"

describe("laptop-bridge path safety", () => {
  test("allows a normal file inside the shared folder", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.dir, "root"), { recursive: true })
    await fs.writeFile(path.join(tmp.dir, "root", "note.txt"), "ok")

    const root = await resolveSharedRoot(path.join(tmp.dir, "root"))
    expect(await resolveSharedExistingPath(root, "note.txt")).toBe(path.join(root, "note.txt"))
  })

  test("rejects reading through a symlink that points outside the shared folder", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.dir, "root"), { recursive: true })
    await fs.mkdir(path.join(tmp.dir, "outside"), { recursive: true })
    await fs.writeFile(path.join(tmp.dir, "outside", "secret.txt"), "secret")
    await fs.symlink(path.join(tmp.dir, "outside"), path.join(tmp.dir, "root", "link"), linkType)

    const root = await resolveSharedRoot(path.join(tmp.dir, "root"))
    await expect(resolveSharedExistingPath(root, "link/secret.txt")).rejects.toThrow(
      "Path escapes the shared folder: link/secret.txt",
    )
  })

  test("rejects writing through a symlink that points outside the shared folder", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.dir, "root"), { recursive: true })
    await fs.mkdir(path.join(tmp.dir, "outside"), { recursive: true })
    await fs.symlink(path.join(tmp.dir, "outside"), path.join(tmp.dir, "root", "link"), linkType)

    const root = await resolveSharedRoot(path.join(tmp.dir, "root"))
    await expect(resolveSharedWritePath(root, "link/new.txt")).rejects.toThrow(
      "Path escapes the shared folder: link/new.txt",
    )
  })

  test("allows writing a new nested file inside the shared folder", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.dir, "root"), { recursive: true })

    const root = await resolveSharedRoot(path.join(tmp.dir, "root"))
    expect(await resolveSharedWritePath(root, "nested/new.txt")).toBe(path.join(root, "nested", "new.txt"))
  })
})
