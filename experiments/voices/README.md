# Narration voice bake-off (2026-09-25)

Two scripts Claude Opus wrote (fastapi, zustand) were read by 13 hosted
voices and compared by ear, with transcription checks and blind AI judges.

Result: Gemini 3.8 Flash TTS with the Charon voice won clearly over the
previous narrator; Cartesia Sonic 3.6 was close and the
fastest; Qwen-Audio-3.0 sounded robotic. It is now the only narrator,
called through OpenRouter (see src/server/explainer/voice.ts).

- `video.ts owner/repo`: re-narrates a stored film from
  `experiments/video-models/out` with the production narrator and renders
  it, to check captions against the voice. Run with
  `bun --conditions=react-server`, with `experiments/video-models/serve.ts`
  serving the stage and `VIDEO_RENDER_CHROME_PATH` set.
