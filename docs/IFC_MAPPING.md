# Mapeamento IFC

> **Estado: exportação e camada BIM implementadas** em `packages/ifc` (escritor IFC-SPF em TypeScript, executado no navegador) e verificada com IfcOpenShell nos testes do backend (`services/api/tests/test_ifc_export.py`). A importação IFC não está implementada. Detalhes do que é emitido: `packages/ifc/README.md`. Este documento registra o mapeamento adotado e o que foi conferido no esquema.

## Esquema alvo

- **Principal: IFC 4.3** (`IFC4X3_ADD2`, ISO 16739-1:2024).
- **Compatibilidade futura: IFC 4** (`IFC4`), mediante testes de interoperabilidade.

### O que foi verificado

As entidades e enumerações abaixo foram consultadas diretamente no esquema embutido no **IfcOpenShell 0.9.0** (`ifcopenshell_wrapper.schema_by_name`), em `IFC4X3_ADD2` e `IFC4`. Trata-se de verificação de **existência e definição no esquema**; nenhum arquivo IFC foi gerado ainda. A semântica de uso (relações recomendadas, conjuntos de propriedades) deve ser reconferida na documentação da buildingSMART durante a Fase 3.

| Entidade | IFC4X3_ADD2 | IFC4 | Supertipo |
| --- | --- | --- | --- |
| `IfcPipeSegment` | sim | sim | `IfcFlowSegment` |
| `IfcPipeFitting` | sim | sim | `IfcFlowFitting` |
| `IfcValve` | sim | sim | `IfcFlowController` |
| `IfcPump` | sim | sim | `IfcFlowMovingDevice` |
| `IfcDistributionSystem` | sim | sim | `IfcSystem` |
| `IfcDistributionPort` | sim | sim | `IfcPort` |
| `IfcRelConnectsPorts` | sim | sim | `IfcRelConnects` |
| `IfcRelNests` | sim | sim | `IfcRelDecomposes` |
| `IfcRelConnectsPortToElement` | sim | sim | `IfcRelConnects` |
| `IfcRelAssignsToGroup` | sim | sim | `IfcRelAssigns` |
| `IfcMapConversion`, `IfcProjectedCRS` | sim | sim | — |
| `IfcFacility` | sim | **não** | `IfcSpatialStructureElement` |
| `IfcSweptDiskSolid`, `IfcExtrudedAreaSolid`, `IfcRevolvedAreaSolid`, `IfcCircleHollowProfileDef` | sim | sim | — |

Enumerações (valores idênticos nos dois esquemas, salvo indicação):

- `IfcPipeSegmentTypeEnum`: CULVERT, FLEXIBLESEGMENT, GUTTER, RIGIDSEGMENT, SPOOL, USERDEFINED, NOTDEFINED.
- `IfcPipeFittingTypeEnum`: BEND, CONNECTOR, ENTRY, EXIT, JUNCTION, OBSTRUCTION, TRANSITION, USERDEFINED, NOTDEFINED.
- `IfcValveTypeEnum`: AIRRELEASE, ANTIVACUUM, CHANGEOVER, CHECK, COMMISSIONING, DIVERTING, DOUBLECHECK, DOUBLEREGULATING, DRAWOFFCOCK, FAUCET, FLUSHING, GASCOCK, GASTAP, ISOLATING, MIXING, PRESSUREREDUCING, PRESSURERELIEF, REGULATING, SAFETYCUTOFF, STEAMTRAP, STOPCOCK, USERDEFINED, NOTDEFINED.
- `IfcDistributionSystemEnum` (trecho relevante): DOMESTICCOLDWATER, DOMESTICHOTWATER, FIREPROTECTION, WATERSUPPLY, DRAINAGE, SEWAGE, STORMWATER, RAINWATER, WASTEWATER, USERDEFINED, NOTDEFINED.
- `IfcDistributionPortTypeEnum`: CABLE, CABLECARRIER, DUCT, PIPE, USERDEFINED, NOTDEFINED (IFC 4.3 acrescenta WIRELESS).
- `IfcFlowDirectionEnum`: SOURCE, SINK, SOURCEANDSINK, NOTDEFINED.

## Não confundir os três níveis

| Nível | Exemplo |
| --- | --- |
| Classe interna do HydroBIM (`kind`) | `elbow`, `tee`, `reducer`, `valve` |
| Entidade IFC | `IfcPipeFitting`, `IfcValve` |
| Tipo predefinido IFC (`PredefinedType`) | `BEND`, `JUNCTION`, `TRANSITION`, `ISOLATING` |

Um joelho **não** é uma entidade `IfcElbow` (inexistente): é um `IfcPipeFitting` com `PredefinedType = BEND`.

## Mapeamento dos elementos

| HydroBIM | Entidade IFC | PredefinedType | Observações |
| --- | --- | --- | --- |
| `pipe` | `IfcPipeSegment` | `RIGIDSEGMENT` | Tubo liso: sólido extrudado. Tubo com flanges: malha (`Tessellation`); os flanges não são entidades separadas |
| `elbow` | `IfcPipeFitting` | `BEND` | Ângulo e raio em propriedades |
| `tee` | `IfcPipeFitting` | `JUNCTION` | Três portas |
| `reducer` | `IfcPipeFitting` | `TRANSITION` | Diâmetros distintos por porta |
| `valve` (`gate`, `ball`, `butterfly`) | `IfcValve` | `ISOLATING` | O mecanismo não tem valor na enumeração: registrar em propriedade/`ObjectType` |
| `valve` (`globe`) | `IfcValve` | `REGULATING` | A confirmar com a prática de projeto |
| `valve` (`check`) | `IfcValve` | `CHECK` | — |
| `valve` (`airRelease`) | `IfcValve` | `AIRRELEASE` | Porta única |
| `valve` (`pressureReducing`) | `IfcValve` | `PRESSUREREDUCING` | Porta `a` = montante; `FlowDirection` ainda `NOTDEFINED` |
| `valve` (`strainer`) | `IfcFilter` | `STRAINER` | Filtro Y: classe interna `valve` (peça em linha), mas entidade IFC própria; porta `a` = montante |
| `pump` | `IfcPump` | `ENDSUCTION` | Representação genérica |
| `tank` | `IfcTank` | `STORAGE` | Reservatórios de catálogo têm `IfcTankType` e conjuntos de propriedades (abaixo) |

Sistemas:

| `SystemKind` | `IfcDistributionSystem.PredefinedType` |
| --- | --- |
| `domesticColdWater` | `DOMESTICCOLDWATER` |
| `domesticHotWater` | `DOMESTICHOTWATER` |
| `fireProtection` | `FIREPROTECTION` |
| `waterSupply` | `WATERSUPPLY` |
| `other` | `USERDEFINED` |

Os elementos serão associados ao sistema por `IfcRelAssignsToGroup`.

## Modelo de informação IFC (camada BIM)

`buildIfcModel(project, { families, tankFamilies })` deriva do projeto tudo o que a aba **BIM / IFC** mostra e o que `exportIfc` grava: classificação, `Ifc…Type`, conjuntos de propriedades e de quantidades, portas, materiais e sistemas. As definições ficam no registro central `packages/ifc/src/bim/definitions.ts`.

### De onde vêm as definições oficiais

`packages/ifc/src/bim/schemaData.ts` é **gerado** por `services/api/scripts/generate_ifc_schema_data.py` a partir do esquema `IFC4X3_ADD2` e dos modelos de conjuntos de propriedades (`ifcopenshell.util.pset`) do IfcOpenShell 0.9.0.post1: entidades, supertipos, tipos predefinidos e, para cada `Pset_*`/`Qto_*`, a aplicabilidade e o tipo de valor e a enumeração de cada propriedade. O registro não declara o tipo de uma propriedade padronizada — lê-o dessa tabela — e referir uma propriedade que o esquema não tem faz o módulo falhar ao carregar. As descrições dos tipos predefinidos usadas na classificação foram lidas em `ifcopenshell.util.doc` (a documentação online da buildingSMART respondeu 403 na data da implementação).

### Tipos (`Ifc…Type`)

Todo elemento tem um tipo, ligado por `IfcRelDefinesByType`: `IfcPipeSegmentType`, `IfcPipeFittingType`, `IfcValveType`, `IfcFilterType`, `IfcPumpType`, `IfcTankType`, com o mesmo `PredefinedType` da ocorrência e o tipo interno em `ElementType`. Ocorrências do mesmo produto (mesma família, especificação, diâmetros, dimensões e dados de fabricação) compartilham o tipo. Os conjuntos do tipo ficam em `HasPropertySets`; o material é associado às ocorrências e aos tipos.

### Conjuntos por categoria

`T` = no tipo; `O` = na ocorrência. Sem indicação de origem, o valor é derivado do modelo; "usuário" = campo editável, sem valor até ser informado; **exigida** = requisito do perfil do projeto (aparece como *Pendente*).

| Categoria | Conjunto | Propriedades |
| --- | --- | --- |
| Todos (exceto reservatório de catálogo) | `Pset_ManufacturerTypeInformation` (T) | `Manufacturer` (**exigida**), `ModelLabel`, `ModelReference`, `ArticleNumber` — do cadastro (`manufacturing`) ou da família; editáveis |
| Todos | `HydroBIM_Especificacao` (O) | Designação, DN, diâmetros, parede, norma, classe de pressão (designação), junta, material, família; comprimento e flanges (tubo); ângulo e raio (joelho); saída (redução) |
| Todos | `HydroBIM_Propriedades` (O) | Propriedades livres do usuário |
| Tubo | `Pset_PipeSegmentTypeCommon` (T) | `Reference`, `NominalDiameter`, `OuterDiameter`, `InnerDiameter`, `WorkingPressure` (usuário, **exigida**) |
| Tubo | `Pset_PipeSegmentTypeCommon` (O) | `Status` (usuário), `Length` |
| Tubo com flange | `Pset_PipeConnectionFlanged` (T) | `FlangeStandard`, `FlangeDiameter`, `FlangeThickness`, `NumberOfBoltholes`, `BoltholePitch` |
| Tubo | `Pset_PipeSegmentOccurrence` (O) | `InteriorRoughnessCoefficient` (usuário), `Gradient` (só trechos inclinados), `InvertElevation` (geratriz inferior interna no ponto mais baixo) |
| Tubo | `HydroBIM_Tracado` (O) | `StartX/Y`, `StartElevation`, `EndX/Y`, `EndElevation`, `Slope` (com sinal) |
| Tubo | `Qto_PipeSegmentBaseQuantities` (O) | `Length`, `GrossCrossSectionArea`, `NetCrossSectionArea`, `OuterSurfaceArea` (corpo cilíndrico) |
| Conexão | `Pset_PipeFittingTypeCommon` (T) | `Reference`, `PressureClass` (usuário, **exigida**), `FittingLossFactor` (usuário) |
| Conexão | `Pset_PipeFittingTypeCommon` (O), `Pset_PipeFittingOccurrence` (O) | `Status`, `InteriorRoughnessCoefficient` (usuário) |
| Conexão | `HydroBIM_Conexao` (T) | `FittingType`, `EndTypes`, `NumberOfPorts`, `BranchNominalDiameter`, `CenterToEnd`, `RunLength`, `BranchLength`, `Length` |
| Conexão | `Qto_PipeFittingBaseQuantities` (O) | `Length` (eixo de porta a porta), áreas da seção da porta A |
| Válvula | `Pset_ValveTypeCommon` (T) | `Reference`, `ValvePattern`, `ValveMechanism`, `ValveOperation` (**exigida**, exceto retenção), `Size`, `WorkingPressure` (usuário, **exigida**), `TestPressure`, `FlowCoefficient`, `CloseOffRating` (usuário) |
| Válvula | `Pset_ValveTypeCommon` (O) | `Status` (usuário) |
| Válvula de bloqueio | `Pset_ValveTypeIsolating` (O) | `IsNormallyOpen` (usuário) |
| Ventosa | `Pset_ValveTypeAirRelease` (T) | `IsAutomatic` (usuário) |
| Redutora de pressão | `Pset_ValveTypePressureReducing` (O) | `UpstreamPressure`, `DownstreamPressure` (usuário; a de jusante é **exigida**) |
| Válvula, filtro, bomba | `Pset_ElementSize` (T) | `NominalLength`, `NominalHeight`, `NominalWidth` (o que a família tabula) |
| Válvula | `HydroBIM_Valvula` (T) | `ValveType`, `EndTypes`, `HandwheelDiameter` |
| Filtro Y | `Pset_FilterTypeCommon` (T/O), `HydroBIM_Filtro` (T) | `Reference`, `NominalFlowrate`, `NominalPressureDrop`, `Status` (usuário); tipo, extremidades e diâmetro |
| Bomba | `Pset_PumpTypeCommon` (T/O) | `ConnectionSize`, `NominalRotationSpeed` (usuário, **exigida**), `NetPositiveSuctionHead`, `Status` (usuário) |
| Bomba | `Pset_PumpOccurrence` (O) | `BaseType`, `DriveConnectionType`, `ImpellerDiameter` (usuário) |
| Bomba | `HydroBIM_Bomba` (T) | `PumpType`, diâmetros de sucção e recalque, `RatedFlow` e `RatedHead` (do cadastro, **exigidas**), `RatedPower` (usuário, **exigida**), `Efficiency`, `CasingMaterial` (usuário) |
| Reservatório genérico | `Pset_TankTypeCommon` (T) | `PatternType`, `NominalLengthOrDiameter`, `NominalWidthOrDiameter`, `NominalDepth`, `TankNominalCapacity` (**exigida**) |
| Todos, exceto tubo | `HydroBIM_Posicao` (O) | `X`, `Y`, `Z` da origem do elemento |
| Porta | `Pset_DistributionPortCommon`, `Pset_DistributionPortTypePipe` | `PortNumber`; `ConnectionType`, `ConnectionSubtype`, `NominalDiameter`, `InnerDiameter`, `OuterDiameter` |

Observações:

- **Pressões não são derivadas da classe.** "PN 10", "Classe 15 (0,75 MPa)" e "K9" são designações e ficam em `HydroBIM_Especificacao.PressureClass` (`IfcLabel`). `WorkingPressure` e `PressureClass` do conjunto padrão são `IfcPressureMeasure` (Pa) e só recebem valor informado pelo usuário.
- **`ConnectionType`** usa `PEnum_PipeEndStyleTreatment`: flange → `FLANGED`; rosca → `THREADED`; solda de topo e termofusão → `WELDED`; junta soldável (adesivo) e ponta e bolsa com junta elástica não têm item próprio → `OTHER`, com a descrição em `ConnectionSubtype`.
- **Mecanismo da válvula de gaveta**: o esquema distingue `WEDGEGATE`, `PARALLELSLIDE` e `CONFIGUREDGATE`; o cadastro não — o campo fica a informar. `ValveOperation = WHEEL` só quando a família tabula o diâmetro do volante.
- **O IFC 4.3 não tem** `Pset_PipeFittingTypeBend`/`Junction` (existiam no IFC 4): ângulo, raio e dimensões das conexões vão em conjuntos próprios.
- **Pesos** (`GrossWeight`, `NetWeight`) não são emitidos: as famílias não os trazem. Por isso `Qto_ValveBaseQuantities`, `Qto_PumpBaseQuantities` e `Qto_FilterBaseQuantities` (que só têm peso) não aparecem.
- **Unidades**: metro, m², m³, radiano, segundo, pascal, watt, m³/s (`VOLUMETRICFLOWRATEUNIT`) e s⁻¹ (`ROTATIONALFREQUENCYUNIT`).
- A origem de cada valor (geometria, cadastro, catálogo, usuário, não informado) é mostrada na aba BIM / IFC; no arquivo só é gravada para os reservatórios (`HydroBIM_Reservatorio_OrigemDosParametros`).

### Biblioteca

`classifyLibrary` atribui entidade, tipo predefinido e entidade de tipo a todas as famílias: conexões e válvulas, tubos com flanges, reservatórios e a biblioteca de produtos PBA.

| Produto | Entidade / tipo predefinido | Justificativa (texto do IFC 4.3) |
| --- | --- | --- |
| Curva | `IfcPipeFitting` / `BEND` | Duas portas; muda a direção do escoamento |
| Tê, cruzeta, colar de tomada | `IfcPipeFitting` / `JUNCTION` | Mais de duas portas; redistribui o escoamento |
| Luvas | `IfcPipeFitting` / `CONNECTOR` | Une duas portas (ex.: luva entre dois tubos) |
| Redução, adaptador DEFoFo × PBA | `IfcPipeFitting` / `TRANSITION` | Duas portas de formas ou tamanhos diferentes |
| Cap | `IfcPipeFitting` / `USERDEFINED` (`CAP`) | `OBSTRUCTION` descreve peças de duas portas (crivo, placa perfurada); não há valor para tampão |
| Anéis de vedação | `IfcDiscreteAccessory` / `USERDEFINED` (`SEALINGRING`) | Acessório incluído em outro elemento; a enumeração não tem valor para anel de vedação |

Medidores, sensores, atuadores e caixas de válvulas ainda não existem como elementos nem como famílias: não há o que classificar. As entidades correspondentes (`IfcFlowMeter`, `IfcSensor`, `IfcActuator`, `IfcDistributionChamberElement`) já estão na tabela do esquema para quando existirem.

### Validação e IDS

`validateIfcModel` separa os requisitos **normativos** do IFC 4.3 (`schema`: entidade e tipo predefinido existentes, `USERDEFINED` com `ObjectType`, conjunto padronizado aplicável à entidade, propriedade e tipo de valor do esquema, valores coerentes com o tipo, GlobalIds válidos e únicos, portas conectadas coincidentes e opostas) dos requisitos **do projeto** (`project`: propriedades exigidas não informadas → *pendente*; valores do usuário que deixaram de se aplicar; coerência entre capacidade nominal e volume geométrico; comprimento × distância entre portas).

`exportIds` publica o perfil de requisitos em IDS 1.0 (uma especificação por classe e por restrição de tipo predefinido, com as propriedades exigidas). O perfil é o do registro de propriedades; ainda não é editável pelo usuário.

## Reservatórios de catálogo

Entidades e atributos conferidos no esquema `IFC4X3_ADD2` do IfcOpenShell 0.9.0; nomes e tipos das propriedades padrão conferidos nos modelos de conjuntos de propriedades do IFC 4.3 (`ifcopenshell.util.pset`).

| Item | No IFC |
| --- | --- |
| Ocorrência | `IfcTank`, `PredefinedType = STORAGE` (valores de `IfcTankTypeEnum`: BASIN, BREAKPRESSURE, EXPANSION, FEEDANDEXPANSION, OILRETENTIONTRAY, PRESSUREVESSEL, STORAGE, VESSEL, USERDEFINED, NOTDEFINED) |
| Tipo | `IfcTankType` (`STORAGE`), ligado por `IfcRelDefinesByType`. Um tipo por modelo comercial (ocorrências iguais compartilham); dimensões personalizadas geram um tipo por ocorrência |
| Material | `IfcMaterial` "Aço-carbono estrutural" (categoria `steel`), associado às ocorrências e aos tipos — não o material da tubulação dos bocais |
| Geometria | `IfcTriangulatedFaceSet` por parte (corpo, acessórios, revestimento, bocais), no referencial local do elemento |
| `Pset_<Fabricante>_Reservatorio` (ex.: `Pset_TRAMEC_Reservatorio`) | `Manufacturer`, `Model`, `ReservoirType`, `BottomType`, `InstallationType`, `Material` (`IfcLabel`); `NominalCapacity` (`IfcVolumeMeasure`, m³); `TotalHeight`, `Diameter`, `Length`, `ColumnHeight`, `ColumnDiameter`, `ConeHeight`, `ShellThickness` (`IfcPositiveLengthMeasure`); `SupportHeight` (`IfcNonNegativeLengthMeasure`); `NumberOfCompartments` (`IfcInteger`); `CatalogReference` (`IfcText`); `BaseElevation`, `MaxWaterLevelElevation` (`IfcLengthMeasure`) |
| `Pset_TankOccurrence` (padrão) | `TankComposition` = ELEMENT, `HasLadder` |
| `Pset_TankTypeCommon` (padrão, no tipo) | `Reference`, `AccessType`, `NominalLengthOrDiameter`, `NominalWidthOrDiameter`, `NominalDepth`, `TankNominalCapacity`, `PatternType`, `EndShapeType`, `NumberOfSections` |
| `Pset_ManufacturerTypeInformation` (padrão, no tipo) | `Manufacturer`, `ModelLabel`, `ModelReference`, `AssemblyPlace` (SITE no montado na obra) |
| `HydroBIM_Reservatorio_Quantidades` (`IfcElementQuantity`) | `NominalCapacity`, `GeometricVolume` (`IfcQuantityVolume`); `TotalHeight`, `Diameter`, `Length` (`IfcQuantityLength`); `ProjectedArea` (`IfcQuantityArea`) |
| `HydroBIM_Reservatorio_OrigemDosParametros` | Origem de cada parâmetro: catálogo, derivado do catálogo, estimado (representação) ou definido pelo usuário |
| Bocais | `IfcDistributionPort` (`PIPE`), posicionado e orientado no referencial do reservatório; `FlowDirection` = `SINK` na entrada e `SOURCE` na saída, no extravasor e na descarga; `Pset_DistributionPortTypePipe` (`NominalDiameter`, `InnerDiameter`, `OuterDiameter`) e `HydroBIM_Bocal` (`Function`, `NominalDiameterLabel`, `HeightAboveBase`, `Azimuth`, `Specification`) |

Observações:

- **Propriedade sem valor = dado não informado.** `ShellThickness`, `ColumnHeight` etc. aparecem em todo reservatório, mas ficam sem `NominalValue` quando o catálogo não traz o dado e o usuário não o informou.
- No IFC 4.3 a capacidade nominal do conjunto padrão chama-se **`TankNominalCapacity`** (e não `NominalCapacity`).
- `NominalDiameter` do bocal é a designação DN expressa como comprimento (convenção do IFC); os diâmetros físicos vêm da especificação de tubo do bocal — o DN não é usado para derivá-los.
- O prefixo `Pset_` é reservado pela buildingSMART aos conjuntos padronizados; `Pset_TRAMEC_Reservatorio` usa-o por requisito do projeto. O `ifcopenshell.validate` não acusa erro; ferramentas de verificação mais estritas podem apontar o nome.
- `Qto_TankBaseQuantities` (pesos e área total) não é emitido: o catálogo não informa pesos.
- A referência do catálogo e a origem dos parâmetros dependem das famílias, passadas a `exportIfc` em `tankFamilies` (o pacote `ifc` não depende do catálogo).

## Portas e conectividade

- Cada porta do HydroBIM vira um `IfcDistributionPort` (`PredefinedType = PIPE`, `SystemType` conforme o sistema), posicionado no referencial local do elemento.
- Vínculo porta ↔ elemento: no IFC 4.3 o padrão a adotar é `IfcRelNests`; `IfcRelConnectsPortToElement` ainda existe no esquema, mas é tratado como legado pela documentação do IFC 4.3 — **confirmar na Fase 3** antes de escolher.
- Cada `Connection` vira um `IfcRelConnectsPorts` entre as duas portas.
- `FlowDirection`: `NOTDEFINED` enquanto o HydroBIM não modelar sentido de escoamento — exceto nos bocais de reservatório, cuja função é conhecida.

## Estrutura do arquivo a exportar

1. `IfcProject` com `IfcUnitAssignment` (metro, radiano) e contextos geométricos (`Model`/`Body`, eventualmente `Axis`).
2. Estrutura espacial: `IfcSite` → `IfcBuilding` → `IfcBuildingStorey` para MEP; para Infra, avaliar `IfcFacility`/`IfcFacilityPart` (existem apenas no IFC 4.3).
3. Elementos com `IfcLocalPlacement` derivado do referencial local e contidos por `IfcRelContainedInSpatialStructure`.
4. Geometria (a decidir e testar em visualizadores):
   - tubo: `IfcExtrudedAreaSolid` com `IfcCircleHollowProfileDef`, ou `IfcSweptDiskSolid` com `InnerRadius`;
   - joelho: `IfcRevolvedAreaSolid` (perfil oco) ou `IfcSweptDiskSolid` sobre arco;
   - tê, redução e válvula: composição de sólidos ou malha (`IfcTriangulatedFaceSet`) gerada a partir de `packages/geometry`.
5. Propriedades: conjuntos padrão quando existirem (ex.: `Pset_PipeSegmentTypeCommon`) e um conjunto próprio `HydroBIM_*` para DN, norma, classe de pressão e propriedades livres. Os nomes dos Psets padrão devem ser conferidos na Fase 3.
6. Identificadores: `GlobalId` de 22 caracteres derivado de forma determinística do UUID do elemento (`ifcopenshell.guid.compress`), para que reexportações preservem a identidade.

## Georreferenciamento (Infra)

`IfcMapConversion` + `IfcProjectedCRS` só serão emitidos quando o usuário informar explicitamente o sistema de referência. **Nenhum código EPSG ou coordenada geográfica será atribuído por padrão.**

## Verificação automática

Os testes do backend abrem os arquivos IFC de `examples/` (gerados por `npm run examples:generate`) com IfcOpenShell e conferem: contagem de entidades por classe e tipo predefinido, portas e `IfcRelConnectsPorts` equivalentes ao grafo, sistema e unidades, e validade do arquivo (`ifcopenshell.validate`).

## Limitações conhecidas da exportação atual

- As anotações da planta baixa (cotas, textos, chamadas e etiquetas) não são exportadas; o mapeamento para `IfcAnnotation` não foi verificado no esquema e fica para uma fase posterior.
- Conexões, válvulas e equipamentos são exportados como malhas trianguladas (`IfcTriangulatedFaceSet`); apenas os tubos são sólidos paramétricos.
- No reservatório, `HydroBIM_Especificacao` descreve a tubulação dos bocais de entrada e saída.
- O IDS exportado não foi conferido contra o XSD da buildingSMART nem com o `ifctester`; o perfil de requisitos é fixo (não editável) e não há importação de IDS.
- `Pset_DistributionSystemCommon` não é emitido; os sistemas trazem nome e tipo predefinido.
- `FlowDirection` das portas é `NOTDEFINED`, exceto nos bocais de reservatório.
- Não há importação IFC: a "reimportação" dos reservatórios é verificada pelos testes do backend, que reabrem o arquivo com IfcOpenShell e conferem classe, tipo, material, propriedades, portas e a malha tesselada contra o projeto.
- O arquivo foi validado com `ifcopenshell.validate` e tesselado com `ifcopenshell.geom`; ainda não foi testado em visualizadores e ferramentas de autoria de terceiros.
