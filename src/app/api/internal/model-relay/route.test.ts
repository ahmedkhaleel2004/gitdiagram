import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const relayModelRequest = vi.hoisted(() => vi.fn());
vi.mock("~/server/model-fetch", () => ({ relayModelRequest }));

import { GET } from "./route";

const directFetch = vi.fn<typeof fetch>();
const call = (query = "", secret = "cron") =>
  GET(
    new Request(`https://gitdiagram.com/api/internal/model-relay${query}`, {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron");
  vi.stubEnv("OPENAI_API_KEY", "openai-key");
  vi.stubEnv("META_API_KEY", "meta-key");
  vi.stubGlobal("fetch", directFetch);
  directFetch.mockImplementation(async () => new Response("{}"));
  relayModelRequest.mockImplementation(async () => new Response("{}"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/internal/model-relay", () => {
  it("refuses a caller without the cron secret", async () => {
    const response = await call("", "wrong");
    expect(response.status).toBe(401);
    expect(relayModelRequest).not.toHaveBeenCalled();
  });

  it("lists OpenAI's models directly and through the relay by default", async () => {
    const response = await call();
    expect(await response.json()).toEqual({
      ok: true,
      provider: "openai",
      direct: 200,
      relay: 200,
    });
    const relayed = relayModelRequest.mock.calls[0]?.[0] as Request;
    expect(relayed.url).toBe("https://api.openai.com/v1/models");
    expect(relayed.headers.get("authorization")).toBe("Bearer openai-key");
  });

  it("checks Meta with its own key, and a streamed answer when asked", async () => {
    relayModelRequest.mockImplementation(async (request: Request) =>
      request.method === "POST"
        ? new Response('event: response.completed\ndata: {"type":"x"}\n\n')
        : new Response("{}"),
    );
    const response = await call("?provider=meta&stream=1");
    expect(await response.json()).toEqual({
      ok: true,
      provider: "meta",
      direct: 200,
      relay: 200,
      stream: { status: 200, completed: true },
    });
    const urls = relayModelRequest.mock.calls.map(
      ([request]) => (request as Request).url,
    );
    expect(urls).toEqual([
      "https://api.meta.ai/v1/models",
      "https://api.meta.ai/v1/responses",
    ]);
    const posted = relayModelRequest.mock.calls[1]?.[0] as Request;
    expect(posted.headers.get("authorization")).toBe("Bearer meta-key");
  });

  it("is not ok when Meta refuses the streamed call", async () => {
    relayModelRequest.mockImplementation(async (request: Request) =>
      request.method === "POST"
        ? new Response('{"error":{"code":"billing_not_configured"}}', {
            status: 402,
          })
        : new Response("{}"),
    );
    const body = (await (await call("?provider=meta&stream=1")).json()) as {
      ok: boolean;
      stream: { status: number; completed: boolean; body: string };
    };
    expect(body.ok).toBe(false);
    expect(body.stream.status).toBe(402);
    expect(body.stream.body).toContain("billing_not_configured");
  });
});
