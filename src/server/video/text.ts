// Text helpers shared by plan validation and narration timing.

/** Clip to a limit at a word boundary so on-screen text never ends mid-word. */
export function clip(value: unknown, limit: number): string {
  const s = (
    typeof value === "string" || typeof value === "number" ? String(value) : ""
  )
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= limit) return s;
  const cut = s.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return (
    (space > limit * 0.6 ? cut.slice(0, space) : cut).replace(
      /[\s,;:.\-–—]+$/,
      "",
    ) + "…"
  );
}

/** The same normalization the narration clock applies to spoken words. */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9.#/]/g, "")
    .replace(/\.$/, "");
}

export interface PlanRepositoryFacts {
  name: string;
  /** Every path in the repository tree. */
  paths: string[];
  /** Source excerpts the planner saw; code on screen must come from here. */
  sourceText: string;
}
