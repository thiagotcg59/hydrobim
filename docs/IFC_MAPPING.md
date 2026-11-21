# Mapeamento IFC

> **Estado: exportação e camada BIM implementadas** em `packages/ifc` (escritor IFC-SPF em TypeScript, executado no navegador) e verificada com IfcOpenShell nos testes do backend (`services/api/tests/test_ifc_export.py`). A importação IFC não está implementada. Detalhes do que é emitido: `packages/ifc/README.md`. Este documento registra o mapeamento adotado e o que foi conferido no esquema.

## Esquema alvo

- **Principal: IFC 4.3.2.0** (`IFC4X3_ADD2`, ISO 16739-1:2024), para a rede e para a arquitetura.
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
| `cross` | `IfcPipeFitting` | `JUNCTION` | Quatro portas (`IfcDistributionPort` cada), `ObjectType` = `cross`; `HydroBIM_Conexao.NumberOfPorts` = 4. Mesma junção do tê no esquema: a enumeração não distingue tê de cruzeta (conferido em `schemaData.ts`). Derivação livre exportada como porta sem `IfcRelConnectsPorts` |
| `reducer` | `IfcPipeFitting` | `TRANSITION` | Diâmetros distintos por porta |
| `valve` (`gate`, `ball`, `butterfly`) | `IfcValve` | `ISOLATING` | O mecanismo não tem valor na enumeração: registrar em propriedade/`ObjectType` |
| `valve` (`globe`) | `IfcValve` | `REGULATING` | A confirmar com a prática de projeto |
| `valve` (`check`) | `IfcValve` | `CHECK` | — |
| `valve` (`airRelease`) | `IfcValve` | `AIRRELEASE` | Porta única |
| `valve` (`pressureReducing`) | `IfcValve` | `PRESSUREREDUCING` | Porta `a` = montante; `FlowDirection` ainda `NOTDEFINED` |
| `valve` (`strainer`) | `IfcFilter` | `STRAINER` | Filtro Y: classe interna `valve` (peça em linha), mas entidade IFC própria; porta `a` = montante |
| `valve` (`flowMeter`) | `IfcFlowMeter` | `WATERMETER` | Medidor de vazão em linha (macromedidor): classe interna `valve`, mas entidade IFC própria; porta `a` = montante |
| `pump` (genérica) | `IfcPump` | `ENDSUCTION` | Representação genérica |
| `pump` anfíbia de catálogo (`pumpType: 'amphibious'`) | `IfcPump` | `SUBMERSIBLEPUMP` | Motobomba de motor submerso, em linha, que opera submersa ou a seco; é o tipo do esquema que a descreve (conferido em `schemaData.ts`). O `IfcPumpType` leva o modelo do fabricante; as cotas do dimensional entram na chave do tipo |
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

## Aparência (cores e materiais de apresentação)

Cada item geométrico do corpo (`IfcExtrudedAreaSolid` do tubo liso, `IfcTriangulatedFaceSet` de cada parte) recebe um `IfcStyledItem` com o acabamento que a vista 3D do editor usa naquela parte. A biblioteca é a mesma (`packages/geometry/src/finishes.ts`, função `partFinish`): cor do material do tubo ou do papel da parte, substituída pela cor do sistema hidráulico quando ela existe — menos nas partes de cor fixa (acionamento, inox, vedação, revestimento interno). Sem esses estilos os visualizadores mostram o modelo todo em branco.

| Editor (material físico) | IFC 4.3 (`IfcSurfaceStyleRendering`, `ReflectanceMethod = PHYSICAL`) |
| --- | --- |
| cor (`#rrggbb`) | `SurfaceColour` e `DiffuseColour` (`IfcColourRgb`, canais de 0 a 1) |
| metalicidade | `SpecularColour` como `IfcNormalisedRatioMeasure` |
| rugosidade | `SpecularHighlight` como `IfcSpecularRoughness` |

O `IfcSurfaceStyle` leva o nome do acabamento («PVC marrom», «Epóxi azul»…), vale para os dois lados (`BOTH`) e é compartilhado por todos os itens de mesmo acabamento. A cor é dado de apresentação: o `IfcMaterial` continua sendo o material de engenharia. Visualizadores que não implementam o método `PHYSICAL` usam só a cor; iluminação, ambiente e sombras são do visualizador e não vão no arquivo.

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
| Medidor de vazão | `HydroBIM_Medidor` (T) | Tipo, extremidades e diâmetro. Os conjuntos padronizados do `IfcFlowMeter` não constam de `schemaData.ts` e não são emitidos |
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

## Arquitetura

Esquema adotado: **IFC 4.3.2.0 (`IFC4X3_ADD2`)**, o mesmo da rede. Entidades, ordem dos atributos, enumerações e modelos de conjuntos conferidos no IfcOpenShell 0.9.0.post1 (`schema_by_name('IFC4X3_ADD2')` e `ifcopenshell.util.pset.get_template('IFC4X3')`); as descrições dos tipos predefinidos e das quantidades foram lidas em `ifcopenshell.util.doc`. A documentação HTML da buildingSMART não respondeu ao acesso automático (403) na data da implementação.

| HydroBIM | Entidade / tipo | PredefinedType | Conjuntos |
| --- | --- | --- | --- |
| `wall` | `IfcWall` / `IfcWallType` | Da família: `SOLIDWALL` (alvenaria, blocos), `ELEMENTEDWALL` (drywall) | `Pset_WallCommon`, `Qto_WallBaseQuantities` |
| `slab` | `IfcSlab` / `IfcSlabType` | `FLOOR` | `Pset_SlabCommon`, `Qto_SlabBaseQuantities` |
| `flooring` | `IfcCovering` / `IfcCoveringType` | `FLOORING` | `Pset_CoveringCommon`, `Pset_CoveringFlooring`, `Qto_CoveringBaseQuantities` |
| `door` | `IfcDoor` / `IfcDoorType` | `DOOR` | `Pset_DoorCommon`, `Pset_DoorWindowGlazingType`, `Qto_DoorBaseQuantities` |
| `window` | `IfcWindow` / `IfcWindowType` | `WINDOW` | `Pset_WindowCommon`, `Pset_DoorWindowGlazingType`, `Qto_WindowBaseQuantities` |
| `space` | `IfcSpace` (sem `IfcSpaceType`) | `SPACE`; `INTERNAL`/`EXTERNAL` só com `Pset_SpaceCommon.IsExternal` informado | `Pset_SpaceCommon`, `Qto_SpaceBaseQuantities` |
| vão de porta, janela ou piso | `IfcOpeningElement` | `OPENING` | — |

- **Tipo predefinido**: nasce da família do catálogo e fica no tipo (`ifcPredefinedType`); o usuário pode trocá-lo por outro valor da enumeração oficial. `STANDARD` (parede) consta no esquema como obsoleto e não é usado pelas famílias.
- **Não confundir**: a categoria interna (`flooring`), a entidade (`IfcCovering`) e o tipo predefinido (`FLOORING`) são três níveis; o revestimento de piso **não** é um `IfcSlab`. Classificações externas (NBR 15965, SINAPI) vão em `IfcClassificationReference` e nunca substituem a entidade.
- **Atributos** (não são propriedades): `OverallWidth` e `OverallHeight` na porta e na janela; `OperationType` na porta e no `IfcDoorType`; `PartitioningType` na janela e no `IfcWindowType`; `LongName` (nome) e `Name` (número, quando há) no ambiente, com `ElevationWithFlooring`.

| Abertura do tipo | No IFC |
| --- | --- |
| Porta de giro, uma folha | `SINGLE_SWING_LEFT` / `SINGLE_SWING_RIGHT`, pela mão da ocorrência |
| Porta de giro, duas folhas | `DOUBLE_DOOR_SINGLE_SWING` |
| Porta de correr | `SLIDING_TO_LEFT` / `SLIDING_TO_RIGHT` |
| Porta pivotante | `USERDEFINED` + `UserDefinedOperationType = 'PIVOT'` (a enumeração não tem pivotante de eixo deslocado) |
| Janela: 1, 2, 3 folhas | `SINGLE_PANEL`, `DOUBLE_PANEL_VERTICAL`, `TRIPLE_PANEL_VERTICAL`; mais de três: `USERDEFINED` com a descrição |
| Janela: abertura de cada folha | `IfcWindowPanelProperties` no tipo (até três folhas): fixa `FIXEDCASEMENT`, correr `SLIDINGHORIZONTAL`, abrir `SIDEHUNGLEFTHAND`/`SIDEHUNGRIGHTHAND`, basculante `PIVOTHORIZONTAL`, maxim-ar `TOPHUNG` |

Como o IFC põe a mão da porta no tipo, um tipo do projeto usado com as duas mãos gera dois `IfcDoorType` (o mesmo vale para a janela de abrir de uma folha).

### Geometria, vãos e estrutura espacial

- Parede, laje e revestimento: `IfcExtrudedAreaSolid` do contorno **bruto** (`IfcArbitraryClosedProfileDef`). Cada vão é um `IfcOpeningElement` com sólido próprio, ligado por `IfcRelVoidsElement`; o da porta ou janela é ligado a ela por `IfcRelFillsElement`. As aberturas de laje e de revestimento são `IfcOpeningElement` sem preenchimento. O sólido do vão passa 5 mm além das faces, para a subtração não ter faces coincidentes.
- Porta e janela: `IfcTriangulatedFaceSet` por parte (marco, folha, vidro), com o estilo de superfície de cada parte; o vidro leva transparência.
- Ambiente: representação `FootPrint` (contorno) sempre; `Body` (sólido extrudado) só com o pé-direito informado. É elemento **espacial**: decompõe o pavimento (`IfcRelAggregates`) e não entra em `IfcRelContainedInSpatialStructure`.
- Pavimentos: os elementos ficam no `IfcBuildingStorey` do seu nível (portas e janelas, no da parede). A estrutura edifício › pavimentos vale para os ambientes Arquitetura e MEP; no Infra tudo fica no terreno.
- `GlobalId` da ocorrência: derivado do `id` persistente do elemento; o do tipo, do `id` do tipo (e da mão, quando há) — reexportar preserva as identidades.

### Materiais

- Parede, laje e revestimento: `IfcMaterialLayerSet` no tipo (uma `IfcMaterialLayer` por camada, com o material, a espessura e a função em `Category`) e `IfcMaterialLayerSetUsage` em cada ocorrência — parede: `AXIS2`, sentido `NEGATIVE`, a partir da face esquerda; laje e revestimento: `AXIS3`, de cima para baixo.
- Porta e janela: `IfcMaterialConstituentSet` (`Frame`, `Panel`, `Glazing`) **só** com os materiais informados; sem informação não há associação de material.

### Propriedades

`packages/ifc/src/bim/archDefinitions.ts` é a parte arquitetônica do registro central. Os conjuntos padronizados não são transcritos: para cada um, **todas** as propriedades de valor simples ou enumerado são lidas de `schemaData.ts`, com nome, tipo de valor e enumeração oficiais. O registro só decide a categoria, o escopo, o rótulo e o grupo do painel. Propriedades em outras formas (valor por referência, intervalo) não são oferecidas.

| Escopo | Propriedades |
| --- | --- |
| Tipo (`Ifc…Type.HasPropertySets`) | `Reference` (nome do tipo) e as de desempenho do `Pset_*Common` (`FireRating`, `AcousticRating`, `ThermalTransmittance`, `Combustible`…); `Pset_DoorWindowGlazingType`; `Pset_ManufacturerTypeInformation`; `HydroBIM_Composicao`, `HydroBIM_Esquadria` |
| Ocorrência | `Status`, `IsExternal`, `LoadBearing`, `ExtendToStructure`, `Compartmentation`, `PitchAngle`, `FireExit`, `HandicapAccessible`, `PubliclyAccessible`, áreas planejadas; `Pset_InstallationOccurrence`; `Qto_*`; `HydroBIM_Parede`, `HydroBIM_Piso`, `HydroBIM_Vao`, `HydroBIM_Posicao`, `HydroBIM_Planejamento`, `HydroBIM_Ambiente`, `HydroBIM_Propriedades` |

- Os `Pset_*Common` são, no esquema, conjuntos de tipo com sobreposição por ocorrência (`PSET_TYPEDRIVENOVERRIDE`). Aqui cada propriedade tem **um** escopo; o mesmo conjunto aparece no tipo e na ocorrência com propriedades diferentes, sem repetição.
- **Sem valor = pendente.** Propriedade editável não informada é gravada sem `NominalValue` (ou sem `EnumerationValues`). Nenhuma propriedade da arquitetura é exigida por padrão, e o IDS exportado não traz requisitos de arquitetura.
- **Quantidades**: só as que o modelo calcula; critérios em [ARQUITETURA.md](ARQUITETURA.md). Não são emitidos pesos, `Length`/`Depth` da laje, quantidades líquidas do ambiente nem `Qto_OpeningElementBaseQuantities`.
- **Unidades novas**: transmitância térmica (`THERMALTRANSMITTANCEUNIT`, kg·s⁻³·K⁻¹ = W/m²·K), com quilograma e kelvin declarados. Datas (`IfcDate`) em AAAA-MM-DD.
- `validateArchIfcModel` confere entidade, tipo predefinido, atributos enumerados, aplicabilidade dos conjuntos e tipos de valor contra o esquema.

### Verificação

`services/api/tests/test_ifc_architecture.py` reabre `examples/edificacao-simples.ifc` com o IfcOpenShell: `ifcopenshell.validate` sem ocorrências; contagem e tipos predefinidos; `GlobalId` de cada elemento; tipos compartilhados; atributos e modo de abertura; vãos e preenchimentos; ambientes agregados ao pavimento; camadas de material e uso; propriedades pendentes sem valor; unidades; quantidades brutas e líquidas; e o volume do sólido tesselado (com os vãos subtraídos pelo próprio IfcOpenShell) contra o volume líquido gravado.

## Portas e conectividade

- Cada porta do HydroBIM vira um `IfcDistributionPort` (`PredefinedType = PIPE`, `SystemType` conforme o sistema), posicionado no referencial local do elemento.
- Vínculo porta ↔ elemento: no IFC 4.3 o padrão a adotar é `IfcRelNests`; `IfcRelConnectsPortToElement` ainda existe no esquema, mas é tratado como legado pela documentação do IFC 4.3 — **confirmar na Fase 3** antes de escolher.
- Cada `Connection` vira um `IfcRelConnectsPorts` entre as duas portas.
- `FlowDirection`: `NOTDEFINED` enquanto o HydroBIM não modelar sentido de escoamento — exceto nos bocais de reservatório, cuja função é conhecida.

## Estrutura do arquivo a exportar

1. `IfcProject` com `IfcUnitAssignment` (metro, radiano) e contextos geométricos (`Model`/`Body`, eventualmente `Axis`).
2. Estrutura espacial: `IfcSite` → `IfcBuilding` → `IfcBuildingStorey` para MEP e Arquitetura; para Infra, avaliar `IfcFacility`/`IfcFacilityPart` (existem apenas no IFC 4.3).
3. Elementos com `IfcLocalPlacement` derivado do referencial local e contidos por `IfcRelContainedInSpatialStructure`.
4. Geometria (a decidir e testar em visualizadores):
   - tubo: `IfcExtrudedAreaSolid` com `IfcCircleHollowProfileDef`, ou `IfcSweptDiskSolid` com `InnerRadius`;
   - joelho: `IfcRevolvedAreaSolid` (perfil oco) ou `IfcSweptDiskSolid` sobre arco;
   - tê, redução e válvula: composição de sólidos ou malha (`IfcTriangulatedFaceSet`) gerada a partir de `packages/geometry`.
5. Propriedades: conjuntos padrão quando existirem (ex.: `Pset_PipeSegmentTypeCommon`) e um conjunto próprio `HydroBIM_*` para DN, norma, classe de pressão e propriedades livres. Os nomes dos Psets padrão devem ser conferidos na Fase 3.
6. Identificadores: `GlobalId` de 22 caracteres derivado de forma determinística do UUID do elemento (`ifcopenshell.guid.compress`), para que reexportações preservem a identidade.

## Terreno e terraplenagem

Entidades, tipos predefinidos e conjuntos de quantidades conferidos em `schemaData.ts` (gerado do esquema IFC4X3_ADD2; `packages/ifc/src/terrainExport.ts`):

| HydroBIM | Entidade IFC | Tipo predefinido | Geometria e relações |
| --- | --- | --- | --- |
| Superfície do terreno NATURAL (`project.terrain`) | `IfcGeographicElement` | `TERRAIN` | `IfcTriangulatedFaceSet` aberto com os vértices e as faces da superfície; contido no `IfcSite`; `GlobalId` derivado de `terrain.id`, `Tag` = `terrain.tag` |
| Corte de um platô | `IfcEarthworksCut` | `CUT` | Sólido entre o terreno natural (tampa) e o projetado (fundo); `IfcRelVoidsElement` com o terreno (`IfcEarthworksCut` é um `IfcFeatureElementSubtraction`) |
| Aterro de um platô | `IfcEarthworksFill` | `EMBANKMENT` | Sólido entre o terreno projetado (tampa) e o natural (fundo); contido no `IfcSite` |

- **Terreno projetado**: não é uma entidade à parte. É o terreno natural menos os cortes mais os aterros — a mesma relação do modelo do HydroBIM, que não precisa reimportar o IFC para recalcular.
- **Coordenadas**: locais do projeto, relativas ao canto da superfície (um `IfcLocalPlacement` leva a esse canto); a posição no sistema projetado é a do `IfcMapConversion`.
- **Sólidos**: a tampa e o fundo se encontram na linha em que as duas superfícies coincidem, sem parede lateral. `Closed` = `.T.` quando toda aresta pertence a duas faces de sentidos opostos (terrenos planos e inclinados); em relevo irregular podem restar lascas submilimétricas abertas, e o atributo sai `.F.` — o volume gravado é sempre o integrado, não o do sólido.
- **Quantidades**: `Qto_EarthworksCutBaseQuantities.UndisturbedVolume` (corte in situ) e `LooseVolume` (corte × (1 + empolamento), só com o empolamento informado); `Qto_EarthworksFillBaseQuantities.CompactedVolume` (aterro) e `LooseVolume` (aterro ÷ fator × (1 + empolamento), só com os dois parâmetros). `Length`, `Width`, `Depth` e `Weight` não são emitidos (não têm definição única para um platô; o peso exigiria a massa específica). Conjuntos próprios: `HydroBIM_Terreno` (procedência, referência altimétrica, cotas mínima e máxima, editada), `HydroBIM_TerrenoQuantidades` (área em planta e da superfície), `HydroBIM_Plato` (cota, taludes H:V, empolamento, fator, aproveitamento) e `HydroBIM_TerraplenagemQuantidades` (área em planta em corte ou em aterro). Valor não informado sai sem valor.
- **Não emitido**: `IfcTriangulatedIrregularNetwork` (o significado de `Flags` por triângulo não foi conferido; a superfície sai como `IfcTriangulatedFaceSet`), linhas de quebra e limite como curvas, e a superfície original de antes das edições.
- **Fora do registro central**: estes conjuntos são escritos direto pela exportação e ainda não aparecem na aba BIM / IFC nem no IDS.

## Georreferenciamento (Infra)

`IfcMapConversion` + `IfcProjectedCRS` só serão emitidos quando o usuário informar explicitamente o sistema de referência. **Nenhum código EPSG ou coordenada geográfica será atribuído por padrão.**

Atributos do `IfcProjectedCRS`: `Name` = `EPSG:<código>` (ou o nome informado, sem código); `Description` = nome do sistema; `GeodeticDatum`, `MapProjection` (`UTM`) e `MapZone` (ex.: `23S`) só quando o código está no registro de sistemas do HydroBIM (`findProjectedCrs`), cujos parâmetros foram conferidos com o banco EPSG; `VerticalDatum` só quando o usuário informou a referência altimétrica; `MapUnit` = metro. `IfcMapConversion`: `Eastings`, `Northings`, `OrthogonalHeight`, `XAxisAbscissa`/`XAxisOrdinate` (cosseno e seno da rotação) e `Scale` = 1 — a mesma conversão usada para posicionar o mapa na Planta Infra.

## Verificação automática

Os testes do backend abrem os arquivos IFC de `examples/` (gerados por `npm run examples:generate`) com IfcOpenShell e conferem: contagem de entidades por classe e tipo predefinido, portas e `IfcRelConnectsPorts` equivalentes ao grafo, sistema e unidades, e validade do arquivo (`ifcopenshell.validate`). O exemplo `terraplenagem-platos` cobre o terreno e a terraplenagem (`tests/test_ifc_terrain.py`): classe e tipo do terreno, malha igual à do projeto, cortes abrindo vazio no terreno, aterros contidos no `IfcSite`, conversão dos volumes soltos e tesselagem nas coordenadas do projeto.

## Limitações conhecidas da exportação atual

- As anotações da planta baixa (cotas, textos, chamadas e etiquetas) não são exportadas; o mapeamento para `IfcAnnotation` não foi verificado no esquema e fica para uma fase posterior.
- Conexões, válvulas e equipamentos são exportados como malhas trianguladas (`IfcTriangulatedFaceSet`); apenas os tubos são sólidos paramétricos.
- No reservatório, `HydroBIM_Especificacao` descreve a tubulação dos bocais de entrada e saída.
- O IDS exportado não foi conferido contra o XSD da buildingSMART nem com o `ifctester`; o perfil de requisitos é fixo (não editável) e não há importação de IDS.
- `Pset_DistributionSystemCommon` não é emitido; os sistemas trazem nome e tipo predefinido.
- `FlowDirection` das portas é `NOTDEFINED`, exceto nos bocais de reservatório.
- Não há importação IFC: a "reimportação" dos reservatórios é verificada pelos testes do backend, que reabrem o arquivo com IfcOpenShell e conferem classe, tipo, material, propriedades, portas e a malha tesselada contra o projeto.
- O arquivo foi validado com `ifcopenshell.validate` e tesselado com `ifcopenshell.geom`; ainda não foi testado em visualizadores e ferramentas de autoria de terceiros.
