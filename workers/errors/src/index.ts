// Keeps every failed request of the site's Worker in the logs.
//
// The site's own logs are sampled at 2% (wrangler.jsonc: logging every
// request would cost more than the Worker), so 49 of 50 failures left no
// trace. A Tail Worker is handed every invocation whatever the sampling, and
// costs only its CPU time: this one drops the healthy ones and logs the rest,
// unsampled, as one JSON line each. Read them in the dashboard (Workers,
// gitdiagram-errors, Logs) or with `bunx wrangler tail gitdiagram-errors`.
//
// Deployed on its own, before the site (the site names it in
// `tail_consumers`): `bunx wrangler deploy -c workers/errors/wrangler.jsonc`.

interface TraceLog {
  level: string;
  message: unknown;
}

interface TraceItem {
  scriptName: string | null;
  outcome: string;
  eventTimestamp: number | null;
  cpuTime?: number;
  wallTime?: number;
  exceptions: { name: string; message: string }[];
  logs: TraceLog[];
  event: {
    request?: {
      url: string;
      method: string;
      headers: Record<string, string>;
      cf?: { country?: string; colo?: string };
    };
    response?: { status: number };
    cron?: string;
  } | null;
}

const clip = (value: unknown, length: number) =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, length);

/** What is worth keeping from one invocation, or null for a healthy one. */
export function failure(item: TraceItem): Record<string, unknown> | null {
  const status = item.event?.response?.status ?? null;
  const errors = item.logs.filter((log) => log.level === "error");
  // "canceled" is a visitor closing the tab: not a failure.
  const badOutcome = item.outcome !== "ok" && item.outcome !== "canceled";
  if (
    !badOutcome &&
    item.exceptions.length === 0 &&
    errors.length === 0 &&
    (status === null || status < 500)
  )
    return null;
  const request = item.event?.request;
  return {
    event: "site.failure",
    at: item.eventTimestamp
      ? new Date(item.eventTimestamp).toISOString()
      : null,
    outcome: item.outcome,
    status,
    method: request?.method ?? null,
    // Without the query string: it can hold tokens and session ids.
    url: request ? request.url.split("?")[0] : (item.event?.cron ?? null),
    country: request?.cf?.country ?? null,
    colo: request?.cf?.colo ?? null,
    ray: request?.headers["cf-ray"] ?? null,
    cpu_ms: item.cpuTime ?? null,
    wall_ms: item.wallTime ?? null,
    exceptions: item.exceptions
      .slice(0, 5)
      .map(({ name, message }) => `${name}: ${clip(message, 600)}`),
    errors: errors.slice(0, 8).map((log) => clip(log.message, 800)),
  };
}

export default {
  tail(items: TraceItem[]) {
    for (const item of items) {
      const line = failure(item);
      if (line) console.error(JSON.stringify(line));
    }
  },
};
