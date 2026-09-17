import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Sparkles } from "lucide-react";
import { GITHUB_REPO_URL } from "~/lib/site";
import { GitHubIcon } from "~/components/icons/github-icon";
import { getSponsorStats } from "~/server/sponsor-stats";
import { SponsorEmailActions } from "./sponsor-email-actions";

export const metadata: Metadata = {
  title: "Sponsor GitDiagram",
  description:
    "Reach developers while they are actively inspecting GitHub repositories with GitDiagram.",
  alternates: {
    canonical: "/sponsor",
  },
};

export const revalidate = 300;

type Stat = {
  label: string;
  value: string;
  detail: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");
const format = (value: number) => numberFormatter.format(value);
const updatedAtFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
});
const trackedSinceFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "America/Toronto",
});

const sponsorFits = [
  "AI coding tools and repo agents",
  "Code review, security, and dependency tools",
  "Observability, logging, and API monitoring",
  "Cloud hosting, databases, CI, and developer infrastructure",
];

const SPONSOR_EMAIL_ADDRESS = "ahmedkhaleel2004@gmail.com";
const SPONSOR_EMAIL = `mailto:${SPONSOR_EMAIL_ADDRESS}?subject=GitDiagram%20sponsor%20slot`;

export default async function SponsorPage() {
  const stats = await getSponsorStats();
  const updatedAt = updatedAtFormatter.format(new Date(stats.asOf));
  const lifetimeStats: Stat[] = [
    {
      label: "Tracked unique visitors",
      value: format(stats.lifetimeVisitors),
      detail: `Tracked since ${trackedSinceFormatter.format(new Date(stats.trackedSince))}`,
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

  const monthlyStats: Stat[] = [
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

  const surfaces = [
    {
      name: "Repo diagram pages",
      pageviews: format(stats.repoPageviews),
      description:
        "Sponsor line placed on generated repository diagram pages, right after the primary diagram experience.",
    },
    {
      name: "Homepage",
      pageviews: format(stats.homePageviews),
      description:
        "Native sponsor line near the repository input, in front of developers as they start a lookup.",
    },
    {
      name: "Browse catalog",
      pageviews: format(stats.browsePageviews),
      description:
        "Placement on the catalog where developers explore public repositories.",
    },
    {
      name: "GitHub README",
      pageviews: null,
      description:
        "Sponsor mention in the open-source project README for developers discovering GitDiagram on GitHub.",
    },
  ];

  return (
    <main className="flex-grow px-5 py-10 sm:px-8 lg:py-14">
      <div className="mx-auto max-w-5xl">
        {/* HERO */}
        <section>
          <h1 className="max-w-4xl text-4xl leading-[1.04] font-black tracking-tight text-black sm:text-5xl lg:text-[4.25rem] dark:text-neutral-50">
            Reach developers while they{" "}
            <span className="text-purple-700 dark:text-[hsl(var(--neo-link))]">
              inspect real GitHub codebases
            </span>
            .
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-7 text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            GitDiagram is an open-source tool developers use to turn
            repositories into architecture diagrams. Sponsor the moment when
            they are already thinking about code structure, tooling, and
            technical decisions.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <SponsorEmailActions
              email={SPONSOR_EMAIL_ADDRESS}
              mailto={SPONSOR_EMAIL}
            />
            <Link
              href={GITHUB_REPO_URL}
              className="browse-muted-button inline-flex min-h-[48px] w-fit items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-bold"
            >
              <GitHubIcon className="h-4 w-4" aria-hidden="true" />
              View the project
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-5 max-w-3xl text-sm leading-6 font-bold text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            Sponsor GitDiagram for $999 USD for 30 days. Includes the homepage,
            repository pages, browse catalog, and GitHub README.
          </p>
        </section>

        {/* AUDIENCE */}
        <section className="mt-16 lg:mt-20">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-black tracking-[0.16em] text-purple-700 uppercase dark:text-[hsl(var(--neo-link))]">
                Verified audience
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-black sm:text-4xl dark:text-neutral-50">
                Current GitDiagram reach
              </h2>
            </div>
            <p className="text-sm font-semibold text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              <time dateTime={stats.asOf}>Updated {updatedAt} ET</time>
            </p>
          </div>

          <div className="mt-8 space-y-8">
            <StatRow heading="Last 30 days" stats={monthlyStats} />
            <StatRow heading="Lifetime" stats={lifetimeStats} />
          </div>
          <p className="mt-4 text-xs leading-5 text-[hsl(var(--neo-soft-text))] dark:text-neutral-400">
            Traffic figures come from PostHog for gitdiagram.com; stars come
            from GitHub. Figures refresh about every five minutes. The 30-day
            window ends at the time shown above. Visitors are unique within each
            window. Pageviews measure site traffic, not sponsor impressions.
          </p>
        </section>

        {/* SURFACES */}
        <section className="mt-16 lg:mt-20">
          <p className="text-xs font-black tracking-[0.16em] text-purple-700 uppercase dark:text-[hsl(var(--neo-link))]">
            Surfaces
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-black sm:text-4xl dark:text-neutral-50">
            Clean native placements across the product.
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-7 text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
            GitDiagram visitors aren&apos;t passively scrolling. They are
            looking up repositories, reading generated architecture maps, and
            comparing how real software is built. The figures below are
            pageviews in the same 30-day window.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {surfaces.map((surface) => (
              <div
                key={surface.name}
                className="rounded-lg border-[3px] border-black bg-[hsl(var(--neo-panel))] p-5 shadow-[5px_5px_0_0_#000]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-lg font-black text-black dark:text-neutral-50">
                    {surface.name}
                  </h3>
                  {surface.pageviews && (
                    <span className="shrink-0 rounded-md border-[2px] border-black bg-[hsl(var(--neo-button))] px-2 py-0.5 text-xs font-black tracking-wide text-black">
                      {surface.pageviews} views
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm leading-6 text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
                  {surface.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* BEST FIT */}
        <section className="mt-16 lg:mt-20">
          <p className="text-xs font-black tracking-[0.16em] text-purple-700 uppercase dark:text-[hsl(var(--neo-link))]">
            Best fit
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-black tracking-tight text-black sm:text-4xl dark:text-neutral-50">
            Built for companies selling to developers.
          </h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {sponsorFits.map((fit) => (
              <li
                key={fit}
                className="flex items-center gap-3 rounded-lg border-[3px] border-black bg-[hsl(var(--neo-panel))] px-4 py-3 shadow-[4px_4px_0_0_#000]"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-purple-700 dark:bg-[hsl(var(--neo-link))]"
                  aria-hidden="true"
                />
                <p className="text-sm font-bold text-black dark:text-neutral-100">
                  {fit}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex gap-3 rounded-lg border-[3px] border-black bg-[hsl(var(--neo-panel))] p-4 shadow-[4px_4px_0_0_#000]">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-purple-700 dark:text-[hsl(var(--neo-link))]"
              aria-hidden="true"
            />
            <p className="text-sm leading-6 font-semibold text-black dark:text-neutral-100">
              Sponsorship is clearly labeled and does not use third-party ad
              scripts, tracking pixels, or popups.
            </p>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="mt-16 lg:mt-20">
          <div className="neo-panel relative rounded-lg p-8 sm:p-10">
            <Sparkles
              className="pointer-events-none absolute -top-6 -right-3 h-20 w-20 rotate-12 fill-sky-400 text-black sm:-right-5 dark:fill-[hsl(var(--neo-button))] dark:text-[hsl(var(--background))]"
              strokeWidth={0.6}
              aria-hidden="true"
            />
            <p className="text-xs font-black tracking-[0.16em] text-purple-700 uppercase dark:text-[hsl(var(--neo-link))]">
              Available now
            </p>
            <h2 className="mt-2 max-w-2xl text-3xl font-black tracking-tight text-black sm:text-4xl dark:text-neutral-50">
              Sponsor the next month of GitDiagram.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              Put your product in front of developers exploring repositories.
              $999 USD covers 30 days of clearly labeled placements across the
              site and README, with your logo, a short product description, and
              a link. Email Ahmed to agree the dates and creative. One-time
              payment before launch, with no automatic renewal.
            </p>
            <SponsorEmailActions
              email={SPONSOR_EMAIL_ADDRESS}
              mailto={SPONSOR_EMAIL}
              className="mt-6"
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function StatRow({ heading, stats }: { heading: string; stats: Stat[] }) {
  return (
    <div>
      <p className="mb-3 text-xs font-black tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase dark:text-neutral-400">
        {heading}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border-[3px] border-black bg-[hsl(var(--neo-panel))] p-5 shadow-[5px_5px_0_0_#000]"
          >
            <p className="text-3xl font-black text-black sm:text-4xl dark:text-neutral-50">
              {stat.value}
            </p>
            <p className="mt-2 text-sm font-bold text-black dark:text-neutral-100">
              {stat.label}
            </p>
            <p className="mt-1 text-xs leading-5 text-[hsl(var(--neo-soft-text))] dark:text-neutral-300">
              {stat.detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
