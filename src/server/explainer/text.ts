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

/**
 * The same normalization the narration clock applies to spoken words. Ellipses
 * are trimmed too, so "Lambda..." still answers a cue for "Lambda"; a single
 * leading dot stays, as in ".env".
 */
export function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z0-9.#/]/g, "")
    .replace(/^\.{2,}|\.+$/g, "");
}

export interface PlanRepositoryFacts {
  name: string;
  /** Every path in the repository tree. */
  paths: string[];
  /** Source excerpts the planner saw; code on screen must come from here. */
  sourceText: string;
  /** Ids of the README pictures stored with the film (plan.images). */
  images?: string[];
}

// Delivery directions the voice takes (gemini-voice.ts). Any other bracketed
// tag is dropped: pause tags stretch past a second, and sounds like [laughs]
// do not belong in an explainer. Punctuation carries the pacing instead.
const DELIVERY_TAGS = [
  "curious",
  "excited",
  "thoughtful",
  "warmly",
  "confident",
  "impressed",
  "amused",
  "playfully",
] as const;

// Splitting on this leaves the tag names at the odd indices.
const TAG = /\[([^\]]*)\]/;
const tidy = (value: string) =>
  value.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

/** The line as the voice reads it: known delivery tags kept, each set off by spaces. */
export function spokenLine(value: string): string {
  return value
    .split(TAG)
    .map((part, index) => {
      if (index % 2 === 0) return tidy(part);
      const name = part.trim().toLowerCase();
      return (DELIVERY_TAGS as readonly string[]).includes(name)
        ? `[${name}]`
        : "";
    })
    .filter(Boolean)
    .join(" ");
}

/** The line as captioned and cued: every direction removed. */
export function writtenLine(value: string): string {
  return value
    .split(TAG)
    .filter((_, index) => index % 2 === 0)
    .map(tidy)
    .filter(Boolean)
    .join(" ");
}
