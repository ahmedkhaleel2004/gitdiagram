import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { coderabbitCampaign, sentCampaign } from "~/lib/sponsor-campaign";
import type { SponsorStats } from "~/server/sponsor-stats";
import { createSponsorBooking, createSponsorContent } from "./sponsor-content";
import { SponsorPageContent } from "./sponsor-page-content";

afterEach(cleanup);

const stats: SponsorStats = {
  asOf: "2026-09-17T22:40:53.000Z",
  trackedSince: "2024-12-26T12:39:22.000Z",
  lifetimeVisitors: 366235,
  lifetimePageviews: 846732,
  monthlyVisitors: 31666,
  monthlyPageviews: 81385,
  repoVisitors: 27731,
  repoPageviews: 57536,
  homePageviews: 11605,
  browsePageviews: 8350,
  githubStars: 16178,
};

describe("advertise availability", () => {
  it("follows the booked schedule instead of fixed dates", () => {
    for (const now of [
      Date.parse(sentCampaign.startsAt),
      Date.parse(coderabbitCampaign.endsAt) - 1,
    ]) {
      expect(createSponsorBooking(now)).toMatchObject({
        availability: "Next available: November 19, 2026.",
        offerTiming:
          "New campaigns start from November 19, 2026, after CodeRabbit’s run.",
        bookedBy: {
          label: "October 20 campaign booked by",
          name: "CodeRabbit",
        },
      });
    }
    expect(createSponsorBooking(Date.parse(coderabbitCampaign.endsAt))).toEqual(
      {
        availability: "Available now.",
        offerTiming: "New campaigns can start right away.",
        bookedBy: null,
      },
    );
  });

  it("drops the booking note once the last booking ends", () => {
    const view = render(
      <SponsorPageContent
        content={createSponsorContent(
          stats,
          Date.parse(coderabbitCampaign.startsAt),
        )}
      />,
    );
    expect(screen.getByText("October 20 campaign booked by")).toBeTruthy();
    // Light and dark logos, in the booking note and the advertiser row.
    expect(screen.getAllByAltText("CodeRabbit")).toHaveLength(4);
    view.rerender(
      <SponsorPageContent
        content={createSponsorContent(
          stats,
          Date.parse(coderabbitCampaign.endsAt),
        )}
      />,
    );
    expect(screen.queryByText(/campaign booked by/)).toBeNull();
    expect(screen.getByText("Available now.")).toBeTruthy();
    // Past advertisers stay listed after their runs end.
    expect(screen.getAllByAltText("CodeRabbit")).toHaveLength(2);
    expect(screen.getAllByAltText("Sent")).toHaveLength(2);
  });
});
