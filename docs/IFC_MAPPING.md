# Mapeamento IFC

> **Estado: exportação implementada** em `packages/ifc` (escritor IFC-SPF em TypeScript, executado no navegador) e verificada com IfcOpenShell nos testes do backend (`services/api/tests/test_ifc_export.py`). A importação IFC não está implementada. Detalhes do que é emitido: `packages/ifc/README.md`. Este documento registra o mapeamento adotado e o que foi conferido no esquema.

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
| `pipe` | `IfcPipeSegment` | `RIGIDSEGMENT` | — |
| `elbow` | `IfcPipeFitting` | `BEND` | Ângulo e raio em propriedades |
| `tee` | `IfcPipeFitting` | `JUNCTION` | Três portas |
| `reducer` | `IfcPipeFitting` | `TRANSITION` | Diâmetros distintos por porta |
| `valve` (`gate`, `ball`, `butterfly`) | `IfcValve` | `ISOLATING` | O mecanismo não tem valor na enumeração: registrar em propriedade/`ObjectType` |
| `valve` (`globe`) | `IfcValve` | `REGULATING` | A confirmar com a prática de projeto |
| `valve` (`check`) | `IfcValve` | `CHECK` | — |
| `valve` (`airRelease`) | `IfcValve` | `AIRRELEASE` | Porta única |
| `pump` | `IfcPump` | `ENDSUCTION` | Representação genérica |
| `tank` | `IfcTank` | `STORAGE` | — |

Sistemas:

| `SystemKind` | `IfcDistributionSystem.PredefinedType` |
| --- | --- |
| `domesticColdWater` | `DOMESTICCOLDWATER` |
| `domesticHotWater` | `DOMESTICHOTWATER` |
| `fireProtection` | `FIREPROTECTION` |
| `waterSupply` | `WATERSUPPLY` |
| `other` | `USERDEFINED` |

Os elementos serão associados ao sistema por `IfcRelAssignsToGroup`.

## Portas e conectividade

- Cada porta do HydroBIM vira um `IfcDistributionPort` (`PredefinedType = PIPE`, `SystemType` conforme o sistema), posicionado no referencial local do elemento.
- Vínculo porta ↔ elemento: no IFC 4.3 o padrão a adotar é `IfcRelNests`; `IfcRelConnectsPortToElement` ainda existe no esquema, mas é tratado como legado pela documentação do IFC 4.3 — **confirmar na Fase 3** antes de escolher.
- Cada `Connection` vira um `IfcRelConnectsPorts` entre as duas portas.
- `FlowDirection`: `NOTDEFINED` enquanto o HydroBIM não modelar sentido de escoamento.

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

- Conexões, válvulas e equipamentos são exportados como malhas trianguladas (`IfcTriangulatedFaceSet`); apenas os tubos são sólidos paramétricos.
- Não há `IfcTypeObject` nem conjuntos de propriedades padrão (`Pset_*`); as propriedades estão em `HydroBIM_Especificacao` e `HydroBIM_Propriedades`.
- `FlowDirection` das portas é `NOTDEFINED`.
- O arquivo foi validado com `ifcopenshell.validate` e tesselado com `ifcopenshell.geom`; ainda não foi testado em visualizadores e ferramentas de autoria de terceiros.
