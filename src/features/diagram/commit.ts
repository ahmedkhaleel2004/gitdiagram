/**
 * Commit SHAs for commit-specific diagrams. Pure and shared by the client and
 * the server: the landing page, the commit route, the request schemas and the
 * storage keys all agree on what a usable SHA looks like.
 */

/** The shortest SHA the site accepts (GitHub's own default abbreviation). */
const MIN_COMMIT_SHA_LENGTH = 7;
/** A full SHA-1 object name, the only form storage ever sees. */
const FULL_COMMIT_SHA_LENGTH = 40;
/** What a short SHA is shown as in the UI. */
const DISPLAY_COMMIT_SHA_LENGTH = 7;

/** The longest string the request schemas accept before format validation. */
export const MAX_COMMIT_INPUT_LENGTH = 256;

export const COMMIT_SHA_INVALID_ERROR =
  "That isn't a valid commit SHA. Use the full 40-character SHA, or a short one with at least 7 hexadecimal characters.";

const COMMIT_ERROR_TITLES: Record<string, string> = {
  COMMIT_SHA_INVALID: "That isn’t a valid commit SHA",
  COMMIT_NOT_FOUND: "We couldn’t find that commit",
  COMMIT_AMBIGUOUS: "That short SHA matches several commits",
};

/**
 * The heading for a commit that could not be resolved, by the error code the
 * API answered with; undefined for every other error. (A private repository
 * without a token is the existing GitHub-access error, not one of these.)
 */
export function commitErrorTitle(errorCode?: string): string | undefined {
  return errorCode && Object.hasOwn(COMMIT_ERROR_TITLES, errorCode)
    ? COMMIT_ERROR_TITLES[errorCode]
    : undefined;
}

const COMMIT_SHA_PATTERN = new RegExp(
  `^[0-9a-f]{${MIN_COMMIT_SHA_LENGTH},${FULL_COMMIT_SHA_LENGTH}}$`,
);
const FULL_COMMIT_SHA_PATTERN = new RegExp(
  `^[0-9a-f]{${FULL_COMMIT_SHA_LENGTH}}$`,
);

export interface ParsedCommitSha {
  /** Lowercase hexadecimal, 7 to 40 characters. */
  sha: string;
  /** Whether this is already a complete 40-character SHA. */
  full: boolean;
}

/**
 * A commit SHA as typed or pasted: surrounding whitespace is ignored and case
 * is normalized. Null for anything that is not 7 to 40 hexadecimal characters
 * (branch names, tags, `HEAD~1` and other revision expressions included, so a
 * "SHA" can never be a moving ref).
 */
export function parseCommitSha(input: string): ParsedCommitSha | null {
  const sha = input.trim().toLowerCase();
  if (!COMMIT_SHA_PATTERN.test(sha)) return null;
  return { sha, full: sha.length === FULL_COMMIT_SHA_LENGTH };
}

/** Whether the value is a complete, lowercase 40-character SHA. */
export function isFullCommitSha(value: string): boolean {
  return FULL_COMMIT_SHA_PATTERN.test(value);
}

/** The abbreviation shown next to a diagram made from a commit. */
export function shortCommitSha(sha: string): string {
  return sha.slice(0, DISPLAY_COMMIT_SHA_LENGTH);
}

/** The commit's page on GitHub. */
export function githubCommitUrl(repository: string, sha: string): string {
  return `https://github.com/${repository}/commit/${sha}`;
}
