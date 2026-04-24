# Tokens CSS — podZAP

Tokens consumidos pelos componentes em `components/`. Todos vivem em `app/globals.css` (portados de `podZAP/tokens.css`) e são expostos de duas formas:

- `--color-*` / `--radius-*` / `--font-*` / `--shadow-*` via `@theme inline { }` — geram utilities Tailwind v4 automáticas (`bg-purple-600`, `rounded-md`, `shadow-chunk`, `font-display`).
- `--purple-600`, `--r-md`, etc. como aliases "crus" no `:root` — compatibilidade com os mockups JSX em `podZAP/*.jsx` que usam essa forma.

Sempre que possível, os componentes usam as versões **semânticas** (`--stroke`, `--surface`, `--accent`, `--text`) que flipam com `[data-theme="dark"]` automaticamente. As rotas `(app)` rodam com dark theme; landing/login rodam light.

---

## 1. Cores — scales

### Purple (brand principal)

| Nome | Valor | Uso |
|---|---|---|
| `--color-purple-900` / `--purple-900` | `#1B0B3A` | Textos/blocks muito escuros sobre fundo claro (raro). |
| `--color-purple-800` / `--purple-800` | `#2A0F5C` | — |
| `--color-purple-700` / `--purple-700` | `#4318D1` | Hover de `--purple-600`. |
| `--color-purple-600` / `--purple-600` | `#5B2BE8` | **Accent primário**. Active nav, primary button, brand logo block. Resolve como `--accent` no tema light. |
| `--color-purple-500` / `--purple-500` | `#7A3CFF` | Accent secundário (`--accent-3` no tema dark). |
| `--color-purple-400` / `--purple-400` | `#A97BFF` | — |

### Pink (accent-2)

| Nome | Valor | Uso |
|---|---|---|
| `--color-pink-600` / `--pink-600` | `#E6278E` | Pink mais saturado (hover). |
| `--color-pink-500` / `--pink-500` | `#FF3DA5` | **Badge de contagem, `PlayerWave` progresso, brand admin, stickers**. `--accent-2` em light e dark. |
| `--color-pink-400` / `--pink-400` | `#FF7AC6` | — |
| `--color-pink-300` / `--pink-300` | `#FFB4DC` | — |

### Lime (accent-3)

| Nome | Valor | Uso |
|---|---|---|
| `--color-lime-500` / `--lime-500` | `#C6FF3C` | **Plan card (sidebar), StatCard accent**. `--accent-3` em light; `--accent` no palette "neon". |
| `--color-lime-400` / `--lime-400` | `#D8FF66` | — |
| `--color-lime-300` / `--lime-300` | `#E9FF9E` | — |

### Yellow

| Nome | Valor | Uso |
|---|---|---|
| `--color-yellow-500` / `--yellow-500` | `#FFC828` | **MicMascot body, StatCard yellow, TopBar accent blob**. |
| `--color-yellow-400` / `--yellow-400` | `#FFDA5E` | — |

### Zap (verde WhatsApp)

| Nome | Valor | Uso |
|---|---|---|
| `--color-zap-500` / `--zap-500` | `#22C55E` | Dot de status "WhatsApp conectado", button variant `zap`. |
| `--color-zap-400` / `--zap-400` | `#4ADE80` | — |

### Teal / Red

| Nome | Valor | Uso |
|---|---|---|
| `--color-teal-500` / `--teal-500` | `#1DE9B6` | PodCover variant 5; palette retro accent-3. |
| `--color-red-500` / `--red-500` | `#FF4D3C` | Estado erro; palette retro accent. |

### Ink (escala escura neutra)

| Nome | Valor | Uso |
|---|---|---|
| `--color-ink-900` / `--ink-900` | `#0A0420` | Texto light mode (`--text`), stroke light, fundo PodCover. |
| `--color-ink-800` / `--ink-800` | `#140B2E` | MicMascot stand. |
| `--color-ink-700` / `--ink-700` | `#1E1342` | — |
| `--color-ink-600` / `--ink-600` | `#2B1F52` | — |
| `--color-ink-500` / `--ink-500` | `#443669` | `PlayerWave` barras não-tocadas. |

### Paper (escala clara neutra)

| Nome | Valor | Uso |
|---|---|---|
| `--color-paper` / `--paper` | `#FFFBF2` | `--bg` em light; `--text` em dark. |
| `--color-paper-2` / `--paper-2` | `#F7F1E3` | `--bg-2` em light. |
| `--color-line` | `rgba(0,0,0,0.08)` | Dividers sutis. |

---

## 2. Cores — semânticas (flipam com tema)

Resolvem valores diferentes em `:root` (light) vs `[data-theme="dark"]` vs `[data-palette=...]`.

| Nome | Light | Dark | Uso |
|---|---|---|---|
| `--bg` | `#FFFBF2` | `#08030F` | Fundo da página. |
| `--bg-2` | `#F7F1E3` | `#110725` | Fundo secundário (hover de nav, base de surface-2). |
| `--surface` | `#ffffff` | `#180A30` | Card, sidebar, topbar. |
| `--surface-2` | `#FFF7E6` | `#221048` | Account chip, áreas de destaque internas. |
| `--text` | `#0A0420` | `#FFFBF2` | Texto primário. |
| `--text-dim` | `#5A4D7A` | `#B4A8D1` | Texto secundário, labels mono/uppercase. |
| `--text-inv` | `#FFFBF2` | `#0A0420` | Texto sobre accent sólido (ex.: `RadioPill` selecionado). |
| `--accent` | `#5B2BE8` (purple-600) | herda light | Accent primário (overridden por `[data-palette=*]`). |
| `--accent-2` | `#FF3DA5` (pink-500) | herda light | Accent secundário. |
| `--accent-3` | `#C6FF3C` (lime-500) | herda light | Accent terciário. |
| `--stroke` | `#0A0420` | `#000000` | Bordas chunky (2.5px) de todos os primitives. |

**Paletas** ativam via `data-palette="neon|zap|retro"` no `<html>` e reescrevem `--accent*`. O tema dark é ativado via `data-theme="dark"` no wrapper `(app)`.

---

## 3. Tipografia

| Nome | Valor | Uso |
|---|---|---|
| `--font-display` | `'Bricolage Grotesque'` | Títulos oversize (`TopBar` h1, `Modal` title, `StatCard` value). Alternativas via `data-font=bungee\|fraunces\|archivo`. |
| `--font-body` | `'Space Grotesk'` | Texto corrido, labels de botão, nav. Default do `body`. |
| `--font-mono` | `'JetBrains Mono'` | Eyebrows uppercase, datas em PodCover, label do `StatCard`. |
| `--font-brand` | `'Archivo Black'` | Logo "podZAP" / "superadmin" nos sidebars, iniciais no account chip. |
| `--font-sans` | alias pra `--font-body` | Default Tailwind. |

---

## 4. Radii

| Nome | Valor | Uso |
|---|---|---|
| `--radius-sm` / `--r-sm` | `10px` | — |
| `--radius-md` / `--r-md` | `16px` | **Default** — Cards, StatCard, account chip, nav buttons. |
| `--radius-lg` / `--r-lg` | `24px` | Modal. |
| `--radius-xl` / `--r-xl` | `32px` | Hero / elementos grandes. |
| `--radius-pill` / `--r-pill` | `999px` | Button, RadioPill, Select, Sticker. |

---

## 5. Shadows

| Nome | Valor | Uso |
|---|---|---|
| `--shadow-chunk` | `4px 4px 0 var(--stroke)` (light) / `4px 4px 0 #000` (dark) | **Default chunky** — Card, Button, StatCard, active NavButton. |
| `--shadow-chunk-lg` | `8px 8px 0 var(--stroke)` / `8px 8px 0 #000` | Modal, elementos oversize. |
| `--shadow-soft` | `0 10px 30px rgba(10,4,32,0.12)` | Ambient/flutuante (usado esparsamente). |
| `--shadow-glow-lime` | `0 0 40px rgba(198,255,60,0.4)` | Ambient lime (hero). |
| `--shadow-glow-pink` | `0 0 40px rgba(255,61,165,0.35)` | Ambient pink. |

> **Convenção:** border sempre 2.5px, shadow sempre offset sólido de `--stroke` (4px padrão, 8px "lg"). Hover mexe em 1px (translate -1/-1 + shadow 5/5); active em 2px (translate 2/2 + shadow 2/2).

---

## 6. Spacing

Não existem tokens de spacing customizados — usar os defaults Tailwind (`p-2`, `gap-4`, etc.) ou valores inline em pixels (vários componentes fazem `padding: 16` / `gap: 12`).

Valores recorrentes nos mockups portados:

| Contexto | Valor |
|---|---|
| Padding interno Card | `16–22px` |
| Gap em grid de stats | `10–14px` |
| Padding NavButton | `10px 12px` |
| Border chunky | `2.5px` (primitives) / `2px` (elementos menores) |

---

## 7. Outras variáveis

### Brand cards (usado em PodCover)

| Nome | Valor (light) | Uso |
|---|---|---|
| `--brand-card-1` | `#5B2BE8` | Variant 0/3. |
| `--brand-card-2` | `#FF3DA5` | Variant 1. |
| `--brand-card-3` | `#FFC828` | Variant 2. |
| `--brand-card-4` | `#C6FF3C` | Variant 4. |

### Animation keyframes (em `globals.css`)

- `@keyframes wave` — consumido por `Waveform` (pulsação).
- `@keyframes wiggle` — consumido por `MicMascot` (balanço).
- `@keyframes blob-drift-a|b|c` — consumido pelos `login-blob--*`.
- `.live-dot` — pulse dot usado em `Sidebar` (status "connecting").

---

## Regras

1. **Não invente tokens novos.** Se precisa de uma cor nova, adicione-a a `globals.css` com o nome seguindo as convenções acima (`--<nome>-<escala>` ou `--<semantico>`).
2. **Prefira semânticos** (`--accent`, `--stroke`, `--surface`) sobre raw scales quando o componente deve responder a theme/palette.
3. **Mantenha paridade light/dark.** Se o componente tem estilo inline e usa `#hexcolor` literal, considere substituir por um token — testar em ambos os temas.
4. **Border + shadow chunky é identidade.** Não suavize. 2.5px stroke + 4px offset shadow é o padrão — desviar só quando o contexto pede (Modal usa 2.5 + 8).
