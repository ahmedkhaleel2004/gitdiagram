import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markdownSponsorCampaign: vi.fn(),
}));
vi.mock("./sponsor-campaign", () => ({
  markdownSponsorCampaign: mocks.markdownSponsorCampaign,
}));

import { proxyDecision } from "./proxy-rules";

describe("the Markdown twin while a sponsor has the placement", () => {
  it("is routed to that campaign's copy, picked for the lowercase page", () => {
    mocks.markdownSponsorCampaign.mockReturnValue({ id: "acme-2027-01" });
    expect(
      proxyDecision("GET", "/acme/demo.md", new Headers(), 1234).decision,
    ).toEqual({
      action: "rewrite",
      pathname: "/acme/demo/llms.txt/acme-2027-01",
    });
    expect(mocks.markdownSponsorCampaign).toHaveBeenCalledWith(
      "/acme/demo",
      1234,
    );
    expect(
      proxyDecision(
        "GET",
        "/acme/demo",
        new Headers({ accept: "text/markdown" }),
      ).decision,
    ).toEqual({
      action: "rewrite",
      pathname: "/acme/demo/llms.txt/acme-2027-01",
    });
  });

  it("is the plain copy once no campaign has it", () => {
    mocks.markdownSponsorCampaign.mockReturnValue(undefined);
    expect(
      proxyDecision("GET", "/acme/demo.md", new Headers()).decision,
    ).toEqual({ action: "rewrite", pathname: "/acme/demo/llms.txt" });
  });
});
