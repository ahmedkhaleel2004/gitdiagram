import "server-only";

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  DIAGRAM_META_KEY,
  type DiagramViewPayload,
} from "~/features/mcp-app/diagram-payload";
import { SITE_URL } from "~/lib/site";

// The diagram view: an MCP App (the open standard ChatGPT's plugins use for
// UI) that get_repository_diagram shows inline, so a person in a chat sees
// the interactive diagram, not just its description. The resource is a small
// HTML shell; its script (src/mcp-app/diagram-view.ts, built into
// public/mcp-app/ by scripts/build-mcp-app.mjs) is served from the site, the
// only origin its content security policy allows. Hosts without MCP Apps
// ignore all of this and read the tool's text.

/** Bump the version with any change old hosts' cached shells can't load. */
export const DIAGRAM_VIEW_URI = "ui://gitdiagram/diagram-view-v1.html";

/**
 * Where the view's script is served from: the site, or MCP_APP_ORIGIN (an
 * https origin, or http on localhost) to try the view from a tunnel or a
 * preview deployment.
 */
export function mcpAppOrigin(
  value = process.env.MCP_APP_ORIGIN?.trim(),
): string {
  if (!value) return SITE_URL;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "https:" || (url.protocol === "http:" && local))
      return url.origin;
  } catch {
    // Fall through to the site.
  }
  return SITE_URL;
}

const STYLES = `
:root {
  color-scheme: light;
  --gd-bg: #ffffff;
  --gd-fg: #171717;
  --gd-muted: #525252;
  --gd-line: rgba(0, 0, 0, 0.12);
  --gd-button: #f5f5f5;
  --gd-button-hover: #e5e5e5;
  --gd-accent: #7c3aed;
  --gd-accent-fg: #ffffff;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --gd-bg: #1f2631;
  --gd-fg: #e8edf5;
  --gd-muted: #a3adbd;
  --gd-line: rgba(255, 255, 255, 0.14);
  --gd-button: #2c3544;
  --gd-button-hover: #364154;
  --gd-accent: #a78bfa;
  --gd-accent-fg: #1f1235;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--gd-bg); color: var(--gd-fg); }
.gd { display: flex; flex-direction: column; height: 480px; }
:root[data-display="fullscreen"] .gd { height: 100vh; }
.gd-bar {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--gd-line);
}
.gd-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 14px; }
.gd-title strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gd-stars { color: var(--gd-muted); font-size: 12px; white-space: nowrap; }
.gd-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.gd-button {
  min-width: 36px; min-height: 32px; padding: 0 10px; border: 1px solid var(--gd-line);
  border-radius: 8px; background: var(--gd-button); color: var(--gd-fg);
  font: inherit; font-size: 13px; cursor: pointer;
}
.gd-button:hover { background: var(--gd-button-hover); }
.gd-button:focus-visible, .gd-stage:focus-visible { outline: 2px solid var(--gd-accent); outline-offset: 2px; }
.gd-primary { background: var(--gd-accent); border-color: var(--gd-accent); color: var(--gd-accent-fg); font-weight: 600; }
.gd-primary:hover { background: var(--gd-accent); filter: brightness(1.08); }
.gd-stage {
  position: relative; flex: 1; min-height: 0; overflow: hidden;
  cursor: grab; touch-action: pan-x pan-y; user-select: none; -webkit-user-select: none;
}
.gd-stage[data-dragging="true"] { cursor: grabbing; }
.gd-canvas { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.gd-canvas svg { display: block; overflow: visible; }
.gd-hint { margin: 0; padding: 6px 12px 8px; color: var(--gd-muted); font-size: 12px; }
.gd-message, .gd-status {
  margin: auto; padding: 24px; max-width: 32rem; text-align: center; font-size: 14px; line-height: 1.5;
}
.gd-message p { margin: 0 0 14px; }
`;

export function diagramViewHtml(origin = mcpAppOrigin()): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitDiagram</title>
<style>${STYLES}</style>
</head>
<body>
<main id="gitdiagram-view" class="gd" aria-live="polite"><p class="gd-status">Loading the diagram…</p></main>
<script type="module" src="${origin}/mcp-app/diagram-view.js"></script>
</body>
</html>`;
}

export function diagramViewResourceMeta(origin = mcpAppOrigin()) {
  return {
    ui: {
      // Scripts, and Mermaid's chunks, come from the site; nothing is fetched.
      csp: { resourceDomains: [origin], connectDomains: [] },
      domain: SITE_URL,
      prefersBorder: true,
    },
    "openai/widgetDescription":
      "An interactive architecture diagram of the repository: people can pan, zoom, open it full screen, and click a component to open its code on GitHub.",
  };
}

export function registerDiagramView(server: McpServer): void {
  registerAppResource(
    server,
    "GitDiagram diagram view",
    DIAGRAM_VIEW_URI,
    {
      description:
        "Interactive view of a repository's architecture diagram, shown by get_repository_diagram.",
    },
    async () => ({
      contents: [
        {
          uri: DIAGRAM_VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: diagramViewHtml(),
          _meta: diagramViewResourceMeta(),
        },
      ],
    }),
  );
}

/** The tool descriptor `_meta` that attaches the view to a tool. */
export const DIAGRAM_VIEW_TOOL_META = {
  ui: { resourceUri: DIAGRAM_VIEW_URI },
  "openai/outputTemplate": DIAGRAM_VIEW_URI,
  "openai/toolInvocation/invoking": "Reading the architecture diagram…",
  "openai/toolInvocation/invoked": "Architecture diagram ready",
};

/** The tool result `_meta` for the view (hosts never show it to the model). */
export function diagramViewResultMeta(payload: DiagramViewPayload) {
  return { [DIAGRAM_META_KEY]: payload };
}
