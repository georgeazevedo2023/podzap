# UI Parity Audit — Logo + Sidebar (Playwright)

**Data:** 2026-04-24
**Método:** Playwright headless, Chromium 1280×720. Spec reproduzível em
[`e2e/ui-parity-audit.spec.ts`](../../e2e/ui-parity-audit.spec.ts).

## Como rodar

```bash
set -a; . ./.env.local; set +a
npx playwright test e2e/ui-parity-audit.spec.ts --project=chromium --workers=1
```

Produz em `e2e/parity/`:
- `prototype-sidebar.png` · `prod-sidebar.png` · sidebars lado a lado
- `prototype-logo.png` · `prod-logo.png` · logos isolados
- `report.md` · diff textual de computed styles

## Resultado: 🟢 paridade visual da logomarca OK

As duas imagens abaixo foram capturadas no mesmo frame e renderização
(Chromium via Playwright) contra os dois origens — **prototype** servido
do arquivo `podZAP _standalone_.html` e **prod** em `podzap.wsmart.com.br`.

| Protótipo | Produção |
|---|---|
| `e2e/parity/prototype-logo.png` | `e2e/parity/prod-logo.png` |

**Match:**
- ✅ Lettering "pod" branco + "ZAP" rosa (pink-500) com text-shadow chunky (2px 2px 0 stroke)
- ✅ Font-family brand (Archivo Black / var(--font-brand))
- ✅ Tagline "zap → podcast" em caps, letter-spacing 0.2em, color text-dim, font-weight 700
- ✅ Tile 40×40 purple-600 com border 2.5px stroke + shadow 3px 3px 0 stroke
- ✅ Tile rotate(-4deg) (tilt característico do protótipo)
- ✅ 🎙 emoji branco dentro do tile

**Diffs computed (cosméticos, não perceptíveis visualmente):**

| Propriedade | Protótipo | Produção | Impacto |
|---|---|---|---|
| `line-height` (outer div) | `normal` (~1.2) | `24px` (1.5) | +3px altura no container, invisível |
| `border` default | `0px none` | `0px solid` | cor default CSS, sem render |

Nenhum fix aplicado — a diferença de 3px no container externo da logo não
é perceptível e viria só se alguém começasse a decorar o container com
borda explícita. O risco do fix > benefício.

## Outros elementos da sidebar

**Divergências intencionais** (não são bugs de paridade, são features pós-protótipo):

| Item | Protótipo | Produção | Motivo |
|---|---|---|---|
| Nav "Podcasts" | ausente | presente | Feature nova (Fase 10 delivery queue) |
| Nav "Conectar Zap" | presente com esse label | "WhatsApp" | Decisão de produto F13 |
| Seção "SUPERADMIN" + "Admin" | ausente | presente pra superadmins | Feature F12-13 |
| Badge "Aprovação 2" | mockado (sempre 2) | dinâmico (pending_review count) | Server-rendered per tenant |
| Plano widget · label | "Você usou 7 de 15" | "plano free · 0/15" | Dados reais do tenant vs mock |
| Plano widget · progress bar | 30-40% preenchida (mock) | invisível a 0% | Tenant tem 0 resumos reais |

## Referências

- Prova capturada pelos 4 PNGs em `e2e/parity/`
- Fix anterior da logo (chunky shadow adicionada): commit `8a97761`
- Spec de audit: `e2e/ui-parity-audit.spec.ts`
- Audit complementar (primitives Button/Sticker): `docs/audits/ui-parity-2026-04-24.md`

## Conclusão

Logo atinge paridade visual com o protótipo. Os diffs restantes são
features pós-MVP (Podcasts, Admin) ou dados dinâmicos (badge,
plano/usage) que deveriam mesmo divergir. Nenhum fix adicional indicado.
