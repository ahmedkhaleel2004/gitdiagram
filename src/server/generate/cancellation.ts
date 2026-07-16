import { upstashCommand, upstashEval } from "~/server/storage/upstash";

export const GENERATION_CANCELLATION_TTL_SECONDS = 10 * 60;
export const GENERATION_ACTIVE_TTL_SECONDS = 6 * 60;
const GENERATION_CANCELLATION_POLL_INTERVAL_MS = 1_000;

const MARK_CANCELLED_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call("SET", KEYS[2], "1", "EX", ARGV[2])
return 1
`;

const UNREGISTER_ACTIVE_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call("DEL", KEYS[1])
redis.call("DEL", KEYS[2])
return 1
`;

function getActiveGenerationKey(sessionId: string): string {
  return `generation:active:${sessionId}`;
}

function getCancellationKey(sessionId: string): string {
  return `generation:cancel:${sessionId}`;
}

export async function registerActiveGeneration(
  sessionId: string,
  cancelToken: string,
): Promise<boolean> {
  const result = await upstashCommand<"OK" | null>([
    "SET",
    getActiveGenerationKey(sessionId),
    cancelToken,
    "EX",
    GENERATION_ACTIVE_TTL_SECONDS,
    "NX",
  ]);
  return result === "OK";
}

export async function markGenerationCancelled(
  sessionId: string,
  cancelToken: string,
): Promise<boolean> {
  const result = await upstashEval<number>({
    script: MARK_CANCELLED_SCRIPT,
    keys: [getActiveGenerationKey(sessionId), getCancellationKey(sessionId)],
    args: [cancelToken, GENERATION_CANCELLATION_TTL_SECONDS],
  });
  return result === 1;
}

export async function unregisterActiveGeneration(
  sessionId: string,
  cancelToken: string,
): Promise<void> {
  await upstashEval<number>({
    script: UNREGISTER_ACTIVE_SCRIPT,
    keys: [getActiveGenerationKey(sessionId), getCancellationKey(sessionId)],
    args: [cancelToken],
  });
}

export async function isGenerationCancelled(
  sessionId: string,
): Promise<boolean> {
  const result = await upstashCommand<string | null>([
    "GET",
    getCancellationKey(sessionId),
  ]);
  return result === "1";
}

export function startGenerationCancellationPolling(params: {
  sessionId: string;
  onCancelled: () => void;
}): () => void {
  let stopped = false;
  let pollInFlight = false;
  let pollFailureLogged = false;

  const poll = async () => {
    if (stopped || pollInFlight) {
      return;
    }

    pollInFlight = true;
    try {
      const cancelled = await isGenerationCancelled(params.sessionId);
      if (stopped) {
        return;
      }

      pollFailureLogged = false;
      if (cancelled) {
        stopped = true;
        clearInterval(timer);
        params.onCancelled();
      }
    } catch {
      if (!stopped && !pollFailureLogged) {
        pollFailureLogged = true;
        console.warn(
          JSON.stringify({
            event: "generate.cancellation.poll_failed",
            session_id: params.sessionId,
            error: "Cancellation status is temporarily unavailable.",
          }),
        );
      }
    } finally {
      pollInFlight = false;
    }
  };

  const timer = setInterval(
    () => void poll(),
    GENERATION_CANCELLATION_POLL_INTERVAL_MS,
  );
  void poll();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
