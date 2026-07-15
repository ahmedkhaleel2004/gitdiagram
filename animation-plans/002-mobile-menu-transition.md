# 002 — Give the mobile menu a spatial transition

- **Status**: DONE
- **Commit**: 3078b4b
- **Severity**: MEDIUM
- **Category**: Missed opportunity, physicality, interruptibility
- **Estimated scope**: 2 files, medium

## Problem

The occasional mobile menu is conditionally mounted in
`src/components/header-client.tsx:143-209`, so both the backdrop and panel
teleport in and out with no spatial connection to the Menu trigger.

```tsx
{isMobileMenuOpen ? (
  <>
    <button className="fixed inset-0 z-40 bg-black/30 sm:hidden" />
    <div className="pointer-events-none fixed inset-x-4 top-[4.5rem] ...">
```

## Target

Keep the layer mounted with `data-state="open|closed"`. Fade the backdrop in
over `180ms` and out over `140ms`. Transition the panel from
`opacity: 0; transform: translateY(-8px) scale(0.97)` to its settled state over
`200ms var(--ease-out)`, and close over `140ms var(--ease-out)`. Set
`transform-origin: top right`. Delay hidden visibility until the exit finishes
so the transition is interruptible. Closed content must be inert and removed
from the accessibility tree.

## Repo conventions to follow

- Reuse `.neo-panel` and `.browse-muted-button` without restyling them.
- Reuse `--ease-out` from plan 001.

## Steps

1. Render the mobile menu layer unconditionally with open/closed data state.
2. Make the closed menu inert, aria-hidden, non-interactive, and invisible
   after its exit completes.
3. Add scoped backdrop/panel transitions in `src/styles/globals.css`.
4. Under reduced motion, keep a short opacity fade and remove transform motion.

## Boundaries

- Do not animate individual menu rows or the icon swap.
- Do not change menu contents, stacking order, or responsive breakpoints.
- Do not add a dependency.

## Verification

- **Mechanical**: `bun run check` and header tests pass.
- **Feel check**: at 390x844, open and rapidly close/reopen the menu. It should
  retarget smoothly from its current state and clearly originate below the
  trigger. At 10% playback, no frame should jump from or to `scale(0)`.
- Toggle reduced motion: the backdrop/panel may fade, but must not translate or
  scale.
- **Done when**: the menu has symmetric spatial direction, faster exit, and no
  closed-state focus targets.
