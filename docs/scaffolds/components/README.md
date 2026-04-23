# podZAP component scaffolds

TypeScript conversion of the JSX mockups in `podZAP/shell.jsx` and
`podZAP/components.jsx`. Landing spot for components that will move into the
real Next.js 15 App Router tree.

## Files

### `shell/`
- `shell/Sidebar.tsx` — left rail (logo, two nav groups, usage card). Imports
  `NavButton`, `Icons`, `Button`, `Sticker`. `'use client'`.
- `shell/TopBar.tsx` — page header with title, subtitle, breadcrumb, accent
  blob, action slot. Server component.
- `shell/NavButton.tsx` — individual sidebar row. Handles hover/active
  styling. `'use client'` (uses `onMouseEnter`/`onMouseLeave`).

### `icons/`
- `icons/Icons.tsx` — exports the `Icons` object (`Icons.Home`, `Icons.Play`,
  …). Each icon is typed `(props: SVGProps<SVGSVGElement>) => JSX.Element` so
  `width`, `height`, `style`, `className`, etc. all work. Replaces the legacy
  `Ico.*` global.

### `ui/`
- `ui/Button.tsx` — `<button class="btn [variant]">` wrapper. Variants:
  `purple | pink | lime | yellow | zap | ghost | default`.
- `ui/Sticker.tsx` — `<span class="sticker [variant]">` wrapper.
- `ui/Card.tsx` — `<div class="card [modifier]">` wrapper with optional
  `padding` prop.

## Conversion notes

- **`window` globals removed.** `Object.assign(window, { Sidebar, ... })`
  becomes named ES exports. Default exports added where the file has a single
  obvious export.
- **`Ico` → `Icons`.** Same access shape (`Icons.Home`), but typed as
  `Record<string, IconComponent>` and each icon accepts `SVGProps`.
- **`'use client'` boundaries.** Added only where interactivity exists:
  `Sidebar` (passes `onNav`), `NavButton` (hover + click). `TopBar` stays as
  a server component — no event handlers or state.
- **Inline styles preserved.** CSS-variable-based inline styles were left as
  they are; tailwindification is a later pass.
- **Awkward to type:** `NavButton` in the source reads
  `onMouseEnter={e => { if (!active) e.currentTarget.style.background = '...'; }}`.
  The `e.currentTarget` mutation works fine, but the function stack uses the
  `active` prop from the closure, which will only reflect the value at the
  time of the last render — for this file it's benign (render-on-change works
  correctly), but worth noting if the hover animation is ever promoted to
  `useState`/`useRef`.
- **Source JSX bug preserved as a fix.** `shell.jsx` had `border:` listed
  twice inside the same style object; the second declaration always wins in
  JS object literals. The TS port keeps only the intended (second) one.
- **`badge` truthiness.** Source `{badge && ...}` would render the number `0`
  literally; the TS port guards with `badge !== undefined && badge > 0`.
- **`Sidebar.current` / `onNav`** are now typed against a `NavId` union
  exported from `Sidebar.tsx`, so screens and routing share the same type.

## Deliberately not in scope

- Screen files (`screen_home.jsx`, `screen_approval.jsx`, etc.) — next pass.
- `MicMascot`, `Waveform`, `PlayerWave`, `PodCover`, `Confetti` — live in
  `components.jsx` too but are used by the screens, not the shell. They
  should be ported as part of the same PR as the screens that consume them,
  because the exact prop surface (e.g. `mood` union, `variant` index) is
  easiest to validate alongside a real call site.
- `globals.css` / `tokens.css` — owned by a separate agent. `.btn`,
  `.sticker`, `.card`, `.live-dot`, `.sprinkle` and CSS custom properties are
  assumed to exist at runtime.

## Recommended next conversion target

**`screen_onboarding.jsx`** should be ported first. Rationale:
1. It only uses shell primitives that are now scaffolded (`Sticker`,
   `Button`) plus simple layout — no `PodCover`, no `Waveform`, no
   `PlayerWave`.
2. It's a linear stepper with `useState`, so it's a good test of the
   `'use client'` boundary and prop typing without the combinatorial surface
   of the home/approval screens.
3. It exercises every `Sticker` variant token we introduced.

After that: `screen_groups.jsx` (lists + `PodCover` — one new shared
component to type), then `screen_history_schedule.jsx`,
`screen_approval.jsx`, and finally `screen_home.jsx` (most complex — player,
waveform, multiple cards).
