import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
const { callbacks, upstashEval, upstashCommand } = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  upstashEval: vi.fn(),
  upstashCommand: vi.fn(async () => null),
}));
vi.mock("server-only", () => ({}));
vi.mock("~/server/storage/upstash", () => ({ upstashEval, upstashCommand }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof NextServer>()),
  after: (cb: () => Promise<void>) => callbacks.push(cb),
}));
import { POST } from "~/app/out/[campaign]/impression/route";
import { GET } from "~/app/out/[campaign]/route";
import { createAdminSession } from "~/server/admin/operator";
import { sponsorDestination } from "./sponsor-clicks";
import { coderabbitCampaign } from "~/lib/sponsor-campaign";

const pageViewId = "245446b3-90c6-4843-b7a2-3ca364c70a12";
const context = {
  params: Promise.resolve({ campaign: coderabbitCampaign.id }),
};
const capture = vi.fn<typeof fetch>();
function request(
  body: unknown = { placement: "home", pageViewId },
  headers: Record<string, string> = {},
  query = "",
) {
  return new NextRequest(
    `https://gitdiagram.com/out/${coderabbitCampaign.id}/impression${query}`,
    {
      method: "POST",
      headers: {
        origin: "https://gitdiagram.com",
        "content-type": "application/json",
        "user-agent": "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}
const claimed = (call: number) =>
  upstashEval.mock.calls[call]![0] as { keys: string[]; args: number[] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  callbacks.length = 0;
  upstashEval.mockReset().mockResolvedValue(1);
  capture.mockReset().mockResolvedValue(new Response("1"));
  vi.stubGlobal("fetch", capture);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "public-test-token");
  vi.stubEnv("VIDEO_ADMIN_TOKEN", "operator-token-for-sponsor-tests-000000");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("records loaded ad impressions independently with the same browser identity as clicks", async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(204);
  expect(capture).not.toHaveBeenCalled();
  const cookieValue = response.headers
    .get("set-cookie")!
    .match(/^gd_sponsor_visitor=([^;]+)/)![1];
  await callbacks[0]!();
  const event = JSON.parse(capture.mock.calls[0]![1]!.body as string);
  // PostHog's event ID is per event; the page-view ID is only for dedupe.
  expect(event.uuid).toMatch(/^[0-9a-f-]{36}$/);
  expect(event.uuid).not.toBe(pageViewId);
  expect(event).toMatchObject({
    event: "sponsor_impression",
    distinct_id: `sponsor:${cookieValue}`,
    properties: {
      campaign: coderabbitCampaign.id,
      sponsor: "CodeRabbit",
      placement: "home",
      is_test: false,
      $ip: null,
    },
  });
  const click = await GET(
    new NextRequest(
      `https://gitdiagram.com/out/${coderabbitCampaign.id}?placement=home`,
      {
        headers: {
          "user-agent": "Mozilla/5.0",
          cookie: `gd_sponsor_visitor=${cookieValue}`,
        },
      },
    ),
    context,
  );
  expect(click.headers.get("location")).toBe(
    "https://www.coderabbit.ai/?utm_source=gitdiagram&utm_medium=sponsorship&utm_campaign=coderabbit_30_days&utm_content=home",
  );
  await callbacks[1]!();
  expect(
    JSON.parse(capture.mock.calls[1]![1]!.body as string).distinct_id,
  ).toBe(`sponsor:${cookieValue}`);
});

it("rejects cross-origin capture, README impressions, malformed events, and unknown campaigns", async () => {
  expect(
    (
      await POST(
        request(undefined, { origin: "https://evil.example" }),
        context,
      )
    ).status,
  ).toBe(403);
  expect(
    (await POST(request({ placement: "readme", pageViewId }), context)).status,
  ).toBe(400);
  expect(
    (await POST(request({ placement: "home", pageViewId: "bad" }), context))
      .status,
  ).toBe(400);
  expect(
    (
      await POST(
        request({ placement: "home", pageViewId, eventId: pageViewId }),
        context,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await POST(request(), {
        params: Promise.resolve({ campaign: "unknown" }),
      })
    ).status,
  ).toBe(404);
  expect(callbacks).toHaveLength(0);
});

it.each<Record<string, string>>([
  { dnt: "1" },
  { "sec-gpc": "1" },
  { "user-agent": "Googlebot" },
  { purpose: "prefetch" },
])("honors opt-outs and bot/prefetch exclusions: %j", async (headers) => {
  await POST(request(undefined, headers), context);
  expect(callbacks).toHaveLength(0);
});

it("excludes prelaunch and expired impressions, but allows the operator's marked verification events", async () => {
  for (const date of ["2026-09-24T00:00:00Z", coderabbitCampaign.endsAt]) {
    vi.setSystemTime(new Date(date));
    await POST(request(), context);
    // Anyone else's `?test=1` is an ordinary (here: inactive) impression.
    await POST(request(undefined, {}, "?test=1"), context);
    expect(callbacks).toHaveLength(0);
  }
  const session = await createAdminSession();
  await POST(
    request(undefined, { cookie: `gd_admin=${session!.value}` }, "?test=1"),
    context,
  );
  await callbacks[0]!();
  expect(
    JSON.parse(capture.mock.calls[0]![1]!.body as string).properties.is_test,
  ).toBe(true);
  // Verification events are excluded from reports, so they skip dedupe.
  expect(upstashEval).not.toHaveBeenCalled();
});

it("records one impression per page view and caps each network per hour", async () => {
  const headers = { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" };
  upstashEval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
  await POST(request(undefined, headers), context);
  await POST(request(undefined, headers), context);
  await Promise.all(callbacks.map((callback) => callback()));
  expect(capture).toHaveBeenCalledOnce();
  const { keys, args } = claimed(0);
  expect(keys[0]).toBe(
    `sponsor:v1:impression:${coderabbitCampaign.id}:home:${pageViewId}`,
  );
  expect(keys[1]).toMatch(
    /^sponsor:v1:impression-campaign:coderabbit-2026-10:\d+$/,
  );
  expect(keys[2]).toMatch(
    /^sponsor:v1:impression-cap:coderabbit-2026-10:[0-9a-f]{32}:\d+$/,
  );
  expect([args[0], args[1], args[3]]).toEqual([86400, 100_000, 120]);
  expect(JSON.stringify(upstashEval.mock.calls)).not.toContain("2001:db8");
});

it("rejects the legacy random event IDs", async () => {
  const response = await POST(
    request({ placement: "browse", eventId: pageViewId }),
    context,
  );
  expect(response.status).toBe(400);
  expect(callbacks).toHaveLength(0);
});

it("records impressions when Redis is down", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  upstashEval.mockRejectedValue(new Error("Upstash unavailable"));
  await POST(request(), context);
  await callbacks[0]!();
  expect(capture).toHaveBeenCalledOnce();
});

it("preserves sponsor-supplied attribution while filling missing placement tags", () => {
  const target = sponsorDestination("diagram", {
    ...coderabbitCampaign,
    destination:
      "https://www.coderabbit.ai/?utm_source=partner&utm_campaign=custom&ref=gitdiagram",
  });
  expect(target.searchParams.get("utm_source")).toBe("partner");
  expect(target.searchParams.get("utm_campaign")).toBe("custom");
  expect(target.searchParams.get("utm_content")).toBe("diagram");
  expect(target.searchParams.get("ref")).toBe("gitdiagram");
});
