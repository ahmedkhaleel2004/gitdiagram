import { SITE_URL } from "~/lib/site";
import { getSitemapUrls } from "~/lib/sitemaps";
import { generateSitemaps } from "../sitemap";

// One address for every sitemap shard, to submit in Search Console and
// Bing Webmaster Tools. Crawlers also guess this path on their own. Like
// robots.txt it only counts the shards, so it never loads the whole index.
export const revalidate = 3600;

export async function GET() {
  const shards = getSitemapUrls(SITE_URL, (await generateSitemaps()).length);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...shards.map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
