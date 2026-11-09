import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./ai-ask", () => ({
  askAssistant: vi.fn(),
  aiVisibilityModels: () => ({ openai: "gpt", anthropic: "claude" }),
}));

import { askPanelEngine, citedIndexes } from "./ai-panel-ask";

afterEach(() => {
  vi.unstubAllGlobals();
});

const reply = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), init);

describe("askPanelEngine through OpenRouter", () => {
  it("reads Perplexity's [n] markers as its citations", async () => {
    expect([...citedIndexes("A [1] and B[3], [12]")]).toEqual([1, 3, 12]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: "Try GitDiagram [2].",
                annotations: [
                  {
                    type: "url_citation",
                    url_citation: { url: "https://a.com/" },
                  },
                  {
                    type: "url_citation",
                    url_citation: { url: "https://gitdiagram.com/" },
                  },
                ],
              },
            },
          ],
          usage: { cost: 0.0052 },
        }),
      ),
    );
    const out = await askPanelEngine(
      "perplexity",
      "q",
      AbortSignal.timeout(5_000),
    );
    expect(out.citations).toEqual(["https://gitdiagram.com/"]);
    expect(out.sources).toEqual(["https://a.com/", "https://gitdiagram.com/"]);
    expect(out.costUsd).toBe(0.0052);
    expect(out.model).toBe("perplexity/sonar");
  });

  it("follows Gemini's grounding redirects, falling back to the site's name", async () => {
    const redirect =
      "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/chat/completions")) {
          const body = JSON.parse(String(init?.body));
          expect(body.plugins).toEqual([{ id: "web", engine: "native" }]);
          return reply({
            choices: [
              {
                message: {
                  content: "GitDiagram",
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: { url: redirect, title: "gitdiagram.com" },
                    },
                    {
                      type: "url_citation",
                      url_citation: {
                        url: `${redirect}2`,
                        title: "reddit.com",
                      },
                    },
                  ],
                },
              },
            ],
            usage: { cost: 0.03 },
          });
        }
        if (url === redirect)
          return new Response(null, {
            status: 302,
            headers: { location: "https://gitdiagram.com/facebook/react" },
          });
        throw new Error("offline");
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await askPanelEngine("gemini", "q", AbortSignal.timeout(5_000));
    expect(out.citations).toEqual([
      "https://gitdiagram.com/facebook/react",
      "https://reddit.com/",
    ]);
  });

  it("throws OpenRouter's error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        reply({ error: { message: "No credits" } }, { status: 402 }),
      ),
    );
    await expect(
      askPanelEngine("perplexity", "q", AbortSignal.timeout(5_000)),
    ).rejects.toThrow("OpenRouter 402: No credits");
  });
});
