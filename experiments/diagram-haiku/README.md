# Diagrams on Claude Haiku 5.5 instead of GPT-6 Luna? (2026-10-07)

**Verdict: don't swap.** In the only Haiku setup fast enough to ship (thinking
off), a blind judge found 29.4% of its arrows not backed by the code against
19.5% for GPT-6 Luna (+9.9 points, 95% interval +6.7 to +13.0), it failed 1 of 27
diagrams outright where Luna failed none, and it saves about 20% per diagram, not
50%. Haiku only matches Luna's quality when it is allowed to think, and then the
first text arrives after 9 to 26 seconds instead of 2.4.

The 100,000-token price step does not apply to diagrams: the largest prompt
measured was 34,293 Haiku tokens, because the pipeline caps the prompt by
characters. 0 of 135 Haiku calls crossed it.

Everything below was measured on 2026-10-07, the day Haiku 5.5 was released,
unless a line says otherwise.

## What was run

- 9 public repositories: the 5 of `experiments/diagram-evidence/expected.json`
  plus `sindresorhus/p-limit` (tiny), `pallets/flask` (mid), `django/django` and
  `facebook/react` (large; both fill the prompt's character caps).
- 3 diagrams per repository per setup, 27 per setup, 162 in all. For each
  repository GitHub was read once and every setup got the identical system
  prompt, user prompt and output schema (production's single-pass
  `SYSTEM_ARCHITECTURE_PROMPT` and `architectureOutputSchema`).
- Setups:

  | Name            | What it is                                                                                                                                |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | `luna`          | GPT-6 Luna exactly as production calls it: `streamCompletion`, effort low, OpenAI's priority lane (2x price: $0.20 in / $1.00 out).       |
  | `luna-std`      | The same call in OpenAI's normal lane ($0.10 / $0.50).                                                                                    |
  | `haiku-nothink` | Haiku 5.5 on Anthropic's API, effort low, thinking switched off.                                                                          |
  | `haiku-low`     | Haiku 5.5 on Anthropic's API, effort low, thinking left to the model (it thinks on some requests and not on others).                      |
  | `haiku-medium`  | The same at effort medium.                                                                                                                |
  | `haiku-or-low`  | Haiku 5.5 through the existing OpenRouter path of `src/server/generate/openai.ts`, effort low, no adapter (`anthropic/claude-haiku-5.5`). |

- Quality: `score.ts` (core modules covered, arrows the whole repository's
  imports connect) and `judge.ts` (GPT-6 Sol reads the code around each arrow
  and says supported, unsupported or contradicted). Both are copies of the
  `diagram-evidence` scripts with only the folder changed. The judge never sees
  which model drew the diagram.
- Validation: the same helpers `generateValidatedGraph` uses, in the same
  order, recorded per attempt.
- Speed on one recorded production request (`bench.ts`,
  `~/reference/aws/bench/cap/req-0.json`, honojs/hono), 5 requests per setup,
  one at a time.

## Results, all 9 repositories

|                                                          | luna (production)  | luna-std            | haiku-nothink       | haiku-low           | haiku-medium        | haiku-or-low       |
| -------------------------------------------------------- | ------------------ | ------------------- | ------------------- | ------------------- | ------------------- | ------------------ |
| Diagrams run                                             | 27                 | 27                  | 27                  | 27                  | 27                  | 27                 |
| Hard failures (no diagram)                               | 0                  | 0                   | **1 (4%)**          | 0                   | 0                   | 0                  |
| Graph fully valid on first attempt                       | 24/27 (89%)        | 26/27 (96%)         | 24/26 (92%)         | 27/27 (100%)        | 26/27 (96%)         | 26/27 (96%)        |
| Accepted on first attempt (valid, or bad paths stripped) | 27/27              | 27/27               | 25/26               | 27/27               | 27/27               | 26/27              |
| Needed a second model call to repair                     | 0                  | 0                   | 1                   | 0                   | 0                   | 1                  |
| Unknown node paths                                       | 0/482              | 1/486 (0.2%)        | 1/453 (0.2%)        | 0/443               | 0/502               | 0/465              |
| Unknown evidence paths                                   | 7/489 (1.4%)       | 4/484 (0.8%)        | 0/459               | 0/412               | 2/577 (0.3%)        | 0/466              |
| Citations of a file the model was never shown            | 10/489 (2.0%)      | 4/484 (0.8%)        | **34/459 (7.4%)**   | 8/412 (1.9%)        | 0/577               | 7/466 (1.5%)       |
| Nodes / edges per diagram                                | 20.4 / 23.1        | 20.3 / 22.0         | 20.0 / 22.0         | 18.7 / 19.7         | 21.4 / 25.6         | 19.7 / 21.3        |
| Core modules covered (5 original repos)                  | 231/270 (86%)      | 230/270 (85%)       | 228/270 (84%)       | 228/270 (84%)       | 238/270 (88%)       | 227/270 (84%)      |
| Arrows the repo's own imports connect                    | 371/502 (74%)      | 378/494 (77%)       | 336/483 (70%)       | 351/459 (76%)       | 465/584 (80%)       | 373/493 (76%)      |
| Runs judged                                              | 19                 | not judged          | 19                  | 19                  | 9                   | not judged         |
| Judge: arrows not backed by code                         | **94/483 (19.5%)** | not judged          | **133/453 (29.4%)** | 98/426 (23.0%)      | 46/225 (20.4%)      | not judged         |
| Judge: solid arrows not backed                           | 63/381 (16.5%)     | not judged          | 104/404 (25.7%)     | 66/353 (18.7%)      | 31/189 (16.4%)      | not judged         |
| Judge: contradicted arrows                               | 35                 | not judged          | 65                  | 48                  | 9 (in 9 runs)       | not judged         |
| Time to first explanation text, median (p90)             | 2.4 s (4.1 s)      | 3.5 s (4.9 s)       | **1.2 s (3.3 s)**   | 8.6 s (19.7 s)      | 25.8 s (39.0 s)     | 1.4 s (21.7 s)     |
| Total model time, median (p90, max)                      | 8.3 s (10.2, 12.7) | 11.5 s (13.3, 15.9) | 9.5 s (12.8, 23.0)  | 14.8 s (25.2, 30.8) | 33.4 s (48.2, 65.6) | 9.6 s (25.9, 39.0) |
| Calls over 18 s (production cancels and restarts these)  | 0/27               | 0/27                | 0/27                | **11/27 (41%)**     | **24/27 (89%)**     | 8/27 (30%)         |
| Input tokens, median (max)                               | 14,309 (17,938)    | 14,309 (17,938)     | 24,683 (34,292)     | 24,684 (34,293)     | 24,684 (34,293)     | 24,385 (33,994)    |
| Output tokens, median (of which thinking)                | 1,649 (222)        | 1,694 (268)         | 2,584 (0)           | 3,361 (887)         | 9,042 (6,338)       | 2,810 (0)          |
| Prompts over 100,000 tokens                              | 0/27               | 0/27                | 0/27                | 0/27                | 0/27                | 0/27               |
| Cost per diagram, first-time prompt as production pays   | **$0.0049**        | $0.0025             | **$0.0040**         | $0.0045             | $0.0069             | $0.0045            |
| Cost per diagram with no cache writes or reads           | $0.0045            | $0.0023             | $0.0040             | $0.0045             | $0.0069             | $0.0045            |
| Cost per diagram as billed in this eval                  | $0.0023            | $0.0014             | $0.0040             | $0.0045             | $0.0069             | $0.0045            |

Per-repository rows and the prompt size of every repository on both
tokenizers are in `out/summary.md`.

### Quality

- The judged set is the same 19 runs for `luna`, `haiku-nothink` and
  `haiku-low`: all 3 samples of the 5 original repositories plus sample 1 of the
  4 added ones (one `haiku-nothink` p-limit sample has no diagram, so its sample
  1 was judged like the others). `haiku-medium` had only sample 1 of each
  repository judged (9 runs), to stay inside the budget.
- Arrows not backed by code, bootstrap over runs within each repository
  (`out/stats.txt`):
  - `haiku-nothink` 29.4% against `luna` 19.5%: +9.9 points, 95% interval +6.7
    to +13.0. Worse, and not by chance. Contradicted arrows nearly double (65
    against 35).
  - `haiku-low` 23.0% against 19.5%: +3.5 points, interval -0.0 to +7.2. Not
    distinguishable from Luna with this many runs; if anything slightly worse.
  - On the 9 sample-1 runs every setup was judged on: `luna` 19.7%,
    `haiku-nothink` 30.9%, `haiku-low` 21.7%, `haiku-medium` 20.4%. Too few runs
    for an interval. `haiku-medium` is level with Luna, not ahead.
- Where thinking-off Haiku loses: ProxyAuth (49% not backed against 26%),
  AgentBridge (19% against 10%), httpx (22% against 10%) and the one judged
  django run (12 of 16 against 5 of 16). It also cites files it was never shown
  3.7 times as often (7.4% against 2.0% of citations; the pipeline strips them).
- Coverage of core modules is the same for every setup (84 to 88%).
- Nothing here shows Haiku 5.5 "well ahead" of GPT-6 Luna on this task. The
  prompts are the ones tuned for Luna; a prompt tuned for Haiku was not tried.

### Failures and validity

- `haiku-nothink`, p-limit sample 2: the answer broke the schema (node ids not
  matching `^[a-z][a-z0-9_]*$`). Anthropic's structured outputs do not enforce
  that pattern; OpenAI's strict mode does. In production that is a failed
  generation. 1 of 27 is a small sample; the true rate could be anywhere from
  under 1% to about 18%.
- Haiku drew an arrow to a node that does not exist twice in 54 thinking-off
  runs (`haiku-nothink` trpc 1, `haiku-or-low` AgentBridge 1). Both were fixed by
  one repair call, which adds about 10 s and about $0.003. Luna never did in 54
  runs.
- Luna's only invalid first attempts were unknown file paths on facebook/react
  (4 of 6 runs), which the pipeline strips without another call.
- No rate-limit or provider errors on either side.

### Speed

- Thinking decides everything for Haiku. With thinking off it shows the first
  text in 1.2 s (Luna priority 2.4 s, Luna normal 3.5 s) and writes about 340
  answer tokens a second against Luna's 217 (priority) and 180 (normal). But it
  needs about 1.6 times as many tokens for the same JSON, so the whole call
  takes 9.5 s against Luna priority's 8.3 s and Luna normal's 11.5 s.
- With thinking left on, no text streams until it has finished thinking:
  median 8.6 s at low effort and 25.8 s at medium. 41% of low-effort calls and
  89% of medium-effort calls ran past the 18 s at which production cancels the
  request and starts it again (`ARCHITECTURE_SLOW_RETRY_MS`).
- The OpenRouter path at effort low behaves like `haiku-low`, not like
  `haiku-nothink`: it thought on the three largest repositories (first text
  after 17 to 31 s). The current request shape has no way to switch thinking
  off there.
- One recorded production request (hono), 5 requests each, median [min to max]:

  | Setup           | First text            | Total                 | Answer tokens/s | Input tokens | Output tokens |
  | --------------- | --------------------- | --------------------- | --------------- | ------------ | ------------- |
  | `luna-priority` | 3.6 s [2.6 to 4.7]    | 9.7 s [8.2 to 11.2]   | 217             | 14,841       | 1,737         |
  | `luna-default`  | 3.6 s [3.0 to 5.5]    | 10.8 s [9.1 to 15.2]  | 180             | 14,841       | 1,548         |
  | `haiku-nothink` | 1.5 s [1.4 to 5.0]    | 10.6 s [9.8 to 12.6]  | 344             | 26,304       | 2,821         |
  | `haiku-low`     | 1.5 s [1.1 to 13.3]   | 10.9 s [8.4 to 21.6]  | 341             | 26,305       | 2,774         |
  | `haiku-medium`  | 24.6 s [21.4 to 30.4] | 32.4 s [28.0 to 39.0] | 365             | 26,305       | 8,885         |

  Luna's two lanes were closer here than in the earlier
  `~/reference/aws/bench/results.jsonl` runs (7.2 to 8.5 s priority, 11 to
  12.6 s normal); across the 27 eval diagrams the gap was 8.3 s against 11.5 s.

### Cost

- **Haiku is about 20% cheaper than what production pays today, not 50%.** The
  list price is half of Luna's priority price, but Haiku's tokenizer counts 1.76
  times as many input tokens for the same prompt (median; 1.71 to 1.94 across
  the 9 repositories) and it writes about 1.6 times as many output tokens for the same
  diagram.
- Against Luna in the normal lane, Haiku is about 60% **more** expensive
  ($0.0040 against $0.0025).
- Small against large, first-time prompt:

  | Repository                      | luna (priority) | luna-std | haiku-nothink |
  | ------------------------------- | --------------- | -------- | ------------- |
  | p-limit (tiny, 21k characters)  | $0.0018         | $0.0009  | $0.0014       |
  | httpx (mid, 56k characters)     | $0.0049         | $0.0025  | $0.0036       |
  | react (largest, 75k characters) | $0.0058         | $0.0029  | $0.0047       |

- **Over 100,000 tokens: not measurable, because it does not happen.** See the
  next section. Calculated only: a 117,000-token prompt with 3,000 output tokens
  would cost about $0.066 on Haiku.
- **Cache writes.** OpenAI bills a first-time Luna prompt as a cache write at
  1.25 times the input price (seen on the first sample of each repository: 1,280
  shared tokens read from cache, the rest written). That is why cache writes are
  a large line on the OpenAI bill: nearly all diagram input is billed on that
  line. The avoidable part is the extra quarter: $0.0049 with it, $0.0045
  without, about 9% of a diagram. Haiku caches only when the request asks for it
  (`cache_control`); these requests did not, so Haiku paid no cache writes and
  no cache reads, and its figure is the same with and without caching. Caching
  would not help either model: each repository's prompt is different, and the
  shared part (the system prompt and schema, about 1,300 Luna tokens) is small.
- In this eval Luna's samples 2 and 3 of each repository were billed as cache
  reads (the same prompt again), so the eval's own Luna bill ($0.0023) is lower
  than production's. The "first-time prompt" row reprices every sample the way
  the first one was billed.
- Estimate, not measured: at about $548 a month of diagram spend, thinking-off
  Haiku would be about $445, Luna in the normal lane about $280.

## The 100,000-token price step

- `repository-context.ts` caps the user prompt by characters: file tree 24,000,
  README 8,500, sources 48,000. With the 5,337-character system prompt, the
  largest prompts measured were 75,508 characters.
- Measured Haiku input tokens: 9,325 (p-limit) to 34,293 (react). Luna: 5,079 to
  17,938. Share over 100,000: **0 of 135 Haiku calls, 0 of 54 Luna calls.** The
  one repair call that ran also stayed under.
- Worst case by token count only (`worst-case.ts`, no generation, free): filling
  every cap with one kind of text gives 35,437 tokens for English prose, 71,961
  for minified code, 75,690 for hex strings, 86,255 for Chinese, and 117,281 for
  emoji only. So only a repository whose tree, README and sources are almost all
  emoji could cross 100,000.
- Production data was not pulled for this. The character caps are a hard bound,
  which is stronger than a sample: the share of real diagrams that would pay the
  5x price is 0%, barring the emoji case. That holds only while the caps stay
  where they are; doubling `MAX_SOURCE_CHARACTERS` would put Chinese-language
  repositories over.

## What would have to change to ship it

Not recommended, but for the record. Nothing under `src/` was changed here.

1. **A call path.** Two options:
   - Anthropic's API directly (what `haiku-nothink` used): a new adapter beside
     `src/server/generate/openai.ts` with the three functions the route uses
     (`streamCompletion`, `generateStructuredOutput`, `countInputTokens`) on
     `@anthropic-ai/sdk` (already a dependency): `messages.stream`,
     `thinking: { type: "disabled" }`, `output_config: { effort: "low", format:
zodOutputFormat(schema) }`, usage mapped to `GenerationTokenUsage` (input =
     `input_tokens` + cache tokens), `...modelFetchOption()` so the US relay
     still works on Workers, and `ANTHROPIC_API_KEY` added to both server
     Workers and Vercel.
   - OpenRouter with `AI_PROVIDER=openrouter` and
     `OPENROUTER_MODEL=anthropic/claude-haiku-5.5`: the request shape works
     as it is (27 of 27 diagrams), but thinking cannot be switched off with the
     current request, so 30% of calls ran past 18 s. Whether OpenRouter accepts
     a "no reasoning" setting for this model was not tested.
2. **`model-config.ts`.** `usesSinglePassArchitecture` is true only for OpenAI
   Luna, so any other model takes the older two-call path, which this
   experiment did not run. `AIProvider`, `getGenerationServiceTier`,
   `supportsTextVerbosity` and `supportsExactInputTokenCount` need the new
   provider.
3. **`generation-policy.ts`.** `getArchitectureReasoningEffort` returns
   `"medium"` for every model that is not Luna: for Haiku that is 26 s to the
   first text. It needs `"low"`, plus a thinking-off switch.
4. **`pricing.ts`.** No entry for Haiku, so `resolvePricingModel` returns null
   and `createCostSummary` throws `ModelPricingUnavailableError` (from reading
   the code; my runner prices calls itself). It needs the entry, the
   over-100,000 step, and Haiku left out of the OpenAI cache-write rule.
5. **The schema.** Make node, group and edge ids safe before
   `architectureOutputSchema.parse` (or retry once), since Anthropic does not
   enforce the id pattern.
6. **Estimates and the free quota.** `estimateTokens` assumes 3 characters a
   token; Haiku measured 2.2 to 2.4, so cost estimates would be about 30% low,
   and the daily complimentary token limit would be used up about 1.7 times
   faster for the same diagrams.
7. Tests that pin these (`model-config.test.ts`, `generation-policy.test.ts`,
   `pricing.test.ts`, `cost-estimate.test.ts`, `openai.test.ts`), `.env.example`,
   and the error messages that say "OpenAI".

## Not measured, and what went wrong

- **No prompt over 100,000 tokens was run**, because the pipeline cannot
  produce one. The over-100,000 cost above is arithmetic from the price list.
- **Effort high** was not run: medium is already three times too slow.
- **Only 3 samples per repository**, 27 per setup. The failure rate (1 of 27)
  and repair rate are rough.
- **`haiku-medium` was judged on 9 runs**, `luna-std` and `haiku-or-low` on
  none (deterministic scores only). `luna-std` is the same model and effort as
  `luna`, so its quality should match; that was not checked by the judge.
- **The judge is one model (GPT-6 Sol) with a strict rubric.** Its absolute
  rates are high for every setup; only the differences between setups mean
  something. A human did not review the diagrams.
- **The failed p-limit answer was not saved**: the SDK threw before returning
  the text or the usage. Its cost is estimated in `out/spend.jsonl` ($0.0014).
- **OpenRouter cost** is computed from token counts at the list price, not read
  from OpenRouter's bill.
- **Timings are from this server (Toronto)**, one diagram per setup at a time,
  3 repositories in parallel. Cloudflare Workers were not involved, and neither
  was production load or Anthropic's rate limits on a model released the same
  day.
- **The older two-call path, visitors' own API keys, and Vercel** were not
  exercised.
- **The worktree's `.env` disappeared during the experiment** (not removed by
  this experiment), and an uncommitted edit to `src/server/generate/pricing.ts`
  that was present at the start was gone too. The runs used
  `/home/ahmed/repos/gitdiagram/.env` for OpenAI, OpenRouter and GitHub, and
  `~/.config/gitdiagram/anthropic-api-key` for Anthropic.
- Luna's price on OpenRouter's listing steps up at 272,000 prompt tokens, which
  does not match "flat up to 922K". It does not matter at these prompt sizes;
  OpenAI's own price page was not checked.

## Spend

US$8.06 of the US$10 limit (`out/stats.txt`, `out/spend.jsonl`): judge $7.29,
generation $0.64 (162 diagrams), speed bench $0.10, smoke tests $0.04. The
Haiku token counts in `worst-case.ts` are free.

## Files

- `run.ts`: one repository, several setups, identical prompt. `run-all.ts`:
  all repositories.
- `cost.ts`: prices. `score.ts`, `judge.ts`, `repos.ts`: copies of the
  `diagram-evidence` scripts reading `out/`. `summarize.ts`: the tables.
- `bench.ts`: speed on the recorded production request. `worst-case.ts`: token
  counts at the character caps.
- `expected.json`: the 9 repositories (core-module lists only for the original
  5).
- `out/` (gitignored): `summary.md`, `summary.json`, `stats.txt`, `score.json`,
  `bench.jsonl`, `worst-case.txt`, `spend.jsonl`, logs, and
  `runs/<setup>/<owner>__<repo>__<n>/` with `prompt.txt`, `response.txt`,
  `graph.json`, `diagram.mmd`, `result.json` and `judge.json`.

```bash
E=/home/ahmed/repos/gitdiagram/.env
bun experiments/diagram-haiku/run-all.ts 3 luna,luna-std,haiku-nothink,haiku-low,haiku-medium,haiku-or-low
bun --env-file=$E --conditions=react-server experiments/diagram-haiku/score.ts luna luna-std haiku-nothink haiku-low haiku-medium haiku-or-low
SAMPLES=1 bun --env-file=$E --conditions=react-server experiments/diagram-haiku/judge.ts luna   # about $0.10 a run
bun --conditions=react-server experiments/diagram-haiku/summarize.ts luna luna-std haiku-nothink haiku-low haiku-medium haiku-or-low
bun --env-file=$E --conditions=react-server experiments/diagram-haiku/bench.ts 5
```
