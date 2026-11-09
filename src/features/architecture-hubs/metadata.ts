import type { Metadata } from "next";
import { articleMetadata } from "~/features/guide/article-metadata";
import { hubDescription, hubTitle } from "./content";
import { hubHeading, hubPath, type HubSummary } from "./hubs";

export function hubPageMetadata(hub: HubSummary, page: number): Metadata {
  const path = hubPath(hub.slug, page);
  const metadata = articleMetadata({
    path,
    title: hubTitle(hub, page),
    headline: hubHeading(hub),
    description: hubDescription(hub, page),
  });
  return {
    ...metadata,
    alternates: {
      canonical: path,
      ...(page === 1 ? { types: { "text/markdown": `${path}.md` } } : {}),
    },
  };
}
