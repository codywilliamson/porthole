# porthole design system

Concept: **the instrument panel of a deep-sea porthole.** Ink-dark glass over a slow
shader current, brass/amber telemetry glow, monospace readouts. Calm, slow, legible.
Everything should feel like a well-machined instrument — never like a generic dashboard.

Tokens live in `web/src/style.css` and are the single source of truth. This file explains
how to use them. If a value isn't a token, it probably shouldn't exist.

## color

| role | token | value | use |
|---|---|---|---|
| void | `--bg-0` | `#05080a` | page/behind-shader, theme-color, manifest bg |
| shell | `--bg-1` | `#0a1013` | app shell panels |
| raised | `--bg-2` | `#101a1e` | cards, rows |
| glass | `--glass` / `--glass-strong` | rgba | translucent panels over the shader |
| ink | `--ink-1/2/3` | light → dim | text hierarchy; `--ink-3` for chrome/meta |
| accent | `--accent` (+`-strong/-ink/-dim/-line`) | `#ffb454` amber | the ONE accent: active state, primary action, live signal |
| secondary | `--teal` / `--teal-dim` | `#4fd6c4` | bioluminescence — sparingly, decorative/secondary signal only |
| danger | `--danger` (+`-dim/-line`) | `#ff6b5f` | errors only |

Rules:
- Amber means "alive / act here". Never use it decoratively.
- Teal never competes with amber in the same component.
- No pure white, no pure black. Ink and void tokens only.

## depth

Border-defined, not shadow-defined. Layering comes from background steps
(`bg-0 → bg-1 → bg-2`) plus 1px lines (`--line`, `--line-strong`) and the glass
rgba panels over the shader. No drop shadows on cards. The shader + scrim provide
ambient depth; UI floats on it as glass.

## type

- `--font-mono` for readouts: titles, session names, paths, badges, code, meta.
- `--font-sans` for prose (markdown transcript content).
- Scale: `--text-xs` 12 → `--text-xl` 26. Inputs must be ≥16px (`--text-md`) or iOS zooms.

## radius & spacing

- `--radius-sm` 6 (badges, small buttons) · `--radius-md` 12 (cards, rows, bubbles)
  · `--radius-lg` 20 (sheets, FAB) · `--radius-pill` (pills, dots).
- Spacing on the `--space-1..7` scale (4/8/12/16/24/32/48). No magic pixel values.

## motion

Calm and quick — the sea moves slowly, the instruments respond instantly.

- Transform/opacity only (compositor-friendly). Never animate layout on big DOM.
- Easing: `--ease-out` (`cubic-bezier(0.16, 1, 0.3, 1)`) for entrances; plain `ease` for fades.
- Durations: micro-feedback 0.1–0.15s · element enter/leave 0.15–0.25s · ambient (glow,
  shader fade-in) 0.5–1s. Nothing between 0.3s and 0.5s — either instant-feeling or ambient.
- Every enter has a matching leave. No mount-only keyframes that close with a pop.
- Every animation respects `prefers-reduced-motion` (transforms off, quick fade allowed).
- Lists use `<TransitionGroup>` with move transitions; bulk inserts suppress enter
  animation (see `TranscriptView`'s `no-enter-anim`).

## touch (iOS home-screen app)

- Tap targets ≥44px. `:active` state on everything tappable (scale ~0.97 or bg step) —
  there is no hover on this device; never rely on `:hover`.
- `-webkit-tap-highlight-color: transparent` globally; UI chrome is `user-select: none`,
  transcript content stays selectable.
- Scrollers get `overscroll-behavior: contain` + `touch-action: pan-y`.
- Safe areas via `--safe-*` tokens on every screen edge surface.

## iconography

Inline SVG only — stroke style, `stroke-width: 2` at 24px grid, round caps/joins,
`currentColor`. No emoji, no unicode glyphs as icons (they render as colored emoji on
iOS and break the palette). Status must not rely on color alone — pair dots with text.

## loading

Skeletons, not spinners (exception: the small refresh-icon spin, which is feedback on a
button, not a wait state). Skeleton blocks mimic the real row geometry so content lands
without layout shift, with a slow shimmer in `--bg-2`/`--line` tones. Stale-while-
revalidate everywhere: show cached data instantly, refresh silently.

## voice

Interface copy is lowercase, terse, nautical-instrument flavored where it's free
("scanning for sessions…", "reception lost"). Never cute at the expense of clarity.
