# Video planner model experiment (2026-09-25)

Can GPT-6 write and design explainer videos as well as Claude? Each repository
was read once; the same input then went to five director/designer setups. Every
film was voiced by the same ElevenLabs voice and rendered by the same engine.

- `run.ts generate | render | summary`: make the films (run with
  `bun --conditions=react-server`; rendering needs `serve.ts` running and
  `VIDEO_RENDER_CHROME_PATH`).
- `sheets.py`: one frame per beat, tiled per film.
- `judge.ts`: blind scoring by Claude Opus 5.5 and GPT-6 Sol from the script and
  contact sheet, films labelled by letter only.
- Output (videos, reports, `index.html` side by side) lands in `out/`.

Swap models in the app with `VIDEO_PLANNER_MODEL` (any `gpt-*` model uses the
OpenAI Responses API) and `VIDEO_PLANNER_EFFORT` (`low` by default).

## Results: fastapi, ripgrep, zustand, excalidraw

| Setup | Cost / film | Time / film | Validator warnings (sum) | Claude judge: overall, avg rank | GPT judge: overall, avg rank |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5, low (production) | $0.37–0.44 | 30–51 s | 23 | 8.5, 1.0 | 8.0, 2.25 |
| GPT-6 Sol, low | $0.21–0.33 | 36–46 s | 8 | 6.5, 2.75 | 7.5, 2.5 |
| GPT-6 Sol, medium | $0.29–0.33 | 66–91 s | 1 | 6.8, 2.5 | 8.2, 2.0 |
| GPT-6 Luna, low | $0.01–0.02 | 29–46 s | 68 | 5.2, 4.75 | 6.0, 4.5 |
| GPT-6 Luna, medium | $0.02 | 64–93 s | 16 | 6.0, 4.0 | 6.8, 3.75 |

- Opus writes the best narration: a real hook, one story, lines that land.
  Its 23 warnings are all on ripgrep: it made up a messy file tree for the
  opening, the validator dropped those paths, and the panel showed up empty.
- Sol (medium most of all) is accurate and tidy but flatter: more abstract,
  clause-heavy, less of a story. The GPT judge ranked it first on ripgrep and
  excalidraw; the Claude judge ranked Opus first on all four.
- Luna is clearly weaker: made-up paths (`src/main.rs` in ripgrep), crowded
  and overlapping layouts, too few beats, and one script that stayed too long
  after the trim (168 words).
