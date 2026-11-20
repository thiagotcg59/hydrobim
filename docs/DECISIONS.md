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
- **Limitação aceita.** O raio das curvas PBA não é tabulado; é derivado das cotas L sob uma hipótese declarada (`docs/CATALOGS.md`). Por isso as curvas não viraram família de conexão nesta etapa. (Revisto no ADR-034.)

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
- **Consequência conhecida.** Especificações sem conexões de catálogo ficam restritas: em PVC PBA não há joelho nem curva como família (as curvas ponta e bolsa estão só na biblioteca de produtos, ADR-025), e em PEAD não há nenhuma conexão. Nelas, com a política ligada, não é possível mudar de direção nem inserir essas peças até que as famílias existam (roadmap, Fase 2). (Revisto no ADR-034: as curvas PBA passaram a ser famílias de joelho.)
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

## ADR-033 — Camada BIM: modelo de informação IFC derivado, registro único de propriedades e valores do usuário no esquema v9

**Contexto.** A exportação IFC classificava os elementos, mas só os reservatórios de catálogo tinham `IfcTypeObject` e conjuntos padronizados; as demais propriedades iam para um conjunto próprio. Não havia onde consultar, completar e validar a informação IFC antes de exportar.

**Decisão.**

- **Um modelo de informação, duas saídas.** `buildIfcModel(project)` (`packages/ifc/src/bim`) deriva do projeto a classificação, os tipos, os conjuntos de propriedades e de quantidades, as portas e os materiais. A aba BIM / IFC mostra esse modelo e `exportIfc` o grava — não existe campo de interface que não seja exportado, nem propriedade exportada que o painel não mostre.
- **Registro central de propriedades** (`definitions.ts`): cada definição traz conjunto, escopo (tipo × ocorrência), classes de elemento, tipo predefinido, como o valor é derivado, se o perfil do projeto a exige e se o usuário pode informá-la. Não há estruturas por família.
- **Nada do esquema é digitado à mão.** O tipo de valor e a enumeração das propriedades padronizadas vêm de `schemaData.ts`, gerado por `services/api/scripts/generate_ifc_schema_data.py` a partir do esquema `IFC4X3_ADD2` e dos modelos de conjuntos de propriedades do IfcOpenShell. Referir uma propriedade inexistente faz o módulo falhar ao carregar. Conjuntos próprios usam o prefixo `HydroBIM_`.
- **Sem dados fictícios.** O que o modelo não conhece fica sem valor. As pressões (`WorkingPressure`, `PressureClass` em pascal) **não são derivadas** da designação da classe ("PN 10", "Classe 15", "K9"): a designação continua em `HydroBIM_Especificacao.PressureClass` e a pressão é informada pelo usuário. Cada valor declara a origem: geometria, cadastro, catálogo, usuário ou não informado.
- **Tipo por produto.** A chave do tipo (`ifcTypeKey`) reúne família, especificação, diâmetros, dimensões e dados de fabricação. Ocorrências iguais compartilham o `Ifc…Type`; os reservatórios de catálogo mantêm a chave e os GlobalIds anteriores.
- **Esquema v9.** Só os valores digitados são persistidos: `element.ifc` (ocorrência) e `project.ifcTypes` (tipo — vale também para ocorrências futuras). Tudo o mais continua derivado (regra 5).
- **Validação em dois níveis.** `schema`: requisitos normativos do IFC 4.3; `project`: requisitos adicionais do perfil (propriedades exigidas → *pendente*). O mesmo perfil é exportado em IDS 1.0.
- **Unidades.** O arquivo declara pascal, watt, segundo, m³/s e s⁻¹ além de metro, m², m³ e radiano; a aba converte para MPa, L/s, kW, rpm, mm e % só na apresentação.

**Consequências.** A exportação passou a depender das famílias do catálogo (`IfcExportOptions.families`), fornecidas pelo editor — o pacote `ifc` continua sem depender de `catalog`. Trocar a dimensão de um elemento muda o seu tipo e, com ele, os valores de tipo aplicáveis (os anteriores ficam guardados para quando o tipo voltar a existir). O perfil de requisitos é fixo no código; torná-lo editável e importar IDS de terceiros ficam para depois.

**Verificação.** Vitest: registro × esquema, modelo, validação, edição e IDS (`packages/ifc/src/bim/bim.test.ts`), operações e migração (`packages/core/src/ifcValues.test.ts`), biblioteca e exemplos (`tests/integration/ifcBim.test.ts`). Backend: `tests/test_ifc_bim.py` reabre os IFC com o IfcOpenShell e confere cada `Pset_*`/`Qto_*` contra os modelos oficiais (existência, aplicabilidade, tipo de valor, enumeração), tipos, materiais e coincidência das portas conectadas; `ifcopenshell.validate` com regras EXPRESS sem erros. E2E: `tests/e2e/bim.spec.ts`. **Não verificado:** o IDS exportado contra o XSD/`ifctester` e a abertura em ferramentas de terceiros.

## ADR-034 — Curvas PBA ponta e bolsa como famílias de joelho; trechos retos do joelho no esquema v10

**Contexto.** Com "somente peças de catálogo" (ADR-028), o PVC PBA não mudava de direção: as curvas da ficha Wavin estavam só na biblioteca de produtos (ADR-025). Com a opção desligada, o ângulo ficava livre e o traçado produzia joelhos genéricos fora de esquadro (ex.: 91°). O joelho do modelo era simétrico (arco tangente às duas portas), e a curva PBA não é: tem bolsa de um lado e ponta do outro, com trechos retos diferentes.

**Decisão.**
- **Esquema v10.** O joelho ganha `straight: { a, b }` (opcional): trechos retos entre o arco e cada porta. As portas ficam a `R·tg(θ/2) + straight` do vértice. Nos tamanhos de família, `centerToEnd2` (vértice à porta `b`) e `bendRadius`; com `bendRadius` informado, `end` vale só para a porta `a` e `end2` para a `b`. Documentos v9 já são válidos.
- **Famílias.** Curvas PBA de 90°, 45°, 22°30′ e 11°15′, DN 50/75/100, nas três classes. Porta `a` = fundo da bolsa; porta `b` = extremidade da ponta (fundo da bolsa do tubo seguinte, regra 13).
- **Origem dos valores.** C, A, D, F e L são tabulados. O raio e o trecho reto após a bolsa são **derivados** sob a hipótese já registrada em `docs/CATALOGS.md` (mesmo raio nas curvas de 45° e 90°); a derivação está declarada em `source`. A 90°, a distância do vértice ao fundo da bolsa (`L − C − D/2`) não depende da hipótese.

**Consequências.** Em PVC PBA o traçado trava nos quatro ângulos e cria a curva de catálogo; o tubo anterior e o seguinte são aparados a distâncias diferentes. O sentido do traçado define a orientação (bolsa do lado de onde se vem). As tabelas de 11°15′ e 22°30′ são impressas idênticas no catálogo — transcritas como estão, com a ressalva na fonte. PEAD continua sem conexões de catálogo. A cota IFC `CenterToEnd` informa a porta `a`.

**Verificação.** Vitest: `packages/catalog/src/families.test.ts` (ângulos, bolsa, distâncias), `apps/web/src/state/planModeling.test.ts` (traçado a 90° e 45° em PBA, recusa de 60°), backend (`straight`, migração v9).

## ADR-035 — Gavetas EURO 20: castelo retangular como dado (`bonnetLength`), dentro do esquema v10

**Data:** 2026-11-18 · **Estado:** aceita

O catálogo das gavetas de cunha de borracha tabula o castelo como K × K1. K1 (transversal) usa o campo `width`, que já existia; K (ao longo do eixo do tubo) ganhou o campo opcional `bonnetLength`, em válvulas e nos tamanhos de família. A geometria só usa o castelo retangular quando os dois valores existem; sem eles, a gaveta continua com o castelo genérico de revolução e o volante — nenhuma família anterior muda de aparência.

O campo entrou no próprio esquema v10, que ainda não havia sido publicado em commit quando a alteração foi feita, em vez de abrir uma v11: é opcional, não exige migração de dados e evita duas versões seguidas sem diferença de conteúdo. A nota da migração v9 → v10 registra o campo.

A altura cadastrada é H1 (eixo ao topo da haste), não H: H inclui o cabeçote, que é acessório, e a peça de referência é a de haste nua. A versão com volante não foi cadastrada porque o catálogo não tabula o volante.

As divergências internas do catálogo (D do DN 100, Lt de DN 200 e 300 no EURO 25, "11 x 194") estão registradas em `docs/CATALOGS.md` e no cabeçalho de `euro20.ts`; nenhuma foi corrigida em silêncio.

## ADR-036 — Ambiente Infra: referenciais no `core`, mapa fora do domínio, origem de renderização e esquema v11

**Data:** 2026-11-18 · **Estado:** aceita

**Contexto.** Redes externas pedem mapa de fundo georreferenciado, escalas de 1:500 a 1:10.000 e coordenadas de centenas de quilômetros. A georreferência existente só alimentava o IFC; a planta e o 3D perdiam precisão com coordenadas grandes (diagnóstico em `docs/INFRA.md`).

**Decisão.**
- **Transformações próprias, sem dependência nova.** A Transversa de Mercator (séries de Krüger, ordem n⁴) e o esquema de ladrilhos Web Mercator foram implementados em `packages/core/src/geo`, que continua dependendo só de `zod`. A alternativa era `proj4js`: traria o suporte a qualquer CRS, mas também a tentação de aceitar sistemas cujo datum não está conferido. O registro (`findProjectedCrs`) aceita apenas SIRGAS 2000 / UTM e WGS 84 / UTM, com os parâmetros conferidos contra o banco EPSG do PROJ 9.8.1; os testes comparam 13 pontos de controle com o PROJ. Outros sistemas (SAD69, Córrego Alegre) ficam explicitamente sem transformação para o mapa, em vez de aproximados.
- **O mapa não entra no domínio.** `project.infra.basemap.sourceId` guarda só a escolha; o registro de provedores e o cálculo dos ladrilhos ficam em `apps/web/src/map`. Nenhuma medida é tomada sobre a imagem.
- **Fonte de mapa.** Sentinel-2 cloudless 2016 da EOX (CC BY 4.0), único serviço encontrado que é público, documentado, sem chave e com licença compatível com uso profissional. Esri World Imagery, as camadas EOX de 2018 em diante (não comerciais) e os demais candidatos foram descartados pelos termos ou pela qualidade — ver `docs/INFRA.md`. Nenhuma credencial, nenhum serviço pago, nenhum endereço não documentado.
- **Tema de ruas e georreferência pelo mapa** (pedido do responsável, 2026-11-18). Ladrilhos padrão do OpenStreetMap, só para exibição na tela e com atribuição, conforme a política do serviço. O georreferenciamento pendente abre um mapa em que o usuário clica a origem do modelo; o fuso inicial é o SIRGAS 2000 / UTM 21S, com o 22S e os demais fusos brasileiros como opção. O fuso é uma opção pré-selecionada, não uma atribuição: a georreferência só é gravada quando o usuário confirma um ponto, e pontos fora do fuso escolhido são recusados.
- **Fonte personalizada no navegador, não no projeto.** Imagem de alta resolução depende de serviços com conta ou chave. O usuário cadastra o endereço de ladrilhos do serviço a que tem direito; ele fica no `localStorage` e o projeto guarda só `sourceId: "custom"`. Assim nenhuma credencial entra no repositório, no arquivo do projeto ou em exportações, e o HydroBIM não embute serviço pago. A licença dessa fonte é responsabilidade do usuário; a imagem não é exportada.
- **Ladrilhos como `<image>` do SVG**, um por ladrilho, com transformação afim calculada pelos cantos. Dispensa uma biblioteca de mapas (que imporia o seu próprio referencial à planta) e mantém a rede e a imagem no mesmo sistema de coordenadas do desenho. O erro da colocação afim é medido em teste (< 0,5 px nos níveis 10 a 14).
- **Origem de renderização** como estado de sessão (`renderOrigin`), aplicada nas bordas das vistas. O projeto nunca é transladado: coordenadas canônicas, identificadores, conectividade e exportações não passam por ela. `PlanOutline` passou a precisão dupla para que a planta e o DXF não percam os milímetros na origem dos dados.
- **Esquema v11.** `infra` (escala de documentação, mapa, camadas e rótulos da Planta Infra) e `georeference.verticalDatum`. A escala da Planta Infra é separada de `drawingScale`, para que as preferências de documentação de um ambiente não alterem o outro.
- **Escala 1 entre local e projetado.** Mantida, por ser a do `IfcMapConversion` já exportado; o fator de escala da projeção é mostrado ao usuário e o fator combinado fica para etapa posterior.

**Consequências.** A Planta Infra funciona sem rede e sem georreferência (fundo técnico, coordenadas locais); o mapa é um acréscimo que pode falhar sem afetar a edição. A resolução da imagem (10 m) serve a adutoras e redes urbanas, não ao detalhe de um lote — a ortofoto do usuário é a evolução prevista. Sistemas de referência fora do registro não têm mapa até que a sua transformação seja implementada e conferida. A planta do Infra exporta a janela visível, sem a imagem.

**Verificação.** Vitest: `packages/core/src/geo/geo.test.ts` (PROJ), `packages/core/src/infra.test.ts` (configuração e migração), `apps/web/src/map/tiles.test.ts`, `apps/web/src/infra/infraPlan.test.ts` (regras e cenário de desempenho), `apps/web/src/editor/renderOrigin.test.ts`. Playwright: `tests/e2e/infra.spec.ts` (ponto de controle sobre o mapa após zoom, deslocamento e reabertura; falha do serviço; coordenadas UTM; independência do MEP). Backend: migração v10 → v11 e validação de `infra`.

## ADR-037 — Medidor de vazão (macromedidor) como tipo de peça em linha, dentro do esquema v11

**Contexto.** O catálogo não tinha macromedidor. A peça é um carretel flangeado de duas portas, com face a face e altura de catálogo — a mesma forma de dado de uma válvula em linha.

**Decisão.**

- **`valveType: 'flowMeter'` no elemento `valve`**, como o filtro Y (ADR-027): reaproveita inserção em linha, acoplamento, edição e famílias. Não é válvula: tem nome próprio ("Medidor de vazão N"), aparece assim nos quantitativos e, no IFC, é `IfcFlowMeter`/`WATERMETER` (entidade e tipo conferidos em `schemaData.ts`). Os conjuntos padronizados do medidor não estão em `schemaData.ts` (gerado, não editado à mão): só o conjunto próprio `HydroBIM_Medidor` e os gerais (fabricante, dimensões) são emitidos.
- **Dentro do esquema v11**, que ainda não havia sido publicado em commit (mesmo critério do ADR-035): é um valor novo de enumeração, sem migração de dados.
- **Família Sanecom com flange PN 10 da tabela única** (regra 14), e não o flange impresso na página do fabricante nem a classe PN 1.6 que ele indica até DN 200: o ferro dúctil do catálogo é padronizado no PN 10 e a diferença se resume ao número de furos do DN 200. Detalhes e derivações em `docs/CATALOGS.md`.
- **EPANET:** exportado como trecho aberto, com aviso (a perda de carga do medidor não é representada).

**Verificação.** Vitest: `packages/catalog/src/families/sanecom.test.ts` (transcrição, flange, inserção em linha e validação), `packages/geometry/src/flowMeter.test.ts`, `packages/ifc/src/flowMeter.test.ts`. Backend: `test_flow_meter_is_an_inline_valve_type`.

## ADR-038 — Interface por tarefa: faixa de comandos, registro único de comandos e estado de interface fora do projeto

**Contexto.** Os comandos estavam espalhados: arquivo, catálogo, projeto e cinco exportações no cabeçalho; ferramentas e vistas numa barra lateral; exportações da planta e os controles do Infra numa barra sobre o desenho; opções da ferramenta flutuando sobre a vista. O seletor "Modelo 3D · Planta · BIM / IFC · Perfil" misturava vista, modo de consulta e atalho para diálogo.

**Decisão.**

- **Ambiente, tarefa e vista são três escolhas independentes.** Ambiente (MEP/Infra) é dado do projeto; tarefa é a aba da faixa de comandos; vista é o que a área central desenha. Trocar de aba não altera modelo, vista, ferramenta nem histórico.
- **Faixa de comandos por tarefa**, em vez de menus ou de barras laterais: os comandos principais ficam à vista com rótulo, a área de desenho ocupa toda a altura entre os painéis e a faixa pode ser recolhida.
- **Registro único de comandos** (`apps/web/src/commands/commands.ts`): rótulo, finalidade, atalho, disponibilidade com motivo e execução. Botões, atalhos e busca usam a mesma definição — antes, os atalhos tinham uma tabela própria e as regras de disponibilidade estavam em cada componente.
- **Modificar e Conectar não duplicam operações.** Os comandos que dependem de valores levam ao campo do painel de propriedades que já executa a operação do domínio.
- **Estado de interface em store própria** (`uiStore.ts`), com as preferências de layout no `localStorage`. Nada disso entra no projeto, no histórico ou no arquivo. Sem nova dependência: os painéis redimensionáveis são eventos de ponteiro e variáveis CSS.
- **Opções da ferramenta no painel direito**, em aba própria ("Ferramenta"), distinta de "Propriedades": parâmetros do próximo elemento e propriedades do que já existe não se confundem, e nada cobre o desenho.
- **Consulta BIM / IFC mantida como modo sobre o Modelo 3D** (`viewMode: 'bim'` na store do editor, como antes), agora acionada pela aba de tarefa. É a única aba que muda a vista; por isso a operação em andamento é suspensa ao entrar e retomada ao sair, em vez de descartada.
- **Diálogo de projeto dividido por finalidade**: configuração (Gerenciar) e resultados (Análise), no mesmo componente. Quantitativo em tela com as mesmas linhas do CSV.
- **Exportações**: DXF da planta gerado do modelo (independe da vista); SVG continua sendo o desenho da planta, que é aberta para gerar o arquivo.
- **Perfil longitudinal continua diálogo**, identificado como tal; só vira vista quando o conteúdo for adaptado.

**Consequências.** Os `data-testid` dos controles foram preservados; mudou o caminho até eles, e os testes E2E passaram a usar `tests/e2e/ui.ts` para abrir a aba, o menu ou o painel de cada controle. Entrar na consulta BIM / IFC ainda reenquadra a vista. A organização comporta novas disciplinas (arquitetura) acrescentando comandos ao registro e grupos à faixa.

**Verificação.** Vitest: `apps/web/src/commands/commands.test.ts`, `apps/web/src/state/uiStore.test.ts`. Playwright: `tests/e2e/layout.spec.ts` e toda a suíte existente pela nova navegação.

## ADR-039 — Deflexão na junta como dado da especificação, dentro do esquema v11

**Contexto.** Toda mudança de direção exigia joelho: o acoplamento entre portas só admitia 0,5° de tolerância geométrica. Em adutoras de junta elástica, curvas de raio longo e pequenos ajustes de traçado e de declividade são feitos defletindo as juntas, dentro do limite que o fabricante publica por diâmetro.

**Decisão.**

- **O limite é dado de catálogo e viaja na especificação** (`PipeSpec.jointDeflection`, rad, opcional), como já acontece com os diâmetros. Assim o `core` continua sem depender do catálogo e todas as operações — traçado, reconciliação, validação, fechamento — enxergam o mesmo limite sem parâmetro novo.
- **Regra única em `connectivity.ts`**: `jointDeflectionLimit` (menor dos dois lados; 0 com flange ou sem o dado) e `alignmentTolerance`. `arePortsAligned` e `checkPortCompatibility` passam a usá-las.
- **Sem valor, nada muda**: especificação sem o dado é junta rígida. Nenhum limite é presumido por material ou tipo de junta.
- **Trava do cursor**: perto do eixo o trecho continua reto (metade do limite, no máximo 1°); daí até o limite o ponto é livre; acima, vale o mais próximo entre o limite e os ângulos de joelho de catálogo.
- **Sem incremento de versão**: o campo é opcional e o esquema v11 ainda não foi publicado; documentos v11 existentes continuam válidos (mesmo critério do ADR-037).

**Consequências.** Projetos salvos antes desta mudança não trazem o limite nos tubos já criados: esses trechos seguem rígidos até a especificação ser reaplicada. A interface só oferece a deflexão ao partir da extremidade de um tubo; saindo de uma conexão o cursor continua preso ao eixo da porta, embora o núcleo aceite a deflexão também na bolsa da conexão. A curvatura a frio do próprio tubo fica fora: é outro mecanismo e pede um elemento de tubo curvo.

**Verificação.** Vitest: `packages/core/src/jointDeflection.test.ts`, `packages/catalog/src/jointDeflection.test.ts`, `apps/web/src/state/jointDeflection.test.ts`. Playwright: `tests/e2e/jointDeflection.spec.ts`.

## ADR-040 — Superfície do terreno: triangulação restrita no `core`, fontes de elevação fora do domínio, esquema v12 e leitor de GeoTIFF próprio

**Contexto.** O terreno era um TIN de até 4.000 pontos XYZ, limitado pela envoltória convexa, sem limite, linhas de quebra nem registro de procedência; a triangulação era quadrática e a consulta de cota percorria todos os triângulos. Projetos de redes precisam de superfícies por área (loteamento, faixa de adutora), a partir de DEM quando não há levantamento, e do levantamento quando ele existe.

**Decisão.**

- **Núcleo puro em `packages/core/src/terrain/`.** Triangulação de Delaunay com restrições escrita no projeto (inserção incremental com trocas de aresta, arestas obrigatórias pelo método de Sloan, classificação dentro/fora por paridade), construção da superfície, índice espacial para a consulta, curvas de nível, corte e a passagem do raster para pontos cotados. Sem dependência nova: o `core` continua dependendo só de `zod`.
- **Fontes de elevação fora do domínio.** `apps/web/src/terrain/elevationProviders.ts` é a única parte que conhece serviços; o domínio recebe um raster (`ElevationRaster`) e a procedência (`TerrainSource`). Entram no registro só fontes com endereço, codificação e condições conferidos na documentação, com a data. A fonte aberta (Terrain Tiles na AWS) não exige chave; a Mapbox usa a chave do próprio usuário, guardada só no navegador (regra "sem credenciais" do `AGENTS.md`).
- **Nada é inventado.** Vértices são os nós do raster ou os pontos do levantamento; lacunas do raster viram aberturas na superfície; resolução do raster, exatidão altimétrica e referência altimétrica são campos distintos, e os dois últimos ficam nulos quando a fonte não os declara. Níveis de ladrilho acima da resolução nominal do dado de origem são oferecidos com aviso e não são o padrão. Nenhuma conversão de datum vertical é aplicada.
- **Escala vertical real por padrão.** O exagero é opção de visualização, só do desenho do terreno, sempre indicado.
- **Esquema v12.** `terrain.boundary`, `terrain.breaklines` e `terrain.source` são obrigatórios: um terreno v11 precisa de migração de dados, por isso a versão foi incrementada (diferente dos ADR-035, 037 e 039, em que os campos eram opcionais). A migração não presume nada: limite nulo, sem linhas de quebra, procedência "Pontos XYZ" com datum, exatidão, resolução e data nulos.
- **Leitor de GeoTIFF próprio** (`apps/web/src/terrain/geotiff.ts`), em vez da biblioteca `geotiff.js`: o que um DEM de uma banda exige (TIFF clássico, faixas e blocos, Deflate pelo `DecompressionStream` do navegador, LZW, preditores) cabe em um módulo testável, e a regra do projeto pede justificativa para cada dependência. O custo é declarado: BigTIFF, JPEG/ZSTD/LERC e rasters girados são recusados com o motivo.
- **Processamento não bloqueante.** A leitura do GeoTIFF e a geração da superfície rodam em um Web Worker (`terrainWorker.ts`); os downloads são assíncronos, com andamento e cancelamento. O trabalho é uma função pura (`runTerrainJob`), a mesma nos testes e no worker.
- **Interface sem ferramenta nova na store do editor.** As operações do terreno na planta (área, furo, corte, consulta) são um modo de sessão (`terrainStore`) que recebe os cliques da Planta Infra com a ferramenta de seleção; os comandos entram no registro único. A área em edição, o corte e as opções de visualização não entram no projeto nem no histórico.

**Consequências.** A superfície é gravada no JSON do projeto, e por isso limitada a 25.000 vértices; áreas maiores pedem resolução mais grossa. Há uma superfície por projeto. As curvas de nível e o corte ainda não vão para a documentação (DXF/SVG). LandXML e a entidade IFC do terreno ficam para depois: `terrainExchange` entrega a estrutura, e o mapeamento IFC será conferido no esquema antes de ser escrito (regra 10). O caminho Mapbox não pôde ser exercitado com uma chave real.

**Verificação.** Vitest: `packages/core/src/terrain/terrain.test.ts` (círculo vazio, contorno côncavo com furo, linhas de quebra, plano inclinado, curvas, corte, raster com lacunas, georreferência, migração) e `apps/web/src/terrain/terrain.web.test.ts` (codificações, mosaico de ladrilhos posicionado pela georreferência, falhas do serviço, GeoTIFF escrito pela libtiff — `tests/tools/make_terrain_fixtures.py` —, malha 3D, operações na planta). Playwright: `tests/e2e/terrain.spec.ts` (área desenhada, DEM com serviço interceptado e falha tratada, levantamento com linha de quebra e furo, consulta, corte, GeoTIFF, 3D). Backend: migração v11 → v12 e validação do terreno.