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
  // The logo grid on /advertise: false leaves the sponsor out of it; a
  // heavier copy and a larger area (×scale) even out thin wordmarks.
  advertiserRow?: false | { src: string; darkSrc: string; scale: number };
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
  "nango-2026-11": {
    name: "Nango",
    message: "Connect your AI agents to 1,000+ APIs.",
    action: "Try Nango",
    logo: {
      src: "/sponsors/nango-wordmark.svg",
      darkSrc: "/sponsors/nango-wordmark-white.svg",
      width: 9111,
      height: 2167,
      kind: "wordmark",
      readmeWidth: 112,
    },
  },
  "meteorops-2026-11": {
    name: "MeteorOps",
    advertiserRow: false,
    message: "Fix your DevOps bottleneck in 24h",
    action: "Connect with a DevOps Expert",
    logo: {
      src: "/sponsors/meteorops-wordmark.png",
      darkSrc: "/sponsors/meteorops-wordmark-white.png",
      width: 1390,
      height: 367,
      kind: "wordmark",
      readmeWidth: 120,
    },
  },
  "sentry-2026-12": {
    name: "Sentry",
    message: "Code breaks, fix it faster.",
    advertiserRow: {
      src: "/sponsors/sentry-wordmark-bold.svg",
      darkSrc: "/sponsors/sentry-wordmark-white-bold.svg",
      scale: 1.3,
    },
    action: "Try Sentry",
    logo: {
      src: "/sponsors/sentry-wordmark.svg",
      darkSrc: "/sponsors/sentry-wordmark-white.svg",
      width: 200,
      height: 44,
      kind: "wordmark",
      readmeWidth: 112,
    },
  },
  "temporal-2026-12": {
    name: "Temporal",
    message: "The world's best AI runs on Temporal.",
    advertiserRow: {
      src: "/sponsors/temporal-wordmark-bold.svg",
      darkSrc: "/sponsors/temporal-wordmark-white-bold.svg",
      scale: 1.55,
    },
    action: "Try Temporal",
    logo: {
      src: "/sponsors/temporal-wordmark.svg",
      darkSrc: "/sponsors/temporal-wordmark-white.svg",
      width: 1548.8,
      height: 390.4,
      kind: "wordmark",
      readmeWidth: 112,
    },
  },
  "temporal-2027-01": {
    name: "Temporal",
    message: "The world's best AI runs on Temporal.",
    advertiserRow: {
      src: "/sponsors/temporal-wordmark-bold.svg",
      darkSrc: "/sponsors/temporal-wordmark-white-bold.svg",
      scale: 1.55,
    },
    action: "Try Temporal",
    logo: {
      src: "/sponsors/temporal-wordmark.svg",
      darkSrc: "/sponsors/temporal-wordmark-white.svg",
      width: 1548.8,
      height: 390.4,
      kind: "wordmark",
      readmeWidth: 112,
    },
  },
};
