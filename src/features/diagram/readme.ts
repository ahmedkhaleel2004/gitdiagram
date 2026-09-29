import { SITE_URL } from "~/lib/site";

export type ReadmeEmbed = "picture" | "badge";

/**
 * The repository page a README embed links to. The query tells analytics the
 * visit came from a README (GitHub sends only its own referrer); the page's
 * canonical URL stays the plain path.
 */
function readmeLinkUrl(owner: string, repo: string, kind: ReadmeEmbed) {
  const query = new URLSearchParams({ utm_source: "readme", utm_medium: kind });
  return `${SITE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?${query.toString()}`;
}

/** A picture of the repository's current diagram; a new diagram replaces it. */
function diagramPictureUrl(owner: string, repo: string) {
  return `${SITE_URL}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/diagram.png`;
}

const DIAGRAM_BADGE_URL = `${SITE_URL}/diagram-badge.svg`;

/** Markdown for a README picture or badge that opens the diagram. */
export function readmeMarkdown(owner: string, repo: string, kind: ReadmeEmbed) {
  const link = readmeLinkUrl(owner, repo, kind);
  return kind === "picture"
    ? `[![Architecture diagram of ${owner}/${repo}](${diagramPictureUrl(owner, repo)})](${link})`
    : `[![Architecture diagram](${DIAGRAM_BADGE_URL})](${link})`;
}
