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
  schemaVersion: 18
  id, name
  discipline: 'mep' | 'infra' | 'architecture'
  units: { length: 'm', angle: 'rad' }
  createdAt, updatedAt
  systems: HydraulicSystem[]      // ao menos um; cor e visibilidade opcionais
  levels: Level[]                 // níveis/pavimentos
  families: FittingFamily[]       // famílias personalizadas (sobrepõem o catálogo)
  tankFamilies: TankFamily[]      // famílias de reservatórios personalizadas (somam-se ao catálogo)
  pumpFamilies: PumpFamily[]      // famílias de bombas personalizadas (somam-se ao catálogo)
  ifcTypes: { [chaveDoTipo]: { [Conjunto.Propriedade]: valor } }  // valores IFC do usuário por tipo
  georeference: Georeference | null   // informada pelo usuário; nunca presumida
  terrain: Terrain | null         // superfície do terreno NATURAL (TIN) com limite, linhas de quebra e procedência
  earthworks: Earthworks          // platôs e parâmetros de volume; o terreno projetado é derivado
  elements: HydroElement[]
  connections: Connection[]       // grafo de conectividade
  annotations: Annotation[]       // anotações da planta baixa
  drawingScale: number            // denominador da escala do desenho (50 = 1:50), planta do MEP
  infra: InfraSettings            // configuração da Planta Infra (independente da planta do MEP)
  views: ProjectView[]            // vistas de projeto (plantas, cortes, elevações, 3D), na ordem do navegador
  architecture: { types: ArchType[], elements: ArchElement[] }   // modelo arquitetônico (abaixo)
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

## Vistas de projeto

Uma vista é só uma forma de **mostrar** o modelo: observador, corte, recorte, escala, visibilidade e estilo. Nenhuma operação de vista altera elementos ou conexões — cortar uma vista não corta um tubo — e a representação é sempre derivada do modelo atual (nada de geometria gravada na vista). Ficam em `Project.views`, na ordem do navegador, e entram no arquivo e no histórico como o restante do projeto.

```ts
ProjectView =
  | { kind: 'plan',      ...vista2d, levelId, cutHeight, depth, archCutHeight, rotation }
  | { kind: 'section',   ...vista2d, a: Point2, b: Point2, side: 1 | -1, depth }
  | { kind: 'elevation', ...vista2d, direction: 'north' | 'south' | 'east' | 'west' }
  | { kind: '3d', id, name, visibility, camera | null, sectionBox | null, display: 'shaded' | 'wireframe' }

vista2d {
  id, name                         // nome único no projeto
  visibility: { hiddenSystemIds, hiddenCategories, details }
  scale                            // denominador da escala de documentação da vista
  style: { theme: 'color' | 'mono', thinLines }
  crop: { enabled, min, max } | null    // região de recorte, nas coordenadas da vista
  frame: { center, height } | null      // enquadramento salvo
  details: ViewDetail[]            // linhas, polilinhas, retângulos, círculos, textos e cotas
}
ViewCamera { target: Vec3, direction: Vec3, halfHeight, projection: 'perspective' | 'orthographic' }
SectionBox { enabled, min: Vec3, max: Vec3 }    // coordenadas do projeto
```

| Vista | O que define | O que mostra |
| --- | --- | --- |
| Planta (`plan`) | Nível, altura do plano de corte acima dele (`cutHeight`), profundidade abaixo do corte (`depth`) e giro (`rotation`) | O que está na faixa `[cota + cutHeight − depth, cota + cutHeight]`, cortado nos limites |
| Corte (`section`) | Linha `a`–`b` em planta (coordenadas do projeto), lado do olhar (`side`: +1 = à esquerda de `a`→`b`) e alcance (`depth`) | O que está entre a linha e o alcance, limitado às pontas da linha; o eixo vertical do desenho é a cota real |
| Elevação (`elevation`) | A fachada vista de fora | O modelo inteiro, sem corte |
| Vista 3D (`3d`) | Câmera salva (alvo, direção, ampliação, perspectiva ou ortográfica) e caixa de corte | O modelo dentro da caixa |

- **Referencial** (`viewFrameOf`): `u` aponta para a direita do desenho, `v` para cima e `w` para o observador; as coordenadas da vista são `(p − origem)·u` e `(p − origem)·v`, em metros. Na planta sem giro coincidem com X e Y do projeto; no corte a linha ocupa `x` de 0 ao comprimento dela. `viewClipPlanesOf` devolve os semiespaços que delimitam a vista; `toViewPoint`/`fromViewPoint` convertem pontos.
- **Projeção**: `viewOutline` (`packages/geometry`) leva a malha paramétrica ao referencial da vista, recorta os triângulos pelos planos e entrega o resultado à mesma projeção com linhas ocultas da planta (`planOutline`). As bordas abertas pelo corte saem como linhas visíveis.
- **Visibilidade** (`viewElementsOf`): soma-se à do sistema — o que o projeto oculta (`system.visible`) não aparece em vista nenhuma; o que a vista oculta (sistemas e categorias: tubos, conexões, válvulas, equipamentos, reservatórios) continua nas demais. A arquitetura segue as categorias paredes, pisos, telhados, portas, janelas e ambientes (`viewArchElementsOf`).
- **Corte da arquitetura em planta**: `archCutHeight` é a altura, acima do nível, do plano em que paredes, portas e janelas são cortadas (`planArchCutOf`, `viewArchClipPlanesOf`); a rede continua visível até `cutHeight`. A seção cortada vem de `sectionLoops` (`packages/geometry`).
- **Detalhes** (`ViewDetail`): `line`, `polyline` (com `closed`), `rect`, `circle`, `text` e `dimension` (estes dois com a mesma forma das anotações). Pertencem à vista em que foram desenhados e ficam nas coordenadas dela; **não** são elementos: não entram no grafo, no quantitativo, na validação da rede nem nas exportações do modelo.
- **Regras**: nome não vazio e único; planta de nível existente (excluir um nível usado por uma planta é recusado — `LEVEL_IN_USE`); linha de corte com dois pontos distintos e alcance positivo; recorte e caixa com extensão em todos os eixos; campos de outro tipo de vista são recusados (`INVALID_VIEW_PATCH`).
- **Operações** (`views.ts`): `addView`, `updateView`, `renameView`, `duplicateView` (com os detalhes, com novos identificadores), `moveView` (reordena dentro do tipo), `deleteView`; `addViewDetail`, `updateViewDetail`, `moveViewDetails`, `copyViewDetails`, `deleteViewDetails`; derivados: `planRangeOf`, `sectionFromPoints`, `defaultSectionBox`, `detailPointsOf`.
- As anotações da planta de trabalho (`Project.annotations`) continuam sendo dela; a planta de trabalho e o Modelo 3D padrão não são vistas salvas.

## Arquitetura

Paredes, lajes, revestimentos de piso, telhados, portas, janelas e ambientes ficam em `Project.architecture`, **fora** de `Project.elements`: não têm sistema hidráulico, DN, especificação de tubo nem portas e não entram no grafo de conectividade. Compartilham com a rede os níveis, as coordenadas, o histórico e as vistas. Requisitos de origem, limites e quantitativos: [ARQUITETURA.md](ARQUITETURA.md).

```ts
ArchType =                        // família com dimensões e composição, gravada no projeto
  | { category: 'wall' | 'slab' | 'flooring', ...tipo, layers: ArchLayer[] }      // espessura = soma
  | { category: 'roof', ...tipo, shape: 'shed' | 'gable', layers: ArchLayer[] }   // espessura ⟂ à água
  | { category: 'door',   ...tipo, operation, width, height, frameWidth, panelThickness, materials }
  | { category: 'window', ...tipo, operation, width, height, sillHeight, panels, frameWidth, materials }
tipo { id, name, familyId | null, generic, source | null, manufacturing, classifications[], ifcPredefinedType, ifc }
ArchLayer { id, material, thickness, function, hatch }

ArchElement =
  | { kind: 'wall',     typeId, levelId, start: Point2, end: Point2, locationLine, baseOffset, height }
  | { kind: 'slab',     typeId, levelId, boundary: Point2[], openings: { id, boundary }[], offset }   // offset = topo
  | { kind: 'flooring', typeId, levelId, boundary, openings, offset }                                 // offset = base
  | { kind: 'roof',     typeId, levelId, boundary: Point2[4], eaveEdge: 0..3, offset, slope, overhang }
  | { kind: 'door' | 'window', typeId, hostId, offset, sillHeight, hand, facing }
  | { kind: 'space',    levelId, number?, boundary, offset, height: number | null }
// comuns: id (persistente), name, properties, ifc?, meta
```

| Campo | Significado |
| --- | --- |
| `generic` / `source` | `true` = modelo genérico parametrizável (dimensões do usuário, sem produto). `false` exige `source` (fabricante, catálogo, edição, página, URL) |
| `ifcPredefinedType` | Tipo predefinido IFC da categoria; nasce da família do catálogo |
| `ifc` (tipo e ocorrência) | Valores IFC informados pelo usuário, por `Conjunto.Propriedade`; o que não foi informado fica pendente |
| `classifications` | Classificações externas (NBR 15965, SINAPI, outra), sempre informadas |
| `locationLine` | Onde a linha `start`–`end` fica na espessura: `center`, `faceLeft` ou `faceRight` (esquerda de quem vai do início ao fim) |
| `baseOffset`, `height` | A base da parede fica em cota do nível + `baseOffset` |
| `layers` | Parede: da face esquerda para a direita; laje, revestimento e telhado: de cima para baixo |
| `shape` (tipo de telhado) | `shed` = uma água; `gable` = duas águas iguais. O `ifcPredefinedType` do tipo tem de ser o correspondente (`SHED_ROOF` / `GABLE_ROOF`) |
| `boundary`, `eaveEdge` (telhado) | Retângulo de referência (anti-horário) e o lado dele que é beiral: a água cai para esse lado (uma água) ou a cumeeira é paralela a ele (duas águas) |
| `offset` (telhado) | Cota de referência em relação ao nível: a da face inferior sobre a linha do beiral do contorno |
| `slope`, `overhang` (telhado) | Inclinação das águas (rad, de 1 % a 75°) e beiral, na horizontal, para fora do contorno nos quatro lados |
| `hostId`, `offset` | Parede hospedeira e distância do início dela ao centro do vão |
| `sillHeight` | Soleira ou peitoril acima da base da parede |
| `hand`, `facing` | Lado das dobradiças e face para a qual a folha abre (+1 = esquerda da parede) |
| `height` (ambiente) | Pé-direito; `null` = não informado (sem volume) |

- **Derivados, nunca gravados** (`architecture/`): contorno da parede com os encontros em L e em T (`wallFootprint`), trecho de seção completa (`clear`), vãos (`wallOpenings`), referencial, projeção e cumeeira do telhado (`roofFrame`, `roofFootprint`, `roofRidgeLine`), cotas (`archVerticalRange`), quantidades (`wallQuantities`, `floorQuantities`, `roofQuantities`, `hostedQuantities`, `spaceQuantities`), malhas (`buildArchGeometry`, em `packages/geometry`) e o modelo de informação IFC (`buildArchIfcModel`, em `packages/ifc`).
- **Encontros**: extremidades a até 1 mm uma da outra formam canto em bisel; extremidade sobre o corpo de outra parede termina na face dela. Não há dado de encontro no arquivo: mover uma parede refaz os encontros.
- **Hospedagem**: porta e janela não têm nível nem posição próprios — herdam da parede. O vão tem de caber no trecho de seção completa, dentro da altura e sem sobrepor outro.
- **Integridade** (`archIntegrityProblem`): conferida ao fim de toda operação e ao abrir o arquivo; uma operação que deixaria a arquitetura inconsistente é recusada sem alteração parcial.
- **Operações** (`architecture/ops.ts`): `addArchType`, `duplicateArchType`, `updateArchType` (devolve as ocorrências afetadas), `removeArchType` (recusa tipo em uso), `setArchTypeIfcValue`; `addWalls` (traçado contínuo), `addFloor`, `addFloorOpening`, `removeFloorOpening`, `addSpace`, `addRoof` (contorno retangular; recusa `ROOF_BOUNDARY_INVALID` e `ROOF_SLOPE_INVALID`), `addHosted`; `moveWallEndpoint` (leva uma extremidade da parede e mantém as portas e janelas hospedadas no lugar); `trimWallsToCorner`, `trimWallToWall`, `splitWall` (a original mantém o `id`; devolve o da parede nova) e `alignArchElement` (a parede leva os encontros) — ver `docs/ARQUITETURA.md`; `updateArchElement`, `renameArchElement`, `setArchElementIfcValue`, `setArchElementProperty`, `deleteArchElements` (a parede leva os hospedados); `moveArchElements` (vão sozinho desliza na parede), `copyArchElements`, `rotateArchElements`, `mirrorArchElements`. `setArchIfcValue` (`@hydrobim/ifc`) confere o valor contra o esquema antes de gravar.
- **Telhados** (`architecture/roofs.ts`): `roofBoundaryProblem`, `roofSlopeProblem`, `normalizeRoofBoundary` (o contorno é gravado anti-horário e o índice do lado do beiral acompanha a inversão, inclusive no espelho), `slopeToPercent`/`percentToSlope`, e os apoios à edição do retângulo `rectangleFromThreePoints`, `moveRectangleCorner` e `moveRectangleEdge`. Convenções de cota, beiral e espessura em [ARQUITETURA.md](ARQUITETURA.md).
- **Quantitativo**: `computeArchQuantities` (por pavimento, categoria e tipo, com NBR 15965 e SINAPI ou "NC"; nos telhados, a área é a inclinada e `projectedArea` traz a projeção horizontal), `computeSpaceSchedule`, `archQuantitiesToCsv`.
- Excluir um nível com elementos de arquitetura é recusado (`LEVEL_IN_USE`).

## Elementos

Campos comuns:

| Campo | Significado |
| --- | --- |
| `id` | UUID persistente; nunca muda. Base do futuro GlobalId IFC |
| `kind` | `pipe`, `elbow`, `tee`, `cross`, `reducer`, `valve`, `pump`, `tank` |
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
| Cruzeta (`cross`) | `placement`, `runLength`, `branchLength` (vale para as duas derivações), `branchSpec` (cruzeta de redução) | `a`, `b` (passagem), `branch` (+Y), `branch2` (−Y). Derivação sem tubo fica livre (aviso de porta livre); só um acessório real a fecharia |
| Redução (`reducer`) | `placement`, `outletSpec`, `length` | `a` (`spec`), `b` (`outletSpec`) |
| Válvula (`valve`) | `placement`, `valveType`, `length`, `height`, `handwheelDiameter`, `width` | `a`, `b` (ventosa: só `a`; redutora de pressão: `a` = montante) |
| Bomba (`pump`) genérica | `placement`, `dischargeSpec`, `length`, `dischargeOffset`, `dischargeHeight`, ponto nominal | `a` (sucção, axial), `b` (recalque, vertical) |
| Bomba anfíbia de catálogo (`pump`, `pumpType: 'amphibious'`) | `placement`, `dischargeSpec`, `familyId`, `variantId` (linha da tabela; ausente = cotas do usuário), `stages`, `suctionFlangeClass`, `dischargeFlangeClass` e as cotas do dimensional: `length` (F), `footOffset` (C), `footSpan` (D), `rearLength` (E), `footWidth` (G), `footHoleDiameter` (ØH), `axisHeight` (I), `totalHeight` (J) | `a` (sucção, flange A, na origem) e `b` (descarga, flange B), coaxiais, a F de distância |
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
- **Cruzeta**: como o tê, com a segunda derivação em −Y. As portas `a`, `b` e `branch` têm o mesmo significado no tê e na cruzeta: a troca entre os dois preserva as ligações.
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
| `drawPipeToPipe` | Termina o trecho sobre um tubo existente: insere a peça de derivação (`junction`: `auto`/`tee` = tê; `cross` = cruzeta com a quarta porta livre) no pé da perpendicular do ponto de partida, gira a derivação para ele e leva o trecho até ela por `runToPort` (saindo da extremidade livre de um tubo alinhado, o próprio tubo é prolongado); recusa quando não há perpendicular, espaço ou compatibilidade |
| `insertInline` (tê/cruzeta em tubo flangeado) | Num tubo com flanges, prefere a peça flangeada da família (ou a da família escolhida); as faces do corte recebem o flange da família de tubos com flanges do tubo, conferida a furação (`flangesMate`). Sem peça flangeada no catálogo, a peça de bolsas sobre as pontas do corte. Dividir um tubo nunca cria flange que o catálogo não forneça |
| `runToPort` | Leva um trecho até uma porta livre, chegando pelo eixo dela (recusa `OFF_PORT_AXIS` com o desvio): prolonga o tubo de partida quando alinhado, senão tubo novo (com joelho automático). Destino flangeado: a face recebe flange de família de tubos com flanges que case; flange só com flange de mesma furação, bolsa só com ponta (`endMismatch`) |
| `convertTeeToCross`, `convertCrossToTee` (`junctions.ts`) | Troca tê ⇄ cruzeta preservando `id`, nome, sistema, propriedades e ligações (`a`, `b`, `branch`); dimensões e extremidades do catálogo (mesmo acabamento, ou a família pedida) e reconciliação dos vizinhos. A cruzeta ganha `branch2` livre. Em tê, só remove derivação livre (com só `branch` livre, gira meia volta sobre a passagem e a ligação de `branch2` passa a `branch`); com as duas ligadas, recusa sem apagar nada. Sem família, recusa (`NO_CATALOG_JUNCTION`) listando o que existe, salvo `allowGeneric`. Dados de fabricação do produto anterior são descartados, com aviso em `notes`; valores IFC da ocorrência que deixarem de se aplicar aparecem como aviso na validação IFC |
| `drawPipeToJunction`, `drawPipeFromJunction`, `junctionPortToward` | Ramal até (ou a partir de) um tê/cruzeta existente pela porta livre voltada para o ponto; no lado oposto à derivação de um tê, converte-o em cruzeta (mesmo `id`) numa única operação; `convert: false` recusa |
| `connectionGuides`, `planConnection` (`alignConnect.ts`) | "Alinhar e conectar": guias pela porta de referência (relação dos eixos, projeção, encontro, desvios horizontal e vertical, distância) e alternativas com o projeto resultante de cada uma — conectar (fechamento), alinhar (translação rígida do conjunto da extremidade, sem ligação), alinhar e conectar, e mover o equipamento (só quando solto). Alinhar é oferecido para os dois lados: o trecho em relação à porta (`align:…`) e o lado da referência em relação ao trecho (`align:target:…`), sempre como movimento rígido do conjunto ligado. Quando o conjunto inclui um equipamento, ele vai junto e a alternativa sai como `moveEquipment` (`move:align:…`), identificada e ordenada por último. Sem montagem possível como está e com os eixos desencontrados em planta, entra a alternativa `turn`: giro em torno do eixo vertical pela própria porta mais o deslocamento até o eixo da referência |
| `resizeWithReducers` | Altera o diâmetro só do elemento, inserindo/ajustando/removendo reduções; redução de bolsas junto a peça de bolsas recebe um toco de tubo entre as duas (`stubIds`), com a soma das profundidades das bolsas; junto a um flange a redução é flange × flange (recusa com `NO_FLANGED_FITTING` se o catálogo não a tiver) e a face do tubo que encosta nela recebe o flange da família de tubos com flanges |
| `applySpec` | Altera material/diâmetro, opcionalmente propagando pelo trecho até as reduções |
| `duplicatePumpFamily`, `upsertPumpFamily`, `applyPumpFamilyToInstances`, `removePumpFamily` | Famílias de bombas personalizadas: duplicar (a cópia deixa de ser do fabricante), gravar a tabela editada (recusa linhas incoerentes), reaplicar às bombas inseridas (recusa boca conectada que mudaria de DN) e excluir (as bombas mantêm forma e cotas, sem vínculo) |
| `pumpParametersFromFamily`, `setPumpFlange` | Monta os parâmetros de uma bomba de catálogo (linha da tabela ou cotas do usuário); troca a classe de pressão do flange de sucção ou de descarga |
| `placeEquipment`, `copyElements` | Posiciona bomba/reservatório; copia conjuntos preservando conexões internas |
| `upsertFamily`, `applyFamilyToInstances` | Personaliza famílias no projeto e reaplica às peças |
| `addLevel`, `addSystem`, `setGeoreference`, `setTerrain` | Dados de projeto |
| `updateFitting`, `rollFitting`, `translateElements` | Edição de conexões com reconciliação |
| `rotateElements` | Giro rígido em torno de um eixo vertical (cotas preservadas); recusa (`ROTATION_BREAKS_COUPLING`) se romper ligação com elemento fora do conjunto |
| `copyRotatedElements` | Cópia girada em torno de um eixo vertical: ligações internas copiadas, originais intactos |
| `alignElements`, `copyAlignedElements` | Alinhamento por dois pares de pontos (ALIGN do AutoCAD): origem 1 → destino 1 e giro em planta (eixo vertical, sem escala) que leva a direção origem 1 → 2 à direção destino 1 → 2 (`alignmentAngle`). Sem giro equivale a `translateElements`; com giro é rígido e recusa (`ALIGN_BREAKS_COUPLING`) se romper ligação com elemento fora do conjunto; par na mesma vertical: `ALIGN_DIRECTION_UNDEFINED` |
| `setPipeEndpoint`, `setPipeLength` | Edição de extremidades livres |
| `stretchPipe` | Estica ou encolhe o tubo por uma extremidade, livre ou conectada (a peça ligada desliza junto) |
| `inlineClearancesOf`, `inlineAxisOf` | Cotas de uma peça na linha: de cada porta conectada, o comprimento de tubo (porta a porta) até o próximo elemento que não é tubo ou até a extremidade livre, com o percurso e se ele é reto; eixo de passagem das peças com portas opostas. Derivado, não persistido |
| `setInlineClearance` | Desliza a peça até que a cota de uma extremidade valha o valor pedido (o tubo do outro lado compensa); recusa percurso não reto (`CLEARANCE_NOT_STRAIGHT`), peça encostada (`NO_PIPE_BETWEEN`) e falta de espaço (`NO_ROOM`) |
| `slideElements`, `slideAxesOf` | Desliza peças ao longo da linha: o que está acoplado acompanha rigidamente e os tubos paralelos ao deslocamento absorvem a diferença; falha com `NO_ROOM` se um tubo ficaria sem comprimento |
| `setElementElevation` | Define a cota Z do elemento (`elementElevation`: eixo no início do tubo; origem da conexão; base do reservatório). Em tubo ou conexão é um deslizamento vertical (`slideElements`): os tubos verticais ligados ao conjunto esticam ou encolhem, com a outra extremidade fixa, e o que está acoplado sem tubo vertical no caminho sobe/desce junto (sem tubo vertical que absorva, toda a rede conectada); recusa `NO_ROOM` se um tubo vertical ficaria sem comprimento. `elevationFollowers` lista o que muda de cota junto. Em bomba ou reservatório, só o equipamento se move e os tubos vizinhos se ajustam quando o acoplamento permite |
| `deleteElements`, `disconnect`, `renameElement`, `setElementProperty` | Edição geral |
| `setElementIfcValue`, `setIfcTypeValue` | Guardam ou removem um valor IFC informado pelo usuário, na ocorrência ou no tipo |

## Catálogo (`packages/catalog`)

`PipeSpecification` descreve material, norma, tipo de junta, classe de pressão e a tabela de diâmetros (`dn`, rótulo, diâmetro externo e espessura em mm). `resolvePipeSpec(id, dn)` converte para `PipeSpec` em SI. Especificações de junta elástica trazem ainda a deflexão admitida em cada junta, por faixa de DN e com a fonte (`jointDeflection`), que segue para `PipeSpec.jointDeflection` (rad, opcional); e, quando o tubo pode ser curvado a frio, o dado de curvatura (`coldBending`), que segue para `PipeSpec.coldBendRadius` e `coldBendSpan` (m, opcionais).

As dimensões padrão das conexões (`dimensions.ts`) são proporções genéricas do diâmetro externo, usadas até existir um catálogo dimensional de conexões por norma/fabricante (Fase 2).

## Evolução do esquema

Versões: **v2** — famílias, níveis, georreferência, terreno e extremidades; **v3** — tipo de válvula `pressureReducing` e largura opcional (`width`) em válvulas e tamanhos de família. **v4** — anotações da planta baixa e escala do desenho; **v5** — tipo de válvula `strainer` (filtro Y; `height` = do eixo ao ponto mais baixo do bojo) e furação opcional dos flanges (`boltCircle`, `boltCount`, `boltHoleDiameter`) nas extremidades dos elementos e nos tamanhos de família. **v6** — forma construtiva, modelo comercial, bocais adicionais e acessórios dos reservatórios (campos opcionais: documentos v5 já são válidos). **v7** — ressalto dos flanges (`raisedFaceDiameter`, `raisedFaceHeight`) e extremidades dos tubos (`ends` em `pipe`), ambos opcionais (documentos v6 já são válidos). **v8** — famílias de reservatórios personalizadas no projeto (`tankFamilies`). **v9** — valores IFC informados pelo usuário: `ifcTypes` no projeto e `ifc` (opcional) em cada elemento. **v10** — trechos retos do joelho (`straight: { a, b }`) e, nos tamanhos de família, `centerToEnd2` e `bendRadius` (curvas ponta e bolsa); em válvulas e nos tamanhos de família, `bonnetLength` (dimensão do castelo ao longo do eixo do tubo, que com `width` define o castelo retangular das gavetas). Todos opcionais (documentos v9 já são válidos). **v11** — configuração do ambiente Infra (`infra`) e referência altimétrica da georreferência (`verticalDatum`); a migração cria a configuração padrão, leva a escala da planta de um projeto Infra para a Planta Infra e deixa a referência altimétrica não informada. Documentos de versões anteriores são migrados ao abrir. O tipo `flowMeter` (medidor de vazão em linha; `height` = do eixo ao topo do cabeçote) entrou no próprio v11, ainda não publicado em commit, sem migração. **v12** — a superfície do terreno ganha limite (`boundary`), linhas de quebra (`breaklines`) e procedência (`source`); um terreno v11 é migrado como levantamento por pontos, sem limite informado e com datum, exatidão, resolução e data **não informados**. **v13** — famílias de bombas: forma construtiva (`pumpType`), linha da tabela (`variantId`), estágios, classes dos flanges e cotas do dimensional na bomba; `dischargeOffset` e `dischargeHeight` passam a opcionais (só a genérica os usa); famílias de bombas personalizadas no projeto (`pumpFamilies`, vazia nos documentos v12). **v14** — cruzeta como elemento (`cross`, portas `a`, `b`, `branch`, `branch2`) e famílias de cruzetas (`kind: 'cross'`); só acrescenta tipos (documentos v13 já são válidos). **v15** — vistas de projeto (`views`: plantas por nível, cortes, elevações e vistas 3D, com os detalhes 2D de cada uma); documentos v14 migram com a lista vazia. **v16** — modelo arquitetônico (`architecture`: tipos, paredes, lajes, revestimentos de piso, portas, janelas e ambientes), ambiente `architecture`, categorias de arquitetura na visibilidade das vistas e `archCutHeight` nas plantas; documentos v15 migram com a arquitetura vazia e o plano de corte em 1,20 m (limitado à faixa da planta). **v17** — a superfície do terreno vira elemento (`id` persistente, `tag` e `original`, a malha guardada na primeira edição) e o projeto ganha a terraplenagem (`earthworks`: platôs e parâmetros de volume); um terreno v16 recebe o identificador fixo `terreno`, identificação vazia e `original: null`, e a terraplenagem migra sem platôs e com os três parâmetros de volume **não informados**. **v18** — telhados na arquitetura: categoria de tipo `roof` (com `shape`), ocorrência `roof` e a categoria `roofs` na visibilidade das vistas; só acrescenta possibilidades — um documento v17 não tem telhados e migra mudando apenas a versão.

Ao alterar o esquema: incrementar `SCHEMA_VERSION`, registrar a migração em `MIGRATIONS` (`serialization.ts`), atualizar `services/api/hydrobim_api/models/project.py`, regenerar `examples/` (`npm run examples:generate`) e este documento.

## Terreno

```ts
Terrain {
  id                                // persistente: o mesmo nas edições e no IFC (GlobalId)
  name
  tag                               // identificação dada pelo projetista ('' = não informada)
  points: Vec3[]                    // vértices em coordenadas locais (m), arredondados a 0,1 mm
  triangles: number[]               // três índices por triângulo, anti-horário em planta
  boundary: Vec3[][] | null         // [contorno externo, ...furos]; null = envoltória convexa dos pontos
  breaklines: Vec3[][]              // arestas obrigatórias da triangulação
  source: TerrainSource
  original: TerrainMesh | null      // malha como importada, guardada na 1ª edição; null = nunca editada
}

TerrainMesh { points, triangles, boundary, breaklines }

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

- **Um terreno por projeto**, em coordenadas locais — o terreno NATURAL (o projetado é derivado dele e de `earthworks`): o sistema horizontal e a referência altimétrica são os da georreferência do projeto. Gerar outra superfície substitui a anterior (com desfazer).
- **Triangulação restrita** (`terrain/delaunay.ts`): as arestas do limite e das linhas de quebra são arestas da malha; nenhum triângulo fica fora do contorno, dentro de um furo ou atravessando uma linha de quebra. Linhas de quebra que se cruzam sem vértice comum são recusadas (`TERRAIN_BREAKLINE_CROSSING`): a cota do cruzamento não pode ser presumida.
- **Nada é inventado**: os vértices são dados de entrada. Em um DEM, são os próprios nós do raster (ou um a cada *n*); onde o raster não tem dado não há vértice nem triângulo; a única interpolação é a bilinear dentro de uma célula, para cotar os vértices do limite, e ela exige os quatro nós da célula.
- **Resolução não é exatidão**: `resolution` é o espaçamento das amostras; `verticalAccuracy` e `verticalDatum` só são preenchidos quando a fonte (ou o responsável pelo levantamento) os declara. Nenhuma conversão de datum vertical é aplicada.
- **Limite**: `MAX_TERRAIN_VERTICES` = 25.000 vértices (cerca de 2 MB no arquivo do projeto).
- **Derivados, nunca persistidos**: cota e declividade em um ponto, estatísticas, curvas de nível e cortes.
- **Intercâmbio**: `terrainExchange` entrega pontos numerados, faces por índices, limite e linhas de quebra no sistema projetado do projeto — o conteúdo de uma superfície TIN do LandXML (`Pnts`, `Faces`, `Breaklines`, `Boundaries`) e de um `IfcTriangulatedIrregularNetwork`. O escritor LandXML ainda não existe; o IFC leva o terreno como `IfcGeographicElement` (`docs/IFC_MAPPING.md`) e o DXF do modelo 3D leva a malha.
- **Edição** (`terrain/edit.ts`): `addTerrainPoint`, `moveTerrainPoint`, `setTerrainPointElevation`, `removeTerrainPoint`, `setTerrainBoundary`, `retriangulateTerrain`, `restoreOriginalTerrain`, `setTerrainProperties`. Cada operação devolve uma superfície nova com o mesmo `id` e guarda a malha original na primeira edição. Mudar a posição de um ponto ou o limite refaz a triangulação pelo construtor da importação; trocar só a cota não muda a malha. O limite novo tem de ficar dentro da superfície e é cotado por ela. Lacunas do DEM continuam abertas (um ponto cotado posto em uma lacuna a preenche em volta dele). Os índices dos pontos valem para a superfície recebida: depois de uma operação que refaz a triangulação a ordem pode mudar.

## Terraplenagem

```ts
Earthworks {
  platforms: Platform[]             // na ordem de execução: cada um é aplicado sobre o resultado dos anteriores
  swellPercent: number | null       // empolamento (%): V solto = V corte in situ × (1 + e ÷ 100)
  compactionFactor: number | null   // m³ de aterro COMPACTADO obtidos de 1 m³ de corte IN SITU
  reusePercent: number | null       // parcela (%) do corte que serve para os aterros
}

Platform {
  id, name
  outline: Point2[]                 // perímetro em planta, anti-horário, sem repetir o primeiro vértice
  elevation                         // cota de implantação (Z local)
  cutSlope, fillSlope               // taludes H:V (metros na horizontal por metro na vertical)
}
```

Regras (ver `docs/INFRA.md`, seção Terraplenagem):

- **O projeto guarda só os parâmetros.** O terreno projetado (`designSurfaceFor`), os taludes, a linha de encontro com o terreno, os volumes e os sólidos de corte e de aterro são derivados da superfície natural e dos platôs — nunca gravados. A superfície natural não é alterada pelos platôs.
- **Parâmetros de volume não informados ficam `null`**, e as quantidades que dependem deles (solto, aproveitável, balanço, empréstimo, excedente) ficam pendentes: empolamento e fator de conversão dependem do solo e não são presumidos.
- **Estados de volume**: corte = in situ; aterro = compactado; solto = corte × (1 + empolamento). O balanço é feito em m³ compactados; nenhuma soma mistura estados sem conversão (`earthworkQuantities`).
- **Operações** (`terrain/earthworks.ts`): `addPlatform`, `updatePlatform`, `removePlatform`, `setEarthworkSettings`. Um platô só é gravado se puder ser gerado sobre o terreno atual; se o terreno mudar depois e o platô deixar de caber, ele fica fora do terreno projetado e dos volumes, com a pendência `PLATFORM_NOT_GENERATED` na validação.

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
