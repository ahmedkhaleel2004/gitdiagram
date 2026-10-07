# Can Workers AI's whisper time the narration? (2026-10-07)

Measured, not adopted. Nothing under `src/` changed.

## Verdict

- **`@cf/openai/whisper-large-v3-turbo` (the cheap one): worse.** It hears the script as well as `whisper-1`, but its word **start** times are early: a median 256 ms before the word is really spoken after a pause, where `whisper-1` is 15 ms off. Captions, cues and scene cuts all run on word starts, so they would lead the voice by about a quarter second. It saves about half a cent a video.
- **`@cf/openai/whisper` (original) and `whisper-tiny-en`: worse** on both hearing and timing, and the original refuses anything much over a minute.
- **`@cf/deepgram/nova-3` on Workers AI: better on what the engine uses, but not cheaper.** Same hearing, word starts closer to the audio than `whisper-1` (median 60 ms against 115 ms, worst 369 ms against 863 ms), five times faster. Its word ends run about 290 ms into the pause that follows. List price is 13% under `whisper-1`; the startup credits would pay for it. No video was rendered with its timing, so "looks better" is not shown, only "starts are closer to the audio".

So the answer to "can Workers AI's whisper replace the call with no loss": **no**. The one Workers AI model worth a second look is nova-3, and the reason would be sync and speed, not money: the whole transcription bill is $2 to $13 a month.

## What production does today

`src/server/explainer/voice.ts`, `heardWords`: OpenAI `whisper-1`, `POST /v1/audio/transcriptions`, `verbose_json`, `timestamp_granularities: ["word"]`, no prompt. It runs in the `GENERATE` render container (Node), after ffmpeg turns the take into MP3.

What the alignment needs (`voice-alignment.ts`, `alignTake`): a list of `{ word, start, end }` in seconds, nothing else. Words are compared lower-cased without accents or punctuation; missed words share the time around them. `speak` accepts a take when at least 75% of script words are heard exactly, reads the script once more if not, and spreads the words evenly if the second take fails too.

What the engine uses (`public/video-engine/stage.js`, `shots.js`): word **starts** light the captions and fire cues, beat **starts** place scene cuts (0.22 s before) and camera moves. Ends matter little (how long a caption block stays, a camera midpoint).

Cost today, from `voice.ts`'s own constant (`TRANSCRIPTION_USD_PER_MINUTE = 0.006`): takes are 38 to 62 s (12 sampled; the 1,240 published films are 42 to 66 s including 4 s of lead-in and tail), so about **$0.005 a video**. The voice itself is about $0.011 a video on the same constants. Measured latency of the call from `ahmed-vps`: median 3.5 s.

## Method

- 12 real takes from published videos, spread from the shortest to the longest in a 216-video slice of the gallery; current pipeline only (one take, Charon). Audio and artifact come from the public `/api/video` and `/api/video/audio` routes. Nothing was written to production.
- Each take went to every service with no prompt. `whisper-1`, turbo, original whisper and nova-3 ran twice.
- Timing went through the repo's own code: `narrateBeats` in `narration.ts` loaded unchanged, with `voice.ts` replaced by `voice-stub.ts`, whose `speak` calls the real `alignTake` on the service's words and applies the same 75% rule.
- **Check on the harness:** today's `whisper-1` run reproduces the timing stored in production for all 12 videos to 0 ms on every word and beat. So the stored timings are a faithful `whisper-1` baseline and the harness matches production.
- **A reference that is not another model:** ffmpeg `silencedetect` (below -35 dB for 0.2 s) finds 206 pauses in the 12 takes. The word before a pause should end where the silence starts, and the word after should start where it ends. This is exactly where beats and scenes begin.

## Numbers (12 takes, 1,540 script words, 168 beats)

Hearing and speed:

| service                               | $ per audio minute | word error rate, mean / worst take     | script words heard exactly, mean / worst | takes refused (<75%) | latency median / max                   |
| ------------------------------------- | ------------------ | -------------------------------------- | ---------------------------------------- | -------------------- | -------------------------------------- |
| OpenAI whisper-1 (today)              | 0.006              | 4.3% / 17.3%                           | 96.3% / 82.7%                            | 0                    | 3.5 s / 5.7 s (second run 3.8 / 12.4)  |
| WAI whisper-large-v3-turbo            | 0.000513           | 5.7% / 23.0% (second run 4.5% / 16.5%) | 96.4% / 83.5%                            | 0                    | 4.9 s / 12.8 s (second run 4.5 / 15.1) |
| same, `language: en`, no conditioning | 0.000513           | 4.2% / 16.5%                           | 96.4% / 83.5%                            | 0                    | 3.3 s / 5.8 s                          |
| same, `vad_filter`                    | 0.000513           | 4.7% / 18.1%                           | 96.3% / 81.9%                            | 0                    | 3.1 s / 15.0 s                         |
| WAI whisper (original)                | 0.000453           | 8.5% / 22.8%                           | 93.1% / 77.2%                            | 0                    | 3.7 s / 5.0 s                          |
| WAI whisper-tiny-en (beta)            | not listed         | 10.7% / 25.2%                          | 90.9% / 74.8%                            | 1                    | 4.7 s / 6.4 s                          |
| WAI Deepgram nova-3                   | 0.0052             | 4.3% / 18.1%                           | 96.5% / 81.9%                            | 0                    | 0.66 s / 0.95 s                        |

Against the audio's own pauses (206 pauses), ms, median / 95th percentile / worst, and the signed median (negative is early):

| service                | word after the pause: start | signed | word before the pause: end | signed |
| ---------------------- | --------------------------- | ------ | -------------------------- | ------ |
| whisper-1 (today)      | 115 / 482 / 863             | +15    | 46 / 217 / 844             | -27    |
| whisper-large-v3-turbo | 259 / 492 / 873             | -256   | 86 / 379 / 1326            | -76    |
| turbo, `language: en`  | 256 / 487 / 587             | -247   | 85 / 391 / 1326            | -73    |
| whisper (original)     | 71 / 362 / 729              | -56    | 353 / 775 / 1121           | +352   |
| whisper-tiny-en        | 241 / 552 / 1025            | -237   | 193 / 492 / 1114           | +190   |
| nova-3                 | 60 / 190 / 369              | -37    | 292 / 431 / 874            | +289   |

Against today's `whisper-1` timing, through the real `narrateBeats`, ms, median / 95th percentile / worst:

| service                | word start       | word end         | beat start       | beat end          | scene start      | beat edges moved >100 ms | >250 ms |
| ---------------------- | ---------------- | ---------------- | ---------------- | ----------------- | ---------------- | ------------------------ | ------- |
| whisper-1, second run  | 0 / 0 / 0        | 0 / 0 / 0        | 0 / 0 / 0        | 0 / 0 / 0         | 0 / 0 / 0        | 0%                       | 0%      |
| whisper-large-v3-turbo | 80 / 420 / 740   | 80 / 300 / 1280  | 280 / 500 / 640  | 60 / 240 / 1280   | 360 / 560 / 600  | 50%                      | 30%     |
| whisper (original)     | 100 / 380 / 700  | 120 / 480 / 1160 | 120 / 440 / 620  | 400 / 780 / 1160  | 140 / 500 / 520  | 73%                      | 46%     |
| whisper-tiny-en        | 258 / 790 / 1777 | 269 / 800 / 1920 | 198 / 791 / 1393 | 373 / 1100 / 1920 | 196 / 917 / 1393 | 78%                      | 56%     |
| nova-3                 | 60 / 320 / 705   | 60 / 365 / 900   | 125 / 380 / 705  | 300 / 430 / 900   | 110 / 365 / 540  | 67%                      | 39%     |

Turbo is early on words inside a phrase too (median 80 ms before `whisper-1`), so trimming its starts to the detected pauses would not fully fix it. `vad_filter` and `language` did not move its times.

No service produces "the same beat cuts" as `whisper-1`: every one moves a third or more of beat edges by over a quarter second. For nova-3 the movement is mostly later ends; for turbo it is earlier starts.

Repeatability: `whisper-1`, original whisper and nova-3 gave identical times on a second run. Turbo with default settings did not: one take's error rate went 23.0% then 8.1%, and one word start moved 240 ms.

Limits (takes joined end to end, `limits.json`):

| service                | 3.8 min, 3.6 MB            | 10.3 min, 9.9 MB | 30.4 min, 29 MB |
| ---------------------- | -------------------------- | ---------------- | --------------- |
| whisper-large-v3-turbo | ok, 24 s                   | ok, 36 s         | ok, 91 s        |
| nova-3                 | ok, 1.2 s                  | ok, 2.0 s        | not tried       |
| whisper (original)     | 413 "Request is too large" | 413              | 413             |

The original whisper took every real take (largest 964 KB) but refuses 3.6 MB; the exact limit between was not measured. It also answered 2 of 24 normal calls with a spurious 400 ("Field required") that passed on retry. Turbo and nova-3 never failed in 51 and 26 calls.

The API token in `~/.config/gitdiagram/cloudflare-api-token` already has Workers AI permission.

## Cost

A typical take is 50 s (0.83 min).

|                        | per video | at 114 videos a week (last 7 days) | at the 14-day average (2,660 a month) |
| ---------------------- | --------- | ---------------------------------- | ------------------------------------- |
| whisper-1 today        | $0.0050   | $2.44 a month                      | $13.30 a month                        |
| whisper-large-v3-turbo | $0.00043  | $0.21                              | $1.14                                 |
| nova-3                 | $0.0043   | $2.12                              | $11.50                                |

Volume is from the public gallery (`volume.json`): 1,240 videos published since 2026-09-24, 389 on the busiest day, 114 in the last seven days, 7 in the last three. Regenerations and failed runs are not in the gallery, so real voicing calls are a little higher; `scripts/video-pipeline-test.mjs health` was not run (it needs production credentials and the gallery answered the question). The $2,500 of Workers AI credit would cover either model at these volumes until it expires on 2027-10-07.

## What a switch to nova-3 would involve (not done)

1. Render one or two videos with nova-3 timing beside the stored ones and judge caption sync by eye. That is the test this experiment did not run.
2. `heardWords` in `voice.ts` calls Workers AI instead of OpenAI. It runs in a container, which has no `AI` binding, so either the REST API with an account API token as a new secret (Workers and Vercel both), or a small route on the site's Worker that uses a binding. The response shape differs (`results.channels[0].alternatives[0].words`).
3. Decide what to do with the late ends, for example nothing (ends matter little), or cap a beat's last word at the silence ffmpeg detects.
4. Keep `whisper-1` as the fallback for a Workers AI error, since there is no second voice path today and `isVoiceConfigured` already requires the OpenAI key.
5. Update `TRANSCRIPTION_USD_PER_MINUTE`, the comments naming `whisper-1`, `.env.example`, and `scripts/video-model-replay.mjs` (the load test's stand-in for the model APIs) so replayed runs answer the new call.
6. nova-3 is a partner model under Deepgram's terms; `mip_opt_out` exists and changes the price. Not looked into.

## Not tested

- No video was rendered with any other service's timing, so the effect on how a film looks is inferred from the times.
- Mid-phrase words have no independent reference; only pauses do.
- The pause reference is an energy threshold. A soft first consonant can start a few tens of ms before the "silence" ends, which would make every service look slightly late by the same amount.
- Calls were made from `ahmed-vps` (Toronto) over the REST API, not from the render container or through a binding; latency there may differ.
- One language (English) and one voice (Charon). 12 takes.

## Files

- `fetch-samples.ts`: picks and downloads the takes and artifacts into `out/` (ignored by git).
- `providers.ts`, `transcribe.ts`: one call per service; answers cached in `out/heard/`.
- `voice-stub.ts`, `analyze.ts`: the comparison through the real `narrateBeats` and `alignTake`; writes `results.json`.
- `limits.ts`, `volume.ts`, `catalogue.ts`: long audio, gallery volume, the Workers AI model list and schemas.

To run again (under $0.50 of transcription in total):

```bash
bun experiments/video-whisper-workers-ai/fetch-samples.ts 12
bun experiments/video-whisper-workers-ai/transcribe.ts whisper-1,turbo,turbo-vad,turbo-en,whisper,tiny-en,nova-3 a
bun experiments/video-whisper-workers-ai/transcribe.ts whisper-1,turbo,whisper,nova-3 b
bun experiments/video-whisper-workers-ai/analyze.ts
bun experiments/video-whisper-workers-ai/limits.ts
```
