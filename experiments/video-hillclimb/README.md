# Cleaner, longer explainer films (2026-10-08)

Films from the Opus + Haiku 5.5 pipeline had elements on top of each other,
arrows running through cards and text cut short. This measured that on the
real stage, replaced hand-placed coordinates with a layout the code solves,
and made films about 1.5 times as long.

## What changed

- **Designers no longer write coordinates.** `write_shots` takes a `layout`
  for the scene (nested rows and columns of element ids, a browser window
  around a sub-layout, a slot elements take turns in) and
  `src/server/explainer/layout.ts` works out every position: sizes from
  content, cards of one kind one size, rows of a column aligned as a grid,
  the largest size that fits the area the camera shows, a row turned into a
  stack when that draws it clearly bigger, a fresh layout after a beat that
  clears the screen. The stored plan still holds coordinates, so the engine,
  reels and old films are untouched. `svg` and `move` are no longer offered.
- **Engine (all films, old ones too):** arrows route around every card of the
  scene, near-level arrows run straight, an arrow's label sits beside a line
  too short to carry it, the camera frames again after something leaves, an
  arrow leaves with either of its ends, a replaced box label stays centred.
- **Length:** 195 to 220 words (was 110 to 130), 20 to 26 beats, 8 to 10
  scenes. The voice reads about 2.7 words a second, so that is 80 to 85 s
  (production films before averaged 54 s).

## Measured

`audit.ts` holds every beat until it settles, then reads the DOM: cards on
cards, arrows through cards, arrow labels on cards, text cut or spilling,
anything under the caption or the repository label or out of frame.

|                          | Production, 30 newest films (2026-10-03 to 08) | New, 8 films |
| ------------------------ | ---------------------------------------------- | ------------ |
| Beats a film             | 14                                             | 23           |
| Distinct defects a film  | 7.3                                            | 2.1          |
| Beats with a defect      | 36%                                            | 9%           |
| Overlapping cards a film | 1.23                                           | 0            |
| Under the caption a film | 2.47                                           | 0            |
| Arrow faults a film      | 0.97 (1.13 before the engine fix)              | 0.25         |

Cost a film (list prices, cold caches): script $0.17, design $0.02, voice
$0.026, about $0.22 against about $0.17 before (script $0.12, design $0.03,
voice $0.02). A whole run took 61 s (unjs/defu: 82.7 s film, 220 words) and
its landscape MP4 rendered in 66 s on this server.

What is left is mostly taste, not breakage: Haiku still sometimes puts eight
or nine elements in a scene (everything gets small), and long code lines are
cut. `judge.ts` showed Claude Opus old and new films of the three repositories
both sets hold, blind: it preferred the new one twice (7 to 5, 7 to 6) and
the old one once (7 to 6). Its complaints about the new films (an arrow left
pointing at something that had exited, arrow labels jammed between boxes, an
empty browser window) were fixed after that look and not judged again.

## Files

- `serve.ts` (the stage, port 4611), `fetch-prod.ts` (newest production
  films), `audit.ts` (defects and contact sheets), `run.ts read | direct |
design | rebuild`, `voice.ts` (times a real take), `shot.ts`, `reel.ts`, `judge.ts`.
- `. experiments/video-hillclimb/env.sh`, then
  `bun --conditions=react-server experiments/video-hillclimb/<file>`.
- Output in `out/` (ignored). Spend: about $3.50.
