import "server-only";

/**
 * A whole-number setting from the environment; the fallback when it is unset,
 * not a number, or below `min` (default 0, so 0 is a valid "none").
 */
export function readIntEnv(
  name: string,
  fallback: number,
  { min = 0 }: { min?: number } = {},
): number {
  const parsed = Number.parseInt(process.env[name]?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}
