# 004 — Make state changes legible without moving data

- **Status**: DONE
- **Commit**: 3078b4b
- **Severity**: HIGH
- **Category**: Purpose, performance, cohesion
- **Estimated scope**: 4 files, medium

## Problem

The export panel in `src/components/main-card.tsx:177-193` uses
`transition-all` while changing `max-height`, which animates layout. Its two
chevrons swap abruptly. Copy feedback in `src/components/copy-button.tsx:32-42`
teleports between labels and changes button width. Conversely, functional
Mermaid nodes scale on every hover in `src/components/mermaid-diagram.tsx:305-315`,
moving data the user is trying to inspect.

```tsx
className={`transition-all duration-200 ${
  activeDropdown ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
}`}
```

## Target

Delete the layout animation. Mount export content only while open and give it a
GPU-only `@starting-style` entrance from `opacity: 0; transform:
translateY(-4px) scale(0.99)` over `180ms var(--ease-out)`. Use one chevron and
rotate it `180deg` over `160ms var(--ease-in-out)` as state indication.

Keep both copy-button labels in the same grid cell so width is stable. Crossfade
them over `160ms var(--ease-out)` with at most `filter: blur(2px)` and a `2px`
vertical offset. Reduced motion keeps opacity and removes offset/blur. Announce
success through a polite live region.

Remove transform animation and hover scaling from clickable Mermaid nodes;
direct manipulation and readable graph geometry take priority.

Replace the generation status dots' positional bounce with a staggered opacity
pulse so loading still feels active without moving information.

## Repo conventions to follow

- Reuse existing Tailwind layout utilities and the shared easing tokens.
- Preserve existing copy, icons, callbacks, and export content.

## Steps

1. Replace the export wrapper and two-icon swap with a conditional GPU-only
   entrance and a single rotating chevron.
2. Make copy feedback width-stable and crossfade the two states in one grid.
3. Add a polite screen-reader success announcement.
4. Remove hover scale and transform transition from Mermaid's theme CSS.
5. Replace bouncing generation dots with staggered opacity pulses.
6. Add reduced-motion fallbacks for both new state transitions.

## Boundaries

- Do not animate the diagram, graph rows, pan/zoom, or route changes.
- Do not change export behavior or copy timeout.
- Do not animate height, width, margin, padding, top, or left.

## Verification

- **Mechanical**: `bun run check`, `bun run test`, and `bun run build` pass.
- **Feel check**: export appears without layout animation; rapid toggles never
  restart a keyframe. Copying keeps button geometry fixed and reads as one
  content morph. Hovering a Mermaid node does not move graph geometry.
- Toggle reduced motion and confirm only opacity/color feedback remains.
- **Done when**: no `transition-all` or animated graph scaling remains and state
  changes are legible without moving functional data.
