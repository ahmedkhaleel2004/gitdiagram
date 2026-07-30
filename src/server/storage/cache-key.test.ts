// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canPersistVisibility,
  getPrivateLocation,
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
