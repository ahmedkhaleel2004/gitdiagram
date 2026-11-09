import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COMPARE_PAGES } from "~/features/compare/content";
import { guidePlainText } from "~/features/guide/content";
import ComparePageView, {
  generateMetadata,
  generateStaticParams,
} from "./page";

afterEach(cleanup);

function jsonLd(container: HTMLElement) {
  const script = container.querySelector('script[type="application/ld+json"]');
  return JSON.parse(script!.innerHTML) as {
    "@graph": Array<Record<string, unknown>>;
  };
}

describe("/compare/[tool]", () => {
  it("prerenders every comparison and nothing else", () => {
    expect(generateStaticParams()).toEqual(
      COMPARE_PAGES.map((page) => ({ tool: page.slug })),
    );
  });

  it.each(COMPARE_PAGES)(
    "$slug: canonical, share picture, verdict first",
    async (page) => {
      const metadata = await generateMetadata({
        params: Promise.resolve({ tool: page.slug }),
      });
      expect(metadata.alternates?.canonical).toBe(`/compare/${page.slug}`);
      expect(JSON.stringify(metadata.openGraph)).toContain(
        "/opengraph-image.png",
      );

      const { container } = render(
        await ComparePageView({ params: Promise.resolve({ tool: page.slug }) }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: page.title }),
      ).toBeInTheDocument();
      // The paragraph right after the date line is the verdict.
      const paragraphs = container.querySelectorAll("article > p");
      expect(paragraphs[1]!.textContent).toBe(guidePlainText(page.verdict));

      const choose = screen.getByRole("region", { name: "Which to choose" });
      expect(
        within(choose).getByRole("columnheader", {
          name: `Choose ${page.tool} when`,
        }),
      ).toBeInTheDocument();

      const graph = jsonLd(container)["@graph"];
      const faq = graph.find((node) => node["@type"] === "FAQPage") as {
        mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
      };
      expect(faq.mainEntity.map((entry) => entry.name)).toEqual(
        page.questions.map((question) => question.question),
      );
      const questions = screen.getByRole("region", { name: "Questions" });
      for (const { question, answer } of page.questions) {
        expect(
          within(questions).getByRole("heading", { level: 3, name: question }),
        ).toBeInTheDocument();
        expect(questions.textContent).toContain(guidePlainText(answer));
      }

      const sources = screen.getByRole("region", { name: "Sources" });
      for (const source of page.sources)
        expect(
          within(sources).getByRole("link", { name: source.label }),
        ).toHaveAttribute("href", source.url);
    },
  );
});
