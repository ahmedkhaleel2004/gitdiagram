import "server-only";

import { after } from "next/server";

import { emitLiveEvent, requestOrigin } from "~/server/admin/live-events";
import { getClientIp } from "~/server/http/client-ip";
import { firstGateNotice } from "./limits";
import { isPublicRepository } from "./repository";

/**
 * Tell the /admin feed that someone wanted a video and was held back, with
 * the reason: demand the operator should see. Sent after the response, at most
 * once per connection and repository every ten minutes, and naming the
 * repository only once GitHub confirms it is public.
 */
export function reportHeldBack(
  request: Request,
  params: { username: string; repo: string; reason: string; step: string },
): void {
  const origin = requestOrigin(request);
  const task = async () => {
    const repository = `${params.username}/${params.repo}`;
    const first = await firstGateNotice({
      clientIp: getClientIp(request),
      repository,
      step: params.step,
    });
    if (!first) return;
    const named = await isPublicRepository(params.username, params.repo);
    await emitLiveEvent({
      kind: "video.gated",
      repo: named ? repository : "a repository",
      reason: params.reason,
      step: params.step,
      ...origin,
    });
  };
  try {
    after(task);
  } catch {
    // Outside a request scope: nothing to report to.
  }
}
