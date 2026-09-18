import type { SponsorStats } from "~/server/sponsor-stats";

export const SPONSOR_EMAIL_ADDRESS = "ahmedkhaleel2004@gmail.com";
export const SPONSOR_EMAIL = `mailto:${SPONSOR_EMAIL_ADDRESS}?subject=GitDiagram%20sponsor%20slot`;
export const SPONSOR_PRICE = "$949";
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
      label: "Tracked unique visitors",
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
      label: "Tracked unique visitors",
      value: format(stats.lifetimeVisitors),
      detail: `Tracked since ${date(stats.trackedSince)}`,
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
        "A sponsor placement beneath generated architecture diagrams, with your logo, product description, and a link to your site.",
      preview: {
        src: "/sponsor-previews/diagram.png",
        width: 2344,
        height: 1260,
        highlight: { x: 14, y: 1018, width: 2310, height: 170 },
        alt: "The FastAPI architecture diagram with the full-width sponsor slot directly beneath it.",
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
        highlight: { x: 186, y: 1056, width: 1420, height: 148 },
        alt: "GitDiagram’s homepage with the sponsor slot below the repository input and example repositories.",
        caption: "Inside the repository lookup panel, below the examples.",
      },
    },
    {
      name: "Browse catalog",
      metric: { value: format(stats.browsePageviews), label: "pageviews" },
      description:
        "A dedicated sponsor row among the public repository listings, with your logo, description, and link.",
      preview: {
        src: "/sponsor-previews/browse.png",
        width: 2388,
        height: 1434,
        highlight: { x: 58, y: 1098, width: 2276, height: 184 },
        alt: "GitDiagram’s browse catalog with a dedicated sponsor row between the first two repository listings.",
        caption: "A dedicated row immediately after the first repository.",
      },
    },
    {
      name: "GitHub README",
      metric: { value: format(stats.githubStars), label: "GitHub stars" },
      description:
        "A sponsor mention near the top of GitDiagram’s GitHub README, linking directly to your product.",
      preview: {
        src: "/sponsor-previews/readme.png",
        width: 1804,
        height: 1000,
        highlight: { x: 60, y: 330, width: 1714, height: 76 },
        alt: "GitDiagram’s README on GitHub with the sponsor mention between the introduction and Features section.",
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
