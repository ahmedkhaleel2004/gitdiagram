/**
 * Builds the /architecture-examples hubs now, the same as the daily cron
 * (/api/internal/architecture-hubs) but with a bigger reading budget, for the
 * first fill or after the language back-fill adds many repositories. Reads the
 * browse index and public diagrams; writes only the hub objects under
 * public/v1/_meta/hubs/. Needs the R2 settings in the environment.
 *
 *   bun run hubs:build [--max-reads 20000] [--budget-seconds 900]
 *
 * Pages cached on the site pick the result up within six hours, or at once
 * after the next cron run.
 */
import { rebuildArchitectureHubs } from "../src/server/storage/architecture-hubs";

function flag(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(process.argv[index + 1]) : fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Bad --${name}`);
  return value;
}

const result = await rebuildArchitectureHubs({
  maxReads: flag("max-reads", 20_000),
  readBudgetMs: flag("budget-seconds", 900) * 1000,
});
console.log(JSON.stringify(result));
