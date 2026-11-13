# KITTI Design System

## Themes
Two palettes are defined **once** in `src/ui/theme/tokens.ts` and emitted as CSS custom properties
under `[data-theme='evening']` (default, deep emerald + walnut + brass on dark warm charcoal) and
`[data-theme='daylight']` (sunlit felt on warm paper). `ThemeProvider` (`src/ui/theme/useTheme.tsx`)
applies `data-theme` to `<html>`, persists the choice to `localStorage['kitti-theme']`, and updates
`<meta name="theme-color">`. **Add a theme** by: (1) adding an entry to `ThemeTokens` in tokens.ts,
(2) adding a `[data-theme='name']` block in `src/ui/index.css` with the same custom properties,
(3) extending `ThemeName`. No component references a raw color — always `var(--token)`.

## Tokens (CSS custom properties, see `:root` + theme blocks)
Background layers (`--background`, `--background-soft`), felt (`--felt`, `--felt-deep`, `--felt-light`),
rail (`--rail`, `--rail-light`, `--brass`), accents (`--gold`, `--gold-soft`, `--vermilion`,
`--vermilion-soft`), text (`--cream`, `--cream-dim`, `--ink`), panels (`--panel`, `--panel-border`),
status (`--good`, `--warn`), and strength tiers (`--tier-trail` … `--tier-high-card`).
Spacing/type are fluid: `--s1..--s4` and `.topbar h1` etc. use `clamp()`. Cards scale from one
variable: `--card-w` (phone ≈ 2.5rem → desktop 4.4rem), `--card-w-sm`, `--card-w-mini`.

## Card component API (`src/ui/DeckCard.tsx`)
`<DeckCard card={{rank, suit}} fourColor? className? />` — memoized SVG, 100×140 viewBox,
generated entirely from data: ranks 2–14 (A-K-Q-J + A), four suits with original pip geometry,
A = radiating suit medallion, court cards = original geometric emblems (J lance-star, Q lotus,
K crown-over-sun) drawn from primitives, ace = bold ringed pip. Corner indices top-left and
rotated bottom-right, "Fraunces" serif. `<DeckCardBack />` is the original mandala (emerald field,
brass ring, 16 petals, centre star). `<CardSlotEmpty>` is the felt-inset empty drop zone.
`<CardFace>`/`<CardBack>` (CardView.tsx) read the four-color toggle from `localStorage['kitti-four-color']`.
Four-color deck: spades ink, hearts crimson, diamonds blue, clubs green.

## Avatars (`src/ui/Avatar.tsx`)
Original generated SVG per personality: safe = ward-shield & check, aggressive = flame heart,
balanced = scales, unpredictable = bolt. Persona hue on a radial disc with jali dot ring.

## Conventions
- Strength-tier badges (`t-trail … t-high`) color hand names by category via `--tier-*`.
- The pot uses tabular numerals and a log-scaled chip stack (red/green/blue chips).
- Focus-visible gold ring on every interactive element; `prefers-reduced-motion` flattens animation
  durations to ≤120 ms (and the MotionConfig provider does the same for framer-motion).
