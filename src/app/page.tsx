import Link from "next/link";
import MainCard from "~/components/main-card";
import Hero from "~/components/hero";
import { NewBadge } from "~/components/new-badge";

const VIDEOS_ENABLED = process.env.NEXT_PUBLIC_VIDEO_EXPLAINER === "1";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GitDiagram - Visualize Any GitHub Repository",
  description:
    "Turn any GitHub repository into an interactive architecture diagram for quick codebase understanding.",
  alternates: {
    canonical: "/",
  },
};

export default function HomePage() {
  return (
    <main className="flex min-h-[calc(100svh-9.75rem)] flex-col justify-center px-4 pt-6 pb-3 sm:block sm:min-h-0 sm:px-8 sm:py-8 md:p-8">
      <div className="mx-auto mb-5 max-w-4xl pt-9 sm:mb-4 sm:pt-0 lg:my-8">
        {VIDEOS_ENABLED && (
          <div className="-mt-4 mb-16 flex justify-center sm:mt-0 sm:mb-8">
            <Link
              href="/watch"
              className="browse-muted-button inline-flex min-h-[40px] items-center gap-2.5 rounded-full py-1.5 pr-4 pl-2 text-sm font-semibold"
            >
              <NewBadge />
              Watch any repo explained in a minute
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        )}
        <Hero />
        <div className="mx-auto mt-5 max-w-[22rem] space-y-2 text-center text-[1.0625rem] leading-6 text-balance text-[hsl(var(--neo-soft-text))] sm:mt-12 sm:max-w-2xl sm:text-lg sm:leading-normal">
          <p>
            Turn any GitHub repository into an interactive diagram for
            visualization.
          </p>
          <p className="hidden sm:block">
            Or, replace &apos;hub&apos; with &apos;diagram&apos; in any GitHub
            URL.
          </p>
        </div>
      </div>
      <div className="flex justify-center sm:mb-16 lg:mb-0">
        <MainCard />
      </div>
    </main>
  );
}
