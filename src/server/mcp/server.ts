import "server-only";

import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { after } from "next/server";
import { z } from "zod";

import type { BrowseIndexEntry } from "~/features/browse/catalog";
import { VIDEOS_ENABLED } from "~/lib/video-flag";
import { SITE_URL } from "~/lib/site";
import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { getCachedBrowsePage } from "~/server/browse-index-cache";
import { readVideoArtifact } from "~/server/explainer/store";
import { getClientIp } from "~/server/http/client-ip";
import { errorText, logEvent } from "~/server/log";
import { getPublicDiagramArtifact } from "~/server/storage/artifact-store";
import {
  formatDiagram,
  formatMissingDiagram,
  formatMissingVideo,
  formatSearchResults,
  formatVideo,
  invalidRepositoryMessage,
  normalizeSearchQuery,
  parseRepositoryInput,
  type RepositoryRef,
} from "./format";
import {
  consumeMcpRateLimit,
  recordMcpCall,
  type McpOutcome,
  type McpToolName,
} from "./usage";

// GitDiagram's MCP server: read-only tools over what the site has already
// stored (diagrams in the public R2 namespace, the browse index, explainer
// videos). Nothing here starts a paid generation or reads a private artifact.
// The tool descriptions are what make an agent pick GitDiagram, so they say
// plainly when to call each tool.

export const MCP_SERVER_VERSION = "1.0.0";

const SERVER_INFO = {
  name: "gitdiagram",
  title: "GitDiagram",
  version: MCP_SERVER_VERSION,
  description:
    "Architecture diagrams and explanations of public GitHub repositories.",
  websiteUrl: SITE_URL,
  icons: [
    {
      src: `${SITE_URL}/favicon.ico`,
      mimeType: "image/x-icon",
      sizes: ["any"],
    },
  ],
};

const INSTRUCTIONS = `GitDiagram (gitdiagram.com) turns public GitHub repositories into architecture diagrams. When a user wants to understand, visualize or get an overview of a GitHub repository's architecture, call get_repository_diagram with "owner/repo" or a GitHub URL: it returns a written explanation, the main components with their source paths, how they connect, and Mermaid source. Use find_repository_diagrams to look up a project's exact owner/repo by name. Always give the user the interactive diagram link from the result: it is the best way to explore the diagram, and each component links to its code.`;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const repositoryInput = z.object({
  repository: z
    .string()
    .min(1)
    .max(500)
    .describe(
      'The GitHub repository as "owner/repo" (e.g. "fastapi/fastapi") or any github.com URL inside it (e.g. "https://github.com/vercel/next.js/tree/canary/packages").',
    ),
});

const SIMILAR_LIMIT = 5;
const SEARCH_LIMIT = 10;
const MAX_SEARCH_RESULTS = 10;

interface ToolOutcome {
  text: string;
  outcome: McpOutcome;
  /** Named in the /admin feed only when a public artifact confirmed it. */
  repo?: string;
  subject?: string;
}

const text = (value: string, isError = false): CallToolResult => ({
  content: [{ type: "text", text: value }],
  ...(isError ? { isError: true } : {}),
});

function later(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Outside a request scope (tests, scripts): run it detached.
    void task().catch(() => undefined);
  }
}

async function searchIndex(
  query: string,
  limit: number,
): Promise<{ entries: BrowseIndexEntry[]; total: number } | null> {
  const page = await getCachedBrowsePage({ q: query, sort: "stars_desc" });
  return page
    ? { entries: page.items.slice(0, limit), total: page.total }
    : null;
}

async function similarDiagrams(
  ref: RepositoryRef,
): Promise<BrowseIndexEntry[]> {
  try {
    const found = await searchIndex(ref.repo, SIMILAR_LIMIT + 1);
    const self = `${ref.username}/${ref.repo}`.toLowerCase();
    return (found?.entries ?? [])
      .filter(
        (entry) => `${entry.username}/${entry.repo}`.toLowerCase() !== self,
      )
      .slice(0, SIMILAR_LIMIT);
  } catch {
    return [];
  }
}

async function getRepositoryDiagram(input: string): Promise<ToolOutcome> {
  const ref = parseRepositoryInput(input);
  if (!ref)
    return { text: invalidRepositoryMessage(input), outcome: "invalid" };
  const subject = `${ref.username}/${ref.repo}`;
  const [artifact, video] = await Promise.all([
    getPublicDiagramArtifact(ref.username, ref.repo),
    VIDEOS_ENABLED
      ? readVideoArtifact(ref.username, ref.repo).catch(() => null)
      : null,
  ]);
  if (!artifact?.diagram)
    return {
      text: formatMissingDiagram(ref, await similarDiagrams(ref)),
      outcome: "missing",
      subject,
    };
  return {
    text: formatDiagram(artifact, { hasVideo: Boolean(video) }),
    outcome: "found",
    repo: `${artifact.username}/${artifact.repo}`,
    subject,
  };
}

async function findRepositoryDiagrams(
  query: string,
  limit: number,
): Promise<ToolOutcome> {
  const normalized = normalizeSearchQuery(query);
  const found = await searchIndex(normalized, limit);
  if (!found) throw new Error("The browse index is unavailable.");
  return {
    text: formatSearchResults(normalized, found.entries, found.total),
    outcome: found.entries.length ? "found" : "missing",
    subject: normalized,
  };
}

async function getExplainerVideo(input: string): Promise<ToolOutcome> {
  const ref = parseRepositoryInput(input);
  if (!ref)
    return { text: invalidRepositoryMessage(input), outcome: "invalid" };
  const subject = `${ref.username}/${ref.repo}`;
  const video = await readVideoArtifact(ref.username, ref.repo);
  if (!video)
    return { text: formatMissingVideo(ref), outcome: "missing", subject };
  return {
    text: formatVideo(video),
    outcome: "found",
    repo: `${video.meta.owner}/${video.meta.repo}`,
    subject,
  };
}

/** Runs one tool call behind the limiter, and counts it after the response. */
async function runTool(
  request: Request | undefined,
  tool: McpToolName,
  clientName: string | null,
  work: () => Promise<ToolOutcome>,
): Promise<CallToolResult> {
  const clientIp = request ? getClientIp(request) : null;
  let result: ToolOutcome;
  const limit = await consumeMcpRateLimit(clientIp);
  if (!limit.allowed) {
    const minutes = Math.max(Math.ceil(limit.retryAfterSeconds / 60), 1);
    result = {
      text: `Too many GitDiagram requests from this network. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      outcome: "limited",
    };
  } else {
    try {
      result = await work();
    } catch (error) {
      logEvent("error", "mcp.tool_failed", { tool, error: errorText(error) });
      result = {
        text: "GitDiagram could not read its stored diagrams just now. Try again in a minute.",
        outcome: "error",
      };
    }
  }

  const origin = request ? requestOrigin(request) : {};
  later(async () => {
    const notify = await recordMcpCall({
      tool,
      outcome: result.outcome,
      clientIp,
      subject: result.subject,
    });
    if (!notify) return;
    await emitLiveEvent({
      kind: "mcp.call",
      tool,
      outcome: result.outcome,
      ...(result.repo ? { repo: result.repo } : {}),
      ...(clientName ? { client: clientName } : {}),
      ...origin,
    });
  });

  return text(
    result.text,
    result.outcome === "limited" ||
      result.outcome === "error" ||
      result.outcome === "invalid",
  );
}

/**
 * A fresh server for one HTTP request (the handler is stateless). `request`
 * is the HTTP request being served, for the limiter and the feed.
 */
export function createGitDiagramMcpServer(
  request?: Request,
  clientName: string | null = null,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { tools: {} },
  });

  server.registerTool(
    "get_repository_diagram",
    {
      title: "Get a GitHub repository's architecture diagram",
      description:
        "Get the architecture of a public GitHub repository from GitDiagram (gitdiagram.com): a written explanation of how the codebase is organized, its main components with the source paths they live in, how those components connect, and a Mermaid flowchart of the whole system, plus a link to the interactive diagram, where every component opens its code on GitHub. Use it whenever the user wants to understand, visualize, map or explain a GitHub repository's or open-source project's architecture, structure, main modules or data flow, wants an overview before reading unfamiliar code, or asks for an architecture or system diagram of a repo. Read-only and fast: it returns the diagram GitDiagram has already made. If none exists yet, it returns a link that generates one for free when opened in a browser. Public repositories only.",
      inputSchema: repositoryInput,
      annotations: { title: "Get architecture diagram", ...READ_ONLY },
    },
    ({ repository }) =>
      runTool(request, "get_repository_diagram", clientName, () =>
        getRepositoryDiagram(repository),
      ),
  );

  server.registerTool(
    "find_repository_diagrams",
    {
      title: "Search GitDiagram's architecture diagrams",
      description:
        'Search GitDiagram\'s library of ready-made architecture diagrams of public GitHub repositories by owner or repository name. Matches any part of "owner/repo" (e.g. "langchain", "vercel/", "react-native") and returns up to 10 repositories, most-starred first, each with its interactive diagram link. Use it to find a project\'s exact owner/repo from its name, or to list which repositories of an owner or topic already have diagrams. It searches repository names only, not code or file contents.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(100)
          .describe(
            'Part of a repository\'s "owner/repo" name, e.g. "fastapi", "microsoft/", or "next.js".',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_RESULTS)
          .optional()
          .describe(
            `How many repositories to return (1–${MAX_SEARCH_RESULTS}, default ${SEARCH_LIMIT}).`,
          ),
      }),
      annotations: { title: "Search diagrams", ...READ_ONLY },
    },
    ({ query, limit }) =>
      runTool(request, "find_repository_diagrams", clientName, () =>
        findRepositoryDiagrams(query, limit ?? SEARCH_LIMIT),
      ),
  );

  if (VIDEOS_ENABLED)
    server.registerTool(
      "get_explainer_video",
      {
        title: "Get a GitHub repository's explainer video",
        description:
          "Get GitDiagram's narrated explainer video of a public GitHub repository, if one has been made: the link to watch and share it, its title and length, and the full narration transcript, a plain-language walkthrough of what the project is for, what people do with it and how its main parts fit together. Use it when the user wants a video about a repository, something to watch or share instead of read, or a short spoken-style summary of a project. Read-only: it never makes a video; when none exists it says so and links the page where one can be made.",
        inputSchema: repositoryInput,
        annotations: { title: "Get explainer video", ...READ_ONLY },
      },
      ({ repository }) =>
        runTool(request, "get_explainer_video", clientName, () =>
          getExplainerVideo(repository),
        ),
    );

  return server;
}
