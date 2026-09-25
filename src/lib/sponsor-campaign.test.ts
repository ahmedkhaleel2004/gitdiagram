import { describe, expect, it, vi, afterEach } from "vitest";
import {
  activeSponsorCampaign,
  coderabbitCampaign,
  lastBookedSponsorCampaign,
  scheduledSponsorCampaigns,
  sentCampaign,
} from "./sponsor-campaign";
import { updateSponsorReadme } from "./sponsor-readme";
import { GET } from "~/app/api/sponsor/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("paid sponsor schedule", () => {
  it("hands over at Sent's exact expiry without overlap, then expires CodeRabbit", () => {
    const start = Date.parse(coderabbitCampaign.startsAt);
    const end = Date.parse(coderabbitCampaign.endsAt);
    expect(
      activeSponsorCampaign(Date.parse(sentCampaign.startsAt) - 1),
    ).toBeUndefined();
    expect(activeSponsorCampaign(start - 1)?.id).toBe(sentCampaign.id);
    expect(activeSponsorCampaign(start)?.id).toBe(coderabbitCampaign.id);
    expect(activeSponsorCampaign(end - 1)?.id).toBe(coderabbitCampaign.id);
    expect(activeSponsorCampaign(end)).toBeUndefined();
    expect(
      end - Date.parse("2026-10-20T00:00:00-04:00"),
    ).toBeGreaterThanOrEqual(30 * 86400000);
  });

  // activeSponsorCampaign returns the first match, so an overlap would give the
  // earlier campaign 100% of the shared inventory. Rotation must exist first.
  it("never schedules overlapping campaigns", () => {
    const campaigns = [...scheduledSponsorCampaigns].sort(
      (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
    );
    expect(new Set(campaigns.map(({ id }) => id)).size).toBe(campaigns.length);
    campaigns.forEach((campaign, index) => {
      expect(Date.parse(campaign.startsAt)).toBeLessThan(
        Date.parse(campaign.endsAt),
      );
      const next = campaigns[index + 1];
      if (next)
        expect(Date.parse(campaign.endsAt)).toBeLessThanOrEqual(
          Date.parse(next.startsAt),
        );
    });
  });

  it("finds the last booked campaign until it ends", () => {
    expect(
      lastBookedSponsorCampaign(Date.parse(sentCampaign.startsAt))?.id,
    ).toBe(coderabbitCampaign.id);
    expect(
      lastBookedSponsorCampaign(Date.parse(coderabbitCampaign.endsAt) - 1)?.id,
    ).toBe(coderabbitCampaign.id);
    expect(
      lastBookedSponsorCampaign(Date.parse(coderabbitCampaign.endsAt)),
    ).toBeUndefined();
  });

  it("uses uncached server time and cannot force a preview onto production", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    vi.stubEnv("SPONSOR_PREVIEW_CAMPAIGN", coderabbitCampaign.id);
    const response = GET(new Request("https://gitdiagram.com/api/sponsor"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      campaignId: sentCampaign.id,
      preview: false,
      nextTransition: Date.parse(sentCampaign.endsAt),
    });
    expect(
      await GET(
        new Request(
          "https://gitdiagram-coderabbit-preview.vercel.app/api/sponsor",
        ),
      ).json(),
    ).toMatchObject({
      campaignId: coderabbitCampaign.id,
      preview: true,
      nextTransition: null,
    });
    vi.setSystemTime(new Date(coderabbitCampaign.startsAt));
    expect(
      await GET(new Request("https://gitdiagram.com/api/sponsor")).json(),
    ).toMatchObject({ campaignId: coderabbitCampaign.id });
  });

  it("updates only the README sponsor block and retains campaign-specific historic links", () => {
    const input =
      "# Project\n\n<!-- sponsor:start -->\nold ad\n<!-- sponsor:end -->\n\nUnrelated content";
    const before = updateSponsorReadme(
      input,
      Date.parse(sentCampaign.endsAt) - 1,
    );
    expect(before).toContain("/out/sent-2026-09?placement=readme");
    const after = updateSponsorReadme(
      before,
      Date.parse(coderabbitCampaign.startsAt),
    );
    expect(after).toContain("coderabbit-wordmark-white.svg");
    expect(after).toContain("AI code reviews for your pull requests.");
    expect(after).toContain("/out/coderabbit-2026-10?placement=readme");
    expect(after).not.toContain("sent-2026-09");
    expect(after.startsWith("# Project\n\n")).toBe(true);
    expect(after.endsWith("\n\nUnrelated content")).toBe(true);
    expect(
      updateSponsorReadme(after, Date.parse(coderabbitCampaign.startsAt)),
    ).toBe(after);
    expect(
      updateSponsorReadme(after, Date.parse(coderabbitCampaign.endsAt)),
    ).toContain("Advertise your product here.");
    expect(() => updateSponsorReadme("# no markers")).toThrow();
  });
});
