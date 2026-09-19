import type { SponsorStats } from "~/server/sponsor-stats";

export const SPONSOR_EMAIL_ADDRESS = "ahmedkhaleel2004@gmail.com";
export const SPONSOR_EMAIL = `mailto:${SPONSOR_EMAIL_ADDRESS}?subject=Advertising%20on%20GitDiagram`;
export const SPONSOR_PRICE = "$749";
export const SPONSOR_AVAILABILITY =
  "Currently sponsored by Sent. Next available: October 20, 2026.";
export const sponsorFits = [
  "AI coding tools and repo agents",
  "Code review, security, and dependency tools",
  "Observability, logging, and API monitoring",
  "Cloud hosting, databases, CI, and developer infrastructure",
];
export type SponsorMetric = { label: string; value: string; detail: string };
export type SponsorSurface = {
  name: string;
  metric: { value: string; label: string };
  description: string;
  preview: {
    src: string;
    width: number;
    height: number;
    highlight: { x: number; y: number; width: number; height: number };
    alt: string;
    caption: string;
  };
};

const numberFormatter = new Intl.NumberFormat("en-US");
const dateOptions: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Toronto",
};
const dateFormatter = new Intl.DateTimeFormat("en-US", dateOptions);
const updatedAtFormatter = new Intl.DateTimeFormat("en-US", {
  ...dateOptions,
  hour: "numeric",
  minute: "2-digit",
});
const format = (value: number) => numberFormatter.format(value);
const date = (value: string, includeTime = false) =>
  (includeTime ? updatedAtFormatter : dateFormatter).format(new Date(value));

export function createSponsorContent(stats: SponsorStats) {
  const monthly: SponsorMetric[] = [
    {
      label: "Unique visitors",
      value: format(stats.monthlyVisitors),
      detail: "Unique, across GitDiagram",
    },
    {
      label: "Pageviews",
      value: format(stats.monthlyPageviews),
      detail: "Across GitDiagram",
    },
    {
      label: "Repo page visitors",
      value: format(stats.repoVisitors),
      detail: "Unique visitors to repository pages",
    },
  ];
  const lifetime: SponsorMetric[] = [
    {
      label: "Unique visitors",
      value: format(stats.lifetimeVisitors),
      detail: `Since ${date(stats.trackedSince)}`,
    },
    {
      label: "Pageviews",
      value: format(stats.lifetimePageviews),
      detail: "Across GitDiagram",
    },
    {
      label: "GitHub stars",
      value: format(stats.githubStars),
      detail: "Open-source developer reach",
    },
  ];
  const surfaces: SponsorSurface[] = [
    {
      name: "Repo diagram pages",
      metric: { value: format(stats.repoPageviews), label: "pageviews" },
      description:
        "An ad placement beneath generated architecture diagrams, with your logo, product description, and a link to your site.",
      preview: {
        src: "/sponsor-previews/diagram.png",
        width: 2344,
        height: 1260,
        highlight: { x: 20, y: 1018, width: 2304, height: 140 },
        alt: "The FastAPI architecture diagram with the full-width ad space directly beneath it.",
        caption: "A full-width placement beneath the generated diagram.",
      },
    },
    {
      name: "Homepage",
      metric: { value: format(stats.homePageviews), label: "pageviews" },
      description:
        "Your product appears below the repository lookup controls, where developers start turning codebases into diagrams.",
      preview: {
        src: "/sponsor-previews/home.png",
        width: 1794,
        height: 1346,
        highlight: { x: 199, y: 1084, width: 1396, height: 120 },
        alt: "GitDiagram’s homepage with the ad space below the repository input and example repositories.",
        caption: "Inside the repository lookup panel, below the examples.",
      },
    },
    {
      name: "Browse catalog",
      metric: { value: format(stats.browsePageviews), label: "pageviews" },
      description:
        "A dedicated ad row among the public repository listings, with your logo, description, and link.",
      preview: {
        src: "/sponsor-previews/browse.png",
        width: 2388,
        height: 1434,
        highlight: { x: 48, y: 924, width: 2292, height: 188 },
        alt: "GitDiagram’s browse catalog with a dedicated ad row between the first two repository listings.",
        caption: "A dedicated row immediately after the first repository.",
      },
    },
    {
      name: "GitHub README",
      metric: { value: format(stats.githubStars), label: "GitHub stars" },
      description:
        "An ad near the top of GitDiagram’s GitHub README, linking directly to your product.",
      preview: {
        src: "/sponsor-previews/readme.png",
        width: 1756,
        height: 1000,
        highlight: { x: 40, y: 333, width: 1676, height: 48 },
        alt: "GitDiagram’s README on GitHub with the ad between the introduction and Features section.",
        caption: "Below the introduction, before the Features section.",
      },
    },
  ];
  return {
    monthlyVisitors: format(stats.monthlyVisitors),
    monthly,
    lifetime,
    surfaces,
    asOf: stats.asOf,
    updatedAt: `${date(stats.asOf, true)} ET`,
  };
}
export type SponsorContent = ReturnType<typeof createSponsorContent>;
