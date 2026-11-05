import { describe, expect, it } from "vitest";

import { createPathFilter, parseIgnorePatterns } from "./ignore-rules";

describe("parseIgnorePatterns", () => {
  it("parses non-empty lines and strips comments", () => {
    const raw = `
      # Comments should be ignored
      plugins/
      tools/
      
      # Another comment
      *.min.js
      !plugins/game_plugin/
    `;
    const patterns = parseIgnorePatterns(raw);
    expect(patterns).toEqual([
      "plugins/",
      "tools/",
      "*.min.js",
      "!plugins/game_plugin/",
    ]);
  });
});

describe("createPathFilter", () => {
  it("returns false for everything when patterns are empty", () => {
    const filter = createPathFilter([]);
    expect(filter("src/index.ts")).toBe(false);
    expect(filter("plugins/foo.ts")).toBe(false);
  });

  it("handles directory-based exclusions like plugins/ (Issue #224)", () => {
    const filter = createPathFilter(["plugins/"]);
    expect(filter("plugins")).toBe(true);
    expect(filter("plugins/my_plugin/index.ts")).toBe(true);
    expect(filter("src/game/player.ts")).toBe(false);
    expect(filter("scripts/world.gd")).toBe(false);
  });

  it("handles root-anchored vs non-anchored directory patterns", () => {
    const rootFilter = createPathFilter(["/tools/"]);
    expect(rootFilter("tools/codegen.ts")).toBe(true);
    expect(rootFilter("src/tools/helper.ts")).toBe(false);

    const nonRootFilter = createPathFilter(["tools/"]);
    expect(nonRootFilter("tools/codegen.ts")).toBe(true);
    expect(nonRootFilter("src/tools/helper.ts")).toBe(true);
  });

  it("handles file extensions and wildcards", () => {
    const filter = createPathFilter(["*.log", "docs/**/*.md"]);
    expect(filter("app.log")).toBe(true);
    expect(filter("server/app.log")).toBe(true);
    expect(filter("docs/guide.md")).toBe(true);
    expect(filter("docs/sub/api.md")).toBe(true);
    expect(filter("docs/index.html")).toBe(false);
    expect(filter("src/index.ts")).toBe(false);
  });

  it("handles negation patterns", () => {
    const filter = createPathFilter(["plugins/", "!plugins/game_core/"]);
    expect(filter("plugins/third_party/addon.ts")).toBe(true);
    expect(filter("plugins/game_core/main.ts")).toBe(false);
    expect(filter("src/main.ts")).toBe(false);
  });
});
