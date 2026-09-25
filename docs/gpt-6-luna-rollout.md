# GPT-6 Luna migration — September 22, 2026

GitDiagram's managed default moves from `gpt-5.6-luna` to `gpt-6-luna`. The migration retains structured streaming, deterministic Mermaid compilation, graph validation and repairs, bounded source sampling, uncapped model output, and the single slow-request recovery. User-owned keys keep Standard service, and explicit model/provider overrides remain respected.

## Published pricing

Official sources checked on September 22:

- [GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [Release changelog](https://developers.openai.com/api/docs/changelog)

Prices are USD per million tokens for prompts below 272K input tokens. GitDiagram's input limit was 195K at this migration; on September 25 it was raised to 900K (`MAX_GENERATION_INPUT_TOKENS`, just under the model's 922K input limit), while the prompt itself stays bounded by the tree excerpt and source sampling.

| Token type                  | GPT-5.6 Luna Standard | GPT-6 Luna Standard | Reduction |
| --------------------------- | --------------------: | ------------------: | --------: |
| Uncached input              |                 $0.20 |               $0.10 |       50% |
| Cached input                |                 $0.02 |               $0.01 |       50% |
| Cache writes                |                 $0.25 |              $0.125 |       50% |
| Output, including reasoning |                 $1.20 |               $0.50 |     58.3% |

Both models charge twice these rates for Fast mode. GPT-6 Luna accepts the existing `service_tier: "priority"` request; measured responses returned `fast`. Accounting recognizes either name and uses the tier actually served.

The new model supports the existing Responses API, structured output, streaming, and low verbosity. Its context window is 1.05M tokens with up to 128K output tokens. Published documentation alone does not establish better diagram accuracy or faster end-to-end generation.

## Validation method

Comparisons use the production architecture prompt, compact output schema, streaming adapter, graph validator, compiler, and 18-second recovery. Paired requests run sequentially. The first comparison reuses identical September 18 evidence fixtures for both models; the second uses fresh September 22 ingestion, held constant across models and repetitions. Timings exclude repository ingestion and browser rendering. Completed-response costs use measured usage; cold costs normalize every input token to a cache write for a fair cache-independent comparison. Cancelled requests do not report usage and are excluded from those completed-response costs.

Local raw evidence is retained in the isolated checkout's ignored `tmp/gpt-six-luna` directory. Latency samples are small and cannot establish a general reliability guarantee. Structural/path validation does not prove every inferred dependency is correct.

## Why the old reasoning setting was reconsidered

Eight runs per model on the same four archived evidence fixtures produced a model-plus-validation median of 11.30 seconds for GPT-5.6 Luna and 39.98 seconds for GPT-6 Luna at medium reasoning. Six new-model runs triggered slow recovery, versus none for the old model. Seven of eight new-model graphs passed their first structural validation, versus eight of eight old-model graphs. The rejected graph referenced undeclared external nodes; production's repair stage remains enabled for this case.

The new model's median completed-response cold cost was $0.008668 versus $0.011327, but that excludes unreported cancelled-attempt usage and the rejected graph's repair. Those figures do **not** justify a claim that retaining medium reasoning is faster or necessarily cheaper in total. This led to a separate low-reasoning evaluation on fresh source evidence.

## Selected production configuration

GPT-6 Luna uses low reasoning, low verbosity, and Fast mode for the normal architecture pass. Structural graph repairs retain medium reasoning. Explicit older-model overrides retain their existing reasoning. The prompt, source limits, graph schema, and UI are unchanged.

The final comparison used fresh source evidence from four repositories, twice per model (eight runs per model):

| Measure                             | GPT-5.6 Luna, medium | GPT-6 Luna, low |
| ----------------------------------- | -------------------: | --------------: |
| Median model + validation time      |              15.68 s |          6.97 s |
| Median first text                   |               9.61 s |          2.02 s |
| Median cold completed-response cost |            $0.011843 |       $0.004764 |
| First-pass valid graphs             |                  8/8 |             8/8 |
| Slow recoveries                     |                    3 |               0 |

The selected configuration reduced sample median latency by 55.5% and median cold completed-response cost by 59.8%. The old-model cost excludes three cancelled attempts; including their unreported cost would increase the baseline. These are workload measurements for the chosen configurations, not a same-reasoning-level speed comparison or a universal quality claim.

| Repository                  | Old times        | New times       | New cold completed-response costs | New node counts |
| --------------------------- | ---------------- | --------------- | --------------------------------- | --------------- |
| ahmedkhaleel2004/gitdiagram | 14.86 s, 30.69 s | 16.25 s, 8.82 s | $0.004943, $0.004937              | 25, 24          |
| excalidraw/excalidraw       | 15.2 s, 12.58 s  | 6.95 s, 6.99 s  | $0.006125, $0.006239              | 23, 21          |
| fastapi/fastapi             | 16.15 s, 28.29 s | 6.56 s, 7.59 s  | $0.004545, $0.004590              | 20, 20          |
| lukeed/clsx                 | 24.84 s, 6.22 s  | 4.19 s, 2.48 s  | $0.001281, $0.001202              | 7, 5            |

Manual review confirmed GitDiagram's compilation node links to `src/server/generate/graph.ts`, FastAPI retains routing/dependency/OpenAPI stages, Excalidraw retains collaboration, storage, sharing and text-to-diagram branches, and clsx distinguishes its full and lite runtime paths. One low-effort clsx sample included unnecessary type-contract nodes; graph validity is not a guarantee of ideal component selection. This is a bounded architecture overview, not a verified whole-repository call graph.

## Local verification

652 tests across 86 files passed, along with lint, TypeScript, formatting, Knip, dependency audit, production build, and performance budgets. Tests cover the new default and optional quota family, single-pass eligibility, user-key Standard billing, snapshot identifiers, reasoning selection, Fast service requests, returned-tier accounting, cache reads/writes, and estimates.

The existing production graph-repair function also corrected the rejected medium-effort graph in one additional request (18.93 seconds; $0.004744 measured cost), confirming the new model supports the repair contract.
