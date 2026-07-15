# 001 — Unify responsive control motion

- **Status**: DONE
- **Commit**: 3078b4b
- **Severity**: HIGH
- **Category**: Purpose, frequency, cohesion, accessibility
- **Estimated scope**: 4 files, small

## Problem

Shared controls use weak built-in easing and inconsistent motion. In
`src/styles/globals.css:123-170`, the three neo-brutalist control classes use
`transform 0.2s ease`, lift on every hover-capable selector, and have no press
or reduced-motion behavior. Frequent header navigation also moves upward in
`src/components/header-client.tsx:101-128` and
`src/components/theme-toggle.tsx:17`.

```css
/* src/styles/globals.css:128 — current */
transition:
  transform 0.2s ease,
  background-color 0.2s ease;
```

## Target

Add the shared curves to `:root`:

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
```

Use `transform 160ms var(--ease-out)` for control movement. Add a subtle
`scale(0.97)` press state. Put lift-on-hover behavior inside
`@media (hover: hover) and (pointer: fine)`. Frequent header navigation should
transition color only, not position. Under `prefers-reduced-motion: reduce`,
keep color/opacity feedback and remove transform movement.

## Repo conventions to follow

- Shared neo-brutalist component styles live in `src/styles/globals.css`.
- Generic button variants live in `src/components/ui/button.tsx`.
- Preserve the existing black offset shadows and purple palette.

## Steps

1. Add the three exact easing tokens to both themes through the shared `:root`.
2. Update neo control transition durations/easing and add press feedback.
3. Gate lift-on-hover styles behind fine hover pointers.
4. Remove upward hover transforms from frequent header and theme controls.
5. Add reduced-motion fallbacks that retain color/opacity feedback.

## Boundaries

- Do not change spacing, colors, borders, shadows, or markup.
- Do not add a motion library.
- Do not animate keyboard-triggered navigation.

## Verification

- **Mechanical**: `bun run check` and `bun run test` pass.
- **Feel check**: mouse press on a primary, muted, and browse button reads as a
  subtle compression; touch does not leave a lifted hover state; header links
  no longer hop vertically.
- Toggle reduced motion and confirm presses retain opacity/color feedback with
  no scale/translation.
- **Done when**: control motion uses shared tokens and no frequent nav item
  translates on hover.
