/** Safe metadata from GitHub; never carries response bodies or credentials. */
export class GitHubRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = "GitHubRequestError";
  }
}

export function classifyGitHubError(
  error: unknown,
  hasCallerToken: boolean,
): { message: string; errorCode: string; status: number } | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "Repository not found.")
    return {
      message:
        "We couldn't access this repository. Check the owner and repository name. If it's private, add a GitHub token with access using GitHub Access.",
      errorCode: "REPOSITORY_NOT_FOUND",
      status: 404,
    };
  if (
    error.message ===
    "Could not fetch repository file tree. Repository might be empty or inaccessible."
  )
    return {
      message:
        "This repository has no readable files yet. Push your code to GitHub, then try again.",
      errorCode: "REPOSITORY_EMPTY",
      status: 422,
    };
  if (
    error.message ===
    "A GitHub token is required to analyze a private repository."
  )
    return {
      message:
        "This repository is private. Add a GitHub token with access using GitHub Access, then try again.",
      errorCode: "GITHUB_AUTH_REQUIRED",
      status: 403,
    };
  if (error.message === "GitHub request timed out. Please retry.")
    return {
      message: "GitHub took too long to respond. Please try again.",
      errorCode: "GITHUB_TIMEOUT",
      status: 504,
    };
  if (error instanceof GitHubRequestError) {
    if (error.rateLimited || error.status === 429)
      return {
        message:
          "GitHub is temporarily limiting requests. Please wait a minute, then try again.",
        errorCode: "GITHUB_RATE_LIMITED",
        status: 429,
      };
    if (hasCallerToken && error.status === 401)
      return {
        message:
          "Your saved GitHub token is invalid or expired. Update or remove it using GitHub Access, then try again.",
        errorCode: "GITHUB_TOKEN_INVALID",
        status: 401,
      };
    if (hasCallerToken && error.status === 403)
      return {
        message:
          "Your GitHub token doesn't have access to this repository's files. Update its repository permissions using GitHub Access, then try again.",
        errorCode: "GITHUB_ACCESS_DENIED",
        status: 403,
      };
  }
  if (error.message === "Could not fetch repository file tree.")
    return {
      message:
        "GitHub couldn't provide this repository's files. Check that it has a default branch and that your GitHub token has access, then try again.",
      errorCode: "GITHUB_TREE_UNAVAILABLE",
      status: 422,
    };
  if (error instanceof GitHubRequestError)
    return {
      message: "GitHub is temporarily unavailable. Please try again shortly.",
      errorCode: "GITHUB_UNAVAILABLE",
      status: 503,
    };
  return null;
}
