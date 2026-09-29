import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GUIDE_QUESTIONS, guidePlainText } from "~/features/guide/content";
import VisualizeCodebasePage, { metadata } from "./page";

function jsonLd(container: HTMLElement) {
  const script = container.querySelector('script[type="application/ld+json"]');
  return JSON.parse(script!.innerHTML) as {
    "@graph": Array<Record<string, unknown>>;
  };
}

afterEach(cleanup);

describe("/visualize-codebase", () => {
  it("has a canonical URL and a title that fits a search result", () => {
    expect(metadata.alternates?.canonical).toBe("/visualize-codebase");
    expect(String(metadata.title).length).toBeLessThanOrEqual(60);
  });

  it("shows the one-step URL trick with links to real diagrams", () => {
    render(<VisualizeCodebasePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /visualize a codebase/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FastAPI" })).toHaveAttribute(
      "href",
      "/fastapi/fastapi",
    );
    expect(
      screen.getByRole("link", { name: "gitdiagram.com/fastapi/fastapi.md" }),
    ).toHaveAttribute("href", "/fastapi/fastapi.md");
    expect(
      screen.getAllByText("https://gitdiagram.com/mcp").length,
    ).toBeGreaterThan(0);
  });

  it("compares the alternatives honestly", () => {
    render(<VisualizeCodebasePage />);
    const alternatives = screen.getByRole("region", {
      name: "Other ways to visualize a codebase",
    });
    for (const name of [
      "DeepWiki",
      "Claude Code, Codex or another coding agent",
      "Sourcegraph",
      "IDE and language dependency graphs",
      "Drawing it yourself",
    ])
      expect(within(alternatives).getByText(name)).toBeInTheDocument();
    // Each alternative says plainly what it does better.
    const entries = alternatives.querySelectorAll("dd");
    expect(entries).toHaveLength(5);
    for (const entry of entries) expect(entry.textContent).toMatch(/Better /);
  });

  it("marks up exactly the visible questions as a FAQPage", () => {
    const { container } = render(<VisualizeCodebasePage />);
    const questions = screen.getByRole("region", { name: "Questions" });
    for (const { question } of GUIDE_QUESTIONS)
      expect(
        within(questions).getByRole("heading", { level: 3, name: question }),
      ).toBeInTheDocument();

    const faq = jsonLd(container)["@graph"].find(
      (node) => node["@type"] === "FAQPage",
    ) as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(faq.mainEntity.map((entry) => entry.name)).toEqual(
      GUIDE_QUESTIONS.map(({ question }) => question),
    );
    expect(faq.mainEntity[0]!.acceptedAnswer.text).toBe(
      guidePlainText(GUIDE_QUESTIONS[0]!.answer),
    );
  });
});
