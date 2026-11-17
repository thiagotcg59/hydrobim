# HydroBIM

Plataforma BIM hidráulica 3D para MEP, redes de abastecimento e adutoras, com interoperabilidade IFC.

O HydroBIM é um **editor BIM paramétrico web**: os componentes hidráulicos têm parâmetros de engenharia, portas de conexão e conectividade explícita, e a geometria 3D é derivada desses parâmetros. Não é um visualizador IFC — o IFC será um formato de intercâmbio, gerado a partir do modelo próprio.

> **Estado atual:** Fases 0 e 1 concluídas; Fases 2 a 6 parcialmente implementadas. O que falta em cada fase está no [roadmap](docs/ROADMAP.md).

## O que já funciona

**Modelagem**
- Viewport 3D (Z para cima) com órbita, grade, eixos, vistas e projeção ortográfica.
- Tubos por dois pontos (mouse ou coordenadas), com joelho automático ao mudar de direção.
- Joelho, tê (inclusive de redução), redução, válvulas (gaveta, globo, esfera, borboleta, retenção, ventosa, redutora de pressão), bomba e reservatório.
- Seleção múltipla, mover, copiar, desfazer/refazer, níveis e sistemas hidráulicos.

**Catálogo e famílias**
- Famílias de conexões com dimensões de catálogos (Krona, Tigre, Amanco Wavin, Saint-Gobain PAM, AVK, ASME B16.9), cada uma com a fonte registrada — ver [catálogos](docs/CATALOGS.md).
- Seção **Famílias**: consultar e editar as tabelas dimensionais por projeto e reaplicar às peças já inseridas.
- Geometria com bolsas (furo e batente), flanges, corpo curvo e dimensões principais das famílias.

**Troca de diâmetro inteligente**
- Por padrão, alterar o diâmetro muda **apenas a peça selecionada**: reduções de catálogo são inseridas junto aos vizinhos, ajustadas se já existirem e removidas quando deixam de ser necessárias. A alternativa é aplicar a todo o trecho conectado.

**Interoperabilidade e análises**
- Exportação **IFC 4.3** no navegador, verificada com IfcOpenShell.
- Quantitativo em CSV e rede em formato EPANET (INP).
- Georreferência informada pelo usuário, terreno por pontos XYZ, perfil longitudinal com recobrimento e detecção de interferências entre tubos.
- Salvar/abrir no navegador e em arquivo JSON versionado (projetos antigos são migrados).

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

Abra <http://localhost:5180>. Na primeira execução é carregado um projeto de demonstração.

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
5. **Bomba** (`B`) e **Reservatório** (`Q`): clique um ponto ou informe as coordenadas.
6. **Trocar diâmetro**: no painel, escolha o novo diâmetro. Com "Somente esta peça" as reduções são criadas automaticamente; com "Todo o trecho conectado" a alteração se propaga.
7. **Famílias**: abre as tabelas dimensionais das conexões para consulta e edição.
8. **Projeto**: níveis, sistemas, georreferência, terreno, perfil e interferências.
9. **Salvar** (`Ctrl+S`) grava no navegador; os botões **JSON**, **IFC**, **Quantitativo** e **EPANET** exportam arquivos; **Abrir** lista os projetos salvos e importa arquivos. `Ctrl+clique` seleciona vários elementos.

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
packages/catalog/    Especificações de tubos e famílias de conexões (catálogos)
packages/ifc/        Exportação IFC 4.3 (escritor IFC-SPF puro, roda no navegador)
services/api/        API FastAPI (validação do projeto; verificação do IFC nos testes)
examples/            Projetos de demonstração (.hydrobim.json)
tests/               Testes de integração e ponta a ponta
docs/                Arquitetura, modelo de domínio, mapeamento IFC, decisões, roadmap
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Modelo de domínio](docs/DOMAIN_MODEL.md)
- [Catálogos e famílias](docs/CATALOGS.md)
- [Mapeamento IFC](docs/IFC_MAPPING.md)
- [Decisões técnicas](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Instruções para agentes e colaboradores](AGENTS.md)

## Aviso de engenharia

As dimensões vêm de catálogos de fabricantes e de fontes secundárias de normas, levantadas em novembro de 2026; confira com o catálogo vigente do fornecedor antes do uso em projeto. A geometria reproduz as dimensões principais das famílias, com contorno simplificado. Peças sem família de catálogo usam proporções genéricas e são identificadas como tal. Rugosidades e demais parâmetros hidráulicos exportados para o EPANET são valores de referência a revisar.
