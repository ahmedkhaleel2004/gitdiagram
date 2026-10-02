import "server-only";

import { EDGE_ANSWERS_CACHE, edgeAnswerKey } from "~/lib/cloudflare-edge";
import { cloudflareContext } from "~/server/cloudflare-context";

interface AnswerCache {
  delete(key: string): Promise<boolean>;
}

/**
 * Drops this Cloudflare location's kept answers for the given addresses (the
 * shared cache in front of API routes, cloudflare/edge-answers.ts). Other
 * locations keep theirs until they expire. A no-op off Cloudflare, where the
 * CDN's copies are purged by tag instead; never throws.
 */
export async function dropEdgeAnswers(urls: URL[]): Promise<void> {
  if (!cloudflareContext()) return;
  try {
    const storage = (
      globalThis as unknown as {
        caches: { open(name: string): Promise<AnswerCache> };
      }
    ).caches;
    const cache = await storage.open(EDGE_ANSWERS_CACHE);
    await Promise.all(urls.map((url) => cache.delete(edgeAnswerKey(url))));
  } catch {
    // The copies expire by themselves.
  }
}
