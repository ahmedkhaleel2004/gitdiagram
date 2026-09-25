import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";

const { callbacks, upstashEval } = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  upstashEval: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({ upstashEval }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof NextServer>()),
  after: (callback: () => Promise<void>) => callbacks.push(callback),
}));

import { GET, HEAD } from "~/app/out/[campaign]/route";
import {
  coderabbitCampaign,
  sentCampaign,
  sponsorClickHref,
  sponsorPlacements,
} from "~/lib/sponsor-campaign";

const browser =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36";
const fetchMock = vi.fn<typeof fetch>();
const context = { params: Promise.resolve({ campaign: "sent-2026-09" }) };

function request(placement = "home", headers: Record<string, string> = {}) {
  return new NextRequest(
    `https://gitdiagram.com/out/sent-2026-09?placement=${placement}`,
    {
      headers: { "user-agent": browser, ...headers },
    },
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-25T12:00:00Z"));
  upstashEval.mockReset().mockResolvedValue(1);
  callbacks.length = 0;
  fetchMock.mockReset().mockResolvedValue(new Response("1"));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "public-test-token");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sponsor click redirects", () => {
  it.each(sponsorPlacements)(
    "preserves Sent's attribution for %s and redirects before capture",
    async (placement) => {
      const response = await GET(request(placement), context);
      expect(response.status).toBe(302);
      const target = new URL(response.headers.get("location")!);
      expect(target.origin + target.pathname).toBe("https://www.sent.dm/en");
      expect(Object.fromEntries(target.searchParams)).toEqual({
        utm_source: "gitdiagram",
        utm_medium: "sponsorship",
        utm_campaign: "sent_30_days",
        utm_content: placement,
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(callbacks).toHaveLength(1);
      await callbacks[0]!();
      const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
      expect(body).toMatchObject({
        event: "sponsor_click",
        properties: {
          campaign: "sent-2026-09",
          placement,
          is_test: false,
          $process_person_profile: false,
          $geoip_disable: true,
          $ip: null,
        },
      });
      expect(sponsorClickHref(placement, "sent-2026-09")).toBe(
        `/out/sent-2026-09?placement=${placement}`,
      );
    },
  );

  it("recognizes one anonymous browser across placements without forwarding IPs or referrers", async () => {
    const first = await GET(
      request("readme", {
        "x-forwarded-for": "192.0.2.1",
        referer: "https://github.com/secret/repo",
      }),
      context,
    );
    const cookie = first.cookies.get("gd_sponsor_visitor")!;
    expect(cookie).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      path: "/out",
      maxAge: 2592000,
    });
    const second = await GET(
      request("home", { cookie: `gd_sponsor_visitor=${cookie.value}` }),
      context,
    );
    expect(second.headers.get("set-cookie")).toBeNull();
    await Promise.all(callbacks.map((callback) => callback()));
    const bodies = fetchMock.mock.calls.map(([, opts]) =>
      JSON.parse(opts!.body as string),
    );
    expect(bodies[0].distinct_id).toBe(bodies[1].distinct_id);
    expect(JSON.stringify(bodies)).not.toMatch(
      /192\.0\.2\.1|secret\/repo|Mozilla/,
    );
  });

  it("replaces malformed visitor identifiers rather than ingesting untrusted cookie data", async () => {
    const response = await GET(
      request("home", { cookie: "gd_sponsor_visitor=someone@example.com" }),
      context,
    );
    expect(response.cookies.get("gd_sponsor_visitor")?.value).toMatch(
      /^[a-f0-9-]{36}$/,
    );
  });

  it.each<Record<string, string>>([
    { "user-agent": "Googlebot" },
    { "user-agent": "Slackbot-LinkExpanding" },
    { "user-agent": "curl/8.0" },
    { "user-agent": "" },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
    { "next-router-prefetch": "1" },
    { "sec-fetch-mode": "cors" },
    { dnt: "1" },
    { "sec-gpc": "1" },
  ])(
    "does not count automated, speculative, or opted-out requests: %j",
    async (headers) => {
      const response = await GET(request("home", headers), context);
      expect(response.status).toBe(302);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(callbacks).toHaveLength(0);
    },
  );

  it("does not count HEAD requests, previews, localhost, or missing analytics configuration", async () => {
    expect((await HEAD(request(), context)).status).toBe(302);
    for (const origin of [
      "http://localhost:3000",
      "https://preview.vercel.app",
    ]) {
      expect(
        (
          await GET(
            new NextRequest(
              `${origin}${sponsorClickHref("home", "sent-2026-09")}`,
              {
                headers: { "user-agent": browser },
              },
            ),
            context,
          )
        ).status,
      ).toBe(302);
    }
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    expect((await GET(request(), context)).status).toBe(302);
    expect(callbacks).toHaveLength(0);
  });

  it("rejects unknown campaigns and placements and ignores attempted destination overrides", async () => {
    expect((await GET(request("other"), context)).status).toBe(404);
    expect(
      (await GET(request(), { params: Promise.resolve({ campaign: "other" }) }))
        .status,
    ).toBe(404);
    expect(callbacks).toHaveLength(0);
    const response = await GET(
      request("home&url=https://evil.example&next=https://evil.example"),
      context,
    );
    expect(new URL(response.headers.get("location")!).hostname).toBe(
      "www.sent.dm",
    );
  });

  it("marks controlled verification clicks so campaign reports can exclude them", async () => {
    await GET(request("readme&test=1"), context);
    await callbacks[0]!();
    const body = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    expect(body.properties.is_test).toBe(true);
  });

  it.each(["network", "http"])(
    "keeps the sponsor link working when capture fails: %s",
    async (failure) => {
      if (failure === "network")
        fetchMock.mockRejectedValue(new Error("offline"));
      else fetchMock.mockResolvedValue(new Response("failed", { status: 503 }));
      const response = await GET(request(), context);
      expect(response.status).toBe(302);
      await expect(callbacks[0]!()).resolves.toBeUndefined();
      expect(console.warn).toHaveBeenCalledOnce();
    },
  );

  it("sends clicks on ended or unstarted campaigns to /advertise without recording them", async () => {
    for (const [campaign, at] of [
      [sentCampaign.id, sentCampaign.endsAt],
      [coderabbitCampaign.id, "2026-09-25T12:00:00Z"],
    ] as const) {
      vi.setSystemTime(new Date(at));
      const response = await GET(
        new NextRequest(
          `https://gitdiagram.com${sponsorClickHref("readme", campaign)}`,
          { headers: { "user-agent": browser } },
        ),
        { params: Promise.resolve({ campaign }) },
      );
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        "https://gitdiagram.com/advertise",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(callbacks).toHaveLength(0);
    // Controlled checks and preview deployments still reach the sponsor.
    const test = await GET(
      new NextRequest(
        `https://gitdiagram.com/out/${coderabbitCampaign.id}?placement=home&test=1`,
        { headers: { "user-agent": browser } },
      ),
      { params: Promise.resolve({ campaign: coderabbitCampaign.id }) },
    );
    expect(new URL(test.headers.get("location")!).hostname).toBe(
      "www.coderabbit.ai",
    );
    const preview = await GET(
      new NextRequest(
        `https://gitdiagram-coderabbit-preview.vercel.app/out/${coderabbitCampaign.id}?placement=home`,
        { headers: { "user-agent": browser } },
      ),
      { params: Promise.resolve({ campaign: coderabbitCampaign.id }) },
    );
    expect(new URL(preview.headers.get("location")!).hostname).toBe(
      "www.coderabbit.ai",
    );
  });

  it("records one click per network and placement in a window, keyed by a hash of the IP", async () => {
    upstashEval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const headers = { "x-forwarded-for": "192.0.2.7" };
    expect((await GET(request("home", headers), context)).status).toBe(302);
    expect((await GET(request("home", headers), context)).status).toBe(302);
    await Promise.all(callbacks.map((callback) => callback()));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [first, second] = upstashEval.mock.calls.map(
      ([call]) => (call as { keys: string[] }).keys,
    );
    expect(first).toEqual(second);
    expect(first![0]).toMatch(
      /^sponsor:v1:click:sent-2026-09:home:[0-9a-f]{32}:\d+$/,
    );
    expect(JSON.stringify(upstashEval.mock.calls)).not.toContain("192.0.2.7");
  });

  it("still records clicks when Redis is down, and skips dedupe for test clicks", async () => {
    upstashEval.mockRejectedValue(new Error("Upstash unavailable"));
    await GET(request("home", { "x-forwarded-for": "192.0.2.7" }), context);
    await callbacks[0]!();
    expect(fetchMock).toHaveBeenCalledOnce();
    upstashEval.mockClear();
    await GET(
      request("home&test=1", { "x-forwarded-for": "192.0.2.7" }),
      context,
    );
    await callbacks[1]!();
    expect(upstashEval).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
