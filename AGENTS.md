# AGENTS.md — instruções para agentes de IA e colaboradores

## Objetivo do projeto

HydroBIM é um editor BIM hidráulico paramétrico para web (instalações prediais/industriais — MEP — e redes de abastecimento/adutoras — Infra). É software de engenharia em evolução: cada recurso deve ser realmente operacional, testado e coerente com a prática de engenharia. Não é um visualizador IFC nem uma demonstração gráfica.

Estado e próximos passos: `docs/ROADMAP.md`. Leia também `docs/ARCHITECTURE.md` e `docs/DOMAIN_MODEL.md` antes de alterar o domínio.

## Organização

| Caminho | Conteúdo | Pode depender de |
| --- | --- | --- |
| `packages/core` | Esquema, matemática, portas, conectividade, operações, validação, serialização | apenas `zod` |
| `packages/catalog` | Especificações dimensionais de tubos | `core` |
| `packages/geometry` | Malhas paramétricas (sem motor gráfico) | `core` |
| `apps/web` | Editor React/Three.js: `ui/`, `viewport/`, `editor/`, `state/`, `persistence/`, `demo/` | todos os pacotes |
| `services/api` | API FastAPI (validação; exportação IFC na Fase 3) | contrato JSON do projeto |
| `tests/integration`, `tests/e2e` | Integração entre pacotes e testes no navegador | — |
| `examples/` | Projetos de exemplo, gerados por `npm run examples:generate` | — |
| `docs/` | Arquitetura, domínio, IFC, decisões, roadmap | — |

`packages/*` **não podem** importar Three.js, React ou Zustand (o ESLint bloqueia).

## Comandos

```bash
npm install                 # dependências
npm run dev                 # editor em http://localhost:5173
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
10. **IFC**: não confundir classe interna, entidade IFC e tipo predefinido; verificar no esquema antes de mapear (`docs/IFC_MAPPING.md`).
11. Recursos não implementados aparecem desabilitados e identificados (com a fase), nunca com ações simuladas.

## Alterações no esquema do projeto

Mudou `packages/core/src/schema.ts`? Então: incremente `SCHEMA_VERSION`, registre a migração em `serialization.ts`, atualize `services/api/hydrobim_api/models/project.py`, rode `npm run examples:generate`, atualize `docs/DOMAIN_MODEL.md` e rode os testes dos dois lados.

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
- Push e pull requests somente com autenticação disponível e autorização do responsável.
- Não versionar: `node_modules`, `dist`, `.venv`, `test-results`, credenciais.

## Regras para sessões de IA

- Comece inspecionando o repositório (`git status`, branch, remotes) e lendo este arquivo e o roadmap.
- Trabalhe somente neste repositório. Não altere outros projetos (em especial `ifc-energy`) nem configurações globais.
- Implemente a fase em andamento; planeje as seguintes sem antecipá-las sem necessidade.
- Divisão preferencial quando houver mais de um agente: arquitetura, domínio, interface e documentação com Claude; geometria, conectividade, backend, IFC e testes com Codex. Agentes não editam os mesmos arquivos simultaneamente — delimite diretórios e revise cada integração.
- Antes de concluir: `npm run check`, `npm run test:e2e` e os testes do backend; atualize a documentação afetada.
- Operações externas (push, PR, deploy, instalação global) exigem aprovação: apresente o comando e aguarde.
- Se uma ferramenta estiver indisponível, informe a limitação; não simule execuções.
