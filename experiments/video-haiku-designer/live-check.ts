/**
 * One real film through production's writers as shipped: Opus 5.5 directs,
 * Haiku 5.5 (medium) designs with its cache warmed meanwhile, Sol behind both.
 * Prints each Claude call's cache use, the film's cost and time, and how many
 * beats came back designed.
 *
 *   bun --conditions=react-server experiments/video-haiku-designer/live-check.ts owner/repo
 */
import { createFilmWriters } from "~/server/explainer/director";
import { readRepositoryForVideo } from "~/server/explainer/repository";

const [username, repo] = (process.argv[2] ?? "pmndrs/zustand").split("/") as [
  string,
  string,
];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
  const started = performance.now();
  const response = await realFetch(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (!url.includes("api.anthropic.com")) return response;
  const body = JSON.parse(String((args[1] as RequestInit).body)) as {
    model: string;
    max_tokens: number;
  };
  void response
    .clone()
    .text()
    .then((text) => {
      const last = (name: string) =>
        Number(
          [...text.matchAll(new RegExp(`"${name}":(\\d+)`, "g"))].at(-1)?.[1] ??
            0,
        );
      console.info(
        `${body.model} max_tokens=${body.max_tokens} status=${response.status} ` +
          `in=${last("input_tokens")} write=${last("cache_creation_input_tokens")} ` +
          `read=${last("cache_read_input_tokens")} out=${last("output_tokens")} ` +
          `${Math.round(performance.now() - started)}ms`,
      );
    });
  return response;
}) as typeof fetch;

const repository = await readRepositoryForVideo({ username, repo });
const writers = createFilmWriters(
  repository.prompt,
  {
    model: "claude-opus-5-5",
    effort: "low",
    designer: { model: "claude-haiku-5-5", effort: "medium" },
    fallback: { model: "gpt-6.1-sol", effort: "medium" },
  },
  { images: repository.pictures },
);
const start = performance.now();
const script = await writers.direct();
const directed = performance.now();
const designed = await writers.design(script);
const done = performance.now();
await new Promise((resolve) => setTimeout(resolve, 500));
console.info(
  JSON.stringify({
    repo: `${username}/${repo}`,
    model: writers.model,
    beats: script.beats.length,
    designed: designed.size,
    directSeconds: +((directed - start) / 1000).toFixed(1),
    designSeconds: +((done - directed) / 1000).toFixed(1),
    calls: writers.usage.calls,
    costUsd: writers.usage.costUsd,
  }),
);
