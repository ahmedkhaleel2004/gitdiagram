import Image from "next/image";
import styles from "./sponsor-page.module.css";

export function SponsorBookings() {
  return (
    <div className={styles.bookings}>
      <div className={styles.bookedCampaign}>
        <div className={styles.bookedBrand}>
          <p className={styles.bookingLabel}>Our next sponsor</p>
          <Image
            src="/sponsors/coderabbit-wordmark.svg"
            alt="CodeRabbit"
            width={2152}
            height={314}
            className={styles.brandLight}
            unoptimized
          />
          <Image
            src="/sponsors/coderabbit-wordmark-white.svg"
            alt="CodeRabbit"
            width={2152}
            height={313}
            className={styles.brandDark}
            unoptimized
          />
        </div>
        <div className={styles.bookingDetails}>
          <span className={styles.bookedBadge}>Booked</span>
          <p>
            Starts <time dateTime="2026-10-20">October 20, 2026</time>
          </p>
          <p className={styles.bookingDuration}>30-day exclusive campaign</p>
        </div>
      </div>
      <p className={styles.currentSponsor}>Currently sponsored by Sent</p>
    </div>
  );
}
