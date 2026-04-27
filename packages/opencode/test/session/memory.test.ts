import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "../../src/global"
import * as Memory from "../../src/session/memory"

const node = CrossSpawnSpawner.defaultLayer

describe("session.memory", () => {
  let originalConfigPath: string
  let testDir: string

  beforeEach(() => {
    // Create a temp directory for this test using same pattern as fixture
    testDir = path.join(os.tmpdir(), "opencode-memory-test-" + Math.random().toString(36).slice(2))
    originalConfigPath = Global.Path.config
    
    // Override the config path to our test directory
    Object.defineProperty(Global.Path, "config", {
      value: testDir,
      writable: true,
    })
  })

  afterEach(async () => {
    // Restore original config path
    Object.defineProperty(Global.Path, "config", {
      value: originalConfigPath,
      writable: true,
    })

    // Cleanup
    await Bun.$`rm -rf ${testDir}`.nothrow()
  })

  describe("loadMemory", () => {
    it("creates file with default content if missing", async () => {
      const data = await Memory.loadMemory()
      
      expect(data.preferences).toEqual([])
      expect(data.facts).toEqual([])
      
      // Verify file was created
      const file = Bun.file(path.join(testDir, "memory.md"))
      const exists = await file.exists()
      expect(exists).toBe(true)
    })

    it("parses existing preferences and facts", async () => {
      const filepath = path.join(testDir, "memory.md")
      await Bun.write(filepath, `# User Preferences
- Prefers simple explanations
- Uses Bun

# Remembered Facts
- Working on persistent memory
- Testing the memory feature
`)

      const data = await Memory.loadMemory()
      
      expect(data.preferences).toEqual(["Prefers simple explanations", "Uses Bun"])
      expect(data.facts).toEqual(["Working on persistent memory", "Testing the memory feature"])
    })

    it("handles empty sections", async () => {
      const filepath = path.join(testDir, "memory.md")
      await Bun.write(filepath, `# User Preferences

# Remembered Facts
- Some fact
`)

      const data = await Memory.loadMemory()
      
      expect(data.preferences).toEqual([])
      expect(data.facts).toEqual(["Some fact"])
    })

    it("handles malformed file gracefully", async () => {
      const filepath = path.join(testDir, "memory.md")
      await Bun.write(filepath, `This is not valid markdown
random text
no headings
`)

      const data = await Memory.loadMemory()
      
      // Should return empty arrays, not crash
      expect(data.preferences).toEqual([])
      expect(data.facts).toEqual([])
    })
  })

  describe("addItem", () => {
    it("adds a preference", async () => {
      const result = await Memory.addItem("preferences", "Prefers dark mode")
      
      expect(result.success).toBe(true)
      
      const data = await Memory.listMemory()
      expect(data.preferences).toContain("Prefers dark mode")
    })

    it("adds a fact", async () => {
      const result = await Memory.addItem("facts", "Working on the memory feature")
      
      expect(result.success).toBe(true)
      
      const data = await Memory.listMemory()
      expect(data.facts).toContain("Working on the memory feature")
    })

    it("rejects empty content", async () => {
      const result = await Memory.addItem("preferences", "   ")
      
      expect(result.success).toBe(false)
      expect(result.reason).toBe("Content cannot be empty")
    })

    it("skips exact duplicate (case-sensitive)", async () => {
      await Memory.addItem("preferences", "Prefers dark mode")
      const result = await Memory.addItem("preferences", "Prefers dark mode")
      
      expect(result.success).toBe(false)
      expect(result.reason).toBe("Item already exists")
    })

    it("allows similar but different items", async () => {
      await Memory.addItem("preferences", "Prefers dark mode")
      const result = await Memory.addItem("preferences", "Prefers dark mode ")
      
      // The trailing space gets trimmed, so this should be a duplicate too
      expect(result.success).toBe(false)
      
      // But different text should work
      const result2 = await Memory.addItem("preferences", "Prefers light mode")
      expect(result2.success).toBe(true)
    })

    it("handles concurrent writes safely", async () => {
      // Simulate concurrent writes by using the lock
      const promises = [
        Memory.addItem("preferences", "Pref 1"),
        Memory.addItem("preferences", "Pref 2"),
        Memory.addItem("preferences", "Pref 3"),
      ]

      const results = await Promise.all(promises)
      
      // All should succeed (different items)
      expect(results.filter(r => r.success).length).toBe(3)
      
      const data = await Memory.listMemory()
      expect(data.preferences.length).toBe(3)
    })
  })

  describe("listMemory", () => {
    it("returns empty for new file", async () => {
      const data = await Memory.listMemory()
      
      expect(data.preferences).toEqual([])
      expect(data.facts).toEqual([])
    })

    it("returns all items from both sections", async () => {
      await Memory.addItem("preferences", "Pref 1")
      await Memory.addItem("preferences", "Pref 2")
      await Memory.addItem("facts", "Fact 1")
      await Memory.addItem("facts", "Fact 2")
      await Memory.addItem("facts", "Fact 3")

      const data = await Memory.listMemory()
      
      expect(data.preferences).toEqual(["Pref 1", "Pref 2"])
      expect(data.facts).toEqual(["Fact 1", "Fact 2", "Fact 3"])
    })
  })

  describe("resetMemory", () => {
    it("clears all memory", async () => {
      await Memory.addItem("preferences", "Test pref")
      await Memory.addItem("facts", "Test fact")

      await Memory.resetMemory()
      
      const data = await Memory.listMemory()
      expect(data.preferences).toEqual([])
      expect(data.facts).toEqual([])
    })
  })
})