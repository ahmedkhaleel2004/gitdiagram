// On Cloudflare Workers (the OpenNext build) the adapter keeps the request's
// bindings behind a global symbol. Undefined everywhere else, which is how
// server code tells the two platforms apart.

interface AssetFetcher {
  fetch(input: string | URL): Promise<Response>;
}

interface CloudflareContext {
  env: { ASSETS?: AssetFetcher } & Record<string, unknown>;
}

export function cloudflareContext(): CloudflareContext | undefined {
  return (globalThis as Record<symbol, unknown>)[
    Symbol.for("__cloudflare-context__")
  ] as CloudflareContext | undefined;
}
