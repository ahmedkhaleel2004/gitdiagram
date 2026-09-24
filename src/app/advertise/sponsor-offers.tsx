import { ArrowUpRight, Check } from "lucide-react";
import {
  EXCLUSIVE_SPONSOR_PRICE,
  SHARED_SPONSOR_PRICE,
  SPONSOR_AVAILABILITY,
  SPONSOR_EMAIL,
  SPONSOR_EMAIL_ADDRESS,
} from "./sponsor-content";
import { SponsorEmailActions } from "./sponsor-email-actions";
import styles from "./sponsor-page.module.css";

const offers = [
  {
    name: "Shared website spot",
    label: "Two sponsors. One ad at a time.",
    price: SHARED_SPONSOR_PRICE,
    description:
      "Your product across GitDiagram, sharing the rotation with one other sponsor.",
    features: [
      "Homepage, repo diagrams, and browse catalog",
      "50% of the website ad rotation",
      "Your logo, description, and link",
    ],
    note: "Website placements only. README is part of the exclusive package.",
    action: "Ask about a shared spot",
    subject: "Shared advertising on GitDiagram",
  },
  {
    name: "Exclusive campaign",
    label: "Every placement. Just your brand.",
    price: EXCLUSIVE_SPONSOR_PRICE,
    description:
      "Have the whole campaign to yourself, on the website and on GitHub.",
    features: [
      "Homepage, repo diagrams, and browse catalog",
      "100% of the website ad rotation",
      "GitHub README placement included",
    ],
    note: "Your brand is the only advertiser across all four placements.",
    action: "Ask about exclusivity",
    subject: "Exclusive advertising on GitDiagram",
  },
];

export function SponsorOffers() {
  return (
    <section
      className={styles.offer}
      id="sponsor-offer"
      aria-labelledby="offer-title"
    >
      <p className={styles.offerEyebrow}>After CodeRabbit’s campaign</p>
      <h2 id="offer-title">Your next 30 days.</h2>
      <p className={styles.offerIntroduction}>{SPONSOR_AVAILABILITY}</p>
      <div className={styles.offerGrid}>
        {offers.map((offer) => (
          <article key={offer.name} className={styles.offerCard}>
            <p className={styles.offerLabel}>{offer.label}</p>
            <h3>{offer.name}</h3>
            <p className={styles.price}>
              {offer.price} <span>USD / 30 days</span>
            </p>
            <p className={styles.offerDescription}>{offer.description}</p>
            <ul className={styles.offerFeatures}>
              {offer.features.map((feature) => (
                <li key={feature}>
                  <Check aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <p className={styles.offerNote}>{offer.note}</p>
            <a
              href={`mailto:${SPONSOR_EMAIL_ADDRESS}?subject=${encodeURIComponent(offer.subject)}`}
              className={`neo-button ${styles.contactPrimary}`}
            >
              {offer.action}
              <ArrowUpRight aria-hidden="true" />
            </a>
          </article>
        ))}
      </div>
      <div className={styles.offerContact}>
        <p className={styles.terms}>
          Agree on dates and creative before payment.
          <br />
          One-time payment. No automatic renewal.
        </p>
        <SponsorEmailActions
          email={SPONSOR_EMAIL_ADDRESS}
          mailto={SPONSOR_EMAIL}
        />
      </div>
    </section>
  );
}
