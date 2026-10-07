# Claude Haiku 5.5 as scene designer (2026-10-07)

Can Haiku 5.5 replace GPT-6.1 Sol (medium) as the scene designer, with Opus 5.5
still directing? Six repositories were read once and directed once (Opus 5.5,
low); the identical script then went to four designer setups, twice each
(48 films). Only the designer varied.

**Verdict: do not swap by env alone. After a small parsing fix in
`director.ts`, Haiku 5.5 at medium effort is a fair swap: about 70% cheaper to
design, judged level with Sol or a little better, about 13 s slower.**

Repositories: fastapi/fastapi, BurntSushi/ripgrep, pmndrs/zustand,
excalidraw/excalidraw, and two small ones (ainoya/cloudflare-dom-distiller, 31
stars; s-t-e-f-a-n/BillCollector, 59 stars).

## Results

| Setup                            | Design cost / film (range) | Design time (range) | Validator warnings, 12 films | Films production's code would have failed / shown with missing beats | Opus judge: overall, avg rank | Sol judge: overall, avg rank |
| -------------------------------- | -------------------------- | ------------------- | ---------------------------- | -------------------------------------------------------------------- | ----------------------------- | ---------------------------- |
| GPT-6.1 Sol, medium (production) | $0.108 (0.073–0.134)       | 25 s (16–36)        | 3                            | 0 / 0                                                                | 5.25, 3.50 · 5.83, 2.92       | 5.75, 2.58 · 6.33, 2.33      |
| Haiku 5.5, low                   | $0.027 (0.013–0.037)       | 25 s (15–42)        | 37                           | 3 / 11                                                               | 6.83, 2.08 · 6.08, 2.92       | 5.83, 2.75 · 5.92, 2.75      |
| Haiku 5.5, medium                | $0.032 (0.016–0.043)       | 38 s (28–47)        | 20                           | 4 / 8                                                                | 6.33, 2.25 · 6.67, 2.25       | 6.33, 2.08 · 6.33, 2.42      |
| Haiku 5.5, high                  | $0.045 (0.025–0.055)       | 73 s (52–109)       | 42                           | 1 / 5                                                                | 6.58, 2.17 · 6.83, 1.92       | 6.00, 2.58 · 6.25, 2.50      |

Judge cells are "first look · second look" (see Judging). Rank is 1 (best) to
4, over 12 comparisons each.

- **Cost** is the design step only, for a repository not filmed in the last
  few minutes, worked out from each run's measured tokens (the runs here
  repeated each repository within minutes, so later ones read caches earlier
  ones wrote; what was really billed averaged $0.087 for Sol and $0.017–0.030
  for Haiku). Opus directing is the same for every setup and cost $0.05–0.17
  (average $0.123, 13–16 s).
- **No designer prompt was over 100,000 tokens**: 0 of 198 Haiku calls (average
  31,011, largest 42,593 by Claude's count; the same prompts are 7,972–23,363
  by OpenAI's). The lower Haiku price band applies.
- **Retries, calls to a second model, API errors, cut-off replies: 0** for
  every setup (264 designer calls).
- Haiku writes about 4 to 11 times the output tokens Sol does for the same
  film (19k / 29k / 55k against 4.8k), which is why high effort is slow.

## What breaks if only the env values change

1. **Haiku often sends `shots` as a JSON string, not an array**: 41 of 198
   scene replies (low 19 of 66, medium 15, high 7); Sol 0 of 66. Every one was
   the array followed by a stray `}`, so a strict `JSON.parse` fails too.
   `design()` in `director.ts` reads a non-array as no shots and raises no
   error, so there is no retry: the scene's beats fall back to plain type, and
   a film with more than a third of its beats undesigned is thrown away. With
   today's code 8 of 36 Haiku films would have failed outright and 24 of 36
   would have had missing beats (152 of 492 beats). Cutting the string at its
   last `]` recovered all 41. The quality figures above are for films with
   that fix applied (`rebuild.ts`); `artifact-as-is.json` is what production
   would keep today.
2. **No price for the model**: `claudePrice("claude-haiku-5-5")` is null, so a
   film's whole `plannerCostUsd` becomes null (the Opus part too), and
   `admin/claude-credit.ts` prices an unknown model at Fable 5.1's rate (100×
   Haiku's). `ClaudePrice` also has no way to say "5× over 100,000 tokens".
3. **No cache prewarm for a Claude designer**: `prewarm()` returns unless the
   designer is an OpenAI model, and the director writes no cache when the
   designer is a different model. Every parallel designer then writes the
   repository block itself at 1.25× (seen on all cold runs: 5 or 6 writes, no
   reads). One prewarm call during directing would cut Haiku's design cost
   from about $0.032 to $0.020 a film at medium (calculated, not run).
4. **The stand-in is no longer on another provider**: the designer is also the
   model that writes the script when Opus fails. With Haiku both are on the
   Claude API, so an empty Claude balance or an outage stops videos; today Sol
   carries on.
5. `VIDEO_STANDARD_MODEL` also sets the designer of premium films
   (`premiumPlanner`), unless `VIDEO_PREMIUM_OPUS_DESIGNS=1`.

The env values themselves: `VIDEO_STANDARD_MODEL=claude-haiku-5-5`,
`VIDEO_STANDARD_EFFORT=medium` (on Vercel and all Workers).

## Validator warnings

Sol: 3 overlaps. Haiku (low / medium / high): made-up file paths 23 / 14 / 25,
arrows or actions pointing at nothing 10 / 4 / 11, web addresses not in the
repository 2 / 2 / 3, overlaps 1 / 0 / 2. The validator removes all of these
before the film is stored, so nothing false is shown, but a removed file or
tree can leave a thinner frame. Ten of the made-up paths are one fake "messy
project" tree on ripgrep's opening.

## Judging

Blind, by letter, order randomized per comparison; judges Claude Opus 5.5 and
GPT-6.1 Sol (medium); four films per comparison, all from one script; scores
for layout, cleanliness, fidelity to the brief, variety and overall, plus a
ranking. Contact sheets come from the real stage in headless Chromium, one
frame per beat.

- First look: frames 0.4 s before each beat ends (as in the earlier
  experiments). Some catch an animation mid-move.
- Second look: each beat followed by a 1.5 s hold, frame taken 1.2 s into it,
  new random letters.

Over the four judge rounds the average rank was Sol 2.83, Haiku low 2.63,
medium 2.25, high 2.29. Sol was ranked last 22 times of 48, Haiku medium 7.
The Sol judge puts Sol level with Haiku; the Opus judge puts every Haiku
setup ahead of Sol on the first look and medium and high ahead on the second.
The judges' usual complaint about Sol: thin frames (empty terminals, cards
without their content). About Haiku: busier frames, items colliding with the
caption.

## Limits of this test

- LLM judges reading stills, not people watching with sound. Each judge
  shares a maker with one side. `out/index.html` is there to pick by eye.
- No narration was made; beat timing is a stand-in at 2.3 words a second.
- Twelve films a setup; differences of a few tenths between setups are noise.
- Design time was measured with two repositories running at once.
- Sol designed in 25 s here, not the ~90 s the task assumed; a whole
  production film was not timed.
- The 1-hour cache-write price for Haiku 5.5 was assumed to be 2× input.
- The prewarmed Haiku cost is arithmetic on measured tokens, not a run.
- Whether strict tool use or a prompt line stops the string replies was not
  tried.
- No MP4 was rendered; stills only.

## Files

- `run.ts read | direct | design`: makes the films through production's
  `createFilmWriters` (the director's call is replayed from the saved script;
  `lib.ts` wraps the SDKs to record every call's usage).
- `rebuild.ts`: the films with string replies parsed.
- `serve.ts`, `sheets.ts`: the stage and the contact sheets (`SETTLED=1` for
  the second look). `judge.ts`, `summary.ts`, `page.ts`.
- Run with `. experiments/video-haiku-designer/env.sh`, then
  `bun --conditions=react-server experiments/video-haiku-designer/<file>`.
- Output in `out/` (ignored): `summary.json`, `judge.json`,
  `judge-settled.json`, `index.html`, `films/<repo>/<setup>-r<run>/`.

Spend: $6.94 (directing $0.74, designing $1.95 including $0.12 of trial runs,
judging $4.25).
