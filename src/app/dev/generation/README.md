# Generation approach tester

Run `bun run dev`, then open <http://localhost:3000/dev/generation>.

Three local prototypes share one simulation. Choose **Inline**, **Thread**, or **Canvas**; switching keeps the current time and scenario. Each approach has a direct URL, for example `?approach=thread`. Add `&focus=1` to hide the playback controls initially. The controls button remains available.

- **Inline:** a soft repository field with progress and a short architecture summary expanded during generation. When rendering finishes, progress folds away and the diagram gets a compact toolbar: Activity, Enable zoom, Export, and Regenerate. Activity reopens the summary and full notes. Diagrams start in the normal page flow, with zoom optional.
- **Thread:** an open account of the work, a short excerpt as architecture notes arrive, and a sidebar beside the finished diagram.
- **Canvas:** an open diagram workspace with a floating repository dock; status recedes to the corner when a diagram is available.

These prototypes follow the September 18 reference study: [Beautiful UI](https://www.beautifului.dev/), [AICSS](https://www.aicss.dev/), and [Libraries.dev](https://libraries.dev/). They use original presentation code with existing project dependencies. The earlier production generation UI is unchanged while the alternatives are compared.

## Trying the experience

Click **Generate**, or use Play/Pause, the timeline, playback speed, and Jump to. Scenarios cover normal generation, a slow first response, regeneration over an existing result, a regeneration failure, automatic refinement, a quiet connection, and a connection error. Stop generation and Try again work in every approach. Use the normal site theme toggle for light and dark.

The fixture supplies simulated server events and architecture text. No generation API requests or model credits are used. The completed result uses the real Mermaid renderer, including pan, zoom, and fit. The previous diagram stays mounted and usable until a replacement has actually rendered, including when a request is cancelled or the replacement fails. The simulator only announces completion after the renderer callback.

Inline's export menu works on the preview result: Download PNG uses the existing image exporter, and Copy Mermaid copies the fixture source. Regenerate replays the simulation over the existing diagram. These controls do not call the generation API.

The route returns 404 outside development. All prototype layout and colour overrides are scoped to the tester. No model, billing, production theme, or generation API configuration is changed.

## Verification

The component tests cover approach switching without losing position, immediate acknowledgement, healthy versus silent long waits, cancellation/restart, and renderer handoff/failure for all three approaches. Browser review covers light/dark, 320px and 390px layouts, reduced motion, activity disclosure, completed diagrams, zoom/fit, and regeneration.
