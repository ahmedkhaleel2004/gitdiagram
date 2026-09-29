// One-off: tell IndexNow (Bing, Yandex, Seznam, Naver) about the site's pages,
// taken from the live sitemaps in the order they list them (home, browse and
// videos first, then repos). New diagrams and videos are announced as they are
// made (src/server/visibility/indexnow.ts); this covers everything before.
//
// Run only after the deploy that serves https://gitdiagram.com/<key>.txt:
//
//   bun run indexnow:submit-sitemap                   # the first 10,000
//   bun run indexnow:submit-sitemap --limit 50000
//   bun run indexnow:submit-sitemap --dry-run
//
// INDEXNOW_KEY must match the key the site serves.

const SITE = "https://gitdiagram.com";
const BATCH = 10_000; // IndexNow's limit per request

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitIndex = args.indexOf("--limit");
const limit =
  limitIndex >= 0 ? Number.parseInt(args[limitIndex + 1] ?? "", 10) : 10_000;
if (!Number.isFinite(limit) || limit < 1) throw new Error("Bad --limit.");

const key = process.env.INDEXNOW_KEY?.trim() ?? "";
if (!/^[A-Za-z0-9-]{8,128}$/.test(key))
  throw new Error("Set INDEXNOW_KEY (8-128 letters, digits or dashes).");

const served = await fetch(`${SITE}/${key}.txt`);
if (!served.ok || (await served.text()).trim() !== key) {
  const problem = `${SITE}/${key}.txt does not serve the key yet (${served.status}). Deploy first.`;
  if (!dryRun) throw new Error(problem);
  console.warn(problem);
}

const robots = await (await fetch(`${SITE}/robots.txt`)).text();
const sitemaps = [...robots.matchAll(/^Sitemap:\s*(\S+)/gim)].map(
  (match) => match[1]!,
);
const urls: string[] = [];
for (const sitemap of sitemaps) {
  if (urls.length >= limit) break;
  const xml = await (await fetch(sitemap)).text();
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    urls.push(match[1]!.trim());
    if (urls.length >= limit) break;
  }
}
console.log(
  `${urls.length} URLs from ${sitemaps.length} sitemaps${dryRun ? " (dry run)" : ""}`,
);

for (let start = 0; start < urls.length; start += BATCH) {
  const urlList = urls.slice(start, start + BATCH);
  if (dryRun) {
    console.log(`would submit ${urlList.length}, from ${urlList[0]}`);
    continue;
  }
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(SITE).host,
      key,
      keyLocation: `${SITE}/${key}.txt`,
      urlList,
    }),
  });
  console.log(
    `submitted ${urlList.length}: ${response.status} ${await response.text()}`,
  );
  if (!response.ok) process.exit(1);
}
