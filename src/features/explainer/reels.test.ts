import { describe, expect, it } from "vitest";
import type { VideoCard } from "./catalog-types";
import { cardOf, newCards, parseReelParam, reelPath, shuffled } from "./reels";
import type { VideoArtifact } from "./types";

const card = (owner: string, repo: string): VideoCard => ({
  owner,
  repo,
  title: `${repo} explained`,
  opening: "",
  durationSeconds: 60,
  stars: 10,
  language: "TypeScript",
  createdAt: "2026-09-25T00:00:00.000Z",
});

describe("reels", () => {
  it("links a reel by its repository and reads that link back", () => {
    const path = reelPath({ owner: "tldraw", repo: "tldraw" });
    expect(path).toBe("/reels?v=tldraw%2Ftldraw");
    const value = new URL(path, "https://gitdiagram.com").searchParams.get("v");
    expect(parseReelParam(value)).toEqual({ owner: "tldraw", repo: "tldraw" });
  });

  it("ignores links that do not name a repository", () => {
    for (const value of [
      null,
      "",
      "tldraw",
      "a/b/c",
      "../x",
      "a/..",
      "-a/b",
      "a/<b>",
    ])
      expect(parseReelParam(value)).toBeNull();
  });

  it("adds only cards the feed does not have, whatever their case", () => {
    const feed = [card("acme", "demo")];
    const more = [
      card("ACME", "Demo"),
      card("acme", "other"),
      card("acme", "other"),
    ];
    expect(newCards(feed, more).map((c) => c.repo)).toEqual(["other"]);
  });

  it("shuffles without losing or repeating a card", () => {
    const cards = Array.from({ length: 20 }, (_, i) => card("o", `r${i}`));
    const order = shuffled(cards, () => 0.3);
    expect(order).not.toEqual(cards);
    expect([...order].sort((a, b) => a.repo.localeCompare(b.repo))).toEqual(
      [...cards].sort((a, b) => a.repo.localeCompare(b.repo)),
    );
    expect(cards[0]!.repo).toBe("r0");
  });

  it("makes a card from a video opened by link", () => {
    const video = {
      createdAt: "2026-09-25T00:00:00.000Z",
      meta: { owner: "acme", repo: "demo", stars: 42, language: "Go" },
      plan: { title: "Demo, explained", beats: [{ narration: "It runs." }] },
      timing: { DURATION: 57.4 },
    } as unknown as VideoArtifact;
    expect(cardOf(video)).toMatchObject({
      owner: "acme",
      repo: "demo",
      title: "Demo, explained",
      opening: "It runs.",
      durationSeconds: 57,
      stars: 42,
    });
  });
});
