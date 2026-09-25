// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { scheduledSponsorCampaigns } from "./sponsor-campaign";
import { sponsorCreatives } from "./sponsor-creative";

const root = new URL("../../", import.meta.url);

// /sponsors files are cached for a day plus a week of stale-while-revalidate,
// so a file changed in place keeps showing the old logo to returning visitors.
// Add new files here; if a pinned hash changes, rename the file instead.
const pinnedLogoHashes: Record<string, string> = {
  "/sponsors/sent-logo.png":
    "d0a91723172711df475de287891f27ee9f0b51ef50ce27c1bd1efee38ba3f623",
  "/sponsors/sent-logo-dark.svg":
    "bae2646884313d434f3b080cc8368ee69b6e49a678dbc7064d2d1f7ae2522481",
  "/sponsors/coderabbit-wordmark.svg":
    "1cec8864aa9c10a6f3c5852057a29787191fd8382b2d83cdc4b99761713e31ec",
  "/sponsors/coderabbit-wordmark-white.svg":
    "a05d72ea8ff2db89017e6e064d71609be51a3216a4f09eb73293e6b95b1757ec",
};

it("has a creative for every scheduled campaign", () => {
  for (const campaign of scheduledSponsorCampaigns) {
    expect(sponsorCreatives[campaign.id]?.name).toBe(campaign.sponsor);
  }
});

it("never changes a cached sponsor logo in place", () => {
  const logos = Object.values(sponsorCreatives).flatMap(({ logo }) =>
    logo.darkSrc ? [logo.src, logo.darkSrc] : [logo.src],
  );
  for (const path of logos) {
    const hash = createHash("sha256")
      .update(readFileSync(new URL(`public${path}`, root)))
      .digest("hex");
    expect(hash, `${path} changed; give the new logo a new file name`).toBe(
      pinnedLogoHashes[path],
    );
  }
  // Every file in /sponsors is in use, so nothing stale ships.
  expect(
    readdirSync(new URL("public/sponsors", root))
      .map((name) => `/sponsors/${name}`)
      .sort(),
  ).toEqual(Object.keys(pinnedLogoHashes).sort());
});
