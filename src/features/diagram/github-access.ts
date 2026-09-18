const ACCESS_TITLES: Record<string, string> = {
  REPOSITORY_NOT_FOUND: "Private repository?",
  GITHUB_AUTH_REQUIRED: "This repository needs GitHub access",
  GITHUB_TOKEN_INVALID: "Update your GitHub token",
  GITHUB_ACCESS_DENIED: "Your token needs repository access",
  GITHUB_TREE_UNAVAILABLE: "We couldn’t read this repository’s files",
};

export function githubAccessTitle(errorCode?: string) {
  return errorCode && Object.hasOwn(ACCESS_TITLES, errorCode)
    ? ACCESS_TITLES[errorCode]
    : undefined;
}
