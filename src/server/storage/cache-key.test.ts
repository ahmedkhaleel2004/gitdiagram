// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canPersistVisibility,
  getPrivateLocation,
  getPublicCommitKeyPrefix,
  getPublicLocation,
  getPublicPreviewKey,
  getReadLocations,
  getWriteLocation,
} from "~/server/storage/cache-key";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.CACHE_KEY_SECRET = "test-cache-key-secret";
  process.env.R2_PUBLIC_BUCKET = "public-bucket";
  process.env.R2_PRIVATE_BUCKET = "private-bucket";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("private namespace", () => {
  it("separates callers by their own token", () => {
    const first = getPrivateLocation("acme", "demo", "token-one");
    const second = getPrivateLocation("acme", "demo", "token-two");

    expect(first.artifactKey).not.toBe(second.artifactKey);
    expect(first.bucket).toBe("private-bucket");
  });

  it("refuses an empty token instead of writing to a shared namespace", () => {
    // Hashing "" yields one fixed namespace for every caller, and no read path
    // ever consults it, so an artifact written there is silently unreachable.
    expect(() => getPrivateLocation("acme", "demo", "")).toThrow(
      /non-empty GitHub token/u,
    );
    expect(() => getPrivateLocation("acme", "demo", "   ")).toThrow(
      /non-empty GitHub token/u,
    );
  });
});

describe("getPublicPreviewKey", () => {
  it("lives in a namespace no artifact key can reach", () => {
    // Dots are legal in repo names and survive normalization, so the sidecar
    // for repo "app" must never share a key with the artifact for repo
    // "app.preview" — that collision let a preview write destroy an artifact.
    expect(getPublicPreviewKey("acme", "app")).not.toBe(
      getPublicLocation("acme", "app.preview").artifactKey,
    );
    expect(getPublicPreviewKey("acme", "app")).toBe(
      "public-preview/v1/acme/app.json",
    );
    expect(getPublicPreviewKey("acme", "app")).not.toMatch(/^public\//u);
  });
});

describe("getWriteLocation", () => {
  it("sends public results to the public bucket", () => {
    expect(
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "public",
      }).bucket,
    ).toBe("public-bucket");
  });

  it("throws for a private result the caller did not authenticate for", () => {
    expect(() =>
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "private",
      }),
    ).toThrow(/non-empty GitHub token/u);
  });
});

describe("canPersistVisibility", () => {
  it("mirrors the destinations getWriteLocation can actually resolve", () => {
    expect(canPersistVisibility({ visibility: "public" })).toBe(true);
    expect(
      canPersistVisibility({ visibility: "private", githubPat: "token" }),
    ).toBe(true);
    expect(canPersistVisibility({ visibility: "private" })).toBe(false);
    expect(
      canPersistVisibility({ visibility: "private", githubPat: "  " }),
    ).toBe(false);
  });
});

describe("getReadLocations", () => {
  it("never reaches the private bucket without a token", () => {
    const locations = getReadLocations({ username: "acme", repo: "demo" });

    expect(locations).toHaveLength(1);
    expect(locations[0]?.visibility).toBe("public");
  });

  it("prefers the caller's private namespace, then falls back to public", () => {
    const locations = getReadLocations({
      username: "acme",
      repo: "demo",
      githubPat: "token",
    });

    expect(locations.map((location) => location.visibility)).toEqual([
      "private",
      "public",
    ]);
  });
});

describe("commit locations", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const otherSha = "89abcdef0123456789abcdef0123456789abcdef";

  it("keeps the default-branch keys exactly as they were", () => {
    expect(getPublicLocation("acme", "demo")).toEqual({
      visibility: "public",
      bucket: "public-bucket",
      artifactKey: "public/v1/acme/demo.json",
      statusKey: "status:v1:public:acme:demo",
    });
    expect(
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "public",
      }),
    ).toEqual(getPublicLocation("acme", "demo"));
    expect(
      getPrivateLocation("acme", "demo", "token").artifactKey,
    ).not.toContain("/commit/");
  });

  it("puts the full SHA in the public artifact and status keys", () => {
    const location = getPublicLocation("acme", "demo", sha);

    expect(location.bucket).toBe("public-bucket");
    expect(location.artifactKey).toBe(`public/v1/acme/demo/commit/${sha}.json`);
    expect(location.statusKey).toBe(`status:v1:public:acme:demo:commit:${sha}`);
    expect(getPublicCommitKeyPrefix("acme", "demo")).toBe(
      "public/v1/acme/demo/commit/",
    );
  });

  it("puts the full SHA in the private keys, inside the caller's namespace", () => {
    const location = getPrivateLocation("acme", "demo", "token-one", sha);
    const defaultLocation = getPrivateLocation("acme", "demo", "token-one");

    expect(location.bucket).toBe("private-bucket");
    expect(location.artifactKey).toMatch(
      new RegExp(
        `^private/v1/[0-9a-f]{64}/acme/demo/commit/${sha}\\.json$`,
        "u",
      ),
    );
    expect(
      location.artifactKey.startsWith(
        defaultLocation.artifactKey.replace(/\.json$/u, "/"),
      ),
    ).toBe(true);
    expect(location.statusKey).toBe(
      `${defaultLocation.statusKey}:commit:${sha}`,
    );
    // Another token reaches another namespace, commit or not.
    expect(
      getPrivateLocation("acme", "demo", "token-two", sha).artifactKey,
    ).not.toBe(location.artifactKey);
  });

  it("keeps commits, the default branch and visibilities apart", () => {
    const keys = [
      getPublicLocation("acme", "demo"),
      getPublicLocation("acme", "demo", sha),
      getPublicLocation("acme", "demo", otherSha),
      getPrivateLocation("acme", "demo", "token"),
      getPrivateLocation("acme", "demo", "token", sha),
      getPrivateLocation("acme", "demo", "token", otherSha),
    ];

    expect(new Set(keys.map((location) => location.artifactKey)).size).toBe(
      keys.length,
    );
    expect(new Set(keys.map((location) => location.statusKey)).size).toBe(
      keys.length,
    );
    // A repository named like the commit folder cannot reach another's key.
    expect(getPublicLocation("acme", "demo/commit", sha).artifactKey).not.toBe(
      getPublicLocation("acme", "demo", sha).artifactKey,
    );
  });

  it("normalizes the SHA's case so one commit has one key", () => {
    expect(getPublicLocation("acme", "demo", sha.toUpperCase())).toEqual(
      getPublicLocation("acme", "demo", sha),
    );
  });

  it.each([
    "",
    "abc1234",
    "main",
    sha.slice(0, 39),
    `${sha}0`,
    `${sha.slice(0, 39)}g`,
  ])("refuses %j: only a full SHA names an immutable artifact", (commit) => {
    expect(() => getPublicLocation("acme", "demo", commit)).toThrow(
      /full 40-character commit SHA/u,
    );
    expect(() => getPrivateLocation("acme", "demo", "token", commit)).toThrow(
      /full 40-character commit SHA/u,
    );
  });

  it("threads the commit through the write and read locations", () => {
    expect(
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "public",
        commit: sha,
      }),
    ).toEqual(getPublicLocation("acme", "demo", sha));
    expect(
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "private",
        githubPat: "token",
        commit: sha,
      }),
    ).toEqual(getPrivateLocation("acme", "demo", "token", sha));
    expect(
      getReadLocations({
        username: "acme",
        repo: "demo",
        githubPat: "token",
        commit: sha,
      }),
    ).toEqual([
      getPrivateLocation("acme", "demo", "token", sha),
      getPublicLocation("acme", "demo", sha),
    ]);
    expect(
      getReadLocations({ username: "acme", repo: "demo", commit: sha }),
    ).toEqual([getPublicLocation("acme", "demo", sha)]);
  });
});
