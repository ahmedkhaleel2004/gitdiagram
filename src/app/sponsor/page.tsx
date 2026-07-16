import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, ShieldCheck, Sparkles } from "lucide-react";
import { GITHUB_REPO_URL } from "~/lib/site";
import { GitHubIcon } from "~/components/icons/github-icon";
import { SponsorEmailActions } from "./sponsor-email-actions";

export const metadata: Metadata = {
  title: "Sponsor GitDiagram",
  description:
    "Reach developers while they are actively inspecting GitHub repositories with GitDiagram.",
  alternates: {
    canonical: "/sponsor",
  },
};

type Stat = {
  label: string;
  value: string;
  detail: string;
};

const lifetimeStats: Stat[] = [
  {
    label: "Unique visitors",
    value: "308,254",
    detail: "Tracked since Dec 23, 2024",
  },
  {
    label: "Pageviews",
    value: "674,875",
    detail: "Across GitDiagram",
  },
  {
    label: "GitHub stars",
    value: "15.6k",
    detail: "Open-source developer reach",
  },
];

const monthlyStats: Stat[] = [
  {
    label: "Dev visitors",
    value: "10,411",
    detail: "Unique, across GitDiagram",
  },
  {
    label: "Pageviews",
    value: "21,268",
    detail: "Across GitDiagram",
  },
  {
    label: "Public repo diagrams",
    value: "4,056",
    detail: "Generated in the last 30 days",
  },
];

const surfaces = [
  {
    name: "Repo diagram pages",
    pageviews: "11,246",
    description:
      "Sponsor line placed on generated repository diagram pages, right after the primary diagram experience — where developers spend the most time.",
  },
  {
    name: "Homepage",
    pageviews: "7,591",
    description:
      "Native sponsor line near the repository input, in front of developers as they start a lookup.",
  },
  {
    name: "Browse catalog",
    pageviews: "1,032",
    description:
      "Placement on the catalog where developers explore public repositories.",
  },
  {
    name: "GitHub README",
    pageviews: null,
    description:
      "Sponsor mention in the open-source project README — durable, long-tail discovery.",
  },
];

const sponsorFits = [
  "AI coding tools and repo agents",
  "Code review, security, and dependency tools",
  "Observability, logging, and API monitoring",
  "Cloud hosting, databases, CI, and developer infrastructure",
];

const SPONSOR_EMAIL_ADDRESS = "ahmedkhaleel2004@gmail.com";
const SPONSOR_EMAIL = `mailto:${SPONSOR_EMAIL_ADDRESS}?subject=GitDiagram%20sponsor%20slot`;

export default function SponsorPage() {
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
            The founding sponsor slot is open. Includes category exclusivity,
            native placements, and a monthly UTM/screenshot report.
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
              As of May 13, 2026
            </p>
          </div>

          <div className="mt-8 space-y-8">
            <StatRow heading="Lifetime" stats={lifetimeStats} />
            <StatRow heading="Last 30 days" stats={monthlyStats} />
          </div>
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
            comparing how real software is built.
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
                      {surface.pageviews}/mo
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
              Founding sponsors get category exclusivity, clean native
              placement, and a monthly report with UTM clicks and surface
              screenshots.
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
