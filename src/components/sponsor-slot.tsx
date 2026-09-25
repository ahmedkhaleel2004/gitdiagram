"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
  sponsorClickHref,
  type WebsiteSponsorPlacement,
} from "~/lib/sponsor-campaign";
import { sponsorCreatives, type SponsorCreative } from "~/lib/sponsor-creative";
import { useSponsorCampaign } from "~/hooks/use-sponsor-campaign";
import { useSponsorImpression } from "~/hooks/use-sponsor-impression";
import { cn } from "~/lib/utils";
import styles from "./sponsor-slot.module.css";

function SponsorBanner({
  creative,
  href,
  className,
  embedded = false,
  campaignId,
  confirmed,
  surface,
}: {
  creative: SponsorCreative;
  href: string;
  className?: string;
  embedded?: boolean;
  campaignId: string;
  confirmed: boolean;
  surface: WebsiteSponsorPlacement;
}) {
  const { logo } = creative;
  // Only count the campaign the schedule check confirmed, not a stale render.
  useSponsorImpression(confirmed ? campaignId : undefined, surface);

  return (
    <a
      href={href}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label={`Sponsored by ${creative.name}: ${creative.message}`}
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
          <span className={styles.disclosure}>Sponsored</span>
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
  surface: WebsiteSponsorPlacement;
  className?: string;
}) {
  const { campaign, confirmed } = useSponsorCampaign();
  if (!campaign)
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
      confirmed={confirmed}
      surface={surface}
      creative={sponsorCreatives[campaign.id]}
      href={sponsorClickHref(surface, campaign.id)}
      className={className}
    />
  );
}

export function SponsorCatalogRow() {
  const { campaign, confirmed } = useSponsorCampaign();
  return (
    <tr
      aria-label={campaign ? `Sponsored by ${campaign.sponsor}` : "Ad space"}
      className="block border-b border-black/15 align-middle lg:table-row dark:border-white/10"
    >
      <td colSpan={4} className="block p-0 lg:table-cell">
        {campaign ? (
          <SponsorBanner
            campaignId={campaign.id}
            confirmed={confirmed}
            surface="browse"
            creative={sponsorCreatives[campaign.id]}
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
