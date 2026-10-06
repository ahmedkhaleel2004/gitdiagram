# History

Dated background that used to sit in `CLAUDE.md`. Nothing here is a rule or a statement about the present: `CLAUDE.md` is. Newest first.

The longer `CLAUDE.md` from before the cleanup of 2026-10-06, with more detail per feature (model choices, limits and their defaults, render timings, cache internals), is in git: `git show 3bb4210:CLAUDE.md`. Its statements about hosting ("Vercel serves gitdiagram.com until the DNS cutover") were already out of date when it was replaced.

## 2026-10-06: CLAUDE.md cleaned up

Checked that day: gitdiagram.com answered `server: cloudflare` with OpenNext headers; nameservers were Cloudflare's; the four Workers were deployed at commit `3bb4210`; Vercel was still building every push to `main` (last production build about 10 hours earlier). Corrected in the rewrite:

- Hosting: Cloudflare is production, Vercel the rollback (the file said the reverse in five places).
- Renders run on the pool instance the film hashes to (`renderInstance`); one paragraph still said always `render-0`.
- Explainer videos were described as feature-flagged; they are on in production.
- The geolocation headers the audience rules read are written by the Worker, not by Vercel.

## 2026-10-02: moved from Vercel to Cloudflare

- Nameservers moved from Vercel to Cloudflare at about 05:00; apex and `www` were switched to proxied at 10:13 UTC, which made the Worker production. Rollback at the time: set both records back to DNS-only.
- The full log of the move (decisions, measurements, cost tables, the DNS record ids, the Vercel wind-down steps nobody had run yet) is on `ahmed-vps` at `~/repos/general/gitdiagram-cloudflare/STATUS.md`. It is long and written as it happened, so older paragraphs in it are superseded by later ones.
- The site started as one Worker and was split the same day into four (edge, site, placed server, local server). Reason: with every request sharing a few isolates that also held the whole browse index, the index cron, a sitemap render or a few diagram runs at once pushed an isolate past 128 MB and cut off the streams beside it.
- Faults found on the first day live, each now a rule in `CLAUDE.md` under "Workers are not Node": `redirect: "error"` throwing (170 diagrams stored between 10:13 and 11:25 UTC were drawn from the README alone; the affected ones were regenerated), shared promises hanging an isolate, OpenAI refusing calls by the visitor's country, the AWS SDK's socket handler dropping R2 calls, an uncached fetch failing cached pages, IndexNow refusing Workers' addresses.
- Measured on staging that day: a render instance peaks at 1.8 GiB with both Chromiums busy and is processor-bound; ten generations at once need about 0.45 GiB. Eight renders at once took about 85 s each with the overflow instances, 175 s without.
- Cost at the time: Vercel about US$100 a month; Cloudflare estimated at $55 to $75 for the same traffic. `bun run cf:usage --site` gives today's figure.
- The `Cost watch` window was widened from three hours to six after staging load tests tripped it twice.

## Before 2026-10-02

- Production was Vercel. `Dockerfile` and `railway.json` were kept as an offline Railway recovery recipe (`docs/deployment-failover.md`); no Railway service was running.
- Model and voice choices for videos came from blind comparisons kept in `experiments/video-models/`, `experiments/video-bespoke/`, `experiments/video-practical/` and `experiments/voices/`.
