import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import * as Memory from "../session/memory"

const Parameters = z.object({
  action: z.enum(["add", "list"]).describe("The action to perform"),
  section: z
    .enum(["preferences", "facts"])
    .optional()
    .describe("Which section to add to (required for 'add' action)"),
  content: z
    .string()
    .optional()
    .describe("The content to add (required for 'add' action, not needed for 'list')"),
})

type Metadata = {
  added?: boolean
  skipped?: boolean
  reason?: string
  preferences: string[]
  facts: string[]
}

export const MemoryTool = Tool.define(
  "memory",
  Effect.succeed({
    description:
      "Manage persistent memory that stores user preferences and remembered facts across sessions. Use 'add' to save something the user explicitly wants remembered (like 'remember this' or 'remember that I prefer X'). Use 'list' to see what's currently stored.",
    parameters: Parameters,
    execute: (params: z.infer<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        // Only ask permission for 'add' action, not 'list'
        if (params.action === "add") {
          yield* ctx.ask({
            permission: "memory",
            patterns: ["*"],
            always: [],
            metadata: {},
          })
        }

        if (params.action === "list") {
          const data = yield* Effect.promise(() => Memory.listMemory())
          return {
            title: "Memory contents",
            output: [
              "# User Preferences",
              ...data.preferences.map((p) => `- ${p}`),
              "",
              "# Remembered Facts",
              ...data.facts.map((f) => `- ${f}`),
            ].join("\n"),
            metadata: {
              preferences: data.preferences,
              facts: data.facts,
            },
          }
        }

        // action === "add"
        if (!params.section) {
          throw new Error("section is required for 'add' action")
        }

        if (!params.content) {
          throw new Error("content is required for 'add' action")
        }

        const result = yield* Effect.promise(() => Memory.addItem(params.section!, params.content!))

        if (result.success) {
          const data = yield* Effect.promise(() => Memory.listMemory())
          return {
            title: "Memory saved",
            output: `Added to ${params.section}: "${params.content}"`,
            metadata: {
              added: true,
              preferences: data.preferences,
              facts: data.facts,
            },
          }
        }

        return {
          title: "Memory skipped",
          output: result.reason || "Item already exists",
          metadata: {
            added: false,
            skipped: true,
            reason: result.reason,
            preferences: [],
            facts: [],
          },
        }
      }),
  }) as any,
)