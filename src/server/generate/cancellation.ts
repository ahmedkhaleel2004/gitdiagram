import { upstashCommand, upstashEval } from "~/server/storage/upstash";

export const GENERATION_CANCELLATION_TTL_SECONDS = 10 * 60;
export const GENERATION_ACTIVE_TTL_SECONDS = 6 * 60;
/**
 * A cancel request can race ahead of the generation route: the client's
 * keepalive cancel POST may land while request admission is still mid-Redis
 * round trips, before the active session key exists. Such an early cancel is
 * recorded as a token-bound pending marker with a short TTL; registration
 * atomically promotes a matching marker into a real cancellation flag so the
 * generation observes it on its first poll instead of running to the deadline.
 */
export const GENERATION_PENDING_CANCELLATION_TTL_SECONDS = 60;
/**
 * Cancellation is user-initiated and rare, so a flat one-second poll spends
 * hundreds of billed Redis round trips per generation to detect an event that
 * usually never happens. Stay responsive while the user is most likely to hit
 * cancel, then back off for the long tail of a slow generation.
 */
const GENERATION_CANCELLATION_POLL_SCHEDULE = [
  { throughElapsedMs: 15_000, intervalMs: 1_000 },
  { throughElapsedMs: 60_000, intervalMs: 3_000 },
] as const;
const GENERATION_CANCELLATION_MAX_POLL_INTERVAL_MS = 5_000;

function pollIntervalForElapsed(elapsedMs: number): number {
  for (const step of GENERATION_CANCELLATION_POLL_SCHEDULE) {
    if (elapsedMs < step.throughElapsedMs) {
      return step.intervalMs;
    }
  }
  return GENERATION_CANCELLATION_MAX_POLL_INTERVAL_MS;
}

// KEYS[1] = active key, KEYS[2] = cancel key.
// ARGV[1] = cancel token, ARGV[2] = cancellation TTL, ARGV[3] = pending TTL.
// When no active session exists yet, the cancel is stored as the raw token
// (never "1", so polling ignores it) for REGISTER_ACTIVE_SCRIPT to promote.
const MARK_CANCELLED_SCRIPT = `
local active = redis.call("GET", KEYS[1])
if active == ARGV[1] then
  redis.call("SET", KEYS[2], "1", "EX", ARGV[2])
  return 1
end
if active then
  return 0
end
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[3])
return 0
`;

// KEYS[1] = active key, KEYS[2] = cancel key.
// ARGV[1] = cancel token, ARGV[2] = active TTL, ARGV[3] = cancellation TTL.
// Registration promotes a token-matching pending cancel into a real flag and
// clears any stale marker left over from an earlier session with this id.
const REGISTER_ACTIVE_SCRIPT = `
if not redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX") then
  return 0
end
local pending = redis.call("GET", KEYS[2])
if pending == ARGV[1] then
  redis.call("SET", KEYS[2], "1", "EX", ARGV[3])
elseif pending then
  redis.call("DEL", KEYS[2])
end
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
  const result = await upstashEval<number>({
    script: REGISTER_ACTIVE_SCRIPT,
    keys: [getActiveGenerationKey(sessionId), getCancellationKey(sessionId)],
    args: [
      cancelToken,
      GENERATION_ACTIVE_TTL_SECONDS,
      GENERATION_CANCELLATION_TTL_SECONDS,
    ],
  });
  return result === 1;
}

export async function markGenerationCancelled(
  sessionId: string,
  cancelToken: string,
): Promise<boolean> {
  const result = await upstashEval<number>({
    script: MARK_CANCELLED_SCRIPT,
    keys: [getActiveGenerationKey(sessionId), getCancellationKey(sessionId)],
    args: [
      cancelToken,
      GENERATION_CANCELLATION_TTL_SECONDS,
      GENERATION_PENDING_CANCELLATION_TTL_SECONDS,
    ],
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
  let pollFailureLogged = false;
  let elapsedMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Each poll schedules the next one only after it settles, so a slow Redis
  // round trip can never stack overlapping requests.
  const scheduleNextPoll = () => {
    if (stopped) {
      return;
    }

    const intervalMs = pollIntervalForElapsed(elapsedMs);
    timer = setTimeout(() => {
      elapsedMs += intervalMs;
      void poll();
    }, intervalMs);
  };

  const poll = async () => {
    if (stopped) {
      return;
    }

    try {
      const cancelled = await isGenerationCancelled(params.sessionId);
      if (stopped) {
        return;
      }

      pollFailureLogged = false;
      if (cancelled) {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }
        params.onCancelled();
        return;
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
    }

    scheduleNextPoll();
  };

  void poll();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
