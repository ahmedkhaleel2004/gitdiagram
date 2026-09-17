# Generation preview

Run `bun run dev`, then open <http://localhost:3000/dev/generation>.
Use `?focus=1` for the quiet view; **Preview controls** reveals the simulator controls.

The fixtures use the production components without generation requests or credits. The page returns **404 outside development**. Remove this directory when the temporary preview is no longer needed.

## Design direction

The generation view follows the user's September 17 correction: soft colour, fluid motion, very little text, and no card or visible progress checklist. A small translucent form moves gently above one phase label. The repository name, elapsed time, and Cancel remain available. The repository form returns when generation ends.

The short phase labels follow actual server events. After 20 seconds with server activity the view says **Still working**. After 25 seconds without activity it says **Waiting for updates** and pauses the moving form. Local diagram rendering is not mistaken for a disconnected stream. No percentage, intermediate graph, or connection claim is invented.

Streamed prose stays off the generation canvas. The completed architecture overview remains available beside the finished diagram, and failed generations preserve their overview. Loading feedback remains visible until Mermaid reports a successful render.

Motion uses small transforms on the decorative shape, with no full-screen moving background. Phase labels and the completed result enter with short transitions. Reduced motion removes animation while keeping status and connection feedback. Light and dark colours are tuned separately; small text has a higher-contrast alternative.

## Review scenarios

Use **Scenario**, **Jump to**, and playback controls to inspect:

- Normal generation and the actual Mermaid result.
- A slow first response with healthy server keep-alives.
- Missing updates and recovery after a connection error.
- Automatic diagram refinement.
- Immediate Cancel and Try again.
- Light/dark, 320 px / 390 px screens, and reduced motion.

The Apple design skill informed the new direction. No component library or animation dependency was added, and the model/quality configuration is unchanged.
