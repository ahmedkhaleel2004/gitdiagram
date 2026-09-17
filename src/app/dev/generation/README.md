# Generation preview

Run `bun run dev`, then open <http://localhost:3000/dev/generation>.

The preview plays automatically. Use **Scenario**, **Jump to**, and playback controls to inspect normal generation, a slow first response, missing connection updates, automatic refinement, and errors. **Stop** and **Try again** exercise recovery. The finished sample uses the actual Mermaid renderer.

Fixtures run locally without generation API calls or credits. The page shares the production components and returns **404 outside development**. Remove this directory when the temporary preview is no longer needed.

## Design review

[Generative Loaders](https://generativeloaders.com/), [muload](https://muload.dev/), and [loaders.wtf](https://www.loaders.wtf/) informed the compact motion direction. The user liked the first reference's style, but their exact remembered site has not been identified. No library, purchased component, or new dependency was added.

| Before                                              | After                                                                            | Why                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Large decorative generation panels                  | One compact card, a small animated glyph, restrained typography                  | Keeps the requested minimal style while retaining GitDiagram's purple palette.     |
| No visible evidence during the model's initial wait | Immediate status, elapsed time, actual source count, server activity indicator   | Confirms receipt and distinguishes model thinking from missing connection updates. |
| Keep-alives discarded by the UI                     | Every nonempty stream chunk records activity, throttled to one update per second | The server already sends heartbeats during the quiet analysis period.              |
| Generic loading messages                            | Read source, Analyze, Build diagram follow server events                         | No invented progress percentages or fabricated intermediate diagrams.              |
| Streamed text dominates the page                    | Optional architecture overview, collapsed by default                             | Gives curious readers detail while keeping the diagram primary.                    |
| Stream updates pull the whole page                  | Only the expanded overview follows new text; manual scrolling pauses following   | Preserves the reader's place. Completed overviews start at the beginning.          |
| Blank interval before Mermaid renders               | Keep loading feedback until successful rendering                                 | A completed API stream is not yet a visible diagram.                               |
| No clear interruption control                       | Stop aborts the stream and invalidates a pending cache lookup                    | A stopped cache lookup cannot silently start a paid generation later.              |
| Chunky repository toolbar                           | Thin input borders and quiet action controls                                     | Aligns the repository page with the loading experience.                            |

Connection status is evidence of server traffic, not a claim that the model has produced text. After 25 seconds without updates it reads **Waiting for updates**, pauses the activity treatment, and offers wait/stop guidance. This change does not alter model quality, reasoning settings, or token generation speed.

## Verification

- 506 tests across 75 files pass, including keep-alives before text, phase/source retention, cancellation races, preserved error context, escaped Markdown, scroll following, delayed rendering, and failed rendering.
- ESLint, TypeScript, formatting, production build, performance budgets, dependency audit, and unused-code checks are part of the release verification.
- React Doctor remains 90/100 with no bug diagnostics; remaining warnings concern component control-flow size.
- Browser review covers desktop, 390 px and 320 px layouts, light/dark, reduced motion, keyboard disclosure, missing updates, stop/retry, and real generation through rendered output.
- A real `mahadahmed25/devpulse-ai` regeneration completed with 22 components and 27 connections. Initial analysis remained visibly connected while waiting for model text.
