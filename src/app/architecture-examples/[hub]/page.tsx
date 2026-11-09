import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HubView } from "~/features/architecture-hubs/hub-view";
import { hubPageMetadata } from "~/features/architecture-hubs/metadata";
import { loadArchitectureHub } from "~/server/storage/architecture-hubs-read";

// An architecture hub's first page (/architecture-examples/python). Standalone:
// reached from the sitemap, /llms.txt, /browse's guides line, the comparison
// pages and the architecture report; nothing in the header, footer, home page
// or repository pages links here.

export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ hub: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await loadArchitectureHub((await params).hub, 1);
  return loaded ? hubPageMetadata(loaded.hub, 1) : {};
}

export default async function HubPageView({ params }: Props) {
  const loaded = await loadArchitectureHub((await params).hub, 1);
  if (!loaded) notFound();
  return <HubView {...loaded} />;
}
