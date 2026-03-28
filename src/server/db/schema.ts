// Example model schema from the Drizzle docs
// https://orm.drizzle.team/docs/sql-schema-declaration

import { sql } from "drizzle-orm";
import {
  pgTableCreator,
  timestamp,
  varchar,
  primaryKey,
  boolean,
  jsonb,
  text,
  integer,
} from "drizzle-orm/pg-core";
import type {
  DiagramGraph,
  GenerationSessionAudit,
} from "~/features/diagram/graph";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `gitdiagram_${name}`);

export const diagramCache = createTable(
  "diagram_cache",
  {
    username: varchar("username", { length: 256 }).notNull(),
    repo: varchar("repo", { length: 256 }).notNull(),
    diagram: text("diagram").notNull().default(""),
    explanation: text("explanation")
      .notNull()
      .default("No explanation provided"), // Default explanation to avoid data loss of existing rows
    graph: jsonb("graph").$type<DiagramGraph | null>().default(null),
    latestSessionId: varchar("latest_session_id", { length: 128 }),
    latestSessionStatus: varchar("latest_session_status", { length: 32 })
      .notNull()
      .default("idle"),
    latestSessionStage: varchar("latest_session_stage", { length: 64 }),
    latestSessionProvider: varchar("latest_session_provider", { length: 64 }),
    latestSessionModel: varchar("latest_session_model", { length: 256 }),
    latestSessionAudit: jsonb("latest_session_audit")
      .$type<GenerationSessionAudit | null>()
      .default(null),
    lastSuccessfulAt: timestamp("last_successful_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => new Date(),
    ),
    usedOwnKey: boolean("used_own_key").default(false),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.username, table.repo] }),
  }),
);

export const openaiDailyQuota = createTable(
  "openai_daily_quota",
  {
    quotaDateUtc: varchar("quota_date_utc", { length: 10 }).notNull(),
    quotaBucket: varchar("quota_bucket", { length: 128 }).notNull(),
    usedTokens: integer("used_tokens").notNull().default(0),
    reservedTokens: integer("reserved_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.quotaDateUtc, table.quotaBucket] }),
  }),
);
