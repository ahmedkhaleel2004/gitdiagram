import { ArrowDown } from "lucide-react";
import Image from "next/image";
import { SponsorEmailActions } from "./sponsor-email-actions";
import { SponsorPlacementPreview } from "./sponsor-placement-preview";
import {
  SPONSOR_EMAIL,
  SPONSOR_EMAIL_ADDRESS,
  SPONSOR_PRICE,
  SPONSOR_EXCLUSIVE_PRICE,
  sponsorFits,
  type SponsorContent,
  type SponsorMetric,
} from "./sponsor-content";
import styles from "./sponsor-page.module.css";

function AudienceMetrics({
  title,
  metrics,
}: {
  title: string;
  metrics: SponsorMetric[];
}) {
  return (
    <div className={styles.metricGroup}>
      <h3>{title}</h3>
      <dl className={styles.metrics}>
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd className={styles.metricValue}>{metric.value}</dd>
            <dd className={styles.metricDetail}>{metric.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SponsorPageContent({ content }: { content: SponsorContent }) {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1>
          Bring developers
          <br />
          <span>to your product.</span>
        </h1>
        <p className={styles.introduction}>
          GitDiagram had{" "}
          <strong>{content.monthlyVisitors} unique visitors</strong> in the last
          30 days. Reach developers as they explore GitHub repositories, with
          placements that link directly to your website.
        </p>
        <p className={styles.offerSummary}>
          <span>
            From <strong>{SPONSOR_PRICE} USD</strong> · 30 days
          </span>
          <span className={styles.offerSummaryDetails}>
            Shared or exclusive placements
          </span>
        </p>
        <p className={styles.availability}>{content.availability}</p>
        <div className={styles.heroActions}>
          <SponsorEmailActions
            email={SPONSOR_EMAIL_ADDRESS}
            mailto={SPONSOR_EMAIL}
          />
          <a href="#sponsor-placements" className={styles.textLink}>
            See the placements
            <ArrowDown aria-hidden="true" />
          </a>
        </div>
      </section>

      <section
        id="sponsor-audience"
        className={styles.audience}
        aria-labelledby="audience-title"
      >
        <h2 id="audience-title">Audience</h2>
        <div className={styles.audienceColumns}>
          <AudienceMetrics title="Last 30 days" metrics={content.monthly} />
          <AudienceMetrics title="Lifetime" metrics={content.lifetime} />
        </div>
        <div className={styles.dataNote}>
          <p>
            Source: PostHog and GitHub.{" "}
            <time dateTime={content.asOf}>Updated {content.updatedAt}.</time>
          </p>
          <p>
            Figures refresh about every hour, lifetime totals daily. The 30-day
            window ends at the time shown. Visitors are unique within each
            window. Pageviews measure site traffic, not ad impressions.
          </p>
        </div>
      </section>

      <section
        className={styles.detailSection}
        id="sponsor-placements"
        aria-labelledby="placements-title"
      >
        <h2 id="placements-title">Placements</h2>
        <div>
          <div className={styles.placements}>
            {content.surfaces.map((surface) => (
              <article key={surface.name}>
                <div className={styles.placementHeading}>
                  <h3>{surface.name}</h3>
                  <p>
                    <span>{surface.metric.value}</span> {surface.metric.label}
                  </p>
                </div>
                <p>{surface.description}</p>
                <SponsorPlacementPreview
                  name={surface.name}
                  preview={surface.preview}
                />
              </article>
            ))}
          </div>
          <p className={styles.placementNote}>
            Pageviews are from the same 30-day window.
          </p>
        </div>
      </section>

      <section className={styles.detailSection} aria-labelledby="fit-title">
        <div>
          <h2 id="fit-title">Who it’s for</h2>
          <p className={styles.sectionIntro}>
            If your customers build software, GitDiagram is a relevant place to
            introduce your product.
          </p>
        </div>
        <div>
          <ul className={styles.fitList}>
            {sponsorFits.map((fit) => (
              <li key={fit}>{fit}</li>
            ))}
          </ul>
          <p className={styles.privacy}>
            Advertising is clearly labeled, with no third-party ad scripts,
            tracking pixels, or popups.
          </p>
        </div>
      </section>

      <section
        className={styles.offer}
        id="sponsor-offer"
        aria-labelledby="offer-title"
      >
        {content.bookedBy && (
          <p className={styles.bookingNote}>
            <span>{content.bookedBy.label}</span>
            <Image
              src={content.bookedBy.logo.src}
              alt={content.bookedBy.name}
              width={content.bookedBy.logo.width}
              height={content.bookedBy.logo.height}
              className={
                content.bookedBy.logo.darkSrc
                  ? styles.bookingLogoLight
                  : undefined
              }
              unoptimized
            />
            {content.bookedBy.logo.darkSrc && (
              <Image
                src={content.bookedBy.logo.darkSrc}
                alt={content.bookedBy.name}
                width={content.bookedBy.logo.width}
                height={content.bookedBy.logo.height}
                className={styles.bookingLogoDark}
                unoptimized
              />
            )}
          </p>
        )}
        <div className={styles.offerHeading}>
          <div>
            <h2 id="offer-title">Advertise for 30 days</h2>
            <p className={styles.offerDescription}>
              {content.offerTiming} Choose a shared website spot or an exclusive
              campaign.
            </p>
          </div>
        </div>
        <dl className={styles.planList}>
          <div>
            <dt>Shared website spot</dt>
            <dd className={styles.planPrice}>
              {SPONSOR_PRICE} <span>USD / 30 days</span>
            </dd>
            <dd className={styles.planDescription}>
              Homepage, repo diagrams, and browse catalog. A 50/50 rotation with
              one other sponsor, with one ad shown at a time. Website only.
            </dd>
          </div>
          <div>
            <dt>Exclusive campaign</dt>
            <dd className={styles.planPrice}>
              {SPONSOR_EXCLUSIVE_PRICE} <span>USD / 30 days</span>
            </dd>
            <dd className={styles.planDescription}>
              Your brand is the only advertiser across the homepage, repo
              diagrams, browse catalog, and GitHub README.
            </dd>
          </div>
        </dl>
        <div className={styles.offerActions}>
          <div>
            <SponsorEmailActions
              email={SPONSOR_EMAIL_ADDRESS}
              mailto={SPONSOR_EMAIL}
            />
            <p className={styles.availability}>
              Email Ahmed to agree on dates and creative before payment.
            </p>
          </div>
          <p className={styles.terms}>
            One-time payment before launch.
            <br />
            No automatic renewal.
            <br />
            Future bookings are priced separately.
          </p>
        </div>
      </section>
    </main>
  );
}
