/**
 * "Continue with GitHub" for private repositories. The whole sign-in runs on
 * the server (`/api/github/connect` → GitHub → `/api/github/callback`), which
 * keeps the token in an HttpOnly cookie; the browser only ever sees the
 * outcome, as `?github=<result>` on the page it comes back to.
 */
export const GITHUB_CONNECT_ENABLED =
  process.env.NEXT_PUBLIC_GITHUB_CONNECT === "1";

export type GitHubConnectSource = "repo" | "menu";

export function githubConnectUrl(options: {
  repository?: string;
  source: GitHubConnectSource;
  /** The page to come back to, for the header's dialog. */
  returnTo?: string;
  /** Open GitHub's install page first, to pick more repositories. */
  install?: boolean;
}): string {
  const params = new URLSearchParams();
  if (options.repository) params.set("repo", options.repository);
  if (options.source === "menu") params.set("from", "menu");
  if (options.returnTo) params.set("return", options.returnTo);
  if (options.install) params.set("install", "1");
  const query = params.toString();
  return `/api/github/connect${query ? `?${query}` : ""}`;
}

export const GITHUB_CONNECT_FAILURES = {
  denied: "GitHub sign-in was cancelled.",
  no_access:
    "GitDiagram can’t see this repository yet. Pick it on GitHub’s install page. For an organization, an owner may need to approve the request first.",
  expired: "That GitHub sign-in took too long. Please try again.",
  state_mismatch:
    "That GitHub sign-in could not be verified. Please try again.",
  exchange_failed: "GitHub didn’t finish the sign-in. Please try again.",
  unavailable: "Signing in with GitHub isn’t available right now.",
  error: "Something went wrong signing in with GitHub. Please try again.",
} as const;

export type GitHubConnectFailure = keyof typeof GITHUB_CONNECT_FAILURES;

export type GitHubConnectResult =
  | { status: "connected"; source: GitHubConnectSource }
  | {
      status: "failed";
      reason: GitHubConnectFailure;
      source: GitHubConnectSource;
    };

/** Reads the outcome a sign-in attached to this page's address, if any. */
export function parseGitHubConnectResult(
  search: string,
): GitHubConnectResult | null {
  const params = new URLSearchParams(search);
  const value = params.get("github");
  if (!value) return null;
  const source: GitHubConnectSource =
    params.get("github_from") === "menu" ? "menu" : "repo";
  if (value === "connected") return { status: "connected", source };
  const reason: GitHubConnectFailure = Object.hasOwn(
    GITHUB_CONNECT_FAILURES,
    value,
  )
    ? (value as GitHubConnectFailure)
    : "error";
  return { status: "failed", reason, source };
}

/** The same address without the sign-in outcome. */
export function withoutGitHubConnectResult(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("github");
  url.searchParams.delete("github_from");
  return `${url.pathname}${url.search}${url.hash}`;
}
