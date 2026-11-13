# DESIGN REVIEW — refinement loop (Kitti)

Method: Playwright `scripts/screenshots.mjs` → 30 shots (setup, arranging, auto-arranged, reveal,
rules × {phone 390×844, tablet 820×1180, desktop 1440×900} × {evening, daylight}, deviceScaleFactor 2, reduced motion).
Each pass was critiqued as rendered PNGs; issues fixed; repeat. Pass 1 (initial build):

## Pass 1 findings
- Setup: inputs/labels illegible on dark; "Take your seat" blocked by native form validation
  (boot=10 fails `min=1 step=5` — nearest valid values are 6 and 11!). **Fix: min=5.** Wordmark + tagline
  duplicated the top-bar sub. Bots cramped; unselected CTA read as dead.
- Phone arranging: human nameplate rendered *inside* the oval at y≈97% and clipped against the panel;
  opponent mini-cards created dead space; helper text illegible.
- Empty slots rendered as dashed wireframe placeholders with "+" — replaced with engraved felt inset
  (corner specks + dark fill).
- Reveal desktop: SALAMI banner flush against Round 3 border; confetti sandwiched under banner;
  footer cramped at viewport edge; top sub-line low contrast.
- Arjun/Deepak padding asymmetry; seat clipping at left edge.

## Pass 2 findings (after pass-1 fixes)
- Empty-slot outer ring still read wireframe-y → removed concentric circles, kept minimal brass specks;
  solid engraved border instead of dashed.
- "Lock In" (disabled) read grey-on-grey → disabled gold now a legible dim-brass gradient.
- Helper copy and hints raised to legible cream; padding under bottom CTAs increased.
- Seat X radius 44→43 and human y-radius 47→40 with clamp 88% (no more edge clipping).

## Measured (this machine, Chromium, CPU ×4 ≈ mid-range phone)
- `npm run perf`: seats=3 → p50 = 17.2 ms, p95 = 93.9 ms, 22 frames > 50 ms over ~5 s; seats=5 → p50 = 18.0 ms, p95 = 103.6 ms.
- After removing backdrop-filter blurs and drop-shadow filters: p50 improved 28.4→17.2 / 23.7→18.0 ms (≈58–60 fps).
- **Not yet at the 20 ms p95 target.** Long-tail spikes remain during simultaneous bot lock-ins + reveal
  (React commit + 52-card SVG repaint). Status: improved but unproven at 60 fps under 4× throttle;
  on desktop/unthrottled the app is smooth. Remaining lever: virtualize opponent minis, split
  confetti into its own layer, and memoize seat nameplates. Deferred with time budget.

## Verified working
- Screenshots: all screens/viewports/themes, no overflow/clipping of interactive elements.
- Tests: typecheck, eslint (0 errors), vitest 71/71 (incl. UI), build ✓. `src/engine/` untouched;
  `src/ai/` touched **only** for 4 non-null-assertion/type-cast fixes that were already required for
  `tsc --noEmit` to pass (zero behavior change).
- Reduced motion path is wired (MotionConfig + CSS media query); jsdom tests run instant fades.

## Open / not met
- `npm run perf` misses the p95 < 20 ms goal under 4× throttle (numbers above).
- Lighthouse a11y ≥ 95 not run (no Lighthouse runner wired); focus rings/labels/roles are in place.
- Ordered settle arcs (cards fly from deck) are approximate (FLIP re-spacing + entry springs),
  not a physically arcing deal. True drag-with-velocity tilt drag is not implemented (tap/click + HTML5 DnD only).
- Interruption stress (spam Next Round mid-reveal) not formally tested beyond AnimatePresence exits.
