export type SponsorCreative = {
  name: string;
  message: string;
  action: string;
  logo: {
    src: string;
    darkSrc?: string;
    width: number;
    height: number;
    kind: "wordmark" | "mark";
  };
};

const sentCreative: SponsorCreative = {
  name: "Sent",
  message: "SMS, WhatsApp, and RCS through one API.",
  action: "Try Sent",
  logo: {
    src: "/sponsors/sent-logo.png",
    darkSrc: "/sponsors/sent-logo-dark.svg",
    width: 1746,
    height: 552,
    kind: "wordmark",
  },
};

export const sponsorCreatives: Record<string, SponsorCreative> = {
  "sent-2026-09": sentCreative,
  "coderabbit-2026-10": {
    name: "CodeRabbit",
    message: "AI code reviews for your pull requests.",
    action: "Try CodeRabbit",
    logo: {
      src: "/sponsors/coderabbit-wordmark.svg",
      darkSrc: "/sponsors/coderabbit-wordmark-white.svg",
      width: 2152,
      height: 314,
      kind: "wordmark",
    },
  },
};
