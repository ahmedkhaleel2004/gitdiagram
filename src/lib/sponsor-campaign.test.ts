import { describe, expect, it, vi, afterEach } from "vitest";
import {
  activeReadmeSponsorCampaign,
  activeSponsorCampaigns,
  coderabbitCampaign,
  lastBookedSponsorCampaign,
  meteoropsCampaign,
  nangoCampaign,
  pickSponsorCampaign,
  scheduledSponsorCampaigns,
  sentCampaign,
  sponsorAnswer,
  type SponsorCampaign,
  type SponsorPackage,
} from "./sponsor-campaign";
import { updateSponsorReadme } from "./sponsor-readme";
import { GET } from "~/app/api/sponsor/route";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function campaign(
  id: string,
  sponsorPackage: SponsorPackage,
  start: number,
  end: number,
): SponsorCampaign {
  return {
    id,
    sponsor: id,
    package: sponsorPackage,
    destination: "https://example.com",
    utmCampaign: id,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
  };
}

// Occupancy only changes when a campaign starts, so checking each start is
// enough.
function scheduleProblems(campaigns: readonly SponsorCampaign[]) {
  return campaigns.flatMap(({ startsAt }) => {
    const active = activeSponsorCampaigns(Date.parse(startsAt), campaigns);
    const exclusive = active.some((c) => c.package === "exclusive");
    return (exclusive && active.length > 1) || active.length > 2
      ? [`${startsAt}: ${active.map(({ id }) => id).join(", ")}`]
      : [];
  });
}

describe("paid sponsor schedule", () => {
  it("hands over at Sent's exact expiry without overlap, then from CodeRabbit to Nango", () => {
    const start = Date.parse(coderabbitCampaign.startsAt);
    const end = Date.parse(coderabbitCampaign.endsAt);
    expect(
      activeSponsorCampaigns(Date.parse(sentCampaign.startsAt) - 1),
    ).toEqual([]);
    expect(activeSponsorCampaigns(start - 1)[0]?.id).toBe(sentCampaign.id);
    expect(activeSponsorCampaigns(start)[0]?.id).toBe(coderabbitCampaign.id);
    expect(activeSponsorCampaigns(end - 1)[0]?.id).toBe(coderabbitCampaign.id);
    expect(activeSponsorCampaigns(end).map(({ id }) => id)).toEqual([
      meteoropsCampaign.id,
      nangoCampaign.id,
    ]);
    expect(
      end - Date.parse("2026-10-20T00:00:00-04:00"),
    ).toBeGreaterThanOrEqual(30 * 86400000);
    // Nango and MeteorOps: the two shared halves of the website (no README)
    // for the same 30 full days, then vacant.
    const nangoEnd = Date.parse(nangoCampaign.endsAt);
    expect(activeReadmeSponsorCampaign(end)).toBeUndefined();
    expect(activeSponsorCampaigns(nangoEnd - 1).map(({ id }) => id)).toEqual([
      meteoropsCampaign.id,
      nangoCampaign.id,
    ]);
    expect(activeSponsorCampaigns(nangoEnd)).toEqual([]);
    expect(nangoEnd - end).toBe(30 * 86400000);
  });

  // Rotation splits the website between at most two shared campaigns; an
  // exclusive campaign, which also holds the README, shares with nobody.
  it("never overbooks: exclusive runs alone, at most two shared at once", () => {
    expect(scheduleProblems(scheduledSponsorCampaigns)).toEqual([]);
    expect(new Set(scheduledSponsorCampaigns.map(({ id }) => id)).size).toBe(
      scheduledSponsorCampaigns.length,
    );
    // The check itself catches both kinds of overbooking.
    expect(
      scheduleProblems([
        campaign("a", "exclusive", 0, 10),
        campaign("b", "shared", 5, 15),
      ]),
    ).toHaveLength(1);
    expect(
      scheduleProblems([
        campaign("a", "shared", 0, 10),
        campaign("b", "shared", 0, 10),
        campaign("c", "shared", 9, 20),
      ]),
    ).toHaveLength(1);
    expect(
      scheduleProblems([
        campaign("a", "shared", 0, 10),
        campaign("b", "shared", 5, 15),
        campaign("c", "shared", 10, 20),
      ]),
    ).toEqual([]);
  });

  it("rotates two shared campaigns evenly, one ad per page view", () => {
    const shared = [
      campaign("alpha", "shared", 0, 10),
      campaign("beta", "shared", 0, 10),
    ];
    expect(activeSponsorCampaigns(5, shared).map(({ id }) => id)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(activeReadmeSponsorCampaign(5, shared)).toBeUndefined();
    expect(pickSponsorCampaign([shared[0]], "/", 1)).toBe(shared[0]);
    expect(pickSponsorCampaign([], "/", 1)).toBeUndefined();
    // Same page and hour, same ad (server HTML and browser agree).
    expect(pickSponsorCampaign(shared, "/facebook/react", 7)).toBe(
      pickSponsorCampaign(shared, "/facebook/react", 7),
    );
    // A page gets each sponsor for exactly half the hours of a 30-day run,
    // whenever the run starts...
    for (const start of [0, 7, 492_113]) {
      const hours = Array.from(
        { length: 720 },
        (_, hour) => pickSponsorCampaign(shared, "/", start + hour)!.id,
      );
      expect(hours.filter((id) => id === "alpha")).toHaveLength(360);
      // ...and for half the days at any one hour of the day.
      const sameHour = hours.filter((_, hour) => hour % 24 === 9);
      expect(sameHour.filter((id) => id === "alpha")).toHaveLength(15);
    }
    // ...and pages split evenly within an hour.
    const pages = Array.from(
      { length: 2000 },
      (_, index) => pickSponsorCampaign(shared, `/owner${index}/repo`, 0)!.id,
    ).filter((id) => id === "alpha").length;
    expect(pages / 2000).toBeGreaterThan(0.46);
    expect(pages / 2000).toBeLessThan(0.54);
  });

  it("finds the last booked campaign until it ends", () => {
    expect(
      lastBookedSponsorCampaign(Date.parse(sentCampaign.startsAt))?.id,
    ).toBe(nangoCampaign.id);
    expect(
      lastBookedSponsorCampaign(Date.parse(nangoCampaign.endsAt) - 1)?.id,
    ).toBe(nangoCampaign.id);
    expect(
      lastBookedSponsorCampaign(Date.parse(nangoCampaign.endsAt)),
    ).toBeUndefined();
  });

  it("uses uncached server time and cannot force a preview onto production", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
    vi.stubEnv("SPONSOR_PREVIEW_CAMPAIGN", coderabbitCampaign.id);
    const response = GET(new Request("https://gitdiagram.com/api/sponsor"));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      campaignIds: [sentCampaign.id],
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
      campaignIds: [coderabbitCampaign.id],
      preview: true,
      nextTransition: null,
    });
    vi.setSystemTime(new Date(coderabbitCampaign.startsAt));
    expect(
      await GET(new Request("https://gitdiagram.com/api/sponsor")).json(),
    ).toMatchObject({ campaignIds: [coderabbitCampaign.id] });
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

describe("sponsorAnswer", () => {
  const during = Date.parse(sentCampaign.startsAt) + 60_000;

  it("names the campaigns on show and when that next changes", () => {
    const answer = sponsorAnswer("gitdiagram.com", during);
    expect(answer.campaignIds).toEqual([sentCampaign.id]);
    expect(answer.campaignId).toBe(sentCampaign.id);
    expect(answer.serverTime).toBe(during);
    expect(answer.preview).toBe(false);
    expect(answer.nextTransition).toBeGreaterThan(during);
  });

  it("shows a preview rotation only off the site's own hostname", () => {
    const preview = sponsorAnswer(
      "preview.example.com",
      0,
      ` ${sentCampaign.id}, nope `,
    );
    expect(preview).toMatchObject({
      campaignIds: [sentCampaign.id],
      preview: true,
      nextTransition: null,
    });
    expect(sponsorAnswer("gitdiagram.com", 0, sentCampaign.id).preview).toBe(
      false,
    );
  });
});
