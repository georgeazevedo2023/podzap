# UI Components — podZAP

Catálogo consolidado dos componentes reutilizáveis em `components/`. Fonte da verdade visual dos mockups: `podZAP/*.jsx` (não portar variantes ad-hoc — reaproveite os primitives abaixo).

Todos os paths citados são absolutos a partir do repo root.

> Tokens CSS usados por estes componentes vivem em `app/globals.css` — ver [`tokens.md`](./tokens.md).

## Índice

- [Display](#display)
  - [Sticker](#sticker) · [StatCard](#statcard) · [PodCover](#podcover) · [MicMascot](#micmascot) · [Waveform](#waveform) · [PlayerWave](#playerwave)
- [Controls](#controls)
  - [Button](#button) · [Select](#select) · [RadioPill](#radiopill)
- [Structural](#structural)
  - [Card](#card) · [Modal](#modal) · [TopBar](#topbar) · [NavButton](#navbutton) · [Sidebar](#sidebar) · [AppSidebar](#appsidebar) · [AdminSidebar](#adminsidebar)
- [Assets](#assets)
  - [Icons](#icons)

---

## Display

### Sticker

- **Path:** `components/ui/Sticker.tsx`
- **Propósito:** pequeno pill de destaque (rotacionado/chunky) — usado como badge decorativo ("🔥 plano hype", "novo", "superadmin").

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `variant` | `'pink' \| 'yellow' \| 'lime' \| 'purple' \| 'zap'` | — | Modificador de cor (mapeia para a classe `.sticker.<variant>` em `globals.css`). |
| `className` | `string` | — | Classe extra; somada após `.sticker <variant>`. |
| `children` | `ReactNode` | — | Texto/emoji dentro do sticker. |
| `...rest` | `HTMLAttributes<HTMLSpanElement>` | — | Todo atributo nativo de `<span>`. |

**Quando usar:** badge decorativo curto que precisa destacar algo visualmente no layout neo-brutalista (rotação, cor primária, border + shadow).

**Não usar para:** botão clicável (use `Button`), contagem numérica na nav (use `NavButton` prop `badge`).

**Snippet:**

```tsx
import { Sticker } from '@/components/ui/Sticker';

<Sticker variant="pink">🔥 plano hype</Sticker>
```

**Tokens consumidos:** `.sticker` em `globals.css` → `--stroke`, `--shadow-chunk`, `--pink-500`, `--yellow-500`, `--lime-500`, `--purple-600`, `--zap-500`.

_Screenshot: TODO — capturar em `/home` (plano card) e `/admin/*` (sidebar brand)._

---

### StatCard

- **Path:** `components/ui/StatCard.tsx`
- **Propósito:** card compacto de métrica na home (label curto + valor grande + emoji opcional), com 4 cores de destaque.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `label` | `string` | — | Legenda em mono, uppercase. |
| `value` | `string` | — | Número/valor formatado (string — formate antes). |
| `accent` | `'lime' \| 'pink' \| 'yellow' \| 'purple'` | — | Fundo + cor do texto (foreground auto ajustado). |
| `icon` | `ReactNode` | — | Emoji/glyph opcional no canto superior direito. |

**Quando usar:** dashboard `/home` (grid 4 cards — resumos gerados, pendentes, etc.). Pure server component.

**Não usar para:** valores clicáveis ou que mudam em tempo real — é estático.

**Snippet:**

```tsx
<StatCard label="Pendentes" value="3" accent="pink" icon="⏳" />
<StatCard label="Este mês"  value="12" accent="lime" icon="🎙" />
```

**Tokens consumidos:** `--color-lime-500`, `--color-pink-500`, `--color-yellow-500`, `--color-purple-600`, `--color-ink-900`, `--color-stroke`, `--radius-md`, `--shadow-chunk`, `--font-display`, `--font-mono`.

_Screenshot: TODO — capturar em `/home` (grid de stats)._

---

### PodCover

- **Path:** `components/ui/PodCover.tsx`
- **Propósito:** capa editorial de podcast (foto + gradiente escuro + título chunky em lowercase). 6 variantes fotográficas com cores de acento diferentes.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `title` | `string` | — | Título do podcast/resumo (renderizado em lowercase). |
| `subtitle` | `string` | `'podcast'` | Eyebrow em mono/uppercase sob o título. |
| `variant` | `number` | `0` | 0–5; seleciona accent+foto default (módulo 6). |
| `size` | `number` | `200` | Largura = altura em px. <=80 vira variante compacta, >140 mostra brand mark + date pill. |
| `date` | `string` | — | Texto curto na pill top-right (só se `size > 140`). |
| `photo` | `string \| null` | — | Override da URL. `null` explícito força fallback gradient + emoji 🎙 (útil pra zero-data / testes). `undefined` usa a foto default da variant. |

**Quando usar:** hero player da `/home`, grid em `/podcasts`, capas miniatura na lista `/history`.

**Não usar para:** avatares de usuário (use uma `<div>` com inicial ou foto do auth), ícones (use `Icons`).

**Snippet:**

```tsx
<PodCover
  title="Resumão do grupo Família"
  subtitle="semana 15"
  date="18/ABR"
  variant={2}
  size={260}
/>

// Fallback sem imagem externa:
<PodCover title="Podcast vazio" photo={null} size={120} />
```

**Tokens consumidos:** `--color-stroke`, `--radius-md`, `--radius-pill`, `--shadow-chunk`, `--font-display`, `--font-mono`, `--font-body`.

_Screenshot: TODO — capturar em `/home` (hero) e `/podcasts` (grid)._

---

### MicMascot

- **Path:** `components/ui/MicMascot.tsx`
- **Propósito:** mascote microfone sorridente com animação de balanço (`@keyframes wiggle` em `globals.css`). 4 "humores" declarados mas não diferenciados visualmente ainda.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `size` | `number` | `80` | Largura base em px; altura = `size * 1.2`. |
| `mood` | `'happy' \| 'sleepy' \| 'party' \| 'thinking'` | `'happy'` | Reservado pra evolução — hoje todos renderizam o mesmo rosto. |
| `bounce` | `boolean` | `true` | Liga/desliga animação `wiggle`. |

**Quando usar:** empty state (`/approval` sem pendentes), onboarding, landing hero — qualquer lugar que precise de calor/personalidade.

**Não usar para:** botão; elemento decorativo denso em listas (a animação fica cansativa).

**Snippet:**

```tsx
<MicMascot size={120} />                     // happy + bounce
<MicMascot size={64}  bounce={false} />      // estático
```

**Tokens consumidos:** `--color-ink-800`, `--color-stroke`, `--color-yellow-500`, `--color-pink-500`.

_Screenshot: TODO — capturar em `/onboarding` e empty states._

---

### Waveform

- **Path:** `components/ui/Waveform.tsx`
- **Propósito:** forma de onda decorativa animada (barras pulsando via `@keyframes wave`). Alturas deterministas por `seed`.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `bars` | `number` | `48` | Número de barras. |
| `playing` | `boolean` | `true` | Se `false`, desliga a animação (barras ficam estáticas). |
| `color` | `string` | `'currentColor'` | CSS color das barras — herda de `color:` do pai por padrão. |
| `height` | `number` | `40` | Altura em px. |
| `seed` | `number` | `1` | Varia o padrão de alturas entre instâncias. |

**Quando usar:** badges de "transcrevendo…" em `/history`, decoração do player quando não há progresso real.

**Não usar para:** visualização de progresso real — use `PlayerWave` (segmentos preenchidos até `progress`).

**Snippet:**

```tsx
<Waveform bars={24} height={24} color="var(--accent-2)" seed={7} />
```

**Tokens consumidos:** nenhum diretamente — `color` é configurável. Usa `@keyframes wave` declarado em `globals.css`.

_Screenshot: TODO — capturar em `/history` (badge "transcrevendo…")._

---

### PlayerWave

- **Path:** `components/ui/PlayerWave.tsx`
- **Propósito:** forma de onda estática com progresso — barras antes de `progress` ficam cor accent pink, resto cinza desbotado. Envelope senoidal concentra amplitude no meio.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `progress` | `number` | — | 0..1. Abaixo desse ponto as barras ficam "tocadas" (pink). |
| `bars` | `number` | `80` | Total de barras (denso por padrão — é o hero). |
| `seed` | `number` | `2` | Variação pseudo-aleatória estável. |
| `height` | `number` | `56` | Altura em px. |

**Quando usar:** player hero `/home` (barra com progresso real do áudio). Animação fica a cargo do player que atualiza `progress`.

**Não usar para:** ornamento puro (use `Waveform`).

**Snippet:**

```tsx
const [progress, setProgress] = useState(0); // 0..1 vindo do <audio>
<PlayerWave progress={progress} bars={80} height={56} />
```

**Tokens consumidos:** `--color-accent-2` (pink), `--color-ink-500`.

_Screenshot: TODO — capturar em `/home` (hero player)._

---

## Controls

### Button

- **Path:** `components/ui/Button.tsx`
- **Propósito:** wrapper fino sobre a classe global `.btn` (definida em `globals.css`) — toda a estética chunky (border 2.5px, shadow 4px offset, radius pill) vive no CSS.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `variant` | `'default' \| 'purple' \| 'pink' \| 'lime' \| 'yellow' \| 'zap' \| 'ghost'` | `'default'` | Modificador de cor (mapeia `.btn.<variant>`). |
| `type` | `ButtonHTMLAttributes['type']` | `'button'` | Safety default — evita submit acidental em forms. |
| `className` | `string` | — | Classe extra. |
| `...rest` | `ButtonHTMLAttributes<HTMLButtonElement>` | — | `onClick`, `disabled`, `aria-*`, etc. |

**Quando usar:** toda ação clicável em formulários/toolbar/modal footer.

**Não usar para:** link de navegação (use `<Link>` do Next ou `.btn .btn-ghost` em `<a>` — ver account chip em `Sidebar`), tab/segment switch (use `RadioPill`).

**Snippet:**

```tsx
<Button variant="purple" onClick={handleApprove}>
  Aprovar
</Button>

<Button variant="ghost" onClick={close}>Cancelar</Button>
<Button variant="zap" type="submit" disabled={loading}>Gerar resumo</Button>
```

**Tokens consumidos:** via `.btn` em `globals.css` → `--font-body`, `--stroke`, `--shadow-chunk`, e por variant `--purple-600`, `--pink-500`, `--lime-500`, `--yellow-500`, `--zap-500`.

_Screenshot: TODO — capturar em `/approval/[id]` (footer)._

---

### Select

- **Path:** `components/ui/Select.tsx`
- **Propósito:** dropdown nativo com estética chunky (pill shape, stroke, shadow, chevron inline SVG). Label opcional em mono/uppercase acima.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `label` | `string` | — | Label opcional acima. |
| `value` | `string` | — | Valor selecionado (controlled). |
| `onChange` | `(value: string) => void` | — | Callback recebe a string direto (não o event). |
| `options` | `{ value: string; label: string }[]` | — | Opções. |
| `placeholder` | `string` | — | Opção inicial desabilitada/escondida. |
| `disabled` | `boolean` | `false` | — |
| `name`, `id` | `string` | — | Encaminhados pro `<select>`. |

**Quando usar:** forms de agendamento (`/schedule` — frequência, tom, voz). Prefira-o sobre variações customizadas — ele tem a11y/keyboard do browser grátis.

**Não usar para:** escolha pequena de 2-3 opções com emoji/label curto → use `RadioPill`.

**Snippet:**

```tsx
<Select
  label="Tom do resumo"
  value={tone}
  onChange={setTone}
  options={[
    { value: 'formal', label: 'Formal' },
    { value: 'fun', label: 'Divertido' },
    { value: 'corporate', label: 'Corporativo' },
  ]}
/>
```

**Tokens consumidos:** `--surface`, `--text`, `--text-dim`, `--stroke`, `--accent`, `--r-pill`, `--font-display`, `--font-body`.

> API: `onChange(value)` — **recebe valor, não event**. Inconsistente com `<select>` nativo, consistente com `RadioPill`.

_Screenshot: TODO — capturar em `/schedule` (form)._

---

### RadioPill

- **Path:** `components/ui/RadioPill.tsx`
- **Propósito:** radio group em pílulas lado-a-lado (selecionada fica accent solid, resto outline). Genérico sobre `T extends string` para type safety literal.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `label` | `string` | — | Label opcional acima do group (usado também como `aria-label`). |
| `value` | `T` | — | Opção selecionada. |
| `onChange` | `(value: T) => void` | — | Callback tipado preservando o literal. |
| `options` | `{ value: T; label: string; emoji?: string }[]` | — | Até ~4-5 opções (acima disso usar `Select`). |
| `name` | `string` | — | Form name compartilhado dos inputs internos. |

**Quando usar:** 2-5 opções curtas onde o usuário se beneficia de ver todas simultaneamente (ex.: modo de aprovação `auto/optional/required`, tom, frequência).

**Não usar para:** listas longas → `Select`. Opções com descrição longa.

**Snippet:**

```tsx
type Tone = 'formal' | 'fun' | 'corporate';
<RadioPill<Tone>
  name="tone"
  label="Tom"
  value={tone}
  onChange={setTone}
  options={[
    { value: 'formal',    label: 'Formal',     emoji: '💼' },
    { value: 'fun',       label: 'Divertido',  emoji: '🎉' },
    { value: 'corporate', label: 'Corporate',  emoji: '📊' },
  ]}
/>
```

**Tokens consumidos:** `--accent`, `--text`, `--text-dim`, `--text-inv`, `--stroke`, `--surface`, `--r-pill`, `--font-body`, `--font-display`.

_Screenshot: TODO — capturar em `/schedule` (form) ou modal "gerar resumo"._

---

## Structural

### Card

- **Path:** `components/ui/Card.tsx`
- **Propósito:** wrapper fino sobre a classe global `.card` (border + shadow + radius). Existe pra evitar repetição de `style={{ padding: 18 }}` nas telas.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `modifier` | `string` | — | Classe modifier extra (ex.: `"sprinkle"`). Somada após `.card`. |
| `padding` | `number \| string` | — | Shortcut pra `style={{ padding }}`. Funde com `style` explícito. |
| `className` | `string` | — | Classe extra. |
| `style` | `CSSProperties` | — | Merged com padding se ambos forem passados. |
| `...rest` | `HTMLAttributes<HTMLDivElement>` | — | Demais atributos de `<div>`. |

**Quando usar:** agrupamento visual em dashboards/listas (`/home` painéis, `/groups` items). Se o conteúdo é um CTA único, prefira `Button`.

**Não usar para:** modal (use `Modal` — tem portal + a11y), sticker (use `Sticker`).

**Snippet:**

```tsx
<Card padding={18}>
  <h3>Últimos resumos</h3>
  <p>…</p>
</Card>
```

**Tokens consumidos:** via `.card` em `globals.css` → `--surface`, `--stroke`, `--shadow-chunk`, `--r-md`.

_Screenshot: TODO — capturar em `/home` (painéis lado direito)._

---

### Modal

- **Path:** `components/ui/Modal.tsx`
- **Propósito:** modal chunky via `createPortal` (sobe acima de qualquer stacking context), com ESC-to-close, click-no-backdrop-fecha, scroll lock no body, focus no dialog. Sem focus trap — deliberadamente leve.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `open` | `boolean` | — | Se `false`, não renderiza nada. |
| `onClose` | `() => void` | — | ESC + click backdrop + click no X topo direito. |
| `title` | `string` | — | Título em display font (linka `aria-labelledby`). |
| `children` | `ReactNode` | — | Corpo (scroll interno se exceder viewport). |
| `footer` | `ReactNode` | — | Botões (geralmente cancel + confirm); right-aligned sob border-top. |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Max-width: 360 / 480 / 640. |

**Quando usar:** confirmações ("gerar resumo agora?"), formulários pequenos (criar tenant, editar voz).

**Não usar para:** navegação entre páginas (use `router.push`), sidebar (use `Sidebar`). Não colocar formulários longos — se precisar de mais de 1 viewport de altura, use uma página dedicada.

**Snippet:**

```tsx
const [open, setOpen] = useState(false);

<Modal
  open={open}
  onClose={() => setOpen(false)}
  title="Gerar resumo agora"
  size="md"
  footer={
    <>
      <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
      <Button variant="purple" onClick={submit}>Gerar</Button>
    </>
  }
>
  <p>Confirma gerar um resumo do grupo agora?</p>
</Modal>
```

**Tokens consumidos:** `--color-surface`, `--color-text`, `--color-stroke`, `--radius-lg`, `--shadow-chunk-lg`, `--font-display`, `--font-body`.

_Screenshot: TODO — capturar em `/home` (modal "gerar resumo agora")._

---

### TopBar

- **Path:** `components/shell/TopBar.tsx`
- **Propósito:** header de página (título display font oversize + subtítulo + breadcrumb + actions à direita + blob de acento no canto).

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `title` | `ReactNode` | — | H1 grande. |
| `subtitle` | `ReactNode` | — | Linha secundária abaixo do título. |
| `breadcrumb` | `ReactNode` | — | Eyebrow mono/uppercase acima do título. |
| `accent` | `'purple' \| 'pink' \| 'lime' \| 'yellow' \| 'zap'` | `'purple'` | Cor do blob decorativo top-right. |
| `actions` | `ReactNode` | — | Área direita — buttons, stickers. |

**Quando usar:** no topo de toda rota `(app)` — padrão visual para dar identidade a cada seção.

**Não usar para:** nav/breadcrumbs clicáveis complexos (hoje é só string); página interna (usar H2 direto).

**Snippet:**

```tsx
<TopBar
  breadcrumb="Aprovação"
  title="Resumos aguardando"
  subtitle="3 pendentes · grupo Família"
  accent="pink"
  actions={<Button variant="zap">Aprovar todos</Button>}
/>
```

**Tokens consumidos:** `--surface`, `--stroke`, `--text`, `--text-dim`, `--font-display`, `--purple-600` / `--pink-500` / `--lime-500` / `--yellow-500` / `--zap-500`.

_Screenshot: TODO — capturar em `/approval`, `/history`, `/groups`._

---

### NavButton

- **Path:** `components/shell/NavButton.tsx`
- **Propósito:** linha da sidebar (ícone + label + badge opcional). Estado ativo flipa o fundo pra `--purple-600` com shadow chunky.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `id` | `string` | — | Id estável usado pelo pai pra decidir `active`. |
| `label` | `string` | — | Texto. |
| `icon` | `ReactNode` | — | Ícone (geralmente `<Icons.*  />`). |
| `active` | `boolean` | `false` | Muda visual + desliga hover. |
| `badge` | `number` | — | Pílula pink; só renderiza se `> 0`. |
| `onClick` | `(e) => void` | — | Handler. |

**Quando usar:** exclusivamente dentro de `Sidebar` / `AdminSidebar` / shells equivalentes.

**Não usar para:** CTA isolado (use `Button`), tab bar (monte com `.btn.ghost`).

**Snippet:**

```tsx
<NavButton
  id="approval"
  label="Aprovação"
  icon={<Icons.Check />}
  badge={pendingCount}
  active={current === 'approval'}
  onClick={() => router.push('/approval')}
/>
```

**Tokens consumidos:** `--purple-600`, `--pink-500`, `--text`, `--stroke`, `--bg-2`, `--r-md`, `--font-body`.

_Screenshot: TODO — capturar a sidebar em qualquer rota `(app)`._

---

### Sidebar

- **Path:** `components/shell/Sidebar.tsx`
- **Propósito:** navegação lateral da app shell (248px fixa). Brand block + grupos "Principal/Setup/Superadmin" + plan card + account chip. Presentational — routing fica no `AppSidebar`.

| Prop | Tipo | Default | Descrição |
|---|---|---|---|
| `current` | `NavId` | — | Item ativo (`'home' \| 'groups' \| …`). |
| `onNav` | `(id: NavId) => void` | — | Navegação. |
| `userEmail` | `string` | — | Renderizado truncado no account chip. |
| `tenantName` | `string` | — | — (hoje só passado; plan card usa `tenantPlan`). |
| `tenantPlan` | `string` | — | Gera label "plano <x> · 7/15 resumos". |
| `whatsappStatus` | `'connected' \| 'connecting' \| 'disconnected' \| 'none'` | `'none'` | Dot colorido + pulsação em `connecting`. |
| `whatsappPhone` | `string \| null` | — | Subtítulo sob "WhatsApp" quando conectado. |
| `pendingApprovals` | `number` | — | Badge na linha "Aprovação". `0`/undefined → sem badge. |
| `isSuperadmin` | `boolean` | `false` | Adiciona linha "Admin" linkando pra `/admin`. |
| `usage` | `{ used, total, label? }` | — | Override do widget "7 de 15". |

**Quando usar:** exclusivamente no layout `app/(app)/layout.tsx` (via `AppSidebar`). Não instanciar direto — passe pelo wrapper.

**Não usar para:** admin shell (use `AdminSidebar`), páginas públicas (não há sidebar).

**Snippet:** ver `components/shell/AppSidebar.tsx` (uso único no projeto).

**Tokens consumidos:** todos os semânticos (`--surface`, `--surface-2`, `--stroke`, `--text`, `--text-dim`) + brand (`--purple-600`, `--pink-500`, `--lime-500`) + tipografia (`--font-brand`, `--font-display`, `--font-body`) + `--r-md`.

_Screenshot: TODO — capturar em `/home` com WhatsApp conectado + badge pendente._

---

### AppSidebar

- **Path:** `components/shell/AppSidebar.tsx`
- **Propósito:** client wrapper que conecta `Sidebar` ao `next/navigation` (pathname ↔ `NavId`). É isso que o layout server renderiza.

| Prop | Tipo | Descrição |
|---|---|---|
| `userEmail` | `string` | — |
| `tenantName` | `string` | — |
| `tenantPlan` | `string` | — |
| `whatsappStatus` | `WhatsappStatus?` | Resolvido via admin client em `app/(app)/layout.tsx`. |
| `whatsappPhone` | `string \| null?` | — |
| `pendingApprovals` | `number?` | Resolvido server-side a cada request (sem polling). |
| `isSuperadmin` | `boolean?` | Server-side via `is_superadmin()`. |

**Quando usar:** no layout de `app/(app)/`. Esse é o único ponto que conhece o route table `ROUTES`.

**Não usar para:** admin (use `AdminSidebar`).

**Snippet:** ver `app/(app)/layout.tsx`.

_Screenshot: TODO — idem `Sidebar`._

---

### AdminSidebar

- **Path:** `components/shell/AdminSidebar.tsx`
- **Propósito:** sidebar paralela ao `AppSidebar`, scoped pra `/admin/*`. Visual flipado pra pink ("modo admin"), sem plan card, com link "voltar pro app".

| Prop | Tipo | Descrição |
|---|---|---|
| `userEmail` | `string` | Email do superadmin logado. |

**Quando usar:** exclusivamente em `app/(admin)/layout.tsx`. Gateada por `requireSuperadmin()`.

**Não usar para:** tenant users (use `AppSidebar`).

**Snippet:** ver `app/(admin)/layout.tsx`.

**Tokens consumidos:** `--pink-500` como brand/active, `--surface`, `--surface-2`, `--stroke`, `--text`, `--text-dim`, `--bg-2`, `--radius-md`, `--font-brand`, `--font-body`.

_Screenshot: TODO — capturar em `/admin` e `/admin/tenants`._

---

## Assets

### Icons

- **Path:** `components/icons/Icons.tsx`
- **Propósito:** namespace de ícones SVG inline (viewBox 24×24, default 18×18, `currentColor` herdando do pai). Exportados como `Icons.<Name>`.

**Ícones disponíveis:** `Play`, `Pause`, `Skip`, `Rewind`, `Check`, `X`, `Mic`, `Group`, `Calendar`, `History`, `Home`, `Sparkle`, `Edit`, `Refresh`, `Send`, `Settings`, `Wand`, `Volume`, `Bell`, `Plus`, `Chat`, `Zap`.

Todos aceitam `SVGProps<SVGSVGElement>` (props nativas — `width`, `height`, `fill`, `stroke`, `style`, `aria-*`, etc.).

**Quando usar:** qualquer glyph/ícone. Antes de adicionar um novo, verificar se já existe (pr-existing > duplicar).

**Não usar para:** capa de podcast (use `PodCover`), mascote (use `MicMascot`), logo podZAP (renderizado inline em `Sidebar` / `AdminSidebar`).

**Snippet:**

```tsx
import { Icons } from '@/components/icons/Icons';

<Icons.Home />                                  // 18×18, currentColor
<Icons.Play width={24} height={24} />           // oversized
<Icons.Zap style={{ color: 'var(--zap-500)' }} /> // color override

// Destructure:
const { Group, Check } = Icons;
<Group /> <Check />
```

**Tokens consumidos:** nenhum diretamente — cor é sempre `currentColor` (herda do container).

_Screenshot: TODO — visíveis na sidebar, top bar actions, history (transcribing badge)._
