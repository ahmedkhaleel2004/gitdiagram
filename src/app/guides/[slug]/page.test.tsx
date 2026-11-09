import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { guidePlainText } from "~/features/guide/content";
import { SITUATION_PAGES } from "~/features/situations/content";
import SituationPageView, {
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

describe("/guides/[slug]", () => {
  it("prerenders every guide and nothing else", () => {
    expect(generateStaticParams()).toEqual(
      SITUATION_PAGES.map((page) => ({ slug: page.slug })),
    );
  });

  it.each(SITUATION_PAGES)(
    "$slug: canonical, share picture, answer first, structured data",
    async (page) => {
      const metadata = await generateMetadata({
        params: Promise.resolve({ slug: page.slug }),
      });
      expect(metadata.alternates?.canonical).toBe(`/guides/${page.slug}`);
      expect(JSON.stringify(metadata.openGraph)).toContain(
        "/opengraph-image.png",
      );

      const { container } = render(
        await SituationPageView({
          params: Promise.resolve({ slug: page.slug }),
        }),
      );
      expect(
        screen.getByRole("heading", { level: 1, name: page.title }),
      ).toBeInTheDocument();
      // The paragraph right after the date line is the answer.
      const paragraphs = container.querySelectorAll("article > p");
      expect(paragraphs[1]!.textContent).toBe(guidePlainText(page.answer));

      const steps = screen.getByRole("region", { name: page.stepsHeading });
      expect(within(steps).getAllByRole("listitem")).toHaveLength(
        page.steps.length,
      );

      const example = screen.getByRole("region", {
        name: page.example.heading,
      });
      const picture = within(example).getByRole("img");
      expect(picture).toHaveAttribute(
        "src",
        `/${page.example.repo}/diagram.png`,
      );
      expect(picture.closest("a")).toHaveAttribute(
        "href",
        `/${page.example.repo}`,
      );

      const graph = jsonLd(container)["@graph"];
      const types = graph.map((node) => node["@type"]);
      expect(types).toEqual(
        expect.arrayContaining(["TechArticle", "HowTo", "BreadcrumbList"]),
      );
      const howTo = graph.find((node) => node["@type"] === "HowTo") as {
        step: Array<{ name: string }>;
      };
      expect(howTo.step.map((step) => step.name)).toEqual(
        page.steps.map((step) => step.name),
      );
      const faq = graph.find((node) => node["@type"] === "FAQPage") as
        { mainEntity: Array<{ name: string }> } | undefined;
      expect(faq?.mainEntity.map((entry) => entry.name) ?? []).toEqual(
        page.questions.map((question) => question.question),
      );
      if (page.questions.length) {
        const questions = screen.getByRole("region", { name: "Questions" });
        for (const { question, answer } of page.questions) {
          expect(
            within(questions).getByRole("heading", {
              level: 3,
              name: question,
            }),
          ).toBeInTheDocument();
          expect(questions.textContent).toContain(guidePlainText(answer));
        }
      }

      const sources = screen.getByRole("region", { name: "Sources" });
      for (const source of page.sources)
        expect(
          within(sources).getByRole("link", { name: source.label }),
        ).toHaveAttribute("href", source.url);
    },
  );
});
