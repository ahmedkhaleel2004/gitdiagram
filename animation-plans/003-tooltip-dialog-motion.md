# 003 — Tighten tooltip and dialog motion

- **Status**: DONE
- **Commit**: 3078b4b
- **Severity**: MEDIUM
- **Category**: Easing, duration, origin, accessibility
- **Estimated scope**: 5 files, medium

## Problem

`src/components/ui/tooltip.tsx:23-26` animates every tooltip for `300ms` with
generic keyframes and no trigger-aware transform origin. Each consumer creates
its own provider (`src/components/action-button.tsx:25-45` and
`src/components/copy-button.tsx:25-53`), so adjacent tooltips cannot use Radix's
instant-open state. Dialogs also use the same `300ms` timing for open and close
in `src/components/ui/dialog.tsx:20-38` and have no reduced-motion branch.

## Target

Wrap the app once with `TooltipProvider delayDuration={500}` and
`skipDelayDuration={300}`. Tooltips use
`transform-origin: var(--radix-tooltip-content-transform-origin)`, enter from
`scale(0.97)` + opacity over `150ms var(--ease-out)`, exit over `100ms`, and set
transition duration to zero for `data-state="instant-open"`. Reduced motion
drops scale but retains opacity.

Dialog content opens over `220ms var(--ease-out)` and closes over `160ms`; the
overlay uses `180ms` open / `140ms` close. Reduced motion keeps fade but removes
zoom. Modals remain center-origin.

## Repo conventions to follow

- Provider composition lives in `src/app/providers.tsx`.
- Radix UI wrappers live under `src/components/ui/`.
- Reuse `--ease-out` from plan 001.

## Steps

1. Add one app-level tooltip provider with Radix delay props.
2. Remove nested providers from the two tooltip consumers.
3. Replace tooltip animation utility classes with a scoped, origin-aware CSS
   transition using `@starting-style` for mount entry.
4. Tighten dialog open/close durations and add reduced-motion zoom overrides.

## Boundaries

- Do not change tooltip copy, placement, collision logic, or modal layout.
- Do not use `scale(0)`.
- Do not animate layout properties.

## Verification

- **Mechanical**: `bun run check` and `bun run test` pass.
- **Feel check**: first tooltip waits, then appears in under 200ms from its
  trigger; moving to the adjacent tooltip opens instantly without replaying the
  animation. Dialog close is visibly faster than open.
- Inspect at 10% playback and confirm tooltip origin follows its trigger.
- Toggle reduced motion and confirm only opacity changes.
- **Done when**: small popovers are fast, origin-aware, shared, and accessible.
