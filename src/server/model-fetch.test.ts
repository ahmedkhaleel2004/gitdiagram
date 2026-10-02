import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isUnsupportedPlaceRefusal,
  modelFetch,
  modelFetchOption,
  resetModelFetchForTests,
} from "./model-fetch";

const contextSymbol = Symbol.for("__cloudflare-context__");
const globals = globalThis as Record<symbol, unknown>;
const REFUSAL = JSON.stringify({
  error: {
    code: "unsupported_country_region_territory",
    message: "Country, region, or territory not supported",
  },
});

function onWorkers(country: string) {
  const relayFetch = vi.fn(async (request: Request) => {
    void request;
    return new Response("relayed");
  });
  const get = vi.fn(() => ({ fetch: relayFetch }));
  globals[contextSymbol] = {
    env: { US_RELAY: { newUniqueId: () => ({}), get } },
    cf: { country },
  };
  return { relayFetch, get };
}

const directFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", directFetch);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  delete globals[contextSymbol];
  directFetch.mockReset();
  resetModelFetchForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("modelFetch", () => {
  it("is plain fetch off Workers, and no client option is set", async () => {
    directFetch.mockResolvedValue(new Response("direct"));
    expect(modelFetchOption()).toEqual({});
    const response = await modelFetch("https://api.openai.com/v1/responses");
    expect(await response.text()).toBe("direct");
  });

  it("answers directly where the provider serves the visitor", async () => {
    const { relayFetch } = onWorkers("CA");
    directFetch.mockResolvedValue(new Response("direct"));
    expect(modelFetchOption()).toEqual({ fetch: modelFetch });
    const response = await modelFetch("https://api.openai.com/v1/responses");
    expect(await response.text()).toBe("direct");
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("resends a call refused for the visitor's country through the relay, then goes straight there", async () => {
    const { relayFetch, get } = onWorkers("IR");
    directFetch.mockResolvedValue(new Response(REFUSAL, { status: 403 }));
    const init = {
      method: "POST",
      headers: { authorization: "Bearer k" },
      body: '{"model":"m"}',
    };
    const first = await modelFetch("https://api.openai.com/v1/responses", init);
    expect(await first.text()).toBe("relayed");
    expect(directFetch).toHaveBeenCalledTimes(1);
    const sent = relayFetch.mock.calls[0]![0];
    expect(sent.url).toBe("https://api.openai.com/v1/responses");
    expect(sent.headers.get("authorization")).toBe("Bearer k");
    expect(await sent.text()).toBe('{"model":"m"}');
    expect(get).toHaveBeenCalledWith(expect.anything(), {
      locationHint: "enam",
    });

    await modelFetch("https://api.openai.com/v1/responses", init);
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(relayFetch).toHaveBeenCalledTimes(2);
  });

  it("does not relay for a visitor from another country after one was refused", async () => {
    onWorkers("IR");
    directFetch.mockResolvedValue(new Response(REFUSAL, { status: 403 }));
    await modelFetch("https://api.openai.com/v1/responses");
    const { relayFetch } = onWorkers("FR");
    directFetch.mockResolvedValue(new Response("direct"));
    await modelFetch("https://api.openai.com/v1/responses");
    expect(relayFetch).not.toHaveBeenCalled();
  });

  it("passes any other 403 back untouched", async () => {
    const { relayFetch } = onWorkers("IR");
    directFetch.mockResolvedValue(
      new Response('{"error":{"code":"invalid_api_key"}}', { status: 403 }),
    );
    const response = await modelFetch("https://api.openai.com/v1/responses");
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("invalid_api_key");
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

describe("isUnsupportedPlaceRefusal", () => {
  it("matches the code or the message, only on 403", () => {
    expect(isUnsupportedPlaceRefusal(403, REFUSAL)).toBe(true);
    expect(
      isUnsupportedPlaceRefusal(
        403,
        "Country, region, or territory not supported",
      ),
    ).toBe(true);
    expect(isUnsupportedPlaceRefusal(401, REFUSAL)).toBe(false);
    expect(isUnsupportedPlaceRefusal(403, "Forbidden")).toBe(false);
  });
});
