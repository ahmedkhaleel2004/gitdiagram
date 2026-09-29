import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MCP_SERVER_VERSION } from "./server";

// server.json (repo root) is what the owner publishes to the official MCP
// Registry; it must describe the server this code runs.
describe("server.json", () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "server.json"), "utf8"),
  ) as {
    name: string;
    version: string;
    description: string;
    remotes: Array<{ type: string; url: string }>;
  };

  it("matches the running server's version and endpoint", () => {
    expect(manifest.version).toBe(MCP_SERVER_VERSION);
    expect(manifest.remotes).toEqual([
      { type: "streamable-http", url: "https://gitdiagram.com/mcp" },
    ]);
  });

  it("uses the domain namespace and the registry's length limit", () => {
    expect(manifest.name).toBe("com.gitdiagram/gitdiagram");
    expect(manifest.description.length).toBeLessThanOrEqual(100);
  });
});

// The agent plugins (Claude Code, Cursor, Gemini CLI) install this same
// server; keep their endpoint and version in step with it.
describe("agent plugin manifests", () => {
  const read = (path: string) =>
    JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as {
      version?: string;
      mcpServers: Record<string, Record<string, string>>;
    };
  const url = "https://gitdiagram.com/mcp";

  it("point at the running server", () => {
    expect(read("plugins/gitdiagram/.mcp.json").mcpServers.gitdiagram).toEqual({
      type: "http",
      url,
    });
    expect(
      read("plugins/gitdiagram/.cursor-plugin/plugin.json").mcpServers
        .gitdiagram,
    ).toEqual({ url });
    expect(read("gemini-extension.json").mcpServers.gitdiagram).toEqual({
      httpUrl: url,
    });
  });

  it("carry the server's version", () => {
    for (const path of [
      "plugins/gitdiagram/.claude-plugin/plugin.json",
      "plugins/gitdiagram/.cursor-plugin/plugin.json",
      "gemini-extension.json",
    ])
      expect(read(path).version, path).toBe(MCP_SERVER_VERSION);
  });
});
