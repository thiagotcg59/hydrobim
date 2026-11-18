# Decisões técnicas

Registro resumido das decisões de arquitetura (formato ADR). Novas decisões entram no fim, com data; decisões revistas são marcadas como substituídas, não apagadas.

## ADR-001 — Modelo paramétrico próprio; IFC como formato de intercâmbio

**Data:** 2026-11-16 · **Estado:** aceita

O editor opera sobre um modelo de domínio próprio, tipado e versionado. O IFC é produzido por uma camada de exportação. Motivo: edição rápida, regras de engenharia explícitas e independência de versões do esquema IFC.

## ADR-002 — Monorepo com npm workspaces, pacotes consumidos como código-fonte

**Estado:** aceita

`packages/*` exportam TypeScript diretamente (`exports` → `src/index.ts`); Vite e Vitest compilam sob demanda. Sem etapa de build por pacote nem ferramentas adicionais (Turborepo, Nx). Reavaliar quando houver publicação de pacotes ou tempos de build relevantes.

`packages/ifc-contracts`, sugerido inicialmente, **não foi criado**: não há código de contrato IFC antes da Fase 3 e pacotes vazios foram evitados. O mapeamento está em `docs/IFC_MAPPING.md`.

## ADR-003 — Esquema único em Zod, espelhado em Pydantic

**Estado:** aceita

`packages/core/src/schema.ts` é a fonte de verdade; os tipos TypeScript são inferidos dele. O backend replica o contrato em Pydantic e um teste valida todos os arquivos de `examples/` nos dois lados. Alternativa adiada: gerar ambos a partir de JSON Schema.

## ADR-004 — Unidades SI internas e eixo Z para cima

**Estado:** aceita

Metros e radianos em todo o domínio; conversões só na apresentação. Z para cima, como na prática de engenharia e no IFC; a câmera do Three.js é configurada com `up = (0, 0, 1)`, sem conversão de eixos entre domínio e cena.

## ADR-005 — DN separado dos diâmetros físicos; catálogo por especificação

**Estado:** aceita

`PipeSpec` armazena DN, diâmetro externo, interno e espessura. Os valores vêm de `packages/catalog`, organizados por material + norma + classe. O elemento guarda a especificação resolvida (o projeto continua legível mesmo que o catálogo mude) e o `specificationId` de origem.

## ADR-006 — Portas e validação derivadas; conectividade em grafo separado

**Estado:** aceita

Portas são calculadas a partir dos parâmetros do elemento; o estado de conexão existe apenas em `Project.connections`. Evita estados inconsistentes (porta "conectada" sem conexão, referência duplicada). Custo: recalcular portas sob demanda — irrelevante no porte atual.

## ADR-007 — Compatibilidade conservadora entre portas

**Estado:** aceita

Só se conectam portas de mesma especificação e mesmo DN, coincidentes e alinhadas. Materiais, normas ou diâmetros diferentes nunca são compatíveis por padrão: exigem redução ou peça de transição (a modelar na Fase 2). Preferiu-se recusar a esconder uma incompatibilidade.

## ADR-008 — Operações puras e projeto imutável

**Estado:** aceita

Cada operação devolve um novo `Project` ou um erro de domínio (`Result<T>`). Benefícios: operações atômicas (falha não deixa estado parcial), desfazer/refazer por instantâneos, testes simples e detecção de mudanças por identidade no React.

## ADR-009 — Geometria independente de motor gráfico

**Estado:** aceita

`packages/geometry` gera malhas (`Float32Array`) no referencial local por varredura de seções circulares ocas, sem depender de Three.js. O viewport apenas as converte em `BufferGeometry`. A mesma geometria poderá alimentar a exportação IFC por malha. Kernel BRep (OpenCascade) fica adiado até haver necessidade real (interferências, cortes), por ser uma dependência pesada.

## ADR-010 — Conexões explícitas; automatismo limitado e previsível

**Estado:** aceita

Na Fase 1 há apenas dois automatismos: conexão de portas exatamente acopladas e joelho automático ao desenhar a partir da extremidade de um tubo (com aparo do tubo). Saídas de conexões ficam presas ao eixo da porta. Roteamento e snapping avançados pertencem à Fase 2.

## ADR-011 — Interface em CSS próprio, sem biblioteca de componentes

**Estado:** aceita (reavaliar na Fase 2)

A interface usa elementos HTML nativos acessíveis (`button`, `select`, `dialog`, `label`) com folha de estilos própria e ícones `lucide-react`. Uma biblioteca de componentes ou Tailwind foi adiada para manter poucas dependências enquanto o conjunto de telas é pequeno. Reavaliar quando surgirem menus, árvores e tabelas complexas.

## ADR-012 — Persistência local atrás de `ProjectRepository`

**Estado:** aceita

Projetos em `localStorage` (JSON versionado), além de importação/exportação de arquivo. A interface do repositório é assíncrona para permitir a troca por API + PostgreSQL. Limite conhecido: cota do `localStorage` (~5 MB); o erro é tratado e o usuário é orientado a exportar o arquivo.

## ADR-013 — Interação do viewport fora do sistema de eventos do R3F

**Estado:** aceita

Um único controlador traduz eventos de ponteiro do canvas em raio → ponto/porta/elemento, usando funções puras testáveis (`editor/picking.ts`). Motivo: precedência clara entre snap de porta, restrição de eixo e plano de trabalho, e distinção simples entre clique e arrasto de câmera.

## ADR-014 — IFC 4.3 como alvo; IFC 4 como compatibilidade futura

**Estado:** aceita

As entidades necessárias existem nos dois esquemas (verificado no IfcOpenShell 0.9.0; ver `IFC_MAPPING.md`). `IfcFacility` existe apenas no 4.3, o que pesa a favor dele para infraestrutura.

## ADR-015 — Backend em Python gerenciado por uv

**Estado:** aceita

FastAPI + Pydantic, com `uv` para ambiente e lockfile. O IfcOpenShell será adicionado apenas na Fase 3. Python 3.11 foi fixado por ser a versão com melhor disponibilidade de binários do IfcOpenShell no ambiente de desenvolvimento.

## ADR-016 — Testes ponta a ponta com Playwright

**Estado:** aceita

Os critérios de aceite são verificados em navegador real (Chromium, WebGL por software), além dos testes unitários. Para isso, toda ação relevante possui um caminho determinístico na interface (entrada por coordenadas, lista de elementos, ações nas portas), o que também serve à precisão exigida em engenharia.

## ADR-017 — Exportador IFC em TypeScript, verificado com IfcOpenShell

**Data:** 2026-11-16 · **Estado:** aceita (revê o plano inicial de exportar no backend)

O exportador IFC 4.3 (`packages/ifc`) é uma função pura em TypeScript que escreve o arquivo IFC-SPF. Motivos: funciona no navegador sem servidor implantado; usa a mesma geometria do viewport (uma única fonte); é testável junto com o domínio. O IfcOpenShell continua sendo a referência: os testes do backend abrem os arquivos de `examples/`, rodam `ifcopenshell.validate` e tesselam a geometria. Custo: o escritor STEP é mantido à mão; mitigado pela validação automática.

## ADR-018 — Famílias de conexões como dados do projeto

**Estado:** aceita

As famílias (tabelas dimensionais) vivem em `packages/catalog` e podem ser sobrepostas por projeto (`Project.families`). As operações de domínio recebem um `FittingCatalog` e não conhecem o catálogo. O elemento guarda as dimensões resolvidas e o `familyId` de origem; editar uma dimensão à mão desvincula a peça da família. Assim o projeto permanece legível mesmo que o catálogo embutido mude.

## ADR-019 — Porta no fundo da bolsa e na face do flange

**Estado:** aceita

A porta de uma conexão fica onde termina o tubo vizinho: no fundo da bolsa ou na face do flange. A bolsa é geometria que avança sobre o tubo; o comprimento do tubo modelado é o comprimento de corte. Consequência: as dimensões de catálogo usadas são "centro ao fundo da bolsa" e "centro à face do flange".

## ADR-020 — Troca de diâmetro local com reduções automáticas

**Estado:** aceita

O comportamento padrão ao mudar o diâmetro de uma peça é alterar só ela (`resizeWithReducers`): insere redução junto a cada vizinho de outro diâmetro, ajusta reduções existentes e remove as que ficam com os dois lados iguais. O tubo adjacente cede o comprimento; as demais peças não se movem. Sem tubo adjacente para ceder espaço, ou em troca de material, a operação é recusada com explicação. A propagação pelo trecho continua disponível como alternativa.

## ADR-021 — Dados de catálogo: somente valores de fontes abertas e identificadas

**Estado:** aceita

Só entram no catálogo embutido valores lidos de um documento identificado (fabricante, edição, página, URL). Valores derivados são declarados na fonte da família. Tabelas com significado de colunas ambíguo não são usadas (a peça fica com dimensões genéricas, sinalizadas ao usuário). As normas pagas não foram consultadas, e isso é dito na documentação.

## ADR-022 — Geometria das peças por perfis de revolução sobre a linha de centro

**Data:** 2026-11-17 · **Estado:** aceita (complementa a ADR-009)

Conexões e válvulas são geradas por `loft`: uma sequência de anéis (centro, tangente, raio) percorrida em circuito fechado — parede externa, face da extremidade, furo de volta — com grupos de suavização separados por arestas vivas. Substitui a composição de cilindros e esfera, que não representava o corpo curvo dos joelhos de bolsa nem o batente das bolsas. O que é dimensão de catálogo e o que é representação está descrito em `CATALOGS.md`. As malhas de peças diferentes podem se interpenetrar (derivação do tê, haste da válvula); não há união booleana.

## ADR-023 — Planta baixa em SVG derivada do modelo; anotações no projeto

**Data:** 2026-11-17 · **Estado:** aceita

A planta baixa é um desenho vetorial (SVG) gerado da malha paramétrica de cada elemento: as faces voltadas para cima formam a máscara opaca (algoritmo do pintor entre elementos, por cota) e desenham-se o contorno aparente, as bordas e as quinas vivas, sem os trechos escondidos por partes mais altas do próprio elemento (`planOutline`). Não há símbolos desenhados à mão: a planta é sempre coerente com o modelo. Limitação aceita: a ocultação entre elementos é por elemento inteiro (o mais alto cobre o mais baixo), não por trecho.

Cotas, textos, chamadas e etiquetas são dados do projeto (esquema v4), no plano XY em metros; o que exibem é derivado. Espessuras e alturas de texto são definidas em milímetros de papel e convertidas pela escala do desenho (`drawingScale`), de modo que a exportação em SVG sai no tamanho físico da prancha. Sem dependências novas. As anotações ainda não são exportadas para o IFC (`IfcAnnotation`).

## ADR-024 — Exportação DXF: R12 em metros, planta como geometria e 3D como malhas

**Data:** 2026-11-17 · **Estado:** aceita

`packages/dxf` escreve DXF ASCII sem dependências, a partir das mesmas fontes do restante do sistema: a planta usa `planOutline` e as anotações do projeto; o 3D usa `buildElementGeometry`.

- **Versão R12 (AC1009).** É o subconjunto aceito por praticamente todo CAD e dispensa a estrutura de objetos (handles, classes, dicionários) exigida a partir do R2000, sem a qual o AutoCAD recusa o arquivo. Como o R12 não tem UTF-8, o arquivo é gravado em Windows-1252 (`$DWGCODEPAGE = ANSI_1252`); só caracteres fora dessa página saem como `\U+XXXX`.
- **Unidades.** O desenho sai em verdadeira grandeza, em metros (`$INSUNITS = 6`). Na planta, textos, traços e setas têm o tamanho de papel multiplicado pela escala do desenho: plotar em 1:escala reproduz a prancha.
- **Camadas.** Uma por sistema hidráulico (`HB-<NOME>`, cor ACI mais próxima da cor do sistema) e, na planta, `HB-COTAS`, `HB-TEXTOS`, `HB-ETIQUETAS` e `HB-LEGENDA`. No 3D, sistemas ocultos vão em camadas desligadas e o terreno em `HB-TERRENO`.
- **Ocultação na planta.** O DXF não tem a máscara opaca do SVG; as linhas de cada elemento são recortadas, de forma exata, pelas faces dos elementos desenhados depois (`occludedPlanLines`), reproduzindo o resultado da tela.
- **Limitações aceitas.** As cotas são geometria (linhas, traços e texto), não entidades `DIMENSION` associativas — no CAD não se atualizam ao mover os pontos. O 3D é formado por malhas poliface (superfícies facetadas), não por sólidos: serve para coordenação e conferência, não para operações booleanas. As diagonais de faces planas ficam invisíveis para o aramado mostrar os quadriláteros.

Os arquivos são verificados nos testes por um leitor de pares de grupo e foram conferidos, na implementação, com a biblioteca `ezdxf` (leitura estrita e auditoria sem erros). Não foram abertos em AutoCAD nesta sessão.

> A planta baixa deixou de seguir esta decisão em três pontos — versão, camadas e cotas —; ver ADR-026. O modelo 3D continua como descrito aqui.

## ADR-025 — Biblioteca de produtos separada das famílias de conexões

**Data:** 2026-11-17 · **Estado:** aceita

A linha PBA completa (Amanco Wavin, FTC000088) foi modelada em 3D sem alterar o esquema do projeto.

- **Duas camadas de catálogo.** As *famílias de conexões* (`FittingFamily`, persistidas no projeto) continuam sendo o que as operações de domínio usam. A *biblioteca de produtos* (`packages/catalog/src/products`) guarda as tabelas do fabricante como impressas — letras das cotas, código, peso, página — e não é persistida: serve à modelagem 3D e à consulta. Motivo: vários produtos (cruzeta, cap, luvas, adaptador, colar, curvas ponta e bolsa) não têm tipo de elemento nem família capaz de descrevê-los; criá-los exigiria esquema novo, API, IFC e EPANET, fora do escopo de uma etapa só de modelagem. Na interface eles aparecem com a inserção desabilitada e identificada (regra 11).
- **Geometria sem conhecer o catálogo.** `packages/geometry/src/pba.ts` recebe dimensões em metros (`PbaShape`); a conversão da linha da tabela fica em `apps/web/src/editor/productModel.ts`, o único ponto que depende dos dois pacotes. Os valores não tabulados usados na conversão ficam em tabelas auxiliares do catálogo, com a origem declarada.
- **Mesma geometria na rede.** Tê e redução de PVC NBR 5647 com bolsas de catálogo passam pelo mesmo gerador em `buildElementGeometry`; se as cotas do elemento não comportarem a peça (dimensões editadas), vale a representação comum.
- **Interseções exatas em vez de sólidos sobrepostos.** `skin.ts` gera a derivação a partir da curva de interseção com a passagem e abre o furo na parede, compartilhando os vértices entre os retalhos. O resultado é um sólido fechado, verificado nos testes por `countOpenEdges`, o que também evita linhas espúrias na planta e no DXF.
- **Limitação aceita.** O raio das curvas PBA não é tabulado; é derivado das cotas L sob uma hipótese declarada (`docs/CATALOGS.md`). Por isso as curvas não viraram família de conexão nesta etapa.

## ADR-026 — Planta em DXF R2000: camadas por categoria, `DIMENSION`, blocos e polilinhas

**Data:** 2026-11-17 · **Estado:** aceita (altera a ADR-024 no que diz respeito à planta)

A planta exportada precisa chegar ao CAD pronta para detalhamento: organizada por categoria, com cotas e componentes editáveis como objetos, e não como linhas soltas.

- **Versão R2000 (AC1015) na planta; R12 no 3D.** Espessura de linha por camada (grupo 370) e `LWPOLYLINE` não existem no R12. O escritor (`writer.ts`) passou a gerar as duas versões; no R2000 ele escreve a estrutura que o AutoCAD exige (handles, `BLOCK_RECORD`, `*Model_Space`/`*Paper_Space`, `VPORT`, `APPID`, dicionário raiz com `ACAD_GROUP`). O texto continua em Windows-1252 (UTF-8 só existe a partir do R2007). `exportPlanDxf(..., { version: 'R12' })` mantém a alternativa para leitores antigos, sem espessuras.
- **Camadas por categoria** (`PLAN_LAYERS`), em vez de uma por sistema: `REDE_TUBULACOES`, `REDE_CONEXOES` (curvas, tês, reduções), `REDE_REGISTROS` (válvulas), `REDE_ACESSORIOS` (bombas e reservatórios), `REDE_EIXOS`, `REDE_TEXTOS` (textos e chamadas), `REDE_DIAMETROS` (etiquetas de tubos: designação e extensão), `REDE_IDENTIFICACOES` (etiquetas dos demais componentes), `REDE_COTAS`, `REDE_COTAS_ALTIMETRICAS` e `REDE_LEGENDA`. Cada uma tem cor, tipo e espessura de linha próprios (0,25 mm na rede e 0,18 mm nas anotações, como na tela); as cores são convenção do exportador, não de norma. Nada fica na camada `0`, exceto o conteúdo dos blocos, que assim assume a camada de cada inserção. A cor do sistema hidráulico não é levada para a planta (na tela ela é só o preenchimento).
- **Cotas como `DIMENSION`.** Linear com ângulo (horizontal/vertical) ou alinhada, com o estilo `HB_COTA` (traço oblíquo, texto acima da linha, duas casas, vírgula), dimensionado em metros para a escala do desenho. O bloco anônimo da cota traz exatamente o traçado da tela; o texto fica vazio para o CAD escrever o valor medido — e atualizá-lo ao editar a cota —, salvo quando o texto da planta difere do que o estilo produz (separador de milhar) ou no R12, que não tem essas variáveis. As cotas não são associativas a objetos (não há reatores no arquivo).
- **Cada elemento da rede é um bloco.** Cada trecho de tubo — de uma conexão ou acessório ao seguinte, como no modelo — e cada conexão, registro ou equipamento é um `INSERT` na posição do elemento, com a sua rotação em planta (nos tubos, a origem é o início do trecho e o eixo X, a direção dele); a definição é a projeção no referencial do elemento. Projeções iguais (comparadas em uma grade de 0,1 mm, depois de fundidos os segmentos colineares) usam o mesmo bloco: `HB_TUBO_n`, `HB_CURVA_n`, `HB_TE_n`… Um elemento parcialmente encoberto por outro tem projeção própria e, portanto, bloco próprio. Os tubos chegaram a sair como polilinhas soltas no espaço do modelo; passaram a blocos porque o responsável relatou que, no programa em que abre o arquivo, a tubulação inteira aparecia como um único elemento, enquanto os blocos eram tratados um a um. Dentro do bloco, o contorno é uma `LWPOLYLINE`: `mergeCollinear` funde os segmentos colineares sobrepostos da projeção (a boca do tubo vista de perfil são várias arestas sobre a mesma reta) e `chainSegments` une as arestas e elimina vértices de trechos retos. O contorno só fica aberto onde a tela também esconde a ponta do tubo (dentro da bolsa de uma conexão).
- **Eixos.** O eixo de cada tubo vai em `REDE_EIXOS` (traço e ponto), em camada **desligada**: a planta da tela não mostra eixos, e o arquivo deve abrir igual a ela. Os eixos não passam pela remoção de linhas ocultas.
- **O que não existe ainda fica vazio, não simulado.** `REDE_COTAS_ALTIMETRICAS` é criada sem entidades: o projeto não tem cotas de nível (roadmap). Textos são `TEXT` (uma entidade por linha), posicionados pela linha de base para ocupar o lugar que ocupam na tela.

Verificação: testes unitários com leitor de pares de grupo (estrutura, handles únicos abaixo de `$HANDSEED`, camadas, blocos, cotas) e, na implementação, leitura estrita e auditoria com `ezdxf` 1.4.5 sem erros nem correções nas duas versões, regeneração das cotas pelo estilo com os mesmos valores e conferência visual da planta renderizada. **Não foi aberto em AutoCAD nem em Civil 3D nesta sessão.**

## ADR-027 — Filtro Y como tipo de peça em linha; furação de flanges como dado opcional

**Data:** 2026-11-17 · **Estado:** aceita

O filtro Y entra como `valveType: 'strainer'` do elemento `valve`: é uma peça em linha de duas portas, com face a face e família de catálogo, e reaproveita inserção, acoplamento, dimensionamento e edição já existentes. Não é uma válvula — a classe interna não se confunde com a entidade IFC: exporta-se `IfcFilter` com tipo predefinido `STRAINER` (conferido no esquema IFC4X3_ADD2 com IfcOpenShell). No quantitativo aparece como "Filtro Y" e, no EPANET, como trecho aberto com aviso (a perda de carga da tela não é representada). O campo `height` do filtro é a distância do eixo ao ponto mais baixo do bojo, medida para baixo. Criar um `kind` próprio para acessórios em linha fica para quando houver mais de um deles.

A furação dos flanges (`boltCircle`, `boltCount`, `boltHoleDiameter`) passa a ser um dado opcional das extremidades (esquema v5). Só é preenchida a partir de norma ou catálogo citado; ausente, o flange continua representado como disco liso — nada é inferido do DN. A geometria fura o disco quando o dado existe e cai no disco liso se a furação informada não couber nele.

## ADR-028 — Modelagem pela planta: elevação do eixo e trava nos ângulos de catálogo

**Data:** 2026-11-17 · **Estado:** aceita

As ferramentas de modelagem passaram a funcionar na planta baixa, no modo de trabalho usual de projeto de instalações (traçar em planta, com a cota dada por um parâmetro), sem duplicar regras de modelagem.

- **Um só evento de domínio.** A planta resolve o clique 2D em ponto 3D, porta e elemento (`apps/web/src/editor/planPicking.ts`, funções puras) e chama o mesmo `handleViewportClick` do viewport 3D. `setTool` deixou de forçar a vista 3D para as ferramentas de modelagem; as de anotação continuam exclusivas da planta.
- **Elevação do eixo.** `pipeElevation` (estado do editor, não persistido) é a altura do eixo das tubulações acima do plano de trabalho (nível). Pontos livres da ferramenta de tubo nascem em `nível + elevação`, nas duas vistas (a grade do 3D acompanha). A elevação **acompanha a extremidade de partida**: ao iniciar em uma porta em outra cota, o trecho segue na cota da porta e o campo passa a mostrá-la. **Alterar a elevação com um trecho em andamento cria a prumada** no último ponto (tubo vertical e joelho automático); se a prumada não puder ser criada (por exemplo, saída horizontal de uma conexão), nada muda e o erro é exibido. Bomba e reservatório continuam no plano do nível.
- **Trava nos ângulos de catálogo.** `availableElbowAngles` (core) lista as deflexões com joelho de família para a especificação e o diâmetro da porta; `constrainDeflection` ajusta o ponto para a deflexão mais próxima (ou o prolongamento reto), no plano do ponto pedido. A trava vale na planta, no 3D e, como recusa (`NO_ELBOW_FOR_ANGLE`, com a lista de ângulos), em `drawPipe` — o que cobre a entrada por coordenadas e o fechamento sobre uma porta existente. O joelho avulso segue a mesma regra. **Somente peças de catálogo (revisão do mesmo dia, a pedido do responsável).** A trava virou uma política geral, ligada por padrão: nenhuma operação do editor cria joelho, tê, redução ou válvula de dimensões genéricas. `catalogViolation` (core, `catalogPolicy.ts`) compara o projeto antes e depois da operação e aponta as conexões criadas sem família e as que perderiam o vínculo; a store recusa o resultado, com a mensagem do motivo. Vale para o traçado (joelho e tê automáticos), a inserção em porta e em linha, a troca de diâmetro com reduções, a troca de especificação do trecho e a edição de dimensões no painel de propriedades. **Sem joelho de catálogo para a especificação e o diâmetro, o traçado só prolonga em linha reta** e a mudança de direção é recusada — não se inventam ângulos "padrão" (regra 12). Trocar o ângulo de um joelho por outro de catálogo passa por `setElbowCatalogAngle`, que assume as dimensões e o vínculo da nova família. Peças que já eram genéricas (projetos anteriores) não são bloqueadas. A opção "Somente peças de catálogo" pode ser desligada nas opções da ferramenta; aí valem as dimensões genéricas, identificadas como tal. Bombas e o reservatório genérico são equipamentos e ficam fora da política. O tipo de válvula inicial da ferramenta passa a ser o primeiro com família para a especificação do projeto.
- **Ambiguidades da planta, tratadas de forma explícita.** Portas sobrepostas em X/Y: captura a de cota mais próxima da elevação de desenho (ou da âncora) e mostra, junto ao cursor, a cota capturada e quantas estão sobrepostas. Eixo travado vertical (saída de conexão para cima/baixo): o clique é recusado (`VERTICAL_AXIS_IN_PLAN`) e o trecho é criado pela elevação. Inserção em linha em tubo vertical: recusada (`PIPE_VERTICAL_IN_PLAN`), a fazer no 3D. Tubo inclinado: a posição em linha é medida no eixo 3D, não na projeção. Sistemas ocultos não são capturados.
- **Escolha manual e edição.** Com extremidades sobrepostas sob o cursor, Tab (Shift+Tab) percorre as demais, a partir da preferida. Alterar o ângulo de um joelho existente no painel de propriedades passa pela mesma trava. Um campo numérico cuja alteração é recusada volta a mostrar o valor vigente.
- **Consequência conhecida.** Especificações sem conexões de catálogo ficam restritas: em PVC PBA não há joelho nem curva como família (as curvas ponta e bolsa estão só na biblioteca de produtos, ADR-025), e em PEAD não há nenhuma conexão. Nelas, com a política ligada, não é possível mudar de direção nem inserir essas peças até que as famílias existam (roadmap, Fase 2).
- **Limitações aceitas.** Não há declividade paramétrica (o trecho em planta é horizontal, salvo ao fechar sobre uma porta em outra cota). Ela não foi incluída porque a transição entre declividades é uma deflexão pequena (1 % ≈ 0,57°), acima da tolerância de alinhamento e sem joelho correspondente: exige antes definir a deflexão admissível por junta, que depende do tipo de junta e do fabricante. Com a política desligada, um joelho cujo ângulo é editado conserva o raio anterior e perde o vínculo com a família (comportamento anterior de `updateFitting`).

Verificação: testes unitários do core (`elbowAngles.test.ts`), da resolução do clique (`planPicking.test.ts`) e da store (`planModeling.test.ts`); E2E no navegador (`tests/e2e/planModeling.spec.ts`).

## ADR-029 — Reservatórios de catálogo: forma construtiva no elemento `tank`, famílias embutidas e origem dos parâmetros

**Data:** 2026-11-17 · **Estado:** aceita

Os reservatórios metálicos de catálogo (TRAMEC, oito famílias) entram como o mesmo elemento `tank`, com um discriminador de forma construtiva (`tankType`) e campos opcionais (esquema v6). Sem `tankType` o elemento continua sendo o cilindro genérico, e documentos v5 seguem válidos.

- **Um `kind`, várias formas.** Posicionamento, portas, conexão, cópia, sistemas, quantitativo e EPANET já tratam `tank`; criar oito tipos de elemento multiplicaria esse código. As portas `a` (saída) e `b` (entrada) mantêm os identificadores; bocais adicionais são portas cujo id é o do bocal, de modo que as conexões existentes não mudam.
- **Famílias embutidas, fora do documento do projeto.** `TankFamily` (tipo no core, dados em `packages/catalog/src/tanks`) descreve as linhas das tabelas. O elemento guarda `familyId` e `variantId`; as dimensões ficam no elemento. Diferente das famílias de conexões, não são editáveis por projeto: a personalização é feita na ocorrência, mantendo a forma da família.
- **Só o que o catálogo traz é dado de catálogo.** O catálogo tabula capacidade, altura total, diâmetro e (em uma família) a altura da coluna. Três famílias não têm tabela: para elas não se cadastraram modelos — criar "tipos comerciais" a partir da faixa de capacidade seria inventar dados (regra 12). Diâmetro de coluna, alturas de cone, espessuras, acessórios e bocais são estimativas de representação ou escolhas do usuário.
- **Origem dos parâmetros é derivada, não persistida.** `tankParameterOrigins` compara o elemento com a família e classifica cada parâmetro (catálogo, derivado, estimado, usuário). Persistir a classificação permitiria que ela divergisse dos valores (regra 5).
- **Editar não descaracteriza.** Alterar uma dimensão de catálogo mantém `familyId` (a geometria característica) e remove `variantId`; o modelo passa a "dimensões personalizadas".
- **Espessura opcional.** Sem valor informado, a propriedade IFC fica vazia e a malha usa 6 mm só para existir superfície interna e externa.
- **Malhas unidas por papel.** Corpo, acessórios e revestimento saem como poucas malhas (`mergeMeshes`), para não gerar uma chamada de desenho e uma entidade IFC por degrau de escada. Novos papéis de cor: `paint`, `steel`, `galvanized`, `liner`.
- **IFC.** `IfcTankType` por modelo, material do corpo, conjuntos padrão conferidos nos modelos do IFC 4.3 e `Pset_<Fabricante>_Reservatorio`. O pacote `ifc` continua sem depender do catálogo: as famílias chegam por `IfcExportOptions.tankFamilies`.

Limitações aceitas: divisão interna de células e plataformas não são desenhadas; não há bocais verticais (descarga no vértice do cone, respiro); o horizontal enterrado não é modelado; no EPANET, reservatórios de seção variável viram o cilindro equivalente, com aviso. A seção de famílias passou a se chamar **Catálogo** e ganhou a aba Reservatórios (tabela do fabricante, modelo 3D por linha e atalho para a ferramenta); a aba Conexões pode listar as famílias de todas as especificações.

Verificação: testes unitários do core (`tanks.test.ts`), transcrição do catálogo (`packages/catalog/src/tanks.test.ts`), geometria e IFC dos 113 modelos (`tests/integration/tankGeometry.test.ts`, `tankIfc.test.ts`), backend (esquema v6 e reabertura do IFC de `examples/reservatorios-tramec.ifc` com IfcOpenShell: `validate` sem erros, propriedades e malha tesselada conferidas contra o projeto) e E2E (`tests/e2e/tanks.spec.ts`), com conferência visual das oito formas contra as imagens do catálogo.

## ADR-030 — Tabela única de flanges; ressalto e extremidades de tubos no esquema v7

**Data:** 2026-11-17 · **Estado:** aceita

- **Uma tabela, todas as peças.** Os flanges PN 10/16/25/40 do Catálogo Geral (p. 246–249) ficam em `packages/catalog/src/flanges.ts`. As famílias flangeadas existentes (PAM, AVK, BERMAD) deixaram de carregar cópias do flange e passaram a buscar o PN 10 ali; famílias novas fazem o mesmo (regra 14 do `AGENTS.md`). O fallback antigo `[20, DN × 1,6]` foi removido: derivava dimensão do DN (regra 3) e nunca era atingido.
- **Fonte parcialmente identificada.** As páginas recebidas não trazem fabricante, edição nem norma. A fonte cita o arquivo e as páginas; `manufacturer` fica `null`. Completar quando a capa do catálogo estiver disponível.
- **O filtro Spirax Sarco fica fora da padronização.** O fabricante informa flange ASME B16.1 classe 125; trocá-lo por PN 10 apresentaria uma furação que o produto não tem (regras 8 e 12).
- **Ressalto no esquema.** `raisedFaceDiameter`/`raisedFaceHeight` são opcionais em `EndTreatment` e `FamilyEnd`. A espessura `length` inclui o ressalto (leitura do desenho, declarada), de modo que a posição das portas não muda.
- **Tubo com flanges é um `pipe` com `ends`.** Não se criou um tipo de elemento nem uma `FittingFamily` de tubos: o tubo já tem portas, comprimento livre, divisão e dimensionamento. `ends` (opcional, chaves `start`/`end`, só `flange`) reaproveita `EndTreatment` e `getPorts`. A família de tubos flangeados é embutida (como as de reservatórios) e o core a alcança por `FittingCatalog.pipeFlange`, opcional — o core continua sem conhecer o catálogo.
- **Sem comprimentos comerciais.** As páginas não tabulam comprimentos de tubos e tocos com flanges; cadastrar "modelos" seria inventar dados. O comprimento é do usuário.
- **Operações.** `setPipeEnds` e `AddPipeInput.ends`; `insertInline` reparte os flanges entre os dois trechos; `applySpec` troca o flange pelo do novo DN ou volta à ponta lisa se não houver; o quantitativo distingue "Tubo flange e flange" e "Tubo flange e ponta".
- **Geometria.** `flangeDisc` (disco furado + anel do ressalto) e `flangeHubRadius` (cubo de representação) servem a todas as peças; o tubo flangeado usa o mesmo corpo com cubos das conexões. No IFC, o tubo flangeado sai em malha (o perfil extrudado não representa flanges).

Limitações aceitas: a compatibilidade do tipo de extremidade (flange × ponta, PN diferentes) ainda não é verificada na conexão (roadmap, Fase 2); o flange avulso não é elemento da rede; parafusos e juntas não são modelados nem quantificados.

Verificação: `flanges.test.ts` (catálogo), `pipeEnds.test.ts` (core), `flange.test.ts` (geometria), `export.test.ts` (IFC), `test_project.py` (backend, esquema v7) e `tests/e2e/flanges.spec.ts`, com conferência visual do flange e do tubo flangeado.

## ADR-031 — Envio ao GitHub no encerramento da sessão; editor no GitHub Pages

**Data:** 2026-11-17 · **Estado:** aceita

- **Quando enviar.** O responsável quer o GitHub atualizado sempre que usa a ferramenta, mas só ao terminar a sessão do localhost. O `iniciar.ps1` abre o editor e, ao encerrar com Q, roda `npm run check` e faz `git push` da branch atual. É o mesmo princípio do projeto ifc-energy (push após trabalho verificado), adaptado ao fluxo de branches deste repositório.
- **Para onde.** Só a branch de trabalho (`feature/...`); `main` e `develop` continuam recebendo por pull request. O script recusa enviar se estiver nelas.
- **Sem commits genéricos.** Alterações pendentes só viram commit com mensagem Conventional Commits digitada pelo responsável, validada por expressão regular; Enter envia apenas os commits já feitos. Nada é commitado nem enviado se a verificação falhar.
- **Ctrl+C não envia.** Encerrar com Q é intencional; Ctrl+C é a saída de emergência. Os testes E2E e do backend ficam com o CI (`ci.yml`), para o encerramento não demorar.
- **GitHub Pages.** O editor roda inteiro no navegador (a API é opcional), então `pages.yml` publica o build de `apps/web` em `/hydrobim/` a cada push na `main`. Caminhos de arquivos públicos usam `import.meta.env.BASE_URL`.

Sem dependências novas: PowerShell, Git e GitHub Actions oficiais (`upload-pages-artifact`, `deploy-pages`).

## ADR-032 — Famílias de reservatórios personalizadas: cópia no projeto, catálogo intacto

**Data:** 2026-11-17 · **Estado:** aceita (complementa a ADR-029)

O usuário precisa ajustar as dimensões de tabela de uma família de reservatórios sem alterar o catálogo do fabricante. A família é **duplicada** para o projeto (`Project.tankFamilies`, esquema v8) e só a cópia é editável.

- **Cópia, não sobreposição.** Nas conexões, a família alterada sobrepõe a do catálogo com o mesmo id. Nos reservatórios a cópia recebe um id novo e convive com a original: a tabela do fabricante continua disponível e conferível contra o PDF, e não há como um valor editado passar por valor impresso.
- **A cópia não é dado de fabricante.** Fabricante "Personalizado", `origin: 'custom'`, `basedOn` e fonte que cita a origem. `tankParameterOrigins` nunca devolve *catálogo* para uma família personalizada; no IFC o conjunto sai como `Pset_Personalizado_Reservatorio`, com a fonte declarando a personalização (regras 8 e 12).
- **`TankFamily` passou a ser tipo do esquema** (Zod), porque agora é persistido; o catálogo embutido usa o mesmo tipo, com `origin: 'builtin'`.
- **Linhas mantêm o id ao serem editadas**, de modo que os reservatórios inseridos continuam ligados ao modelo e podem ser recalculados (`applyTankFamilyToInstances`). Linha removida: o reservatório mantém as dimensões e perde o vínculo com o modelo. Família excluída: mantém forma e dimensões, sem família.
- **Validação por linha.** Cada linha precisa gerar um reservatório coerente (`tankParametersFromFamily`); o erro indica a linha.

Limitações aceitas: só as colunas da tabela (e o nome) são editáveis na família — proporções estimadas, acessórios e bocais continuam sendo ajustados em cada reservatório; não há importação/exportação de famílias entre projetos.

Verificação: `packages/core/src/tanks.test.ts` (duplicar, editar, recusar, reaplicar, excluir, salvar e reabrir), backend (esquema v8, migração e validação de `tankFamilies`) e E2E (`tests/e2e/tanks.spec.ts`).
