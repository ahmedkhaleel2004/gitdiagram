import { ArrowUpRight } from "lucide-react";
import { sponsorClickHref } from "~/lib/sponsor-campaign";
import { sentCreative, type SponsorCreative } from "~/lib/sponsor-creative";
import { cn } from "~/lib/utils";
import styles from "./sponsor-slot.module.css";

type SponsorSurface = "home" | "diagram" | "browse";

function SponsorBanner({
  creative,
  href,
  className,
  embedded = false,
}: {
  creative: SponsorCreative;
  href: string;
  className?: string;
  embedded?: boolean;
}) {
  const { logo } = creative;

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
  surface: SponsorSurface;
  className?: string;
}) {
  return (
    <SponsorBanner
      creative={sentCreative}
      href={sponsorClickHref(surface)}
      className={className}
    />
  );
}

export function SponsorCatalogRow() {
  return (
    <tr
      aria-label="Sponsored by Sent"
      className="block border-b border-black/15 align-middle lg:table-row dark:border-white/10"
    >
      <td colSpan={4} className="block p-0 lg:table-cell">
        <SponsorBanner
          creative={sentCreative}
          href={sponsorClickHref("browse")}
          embedded
        />
      </td>
    </tr>
  );
}
