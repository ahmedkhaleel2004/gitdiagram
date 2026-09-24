"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { sponsorClickHref } from "~/lib/sponsor-campaign";
import { sponsorCreatives, type SponsorCreative } from "~/lib/sponsor-creative";
import { useSponsorCampaign } from "~/hooks/use-sponsor-campaign";
import { useSponsorImpression } from "~/hooks/use-sponsor-impression";
import { cn } from "~/lib/utils";
import styles from "./sponsor-slot.module.css";

type SponsorSurface = "home" | "diagram" | "browse";

function SponsorBanner({
  creative,
  href,
  className,
  embedded = false,
  campaignId,
  surface,
}: {
  creative: SponsorCreative;
  href: string;
  className?: string;
  embedded?: boolean;
  campaignId?: string;
  surface: SponsorSurface;
}) {
  const { logo } = creative;
  useSponsorImpression(campaignId, surface);

  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label={
        campaignId
          ? `Sponsored by ${creative.name}: ${creative.message}`
          : "Advertise on GitDiagram"
      }
      className={cn(styles.banner, embedded && styles.embedded, className)}
    >
      <span className={styles.content}>
        <span className={styles.brand}>
          <span
            className={logo.kind === "mark" ? styles.mark : styles.wordmark}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo.src}
              alt={logo.kind === "wordmark" ? creative.name : ""}
              width={logo.width}
              height={logo.height}
              className={logo.darkSrc ? "dark:hidden" : undefined}
            />
            {logo.darkSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logo.darkSrc}
                alt={logo.kind === "wordmark" ? creative.name : ""}
                width={logo.width}
                height={logo.height}
                className="hidden dark:block"
              />
            )}
          </span>
          {logo.kind === "mark" && <span>{creative.name}</span>}
        </span>
        <span className={styles.message}>{creative.message}</span>
        <span className={styles.end}>
          <span className={styles.disclosure}>
            {campaignId ? "Sponsored" : "Ad space"}
          </span>
          <span className={styles.action}>
            {creative.action}
            <ArrowUpRight className={styles.arrow} aria-hidden="true" />
          </span>
        </span>
      </span>
    </a>
  );
}

export function SponsorSlot({
  surface,
  className,
}: {
  surface: SponsorSurface;
  className?: string;
}) {
  const campaign = useSponsorCampaign();
  const creative = campaign && sponsorCreatives[campaign.id];
  if (!campaign || !creative)
    return (
      <div className={className}>
        <Link className={cn(styles.banner, styles.vacant)} href="/advertise">
          Ad space · Advertise your product here.
        </Link>
      </div>
    );
  return (
    <SponsorBanner
      campaignId={campaign.id}
      surface={surface}
      creative={creative}
      href={sponsorClickHref(surface, campaign.id)}
      className={className}
    />
  );
}

export function SponsorCatalogRow() {
  const campaign = useSponsorCampaign();
  const creative = campaign && sponsorCreatives[campaign.id];
  return (
    <tr
      aria-label={campaign ? `Sponsored by ${campaign.sponsor}` : "Ad space"}
      className="block border-b border-black/15 align-middle lg:table-row dark:border-white/10"
    >
      <td colSpan={4} className="block p-0 lg:table-cell">
        {campaign && creative ? (
          <SponsorBanner
            campaignId={campaign.id}
            surface="browse"
            creative={creative}
            href={sponsorClickHref("browse", campaign.id)}
            embedded
          />
        ) : (
          <Link className={styles.vacant} href="/advertise">
            Ad space · Advertise your product here.
          </Link>
        )}
      </td>
    </tr>
  );
}
