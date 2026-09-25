# Bespoke-video experiments (2026-09-25, launch morning)

How can the explainer films feel more made-for-this-project without costing
much more or taking much longer? Visual ideas were tested on the fixed scripts
and narration takes from `experiments/video-models` (Opus and Sol films of
fastapi, ripgrep, zustand and excalidraw), so only the pictures changed and no
narration was paid for. Script-level ideas were then tested end to end.

- `frames.ts`: open the real stage, seek, screenshot, tile (about 1 s a sheet).
- `design.ts <variant>`: re-design the fixed scripts under a variant.
- `film.ts <config>`: whole new films (director, designers, narration).
- `judge.ts` / `judge-films.ts`: blind scoring by Claude Opus 5.5 and GPT-6 Sol
  from contact sheets (visual variants share one narration; films also show
  their script), labelled by letter only.
- `render.ts`: an MP4 the way production makes one. `e2e.ts`: one film through
  the production pipeline with local storage.
- `serve.ts` serves `public/` (and the experiment pictures) for the stage.

Run with `bun --conditions=react-server`. Output lands in `out/` (ignored).

## Round 1: visuals on fixed scripts (8 films × 4 variants, 16 judgements)

| Variant | Overall | Avg rank | Firsts |
| --- | --- | --- | --- |
| cam: directed camera + bigger type (engine only) | 6.69 | 1.94 | 7 |
| art: art-direction designer prompt (+ cam) | 6.25 | 2.44 | 2 |
| full: art + README pictures + a "thread" object gliding between scenes | 5.88 | 2.75 | 6 |
| base: production | 5.88 | 2.88 | 1 |

- Real README pictures were the one thing both judges singled out ("the only
  film that shows the real Excalidraw UI").
- The forced thread hurt: a generic pill repeated on every frame, and a CLI
  command drawn as a fake `GET` card. The glide itself worked; forcing an object
  into every scene did not. Dropped.
- The art-direction prompt ("fewer, bigger") over-corrected into empty frames.

## Round 2: pictures on production's prompt (+ cam)

| Variant | Overall | Avg rank | Firsts |
| --- | --- | --- | --- |
| pics: README pictures + cam | 6.75 | 1.50 | 12/16 |
| cam | 6.25 | 1.75 | 4/16 |
| base | 5.50 | 2.75 | 0/16 |

## Round 3: whole films (new scripts, pictures shown to the director too)

| Film | Overall | Story | Visuals | Avg rank | Time | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid: Opus writes, Sol designs, + pictures | 8.00 | 8.38 | 7.50 | 1.63 | ~60 s | $0.46–0.55 |
| Opus alone (production premium) | 7.88 | 8.13 | 7.38 | 1.63 | ~45 s | ~$0.40 |
| Sol alone (production standard) | 6.38 | 6.25 | 6.88 | 3.38 | ~90 s | ~$0.30 |
| Sol alone + pictures | 6.25 | 5.88 | 6.50 | 3.38 | ~88 s | $0.30–0.40 |

Judged as whole films, the script decides: Opus scripts win, and pictures do
not rescue a flatter Sol script. The hybrid is level with Opus alone, about
25 s faster than Sol alone, for about $0.15 more a film.

## Shipped

- The engine directs the camera on every film (old ones too): each beat frames
  what is on screen, a scene opens close and widens as it builds; code and
  terminal type can grow up to 34 px in roomy panels.
- Standard films: Opus directs, Sol designs; Sol writes the script if Opus
  fails (for example when Claude credit runs out).
- Up to three README pictures are shown to both roles; films may show them
  (each in at most two scenes), and only shown pictures are stored.

Caveats: four repositories (plus charmbracelet/glow as an unseen check), LLM
judges reading contact sheets, not people watching with sound.
