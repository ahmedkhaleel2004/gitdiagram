import { SITE_URL } from "~/lib/site";
import { REPORT_PATH } from "~/features/architecture-report/content";
import {
  HUBS_PATH,
  HUB_MAX_REPOSITORIES,
  HUB_PAGE_SIZE,
  hubHeading,
  hubPath,
  hubSubject,
  repositoryPath,
  type HubIndex,
  type HubListItem,
  type HubPage,
  type HubSummary,
} from "./hubs";

// Every word on the hub pages and in their Markdown twins. Numbers come only
// from the stored hub objects (server/storage/architecture-hubs.ts).

export const HUBS_TITLE = "Open-source architecture examples";
export const HUBS_DESCRIPTION =
  "Architecture diagrams of open-source GitHub projects, grouped by language and by kind of project, most-starred first, with what the most-starred ones have in common.";

const count = (value: number) => value.toLocaleString("en-US");
const percent = (value: number) => `${Math.round(value)}%`;

export function formatStars(stars: number): string {
  if (stars < 1000) return String(stars);
  const thousands = stars / 1000;
  return `${thousands >= 100 ? Math.round(thousands) : Math.round(thousands * 10) / 10}k`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The page's `<title>`: about 60 characters. */
export function hubTitle(hub: HubSummary, page: number): string {
  const base = `${hubHeading(hub)}: ${count(hub.total)} diagrams`;
  return page > 1 ? `${hubHeading(hub)}, page ${page}` : base;
}

export function hubDescription(hub: HubSummary, page: number): string {
  const from = (page - 1) * HUB_PAGE_SIZE + 1;
  const to = Math.min(hub.total, page * HUB_PAGE_SIZE);
  const what =
    hub.kind === "language"
      ? `open-source ${hub.name} repositories`
      : `open-source ${hub.name}`;
  if (page > 1) {
    return `Architecture diagrams of ${what} on GitHub, numbers ${from} to ${to} of ${count(hub.total)} by stars. Each shows the main components, how they connect, and links to the code.`;
  }
  return `Architecture diagrams of ${count(hub.total)} ${what} on GitHub, most-starred first (${list(hub.top)}). Components, connections and links into the code for each.`;
}

/** Who is in the hub, in one sentence. */
export function hubLead(hub: HubSummary): string {
  const who =
    hub.kind === "language"
      ? hub.total >= HUB_MAX_REPOSITORIES
        ? `the ${count(hub.total)} most-starred open-source ${hub.name} repositories with a GitDiagram architecture diagram`
        : `${count(hub.total)} open-source ${hub.name} repositories with a GitDiagram architecture diagram`
      : `${count(hub.total)} open-source repositories with a GitDiagram architecture diagram where ${hub.rule}`;
  return `Interactive architecture diagrams of ${who}, most stars first. Each diagram shows the project's main components, how they connect, and links every part to its file on GitHub.`;
}

/**
 * What the most-starred diagrams in the hub have in common, as sentences, or
 * nothing while too few have been read.
 */
export function hubFindings(hub: HubSummary): string[] {
  const patterns = hub.patterns;
  if (!patterns) return [];
  const share = (key: string) =>
    patterns.shares.find((item) => item.key === key)?.share ?? 0;
  const sentences: string[] = [];
  const subject = hubSubject(hub);
  const stores = patterns.dataStores.slice(0, 3).map((item) => item.name);
  sentences.push(
    `Across the ${count(patterns.sample)} most-starred ${subject} here, the median diagram has ${count(patterns.medianComponents)} components. ${percent(share("storage"))} draw a data store${stores.length ? ` (most often ${list(stores)})` : ""}, ${percent(share("cli"))} have a command-line interface and ${percent(share("web"))} a web interface.`,
  );
  const extras: string[] = [];
  if (share("llm") >= 10)
    extras.push(`${percent(share("llm"))} have an LLM or AI-model component`);
  if (share("mcp") >= 10) extras.push(`${percent(share("mcp"))} speak MCP`);
  if (share("plugins") >= 10)
    extras.push(
      `${percent(share("plugins"))} have a plugin or extension system`,
    );
  if (share("workspace") >= 10)
    extras.push(
      `${percent(share("workspace"))} are split into workspace packages (packages/, apps/, crates/ and similar)`,
    );
  if (share("queue") >= 10)
    extras.push(`${percent(share("queue"))} draw a queue or event bus`);
  if (extras.length) {
    const text = list(extras);
    sentences.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}.`);
  }
  if (patterns.files.length >= 2) {
    sentences.push(
      `The files their components link to most are ${list(patterns.files.slice(0, 5).map((item) => `${item.name} (${count(item.repositories)})`))}.`,
    );
  }
  if (patterns.groupNames.length >= 2) {
    sentences.push(
      `Group names that recur: ${list(patterns.groupNames.slice(0, 5).map((item) => `“${item.name}” (${count(item.repositories)})`))}.`,
    );
  }
  if (patterns.languages?.length) {
    sentences.push(
      `By language: ${list(patterns.languages.slice(0, 5).map((item) => `${item.name} ${percent((item.repositories / patterns.sample) * 100)}`))}.`,
    );
  }
  return sentences;
}

export const HUB_METHOD = `Counted over GitDiagram's stored diagrams of public repositories, from the names their components and groups carry and the files they link to; the rules are the ones in the [2026 open-source architecture report](${REPORT_PATH}). Stars are GitHub's when the diagram was last made. Rebuilt daily: hubs grow as more repositories' languages are known.`;

/** The method note with its link absolute, for Markdown readers. */
const markdownMethod = () =>
  HUB_METHOD.replace(`](${REPORT_PATH})`, `](${SITE_URL}${REPORT_PATH})`);

export function hubItemPath(item: HubListItem): string {
  return repositoryPath(item.owner, item.repo);
}

// ---- Markdown twin ------------------------------------------------------------

export function hubMarkdown(hub: HubSummary, page: HubPage): string {
  const from = (page.page - 1) * HUB_PAGE_SIZE;
  const lines = [
    `# ${hubHeading(hub)}${page.page > 1 ? `, page ${page.page}` : ""}`,
    "",
    hubLead(hub),
    "",
    ...(page.page === 1 ? hubFindings(hub).flatMap((text) => [text, ""]) : []),
    `## Repositories ${from + 1} to ${from + page.items.length} of ${count(hub.total)}`,
    "",
    ...page.items.map(
      (item, index) =>
        `${from + index + 1}. [${item.owner}/${item.repo}](${SITE_URL}${hubItemPath(item)}) (${formatStars(item.stars)} stars${item.language ? `, ${item.language}` : ""})${item.description ? `: ${item.description}` : ""} Markdown: ${SITE_URL}${hubItemPath(item)}.md`,
    ),
    "",
    ...(page.page < hub.pages
      ? [`Next page: ${SITE_URL}${hubPath(hub.slug, page.page + 1)}`, ""]
      : []),
    `More hubs: ${SITE_URL}${HUBS_PATH}`,
    "",
    markdownMethod(),
  ];
  return lines.join("\n");
}

// ---- Structured data ---------------------------------------------------------

export function hubJsonLd(hub: HubSummary, page: HubPage) {
  const url = `${SITE_URL}${hubPath(hub.slug, page.page)}`;
  const from = (page.page - 1) * HUB_PAGE_SIZE;
  const heading = hubHeading(hub);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        name: page.page > 1 ? `${heading}, page ${page.page}` : heading,
        description: hubDescription(hub, page.page),
        url,
        inLanguage: "en",
        dateModified: page.updatedAt.slice(0, 10),
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: "GitDiagram",
          url: SITE_URL,
        },
        mainEntity: { "@id": `${url}#list` },
      },
      {
        "@type": "ItemList",
        "@id": `${url}#list`,
        name: heading,
        numberOfItems: hub.total,
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        itemListElement: page.items.map((item, index) => ({
          "@type": "ListItem",
          position: from + index + 1,
          url: `${SITE_URL}${hubItemPath(item)}`,
          name: `${item.owner}/${item.repo} architecture diagram`,
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: HUBS_TITLE,
            item: `${SITE_URL}${HUBS_PATH}`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: heading,
            item: `${SITE_URL}${hubPath(hub.slug)}`,
          },
        ],
      },
    ],
  };
}

export function hubsIndexJsonLd(index: HubIndex) {
  const url = `${SITE_URL}${HUBS_PATH}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#page`,
        name: HUBS_TITLE,
        description: HUBS_DESCRIPTION,
        url,
        inLanguage: "en",
        dateModified: index.updatedAt.slice(0, 10),
        mainEntity: { "@id": `${url}#list` },
      },
      {
        "@type": "ItemList",
        "@id": `${url}#list`,
        name: HUBS_TITLE,
        numberOfItems: index.hubs.length,
        itemListElement: index.hubs.map((hub, position) => ({
          "@type": "ListItem",
          position: position + 1,
          url: `${SITE_URL}${hubPath(hub.slug)}`,
          name: hubHeading(hub),
        })),
      },
    ],
  };
}

export function hubsIndexMarkdown(index: HubIndex): string {
  const section = (kind: HubSummary["kind"]) =>
    index.hubs
      .filter((hub) => hub.kind === kind)
      .map(
        (hub) =>
          `- [${hubHeading(hub)}](${SITE_URL}${hubPath(hub.slug)}) (${count(hub.total)} diagrams; Markdown: ${SITE_URL}${hubPath(hub.slug)}.md)`,
      );
  return [
    `# ${HUBS_TITLE}`,
    "",
    HUBS_DESCRIPTION,
    "",
    "## By language",
    "",
    ...section("language"),
    "",
    "## By kind of project",
    "",
    ...section("type"),
    "",
    markdownMethod(),
  ].join("\n");
}
