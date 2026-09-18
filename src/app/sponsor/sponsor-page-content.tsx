import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { GITHUB_REPO_URL } from "~/lib/site";
import { SponsorEmailActions } from "./sponsor-email-actions";
import { SponsorPlacementPreview } from "./sponsor-placement-preview";
import {
  SPONSOR_EMAIL,
  SPONSOR_EMAIL_ADDRESS,
  SPONSOR_PRICE,
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
          <strong>{content.monthlyVisitors} tracked unique visitors</strong> in
          the last 30 days. Reach developers as they explore GitHub
          repositories, with placements that link directly to your website.
        </p>
        <p className={styles.offerSummary}>
          <span>
            <strong>{SPONSOR_PRICE} USD</strong> · 30 days
          </span>
          <span className={styles.offerSummaryDetails}>
            All four placements included
          </span>
        </p>
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
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="audience-title">An audience for your next launch.</h2>
            <p>
              GitDiagram turns repositories into architecture diagrams.
              Developers come here to understand code, explore projects, and
              decide what to build with.
            </p>
          </div>
          <Link href={GITHUB_REPO_URL} className={styles.textLink}>
            View the open-source project
            <ArrowUpRight aria-hidden="true" />
          </Link>
        </div>
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
            Figures refresh about every five minutes. The 30-day window ends at
            the time shown. Visitors are unique within each window. Pageviews
            measure site traffic, not sponsor impressions.
          </p>
        </div>
      </section>

      <section
        className={styles.detailSection}
        id="sponsor-placements"
        aria-labelledby="placements-title"
      >
        <div>
          <h2 id="placements-title">Where developers find you.</h2>
          <p className={styles.sectionIntro}>
            Your product appears alongside the repositories they came to
            explore. Each placement gives them a direct path to your website.
          </p>
        </div>
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
          <h2 id="fit-title">Built for the same people.</h2>
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
            Sponsorship is clearly labeled, with no third-party ad scripts,
            tracking pixels, or popups.
          </p>
        </div>
      </section>

      <section
        className={styles.offer}
        id="sponsor-offer"
        aria-labelledby="offer-title"
      >
        <div className={styles.offerHeading}>
          <div>
            <h2 id="offer-title">30-day sponsorship.</h2>
            <p className={styles.offerDescription}>
              Your logo, a short product description, and a link to your
              website. One fixed price covers the homepage, repository diagram
              pages, browse catalog, and GitHub README for 30 days.
            </p>
          </div>
          <p className={styles.price}>
            {SPONSOR_PRICE} <span>USD / 30 days</span>
          </p>
        </div>
        <div className={styles.offerActions}>
          <div>
            <SponsorEmailActions
              email={SPONSOR_EMAIL_ADDRESS}
              mailto={SPONSOR_EMAIL}
            />
            <p className={styles.availability}>
              Available now. Email Ahmed to agree on the dates and creative.
            </p>
          </div>
          <p className={styles.terms}>
            One-time payment before launch.
            <br />
            No automatic renewal.
          </p>
        </div>
      </section>
    </main>
  );
}
