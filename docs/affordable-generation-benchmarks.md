# Affordable generation benchmark — September 18, 2026

The managed generation path uses GPT-5.6 Luna, medium reasoning, Fast service tier, one streamed structured response, and the existing deterministic colored Mermaid compiler. Explicit model and user-key choices remain respected. Provider requests have no output-token caps.

## Final repeated sample

The final source-selection and import-provenance configuration was tested 27 times across eight repositories. All 27 graphs validated on the first attempt, with no stripped source links or repair calls. Model-plus-validation timings exclude ingestion and browser rendering; live click-to-render results are recorded separately below. Fixtures retain the measured initial ingestion time, rather than pretending ingestion was repeated on every cached-fixture run.

Cold costs below charge every input token at the cache-write rate ($0.50/M in Fast mode) and all output/reasoning tokens at $2.40/M. They do not rely on cache hits. Actual usage-derived costs can be lower. These are API list-price calculations, not invoice reconciliation.

| Repository | Runs | Model + validation | Nodes | Edges | Cold cost/run (USD) |
|---|---:|---:|---:|---:|---:|
| BurntSushi/ripgrep | 3 | 7.7–13.7 s | 16–20 | 15–23 | $0.0111–0.0137 |
| ahmedkhaleel2004/gitdiagram | 4 | 9.5–17.5 s | 22–27 | 23–33 | $0.0117–0.0139 |
| caddyserver/caddy | 3 | 14.1–15.4 s | 18–21 | 17–19 | $0.0144–0.0149 |
| excalidraw/excalidraw | 4 | 9.1–16.1 s | 19–22 | 16–21 | $0.0140–0.0161 |
| expressjs/express | 3 | 12.8–14.2 s | 16–17 | 21–26 | $0.0131–0.0137 |
| fastapi/fastapi | 4 | 11.7–14.8 s | 16–20 | 20–24 | $0.0122–0.0128 |
| lukeed/clsx | 3 | 4.8–7.9 s | 4–5 | 6–6 | $0.0035–0.0037 |
| pallets/flask | 3 | 10.7–15.4 s | 19–20 | 21–23 | $0.0116–0.0130 |

## Experiments and decisions

More than 100 measured generation experiments covered low/medium/high/no reasoning, standard/Fast tiers, full/compact/positional schemas, explicit per-edge evidence, README-only input, filtered trees, different source excerpts, an ownership example, and draft-plus-review. Raw local fixtures and per-run usage records are in the ignored `tmp/generation-speed` directory. Four initial exploratory schema runs failed because the experimental schema omitted identifier constraints; the final schema inherits the production constraints.

- High reasoning on standard service took 61–100 seconds on larger examples. Medium reasoning gave a much better latency/quality balance.
- Standard service was cheaper but produced a 59-second medium-reasoning evidence run. Fast Luna keeps substantial room for ingestion, rendering, and occasional structural repair.
- A second review pass corrected some ownership mistakes but repeated source input and increased cost to roughly 1.3–1.5 cents even on standard service. The final path reserves retries for validation failures.
- Per-edge quotes increased output and sometimes reduced useful coverage while still allowing unsupported interpretations of evidence.
- README-only input lost internal grounding; one Excalidraw result also had an invalid source path.
- Positional rows saved some tokens, but named fields were clearer to validate and maintain. Removing unused description/type fields captured most of the useful reduction.
- Source selection previously favored empty package barrels and maintenance scripts over substantive runtime helpers. Revised scoring retained FastAPI dependency resolution and OpenAPI implementation files.
- Earlier excerpts stopped before the important calls in long handlers. Distributed windows, useful imported calls, and explicit import bindings now expose the actual model, graph-planning, and compilation boundaries. In the GitDiagram sample, this corrected the compiler link from a similarly named legacy helper to `src/server/generate/graph.ts`.

## Quality review

Reviewed component responsibilities, main workflow, source paths, edge direction/ownership, maintenance clutter, external actors, and diagram grouping. The final samples kept substantial applications in roughly 14–28 components and tiny clsx in 4–5, rather than padding every repository to a quota. Rendered maps retain subsystem colors and GitHub links through the existing compiler. Source sampling remains bounded, and generated prose states coverage limits; this is an architectural overview, not a complete verified call graph.

## Functional validation

- 539 tests passed across 79 files; lint, TypeScript, formatting, Knip, dependency audit, production build, and performance budgets passed.
- Approved UI and homepage files were unchanged.
- Final local regeneration after cancellation: 12.795 seconds from click to rendered graph; 25 components and 28 relationships. The stored actual cost displayed in Activity was $0.0059 with caching.
- Initial spend-containment release restored Luna before experimentation finished. A live regeneration on that release took 11.890 seconds and cost $0.01278776.

## Final production verification

Pending release verification; exact deployment, live timings and persistence checks are recorded after deployment.
