// Text helpers shared by script and plan validation and narration timing.

type Json = Record<string, unknown>;

/** A model's JSON value read as an object ({} for anything else). */
export const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};

/** A model's JSON value read as a list of objects. */
export const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.map(record) : [];

/** A string or number as text ("" for anything else). */
export const plainText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

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
  /**
   * All the repository material the writers read (README, tree, sources,
   * description); on-screen web addresses must appear in it. Defaults to
   * sourceText.
   */
  material?: string;
}

// A web address: a scheme or "www.", or a bare host on a common web domain
// ("example.com", but not "Next.js"). Domains that are also file extensions
// (.md, .rs, .py, .zip) or common property names (.in, .it, .page, .store) are left
// out, so file names and code never match.
const WEB_ADDRESS =
  /\b(?:https?:\/\/|www\.)[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|gov|io|dev|app|ai|co|xyz|me|sh|gg|ly|so|cc|ws|pw|info|biz|site|online|link|top|click|cloud|tech|blog|pro|website|icu|vip|us|uk|eu|de|fr|nl|ch|ca|au|jp|br|ru|cn|tk|tv|fm)\b(?:\/[^\s]*)?/gi;

// The material is the same large text for every line of a film; lowercase it once.
let lastKnown = { text: "", lower: "" };
function lowered(known: string): string {
  if (lastKnown.text !== known)
    lastKnown = { text: known, lower: known.toLowerCase() };
  return lastKnown.lower;
}

function hostOf(address: string): string {
  return address
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#:]/)[0]!
    .replace(/[.,;!?)\]'"…]+$/, "");
}

/**
 * The text without any sentence that names a web address `known` never
 * mentions. `known` is the repository material the writers read, README
 * included, so this stops an address a model invents or recalls from
 * elsewhere; one the README itself plants still passes (the prompt tells the
 * writers never to use addresses at all). The rest of the text is kept, so a
 * paid run still makes its film.
 */
export function withoutStrangeAddresses(value: string, known: string): string {
  const strange = (sentence: string) =>
    (sentence.match(WEB_ADDRESS) ?? []).some((address) => {
      const host = hostOf(address);
      return !host || !lowered(known).includes(host);
    });
  if (!strange(value)) return value;
  return value
    .split(/(?<=[.!?…])\s+/)
    .filter((sentence) => !strange(sentence))
    .join(" ");
}

// Splitting on this leaves any bracketed direction at the odd indices.
const TAG = /\[([^\]]*)\]/;
const tidy = (value: string) =>
  value.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();

/**
 * The narration line as voiced, captioned and cued. Punctuation carries the
 * pacing; a bracketed direction the model writes anyway ("[laughs]") is dropped.
 */
export function writtenLine(value: string): string {
  return value
    .split(TAG)
    .filter((_, index) => index % 2 === 0)
    .map(tidy)
    .filter(Boolean)
    .join(" ");
}
