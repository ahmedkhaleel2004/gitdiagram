import postgres from "postgres";

let client: postgres.Sql | null = null;

export function getQuotaSqlClient(): postgres.Sql {
  if (client) {
    return client;
  }

  const databaseUrl = process.env.POSTGRES_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Missing POSTGRES_URL for complimentary quota persistence.");
  }

  client = postgres(databaseUrl);
  return client;
}
