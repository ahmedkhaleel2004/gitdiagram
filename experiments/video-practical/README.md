# Practical-first script experiment (2026-09-25)

After launch, the maintainer of andronedev/openportal said of their video: "it
goes into a little too much detail about the technical and architectural
aspects; I would have preferred if the video had focused more on the project's
practical applications." The director's prompt was reordered so the first
three scenes (about half the words) cover what the project is for and two or
three concrete things people do with it, then briefly how it works, then one
decision under the hood (it was two or three, with up to three code panels;
now at most two).

`run.ts` scripts the same repositories with the previous prompt
(`previous-prompt.txt`) and the new one, director only, on the production
premium planner (Claude Opus 5.5, low effort). Output lands in `out/`.

## Results: openportal, tldraw, fastapi, ripgrep

| Repository            | Previous                                                                             | Practical-first                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| andronedev/openportal | Half the words on WebUSB, the app manager, the sandboxed worker and the JSON catalog | Install, launch, stop, uninstall, mirror with your mouse, advanced mode; then WebUSB and the sandbox in brief |
| tldraw/tldraw         | Select tool, editor, drag-and-drop manager, sync tombstones, camera scaling          | Custom shapes, self-hosted multiplayer, AI agents, starter kits; one decision (camera scaling)                |
| fastapi/fastapi       | Router, dependency system, Pydantic, 422s, OpenAPI                                   | A failed request, the docs page, who runs it, then the one-declaration idea                                   |
| BurntSushi/ripgrep    | Walker, matcher, searcher, printer, literal extraction                               | Type filters, PCRE2, the kernel timing; then the walker and literal extraction                                |

Word counts and cost did not change (123–140 words, $0.17–0.29 a script). The
stories kept their hook and closing line.
