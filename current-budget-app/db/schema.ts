import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const households = sqliteTable("households", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const householdMembers = sqliteTable(
  "household_members",
  {
    id: text("id").primaryKey(),
    householdId: text("household_id")
      .notNull()
      .references(() => households.id),
    userId: text("user_id"),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull(),
    joinedAt: text("joined_at"),
  },
  (table) => [
    uniqueIndex("idx_members_household_email").on(
      table.householdId,
      table.email,
    ),
    index("idx_members_user_id").on(table.userId),
  ],
);

export const budgetDocuments = sqliteTable("budget_documents", {
  householdId: text("household_id")
    .primaryKey()
    .references(() => households.id),
  version: integer("version").notNull().default(1),
  document: text("document").notNull(),
  updatedAt: text("updated_at").notNull(),
});
