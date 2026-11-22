# Arquitetura (seção arquitetônica do HydroBIM)

Paredes, lajes, revestimentos de piso, portas, janelas e ambientes, no **mesmo projeto**, níveis, coordenadas e vistas da rede hidráulica (MEP e Infra). Este documento registra o que foi adotado, de onde veio e o que **não** está coberto. Modelo de dados: [DOMAIN_MODEL.md](DOMAIN_MODEL.md); mapeamento IFC: [IFC_MAPPING.md](IFC_MAPPING.md); interface: [INTERFACE.md](INTERFACE.md).

> **Não é declaração de conformidade.** O HydroBIM adota os requisitos listados abaixo do caderno de referência; não atende ao caderno inteiro (pranchas, carimbo, PEB, CDE, orçamento, 4D e nomenclatura de arquivos estão fora) e não substitui a verificação do projeto pelo responsável técnico.

## Referência

**Caderno de Especificações de Projetos em BIM, versão 3.0** — Governo de Santa Catarina, Secretaria de Estado da Infraestrutura e Mobilidade (BIM SC), 3ª edição, 99 páginas; as fontes das ilustrações são de 2023. As páginas citadas são as do PDF.

## Requisitos adotados

| Requisito do caderno | Página | Como foi adotado |
| --- | --- | --- |
| Modelo em formato aberto IFC, exportação fiel (Quadro 3; 6.1 item 2: "IFC4x3 ou mais atual") | 40, 53 | Exportação `IFC4X3_ADD2` (IFC 4.3.2.0), também para a arquitetura |
| Unidades do projeto definidas no `IfcProject` (Quadro 3) | 41 | Metro, m², m³, radiano; o arquivo declara todas as unidades usadas nas propriedades |
| Pavimentos em `IfcBuildingStorey` (Quadro 3) | 41 | Um pavimento por nível; cada elemento fica no pavimento do seu nível |
| Espaços modelados como `IfcSpace`, com área (Quadro 3: espaços técnicos, áreas brutas, áreas externas) | 42 | Ambientes como `IfcSpace`, agregados ao pavimento; **zonas (`IfcZone`) não implementadas** |
| Sistemas/elementos (`IfcSystem`) para instalações (Quadro 3) | 42 | Já existente na rede hidráulica (`IfcDistributionSystem`) |
| Classificação ABNT NBR 15965 e/ou SINAPI nas entidades (5.2 item 4) | 43 | Classificações externas no tipo, exportadas como `IfcClassificationReference`; o código é sempre informado pelo usuário (não há tabela embutida) |
| Parâmetros adicionais a pedido da contratante (5.2 item 6; 5.2.1 item 3) | 43, 52 | Propriedades livres por elemento (`HydroBIM_Propriedades`) |
| Informações por elemento — **Quadro 4** (paredes, portas, janelas, ambientes, lajes, demais itens) | 44–52 | Tabela "Quadro 4 → HydroBIM" abaixo |
| Tubulações com diâmetro e classe de pressão (5.2.1 item 2) | 52 | Já existente na rede |
| Fases construtivas (Quadro 5: existente, demolição, nova, provisório) | 52 | Propriedade padronizada `Status` (`Pset_*Common`), pendente até ser informada |
| Tabelas de quantitativos extraídas do modelo, por disciplina e categoria (7.3.1 item 1; 7.3.2 item 2) | 59–60 | Quantitativo de arquitetura por pavimento, categoria e tipo; quadro de ambientes; CSV |
| Classificação nas tabelas, "NC (Não Classificado)" quando não houver; prioridade NBR 15965, depois SINAPI (7.3.1 itens 2–3) | 59–60 | Colunas NBR 15965 e SINAPI, com "NC" quando o tipo não tem código |
| Tabelas de materiais e revestimentos com as informações do Quadro 4 (7.3.4) | 60 | Camadas do tipo (material, espessura, função) no quantitativo e no IFC (`IfcMaterialLayerSet`) |
| Nomenclatura e padrão de sistemas/elementos (9.3.1) e **Apêndice I, Quadro 15** (Arquitetura) | 67–68, 93–94 | Camadas do desenho das vistas — ver "Representação gráfica" |
| Espessuras de linha de 0,05 a 0,50 mm (9.3.2 item 2) | 68 | Traços das vistas dentro da faixa; "linhas finas" na tela não altera a exportação |
| Representação gráfica de arquitetura (9.6) | 70 | Ver "Normas citadas": a edição citada está cancelada |

### Quadro 4 → HydroBIM (p. 44–52)

O quadro lista os campos de informação por elemento. **As colunas de etapa (EP, AP, PL, PB, PE / NI1 a NI4) estão vazias no documento**: o caderno não diz em que etapa cada informação é exigida (a seção 4, p. 33–35, declara que a vinculação entre etapa e nível foi retirada e remete a definição ao PEB). Por isso **nenhuma propriedade da arquitetura é exigida por padrão** — o campo fica disponível e pendente; a obrigatoriedade é do perfil de cada projeto. Do mesmo modo, a legenda ND1 a ND4 (detalhe gráfico) não foi associada a nível de informação.

| Campo do Quadro 4 | Onde fica | Natureza |
| --- | --- | --- |
| Afastamento da origem | Parede: `HydroBIM_Parede.BaseOffset`; piso: `HydroBIM_Piso.LevelOffset`; vãos: `HydroBIM_Vao.SillHeight`; todos: `HydroBIM_Posicao` (cotas inferior e superior) | Calculada |
| Altura, espessura, largura, comprimento, área, perímetro, volume | `Qto_WallBaseQuantities`, `Qto_SlabBaseQuantities`, `Qto_CoveringBaseQuantities`, `Qto_DoorBaseQuantities`, `Qto_WindowBaseQuantities`, `Qto_SpaceBaseQuantities` | Calculada |
| Tamanho nominal W × H (portas, janelas) | Atributos `OverallWidth` e `OverallHeight`; a espessura da folha em `HydroBIM_Esquadria.PanelThickness` | Tipo |
| Piso (pavimento) de origem | Pavimento que contém o elemento (`IfcRelContainedInSpatialStructure`) | Modelo |
| Classificação ABNT NBR 15965 / SINAPI | Classificações externas do tipo | Tipo, informada |
| Posição (interna ou externa) | `Pset_WallCommon.IsExternal` (e equivalentes das outras categorias) | Ocorrência, pendente |
| Função estrutural | `Pset_WallCommon.LoadBearing`, `Pset_SlabCommon.LoadBearing` | Ocorrência, pendente |
| Composição (camadas e materiais) | Camadas do tipo → `IfcMaterialLayerSet`; esquadrias → `IfcMaterialConstituentSet` (só o que for informado) | Tipo |
| Eficiência acústica | `AcousticRating` do `Pset_*Common` | Tipo, pendente |
| Resistência ao fogo; corta-fogo | `FireRating` do `Pset_*Common` | Tipo, pendente |
| Data da execução / instalação | `Pset_InstallationOccurrence.InstallationDate` | Ocorrência, pendente |
| Código EAP | `HydroBIM_Planejamento.WbsCode` | Ocorrência, pendente |
| Tipo IFC | Entidade, `Ifc…Type` e tipo predefinido (grupo "Classificação IFC") | Família |
| Acabamento (portas, janelas) | `HydroBIM_Esquadria.Finish`; revestimentos: `Pset_CoveringCommon.Finish` | Tipo, pendente |
| Vínculo com a parede | Hospedagem (`hostId`) → `IfcRelVoidsElement` + `IfcRelFillsElement` | Modelo |
| Tipo de abertura; orientação de abertura | `OperationType` (porta), `PartitioningType` + `IfcWindowPanelProperties` (janela); `HydroBIM_Vao.OpeningSide` | Tipo / ocorrência |
| Espessura do vidro; vidro (m²) | `Pset_DoorWindowGlazingType.GlassThickness1`; `GlazingAreaFraction` | Tipo, pendente |
| Largura da guarnição; batente | `HydroBIM_Esquadria.FrameWidth` (largura aparente do marco) | Tipo |
| Maçaneta; ferragem; acessórios | `HydroBIM_Esquadria.Hardware` (texto) | Tipo, pendente |
| Acessibilidade PNE; saída de emergência | `HandicapAccessible`, `FireExit` (`Pset_DoorCommon`, `Pset_WindowCommon`, `Pset_SpaceCommon`) | Ocorrência, pendente |
| Fabricante; descrição | `Pset_ManufacturerTypeInformation`; nome e descrição do elemento | Tipo |
| Ambientes: descrição, pé-direito, perímetro, área de piso, volume | Nome e número do ambiente; `Qto_SpaceBaseQuantities` (`Height`, `GrossPerimeter`, `GrossFloorArea`, `GrossVolume`) | Calculada (pé-direito informado) |
| Telhado, escada, rampa, pilares, vigas, fundações, mobiliário | — | **Não implementado** (categorias fora deste escopo) |
| Ambiente de inserção (do elemento) | — | **Não implementado**: o vínculo elemento ↔ ambiente exigiria detectar o contorno; não é presumido |
| Massa; quantidade de calor; carregamento; resistência característica; taxa de armadura | — | **Não implementado**: sem dado de origem (peso próprio exige densidade com fonte) |
| Acabamento de parede, piso e teto do ambiente; áreas e número de portas e janelas do ambiente; densidade populacional | — | **Não implementado** |
| Manutenção (frequência) | — | **Não implementado** |

"Calculada" = derivada da geometria, não editável. "Pendente" = campo disponível sem valor; fica sem valor no arquivo até ser informado — nunca é convertido em zero, falso ou desempenho presumido.

## Normas citadas no caderno: vigência

Conferência feita em novembro de 2026. **O catálogo oficial da ABNT, o iso.org e o site da buildingSMART recusaram o acesso automático**; as situações abaixo vêm de catálogos de terceiros, boletins setoriais e cópias das normas, e devem ser reconferidas na fonte oficial antes de uso contratual. O HydroBIM não embute o texto de nenhuma norma.

| Citada no caderno | Situação encontrada | Efeito no HydroBIM |
| --- | --- | --- |
| ABNT NBR 6492:1994 (seção 9.6, p. 70) | **Cancelada e substituída** pela ABNT NBR 6492:2021 (o prefácio da edição de 2021 o declara). O próprio caderno lista a edição de 2021 nas referências (p. 77) — inconsistência interna | Ver "Representação gráfica": nenhum símbolo é declarado conforme |
| ABNT NBR 12298:1995 (hachuras), nas referências | Cancelada em 2022, substituída pela ABNT NBR 17067:2022 | As hachuras são configuração do tipo, sem padrão por material embutido |
| ABNT NBR 10126 (cotagem), nas referências | Cancelada em 2022, substituída pela ABNT NBR 17068:2022 | Cotas das vistas não declaram conformidade |
| ABNT NBR 16752:2020, 16861:2020, 17006:2021 | Vigentes segundo as fontes encontradas (confiança média) | — |
| ABNT NBR 15965, partes 2 (2012), 3 (2014), 4 (2021), 5 (2022), 6 (2022), 7 (2015) | Anos conferem; a parte 1 é de 2011. Há revisão planejada das partes 1 a 3 | O código é informado pelo usuário; nenhuma tabela é embutida |
| ABNT NBR 9050/2015 (p. 62) | Substituída pela edição de 2020 (versão corrigida de 2021) | Fora do escopo (o HydroBIM não verifica acessibilidade) |
| "ISO 16739-1:2020" (p. 9), "ISO–PAS–16739:2018" (p. 53), "ISO/PAS 16739" (p. 40) | A edição vigente é a **ISO 16739-1:2024** (IFC 4.3). Não foi encontrada edição ISO de 2020; a PAS é de 2005 e foi retirada | Adotado o IFC 4.3.2.0 (`IFC4X3_ADD2`) |
| ISO 19650:2018 | Vigente; revisão da parte 1 em consulta em 2026 | Fora do escopo (CDE) |
| ISO 29481-1:2016; ISO 12006-3 | Substituída pela edição de 2025; vigente a de 2022 | Fora do escopo |
| Lei nº 8.666/1993 (p. 74) | Revogada em 30/12/2023 pela Lei nº 14.133/2021 | Fora do escopo |
| SINAPI | Códigos numéricos continuam; a Caixa mudou o formato dos relatórios em 2025 | O código é informado pelo usuário |

### Ambiguidades do caderno

- **Formato IFC**: o Quadro 3 (p. 40) pede "IFC 2x3 e IFC4"; a seção 6.1 (p. 53) pede "IFC4x3 ou mais atual". Adotado o IFC 4.3; **não há exportação IFC 2x3 nem IFC 4**.
- **Quadro 4 sem requisitos por etapa** (células vazias) e com rótulos de coluna que mudam de EP/AP/PL/PB/PE para NI1…NI4 entre as tabelas: nenhum requisito por fase foi atribuído.
- **Quadro 4, "Paredes — Tipo IFC: IfcWall"**: único tipo IFC indicado; as demais entidades foram definidas pelo esquema IFC 4.3.
- **Coordenadas**: o Quadro 3 (p. 41) pede o zero do projeto georreferenciado em SIRGAS 2000. O HydroBIM só georreferencia quando o usuário informa o sistema (regra 9 do `AGENTS.md`); nada é presumido.
- **Apêndice I**: os quadros são "exemplos de nomenclatura"; a coluna "Tipo de linha (Similar)" usa nomes de um programa de CAD ("Dashed", "Dash dot (2x)", "Acad_iso04w 100"), sem definir passo de traço. A seção 9.3.1 menciona cor de paleta e espessura por sistema, mas os quadros não as trazem.
- **Fontes de consulta** indicadas pelo caderno para os arquivos de padrões (carimbo, CTB, pranchas) são sites da contratante, não incorporados.

## Representação gráfica

- **Camadas (Apêndice I, Quadro 15, p. 93–94)**: o desenho das vistas salvas identifica cada elemento de arquitetura (`data-layer`, levado ao SVG exportado) pelas nomenclaturas do quadro — `Parede_Externa`, `Parede_Interna`, `Esquadrias`, `Hachura`, `Projeção_2`, `Vidro`, `Texto` —, com linha contínua para paredes e esquadrias e tracejada para projeção. A parede é externa ou interna conforme `Pset_WallCommon.IsExternal` da ocorrência; sem o valor informado fica em `Parede`, sem presumir. `Projeção_2` recebe, em planta, o elemento inteiro acima do plano de corte e dentro da faixa da vista (por exemplo, uma janela alta). **Fora do quadro**: `Piso` (lajes e revestimentos) e `Ambientes` (contorno do ambiente) são nomes do HydroBIM. **Não atendido**: a camada `Cotas` não é usada (as cotas são detalhes da vista, em camada própria do editor), e os elementos não são reunidos em um grupo por camada — a ordem de desenho é por profundidade, com a rede e a arquitetura intercaladas.
- **Paredes cortadas**: a seção é obtida cortando a malha do elemento pelo plano da vista (`sectionLoops`), com traço forte e a hachura da camada estrutural do tipo. A hachura (`none`, `solid`, `diagonal`, `crossed`, `dotted`) é **escolhida no tipo**; os valores iniciais das famílias são apenas um ponto de partida de edição.
- **Plano de corte da planta**: as plantas cortam a arquitetura a `archCutHeight` acima do nível (1,20 m ao criar a vista; editável). A rede continua visível até o topo da faixa da vista, para que a tubulação junto ao teto não desapareça.
- **Ambientes**: contorno tracejado e rótulo com número, nome e área (m², duas casas), no centroide do contorno — que pode cair fora de um contorno côncavo.
- **Portas**: folha desenhada aberta a 90° e arco de abertura (a folha fechada da malha é omitida na planta); **janelas**: marco e vidro em seção, peitoril em projeção. São **símbolos de uso corrente**: a ABNT NBR 6492:2021 foi consultada só por cópia de terceiros, em que consta "representação simplificada" de portas, janelas e escadas em linha contínua (Anexo A), sem regra textual sobre folha e arco — **a conformidade dos símbolos com a norma não foi verificada**.

## Modelo

Detalhes dos campos em [DOMAIN_MODEL.md](DOMAIN_MODEL.md). Em resumo:

- **Família › tipo › ocorrência.** A família é a tipologia do catálogo (`packages/catalog/src/architecture.ts`); o tipo (`ArchType`) é a família com dimensões e composição, gravado em `project.architecture.types`; a ocorrência (`ArchElement`) aponta o tipo. Alterar um tipo vale para todas as ocorrências — a operação devolve a lista das afetadas e é recusada por inteiro se alguma deixar de caber.
- **Fora da rede.** Os elementos arquitetônicos ficam em `project.architecture.elements`, não em `project.elements`: não têm sistema hidráulico, DN, especificação de tubo nem portas, e não entram no grafo de conectividade. Trocar de ambiente (Arquitetura, MEP, Infra) muda só `project.discipline`.
- **Paredes**: linha de referência `start`–`end` (no eixo ou em uma das faces), nível, deslocamento da base, altura e tipo em camadas. Os encontros são **derivados**: extremidades coincidentes formam canto em bisel (L; com três ou mais paredes, cada face encontra a da vizinha); extremidade apoiada no corpo de outra parede termina na face dela (T).
- **Portas e janelas**: hospedadas em uma parede, posicionadas pela distância ao início dela — mover, girar, espelhar ou alongar a parede as leva junto. O vão é **real** (malha, IFC e quantidades); tem de caber no trecho de seção completa da parede, dentro da altura e sem sobrepor outro vão.
- **Lajes e revestimentos de piso** são elementos distintos (`slab`: estrutural, `offset` = cota do topo; `flooring`: acabamento, `offset` = cota da base), com contorno fechado e aberturas.
- **Ambientes**: contorno, nível, número e pé-direito (`null` = não informado). A área é a do contorno desenhado.

### Elevação e assentamento sobre o terreno

- **Elevação**: as cotas absolutas inferior e superior de cada elemento são **derivadas** (`archVerticalRange`: cota do nível + deslocamento da ocorrência + espessura ou altura do tipo) e mostradas no painel de propriedades e em `HydroBIM_Posicao`; não são gravadas.
- **Assentar sobre o terreno** (`packages/core/src/architecture/ground.ts`): parede, laje, piso e ambiente podem ter a **base** levada à cota do terreno **natural** (como levantado) ou **projetado** (o natural modificado pelos platôs), ao criar (opção "Assentar sobre" da ferramenta) ou depois (botões "Assentar" do painel). Sem platôs gerados as duas superfícies coincidem e a interface mostra só "Terreno".
- **Ponto de referência**: o primeiro ponto do traçado ou do contorno (o início da parede). A base é horizontal — em terreno inclinado o restante do elemento fica acima ou abaixo da superfície; nada é inclinado, recortado nem escalonado.
- **Laje**: o que assenta é a face inferior (o parâmetro gravado, a cota do topo, recebe a espessura do tipo). Ao criar, o deslocamento da ferramenta passa a ser a folga da base acima do terreno.
- **Sem vínculo**: o resultado é gravado como o deslocamento em relação ao nível (`baseOffset`/`offset`); o esquema não muda e o elemento **não acompanha** edições posteriores do terreno ou dos platôs — assenta-se de novo. O nível (pavimento IFC) do elemento continua o do plano de trabalho.
- Portas e janelas acompanham a parede hospedeira (`ARCH_NOT_SEATABLE`); ponto de referência fora da superfície: ao criar, vale o nível e a mensagem avisa; no painel, a operação é recusada (`OUTSIDE_TERRAIN`).

### Operações impossíveis

Toda operação termina conferindo a arquitetura inteira (`archIntegrityProblem`); se algo ficar inconsistente, nada é alterado e o motivo é devolvido: vão que não cabe (`OPENING_DOES_NOT_FIT`), parede sem comprimento (`WALL_TOO_SHORT`), contorno que se cruza (`POLYGON_SELF_INTERSECTION`), abertura fora do piso (`OPENING_OUTSIDE`), tipo de outra categoria (`ARCH_TYPE_MISMATCH`), tipo em uso (`ARCH_TYPE_IN_USE`), produto sem fonte (`ARCH_SOURCE_REQUIRED`), nível com elementos (`LEVEL_IN_USE`). Excluir uma parede exclui as portas e janelas hospedadas — é o único efeito em cascata, e é informado.

## Catálogo

Dezesseis famílias embutidas, todas **modelos genéricos parametrizáveis** (`generic: true`, sem fonte): paredes de alvenaria cerâmica, de blocos de concreto e de drywall; laje de concreto; pisos cerâmico/porcelanato, vinílico e laminado; portas de giro de uma e duas folhas, de correr e pivotante; janelas fixa, de correr, de abrir, basculante e maxim-ar.

- As dimensões e camadas das famílias são **valores iniciais de edição**, não medidas de catálogo nem de norma; o usuário as define ao criar o tipo.
- Nenhuma família traz resistência ao fogo, desempenho acústico, transmitância térmica, classificação ou peso: são campos pendentes.
- Produto comercial: `generic: false` exige `source` (catálogo vigente do fabricante, edição, página e URL); o núcleo recusa sem ela. Não há produto comercial embutido.

## Quantitativos

Critérios dos conjuntos `Qto_*BaseQuantities` do IFC 4.3 (descrições lidas no IfcOpenShell):

| Elemento | Bruto | Líquido |
| --- | --- | --- |
| Parede | Área lateral = comprimento no plano médio × altura; volume = área do contorno × altura. O comprimento no plano médio (área do contorno ÷ espessura) já considera os encontros em bisel e em T | Descontados os vãos de portas e janelas. A área de apoio líquida desconta só os vãos que chegam à base |
| Laje, revestimento | Área do contorno; volume = área × espessura | Descontadas as aberturas |
| Porta, janela | Largura, altura, perímetro e área do vão nominal | — |
| Ambiente | Área e perímetro do contorno; volume com o pé-direito | **Não emitido** (ver limites) |

- Na laje, `Width` é a espessura; `Length` e `Depth` só valem para lajes retangulares e não são emitidos.
- **Sem dupla contagem**: cada elemento entra uma vez, na sua categoria. O ambiente não soma paredes, lajes nem revestimentos; o revestimento não soma a laje.
- Pesos (`GrossWeight`, `NetWeight`) não são emitidos: exigiriam densidade com fonte.

## Limites conhecidos

- Só paredes retas, de altura constante e base horizontal; sem paredes curvas, inclinadas ou de perfil editado. O assentamento sobre o terreno usa um único ponto de referência e não fica vinculado à superfície (ver "Elevação e assentamento sobre o terreno"). Camadas não são desenhadas nem cortadas uma a uma (o corpo é único; a hachura é a da camada estrutural).
- Encontros: resolvidos por extremidades coincidentes (até 1 mm) ou apoiadas; não há junção em X entre paredes que se cruzam no meio, nem prioridade de camadas no encontro.
- Lajes e revestimentos planos e horizontais; sem inclinação nem rebaixos.
- Ambientes: o contorno é desenhado pelo usuário (não é detectado a partir das paredes); não há áreas líquidas, limites de espaço (`IfcRelSpaceBoundary`), zonas (`IfcZone`) nem tipo de ambiente (`IfcSpaceType`).
- Portas e janelas: retangulares; folha representada fechada no 3D; sem bandeiras, peitoris ou soleiras como peças.
- Uma propriedade `Pset_*Common` é do tipo **ou** da ocorrência (ver [IFC_MAPPING.md](IFC_MAPPING.md)); não há sobreposição do valor do tipo por ocorrência.
- Sem telhado, escada, rampa, forro, estrutura (pilares, vigas, fundações) e mobiliário.
- Sem importação IFC; o DXF ainda não leva a arquitetura.
- Editor: mover, copiar, girar e espelhar só por valores; contornos não editáveis depois de criados; materiais de esquadria (marco, folha, vidro) não editáveis no formulário do tipo; demais limites da interface em [INTERFACE.md](INTERFACE.md), "Ambiente Arquitetura".
