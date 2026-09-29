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
