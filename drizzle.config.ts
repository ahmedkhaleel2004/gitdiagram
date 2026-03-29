import { type Config } from "drizzle-kit";

import { env } from "~/env";

if (!env.POSTGRES_URL) {
  throw new Error("Missing POSTGRES_URL for Drizzle commands.");
}

export default {
  schema: "./src/server/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: env.POSTGRES_URL,
  },
  tablesFilter: ["gitdiagram_*"],
} satisfies Config;
