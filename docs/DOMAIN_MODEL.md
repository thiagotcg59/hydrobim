# Modelo de domínio

Fonte única de verdade: [`packages/core/src/schema.ts`](../packages/core/src/schema.ts) (Zod). Os tipos TypeScript são inferidos do esquema; o backend o espelha em Pydantic.

## Unidades e convenções

| Grandeza | Unidade interna | Apresentação |
| --- | --- | --- |
| Comprimento, coordenadas | metro (m) | m ou mm, convertidos em `units.ts` |
| Ângulo | radiano | graus |
| Diâmetro nominal (DN) | adimensional (designação da norma) | rótulo comercial (`sizeLabel`) |

- Sistema destro com **Z para cima**. A elevação de um ponto é a sua coordenada Z (eixo da tubulação).
- **DN não é diâmetro físico.** `PipeSpec` guarda separadamente `dn`, `outerDiameter`, `innerDiameter` e `wallThickness`, todos resolvidos a partir do catálogo.

## Projeto

```ts
Project {
  format: 'hydrobim-project'
  schemaVersion: 4
  id, name
  discipline: 'mep' | 'infra'
  units: { length: 'm', angle: 'rad' }
  createdAt, updatedAt
  systems: HydraulicSystem[]      // ao menos um; cor e visibilidade opcionais
  levels: Level[]                 // níveis/pavimentos
  families: FittingFamily[]       // famílias personalizadas (sobrepõem o catálogo)
  georeference: Georeference | null   // informada pelo usuário; nunca presumida
  terrain: Terrain | null         // TIN em coordenadas locais
  elements: HydroElement[]
  connections: Connection[]       // grafo de conectividade
  annotations: Annotation[]       // anotações da planta baixa
  drawingScale: number            // denominador da escala do desenho (50 = 1:50)
}
```

## Anotações da planta baixa

Vivem no plano XY do projeto, em metros (`Point2 { x, y }`), e fazem parte do documento do projeto (salvas, exportadas, desfeitas/refeitas com ele).

| Tipo (`kind`) | Campos | O que é derivado |
| --- | --- | --- |
| `dimension` | `a`, `b`, `offset`, `mode` (`aligned`, `horizontal`, `vertical`) | Valor cotado (distância em planta, ΔX ou ΔY), linhas de chamada e posição do texto |
| `text` | `position`, `text`, `rotation`, `leader?` | Com `leader`, é uma chamada: linha com seta até o ponto indicado |
| `tag` | `elementId`, `position` | Conteúdo: designação comercial e comprimento (tubos) ou nome e designação (demais) |

- `offset` é o afastamento da linha de cota em relação ao ponto `a`, na normal à direção cotada.
- A etiqueta é removida junto com o elemento; etiqueta órfã é erro de validação (`DANGLING_ANNOTATION`).
- `drawingScale` define o tamanho de textos, traços e cotas (2,5 mm de papel para o texto), tanto na tela quanto no SVG exportado.
- Operações: `addAnnotation`, `updateAnnotation`, `deleteAnnotations`, `setDrawingScale`; derivados: `dimensionGeometry`, `tagText`, `planSnapPoints` (`annotations.ts`).
- A projeção em planta dos elementos é derivada da malha paramétrica (`planOutline`, em `packages/geometry`).

## Elementos

Campos comuns:

| Campo | Significado |
| --- | --- |
| `id` | UUID persistente; nunca muda. Base do futuro GlobalId IFC |
| `kind` | `pipe`, `elbow`, `tee`, `reducer`, `valve`, `pump`, `tank` |
| `familyId` | Família de catálogo que originou as dimensões; `null` = genéricas ou editadas à mão |
| `name` | Nome editável (ex.: "Tubo 3") |
| `systemId` | Sistema hidráulico ao qual pertence |
| `spec` | Especificação dimensional (`PipeSpec`) |
| `properties` | Propriedades BIM livres (texto, número, booleano) |
| `manufacturing` | Fabricante, modelo e código (opcionais) |
| `meta` | `createdAt`, `updatedAt`, `revision` (histórico básico) |

Parâmetros específicos:

| Tipo | Parâmetros | Portas |
| --- | --- | --- |
| Tubo (`pipe`) | `start`, `end` (o comprimento é calculado) | `start`, `end` |
| Joelho (`elbow`) | `placement`, `angle` (deflexão), `bendRadius` | `a`, `b` |
| Tê (`tee`) | `placement`, `runLength`, `branchLength`, `branchSpec` (tê de redução) | `a`, `b` (passagem), `branch` |
| Redução (`reducer`) | `placement`, `outletSpec`, `length` | `a` (`spec`), `b` (`outletSpec`) |
| Válvula (`valve`) | `placement`, `valveType`, `length`, `height`, `handwheelDiameter`, `width` | `a`, `b` (ventosa: só `a`; redutora de pressão: `a` = montante) |
| Bomba (`pump`) | `placement`, `dischargeSpec`, `length`, `dischargeOffset`, `dischargeHeight`, ponto nominal | `a` (sucção), `b` (recalque) |
| Reservatório (`tank`) | `placement`, `diameter`, `height`, alturas dos bocais | `a` (saída), `b` (entrada) |

`placement = { position, rotation }` define o referencial local da conexão (quaternion unitário).

### Referenciais locais

Todas as conexões seguem a mesma convenção: a porta `a` fica em −X e o eixo X local segue o sentido de quem entra pela porta `a`.

- **Tubo**: origem em `start`, X ao longo do eixo.
- **Joelho**: origem no **vértice teórico** (interseção das linhas de centro). Porta `a` em `(−L, 0, 0)`, porta `b` em `L·(cos θ, sin θ, 0)`, com `L = R·tan(θ/2)`.
- **Tê**: origem no centro; passagem ao longo de X; derivação em +Y.
- **Redução e válvula**: origem no centro; haste da válvula em +Z.

### Extremidades (`ends`)

Cada conexão guarda, por porta, o acabamento da extremidade: `{ type: 'plain' | 'socket' | 'flange', length, outerDiameter }`. Em bolsas, `length` é a profundidade além da porta (sobre o tubo); em flanges, a espessura da face para dentro. A porta fica no fundo da bolsa ou na face do flange.

## Famílias

`FittingFamily` descreve uma linha de produto: tipo (`elbow`, `tee`, `reducer`, `valve`), especificação de tubo, tipo de extremidade, ângulo (joelhos) ou tipo (válvulas), fabricante, norma, **fonte** e a tabela de tamanhos. As operações recebem um `FittingCatalog` (`createFamilyCatalog(famílias, preferências)`), que devolve as dimensões da família ou, na falta dela, proporções genéricas com `familyId: null`. Ver [catálogos](CATALOGS.md).

## O que é derivado (nunca persistido)

| Derivado | Função | Motivo |
| --- | --- | --- |
| Portas (posição, direção, especificação) | `getPorts(element)` | Não podem divergir da geometria |
| Estado de conexão de uma porta | `findConnection`, `getFreePorts` | Vive apenas no grafo |
| Comprimento do tubo | `pipeLength` | É geométrico |
| Geometria 3D | `buildElementGeometry` | É função dos parâmetros |
| Estado de validação | `validateProject` | Não pode ficar desatualizado |

## Conectividade

```ts
Connection { id, a: PortRef, b: PortRef }
PortRef    { elementId, portId }
```

Regras impostas por `connectPorts`:

- portas de elementos distintos, existentes e livres (uma porta participa de no máximo uma conexão);
- mesma especificação (`specificationId`) — especificações diferentes exigem peça de transição;
- mesmo DN — diâmetros diferentes exigem redução;
- posições coincidentes (tolerância de 0,5 mm) e direções opostas (tolerância de 0,5°).

Conexões são sempre explícitas e exatas. `autoConnectElement` só conecta portas que já satisfazem todas as regras.

## Operações (`operations.ts`)

Todas são funções puras `(Project, entrada) → Result<Project | Created>`.

| Operação | Efeito |
| --- | --- |
| `addPipe` | Cria um tubo e conecta extremidades exatamente acopladas |
| `drawPipe` | Desenha a partir de uma porta: continuação reta, joelho automático (apara o tubo) ou recusa fora do eixo de conexões |
| `attachFitting` | Acopla joelho, tê, redução ou válvula a uma porta livre |
| `insertInline` | Divide um tubo e insere tê ou válvula; o tubo original mantém o id |
| `resizeWithReducers` | Altera o diâmetro só do elemento, inserindo/ajustando/removendo reduções |
| `applySpec` | Altera material/diâmetro, opcionalmente propagando pelo trecho até as reduções |
| `placeEquipment`, `copyElements` | Posiciona bomba/reservatório; copia conjuntos preservando conexões internas |
| `upsertFamily`, `applyFamilyToInstances` | Personaliza famílias no projeto e reaplica às peças |
| `addLevel`, `addSystem`, `setGeoreference`, `setTerrain` | Dados de projeto |
| `updateFitting`, `rollFitting`, `translateElements` | Edição de conexões com reconciliação |
| `setPipeEndpoint`, `setPipeLength` | Edição de extremidades livres |
| `deleteElements`, `disconnect`, `renameElement`, `setElementProperty` | Edição geral |

## Catálogo (`packages/catalog`)

`PipeSpecification` descreve material, norma, tipo de junta, classe de pressão e a tabela de diâmetros (`dn`, rótulo, diâmetro externo e espessura em mm). `resolvePipeSpec(id, dn)` converte para `PipeSpec` em SI.

As dimensões padrão das conexões (`dimensions.ts`) são proporções genéricas do diâmetro externo, usadas até existir um catálogo dimensional de conexões por norma/fabricante (Fase 2).

## Evolução do esquema

Versões: **v2** — famílias, níveis, georreferência, terreno e extremidades; **v3** — tipo de válvula `pressureReducing` e largura opcional (`width`) em válvulas e tamanhos de família. Documentos v1 e v2 são migrados ao abrir.

Ao alterar o esquema: incrementar `SCHEMA_VERSION`, registrar a migração em `MIGRATIONS` (`serialization.ts`), atualizar `services/api/hydrobim_api/models/project.py`, regenerar `examples/` (`npm run examples:generate`) e este documento.

## Análises e exportações (derivadas do modelo)

| Função | Resultado |
| --- | --- |
| `computeQuantities`, `quantitiesToCsv` | Quantitativo por sistema, especificação, diâmetro e família |
| `exportEpanet` | Rede em formato INP, com a lista de pendências a revisar |
| `detectClashes` | Tubos cujas paredes externas se interpenetram |
| `parseTerrainPoints`, `createTerrain`, `terrainElevationAt` | Terreno triangulado (TIN) |
| `buildProfile` | Perfil longitudinal com cota do terreno e recobrimento |
| `exportIfc` (`@hydrobim/ifc`) | Arquivo IFC 4.3 |
