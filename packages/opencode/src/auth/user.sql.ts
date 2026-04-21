import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../storage/schema.sql"

export const UserTable = sqliteTable("app_user", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  password: text().notNull(),
  role: text().$type<"admin" | "user">().notNull().default("user"),
  mcp_url: text(),
  mcp_token: text(),
  ...Timestamps,
})

export const UserSessionTable = sqliteTable("app_user_session", {
  id: text().primaryKey(),
  user_id: text()
    .notNull()
    .references(() => UserTable.id, { onDelete: "cascade" }),
  expires_at: integer().notNull(),
  ...Timestamps,
})
