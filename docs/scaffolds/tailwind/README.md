# podZAP — Tailwind v4 Scaffold

CSS-first Tailwind v4 setup that replaces `podZAP/tokens.css`. No `tailwind.config.js` — everything lives in `globals.css` via `@theme inline` + `@utility` + `@layer components`.

## Install

```bash
npm install tailwindcss@next @tailwindcss/postcss
```

Then in your Next.js 15 `app/layout.tsx`:

```tsx
import "./globals.css";
```

`postcss.config.mjs` is already wired for the v4 plugin.

## What's in `globals.css`

- `@import "tailwindcss"` — replaces the v3 trio `@tailwind base/components/utilities`.
- Google Fonts import (Bricolage, Space Grotesk, JetBrains Mono, Archivo Black, Bungee, Fraunces).
- `@theme inline { }` — every token surfaced as a Tailwind key (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`).
- `:root` / `[data-theme="dark"]` / `[data-palette="neon|zap|retro"]` / `[data-font="..."]` — runtime variables for the semantic aliases.
- `@utility` blocks: `chunky-border`, `chunky-shadow`, `chunky-shadow-lg`, `sprinkle`.
- `@layer components`: `.sticker` (+ `.sticker-pink`, `-purple`, `-yellow`, `-zap`), `.btn` (+ `.btn-pink`, `-purple`, `-yellow`, `-zap`, `-ghost`), `.card`, `.live-dot`, `.marquee-track`.
- Keyframes: `marquee`, `wave`, `wiggle`, `pulse-dot`.

## Usage

Utility classes auto-generated from `@theme`:

```tsx
<div className="bg-purple-600 text-paper rounded-md shadow-chunk chunky-border">
  Biscoito energy
</div>

<h1 className="font-display text-ink-900">podZAP</h1>

<span className="bg-accent text-text-inv">Semantic accent</span>
```

Component classes:

```tsx
<button className="btn btn-pink">Ouvir episódio</button>
<span className="sticker sticker-zap">AO VIVO</span>
<article className="card p-6">...</article>
<div className="live-dot" />
<div className="marquee-track">...</div>
<div className="sprinkle h-40">...</div>
```

Theme / palette swapping (drive from a toggle):

```tsx
<html data-theme="dark" data-palette="neon" data-font="bungee">
```

## Migration notes — what changed from `tokens.css`

**Mapped cleanly (Tailwind exposes them as utilities automatically):**

| Old token              | New Tailwind key          | Utility example                |
| ---------------------- | ------------------------- | ------------------------------ |
| `--purple-600`         | `--color-purple-600`      | `bg-purple-600`                |
| `--pink-500`           | `--color-pink-500`        | `text-pink-500`                |
| `--lime-500` etc.      | `--color-lime-500`        | `bg-lime-500`                  |
| `--ink-900`            | `--color-ink-900`         | `text-ink-900`                 |
| `--paper`, `--paper-2` | `--color-paper[-2]`       | `bg-paper`                     |
| `--r-sm` 10px          | `--radius-sm`             | `rounded-sm`                   |
| `--r-md` 16px          | `--radius-md`             | `rounded-md`                   |
| `--r-lg` 24px          | `--radius-lg`             | `rounded-lg`                   |
| `--r-xl` 32px          | `--radius-xl`             | `rounded-xl`                   |
| `--r-pill` 999px       | `--radius-pill`           | `rounded-pill`                 |
| `--shadow-chunk[-lg]`  | `--shadow-chunk[-lg]`     | `shadow-chunk`, `shadow-chunk-lg` |
| `--shadow-soft`        | `--shadow-soft`           | `shadow-soft`                  |
| `--shadow-glow-lime`   | `--shadow-glow-lime`      | `shadow-glow-lime`             |
| `--shadow-glow-pink`   | `--shadow-glow-pink`      | `shadow-glow-pink`             |
| `--font-display` etc.  | `--font-display/body/mono/brand` | `font-display`, `font-brand` |

**Needed adaptation:**

- **Radius keys renamed** from Tailwind's `sm/md/lg/xl` scale to match the token values exactly (10/16/24/32 px). Note: Tailwind's built-in `sm` is `0.125rem` — this scaffold overrides it with our 10px. If you want Tailwind's defaults side-by-side, rename to `--radius-podzap-sm` etc.
- **Semantic aliases** (`--color-bg`, `--color-accent`, `--color-stroke`, …) are declared in `@theme inline` but point to runtime CSS vars (`--bg`, `--accent`, `--stroke`) declared in `:root`/`[data-theme]`/`[data-palette]`. This is what lets `bg-accent` swap when you toggle palette — `inline` keeps the variable reference live instead of inlining its value at build time.
- **Component variant selectors flattened**: `.sticker.pink` became `.sticker-pink` (ditto `.btn.pink` → `.btn-pink`). Chained class selectors inside `@layer components` can conflict with Tailwind's own variant prefix parsing, and the dash convention is what Tailwind's own component examples use. JSX changes from `className="sticker pink"` → `className="sticker sticker-pink"`.
- **Component colors hardcoded** inside `.btn` / `.sticker` (hex values, not `var(--purple-600)`). In v4 the old `--purple-600` variable doesn't exist at runtime — only `--color-purple-600` does (inside `@theme`), and those aren't accessible in `@layer components` as bare vars. Hardcoding the hex keeps the exact palette with no behavioral change.
- **Shadow fallbacks**: component `box-shadow` uses `var(--shadow-chunk, 4px 4px 0 var(--stroke))` as a safety net — the runtime `--shadow-chunk` is only defined inside `[data-theme="dark"]` in the original CSS (the light-theme value was only in `@theme`, which doesn't apply at runtime). The fallback makes light mode render correctly.

**Uncertain / worth a second look:**

- `--color-line: rgba(0,0,0,0.08)` exposes as `border-line` / `bg-line`. Works, but Tailwind may not always play nice with `rgba()` tokens in every utility (e.g. opacity modifiers like `bg-line/50` won't compose as expected). Treat it as a fixed tint.
- `overflow: hidden` on `body` is preserved from the original — this is a full-viewport app pattern. If you ever mount a scrolling page, remove it.
- `body { overflow: hidden }` + `-webkit-font-smoothing` are in base styles, not a `@layer base` block, so they win by source order. Move them into `@layer base { }` if you need Tailwind's preflight to override them.

## Preserved verbatim

- All 6 purple shades, 4 pink, 3 lime, 2 yellow, teal, red, 2 zap, 5 ink, 2 paper — exact hex values.
- `[data-theme="dark"]` override block.
- `[data-palette="neon"]`, `[data-palette="zap"]`, `[data-palette="retro"]` — all three.
- `[data-font="bricolage|bungee|fraunces|archivo"]` swap.
- Keyframes `marquee`, `wave`, `wiggle`, `pulse-dot` and `.live-dot`, `.marquee-track`, `.sprinkle`.
