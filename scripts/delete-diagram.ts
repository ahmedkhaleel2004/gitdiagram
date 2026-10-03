/**
 * Deletes a repository's stored public diagram (an owner asked for it):
 * the artifact, its preview sidecar, its failure status and its browse index
 * entry. Dry run unless --apply. Needs the R2 and Upstash settings in the
 * environment; afterwards POST { diagram: { username, repo } } to
 * /api/internal/revalidate with CRON_SECRET to drop the cached pages.
 *
 *   bun scripts/delete-diagram.ts owner/repo [--apply]
 */
import { removeBrowseIndexEntry } from "../src/server/storage/browse-diagrams";
import {
  getPublicLocation,
  getPublicPreviewKey,
} from "../src/server/storage/cache-key";
import { deleteObject, hasObject, listObjects } from "../src/server/storage/r2";
import { upstashCommand } from "../src/server/storage/upstash";

const [target, ...flags] = process.argv.slice(2);
const [username, repo] = (target ?? "").toLowerCase().split("/");
if (!username || !repo) {
  console.error("Usage: bun scripts/delete-diagram.ts owner/repo [--apply]");
  process.exit(1);
}
const apply = flags.includes("--apply");

const location = getPublicLocation(username, repo);
const keys = [location.artifactKey, getPublicPreviewKey(username, repo)];
for (const key of keys) {
  const exists = await hasObject(location.bucket, key);
  console.log(`${exists ? "found  " : "missing"} ${key}`);
  if (exists && apply) {
    await deleteObject(location.bucket, key);
    console.log(`deleted ${key}`);
  }
}

const videoFiles = await listObjects(
  location.bucket,
  `video/v1/${username}/${repo}/`,
);
if (videoFiles.length > 0)
  console.log(
    `${videoFiles.length} video files are stored too; this script leaves them.`,
  );

if (apply) {
  await upstashCommand<number>(["DEL", location.statusKey]);
  const listed = await removeBrowseIndexEntry({ username, repo });
  console.log(listed ? "removed from browse index" : "not in browse index");
} else {
  console.log("Dry run. Pass --apply to delete.");
}
