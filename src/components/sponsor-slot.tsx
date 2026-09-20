import { ArrowUpRight } from "lucide-react";
import { sponsorClickHref } from "~/lib/sponsor-campaign";
import { cn } from "~/lib/utils";

type SponsorSurface = "home" | "diagram" | "browse";

function SponsorCreative() {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="block w-[104px] shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sponsors/sent-logo.png"
            alt="Sent"
            width={104}
            height={33}
            className="block h-auto w-full dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sponsors/sent-logo-dark.svg"
            alt="Sent"
            width={104}
            height={33}
            className="hidden h-auto w-full dark:block"
          />
        </span>
        <span className="text-[10px] leading-4 font-medium text-[hsl(var(--neo-soft-text))] dark:text-neutral-400">
          Sponsored
        </span>
      </span>
      <span className="mt-1.5 block text-[13px] leading-5 font-medium text-[hsl(var(--neo-soft-text))] sm:text-sm dark:text-neutral-300">
        SMS, WhatsApp, and RCS through one API.
      </span>
    </span>
  );
}

function SponsorAction() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-black dark:text-neutral-100">
      <span className="hidden sm:inline">Try Sent</span>
      <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

export function SponsorSlot({
  surface,
  className,
}: {
  surface: SponsorSurface;
  className?: string;
}) {
  return (
    <a
      href={sponsorClickHref(surface)}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label="Sponsored by Sent"
      className={cn(
        "neo-lift group flex items-center gap-4 rounded-md border-[2px] border-black bg-[hsl(var(--neo-input-bg))] px-3.5 py-3 text-left shadow-[3px_3px_0_0_#000] dark:bg-[hsl(var(--neo-panel-muted))]",
        surface === "diagram" &&
          "w-full border-[3px] bg-[hsl(var(--neo-panel))] px-4 shadow-[4px_4px_0_0_#000] dark:bg-[hsl(var(--neo-panel))]",
        className,
      )}
    >
      <SponsorCreative />
      <SponsorAction />
    </a>
  );
}

export function SponsorCatalogRow() {
  return (
    <tr
      aria-label="Sponsored by Sent"
      className="block border-b border-black/15 bg-[hsl(var(--neo-panel-muted))]/60 align-middle lg:table-row dark:border-white/10"
    >
      <td colSpan={4} className="block p-0 lg:table-cell">
        <a
          href={sponsorClickHref("browse")}
          target="_blank"
          rel="sponsored noopener noreferrer"
          className="group flex items-center justify-between gap-4 px-4 py-4 text-left lg:px-5"
        >
          <SponsorCreative />
          <SponsorAction />
        </a>
      </td>
    </tr>
  );
}
