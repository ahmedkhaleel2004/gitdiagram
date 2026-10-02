// Node's fetch (what the app runs on at Vercel) names itself; a Worker's sends
// no User-Agent at all, and GitHub's API refuses such requests with a 403.
// Imported for its effect by both Workers' entries.
const platformFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  if (headers.has("user-agent")) return platformFetch(input, init);
  headers.set("user-agent", "node");
  return platformFetch(input, { ...init, headers });
}) as typeof fetch;

export {};
