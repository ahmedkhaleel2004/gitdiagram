import { handleMcpRequest } from "~/server/mcp/handler";

// GitDiagram's remote MCP server: https://gitdiagram.com/mcp (see
// src/server/mcp/). Stateless streamable HTTP; public and read-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export {
  handleMcpRequest as GET,
  handleMcpRequest as POST,
  handleMcpRequest as DELETE,
  handleMcpRequest as OPTIONS,
};
