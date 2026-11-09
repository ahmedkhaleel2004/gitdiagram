import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { HubView } from "~/features/architecture-hubs/hub-view";
import { hubPath } from "~/features/architecture-hubs/hubs";
import { hubPageMetadata } from "~/features/architecture-hubs/metadata";
import { loadArchitectureHub } from "~/server/storage/architecture-hubs-read";

// Pages 2 and on of a hub (/architecture-examples/python/2), each its own
// canonical URL. /…/python/1 redirects to the hub itself.

export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ hub: string; page: string }> };

function pageNumber(value: string): number {
  return /^[1-9]\d{0,2}$/.test(value) ? Number(value) : Number.NaN;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hub, page } = await params;
  const number = pageNumber(page);
  if (!(number > 1)) return {};
  const loaded = await loadArchitectureHub(hub, number);
  return loaded ? hubPageMetadata(loaded.hub, number) : {};
}

export default async function HubPageNumberView({ params }: Props) {
  const { hub, page } = await params;
  const number = pageNumber(page);
  if (number === 1) permanentRedirect(hubPath(hub));
  const loaded = await loadArchitectureHub(hub, number);
  if (!loaded) notFound();
  return <HubView {...loaded} />;
}
