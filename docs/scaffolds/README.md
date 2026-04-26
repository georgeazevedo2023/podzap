# docs/scaffolds/ — snippets de scaffolding inicial

Conteúdo de referência usado quando um setup inicial é necessário (Tailwind, components base). **Não atualizar conforme o app evolui** — esses arquivos são snapshot histórico do que entrou no início; o estado atual vive em `app/globals.css` e `components/`.

## Estrutura

- `tailwind/` — config e tokens originais (origem dos valores em `app/globals.css`)
- `components/` — components base usados no scaffolding inicial

## Quando consultar

- Subindo um clone novo do projeto e precisando reconstruir do zero
- Comparando "o que mudou desde o scaffolding" pra entender drift histórico

## Quando NÃO consultar

- Pra saber tokens atuais ou padrões UI — ver [`../ui-components/`](../ui-components/README.md)
- Pra adicionar componente novo — ver `components/ui/` no código
