import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// plugins/gitdiagram is the plugin package submitted to OpenAI's plugin
// directory (ChatGPT and Codex), zipped from that folder. These checks mirror
// the portal's listing limits so a bad package fails here, not in review.

const root = join(process.cwd(), "plugins/gitdiagram");
const read = (file: string) =>
  JSON.parse(readFileSync(join(root, file), "utf8")) as Record<string, never>;

interface Manifest {
  name: string;
  version: string;
  extensions: {
    "com.openai": {
      interface: Record<string, string | string[]>;
      review: {
        test_cases: {
          positive: Array<Record<string, string>>;
          negative: Array<Record<string, string>>;
        };
      };
    };
  };
}

const manifest = read("plugin.json") as unknown as Manifest;
const openai = manifest.extensions["com.openai"];
const listing = openai.interface;

describe("the OpenAI plugin package", () => {
  it("points at the live MCP server", () => {
    const mcp = read("mcp.json") as unknown as {
      mcpServers: Record<string, { type: string; url: string }>;
    };
    expect(Object.values(mcp.mcpServers)).toEqual([
      { type: "streamable-http", url: "https://gitdiagram.com/mcp" },
    ]);
  });

  it("keeps listing text within the portal's limits", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((listing.displayName as string).length).toBeLessThanOrEqual(30);
    expect((listing.shortDescription as string).length).toBeLessThanOrEqual(30);
    expect((listing.longDescription as string).length).toBeLessThanOrEqual(
      4000,
    );
    const prompts = listing.defaultPrompt as string[];
    expect(prompts.length).toBeLessThanOrEqual(3);
    for (const prompt of prompts)
      expect(prompt.length).toBeLessThanOrEqual(128);
    expect(listing.longDescription).not.toMatch(/\bfree\b|\$\d|price/i);
  });

  it("links the four pages review requires, on the site", () => {
    for (const key of [
      "websiteURL",
      "supportURL",
      "privacyPolicyURL",
      "termsOfServiceURL",
    ])
      expect(listing[key]).toMatch(/^https:\/\/gitdiagram\.com(\/|$)/);
    for (const page of ["support", "privacy", "terms"])
      expect(existsSync(join(process.cwd(), `src/app/${page}/page.tsx`))).toBe(
        true,
      );
  });

  it("includes every file it references", () => {
    for (const key of ["logo", "composerIcon"])
      expect(existsSync(join(root, listing[key] as string))).toBe(true);
    expect(existsSync(join(root, "skills/repo-architecture/SKILL.md"))).toBe(
      true,
    );
  });

  it("has the five positive and three negative review cases", () => {
    const { positive, negative } = openai.review.test_cases;
    expect(positive).toHaveLength(5);
    expect(negative).toHaveLength(3);
    const tools = new Set([
      "get_repository_diagram",
      "find_repository_diagrams",
      "get_explainer_video",
    ]);
    for (const testCase of positive) {
      expect(testCase.expected_behavior).toBeTruthy();
      for (const tool of testCase.tools_triggered!.split(/,\s*/))
        expect(tools.has(tool)).toBe(true);
    }
  });
});
