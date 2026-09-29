// GitDiagram publishes nothing under /.well-known/. Without this route the
// repository page ([username]/[repo]) answers /.well-known/oauth-protected-resource
// and /.well-known/oauth-authorization-server with a 200 HTML page, which MCP
// clients (Claude's connector setup among them) read as OAuth metadata for the
// sign-in-free server at /mcp, and then fail to register a client.

export function GET(): Response {
  return Response.json(
    { error: "not_found" },
    { status: 404, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
