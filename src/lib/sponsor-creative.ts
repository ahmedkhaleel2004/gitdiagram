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

export const sentCreative: SponsorCreative = {
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
