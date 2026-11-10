# Diagrams on Meta Muse Ember instead of GPT-6 Luna? (2026-11-09)

**Verdict: Ember at low effort is twice as fast, as accurate, and about 25% dearer
per diagram.** Ahmed's call the same day: switch diagrams to it once the US$1,000
of Meta credits from YC Startup School land.

Measured on 2026-11-09, the day Ember was released. Same method and scripts as
`experiments/diagram-haiku` (copied here; only the Ember arms and price added).

## What was run

- The 9 repositories of `expected.json`, 3 diagrams each per setup, 27 per setup.
  GitHub was read once per repository; every setup got the identical system
  prompt, user prompt and output schema (production's single-pass call).
- Setups:
  - `luna`: GPT-6 Luna as production calls it today (effort low, normal lane).
  - `ember-low`, `ember-medium`: Muse Ember through the existing OpenRouter path
    of `src/server/generate/openai.ts` (`meta/muse-ember`), no adapter. Strict
    structured output worked as is.
- Quality: `score.ts` (free) and the blind judge `judge.ts` (GPT-6 Sol) on the
  same 19 runs each for `luna` and `ember-low`: all 3 samples of the 5 original
  repositories plus sample 1 of the 4 added ones. `ember-medium` was not judged.

## Results

|                                              | luna (production)   | ember-low        | ember-medium       |
| -------------------------------------------- | ------------------- | ---------------- | ------------------ |
| Diagrams run / hard failures                 | 27 / 0              | 27 / 0           | 27 / 0             |
| Graph fully valid on first attempt           | 23/27               | 27/27            | 25/27              |
| Needed a second model call to repair         | 2                   | 0                | 2                  |
| Unknown evidence paths                       | 4                   | 0                | 0                  |
| Citations of a file the model was not shown  | 9/502 (1.8%)        | 9/760 (1.2%)     | 5/851 (0.6%)       |
| Nodes / edges per diagram (mean)             | 21.0 / 23.3         | 23.3 / 31.7      | 23.7 / 35.1        |
| Core modules covered (5 original repos)      | 226/270 (84%)       | 239/270 (89%)    | 248/270 (92%)      |
| Arrows the repo's own imports connect        | 371/493 (75%)       | 689/785 (88%)    | 772/864 (89%)      |
| Judge: arrows not backed by code             | 107/489 (21.9%)     | 133/639 (20.8%)  | not judged         |
| Judge: contradicted arrows                   | 24 (4.9%)           | 27 (4.2%)        | not judged         |
| Judge: supported arrows per diagram          | 20.1                | 26.6             | not judged         |
| Time to first explanation text, median (p90) | 3.6 s (5.0)         | 2.8 s (4.3)      | 4.2 s (6.9)        |
| Total time, median (p90, max)                | 11.3 s (14.3, 26.5) | 5.3 s (6.4, 8.6) | 6.8 s (10.5, 14.3) |
| Input / output tokens, median                | 14,335 / 1,697      | 14,357 / 3,440   | 14,357 / 4,474     |
| Cost per diagram, first-time prompt          | $0.0025             | $0.0031          | $0.0038            |

- Judge difference, `ember-low` minus `luna`, bootstrap over runs within each
  repository: -1.1 points, 95% interval -6.5 to +4.5. A tie.
- Per repository the judge goes both ways: Ember better on ProxyAuth, trpc,
  react, django; worse on flask (6 of 26 not backed against 1 of 27) and
  slightly on AgentBridge and httpx.
- Ember draws about a third more arrows. The extra ones are as well supported
  as the rest, but the picture is busier.
- **One stalled call.** The first run of `ember-low` on p-limit sample 3 never
  finished its stream and was stopped after more than 3 minutes (kept in
  `out/stalled-ember-low-p-limit-3`); the rerun took 3.3 s and is the one
  counted. 1 of 82 Ember calls. Production's 18 s restart
  (`ARCHITECTURE_SLOW_RETRY_MS`) would have covered it.
- Token price is the same as Luna's ($0.10 in, $0.50 out per million; cached
  input $0.004). Ember costs more per diagram because it writes about twice as
  many output tokens (about 1,070 of them reasoning at low effort).
- Luna's bill for the 30 days to 2026-11-09 was $86 (OpenAI costs API).

## Not measured

- Meta's own API (this went through OpenRouter). Speed and stalls may differ.
- Calls from Cloudflare Workers, where the model API sees the visitor's
  country. A reply on X in July 2026 said the Meta API was blocked in Europe.
- A prompt tuned for Ember; the prompts are the ones tuned for Luna.

## Spend

$5.31: $0.22 for the 81 diagrams, $5.09 for the judge (38 runs).
