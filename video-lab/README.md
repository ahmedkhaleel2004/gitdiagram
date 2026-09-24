# Video lab — repository explainer videos

## Any repo → video: `pipeline/`

```bash
bun install                                   # playwright-core, for reading SFX cues
node pipeline/run.mjs fastapi/fastapi         # → runs/fastapi__fastapi/fastapi__fastapi.mp4 + report.json
node pipeline/rerender.mjs runs/<slug>        # re-render with the current engine; no model, no TTS
node pipeline/snap.mjs runs/<slug>            # end-state snapshot of every scene (≈6 s)
node pipeline/review.mjs runs/<slug>          # contact sheets from the final MP4
```

How it stays under two minutes and $2: the model writes a small **plan**, not a video.

| Stage | File | What it does | Typical time |
| --- | --- | --- | --- |
| ingest | `pipeline/ingest.mjs` | GitHub API in parallel: metadata, recursive tree, README, and ~12 scored source files sent as head + declaration outline | 1 s |
| plan | `pipeline/plan.mjs`, `prompt.mjs`, `schema.mjs` | One Claude Opus 5.5 call (`claude -p`, effort low, structured output) returns 8–10 beats: narration, a scene type from the library, real repo artifacts, and cue words. `normalize()` enforces limits and checks every path, cue and code line against the repo | 17–32 s |
| voice | `pipeline/voice.mjs` | ElevenLabs `eleven_v3` per beat, 4 at a time, with timestamps; beats laid on one clock with structural pauses | 11 s |
| render ∥ mix | `engine/`, `pipeline/mix.mjs` | HyperFrames renders the silent 1080p30 picture while the mixer reads the scene engine's SFX cues and mixes voice, ducked bed and effects to −16 LUFS | 34–37 s |
| mux | `run.mjs` | Joins picture and sound | 0.1 s |

The scene engine (`engine/engine.js`) is the reusable craft: 12 scene types (hook, stack, tree, flow,
code, graph, checklist, stream, stats, compare, idea, close) in GitDiagram's visual language, with
auto-layout, text fitting, syntax tint, an odometer, a graph layerer, a chapter rail, and the
"one idea" card that is planted in the hook and flipped mid-video. Every reveal is keyed to the
spoken word the plan cued.

### Benchmark (2026-09-24, Apple M4, same code for every run)

| Repo | Total | Plan | Voice | Render | Planner cost* | Video |
| --- | --- | --- | --- | --- | --- | --- |
| honojs/hono | 79.0 s | 32.0 s | 11.1 s | 34.8 s | $0.33 | 60.7 s |
| fastapi/fastapi | 78.8 s | 31.7 s | 11.7 s | 34.2 s | $0.37 | 60.6 s |
| ahmedkhaleel2004/gitdiagram | 77.1 s | 31.5 s | 10.9 s | 33.9 s | $0.30 | 56.8 s |
| BurntSushi/ripgrep | 67.7 s | 18.7 s | 11.1 s | 36.9 s | $0.31 | 64.8 s |
| psf/requests | 67.7 s | 20.0 s | 10.6 s | 36.1 s | $0.15 | 60.6 s |
| sindresorhus/ky | 66.1 s | 19.4 s | 10.7 s | 34.9 s | $0.27 | 62.5 s |
| charmbracelet/bubbletea | 65.5 s | 17.0 s | 10.8 s | 36.5 s | $0.21 | 60.5 s |

\* Claude Opus 5.5 at API list prices as reported by `claude -p` (`costBasis: list`). Runs used the
Claude subscription; on the API the same call is cheaper still, because the CLI writes a 1-hour
cache at 2× input price. Narration adds ~450 ElevenLabs credits (≈ $0.08 on Starter) per video.
Every plan passed validation with zero warnings; spot-checked facts (ripgrep's 0.082 s vs 2.935 s,
requests' 300M downloads/week and 4,000,000+ dependents) match the READMEs.

### Moving the planner to the Claude API

`plan.mjs` is the only file that talks to Claude. Swap `claude -p` for the Anthropic SDK with the
same `SYSTEM`, `userPrompt(ctx)`, and `SCHEMA` as `output_config.format` (json_schema), model
`claude-opus-5-5`, effort `low`. Everything downstream consumes the same plan JSON.

---

## v1 (hand-made) notes

Experiments toward "GitDiagram, but a ~60s narrated explainer video" for any GitHub
repository. Each project is a [HyperFrames](https://hyperframes.heygen.com) composition
(HTML + GSAP, rendered deterministically to MP4 by headless Chrome) plus a small set of
scripts that turn narration into a timing clock and mix the soundtrack.

## Runs

| Run | Subject | Length | Output |
| --- | --- | --- | --- |
| `gitdiagram-v1` | GitDiagram itself | 66.3 s, 1080p60 | `gitdiagram-v1/renders/gitdiagram-v1.mp4` (not committed) |

## Pipeline (as built for v1)

```bash
P=gitdiagram-v1
# 1. narration: {#cue} markers in the script resolve to exact spoken times
node scripts/eleven.mjs tts --script $P/script/narration.txt --out-dir $P/assets/audio --voice iP95p4xoKVk53GoZ742B --model eleven_v3 --seed 7
# 2. timing clock: cues + word times (tempo/lead-in applied) → $P/timing.js, durations stamped into index.html
node scripts/prep.mjs $P
# 3. author $P/index.html against window.TIMING (every beat keys off a cue or a spoken word)
# 4. soundtrack: reads the sfx() hits the composition declares, mixes voice + ducked bed + SFX, loudnorm -16 LUFS
node scripts/mix.mjs $P
# 5. gate + render (run inside the project so npx uses its own package.json)
(cd $P && npx hyperframes check && npx hyperframes render --fps 60 -o renders/$P.mp4)
```

Review helpers: `scripts/envelope.mjs` prints an audio loudness envelope (onset / peak /
tail) so SFX sync can be checked without listening; `scripts/sheets.py` tiles snapshot
PNGs into contact sheets.

### Ideas worth keeping for the automated version

- **Speech is the clock.** Visual beats reference `C.cue` or `W("word", n)`, never
  hand-typed seconds. Re-voicing the script re-times the whole video.
- **Sound cues live next to the motion that causes them** (`sfx("pop", t, gainDb)`).
  `mix.mjs` reads them from the running composition, so picture and sound cannot drift.
- **Facts come from the code, not the docs.** A research pass with file:line citations
  fed the script; it also found CLAUDE.md claims the code contradicts.
- **Verification without ears or motion-vision:** transcribe the *final mixed* audio
  (proves the voice survives the mix), measure SFX envelopes, and review mid-transition
  frames pulled from the real MP4, not just scene end-states.

## v1 cost and time (measured 2026-09-23)

Wall clock, first idea → verified 60 fps render: **~35 minutes** (21:20 → 21:55 EDT).

| Step | Time | Cost |
| --- | --- | --- |
| Code research (subagent, 92 tool calls, ran in parallel) | 5.3 min | in LLM total |
| SFX kit, 14 generations incl. 3 re-rolls (reusable across videos) | ~2 s each | 179 credits |
| Music bed, 75 s instrumental, `music_v2` (reusable) | 8.5 s | 938 credits |
| Narration, 1,005 chars, `eleven_v3` + 2 Scribe verification passes | 25 s + ~10 s | 542 credits |
| Composition authoring + 3 review/fix passes (me) | ~20 min | in LLM total |
| Mix (headless SFX extraction + 2-pass loudnorm) | 5.5 s | local |
| `hyperframes check` | 11 s | local |
| Render 30 fps draft / 60 fps final (Apple M4, 4 workers) | 44 s / 80.5 s | local |

- **ElevenLabs:** 1,659 credits total (balance 3,207 → 4,866). On the Starter plan
  ($5 / 30k credits) that is **≈ $0.28**. Only the narration (~$0.09) recurs per video
  once the SFX kit and a small music library exist.
- **LLM (estimate, not metered):** this session's context grew to ~380k tokens over
  ~110 turns on Claude Opus 5.5 ($4 in / $20 out / $0.20 cache-read per MTok), plus a
  ~207k-token research subagent. Rough total **≈ $8–12**. Interactive iteration
  dominates; a single-pass generator would cost far less (see below).

## Findings for the pipeline

1. The expensive part is authoring, not rendering. Rendering is ~1.2× real time at
   60 fps on a laptop; TTS is 25 s. A hand-written 1,150-line composition is ~30k output
   tokens. The any-repo pipeline should have the model emit a compact **scene spec**
   (JSON: beats → cue, scene type, real repo facts) that a fixed library of
   brand-consistent scene components renders. That cuts per-video generation to a few
   thousand tokens and makes quality consistent. Hand-authored scenes from this run are
   the seed library: file-tree ingest, gate/stamp, streaming JSON → prose, graph build,
   validator scan, code compile, filter stack, cache bucket, rail → diagram close.
2. The video can also play live in the browser: the composition is plain HTML + GSAP
   driven by one audio clock, so GitDiagram could stream an MP4 only for sharing/export.
3. Bugs this run hit, so the generator avoids them: typing via `clip-path` clips spans
   that later move (clear it after typing); highlight bars are visible unless animated
   (render only the ones used); DOM order decides whether a highlight covers its text;
   3D back-face text trips layout/contrast audits (toggle face visibility at the flip
   midpoint); `loudnorm` drops the tail (pad past the end, then trim); ElevenLabs Starter
   allows 4 concurrent requests and 128 kbps TTS.
4. Still unverified by a human: the voice (Chris, `eleven_v3`), the music bed choice and
   the SFX taste. I can measure levels and intelligibility but not taste.
