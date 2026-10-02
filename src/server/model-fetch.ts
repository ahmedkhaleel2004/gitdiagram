import { cloudflareContext } from "~/server/cloudflare-context";

// See cloudflare/us-relay.ts. On Cloudflare Workers a model API sees the
// visitor's country, and OpenAI answers 403 "Country, region, or territory
// not supported" for the ones it does not serve. On Vercel the call came from
// a server in Virginia. `modelFetch` sends the call directly first; when it
// is refused for that reason it sends it again through the relay, and
// remembers the country so the next visitor from there skips the refusal.

interface RelayNamespace {
  newUniqueId(): unknown;
  get(
    id: unknown,
    options?: { locationHint?: string },
  ): { fetch(request: Request): Promise<Response> };
}

const refusedCountries = new Set<string>();

export function isUnsupportedPlaceRefusal(status: number, body: string) {
  return (
    status === 403 &&
    /unsupported_country_region_territory|Country, region, or territory not supported/i.test(
      body,
    )
  );
}

/** `fetch` for model API clients on Workers; plain `fetch` anywhere else. */
export const modelFetch: typeof fetch = async (input, init) => {
  const context = cloudflareContext();
  const relay = context?.env.US_RELAY as RelayNamespace | undefined;
  if (!context || !relay) return fetch(input, init);

  const country = context.cf?.country ?? "unknown";
  if (!refusedCountries.has(country)) {
    const response = await fetch(input, init);
    if (response.status !== 403) return response;
    const body = await response
      .clone()
      .text()
      .catch(() => "");
    if (!isUnsupportedPlaceRefusal(response.status, body)) return response;
    refusedCountries.add(country);
    console.warn(JSON.stringify({ event: "model_fetch.relayed", country }));
  }
  return sendThroughRelay(relay, new Request(input, init));
};

function sendThroughRelay(relay: RelayNamespace, request: Request) {
  return relay
    .get(relay.newUniqueId(), { locationHint: "enam" })
    .fetch(request);
}

/** The relay's answer to `request`, or null where there is no relay. */
export function relayModelRequest(request: Request): Promise<Response> | null {
  const relay = cloudflareContext()?.env.US_RELAY as RelayNamespace | undefined;
  return relay ? sendThroughRelay(relay, request) : null;
}

/** The client option that routes a model SDK's calls through `modelFetch`. */
export function modelFetchOption(): { fetch?: typeof fetch } {
  return cloudflareContext() ? { fetch: modelFetch } : {};
}

export function resetModelFetchForTests() {
  refusedCountries.clear();
}
