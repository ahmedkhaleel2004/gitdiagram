const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** 1234 → "1.2K" (star counts, token counts). */
export function formatCompact(value: number): string {
  return compact.format(value);
}
