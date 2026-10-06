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
  "/sponsors/coderabbit-wordmark-dark.svg":
    "882058991a16d4729057e113f5b21317365a9ec89d38c6fb7d7b5d12d96d6e55",
  "/sponsors/nango-wordmark.svg":
    "e8fedc072ba6b175a202540df557b23e3102c48bcc56f4693c1d38ffd77c18aa",
  "/sponsors/nango-wordmark-white.svg":
    "97f6a4e9e43f65365a630e5b67b5d36c1d788161780f7b47008101778b9668a8",
  "/sponsors/meteorops-wordmark.png":
    "b8ea24ebf4ae7f26be02e3df29a25c7c21f0e85afd5841cff0f10a3a6abd41df",
  "/sponsors/meteorops-wordmark-white.png":
    "3caf51e1d83f887e848c9aa431c7382c6cf0d4c4a4342cf8464772cf6bfe27ff",
};

it("has a creative for every scheduled campaign", () => {
  for (const campaign of scheduledSponsorCampaigns) {
    expect(sponsorCreatives[campaign.id]?.name).toBe(campaign.sponsor);
  }
});

it("never changes a cached sponsor logo in place", () => {
  const logos = Object.values(sponsorCreatives).flatMap(({ logo }) =>
    [logo.src, logo.darkSrc, logo.colorDarkSrc].filter(
      (path) => path !== undefined,
    ),
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
