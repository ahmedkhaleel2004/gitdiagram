import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/main-card", () => ({ default: () => null }));
vi.mock("~/components/hero", () => ({ default: () => null }));

import { JsonLd } from "~/components/json-ld";
import HomePage from "./page";

describe("home page", () => {
  it("describes GitDiagram as a free web application with the URL trick", () => {
    const children = (
      HomePage().props as { children: ReactNode[] }
    ).children.filter(isValidElement);
    const script = children.find((child) => child.type === JsonLd) as
      | ReactElement<{ data: { "@graph": Array<Record<string, unknown>> } }>
      | undefined;
    const [app] = script!.props.data["@graph"];

    expect(app).toMatchObject({
      "@type": "WebApplication",
      url: "https://gitdiagram.com",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    });
    expect(app!.description).toContain(
      'Replace "hub" with "diagram" in any GitHub URL',
    );
    // No FAQPage: the home page shows no questions.
    expect(
      script!.props.data["@graph"].some((node) => node["@type"] === "FAQPage"),
    ).toBe(false);
  });
});
