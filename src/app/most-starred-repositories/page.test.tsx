import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  POPULAR,
  formatStars,
  popularMarkdown,
} from "~/features/popular-repos/content";
import { GET as markdown } from "../most-starred-repositories.md/route";
import MostStarredRepositoriesPage, { metadata } from "./page";

afterEach(cleanup);

describe("/most-starred-repositories", () => {
  it("has a canonical URL, a short title and a Markdown twin", () => {
    expect(metadata.alternates?.canonical).toBe("/most-starred-repositories");
    expect(String(metadata.title).length).toBeLessThanOrEqual(60);
    expect(metadata.alternates?.types).toEqual({
      "text/markdown": "/most-starred-repositories.md",
    });
  });

  it("links every listed repository to its lowercase diagram page", () => {
    const { container } = render(<MostStarredRepositoriesPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /most-starred/i }),
    ).toBeInTheDocument();
    const hrefs = new Set(
      Array.from(container.querySelectorAll("ol a")).map((a) =>
        a.getAttribute("href"),
      ),
    );
    expect(hrefs.size).toBe(POPULAR.entries.length);
    for (const entry of POPULAR.entries) {
      expect(hrefs).toContain(`/${entry.repository.toLowerCase()}`);
    }
  });

  it("lists the repositories most stars first", () => {
    const stars = POPULAR.entries.map((entry) => entry.stars);
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
  });

  it("serves the same list as Markdown", async () => {
    const response = markdown();
    expect(response.headers.get("content-type")).toContain("text/markdown");
    const body = await response.text();
    expect(body).toBe(popularMarkdown());
    const first = POPULAR.entries[0];
    if (first) {
      expect(body).toContain(
        `1. [${first.repository}](https://gitdiagram.com/${first.repository.toLowerCase()})`,
      );
    }
  });

  it("writes star counts the way GitHub does", () => {
    expect(formatStars(561_204)).toBe("561k");
    expect(formatStars(34_629)).toBe("34.6k");
    expect(formatStars(26_000)).toBe("26k");
    expect(formatStars(950)).toBe("950");
  });
});
