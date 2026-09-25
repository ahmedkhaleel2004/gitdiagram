# Narration voice bake-off (2026-09-25)

Two scripts Claude Opus wrote (fastapi, zustand) read by 13 hosted voices,
with the script's delivery tags passed in each model's own form.

- `run.ts [variant,...]`: make the takes (run with `bun --conditions=react-server`).
- `check.ts`: transcribe each take, word error rate, spoken tags, pace.
- `judge.ts [variant,...]`: blind rankings by gpt-audio and gemini-3.1-pro.
- `video.ts owner/repo`: re-narrate a stored experiment film with the
  production narrator and render it, to check captions against the voice.

Result: by ear, Gemini 3.8 Flash TTS with the Charon voice beat the previous
narrator (ElevenLabs v3) clearly, at about $0.016 a video with the whisper-1
timing pass; it became the only narrator. Cartesia Sonic 3.6 (Kyle) was close
and fastest; Qwen-Audio-3.0 sounded robotic; Gemini 3.1 read a tag aloud.
