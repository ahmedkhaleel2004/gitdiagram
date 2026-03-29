import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { BrowseCatalog } from "~/components/browse-catalog";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

describe("BrowseCatalog", () => {
  it("renders an empty state when no browse results match", () => {
    render(
      <BrowseCatalog
        result={{
          items: [],
          total: 0,
          page: 1,
          pageSize: 50,
          totalPages: 1,
          sort: "recent_desc",
          q: "",
          minStars: 0,
        }}
      />,
    );

    expect(
      screen.getByText("No diagrams match these filters"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open Diagram")).not.toBeInTheDocument();
  });

  it("renders rows and preserves filters in pagination links", () => {
    render(
      <BrowseCatalog
        result={{
          items: [
            {
              username: "vercel",
              repo: "next.js",
              lastSuccessfulAt: "2026-03-29T12:00:00.000Z",
              stargazerCount: 130000,
            },
          ],
          total: 60,
          page: 2,
          pageSize: 50,
          totalPages: 2,
          sort: "stars_desc",
          q: "Vercel",
          minStars: 100,
        }}
      />,
    );

    expect(screen.getByRole("link", { name: "vercel/next.js" })).toHaveAttribute(
      "href",
      "/vercel/next.js",
    );
    expect(screen.getByRole("link", { name: "Open Diagram" })).toHaveAttribute(
      "href",
      "/vercel/next.js",
    );
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/vercel/next.js",
    );
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/browse?q=Vercel&sort=stars_desc&minStars=100",
    );
    expect(screen.queryByTestId("mermaid-preview")).not.toBeInTheDocument();
  });
});
