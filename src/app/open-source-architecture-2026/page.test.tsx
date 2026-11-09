import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  REPORT,
  REPORT_DATASET,
  reportMarkdown,
} from "~/features/architecture-report/content";
import ArchitectureReportPage, { metadata } from "./page";

afterEach(cleanup);

describe("/open-source-architecture-2026", () => {
  it("has a canonical URL, a short title and its own social image", () => {
    expect(metadata.alternates?.canonical).toBe(
      "/open-source-architecture-2026",
    );
    expect(String(metadata.title).length).toBeLessThanOrEqual(60);
    expect(JSON.stringify(metadata.openGraph)).toContain(
      "/open-source-architecture-2026/opengraph-image",
    );
  });

  it("links examples to their diagram pages and offers the dataset", () => {
    const { container } = render(<ArchitectureReportPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: /most-starred/i }),
    ).toBeInTheDocument();
    const top = REPORT.topTen[0]!;
    expect(
      screen.getAllByRole("link", { name: top.repository })[0],
    ).toHaveAttribute("href", top.url.replace("https://gitdiagram.com", ""));
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain(REPORT_DATASET.csv);
    expect(hrefs).toContain(REPORT_DATASET.json);
    // Example links stay on gitdiagram.com repository pages.
    for (const href of hrefs) {
      expect(href).toMatch(/^(\/|https:\/\/(github\.com|creativecommons))/);
    }
  });

  it("describes itself as an article based on a dataset", () => {
    const { container } = render(<ArchitectureReportPage />);
    const script = container.querySelector(
      'script[type="application/ld+json"]',
    );
    const graph = JSON.parse(script!.innerHTML)["@graph"] as Array<{
      "@type": string;
    }>;
    expect(graph.map((node) => node["@type"])).toEqual([
      "Article",
      "Dataset",
      "BreadcrumbList",
    ]);
  });

  it("keeps the numbers consistent between the data and the Markdown", () => {
    expect(REPORT.sample.size).toBe(1000);
    const markdown = reportMarkdown();
    for (const era of REPORT.byEra) {
      expect(markdown).toContain(`${era.agentActor}%`);
    }
    expect(markdown).toContain(REPORT_DATASET.csv);
  });
});
