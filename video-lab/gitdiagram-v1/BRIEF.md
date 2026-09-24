---
workflow: general-video
flow: automation
storyboard: no
message: "The model proposes; code decides."
destination: youtube
aspect: 1920x1080
language: en
audience: an engineer about to work on the GitDiagram codebase
length: 60s
angle: concept
---

## Intent

A ~60 second onboarding video for GitDiagram, told like a senior engineer walking a new
teammate through the codebase: what it does, how the pipeline fits together, and the one
design idea that explains it (the model returns a graph; deterministic code validates,
compiles, sanitizes and caches it). Every visual is a real artifact from the repo — real
paths, real limits, real SSE status names, the real escaping test case. The user gave full
creative control and asked for narration, custom 2D illustration, elegant type, smooth
motion and subtle sound.

## Customizations

- ElevenLabs narration (Chris, eleven_v3) with cue markers driving all visual timing.
- ElevenLabs SFX kit + instrumental music bed, mixed and ducked by `../scripts/mix.mjs`.
- GitDiagram brand look: lavender paper, 3px ink borders, hard offset shadows, Geist +
  Geist Mono, Instrument Serif for the narrator's ideas.
- A "one idea" sticky note planted in the hook and flipped at the reveal; a pipeline rail
  that becomes the final architecture diagram.

## Notes

- Facts verified against code at commit 245b3ea (see the research notes in ../README.md).
