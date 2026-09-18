import type { Metadata } from "next";
import { getSponsorStats } from "~/server/sponsor-stats";
import { SponsorPageContent } from "./sponsor-page-content";
import { createSponsorContent } from "./sponsor-content";

export const metadata: Metadata = {
  title: "Sponsor GitDiagram",
  description:
    "Reach developers while they are actively inspecting GitHub repositories with GitDiagram.",
  alternates: { canonical: "/sponsor" },
};

export const revalidate = 300;

export default async function SponsorPage() {
  const stats = await getSponsorStats();
  const content = createSponsorContent(stats);
  return <SponsorPageContent content={content} />;
}
