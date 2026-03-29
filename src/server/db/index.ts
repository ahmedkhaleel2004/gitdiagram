import * as schema from "./schema";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { neon } from "@neondatabase/serverless";
import postgres from "postgres";
import { config } from "dotenv";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

config({ path: ".env" });

// Define a type that can be either Neon or Postgres database
type DrizzleDatabase =
  | NeonHttpDatabase<typeof schema>
  | PostgresJsDatabase<typeof schema>;

let db: DrizzleDatabase | null = null;

export function hasDb() {
  return Boolean(process.env.POSTGRES_URL?.trim());
}

export function getDb(): DrizzleDatabase {
  if (db) {
    return db;
  }

  const databaseUrl = process.env.POSTGRES_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Missing POSTGRES_URL for database access.");
  }

  const isNeonConnection = databaseUrl.includes("neon.tech");
  if (isNeonConnection) {
    const sql = neon(databaseUrl);
    db = drizzleNeon(sql, { schema });
    return db;
  }

  const client = postgres(databaseUrl);
  db = drizzlePostgres(client, { schema });
  return db;
}
