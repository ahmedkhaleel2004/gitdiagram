import "server-only";

import {
  CLIENT_INFO_META_KEY,
  createMcpHandler,
} from "@modelcontextprotocol/server";
import { after } from "next/server";

import { createGitDiagramMcpServer } from "./server";
import { normalizeClientName, recordMcpConnect } from "./usage";

// The HTTP face of the MCP server at /mcp (src/app/mcp/route.ts): streamable
// HTTP, stateless. The SDK serves 2026-07-28 clients and falls back to
// per-request stateless serving for 2025-era ones (whose GET/DELETE session
// operations get 405). It is a public, read-only API with no cookies or
// credentials, so any origin may call it (browser-based MCP clients need
// CORS), and the same-origin guards of the site's own API do not apply.

/** Tool calls are tiny JSON-RPC messages; anything bigger is refused. */
const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  // "*" covers every header but Authorization, which must be named.
  "Access-Control-Allow-Headers": "*, Authorization",
  "Access-Control-Expose-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const ABOUT = `GitDiagram MCP server (streamable HTTP).

Architecture diagrams and explanations of public GitHub repositories, for AI agents.
Tools: get_repository_diagram, find_repository_diagrams, get_explainer_video.

Claude Code:  claude mcp add --transport http gitdiagram https://gitdiagram.com/mcp
Codex:        codex mcp add gitdiagram --url https://gitdiagram.com/mcp
Cursor:       add {"mcpServers": {"gitdiagram": {"url": "https://gitdiagram.com/mcp"}}} to ~/.cursor/mcp.json
`;

interface JsonRpcMessage {
  method?: unknown;
  params?: {
    clientInfo?: { name?: unknown };
    _meta?: Record<string, unknown>;
  };
}

/**
 * The client's self-reported name from a JSON-RPC body: `clientInfo` on a
 * 2025-era `initialize`, or the per-request `_meta` envelope of 2026-07-28.
 * `handshake` is true for `initialize` and `server/discover`, which the
 * counts treat as one new session.
 */
export function describeClient(body: unknown): {
  name: string | null;
  handshake: boolean;
} {
  const message = (Array.isArray(body) ? body[0] : body) as
    JsonRpcMessage | undefined;
  if (!message || typeof message !== "object")
    return { name: null, handshake: false };
  const meta = message.params?._meta?.[CLIENT_INFO_META_KEY] as
    { name?: unknown } | undefined;
  return {
    name: normalizeClientName(message.params?.clientInfo?.name ?? meta?.name),
    handshake:
      message.method === "initialize" || message.method === "server/discover",
  };
}

async function peekBody(request: Request): Promise<unknown> {
  if (request.method !== "POST") return undefined;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return undefined;
  try {
    const body = await request.clone().text();
    return body.length > MAX_BODY_BYTES ? undefined : JSON.parse(body);
  } catch {
    return undefined;
  }
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(CORS_HEADERS))
    headers.set(name, value);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });

  // A person opening the URL: say what it is instead of a bare 405.
  if (
    request.method === "GET" &&
    !(request.headers.get("accept") ?? "").includes("text/event-stream")
  )
    return withCors(
      new Response(ABOUT, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
    );

  const client = describeClient(await peekBody(request));
  if (client.handshake && client.name) {
    const name = client.name;
    try {
      after(() => recordMcpConnect(name));
    } catch {
      void recordMcpConnect(name);
    }
  }

  const handler = createMcpHandler(
    ({ requestInfo }) =>
      createGitDiagramMcpServer(requestInfo ?? request, client.name),
    {
      legacy: "stateless",
      // One JSON answer per request: nothing here streams progress, and a
      // serverless function should not hold a stream open.
      responseMode: "json",
      maxSubscriptions: 0,
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) =>
        console.warn(
          JSON.stringify({
            event: "mcp.request_rejected",
            error: error.message.slice(0, 200),
          }),
        ),
    },
  );
  return withCors(await handler.fetch(request));
}
