# KITTI Motion System

## Springs (`src/ui/motion/springs.ts`)
All animation uses one of four presets — no ad-hoc durations anywhere:

| Preset  | stiffness | damping | mass | character            | cubic-bezier fallback     |
|---------|-----------|---------|------|----------------------|---------------------------|
| snappy  | 520       | 34      | 0.9  | crisp UI feedback    | (0.2, 0.9, 0.25, 1.15)    |
| smooth  | 300       | 30      | 1.0  | general purpose      | (0.3, 0.9, 0.3, 1.05)     |
| gentle  | 170       | 24      | 1.1  | large surfaces/arcs  | (0.35, 0.8, 0.4, 1.0)     |
| bouncy  | 380       | 18      | 0.9  | banners/celebration  | (0.3, 1.35, 0.4, 1.1)     |

`MS` holds the CSS-millisecond fallbacks. `REDUCED_DURATION = 0.08s` is used when reduced.

## MotionConfig (`src/ui/motion/MotionConfig.tsx`)
`<MotionConfigProvider>` flips the whole app between springs and near-instant fades. It activates
when `prefers-reduced-motion: reduce` matches, or when `matchMedia` is unavailable (tests/SSR — UI
tests therefore render with instant fades by design; they never depend on wall-clock animation).
Components consume `useReducedMotion()` and branch to `duration: 0.08` or the spring.
`<ThemeProvider>` is orthogonal (colors only).

## How to add an animation correctly
1. Pick a preset by character (snappy for press/hover, smooth for placement, gentle for big reveals,
   bouncy for banners). Import from `springs.ts` — never inline stiffness/damping.
2. Animate only `transform` and `opacity` (`filter` rarely, and prefer box-shadow removal).
3. Shared elements use framer-motion `layoutId` (one object across tray → slot → lock-in → reveal).
   Use `layout` + `AnimatePresence` for enter/exit and list re-spacing (`mode="popLayout"`).
4. Everything is interruptible: components animate *to* new state, never *from* stale state, and the
   store/engine remains the source of truth (`applyAction` results replace state; visuals catch up).
5. Buttons: spring press via `:active { transform: scale(.96) }`, hover light-sweep via `::after`
   skewed gradient, disabled state keeps legibility (see `.btn-gold:disabled`).
6. Banners use `AnimatePresence` + bouncy scale-in from the pot area. Confetti is decorative,
   `aria-hidden`, and respects reduced motion (it renders only in the salami case and uses opacity
   keyframes, never blocking).
7. Sound (`src/ui/sound.ts`) is off by default, persisted in `localStorage['kitti-sound']`, synthesized
   via Web Audio — no assets. Never gate state transitions on audio.

## Performance notes
- Cards are memoized SVG; `will-change` is not used globally.
- Backdrop blur was removed from large panels; card drop-shadows replaced with outline/box-shadow.
- `npm run perf` measures rAF deltas at 4x CPU throttle (see DESIGN_REVIEW.md numbers).
