import { SITE_URL } from "~/lib/site";

export type ReadmeEmbed = "picture" | "badge";

/**
 * The repository page a README embed links to. The query tells analytics the
 * visit came from a README (GitHub sends only its own referrer); the page's
 * canonical URL stays the plain path.
 */
function readmeLinkUrl(
  owner: string,
  repo: string,
  kind: ReadmeEmbed,
  commit?: string,
) {
  const query = new URLSearchParams({ utm_source: "readme", utm_medium: kind });
  return `${repoBaseUrl(owner, repo, commit)}?${query.toString()}`;
}

/** The repository's page, or one commit's page. */
function repoBaseUrl(owner: string, repo: string, commit?: string) {
  const base = `${SITE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  return commit ? `${base}/commit/${encodeURIComponent(commit)}` : base;
}

/** A picture of the repository's current diagram; a new diagram replaces it. */
function diagramPictureUrl(owner: string, repo: string, commit?: string) {
  return `${repoBaseUrl(owner, repo, commit)}/diagram.png`;
}

const DIAGRAM_BADGE_URL = `${SITE_URL}/diagram-badge.svg`;

/**
 * Markdown for a README picture or badge that opens the diagram; with a full
 * commit SHA, that commit's picture and page.
 */
export function readmeMarkdown(
  owner: string,
  repo: string,
  kind: ReadmeEmbed,
  commit?: string,
) {
  const link = readmeLinkUrl(owner, repo, kind, commit);
  return kind === "picture"
    ? `[![Architecture diagram of ${owner}/${repo}](${diagramPictureUrl(owner, repo, commit)})](${link})`
    : `[![Architecture diagram](${DIAGRAM_BADGE_URL})](${link})`;
}
