import type { Metadata } from "next";
import { getSponsorStats } from "~/server/sponsor-stats";
import { SponsorPageContent } from "./sponsor-page-content";
import { createSponsorContent } from "./sponsor-content";

export const metadata: Metadata = {
  title: "Advertise on GitDiagram",
  description:
    "Advertise your product on GitDiagram’s homepage, repository diagrams, browse catalog, and GitHub README.",
  alternates: { canonical: "/sponsor" },
};

export const revalidate = 300;

export default async function SponsorPage() {
  const stats = await getSponsorStats();
  const content = createSponsorContent(stats);
  return <SponsorPageContent content={content} />;
}
