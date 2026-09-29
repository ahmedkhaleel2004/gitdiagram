// Words people leave in a copied example URL (`gitdiagram.com/user/repo`)
// instead of a real repository. A Reddit post in September 2026 sent about
// 2,000 visitors to /user/repo alone. None of these pairs is a real GitHub
// repository, so the page explains the URL instead of running a generation.
const PLACEHOLDER_OWNERS = new Set([
  "user",
  "username",
  "user-name",
  "owner",
  "owner-name",
  "ownername",
  "your-username",
  "yourusername",
  "your_username",
  "your-user",
  "your-name",
  "yourname",
  "github-username",
  "your-github-username",
]);

const PLACEHOLDER_REPOS = new Set([
  "repo",
  "repository",
  "project",
  "repo-name",
  "reponame",
  "repo_name",
  "repository-name",
  "project-name",
  "your-repo",
  "yourrepo",
  "your_repo",
  "your-repo-name",
  "your-repository",
  "your-project",
]);

function normalize(segment: string): string {
  let value = segment;
  try {
    value = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment; it still compares below.
  }
  // `<user>/<repo>`, `{owner}/{repo}`, `[user]/[repo]` and `:owner/:repo`.
  return value
    .trim()
    .toLowerCase()
    .replace(/^[<{[:]+|[>}\]]+$/gu, "");
}

/** Whether `/username/repo` is a copied placeholder, not a repository. */
export function isPlaceholderRepo(username: string, repo: string): boolean {
  return (
    PLACEHOLDER_OWNERS.has(normalize(username)) &&
    PLACEHOLDER_REPOS.has(normalize(repo))
  );
}
