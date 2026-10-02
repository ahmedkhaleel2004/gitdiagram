// Sends a model API call as the server's own, not the visitor's.
//
// Cloudflare tells the site a Worker calls which country the *visitor* is in,
// whichever data centre the Worker runs in and however the call is routed
// (checked 2026-10-02 with /cdn-cgi/trace: a service binding, a Worker placed
// in Virginia and a public Worker-to-Worker hop all still reported the
// visitor's country). OpenAI is behind Cloudflare and refuses countries it
// does not serve, so on Workers every diagram for a visitor in Iran, China,
// Hong Kong or Russia failed with "403 Country, region, or territory not
// supported". On Vercel the call came from a server in Virginia and worked.
//
// A call made from a Durable Object's alarm belongs to no visitor and is seen
// as coming from the United States (40 of 40 in the same check, streaming
// intact). So: one object per call. Its fetch handler parks the request and
// sets an alarm for now; the alarm sends it and pipes the answer back. One
// object per call matters: with several visitors' requests open in the same
// object, about half the alarm's calls were seen as a visitor's again.
//
// Only src/server/model-fetch.ts calls this (binding US_RELAY), and only after
// the direct call was refused for the visitor's country.

import { DurableObject } from "cloudflare:workers";

const ALLOWED_HOSTS = new Set(["api.openai.com", "openrouter.ai"]);

interface Job {
  request: Request;
  resolve(response: Response): void;
  reject(error: unknown): void;
}

export class UsRelay extends DurableObject {
  private jobs: Job[] = [];

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname))
      return new Response("Host not allowed.", { status: 403 });
    // Read the body here: it belongs to this event, not to the alarm's.
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await request.arrayBuffer();
    const parked = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
    const answer = new Promise<Response>((resolve, reject) => {
      this.jobs.push({ request: parked, resolve, reject });
    });
    await this.ctx.storage.setAlarm(Date.now());
    return answer;
  }

  override async alarm(): Promise<void> {
    const jobs = this.jobs;
    this.jobs = [];
    // Never throw: a failed alarm is retried, and the call must not be resent.
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const upstream = await fetch(job.request);
          if (!upstream.body) {
            job.resolve(new Response(null, upstream));
            return;
          }
          // The alarm stays alive until the answer has been passed on; a
          // caller that goes away cancels the upstream call through the pipe.
          const { readable, writable } = new TransformStream();
          job.resolve(new Response(readable, upstream));
          await upstream.body.pipeTo(writable);
        } catch (error) {
          job.reject(error);
        }
      }),
    );
    // The object is used once: leave nothing stored behind.
    if (this.jobs.length === 0)
      await this.ctx.storage.deleteAll().catch(() => undefined);
  }
}
