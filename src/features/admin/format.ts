// Small formatting rules the operator dashboard (/admin) shares.

/** A country's flag emoji from its ISO code; a globe when unknown. */
export function flag(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return "🌐";
  return String.fromCodePoint(
    ...[...country].map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

/** How long ago `ms` was: "42s", "5m 3s", "2h 14m". */
export function since(ms: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A time of day on the operator's clock, 24-hour. */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}

/** Counts by label, largest first; beyond `top`, the rest become "Other". */
export function tally<T>(
  items: T[],
  key: (item: T) => string,
  top: number,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = key(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length <= top) return sorted;
  const rest = sorted.slice(top).reduce((sum, [, count]) => sum + count, 0);
  return [...sorted.slice(0, top), ["Other", rest]];
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return "Unknown";
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}
