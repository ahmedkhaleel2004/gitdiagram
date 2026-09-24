# Video lab — repository explainer videos

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
