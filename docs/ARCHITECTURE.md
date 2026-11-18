# Arquitetura

## Princípio central

O HydroBIM mantém um **modelo paramétrico próprio**. O IFC não é o formato interno: é um formato de intercâmbio produzido por uma camada de serialização (Fase 3). Isso permite editar componentes sem reconstruir um arquivo IFC a cada operação.

Três consequências orientam todo o código:

1. **O domínio não conhece renderização nem interface.** `packages/*` não podem importar Three.js, React ou Zustand (regra do ESLint).
2. **Geometria e portas são derivadas dos parâmetros**, nunca armazenadas. Não há como a malha ou um ponto de conexão divergir do elemento.
3. **Conectividade é um grafo separado** (`Project.connections`), independente da geometria renderizada.

## Camadas

```
┌───────────────────────────── apps/web ─────────────────────────────┐
│ ui/         componentes React (barras, painéis, diálogos)          │
│ viewport/   cena React Three Fiber + tradução de eventos de ponteiro│
│ editor/     regras de apontamento/snapping (funções puras)         │
│ state/      store Zustand (estado de edição) e casos de uso        │
│ persistence/ repositório de projetos (interface + localStorage)    │
└───────────────┬──────────────────┬──────────────────┬──────────────┘
                │                  │                  │
        packages/geometry   packages/catalog          │
        (malhas locais)     (especificações)          │
                └────────┬─────────┘                  │
                   packages/core  ◄───────────────────┘
        (esquema, portas, conectividade, operações, validação, JSON)

services/api (Python)  — valida o mesmo documento JSON; exportará IFC (Fase 3)
```

| Responsabilidade | Onde |
| --- | --- |
| Modelo de domínio (esquema, tipos, unidades) | `packages/core/src/schema.ts`, `units.ts`, `math.ts` |
| Operações paramétricas | `packages/core/src/operations.ts` |
| Conectividade | `packages/core/src/ports.ts`, `connectivity.ts` |
| Validação | `packages/core/src/validation.ts` |
| Geometria | `packages/geometry` |
| Catálogos | `packages/catalog` |
| Renderização | `apps/web/src/viewport` |
| Interface | `apps/web/src/ui` |
| Persistência | `apps/web/src/persistence`, `packages/core/src/serialization.ts` |
| Exportação IFC | `packages/ifc` (cliente); verificação em `services/api/tests` |
| Exportação DXF (planta anotada e modelo 3D) | `packages/dxf` (cliente) |
| Quantitativo, EPANET, interferências, terreno, perfil | `packages/core/src/quantities.ts`, `epanet.ts`, `analysis.ts` |

## Fluxo de uma edição

1. O usuário clica no viewport. `InteractionController` converte o evento em um raio e chama `pickPoint` (`editor/picking.ts`), que resolve o ponto 3D e o tipo de snap (porta, grade, eixo, vertical). Na planta baixa, `PlanView` faz o mesmo com `pickPlanPoint`/`planPipeHit` (`editor/planPicking.ts`): o clique só informa X e Y; a cota Z vem da elevação de desenho (nível + elevação do eixo), da âncora ou da porta capturada. As duas vistas entregam o mesmo evento (`ViewportClick`) à store e usam a mesma trava de ângulo (`deflectionConstraintOf` + `constrainDeflection`).
2. A store (`state/editorStore.ts`) recebe um evento de domínio (`handleViewportClick`, `commitPoint`) e chama uma **operação pura** de `@hydrobim/core`.
3. A operação devolve um novo `Project` imutável ou um erro de domínio (`Result<T>`), com mensagem em português.
4. A store registra o projeto anterior no histórico (desfazer/refazer) ou exibe o erro na barra de status. O projeto nunca fica em estado parcial.
5. React re-renderiza apenas os elementos cujo objeto mudou; `ElementMesh` regenera a malha a partir de `buildElementGeometry`.
6. `validateProject` é recalculado a partir do modelo e exibido na barra de status.

## Convenções geométricas

- Sistema destro, **Z para cima**, comprimentos em metros e ângulos em radianos (ver [modelo de domínio](DOMAIN_MODEL.md)).
- Cada elemento tem um referencial local; a geometria é gerada nesse referencial e posicionada por uma transformação. Isso preserva a precisão `float32` da GPU quando as coordenadas forem grandes (redes georreferenciadas).
- Orientação determinística (`frameFromDirection`): X local na direção do eixo, Z local o mais próximo possível do Z global.

## Reconciliação topológica

Quando uma conexão muda de dimensão ou posição, `reconcile` restabelece o acoplamento: tubos vizinhos ajustam a extremidade conectada; conexões vizinhas são transladadas rigidamente e propagam o ajuste. Se o acoplamento não puder ser preservado (um giro, um tubo que ficaria sem comprimento, um conjunto super-restringido), a operação inteira falha e nada é alterado.

## Persistência

- Documento JSON versionado (`format: "hydrobim-project"`, `schemaVersion`), validado por Zod ao abrir, com verificação referencial e ponto de extensão para migrações (`serialization.ts`).
- `ProjectRepository` abstrai o armazenamento. Hoje: `LocalStorageProjectRepository`. A interface é assíncrona para ser substituída por uma implementação sobre a API (PostgreSQL) sem alterar o editor.

## Backend

`services/api` espelha o esquema com Pydantic (chaves camelCase idênticas) e repete as validações estruturais. Os testes do backend carregam todos os arquivos de `examples/`, garantindo que os dois lados do contrato permaneçam compatíveis, e verificam com IfcOpenShell os arquivos IFC gerados pelo cliente. A exportação IFC em si é feita no navegador por `packages/ifc` (ver ADR-017).

## Limites conhecidos da arquitetura atual

- Elementos em lista: buscas são lineares. Adequado ao porte do MVP; indexar por id quando houver milhares de elementos.
- Uma malha por elemento. Para redes grandes será necessário instanciamento e níveis de detalhe.
- Sem deslocamento de origem da cena: necessário antes do georreferenciamento (Fase 5).
- O contrato TypeScript ↔ Python é mantido manualmente e protegido por testes; avaliar geração a partir de JSON Schema quando o esquema crescer.
