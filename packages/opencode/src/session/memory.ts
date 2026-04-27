import path from "path"
import { Global } from "../global"
import { Lock } from "../util"
import { Effect } from "effect"

const MEMORY_FILENAME = "memory.md"

function memoryPath(): string {
  return path.join(Global.Path.config, MEMORY_FILENAME)
}

const DEFAULT_MEMORY = `# User Preferences

- 

# Remembered Facts

- 
`

export interface MemoryData {
  preferences: string[]
  facts: string[]
}

export async function loadMemory(): Promise<MemoryData> {
  const filepath = memoryPath()
  const file = Bun.file(filepath)

  if (!await file.exists()) {
    await Bun.write(filepath, DEFAULT_MEMORY)
    return { preferences: [], facts: [] }
  }

  const content = await file.text()
  return parseMemoryContent(content)
}

function parseMemoryContent(content: string): MemoryData {
  const result: MemoryData = { preferences: [], facts: [] }
  
  const lines = content.split("\n")
  let currentSection: "preferences" | "facts" | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    
    if (trimmed === "# User Preferences") {
      currentSection = "preferences"
      continue
    }
    
    if (trimmed === "# Remembered Facts") {
      currentSection = "facts"
      continue
    }

    // Check if it's a bullet point (排除空行后的第一个 -)
    if (currentSection && trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim()
      if (value) {
        if (currentSection === "preferences") {
          result.preferences.push(value)
        } else {
          result.facts.push(value)
        }
      }
    }
  }

  return result
}

export async function addItem(
  section: "preferences" | "facts",
  content: string,
): Promise<{ success: boolean; reason?: string }> {
  const trimmed = content.trim()
  if (!trimmed) {
    return { success: false, reason: "Content cannot be empty" }
  }

  const filepath = memoryPath()
  const lockKey = `memory:${filepath}`

  await using lock = await Lock.write(lockKey)
  
  const data = await loadMemory()
  
  const list = section === "preferences" ? data.preferences : data.facts
  
  // Exact match dedupe (case-sensitive, trim only)
  if (list.includes(trimmed)) {
    return { success: false, reason: "Item already exists" }
  }

  list.push(trimmed)
  await saveMemory(data)
  
  return { success: true }
}

export async function listMemory(): Promise<MemoryData> {
  return loadMemory()
}

async function saveMemory(data: MemoryData): Promise<void> {
  const filepath = memoryPath()
  
  const preferencesSection = data.preferences.length > 0
    ? data.preferences.map(p => `- ${p}`).join("\n")
    : "- "
    
  const factsSection = data.facts.length > 0
    ? data.facts.map(f => `- ${f}`).join("\n")
    : "- "

  const content = `# User Preferences
${preferencesSection}

# Remembered Facts
${factsSection}
`

  await Bun.write(filepath, content)
}

// For testing - reset memory file
export async function resetMemory(): Promise<void> {
  const filepath = memoryPath()
  const lockKey = `memory:${filepath}`
  
  await using lock = await Lock.write(lockKey)
  await Bun.write(filepath, DEFAULT_MEMORY)
}