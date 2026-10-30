import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config.js";

type Redirect = { source: string; destination: string; permanent: boolean };

/**
 * A redirect `source` as a test for a path, for the forms this config uses
 * (`:name`, `:name(a|b)`, `:name*`, `:name+`).
 */
function matcher(source: string) {
  const names: string[] = [];
  const pattern = source
    .split("/")
    .slice(1)
    .map((part) => {
      const named = /^:([A-Za-z]+)(\(([^)]*)\))?([*+])?$/.exec(part);
      if (!named) {
        if (/[:()*+?]/.test(part)) throw new Error(`Unsupported: ${source}`);
        return `/${part.replace(/[.\\^$|[\]{}]/g, "\\$&")}`;
      }
      names.push(named[1]!);
      const one = named[3] ? `(?:${named[3]})` : "[^/]+";
      if (named[4] === "*") return `(?:/(${one}(?:/[^/]+)*))?`;
      if (named[4] === "+") return `/(${one}(?:/[^/]+)*)`;
      return `/(${one})`;
    })
    .join("");
  const regex = new RegExp(`^${pattern}/?$`);
  return (path: string) => {
    const match = regex.exec(path);
    if (!match) return null;
    return Object.fromEntries(names.map((name, i) => [name, match[i + 1]]));
  };
}

const redirects = (await nextConfig.redirects!()) as Redirect[];

/** Where Next sends a request: the first redirect that matches, as it does. */
function redirectOf(path: string): string | null {
  for (const rule of redirects) {
    const params = matcher(rule.source)(path);
    if (!params) continue;
    return rule.destination.replace(
      /:([A-Za-z]+)/g,
      (_, name: string) => params[name] ?? "",
    );
  }
  return null;
}

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("next.config redirects of GitHub-style URLs", () => {
  it("does not redirect a commit page, so its diagram can be shown", () => {
    // A rule listing `commit` here once sent every commit URL to the
    // repository's own page, and the commit route was never reached.
    expect(redirectOf(`/acme/demo/commit/${SHA}`)).toBeNull();
    expect(redirectOf("/acme/demo/commit/0123456")).toBeNull();
    expect(redirectOf(`/acme/demo/commit/${SHA}/`)).toBeNull();
  });

  it("sends what lies under a commit page back to that commit's page", () => {
    expect(redirectOf(`/acme/demo/commit/${SHA}/checks`)).toBe(
      `/acme/demo/commit/${SHA}`,
    );
    expect(redirectOf(`/acme/demo/commit/${SHA}/a/b`)).toBe(
      `/acme/demo/commit/${SHA}`,
    );
  });

  it("sends a bare /commit to the repository", () => {
    expect(redirectOf("/acme/demo/commit")).toBe("/acme/demo");
  });

  it("keeps sending the other GitHub views to the repository", () => {
    for (const view of [
      "tree/main",
      "tree/main/src/a.ts",
      "blob/main/src/a.ts",
      "issues/3",
      "pull/4",
      "pulls",
      "commits/main",
      "releases/tag/v1",
      "actions/runs/9",
    ]) {
      expect(redirectOf(`/acme/demo/${view}`), view).toBe("/acme/demo");
    }
  });

  it("leaves the pages of the site alone", () => {
    for (const path of [
      "/acme/demo",
      "/acme/demo/video",
      "/acme/demo/llms.txt",
      "/acme/demo/opengraph-image",
      "/acme/demo/diagram.png",
    ]) {
      expect(redirectOf(path), path).toBeNull();
    }
  });
});
