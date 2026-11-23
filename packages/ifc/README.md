# @hydrobim/ifc

Exportação IFC 4.3 (`IFC4X3_ADD2`) inteiramente no cliente, por uma função pura
TypeScript. Não requer API, Three.js, React, acesso a arquivos ou dependências de
execução além de `@hydrobim/core` e `@hydrobim/geometry`.

```ts
import { exportIfc } from '@hydrobim/ifc';

const text = exportIfc(project, {
  timestamp: new Date('2026-01-01T00:00:00Z'),
  author: 'Responsável pelo projeto',
  organization: 'Organização',
  application: 'HydroBIM',
  // Famílias do catálogo e do projeto: alimentam os tipos IFC (fabricante, fonte, modelo).
  families,
  tankFamilies,
});
const blob = new Blob([text], { type: 'application/x-step' });
```

O chamador fornece um `Project` válido. `exportIfc` devolve texto IFC-SPF, sem
mutar o projeto. O mesmo projeto e opções produzem os mesmos bytes. Sem timestamp,
usa-se `project.updatedAt`; se esse campo não for uma data válida, usa-se a época
Unix. Não se consulta o relógio. Autor e organização ausentes ficam vazios.

`toIfcGuid(uuid)` comprime UUIDs canônicos ou seus 32 dígitos hexadecimais em 22
caracteres IFC; entradas inválidas geram erro. `derivedGuid(seed)` usa UUID v5
(SHA-1, namespace nulo, nome `HydroBIM:${seed}`), sem finalidade criptográfica.
UUIDs dos projetos e elementos são preservados; IDs textuais legados usam a semente
`${id}:legacy`. Entidades derivadas usam papéis estáveis, como `${id}:site`,
`${id}:storey`, `${id}:port:${portId}` e `${id}:connection`.

A leitura de arquivos `.ifc` de terceiros fica em outro pacote, `@hydrobim/ifc-import`
(ver `docs/IFC_IMPORT.md`); este pacote só exporta.

## Camada BIM (`src/bim`)

| Função | O que faz |
| --- | --- |
| `buildIfcModel(project, options)` | Modelo de informação: classificação, `Ifc…Type`, conjuntos de propriedades e quantidades, portas, materiais e sistemas. É o que a aba BIM / IFC mostra e o que `exportIfc` grava |
| `validateIfcModel(project, model)` | Problemas normativos do IFC 4.3 (`schema`) e do perfil do projeto (`project`) |
| `setIfcValue(project, alvo, chave, valor)` | Informa ou limpa uma propriedade editável, no tipo ou na ocorrência (`Result<Project>`) |
| `exportIds()` | Perfil de requisitos do projeto em IDS 1.0 |
| `classifyLibrary(...)` | Entidade, tipo predefinido e tipo IFC de cada família da biblioteca |
| `IFC_PROPERTY_DEFINITIONS` | Registro central das propriedades |

`src/bim/schemaData.ts` é gerado do esquema IFC 4.3 do IfcOpenShell — não edite à mão:

```powershell
cd services/api
uv run python scripts/generate_ifc_schema_data.py
```

Detalhes do mapeamento: `docs/IFC_MAPPING.md`; decisão: ADR-033.

## Conteúdo exportado

| Elemento HydroBIM | Entidade IFC | PredefinedType |
| --- | --- | --- |
| Tubo | `IfcPipeSegment` | `RIGIDSEGMENT` |
| Joelho | `IfcPipeFitting` | `BEND` |
| Tê | `IfcPipeFitting` | `JUNCTION` |
| Redução | `IfcPipeFitting` | `TRANSITION` |
| Válvula gaveta, esfera ou borboleta | `IfcValve` | `ISOLATING` |
| Válvula globo | `IfcValve` | `REGULATING` |
| Válvula de retenção | `IfcValve` | `CHECK` |
| Ventosa | `IfcValve` | `AIRRELEASE` |
| Bomba genérica | `IfcPump` | `ENDSUCTION` |
| Bomba anfíbia de catálogo | `IfcPump` | `SUBMERSIBLEPUMP` |
| Reservatório | `IfcTank` | `STORAGE` |
| Reservatório de catálogo | `IfcTank` + `IfcTankType`, material, `Pset_<Fabricante>_Reservatorio`, conjuntos padrão e portas com função (ver `docs/IFC_MAPPING.md`) | `STORAGE` |

- Projeto, contexto Model/Body e unidades metro, metro quadrado, metro cúbico, radiano, segundo, pascal, watt, m³/s e s⁻¹.
- Um `Ifc…Type` por produto, ligado às ocorrências por `IfcRelDefinesByType`, com os conjuntos de propriedades do tipo; conjuntos e quantidades padronizados (`Pset_*`, `Qto_*`) e próprios (`HydroBIM_*`) nas ocorrências e nas portas.
- MEP: site → edifício → pavimentos. Cada elemento usa o pavimento mais alto cuja
  cota não exceda a menor cota de suas portas, ou o pavimento mais baixo quando
  todas as cotas forem superiores. Sem níveis, a contenção é no edifício.
- Infra: contenção diretamente no site. `IfcProjectedCRS` e `IfcMapConversion`
  somente quando a georreferência foi informada; nenhum EPSG é presumido.
- Tubos: perfil circular oco extrudado no eixo X local, com diâmetro físico e
  espessura da especificação. Tubos com flanges saem em malha (corpo, discos e
  ressaltos), com as dimensões dos flanges em `HydroBIM_Especificacao`
  (`StartFlange*`/`EndFlange*`). Demais elementos: partes locais retornadas por
  `buildElementGeometry`, com soldagem de vértices e remoção de faces degeneradas.
  Malhas abertas permanecem identificadas como abertas.
- Portas derivadas do core, aninhadas por `IfcRelNests`; uma `IfcRelConnectsPorts`
  por aresta do grafo. Ventosas têm uma porta.
- Sistemas com elementos, seus agrupamentos e materiais PVC, PEAD, ferro fundido
  dúctil e aço-carbono. Sistemas vazios não geram entidades ou relações vazias.
- `HydroBIM_Especificacao`: DN, rótulo comercial, diâmetros físicos, parede, norma,
  pressão, junta, material, família quando informada e parâmetros de tubos,
  joelhos e reduções. `HydroBIM_Propriedades`: propriedades livres com tipo preservado.
- Strings STEP com apóstrofos duplicados e Unicode em `\X2\...\X0\`.

## Limitações conhecidas

Conexões e equipamentos são tesselações da geometria compartilhada, com corpos
simplificados e possíveis partes sobrepostas; não são sólidos paramétricos IFC
editáveis. Dimensões genéricas são identificadas na descrição, sem alegar
correspondência com um produto comercial. O sentido de escoamento é `NOTDEFINED`
(exceto nos bocais de reservatório), pois ainda não é modelado no domínio. Pesos
não são exportados (as famílias não os trazem); terreno e cores de visualização
também não. O IDS exportado ainda não foi conferido com uma ferramenta externa.

O cabeçalho declara `ReferenceView_V1.2`, conforme o contrato de exportação;
a validação EXPRESS não representa certificação MVD ou certificação de
interoperabilidade com todos os aplicativos BIM. IFC4 não é um alvo implementado.

## Verificação

Execute na raiz, em PowerShell no Windows:

```powershell
npm run typecheck
npx eslint packages/ifc tests
npx prettier --check packages/ifc tests/tools
npm test
npm run examples:generate
```

Depois, em `services/api`:

```powershell
uv sync --python 3.11
uv run ruff check .
uv run ruff format --check .
uv run pytest -q
```

Os testes Python comparam cada IFC com seu JSON de origem e usam o IfcOpenShell
como verificador independente. A ordem de todos os atributos e as enumerações
usadas foram consultadas no esquema `IFC4X3_ADD2` do IfcOpenShell 0.9.0.post1.
A relação de portas segue a [documentação de IfcRelNests da buildingSMART](https://standards.buildingsmart.org/IFC/DEV/IFC4_3/HTML/lexical/IfcRelNests.html).
O gerador fixa o timestamp IFC; se outro gerador recriar o projeto com novos UUIDs,
os arquivos IFC também mudarão para refletir essas identidades.
