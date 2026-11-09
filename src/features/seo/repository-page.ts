import { SITE_URL } from "~/lib/site";
import {
  explanationSummary,
  type DiagramReadout,
} from "~/features/diagram/readout";

// Titles, descriptions and schema.org data for /{owner}/{repo}. Paths are
// lowercase like the page's canonical URL.

const MAX_TITLE_LENGTH = 60;

const repoPath = (owner: string, repo: string) =>
  `/${encodeURIComponent(owner.toLowerCase())}/${encodeURIComponent(repo.toLowerCase())}`;

/** The Markdown twin agents read (rewritten by src/proxy.ts). */
export const repositoryMarkdownPath = (owner: string, repo: string) =>
  `${repoPath(owner, repo)}.md`;

/**
 * "deno architecture diagram: how denoland/deno is structured": the plain
 * repository name first, because that is how people ask ("deno architecture",
 * "how is deno structured"), shortened to fit about 60 characters.
 */
export function repositoryPageTitle(owner: string, repo: string): string {
  const name = `${owner}/${repo}`;
  const candidates = [
    `${repo} architecture diagram: how ${name} is structured`,
    `${repo} architecture diagram: how ${name} works`,
    `${repo} architecture diagram (${name})`,
  ];
  return (
    candidates.find((title) => title.length <= MAX_TITLE_LENGTH) ??
    `${name} architecture diagram`
  );
}

/** The explanation's first sentences, or a plain line about the diagram. */
export function repositoryPageDescription(
  owner: string,
  repo: string,
  readout: DiagramReadout | null,
): string {
  return (
    (readout?.explanation && explanationSummary(readout.explanation)) ||
    `Interactive architecture diagram of ${owner}/${repo}: its main components, how they connect, and links to the source on GitHub.`
  );
}

/**
 * The page as a TechArticle about the repository's source code (a plain
 * WebPage until a diagram is stored), plus its breadcrumb trail.
 */
export function repositoryJsonLd(params: {
  owner: string;
  repo: string;
  description: string;
  readout: DiagramReadout | null;
}) {
  const { owner, repo, description, readout } = params;
  const name = `${owner}/${repo}`;
  const url = `${SITE_URL}${repoPath(owner, repo)}`;
  const githubUrl = `https://github.com/${name}`;
  const site = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: "GitDiagram",
    url: SITE_URL,
  };
  const publisher = {
    "@type": "Organization",
    name: "GitDiagram",
    url: SITE_URL,
  };
  const page = readout
    ? {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: repositoryPageTitle(owner, repo),
        description,
        url,
        mainEntityOfPage: url,
        inLanguage: "en",
        image: `${url}/opengraph-image`,
        ...(readout.lastSuccessfulAt
          ? { dateModified: readout.lastSuccessfulAt }
          : {}),
        author: publisher,
        publisher,
        about: { "@id": `${url}#repository` },
        isPartOf: site,
        encoding: {
          "@type": "MediaObject",
          encodingFormat: "text/markdown",
          contentUrl: `${SITE_URL}${repositoryMarkdownPath(owner, repo)}`,
        },
      }
    : {
        "@type": "WebPage",
        "@id": `${url}#page`,
        name: `${name} architecture diagram`,
        description,
        url,
        inLanguage: "en",
        about: { "@id": `${url}#repository` },
        isPartOf: site,
      };
  return {
    "@context": "https://schema.org",
    "@graph": [
      page,
      {
        "@type": "SoftwareSourceCode",
        "@id": `${url}#repository`,
        name,
        codeRepository: githubUrl,
        url: githubUrl,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "GitDiagram",
            item: SITE_URL,
          },
          { "@type": "ListItem", position: 2, name, item: url },
        ],
      },
    ],
  };
}
