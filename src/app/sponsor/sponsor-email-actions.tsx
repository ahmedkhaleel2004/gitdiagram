"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import styles from "./sponsor-page.module.css";

export function SponsorEmailActions({
  email,
  mailto,
}: {
  email: string;
  mailto: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.location.href = mailto;
    }
  };

  return (
    <div className={styles.contactActions}>
      <a href={mailto} className={`neo-button ${styles.contactPrimary}`}>
        <Mail aria-hidden="true" />
        Email Ahmed
      </a>
      <button
        type="button"
        onClick={handleCopy}
        className={`browse-muted-button ${styles.contactCopy}`}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied email" : "Copy email"}</span>
      </button>
    </div>
  );
}
