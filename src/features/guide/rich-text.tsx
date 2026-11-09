import Link from "next/link";
import type { ReactNode } from "react";

// Guide and comparison text with its two inline marks: [label](href) links
// and `code`. Links starting with "/" are this site's pages.

const linkClass = "neo-link font-medium hover:underline";
const codeClass =
  "rounded bg-black/[0.06] px-1 py-px font-mono text-[0.88em] dark:bg-white/10";

export function richText(text: string): ReactNode[] {
  return Array.from(
    text.matchAll(/\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|[^[`]+|[[`]/g),
    (match) => {
      const [part, label, href, code] = match;
      if (label && href) {
        // Site pages navigate in the app; files (.md, .txt) load as documents.
        return href.startsWith("/") && !/\.[a-z]+$/.test(href) ? (
          <Link key={match.index} href={href} className={linkClass}>
            {label}
          </Link>
        ) : (
          <a
            key={match.index}
            href={href}
            {...(href.startsWith("/")
              ? {}
              : { target: "_blank", rel: "noopener noreferrer" })}
            className={linkClass}
          >
            {label}
          </a>
        );
      }
      if (code) {
        return (
          <code key={match.index} className={codeClass}>
            {code}
          </code>
        );
      }
      return part;
    },
  );
}
