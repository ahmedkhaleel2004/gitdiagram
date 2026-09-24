import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type * as NextServer from "next/server";
const { callbacks } = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof NextServer>()),
  after: (cb: () => Promise<void>) => callbacks.push(cb),
}));
import { POST } from "~/app/out/[campaign]/impression/route";
import { GET } from "~/app/out/[campaign]/route";
import { sponsorDestination } from "./sponsor-clicks";
import { coderabbitCampaign } from "~/lib/sponsor-campaign";

const eventId = "245446b3-90c6-4843-b7a2-3ca364c70a12";
const context = {
  params: Promise.resolve({ campaign: coderabbitCampaign.id }),
};
const capture = vi.fn<typeof fetch>();
function request(
  body: unknown = { placement: "home", eventId },
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
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  callbacks.length = 0;
  capture.mockReset().mockResolvedValue(new Response("1"));
  vi.stubGlobal("fetch", capture);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "public-test-token");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("records loaded ad impressions independently with the same browser identity as clicks", async () => {
  const response = await POST(request(), context);
  expect(response.status).toBe(204);
  expect(capture).not.toHaveBeenCalled();
  const cookieValue = response.headers
    .get("set-cookie")!
    .match(/^gd_sponsor_visitor=([^;]+)/)![1];
  await callbacks[0]!();
  expect(JSON.parse(capture.mock.calls[0]![1]!.body as string)).toMatchObject({
    uuid: eventId,
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
    (await POST(request({ placement: "readme", eventId }), context)).status,
  ).toBe(400);
  expect(
    (await POST(request({ placement: "home", eventId: "bad" }), context))
      .status,
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

it("excludes prelaunch and expired impressions, but allows explicitly marked verification events", async () => {
  for (const date of ["2026-09-24T00:00:00Z", coderabbitCampaign.endsAt]) {
    vi.setSystemTime(new Date(date));
    await POST(request(), context);
    expect(callbacks).toHaveLength(0);
  }
  await POST(request(undefined, {}, "?test=1"), context);
  await callbacks[0]!();
  expect(
    JSON.parse(capture.mock.calls[0]![1]!.body as string).properties.is_test,
  ).toBe(true);
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
