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
- **Mudança de direção sem peça.** Duas portas acopladas têm de estar opostas, admitido o desvio que o fabricante permite: `deflectionAllowance` devolve o maior entre a deflexão da junta elástica (menor `PipeSpec.jointDeflection` dos dois lados) e a curvatura a frio do tubo (só entre dois tubos: trecho mais curto, limitado a `coldBendSpan`, dividido por `coldBendRadius`, até 22,5° por vértice). Com flange ou sem o dado, o limite é 0. Dentro do limite, `drawPipe` conecta o tubo direto, sem joelho; a validação acusa `DIRECTION_MISMATCH` acima dele. A porta de tubo informa o comprimento do trecho (`run`, derivado).
- **Tubulação contínua.** `pipeRunOf(project, pipeId)` devolve, em ordem de percurso, os tubos ligados direto uns aos outros (porta de tubo com porta de tubo); qualquer peça interrompe a sequência. É derivada do grafo — nada é persistido e cada trecho mantém o seu `id`. A interface seleciona e apresenta a sequência como um tubo só; quantitativos e exportações continuam por trecho.

## Projeto

```ts
Project {
  format: 'hydrobim-project'
  schemaVersion: 12
  id, name
  discipline: 'mep' | 'infra'
  units: { length: 'm', angle: 'rad' }
  createdAt, updatedAt
  systems: HydraulicSystem[]      // ao menos um; cor e visibilidade opcionais
  levels: Level[]                 // níveis/pavimentos
  families: FittingFamily[]       // famílias personalizadas (sobrepõem o catálogo)
  tankFamilies: TankFamily[]      // famílias de reservatórios personalizadas (somam-se ao catálogo)
  ifcTypes: { [chaveDoTipo]: { [Conjunto.Propriedade]: valor } }  // valores IFC do usuário por tipo
  georeference: Georeference | null   // informada pelo usuário; nunca presumida
  terrain: Terrain | null         // superfície do terreno (TIN) com limite, linhas de quebra e procedência
  elements: HydroElement[]
  connections: Connection[]       // grafo de conectividade
  annotations: Annotation[]       // anotações da planta baixa
  drawingScale: number            // denominador da escala do desenho (50 = 1:50), planta do MEP
  infra: InfraSettings            // configuração da Planta Infra (independente da planta do MEP)
}
```

## Georreferência e ambiente Infra

```ts
Georeference {
  crsName, epsg | null            // sistema projetado informado pelo usuário
  eastings, northings             // E e N da origem local (m)
  orthogonalHeight                // altitude do ponto de cota local Z = 0 (m)
  rotation                        // eixo X local em relação ao leste, anti-horário (rad)
  verticalDatum: string | null    // referência altimétrica; null = não informada
}

InfraSettings {
  drawingScale                    // escala de documentação da Planta Infra (1000 = 1:1.000)
  basemap: { sourceId | null, visible, opacity }   // null = fundo técnico
  layers: { network, equipment, terrain, references, annotations }
  labels: { names, lengths, elevations }
}
```

- A conversão local → projetado é a do `IfcMapConversion` exportado (escala 1): `E = eastings + x·cos − y·sin`, `N = northings + x·sin + y·cos`.
- Derivados (`geo/`): `findProjectedCrs(epsg)` (registro dos sistemas com transformação implementada), `georeferenceStatus(georeference)` (`pending`, `unsupported`, `invalid`, `ready` com a cadeia de transformações), `createGeoTransform`, `gridFactors` (fator de escala e convergência). Nada disso é persistido.
- `sourceId` é só a escolha da fonte de mapa; o registro de provedores fica no editor (`apps/web/src/map`). Zoom, centro e origem de renderização são estado de sessão.
- Operações: `setGeoreference`, `setInfraSettings` (mescla parcial; recusa escala não positiva e opacidade fora de 0–1).
- Ver [ambiente Infra](INFRA.md).

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
| Tubo (`pipe`) | `start`, `end` (o comprimento é calculado); `ends` opcional (tubo com flanges) | `start`, `end` |
| Joelho (`elbow`) | `placement`, `angle` (deflexão), `bendRadius`, `straight` opcional (trechos retos entre o arco e as portas `a`/`b`, nas curvas ponta e bolsa) | `a`, `b` |
| Tê (`tee`) | `placement`, `runLength`, `branchLength`, `branchSpec` (tê de redução) | `a`, `b` (passagem), `branch` |
| Redução (`reducer`) | `placement`, `outletSpec`, `length` | `a` (`spec`), `b` (`outletSpec`) |
| Válvula (`valve`) | `placement`, `valveType`, `length`, `height`, `handwheelDiameter`, `width` | `a`, `b` (ventosa: só `a`; redutora de pressão: `a` = montante) |
| Bomba (`pump`) | `placement`, `dischargeSpec`, `length`, `dischargeOffset`, `dischargeHeight`, ponto nominal | `a` (sucção), `b` (recalque) |
| Reservatório (`tank`) | `placement`, `diameter`, `height`, alturas dos bocais; forma construtiva e bocais adicionais (abaixo) | `a` (saída), `b` (entrada) e uma porta por bocal adicional |

`placement = { position, rotation }` define o referencial local da conexão (quaternion unitário).

### Reservatórios

Sem `tankType`, o reservatório é o cilindro vertical genérico. Com `tankType` (`gobletWet`, `gobletDry`, `tubular`, `australian`, `verticalGround`, `verticalConeLegs`, `fieldErected`, `horizontal`), a geometria segue a forma construtiva; `familyId` aponta a família de catálogo e `variantId`, o modelo comercial (ausente = dimensões personalizadas). Todos os campos novos são opcionais.

| Campo | Significado |
| --- | --- |
| `diameter` | Diâmetro do corpo (da taça, nas taças) |
| `height` | Altura de catálogo: total acima da base — no australiano, altura do costado; no horizontal, apoio + diâmetro (recalculada) |
| `nominalCapacity` | Capacidade nominal (m³) |
| `columnHeight`, `columnDiameter` | Taças: coluna, da base ao início da transição cônica |
| `coneHeight` | Transição cônica (taças) ou fundo cônico |
| `supportHeight`, `supportType` | Pés ou longarina (`legs`/`skid`) |
| `length` | Horizontal: comprimento de tampo a tampo |
| `shellThickness` | Espessura das chapas, só quando o usuário informa |
| `compartments`, `maxWaterLevel` | Células internas; nível máximo acima da base |
| `accessories` | Escada (e posição), gaiola, guarda-corpo (e altura), boca de visita |
| `nozzles[]` | Bocais adicionais: `id` (= identificador da porta), `role` (`inlet`, `outlet`, `overflow`, `drain`), `height`, `azimuth`, `spec` |

- Referencial: base em z = 0 (a **cota da base** é `placement.position.z`), eixo vertical em Z; a saída `a` fica em +X e a entrada `b` em −X; no horizontal, o eixo do cilindro é X e essas portas ficam nos tampos. Um bocal adicional sai na direção `azimuth`, na cota `height`, a partir da superfície do corpo naquela cota.
- Derivados (`tanks.ts`): `tankLayout` (topo, base do costado, fundo do volume de água), `tankGeometricVolume`, `tankHydraulics` (cilindro equivalente para o EPANET), `tankNozzlePorts`, `tankProblem` (coerência dos parâmetros; vira `INVALID_TANK` em `validateProject`) e `tankParameterOrigins` (catálogo, derivado, estimado ou usuário).
- Famílias (`TankFamily`, em `schema.ts`): `origin: 'builtin'` no catálogo embutido e `'custom'` nas do projeto (`basedOn` aponta a família de origem). `duplicateTankFamily`, `upsertTankFamily` (só personalizadas; valida cada linha), `applyTankFamilyToInstances` e `removeTankFamily`. Numa família personalizada nenhum valor é classificado como *catálogo*.
- Operações: `placeEquipment` com `parameters` de `tankParametersFromFamily`; `setTankModel` (troca de família/modelo preservando `id`, bocais e conexões); `updateFitting` (dimensões — alterar uma dimensão de catálogo mantém a família e desfaz o vínculo com o modelo comercial); `updateTankSettings` (apoio, células, espessura, nível máximo, acessórios); `addTankNozzle`, `updateTankNozzle`, `removeTankNozzle` (bocal conectado não é removido nem redimensionado).

### Referenciais locais

Todas as conexões seguem a mesma convenção: a porta `a` fica em −X e o eixo X local segue o sentido de quem entra pela porta `a`.

- **Tubo**: origem em `start`, X ao longo do eixo.
- **Joelho**: origem no **vértice teórico** (interseção das linhas de centro). Porta `a` em `(−L, 0, 0)`, porta `b` em `L·(cos θ, sin θ, 0)`, com `L = R·tan(θ/2)`.
- **Tê**: origem no centro; passagem ao longo de X; derivação em +Y.
- **Redução e válvula**: origem no centro; haste da válvula em +Z.

### Extremidades (`ends`)

Cada conexão guarda, por porta, o acabamento da extremidade: `{ type: 'plain' | 'socket' | 'flange', length, outerDiameter }`. Em bolsas, `length` é a profundidade além da porta (sobre o tubo); em flanges, a espessura da face para dentro. A porta fica no fundo da bolsa ou na face do flange.

Em flanges, a extremidade pode trazer a furação (`boltCircle`, `boltCount`, `boltHoleDiameter`) e o ressalto da face (`raisedFaceDiameter`, `raisedFaceHeight`), quando tabulados; a altura do ressalto está incluída em `length`.

**Tubos com flanges.** O tubo também pode ter `ends`, com as chaves `start` e `end` (só `flange`; ausente = ponta lisa). A porta continua em `start`/`end` — agora a face do flange —, de modo que o comprimento é medido entre as portas. `familyId` identifica a família de tubos flangeados (catálogo embutido) que forneceu o flange; sem flanges, `ends` não existe e `familyId` é `null`.

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
| Classificação IFC, tipos, conjuntos de propriedades e quantidades | `buildIfcModel` (`@hydrobim/ifc`) | São função do modelo; só os valores digitados pelo usuário são guardados |
| Conformidade IFC e pendências de informação | `validateIfcModel` (`@hydrobim/ifc`) | Não pode ficar desatualizada |

## Informação IFC (`@hydrobim/ifc`)

A classificação IFC, os tipos (`Ifc…Type`), os conjuntos de propriedades e as quantidades **não são persistidos**: `buildIfcModel(project)` os deriva do modelo a cada consulta ou exportação (ver [mapeamento IFC](IFC_MAPPING.md)). O projeto guarda apenas o que o usuário informou na aba BIM / IFC:

| Onde | Conteúdo | Vale para |
| --- | --- | --- |
| `element.ifc` (opcional) | `{ 'Conjunto.Propriedade': valor }` em SI; a chave `Description` substitui a descrição gerada | Esta ocorrência |
| `project.ifcTypes` | `{ chaveDoTipo: { 'Conjunto.Propriedade': valor } }` | Todas as ocorrências do mesmo tipo, inclusive as criadas depois |

- A **chave do tipo** (`ifcTypeKey`) reúne o que define o produto — família, especificação, diâmetros, dimensões e dados de fabricação — e nada da ocorrência (posição, nome, sistema). Mudar a dimensão de um elemento muda o seu tipo.
- Só propriedades cadastrais são editáveis. As ligadas à geometria ou ao catálogo (`binding`) são recalculadas do modelo; editar um valor IFC nunca altera a geometria.
- Operações: `setIfcValue` (`@hydrobim/ifc`, confere a propriedade e o valor contra o esquema IFC 4.3) sobre `setElementIfcValue` e `setIfcTypeValue` (`operations.ts`).
- Um valor guardado que deixe de se aplicar (o elemento mudou de tipo, por exemplo) não é exportado e aparece como aviso na validação IFC.

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
| `insertInline` | Divide um tubo e insere tê ou válvula; o tubo original mantém o id; em tubo com flanges, cada trecho conserva o flange da sua extremidade |
| `setPipeEnds` | Define as extremidades do tubo (flange/ponta lisa em `start` e `end`) com o flange resolvido pelo catálogo; recusa flange menor que o tubo ou que não caiba no comprimento |
| `drawPipeFromPipe` | Parte de um ponto sobre um tubo existente: insere o tê em linha nesse ponto, com a derivação voltada para o ponto final (só vale a componente perpendicular ao tubo); com `targetPipeId`, termina em outro tubo com um segundo tê |
| `drawPipeToPipe` | Termina o trecho sobre um tubo existente: insere o tê em linha no pé da perpendicular do ponto de partida, gira a derivação para ele e acopla o novo tubo (derivação no diâmetro do trecho); recusa quando não há perpendicular, espaço ou compatibilidade |
| `resizeWithReducers` | Altera o diâmetro só do elemento, inserindo/ajustando/removendo reduções |
| `applySpec` | Altera material/diâmetro, opcionalmente propagando pelo trecho até as reduções |
| `placeEquipment`, `copyElements` | Posiciona bomba/reservatório; copia conjuntos preservando conexões internas |
| `upsertFamily`, `applyFamilyToInstances` | Personaliza famílias no projeto e reaplica às peças |
| `addLevel`, `addSystem`, `setGeoreference`, `setTerrain` | Dados de projeto |
| `updateFitting`, `rollFitting`, `translateElements` | Edição de conexões com reconciliação |
| `setPipeEndpoint`, `setPipeLength` | Edição de extremidades livres |
| `stretchPipe` | Estica ou encolhe o tubo por uma extremidade, livre ou conectada (a peça ligada desliza junto) |
| `slideElements`, `slideAxesOf` | Desliza peças ao longo da linha: o que está acoplado acompanha rigidamente e os tubos paralelos ao deslocamento absorvem a diferença; falha com `NO_ROOM` se um tubo ficaria sem comprimento |
| `setElementElevation` | Define a cota Z do elemento (`elementElevation`: eixo no início do tubo; origem da conexão; base do reservatório). Em tubo ou conexão, todos os elementos conectados sobem/descem juntos, rigidamente; em bomba ou reservatório, só o equipamento se move e os tubos vizinhos se ajustam quando o acoplamento permite |
| `deleteElements`, `disconnect`, `renameElement`, `setElementProperty` | Edição geral |
| `setElementIfcValue`, `setIfcTypeValue` | Guardam ou removem um valor IFC informado pelo usuário, na ocorrência ou no tipo |

## Catálogo (`packages/catalog`)

`PipeSpecification` descreve material, norma, tipo de junta, classe de pressão e a tabela de diâmetros (`dn`, rótulo, diâmetro externo e espessura em mm). `resolvePipeSpec(id, dn)` converte para `PipeSpec` em SI. Especificações de junta elástica trazem ainda a deflexão admitida em cada junta, por faixa de DN e com a fonte (`jointDeflection`), que segue para `PipeSpec.jointDeflection` (rad, opcional); e, quando o tubo pode ser curvado a frio, o dado de curvatura (`coldBending`), que segue para `PipeSpec.coldBendRadius` e `coldBendSpan` (m, opcionais).

As dimensões padrão das conexões (`dimensions.ts`) são proporções genéricas do diâmetro externo, usadas até existir um catálogo dimensional de conexões por norma/fabricante (Fase 2).

## Evolução do esquema

Versões: **v2** — famílias, níveis, georreferência, terreno e extremidades; **v3** — tipo de válvula `pressureReducing` e largura opcional (`width`) em válvulas e tamanhos de família. **v4** — anotações da planta baixa e escala do desenho; **v5** — tipo de válvula `strainer` (filtro Y; `height` = do eixo ao ponto mais baixo do bojo) e furação opcional dos flanges (`boltCircle`, `boltCount`, `boltHoleDiameter`) nas extremidades dos elementos e nos tamanhos de família. **v6** — forma construtiva, modelo comercial, bocais adicionais e acessórios dos reservatórios (campos opcionais: documentos v5 já são válidos). **v7** — ressalto dos flanges (`raisedFaceDiameter`, `raisedFaceHeight`) e extremidades dos tubos (`ends` em `pipe`), ambos opcionais (documentos v6 já são válidos). **v8** — famílias de reservatórios personalizadas no projeto (`tankFamilies`). **v9** — valores IFC informados pelo usuário: `ifcTypes` no projeto e `ifc` (opcional) em cada elemento. **v10** — trechos retos do joelho (`straight: { a, b }`) e, nos tamanhos de família, `centerToEnd2` e `bendRadius` (curvas ponta e bolsa); em válvulas e nos tamanhos de família, `bonnetLength` (dimensão do castelo ao longo do eixo do tubo, que com `width` define o castelo retangular das gavetas). Todos opcionais (documentos v9 já são válidos). **v11** — configuração do ambiente Infra (`infra`) e referência altimétrica da georreferência (`verticalDatum`); a migração cria a configuração padrão, leva a escala da planta de um projeto Infra para a Planta Infra e deixa a referência altimétrica não informada. Documentos de versões anteriores são migrados ao abrir. O tipo `flowMeter` (medidor de vazão em linha; `height` = do eixo ao topo do cabeçote) entrou no próprio v11, ainda não publicado em commit, sem migração. **v12** — a superfície do terreno ganha limite (`boundary`), linhas de quebra (`breaklines`) e procedência (`source`); um terreno v11 é migrado como levantamento por pontos, sem limite informado e com datum, exatidão, resolução e data **não informados**.

Ao alterar o esquema: incrementar `SCHEMA_VERSION`, registrar a migração em `MIGRATIONS` (`serialization.ts`), atualizar `services/api/hydrobim_api/models/project.py`, regenerar `examples/` (`npm run examples:generate`) e este documento.

## Terreno

```ts
Terrain {
  name
  points: Vec3[]                    // vértices em coordenadas locais (m), arredondados a 0,1 mm
  triangles: number[]               // três índices por triângulo, anti-horário em planta
  boundary: Vec3[][] | null         // [contorno externo, ...furos]; null = envoltória convexa dos pontos
  breaklines: Vec3[][]              // arestas obrigatórias da triangulação
  source: TerrainSource
}

TerrainSource {
  kind: 'survey' | 'dem'
  provider                          // serviço, formato ou "Pontos XYZ"
  dataset: string | null            // arquivo ou conjunto de dados
  horizontalCrs: string | null      // sistema em que o dado foi recebido (ex.: EPSG:3857)
  verticalDatum: string | null      // referência altimétrica DECLARADA pela fonte
  resolution: number | null         // espaçamento (m) das amostras do raster usadas; null em levantamentos
  verticalAccuracy: number | null   // exatidão altimétrica DECLARADA (m)
  acquiredAt: string | null         // ISO 8601
  attribution: string | null
  notes: string | null              // ressalvas da fonte (sobreamostragem, lacunas, datum misto)
}
```

Regras (ver `docs/INFRA.md`, seção Superfície do terreno):

- **Um terreno por projeto**, em coordenadas locais: o sistema horizontal e a referência altimétrica são os da georreferência do projeto. Gerar outra superfície substitui a anterior (com desfazer).
- **Triangulação restrita** (`terrain/delaunay.ts`): as arestas do limite e das linhas de quebra são arestas da malha; nenhum triângulo fica fora do contorno, dentro de um furo ou atravessando uma linha de quebra. Linhas de quebra que se cruzam sem vértice comum são recusadas (`TERRAIN_BREAKLINE_CROSSING`): a cota do cruzamento não pode ser presumida.
- **Nada é inventado**: os vértices são dados de entrada. Em um DEM, são os próprios nós do raster (ou um a cada *n*); onde o raster não tem dado não há vértice nem triângulo; a única interpolação é a bilinear dentro de uma célula, para cotar os vértices do limite, e ela exige os quatro nós da célula.
- **Resolução não é exatidão**: `resolution` é o espaçamento das amostras; `verticalAccuracy` e `verticalDatum` só são preenchidos quando a fonte (ou o responsável pelo levantamento) os declara. Nenhuma conversão de datum vertical é aplicada.
- **Limite**: `MAX_TERRAIN_VERTICES` = 25.000 vértices (cerca de 2 MB no arquivo do projeto).
- **Derivados, nunca persistidos**: cota e declividade em um ponto, estatísticas, curvas de nível e cortes.
- **Intercâmbio**: `terrainExchange` entrega pontos numerados, faces por índices, limite e linhas de quebra no sistema projetado do projeto — o conteúdo de uma superfície TIN do LandXML (`Pnts`, `Faces`, `Breaklines`, `Boundaries`) e de um `IfcTriangulatedIrregularNetwork`. Os escritores LandXML e IFC do terreno ainda não existem; o DXF do modelo 3D já leva a malha.
## Análises e exportações (derivadas do modelo)

| Função | Resultado |
| --- | --- |
| `computeQuantities`, `quantitiesToCsv` | Quantitativo por sistema, especificação, diâmetro e família |
| `exportEpanet` | Rede em formato INP, com a lista de pendências a revisar |
| `buildIfcModel`, `validateIfcModel`, `exportIfc`, `exportIds` (`@hydrobim/ifc`) | Modelo de informação IFC 4.3, sua validação, o arquivo IFC e o perfil de requisitos em IDS |
| `detectClashes` | Tubos cujas paredes externas se interpenetram |
| `parseTerrainPoints`, `parseBreaklines`, `createTerrain`, `buildSurveySurface`, `buildTerrainSurface` | Superfície do terreno (TIN) de um levantamento, com área de recorte e linhas de quebra |
| `rasterFrame`, `demSurfacePoints`, `sampleRaster` | DEM em raster posicionado pela georreferência e os pontos cotados da área |
| `terrainElevationAt`, `terrainHitAt`, `terrainStats` | Cota, declividade e estatísticas da superfície |
| `terrainContours`, `terrainProfile` | Curvas de nível e corte longitudinal do terreno |
| `validatePolygon`, `parseGeoJsonPolygons`, `polygonToGeoJson` | Área de recorte (contorno e furos) e GeoJSON |
| `terrainExchange` | Estrutura de intercâmbio da superfície (DXF 3D, LandXML, IFC) |
| `buildProfile` | Perfil longitudinal com cota do terreno e recobrimento |
| `exportIfc` (`@hydrobim/ifc`) | Arquivo IFC 4.3 |
