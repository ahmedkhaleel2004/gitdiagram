import type { SponsorCampaignId } from "./sponsor-campaign";

export type SponsorCreative = {
  name: string;
  message: string;
  action: string;
  // Files in /sponsors are cached for a day (plus a week stale) by browsers and
  // the CDN. Give a changed logo a new file name; never replace one in place.
  // sponsor-creative.test.ts pins each file's hash to enforce this.
  logo: {
    src: string;
    darkSrc?: string;
    // Full-colour logo for dark backgrounds, when `darkSrc` is monochrome.
    // The /advertise logo row shows it on hover.
    colorDarkSrc?: string;
    width: number;
    height: number;
    kind: "wordmark" | "mark";
    // Display width in the GitHub README, in pixels.
    readmeWidth: number;
  };
};

// Keyed by campaign ID, so every scheduled campaign must have a creative.
export const sponsorCreatives: Record<SponsorCampaignId, SponsorCreative> = {
  "sent-2026-09": {
    name: "Sent",
    message: "SMS, WhatsApp, and RCS through one API.",
    action: "Try Sent",
    logo: {
      src: "/sponsors/sent-logo.png",
      darkSrc: "/sponsors/sent-logo-dark.svg",
      width: 1746,
      height: 552,
      kind: "wordmark",
      readmeWidth: 104,
    },
  },
  "coderabbit-2026-10": {
    name: "CodeRabbit",
    message: "AI code reviews for your pull requests.",
    action: "Try CodeRabbit",
    logo: {
      src: "/sponsors/coderabbit-wordmark.svg",
      darkSrc: "/sponsors/coderabbit-wordmark-white.svg",
      colorDarkSrc: "/sponsors/coderabbit-wordmark-dark.svg",
      width: 2152,
      height: 314,
      kind: "wordmark",
      readmeWidth: 156,
    },
  },
};
