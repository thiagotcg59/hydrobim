# HydroBIM

Plataforma BIM hidráulica 3D para MEP, redes de abastecimento e adutoras, com interoperabilidade IFC.

O HydroBIM é um **editor BIM paramétrico web**: os componentes hidráulicos têm parâmetros de engenharia, portas de conexão e conectividade explícita, e a geometria 3D é derivada desses parâmetros. Não é um visualizador IFC — o IFC será um formato de intercâmbio, gerado a partir do modelo próprio.

> **Estado atual: Fase 1 (MVP funcional) concluída.** A exportação IFC (Fase 3) **não está implementada**. Veja o [roadmap](docs/ROADMAP.md).

## O que já funciona

- Viewport 3D (Z para cima) com órbita, zoom, deslocamento, grade, eixos e vistas (perspectiva, planta, elevação, enquadrar).
- Desenho de tubos por dois pontos, com o mouse ou por coordenadas exatas, em qualquer orientação (Shift = trecho vertical).
- Snap em grade e em extremidades livres; ao mudar de direção a partir de um tubo, o joelho com o ângulo exato é criado automaticamente e o tubo é aparado.
- Inserção de joelho, tê, redução e válvula em extremidades livres; tê e válvula também em linha (o tubo é dividido).
- Seleção, painel de propriedades com dados reais, edição de material/diâmetro (com propagação pelo trecho), comprimento, coordenadas, ângulo, raio, giro de conexões e propriedades BIM livres.
- Motor de conectividade com portas, verificação de compatibilidade (DN, especificação, posição, alinhamento) e validação contínua do modelo.
- Catálogo dimensional por material e norma (PVC soldável, aço-carbono Sch 40, ferro dúctil K9, PEAD SDR 11).
- Salvar/abrir no navegador, exportar/importar JSON versionado, desfazer/refazer.
- Ambientes MEP e Infra sobre o mesmo modelo de dados (o Infra, por ora, só altera padrões de especificação e grade).
- API FastAPI que valida documentos de projeto com o mesmo contrato do editor.

## Requisitos

| Ferramenta | Versão testada |
| --- | --- |
| Node.js | 24 (mínimo 20.19) |
| npm | 11 |
| Python | 3.11 |
| uv | 0.12 |

## Como executar

### Editor web

```bash
npm install
npm run dev
```

Abra <http://localhost:5173>. Na primeira execução é carregado um projeto de demonstração.

Build de produção: `npm run build` (saída em `apps/web/dist`) e `npm run preview` para servi-la.

### API (opcional na Fase 1)

```bash
cd services/api
uv sync
uv run uvicorn hydrobim_api.main:app --reload --port 8000
```

Documentação interativa em <http://localhost:8000/docs>. O editor ainda não depende da API; ela valida projetos (`POST /api/v1/projects/validate`) e será a base da exportação IFC.

## Como usar (roteiro rápido)

1. **Tubulação** (`T`): escolha especificação e diâmetro, clique o ponto inicial e os seguintes. `Shift` restringe à vertical; `Esc` encerra. Também é possível digitar X, Y, Z e usar **Adicionar ponto**.
2. **Selecionar** (`S`): clique em um elemento ou escolha-o na lista **Elementos** do painel direito.
3. No painel **Propriedades**: altere diâmetro/material, comprimento e coordenadas de extremidades livres; em **Portas de conexão**, acople joelho, tê, válvula ou redução a uma extremidade livre; em **Inserir em linha**, divida o tubo com um tê ou uma válvula.
4. **Joelho** (`J`), **Tê** (`E`), **Redução** (`R`), **Válvula** (`V`): clique em uma extremidade livre (marcadores ciano) ou, para tê e válvula, sobre um tubo.
5. **Salvar** (`Ctrl+S`) grava no navegador; **Exportar JSON** baixa o arquivo `.hydrobim.json`; **Abrir** lista os projetos salvos e importa arquivos.

A barra inferior mostra coordenadas, modo da ferramenta, mensagens e o resultado da validação (clique para ver as pendências).

## Qualidade

```bash
npm run lint           # ESLint
npm run format:check   # Prettier
npm run typecheck      # TypeScript estrito
npm test               # testes unitários e de integração (Vitest)
npm run build          # build de produção
npm run test:e2e       # testes ponta a ponta no Chromium (Playwright)
npm run check          # lint + typecheck + test + build
```

Na primeira vez, instale o navegador dos testes E2E com `npx playwright install chromium`.

Backend: `cd services/api && uv run ruff check . && uv run pytest`.

## Estrutura

```
apps/web/            Editor React + Three.js (interface, viewport, estado, persistência)
packages/core/       Modelo de domínio, portas, conectividade, operações, validação, serialização
packages/geometry/   Malhas paramétricas dos elementos (independente de motor gráfico)
packages/catalog/    Especificações dimensionais de tubos
services/api/        API FastAPI (validação; exportação IFC na Fase 3)
examples/            Projetos de demonstração (.hydrobim.json)
tests/               Testes de integração e ponta a ponta
docs/                Arquitetura, modelo de domínio, mapeamento IFC, decisões, roadmap
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Modelo de domínio](docs/DOMAIN_MODEL.md)
- [Mapeamento IFC](docs/IFC_MAPPING.md)
- [Decisões técnicas](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Instruções para agentes e colaboradores](AGENTS.md)

## Aviso de engenharia

As dimensões do catálogo são valores nominais de referência das normas indicadas e devem ser conferidas com a norma vigente e com o fabricante antes do uso em projeto. As dimensões e formas das conexões e válvulas são genéricas e simplificadas; não representam produtos comerciais.
