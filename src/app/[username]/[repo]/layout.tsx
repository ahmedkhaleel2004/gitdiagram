import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  // This workspace supplies both themes; extension SVG mutations break hydration.
  other: { "darkreader-lock": "true" },
};

export default function RepositoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
