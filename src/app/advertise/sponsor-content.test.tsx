import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  coderabbitCampaign,
  nangoCampaign,
  sentCampaign,
  type BookedSponsorCampaign,
} from "~/lib/sponsor-campaign";
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
    // Nango and MeteorOps hold both shared halves, so nothing opens sooner.
    for (const now of [
      Date.parse(sentCampaign.startsAt),
      Date.parse(coderabbitCampaign.endsAt) - 1,
    ]) {
      expect(createSponsorBooking(now)).toMatchObject({
        availability: "Next available: December 19, 2026.",
        offerTiming:
          "New campaigns start from December 19, 2026, after Nango’s run.",
        bookedBy: {
          label: "November 19 campaign booked by",
          name: "Nango",
        },
      });
      // One shared booking leaves the other half of the website open with it.
      expect(
        createSponsorBooking(now, [
          sentCampaign,
          coderabbitCampaign,
          nangoCampaign,
        ]),
      ).toMatchObject({
        availability:
          "Shared spot from November 19, 2026. Exclusive from December 19, 2026.",
        offerTiming:
          "A shared spot can start from November 19, 2026. Exclusive campaigns start from December 19, 2026, after Nango’s run.",
      });
      expect(
        createSponsorBooking(now, [sentCampaign, coderabbitCampaign]),
      ).toMatchObject({
        availability: "Next available: November 19, 2026.",
        offerTiming:
          "New campaigns start from November 19, 2026, after CodeRabbit’s run.",
        bookedBy: {
          label: "October 20 campaign booked by",
          name: "CodeRabbit",
        },
      });
    }
    // A shared booking leaves the other half of the website open sooner.
    const sharedCodeRabbit: BookedSponsorCampaign = {
      ...coderabbitCampaign,
      package: "shared",
    };
    expect(
      createSponsorBooking(Date.parse(sentCampaign.startsAt), [
        sentCampaign,
        sharedCodeRabbit,
      ]),
    ).toMatchObject({
      availability:
        "Shared spot from October 19, 2026. Exclusive from November 19, 2026.",
      offerTiming:
        "A shared spot can start from October 19, 2026. Exclusive campaigns start from November 19, 2026, after CodeRabbit’s run.",
    });
    expect(
      createSponsorBooking(Date.parse(coderabbitCampaign.startsAt), [
        sharedCodeRabbit,
      ]).availability,
    ).toBe("Shared spot available now. Exclusive from November 19, 2026.");
    // Two shared campaigns fill the website until the first one ends.
    expect(
      createSponsorBooking(Date.parse(coderabbitCampaign.startsAt), [
        sharedCodeRabbit,
        {
          ...sentCampaign,
          package: "shared",
          endsAt: "2026-11-01T04:00:00.000Z",
        },
      ]).availability,
    ).toBe(
      "Shared spot from November 1, 2026. Exclusive from November 19, 2026.",
    );
    expect(
      createSponsorBooking(Date.parse(nangoCampaign.startsAt), [nangoCampaign])
        .availability,
    ).toBe("Shared spot available now. Exclusive from December 19, 2026.");
    expect(
      createSponsorBooking(Date.parse(nangoCampaign.startsAt)).availability,
    ).toBe("Next available: December 19, 2026.");
    expect(createSponsorBooking(Date.parse(nangoCampaign.endsAt))).toEqual({
      availability: "Available now.",
      offerTiming: "New campaigns can start right away.",
      bookedBy: null,
    });
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
    expect(screen.getByText("November 19 campaign booked by")).toBeTruthy();
    expect(screen.getAllByAltText("Nango")).toHaveLength(2);
    view.rerender(
      <SponsorPageContent
        content={createSponsorContent(stats, Date.parse(nangoCampaign.endsAt))}
      />,
    );
    expect(screen.queryByText(/campaign booked by/)).toBeNull();
    expect(screen.getByText("Available now.")).toBeTruthy();
    // Past advertisers stay listed, and linked, after their runs end.
    expect(
      screen.getByRole("link", { name: "Sent" }).getAttribute("href"),
    ).toBe("https://www.sent.dm/en");
    expect(
      screen.getByRole("link", { name: "CodeRabbit" }).getAttribute("href"),
    ).toBe("https://www.coderabbit.ai/");
    // Paid links are marked for search engines.
    expect(screen.getByRole("link", { name: "Sent" }).getAttribute("rel")).toBe(
      "sponsored noopener",
    );
  });
});
