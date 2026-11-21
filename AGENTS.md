# AGENTS.md — instruções para agentes de IA e colaboradores

## Objetivo do projeto

HydroBIM é um editor BIM hidráulico paramétrico para web (instalações prediais/industriais — MEP — e redes de abastecimento/adutoras — Infra). É software de engenharia em evolução: cada recurso deve ser realmente operacional, testado e coerente com a prática de engenharia. Não é um visualizador IFC nem uma demonstração gráfica.

Estado e próximos passos: `docs/ROADMAP.md`. Leia também `docs/ARCHITECTURE.md` e `docs/DOMAIN_MODEL.md` antes de alterar o domínio, `docs/INTERFACE.md` antes de alterar a organização da interface, e `docs/INFRA.md` antes de alterar o ambiente Infra.

## Organização

| Caminho | Conteúdo | Pode depender de |
| --- | --- | --- |
| `packages/core` | Esquema, matemática, portas, conectividade, operações, validação, serialização | apenas `zod` |
| `packages/catalog` | Especificações de tubos e famílias de conexões (com fontes) | `core` |
| `packages/ifc` | Camada BIM (`src/bim`: modelo de informação, registro de propriedades, validação, IDS) e exportação IFC 4.3 (escritor IFC-SPF puro) | `core`, `geometry` |
| `packages/dxf` | Exportação DXF (planta anotada em R2000 e modelo 3D em R12), escritor ASCII puro | `core`, `geometry` |
| `packages/geometry` | Malhas paramétricas (sem motor gráfico) | `core` |
| `apps/web` | Editor React/Three.js: `ui/`, `commands/` (registro de comandos), `viewport/`, `plan/`, `infra/` (Planta Infra), `map/` (provedores de mapa), `views/` (vistas de projeto e detalhes 2D), `bim/` (aba BIM / IFC), `editor/`, `state/`, `persistence/`, `demo/` | todos os pacotes |
| `services/api` | API FastAPI (validação; verificação do IFC com IfcOpenShell nos testes) | contrato JSON do projeto |
| `tests/integration`, `tests/e2e` | Integração entre pacotes e testes no navegador | — |
| `examples/` | Projetos de exemplo, gerados por `npm run examples:generate` | — |
| `docs/` | Arquitetura, domínio, IFC, decisões, roadmap | — |

`packages/*` **não podem** importar Three.js, React ou Zustand (o ESLint bloqueia).

## Comandos

```bash
npm install                 # dependências
npm run dev                 # editor em http://localhost:5180
npm run lint                # ESLint
npm run format              # Prettier (escreve)   | npm run format:check
npm run typecheck           # TypeScript estrito em todos os workspaces
npm test                    # Vitest: unitários + integração
npm run build               # build de produção do editor
npm run test:e2e            # Playwright (1ª vez: npx playwright install chromium)
npm run examples:generate   # regenera examples/*.json
npm run check               # lint + typecheck + test + build

cd services/api
uv sync
uv run uvicorn hydrobim_api.main:app --reload --port 8000
uv run ruff check . && uv run ruff format --check . && uv run pytest
```

**Windows:** execute o Vitest pelo PowerShell/cmd (ou com a letra da unidade em maiúscula). Pelo Git Bash com `cd /c/...` os testes falham com `Cannot read properties of undefined (reading 'config')`, pois o módulo é carregado duas vezes por diferença de caixa no caminho.

## Padrões de código

- TypeScript estrito (`noUncheckedIndexedAccess`, sem `any`, sem `!` fora de testes). Python com `ruff`.
- Código e identificadores em inglês; **textos de interface, mensagens de erro, comentários e documentação em português (pt-BR)**.
- Operações de domínio são funções puras que devolvem `Result<T>`; não lançam exceções para erros previsíveis e nunca mutam o projeto recebido.
- Erros de domínio têm `code` estável (usado em testes) e `message` em português, pronta para o usuário.
- A interface não contém regras de modelagem: chama operações de `@hydrobim/core` por meio da store.
- Comandos da interface entram pelo registro único (`apps/web/src/commands/commands.ts`): rótulo, atalho, disponibilidade (com o motivo) e execução; a faixa, os atalhos e a busca leem dele. Estado de interface (abas, painéis, layout) fica em `state/uiStore.ts`, nunca no projeto nem no histórico. Ver `docs/INTERFACE.md`.
- Todo controle interativo relevante tem `data-testid` (os testes E2E dependem deles).
- Comentários explicam o porquê (regra de engenharia, restrição), não o óbvio.
- Sem credenciais, tokens ou serviços pagos. Novas dependências exigem justificativa em `docs/DECISIONS.md`.

## Regras de modelagem (não negociáveis)

1. **Unidades SI internas**: metros e radianos. Conversões apenas na apresentação (`units.ts`).
2. **Z para cima**, sistema destro.
3. **DN não é diâmetro**: nunca derive diâmetro externo/interno do DN; use o catálogo.
4. **Sem compatibilidade presumida**: materiais, normas, classes de pressão ou diâmetros diferentes não se conectam sem peça apropriada.
5. **Portas, comprimentos, geometria e validação são derivados** dos parâmetros — não os persista.
6. **Conectividade é um grafo** (`Project.connections`), separado da geometria.
7. **Identificadores são persistentes**: uma operação nunca troca o `id` de um elemento existente.
8. **Nada de geometria fictícia apresentada como produto real**; dimensões genéricas devem estar identificadas como tal.
9. **Nenhum EPSG ou coordenada geográfica arbitrária.**
10. **IFC**: não confundir classe interna, entidade IFC e tipo predefinido; verificar no esquema antes de mapear (`docs/IFC_MAPPING.md`). Propriedades IFC entram pelo registro central (`packages/ifc/src/bim/definitions.ts`); as dos conjuntos padronizados têm de existir em `schemaData.ts` (gerado do esquema — nunca editado à mão); conjuntos próprios usam o prefixo `HydroBIM_`. Valor desconhecido fica sem valor (pendente), nunca preenchido.
11. Recursos não implementados aparecem desabilitados e identificados (com a fase), nunca com ações simuladas.
12. **Dados de catálogo só de fontes identificadas**: todo valor de família vem de um documento citado em `source` (fabricante, edição, página, URL); valores derivados são declarados; nada é inventado ou interpolado. Ver `docs/CATALOGS.md`.
13. **A porta fica no fundo da bolsa ou na face do flange**; a bolsa é geometria sobre o tubo.
14. **Flanges PN vêm da tabela única** (`packages/catalog/src/flanges.ts`, PN 10/16/25/40): toda família nova com flange PN usa `flangeEndMm`/`flangeEnd` em vez de transcrever o flange de outra fonte; DN que a tabela não traz fica sem flange. Flanges de outro padrão (ex.: ASME) só com a fonte própria citada. Ver `docs/CATALOGS.md`.

## Alterações no esquema do projeto

Mudou `packages/core/src/schema.ts`? Então: incremente `SCHEMA_VERSION`, registre a migração em `serialization.ts`, atualize `services/api/hydrobim_api/models/project.py` (inclusive a migração), ajuste `packages/ifc` se a mudança afetar a exportação, rode `npm run examples:generate` (gera o JSON e o IFC de exemplo juntos), atualize `docs/DOMAIN_MODEL.md` e rode os testes dos dois lados.

## Estratégia de testes

- **Unitários (Vitest)** ao lado do código (`*.test.ts`): toda operação de domínio nova precisa de teste do caminho feliz, dos erros e de `validateProject` sem pendências ao final.
- **Integração** (`tests/integration`): exemplos abrem, validam e geram geometria.
- **E2E (Playwright)** (`tests/e2e`): critérios de aceite no navegador real, sem erros de console.
- **Backend (pytest)**: contrato, regras de validação e todos os `examples/*.json`.
- Um recurso só está concluído com teste automatizado e verificação real de funcionamento. Não declare sucesso sem evidência; registre o que falhou ou ficou pendente.

## Convenções Git

- Branches: `main` (protegida, sem push direto) ← `develop` ← `feature/<assunto>`.
- Commits pequenos, no formato Conventional Commits, em português: `feat(core): …`, `fix(web): …`, `docs: …`, `test: …`, `chore: …`.
- Nunca: `git push --force`, `git reset --hard`, `git clean -fd`, reescrita de histórico ou exclusão de arquivos sem autorização.
- **Envio ao GitHub ao fim de cada sessão do localhost** (autorizado pelo responsável em 2026-11-17): o `iniciar.ps1` abre o editor e, quando a sessão é encerrada com Q, roda `npm run check` e, só se passar, faz `git push` da branch de trabalho atual (`feature/...`). Nunca envia direto para `main` ou `develop`, que recebem alterações por pull request. Alterações sem commit só entram com uma mensagem Conventional Commits digitada pelo responsável. `.\iniciar.ps1 -SomenteEnviar` faz só a verificação e o envio.
- Agentes de IA fazem commits pequenos (só com testes passando) ao longo da sessão; o envio fica para o encerramento da sessão. Fora desse fluxo, push e pull requests só com autorização do responsável.
- A `main` é publicada no GitHub Pages (`.github/workflows/pages.yml`): <https://thiagotcg59.github.io/hydrobim/>.
- Não versionar: `node_modules`, `dist`, `.venv`, `test-results`, credenciais.

## Regras para sessões de IA

- Comece inspecionando o repositório (`git status`, branch, remotes) e lendo este arquivo e o roadmap.
- Trabalhe somente neste repositório. Não altere outros projetos (em especial `ifc-energy`) nem configurações globais.
- Implemente a fase em andamento; planeje as seguintes sem antecipá-las sem necessidade.
- Divisão preferencial quando houver mais de um agente: arquitetura, domínio, interface e documentação com Claude; geometria, conectividade, backend, IFC e testes com Codex. Agentes não editam os mesmos arquivos simultaneamente — delimite diretórios e revise cada integração.
- Antes de concluir: `npm run check`, `npm run test:e2e` e os testes do backend; atualize a documentação afetada.
- Operações externas (PR, deploy, instalação global, e push fora do fluxo do `iniciar.ps1`) exigem aprovação: apresente o comando e aguarde.
- Se uma ferramenta estiver indisponível, informe a limitação; não simule execuções.
