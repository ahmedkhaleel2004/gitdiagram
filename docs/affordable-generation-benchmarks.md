# Affordable generation benchmark — September 18, 2026

The managed generation path uses GPT-5.6 Luna, medium reasoning, Fast service tier, one streamed structured response, and the existing deterministic colored Mermaid compiler. Explicit model and user-key choices remain respected. Provider requests have no output-token caps.

## Repeated latency and cost sample

The final recovery configuration was tested 24 times across eight repositories. All 24 graphs validated on the first graph attempt. The median model-plus-validation time was 13.3 seconds; the slowest was 33.2 seconds (34.2 including the fixture's measured ingestion). Two requests triggered the one allowed slow-request retry. Another test injected an 18-second stall before a real Excalidraw request and completed in 32.9 seconds, or 34.2 including fixture ingestion.

These timings exclude browser rendering. Fixtures retain their original measured ingestion time; ingestion was not repeated on every fixture-based run. Fresh ingestion of GitDiagram with immutable-blob recovery yielded 12 source files, 26 components, and 30 relationships in 14.4 seconds including ingestion, at $0.01184 measured cost without input-cache hits.

For requests without recovery, cold cost charges every input token at the cache-write rate ($0.50/M in Fast mode) and output/reasoning at $2.40/M. The two recovered rows show only the completed response's cold cost: **the cancelled attempt has additional unmeasured cost**. Production includes a conservative estimate for that cancelled attempt and labels the total approximate. The 2-cent target is therefore a normal-generation target, not a hard per-request spending cap. No output-token caps were introduced.

| Repository | Runs | Model + validation | Nodes | Completed response cold cost | Slow recoveries |
|---|---:|---:|---:|---:|---:|
| BurntSushi/ripgrep | 3 | 11.1–16.8 s | 16–21 | $0.0124–0.0148 | 0 |
| ahmedkhaleel2004/gitdiagram | 3 | 9.0–17.8 s | 24–27 | $0.0112–0.0144 | 0 |
| caddyserver/caddy | 3 | 10.8–16.4 s | 20–27 | $0.0137–0.0146 | 0 |
| excalidraw/excalidraw | 3 | 12.0–14.8 s | 23 | $0.0147–0.0149 | 0 |
| expressjs/express | 3 | 10.6–33.2 s | 16–18 | $0.0128–0.0144 + interrupted estimate when retried | 1 |
| fastapi/fastapi | 3 | 13.7–15.1 s | 19–24 | $0.0128–0.0133 | 0 |
| lukeed/clsx | 3 | 5.6–6.4 s | 5 | $0.0038–0.0039 | 0 |
| pallets/flask | 3 | 7.1–31.6 s | 18–22 | $0.0103–0.0146 + interrupted estimate when retried | 1 |

An earlier 27-run sample finished in 5.7–18.3 seconds including fixture ingestion. Extending testing exposed **81-second Excalidraw and 68-second FastAPI outliers**, despite Fast service. That evidence led to the recovery mechanism; it would be misleading to omit those runs and claim a universal sub-50-second guarantee. Provider-wide or network failures can still exceed the target because the replacement can also stall.

## Experiments and decisions

160 recorded generation experiments in this goal (plus earlier baselines) covered low/medium/high/no reasoning, standard/Fast tiers, full/compact/positional schemas, explicit per-edge evidence, README-only input, filtered trees, different source excerpts, an ownership example, and draft-plus-review. Raw local fixtures and per-run usage records are in the ignored `tmp/generation-speed` directory. Four initial exploratory schema runs failed because the experimental schema omitted identifier constraints; the final schema inherits the production constraints.

- High reasoning on standard service took 61–100 seconds on larger examples. Medium reasoning gave a much better latency/quality balance.
- Standard service was cheaper but produced a 59-second medium-reasoning evidence run. Fast Luna keeps substantial room for ingestion, rendering, and occasional structural repair.
- A second review pass corrected some ownership mistakes but repeated source input and increased cost to roughly 1.3–1.5 cents even on standard service. The final path reserves additional requests for structural validation failures or one slow-request recovery.
- Per-edge quotes increased output and sometimes reduced useful coverage while still allowing unsupported interpretations of evidence.
- README-only input lost internal grounding; one Excalidraw result also had an invalid source path.
- Positional rows saved some tokens, but named fields were clearer to validate and maintain. Removing unused description/type fields captured most of the useful reduction.
- Source selection previously favored empty package barrels and maintenance scripts over substantive runtime helpers. Revised scoring retained FastAPI dependency resolution and OpenAPI implementation files.
- Earlier excerpts stopped before the important calls in long handlers. Distributed windows, useful imported calls, and explicit import bindings now expose the actual model, graph-planning, and compilation boundaries. In the GitDiagram sample, this corrected the compiler link from a similarly named legacy helper to `src/server/generate/graph.ts`.

## Quality review

Reviewed component responsibilities, main workflow, source paths, edge direction/ownership, maintenance clutter, external actors, and diagram grouping. The final samples kept substantial applications in roughly 14–28 components and tiny clsx in 4–5, rather than padding every repository to a quota. Rendered maps retain subsystem colors and GitHub links through the existing compiler. Source sampling remains bounded, and generated prose states coverage limits; this is an architectural overview, not a complete verified call graph.

## Slow-request recovery and coverage

A managed Luna request still running after 18 seconds has its connection cancelled, then receives exactly one new attempt with the same source evidence, prompt, model, and medium reasoning. Normal requests incur no duplicate call. User cancellation, API errors, and user-owned model/key requests do not trigger this timer. Partial overview text resets before replacement streaming so two responses cannot merge. Cancellation estimates are included in cost summaries and quota settlement; normal completed requests use actual provider usage.

A live Excalidraw review revealed missing collaboration despite fast generation. The prompt now explicitly preserves major README capabilities even when their internals were not sampled; uncertain wiring can be omitted without removing the subsystem. Default-import and JSX evidence improve React integration coverage. When raw public source no longer matches the tree's blob hash, at most two immutable REST blob reads recover the matching version within the existing ingestion deadline. Both paths verify content hashes and preserve credential boundaries.

## Functional validation

- 550 tests passed across 80 files; lint, TypeScript, formatting, Knip, dependency audit, production build, and performance budgets passed. React Doctor reported one bounded-worker loop warning; the three concurrent workers intentionally await each file to limit GitHub load.
- Approved UI and homepage files were unchanged.
- Final local regeneration after cancellation: 12.795 seconds from click to rendered graph; 25 components and 28 relationships. The stored actual cost displayed in Activity was $0.0059 with caching.
- Initial spend-containment release restored Luna before experimentation finished. A live regeneration on that release took 11.890 seconds and cost $0.01278776.

- Final local click-to-render check with recovery and immutable-source fetching: 18.825 seconds. The diagram retained the correct graph compiler source link.

## Live verification before the recovery release

The Luna compact-schema release `75e5448` rendered GitDiagram in 14.0 seconds and Excalidraw in 18.4 seconds. Both production aliases pointed to the verified full commit, and CI passed. The Excalidraw coverage finding above was identified in that live check. The recovery and coverage release was then verified separately below.

## Recovery release: verified in production

Commit `d439b6484a602437b6160867f35143988ffd322a` deployed as `dpl_BsgGqMvFU2mrFsCHXonPf2WCf7GV`. Vercel confirmed `READY` and both `gitdiagram.com` and `www.gitdiagram.com` aliases. [CI run 35338133629](https://github.com/ahmedkhaleel2004/gitdiagram/actions/runs/35338133629) passed, including the standalone Docker build. `/api/healthz` returned all five checks healthy.

Real browser clicks were timed until the client announced **Diagram ready**, which is gated by successful SVG rendering. The stored session audits confirmed Luna and the following results:

| Live repository | Click to rendered diagram | Components / relationships | Actual API cost (USD) |
|---|---:|---:|---:|
| ahmedkhaleel2004/gitdiagram | 15.973 s | 28 / 30 | $0.0134436 |
| excalidraw/excalidraw | 15.160 s | 23 / 23 | $0.00709636 |
| caddyserver/caddy | 10.657 s | 24 / 28 | $0.0056756 |
| lukeed/clsx | 5.969 s | 5 / 6 | $0.00181636 |

The three larger live repositories read all 12 selected files, without unavailable excerpts. clsx read all six selected files. Each needed one model request and no repair or slow recovery. Excalidraw's live graph included collaboration, encryption, local persistence, export, libraries, and text-to-diagram integration. GitDiagram linked its graph compiler to the correct implementation.

PNG export produced a visually inspected 4916 × 6508 image with the site's lavender background, subsystem colors, and complete diagram. The copy control passed 7,412 characters of Mermaid to the browser clipboard API, which resolved successfully. The in-app browser's separate clipboard reader returned empty, so native clipboard round-trip was not independently confirmed. Zoom entered and exited correctly. Stored state retained successful audits, timestamps, graphs, costs, and explanations.

The 160 completed benchmark artifacts recorded $1.2543 in API usage-derived costs during this goal. This excludes cancelled probes/attempts without reported usage, initial failed experiments without a completed artifact, live checks, and public traffic; it is not an invoice total.
