# Roadmap

Legenda: ✅ concluído e testado · 🟡 parcial · ⬜ não iniciado

## Fase 0 — Fundação ✅ (CI pendente de primeira execução)

- ✅ Monorepo, TypeScript estrito, ESLint, Prettier, Vitest, Playwright.
- ✅ Frontend React + Vite + Three.js; backend FastAPI + Pydantic.
- 🟡 CI (GitHub Actions) configurado; executa quando houver pull request ou push para `develop`/`main`.

## Fase 1 — MVP funcional ✅

Viewport 3D, tubos por dois pontos, seleção, propriedades, edição de diâmetro e material, joelho, tê, redução e válvula, portas e conexões, salvar/abrir, desfazer/refazer, validação.

## Fase 2 — Conectividade avançada 🟡

- ✅ Catálogo dimensional de conexões por fabricante/norma, com fontes (`docs/CATALOGS.md`).
- ✅ Famílias editáveis por projeto, com reaplicação às peças existentes.
- ✅ Válvulas de gaveta com cunha de borracha EURO 21 a 25 (flanges PN e ANSI, bolsas PBA e ferro dúctil), com castelo retangular K × K1.
- ✅ Filtro Y de ferro fundido (Spirax Sarco CI, ASME 125) e flanges com a furação da norma na geometria.
- ✅ Macromedidor eletromagnético flangeado (Sanecom, DN 50 a 1000, flange PN 10) como tipo de peça em linha `flowMeter`, exportado como `IfcFlowMeter`.
- ✅ Flanges padronizados: tabela única PN 10/16/25/40 (Catálogo Geral, p. 246–249) usada por todas as peças flangeadas PN, com furação e ressalto na geometria; aba "Flanges e tubos flangeados" no Catálogo. Esquema v7.
- ✅ Tubos de ferro fundido dúctil com flanges (flange e flange, flange e ponta em qualquer extremidade, ponta e ponta), com comprimento livre e classe PN 10/16/25/40.
- ✅ Troca de diâmetro que altera só a peça e insere, ajusta ou remove reduções.
- ✅ Tê de redução; extremidades com bolsa, flange ou ponta lisa.
- ✅ Seleção múltipla, mover e copiar por deslocamento; sistemas com cor e visibilidade.
- ✅ Biblioteca de produtos com modelo 3D de catálogo: linha PBA Amanco Wavin completa (tubos classes 12/15/20, curvas, tês, cruzetas, redução, luvas, cap, adaptador DEFoFo, colar de tomada e anéis). Tê e redução PBA da rede usam a mesma geometria.
- ✅ Edição direta do traçado, na planta e no 3D: alças nas extremidades do tubo selecionado (arrastar estica ou encolhe ao longo do eixo; a peça ligada desliza junto e o tubo vizinho compensa), setas do teclado que deslizam tubos, conexões e válvulas ao longo da linha (passo da grade; Shift ×10, Ctrl ÷10) e menu do botão direito junto a uma extremidade livre com "Criar tubo".
- ✅ Peças na linha (válvula, tê, cruzeta, redução, medidor): cotas de cada extremidade até o próximo elemento, porta a porta, nas duas vistas, ligáveis e desligáveis ("Cotas na linha"); alça que desliza a peça entre os tubos (cota no passo da grade, um passo no histórico) e cota editável no painel, com o tubo do outro lado compensando.
- ✅ Cruzeta como elemento (esquema v14): quatro portas reais (`a`, `b`, `branch`, `branch2`), geometria (inclusive o perfil PBA), validação, quantitativo, EPANET, DXF e IFC (`IfcPipeFitting`/`JUNCTION`, quatro portas). Famílias com fonte: cruzeta flangeada AVK 712 PN 10 (ferro dúctil e DEFoFo, DN 80 a 600, iguais e de redução) e cruzetas PBA Amanco Wavin. Sem fonte identificada não há cruzeta (PVC soldável, ferro dúctil com bolsas, aço, PEAD): a operação é recusada com o motivo.
- ✅ Conversão tê ⇄ cruzeta preservando o elemento e as ligações (painel, menu de contexto e derivação automática), com prévia.
- ✅ Derivação sobre tubo de qualquer especificação com peça compatível: "Conexão da derivação: Automática | Tê | Cruzeta"; em coletor flangeado, tê flangeado e flange nas faces do corte (família de tubos com flanges, furação conferida); prolongamento do próprio ramal quando alinhado; ramal no lado oposto de um tê o converte em cruzeta; porta livre de cruzeta continua a rede.
- ✅ Alinhar e conectar (ferramenta, nas duas vistas): porta de referência real (posição, direção, cota), guias, alternativas (prolongamento, joelho, desvio, alinhar, alinhar e conectar, mover o equipamento só por escolha), peças e elementos afetados; flange do destino resolvido por família de tubos com flanges. Prévia em fantasmas na planta e no 3D.
- 🟡 Verificação do tipo de extremidade: aplicada nas novas montagens (flange só com flange de mesma furação, bolsa só com ponta); `connectPorts` e a validação geral ainda não a fazem.
- ⬜ Inserção na rede dos demais produtos da biblioteca sem tipo de elemento: curvas ponta e bolsa (famílias com extremidades mistas), cap, luvas, adaptador e colar de tomada — exige alteração do esquema. Cruzeta de ferro dúctil com bolsas (Saint-Gobain, p. 269–270) pendente de conferir o significado das cotas.
- ⬜ Peças de transição entre especificações (adaptadores, tocos com flange, luvas de correr).
- ⬜ Verificação de compatibilidade do tipo de extremidade (flange × ponta, bolsa × bolsa).
- ✅ Captura de pontos consistente nas duas vistas: raio em pixels em qualquer zoom e projeção, portas de sistemas ocultos fora da captura, rótulo com tipo, elemento, porta e cota, Tab para portas sobrepostas também no 3D. Na planta, tubo em outra cota é só referência (o cruzamento não cria tê nem conexão).
- 🟡 Capturas de referência (extremidade, ponto médio, perpendicular, alinhamento) e planos de trabalho XY/XZ/YZ/pela porta com trava de eixo: núcleos puros testados (`apps/web/src/editor/referenceSnaps.ts`, `workPlane.ts`), ainda não ligados às vistas **da rede**. Na arquitetura as capturas já estão na planta de trabalho, por um motor próprio (`editor/planSnaps.ts`); levá-lo ao traçado de tubos fica pendente.
- 🟡 Seleção por janela: contenção no modelo 3D ✅; na planta, janela e cruzamento pelo sentido do arrasto ✅ (`plan/planSelection.ts`); cruzamento no 3D e filtros por categoria e sistema com núcleo testado (`crossingSelection.ts`), ainda não ligados às vistas.
- ✅ Opções de projeto: precisão da modelagem (passos de 5 cm e 1° no traçado, ao esticar e ao girar), ajustável e lembrada no navegador.
- ✅ Girar no fluxo do Revit: centro no meio da seleção, raio inicial e final, ângulo digitado, rede ligada junto, Copiar e barra de espaço (90°).
- ✅ Alinhar por pontos, como o ALIGN do AutoCAD (atalho N, botão direito ou busca de comandos), nas duas vistas: origem 1 → destino 1 e origem 2 → destino 2; o conjunto é levado e girado em planta (eixo vertical, sem escala), com a rede ligada junto, Copiar, "Aplicar só o 1º par" (desloca), prévia em fantasmas e linhas auxiliares numeradas. Operações `alignElements`/`copyAlignedElements`.
- ✅ Fechamento assistido entre duas extremidades livres (`closePorts`): tubo reto, um joelho no cruzamento dos eixos ou dois joelhos no desvio paralelo, só com peças da especificação e sem tolerância de encaixe; pelo painel de propriedades, com dois elementos selecionados. Recusa extremidades flangeadas, eixos reversos e ângulos sem joelho de catálogo. ⬜ Escolha das duas extremidades diretamente na vista; retorno em "U".
- ⬜ Catálogo de conexões de PEAD e curvas PBA; catálogos brasileiros de ferro dúctil e válvulas.

## Fase 3 — IFC 🟡

- ✅ Exportação IFC 4.3 (`IFC4X3_ADD2`) no navegador (`@hydrobim/ifc`).
- ✅ Estrutura espacial, portas, `IfcRelConnectsPorts`, sistemas, materiais, propriedades.
- ✅ Georreferência (`IfcProjectedCRS` + `IfcMapConversion`) somente quando informada.
- ✅ Verificação automática: IfcOpenShell abre o arquivo, `validate` sem erros, geometria tesselada.
- ✅ Camada BIM (esquema v9): `Ifc…Type` para todos os elementos (um por produto, compartilhado pelas ocorrências), conjuntos de propriedades e de quantidades padronizados (`Pset_*`/`Qto_*`) conferidos contra os modelos do IFC 4.3, conjuntos próprios `HydroBIM_*`, portas com `Pset_DistributionPortTypePipe` e materiais associados a ocorrências e tipos. O arquivo grava exatamente o modelo de informação mostrado no editor.
- ✅ **Percurso** na aba BIM / IFC: navegação em primeira pessoa (W A S D, E/Q para a altura da vista, mouse para olhar), caminhando sobre a superfície do terreno na cota dela, com céu, sol e sombras; o clique em um elemento mostra as propriedades IFC. Pendente: colisão com os elementos, posição guardada entre aberturas.
- ✅ Aba **BIM / IFC**: visualizador 3D, árvore por sistema › entidade › tipo › ocorrência (localizar, ocultar, isolar, filtrar por classe IFC), painel de propriedades IFC com origem de cada valor (geometria, cadastro, catálogo, usuário, não informado), edição de propriedades cadastrais por tipo e por ocorrência, pendências e conformidade.
- ✅ Validação IFC: requisitos normativos do esquema (entidades, tipos predefinidos, aplicabilidade e tipos de valor dos conjuntos, GlobalIds, conectividade das portas) separados dos requisitos do perfil do projeto; exportação do perfil em IDS 1.0.
- ✅ Classificação IFC de toda a biblioteca (famílias de conexões e válvulas, tubos com flanges, reservatórios e produtos PBA).
- ⬜ Testes em visualizadores e ferramentas de autoria de terceiros; conferência do IDS exportado com uma ferramenta externa (`ifctester`).
- ⬜ Sentido de escoamento nas portas; pesos (`GrossWeight`/`NetWeight`) quando os catálogos os trouxerem; `Pset_DistributionSystemCommon`.
- ⬜ Perfil de requisitos editável pelo usuário e importação de IDS de terceiros (hoje o perfil é o do registro de propriedades).
- ⬜ Elementos ainda sem modelagem na rede — medidores (`IfcFlowMeter`), sensores, atuadores, caixas de válvulas: só serão classificados quando existirem como elementos.
- ⬜ Sólidos paramétricos para conexões (hoje malhas trianguladas); compatibilidade IFC 4.
- ⬜ Importação IFC.

## Fase 4 — MEP avançado 🟡

- ✅ Níveis/pavimentos e plano de trabalho por nível.
- ✅ Bomba e reservatório (representações genéricas) e ventosa.
- ✅ Projeção ortográfica (planta e elevação em verdadeira grandeza); isométrica ortográfica verdadeira por quadrante, perspectiva como comando separado e enquadramento da seleção. Trocar entre planta e modelo 3D mantém a ferramenta, o trecho em andamento e o ponto de interesse.
- ✅ Quantitativo exportável em CSV.
- ✅ Reservatórios metálicos de catálogo: oito famílias TRAMEC (taça com e sem água na coluna, tubular alto, australiano, vertical apoiado, fundo cônico com pés, montado na obra e cilíndrico horizontal), 113 modelos comerciais tabulados, dimensões personalizadas, origem de cada parâmetro (catálogo × derivado × estimado × usuário), acessórios, bocais adicionais (extravasor, descarga) e exportação IFC com `IfcTankType` e conjuntos de propriedades (esquema v6). Seção **Catálogo** com a aba Reservatórios; famílias podem ser duplicadas como personalizadas do projeto, com tabela editável e reaplicação aos reservatórios inseridos (esquema v8).
- ⬜ Reservatórios: divisão interna de células e plataformas desenhadas, bocais verticais (descarga no vértice do cone, respiro), instalação enterrada do horizontal, pesos.
- ✅ Famílias de bombas (esquema v13, `docs/CATALOGS.md`): bomba anfíbia em linha HIGRA, com as quatro tabelas do dimensional (estágio único e múltiplos estágios, 60 e 50 Hz), cinco linhas de portes diferentes em cada uma e "Outro modelo", com as cotas preenchidas pelo usuário pelas letras do catálogo (A a J). Aba **Bombas** no Catálogo, com tabela e modelo 3D.
- ✅ Exemplo `examples/centro-reservacao` (MEP, `apps/web/src/demo/reservationDemo.ts`): poço profundo com bomba HIGRA na vertical, edutor e cavalete; reservatório apoiado e elevado TRAMEC; elevatória com duas bombas em paralelo; válvulas AVK, macromedidores SANECOM e conexões PAM flangeadas — só peças de catálogo.
- ⬜ Poço como elemento (perfuração, revestimento, filtros, laje de proteção, níveis estático e dinâmico) e bomba submersa de poço de pequeno diâmetro: hoje o exemplo traz só a instalação hidráulica do poço.
- ⬜ Demais linhas das tabelas HIGRA e outros fabricantes de bombas; curvas de desempenho; flanges avulsos como elemento da rede (hoje só no catálogo e nas extremidades das peças), coletores.
- ✅ Planta baixa em traço técnico (projeção do modelo com linhas ocultas removidas), com cotas lineares (alinhada, horizontal, vertical), textos, chamadas e etiquetas de elementos; escala do desenho; exportação em SVG no tamanho físico da escala. Opções de visualização: linhas finas, ligadas por padrão (traço de 1 px na tela em qualquer zoom, para que a espessura de plotagem não encubra as peças; a exportação mantém as espessuras de papel), e tema colorido — cada parte com a cor do modelo 3D (mesma biblioteca de materiais: material, papel da parte e cor do sistema) — ou preto e branco (o tema acompanha a exportação em SVG). O corte entre trechos visíveis e ocultos das arestas é localizado por bisseção.
- ✅ Modelagem pela planta baixa: tubos, joelho, tê, redução, válvula, bomba, reservatório e medição, com prévia do trecho (comprimento, deflexão, desnível). Elevação do eixo acima do nível, herdada da extremidade de partida; alterá-la durante o traçado cria a prumada. Mudanças de direção travadas nos ângulos dos joelhos de catálogo da especificação (também no 3D e na entrada por coordenadas; pode ser destravado).
- ✅ Na planta, Tab alterna entre extremidades sobrepostas sob o cursor; a trava de ângulos também vale ao editar o ângulo de um joelho existente.
- ✅ Somente peças de catálogo (padrão): o editor recusa criar joelho, tê, redução ou válvula de dimensões genéricas e alterar dimensões de peças de catálogo; sem joelho de catálogo, o traçado só prolonga em linha reta. Pode ser desligado nas opções da ferramenta.
- ⬜ Curvas PBA (ponta e bolsa) e conexões de PEAD como famílias, para que essas especificações possam mudar de direção com a política de catálogo ligada.
- ✅ Trecho por valores no painel da ferramenta: comprimento real, projeção horizontal, ângulo (dos joelhos de catálogo), ΔX/ΔY/ΔZ, cota final e declividade, com a prévia real da montagem (peças criadas, tubos ajustados ou a recusa do núcleo) antes de confirmar; subir e descer até o pavimento vizinho mantendo a altura do eixo sobre o piso. A prévia roda a mesma operação da confirmação.
- ✅ Mudança de direção sem peça, até o limite do fabricante: deflexão da junta elástica (ferro dúctil JGS 5°/4°/3° conforme o DN) e curvatura a frio do tubo (PVC DEFoFo e PBA por barra de 6 m; PEAD com raio de 30 × DE), no traçado com o cursor, por valores e no fechamento entre extremidades; acima do limite, joelho. PVC soldável e aço soldado não mudam de direção sem peça. Valores confirmados pelo responsável; fontes em `docs/CATALOGS.md`.
- ✅ Declividade: aceita a partir de ponto livre, de mudança de direção fora do plano e, em prolongamento de um tubo, até o desvio que a junta ou a curvatura do tubo admitem. Em PVC soldável e aço soldado o prolongamento com declividade segue recusado acima de 0,5°.
- ✅ Tubulação contínua: tubos ligados direto uns aos outros, sem conexão, tê nem acessório entre eles, são selecionados e apresentados como um tubo só (comprimento total, trechos, mudanças de direção); um trecho isolado é aberto pela lista do painel. É derivada do grafo de conexões — cada trecho continua sendo um elemento. Na exportação EPANET vira um trecho único, com as mudanças de direção em `[VERTICES]` (sem nó a cada flexão).
- ⬜ Elemento de tubo curvo: hoje a curvatura a frio é uma poligonal (cordas), limitada a 22,5° por vértice.
- 🟡 Prévia das peças desenhada nas vistas: fantasmas e símbolo da peça na planta e no 3D para o traçado com tê/cruzeta, "Alinhar e conectar" e a conversão tê ⇄ cruzeta; o trecho por valores continua com prévia textual. ⬜ Inserção em linha em tubo vertical pela planta.
- ✅ Exportação DXF: planta baixa em R2000, em metros e nas coordenadas do projeto, com camadas `REDE_*` por categoria (cor, tipo e espessura de linha), cotas como `DIMENSION`, conexões/registros/equipamentos como blocos (`INSERT`), contornos em `LWPOLYLINE`, textos, chamadas e etiquetas; modelo 3D em malhas poliface (R12). Conferido com `ezdxf`; ainda não aberto em AutoCAD/Civil 3D.
- ⬜ Planta: balões de item ligados ao quantitativo, cotas de nível, angulares e em cadeia, setas de fluxo, hachuras, seta de norte, linhas de centro e simbologia convencional.
- ✅ Vistas de projeto (esquema v15, `docs/INTERFACE.md`): navegador de vistas (criar, nomear, duplicar, organizar, abrir e excluir); plantas por nível com faixa de corte e profundidade; cortes definidos em planta por linha, direção e profundidade, com marcador selecionável que abre a vista; elevações; vistas 3D com câmera salva (perspectiva ou isométrica) e caixa de corte ajustável por alças e por valores X, Y e Z; região de recorte nas vistas 2D; escala, orientação, visibilidade, estilo gráfico e enquadramento por vista. Todas mostram o mesmo modelo — cortes e caixas só controlam a visualização.
- ✅ Detalhes 2D nas vistas: linhas, polilinhas, retângulos, círculos, textos e cotas, com captura de pontos e entrada numérica; selecionar, editar por alças e valores, mover, copiar e excluir. Pertencem à vista e não viram tubulação nem geometria. Gravados no projeto, com desfazer/refazer.
- ⬜ Vistas de projeto: modelagem (tubos e peças) diretamente nas vistas salvas; tampa e hachura da seção cortada; marcador de corte editável por alças; corte em degraus e elevação de direção livre; janela de seleção e menu de contexto nas vistas salvas; vistas no DXF.
- ⬜ Detalhes: arcos, hachuras, tipos de linha e camadas; cotas associadas aos elementos; cópia de detalhes entre vistas.
- ⬜ Pranchas com carimbo e exportação em PDF; no DXF, cotas de nível em `REDE_COTAS_ALTIMETRICAS` (hoje vazia), cotas associativas aos objetos e sólidos 3D.
- ⬜ Persistência em servidor (API + PostgreSQL).

- ✅ Interface por tarefa (ver `docs/INTERFACE.md`): cabeçalho com menu Arquivo e seletor de ambiente; faixa de comandos com as abas Modelagem, Documentação, Visualizar, Análise, BIM / IFC, Exportação e Gerenciar; navegador do projeto (vistas, níveis, sistemas com visibilidade, elementos com busca); abas de vista fixas com controles de navegação; painel direito com as opções da ferramenta separadas das propriedades; barra de status com a instrução da operação. Painéis recolhíveis e redimensionáveis, com preferências guardadas fora do projeto. Registro único de comandos (botões, atalhos, busca com Ctrl+K), com o motivo de cada indisponibilidade. Exportações centralizadas, com conteúdo e requisitos de cada saída; quantitativo em tela.
- ✅ Bancada de modelagem (ver `docs/INTERFACE.md`): cabeçalho e barra de status em azul-marinho sobre painéis claros; barra de ferramentas em uma linha, com símbolos nomeados, grupos (Criar, Modificar, Conectar, Medir, Biblioteca) e botões com seta para Conexões e Equipamentos; símbolos técnicos próprios no padrão da biblioteca de ícones; navegador em árvore (pavimentos, sistemas com tubos, conexões e válvulas, equipamentos, reservatórios, referências, vistas); planta e modelo 3D lado a lado, com vista ativa, divisor ajustável e maximizar; barra de referências junto do desenho; painel de propriedades com símbolo e nome do elemento e seções em faixa. Seleção em ciano nas duas vistas.
- ⬜ Bancada: visibilidade por elemento e por categoria na árvore (o modelo só guarda a do sistema); ligar às vistas da rede as capturas de ponto médio, perpendicular e alinhamento (na arquitetura já têm liga/desliga na barra de referências).
- ⬜ Interface: inspetor de anotações no painel direito; escolha do sistema do próximo elemento na ferramenta; consulta BIM / IFC também sobre a planta; atalhos e faixa personalizáveis.

## Fase 5 — Infraestrutura 🟡

- ✅ Georreferência informada pelo usuário, validada: registro de sistemas projetados (SIRGAS 2000 / UTM e WGS 84 / UTM), transformações local ⇄ projetado ⇄ geográfico conferidas com o PROJ, estado pendente/sem transformação/inválida/pronta, referência altimétrica (esquema v11). Ver `docs/INFRA.md`.
- ✅ Ambiente Infra com configuração própria (`project.infra`): **Planta Infra** com escala de documentação de 1:200 a 1:10.000, camadas (rede, equipamentos, terreno, referências, anotações), rótulos de nós e trechos sem sobreposição, malha de coordenadas, norte da quadrícula, barra de escala, coordenadas do cursor (locais, E/N, latitude/longitude) e navegação por coordenadas. Independente da planta do MEP.
- ✅ Mapa georreferenciado ao fundo da Planta Infra, em dois temas sem chave — satélite (Sentinel-2 cloudless 2016, EOX, CC BY 4.0) e ruas (OpenStreetMap): visibilidade, opacidade, atribuição, carregamento só da região visível e tolerância a falhas do serviço.
- ✅ Fonte de mapa própria (alta resolução): endereço de ladrilhos do serviço do usuário, guardado só no navegador; aviso quando a ampliação passa da resolução da fonte.
- ✅ Georreferência pelo mapa: o estado pendente abre um mapa navegável; o clique define a origem do modelo no fuso escolhido (SIRGAS 2000 / UTM 21S por padrão, demais fusos brasileiros como opção) e a planta abre nesse ponto para modelar sobre o mapa.
- ✅ Vistas gerais: eixos e símbolos fora de escala quando a geometria real não é legível, com recorte pela janela.
- ✅ Importação de terreno por pontos XYZ, triangulado (TIN), até 25.000 pontos.
- ✅ Superfície do terreno por área (esquema v12, `docs/INFRA.md`): contorno desenhado na Planta Infra ou importado de GeoJSON, com furos; DEM em ladrilhos (Terrain Tiles abertos na AWS; Mapbox Terrain-RGB com a chave do usuário), GeoTIFF e levantamento com pontos XYZ e linhas de quebra; triangulação restrita ao limite; procedência gravada (sistema de origem, referência altimétrica, resolução e exatidão — nulas quando a fonte não declara); geração em Web Worker com andamento, cancelamento, cache da sessão e tratamento de falhas.
- ✅ Terreno: curvas de nível configuráveis, cota e declividade sob o cursor e por ponto, corte longitudinal com exportação CSV; no 3D, cor por altitude ou declividade, triangulação opcional e escala vertical real 1:1 por padrão (exagero opcional e indicado).
- 🟡 Mapbox: implementado e testado com o serviço simulado; não exercitado com uma chave real. O conjunto Terrain-DEM v1 só é oferecido como identificador alternativo (a documentação o restringe aos SDKs da Mapbox).
- ✅ Perfil longitudinal com cota do terreno e recobrimento.
- ✅ Origem de renderização deslocada na planta e no 3D: redes modeladas em coordenadas UTM mantêm a precisão; o projeto e as exportações não são alterados.
- ⬜ Seleção por janela, por filtros (sistema, material, DN, categoria) e de conjuntos conectados na planta; índice espacial para captura.
- 🟡 Assentamento por recobrimento: na ferramenta Tubulação da Planta Infra, o eixo de cada ponto clicado fica o recobrimento definido abaixo do terreno (até a geratriz superior), com conferência do recobrimento real ao longo do trecho; transparência ajustável da superfície no 3D. Falta: entrada por valores e 3D, reassentar trechos existentes, pendências na validação.
- ⬜ Traçado por alinhamento (vértices, deflexões por junta).
- ⬜ Cadastro de nós e trechos; descargas, hidrantes, caixas.
- ✅ Superfície do terreno como elemento (esquema v17): selecionável, com propriedades no painel (nome, identificação, área, cotas, origem dos dados, referenciais); edição de pontos cotados (acrescentar, mover, excluir, trocar a cota), do limite e da triangulação; superfície original guardada para comparação e restauração.
- ✅ Terraplenagem (`docs/INFRA.md`): platôs paramétricos (perímetro, cota, taludes H:V de corte e de aterro) aplicados em sequência sobre o terreno natural, sem alterá-lo; terreno projetado refeito localmente com as linhas de talude e a linha de encontro como arestas; corte em vermelho e aterro em azul na planta e no 3D; volumes por sobreposição exata das duas malhas, conferidos com resultados analíticos; quadro por platô e total com empolamento, fator de conversão e aproveitamento informados pelo projetista (pendentes quando não informados).
- ✅ IFC do terreno e da terraplenagem: `IfcGeographicElement`/`TERRAIN`, `IfcEarthworksCut` (vazio no terreno) e `IfcEarthworksFill`, com quantidades padronizadas; validado com IfcOpenShell.
- 🟡 Terraplenagem, pendente: reentrâncias estreitas do perímetro (taludes de lados opostos que se encontram antes do terreno são recusados), taludes com bermas, platôs inclinados, edição do perímetro por arraste dos vértices, conjuntos do terreno na aba BIM / IFC e no IDS.
- ✅ Terreno natural e projetado em toda a modelagem: assentamento de rede e equipamentos na superfície escolhida (projetado por padrão), cotas e "Assentar" para as duas no painel de propriedades, perfil longitudinal da rede e corte do terreno com as duas linhas e os dois recobrimentos, rótulos TP/TN na Planta Infra, cursor com as duas cotas, percurso sobre a superfície à mostra e DXF do modelo 3D com o terreno natural, o projetado e os sólidos de corte e aterro.
- ✅ Arquitetura sobre o terreno: parede, laje, piso e ambiente assentados no terreno natural ou no projetado ao criar ou pelo painel (base horizontal, um ponto de referência, sem vínculo com a superfície) e elevações absolutas da base e do topo de cada elemento no painel de propriedades.
- ⬜ Terreno: LandXML (importação e exportação), curvas de nível e corte na documentação (DXF/SVG), mais de uma superfície por projeto, BigTIFF e rasters lidos por janela.
- ⬜ Perfil longitudinal como vista sincronizada com a planta e o 3D (hoje no diálogo de análises, por Análise › Perfil longitudinal ou pelo botão Perfil… junto das abas de vista).
- ✅ Mapa de ruas ou de satélite estendido sobre a superfície do terreno no modelo 3D, acompanhando o relevo, com atribuição.
- ⬜ Ortofoto do usuário como fundo; imagem na exportação quando a licença permitir; mapa no 3D sem superfície de terreno; prancha com carimbo, legenda e norte; fator de escala combinado.
- ⬜ Instanciamento e níveis de detalhe no modelo 3D para milhares de elementos.

## Fase 6 — Engenharia e integrações 🟡

- ✅ Exportação da rede para o EPANET (INP).
- ✅ Detecção de interferências entre tubos.
- ⬜ Demandas, padrões e perdas localizadas no EPANET; importação de resultados.
- ⬜ Interferências envolvendo conexões e equipamentos; relatórios técnicos.
- ⬜ Federação com outros modelos BIM.

## Arquitetura 🟡

Ver `docs/ARQUITETURA.md` (requisitos adotados do Caderno BIM de SC v3.0, vigência das normas, limites) e `docs/INTERFACE.md`.

- ✅ Modelagem de precisão na planta de trabalho (ver `docs/INTERFACE.md`, "Capturas e edição na planta da arquitetura"): capturas em extremidade, ponto médio, interseção, pé da perpendicular, direção paralela ou perpendicular ao trecho anterior e à aresta de referência (em qualquer orientação), ortogonal aos eixos, alinhamento e ponto sobre a aresta; guias, realce, símbolo de ângulo reto e rótulo; tolerância em pixels; prioridade determinística e Tab; liga/desliga por captura; cotas temporárias de comprimento e ângulo; entrada numérica exata (comprimento, polar, relativa e absoluta); filtro pelo nível ativo.
- ✅ Edição na vista: alças nas extremidades de parede (portas e janelas hospedadas ficam no lugar; recusa por inteiro se deixarem de caber) e nos cantos de telhado; mover, copiar, girar e espelhar por pontos de referência com prévia do resultado; modo "Editar contorno" de lajes, pisos, ambientes e telhados, com Concluir e Cancelar. Um passo no histórico por ação confirmada; cancelar não altera o modelo.
- ✅ Telhados (esquema v18, `docs/ARQUITETURA.md`): uma e duas águas sobre contorno retangular, com tipo (tipologia e camadas), nível e deslocamento, lado do beiral, inclinação (% e graus), beiral e contorno editável; famílias genéricas no catálogo; planta, modelo 3D, vistas salvas (cortes e elevações pela malha), navegador, propriedades, visibilidade, mover/copiar/girar/espelhar, quantitativo (área inclinada, projeção horizontal e volume) e IFC (`IfcRoof`/`IfcRoofType`, `Pset_RoofCommon`, `Qto_RoofBaseQuantities`), conferido com o IfcOpenShell.
- ✅ Domínio (esquema v16): `project.architecture` com tipos e ocorrências, fora da rede hidráulica (sem DN, especificação de tubo ou portas). Paredes em camadas com encontros em L e T derivados; lajes e revestimentos de piso com aberturas; portas e janelas hospedadas, com vão real; ambientes. Operações tudo-ou-nada, com mover, copiar, girar e espelhar; migração v15 → v16 e espelho no backend.
- ✅ Catálogo de famílias genéricas parametrizáveis (paredes, pisos, portas, janelas), identificadas como genéricas; família › tipo › ocorrência; duplicar e editar tipos com as ocorrências afetadas; produto comercial só com fonte.
- ✅ Ambiente Arquitetura no editor: ferramentas na planta de trabalho, modelo 3D, navegador por pavimento e categoria, painel de propriedades com os grupos IFC e a natureza de cada valor, catálogo com prévia 2D/3D e quantitativo com CSV.
- ✅ Vistas salvas: arquitetura cortada (traço forte e hachura do tipo) e projetada, plano de corte próprio nas plantas, folha e arco das portas, ambientes com rótulo, visibilidade por categoria, camadas do Apêndice I no SVG.
- ✅ IFC 4.3: `IfcWall`, `IfcSlab`, `IfcCovering`, `IfcDoor`, `IfcWindow`, `IfcSpace` e os tipos, conjuntos padronizados lidos do esquema (pendentes por padrão), quantidades brutas e líquidas, camadas de material, `IfcOpeningElement` com `IfcRelVoidsElement`/`IfcRelFillsElement`; conferido com o IfcOpenShell.
- ✅ Exemplo `examples/edificacao-simples` (edificação com portas, janelas, piso com abertura e instalação hidráulica).
- 🟡 Camadas do Apêndice I: sem a camada `Cotas` e sem grupo único por camada; `Piso` e `Ambientes` são nomes próprios. Conformidade dos símbolos com a ABNT NBR 6492:2021 não verificada.
- ⬜ Edição interativa, pendente: seleção por janela da arquitetura; ferramentas e capturas de arquitetura nas vistas salvas e no Modelo 3D; alças diretas em lajes, pisos e ambientes (hoje pelo "Editar contorno"); edição do contorno das aberturas de piso; arrastar uma extremidade levando as paredes vizinhas do encontro; arrastar portas e janelas ao longo da parede; cotas temporárias editáveis depois de criado o elemento.
- ⬜ Capturas, pendente: tangência e quadrantes; extensão de arestas além das pontas; cruzamento de uma direção travada com um alinhamento; o mesmo motor no traçado da rede hidráulica e nos detalhes 2D das vistas.
- ⬜ Telhados, pendente: quatro águas (`HIP_ROOF`) e demais tipologias; águas com inclinações diferentes e cumeeira deslocada; beiral diferente por lado; contornos não retangulares (L, T) com rincões e espigões; aberturas (claraboias) e águas-furtadas; calhas, rufos e condutores; estrutura peça a peça (tesouras, terças, caibros, ripas); paredes estendidas até o telhado e empenas fechadas; telhado vinculado às paredes de apoio; telhado por contorno das paredes selecionadas.
- ⬜ Arquitetura no percurso e na árvore da consulta BIM / IFC; DXF com a arquitetura; importação IFC.
- ⬜ `IfcSpaceType`, `IfcZone`, limites de espaço e áreas líquidas de ambientes; detecção do ambiente pelas paredes.
- ⬜ Camadas da parede desenhadas e cortadas uma a uma; junção em X; paredes curvas ou inclinadas.
- ⬜ Escadas, rampas, forros, estrutura e mobiliário.

## Realidade virtual (WebXR) 🟡

Ver `docs/WEBXR.md` (arquitetura, controles, publicação, roteiro de teste e limites).

- ✅ Fundação: detecção de compatibilidade, comando **Entrar em VR** (Visualizar), sessão `immersive-vr` no renderizador da vista, `local-floor` com alternativa de piso estimado, saída e retorno ao editor, mensagens para navegador incompatível.
- ✅ Modelo: a rede do projeto em lotes (poucas chamadas de desenho, identidade por elemento), terreno e arquitetura com os componentes do Modelo 3D; Z para cima → Y para cima sem espelhamento, escala 1:1 e origem local para coordenadas UTM.
- ✅ Navegação: teletransporte por arco só em terreno, lajes e pisos (ou piso virtual por nível), com recusa de ponto sem piso, talude íngreme e obstáculo; giro de 30°; ponto inicial e recentrar.
- ✅ Inspeção: seleção com o raio do controle, painel de propriedades lido do elemento, menu com visibilidade por categoria, terreno, informações do projeto e saída.
- 🟡 Verificação: testes unitários e no navegador com dispositivo WebXR simulado. **⬜ Validação no Meta Quest 2 (roteiro em `docs/WEBXR.md`)**: sessão no navegador do headset, escala, conforto, legibilidade, controles reais e taxa de quadros.
- ⬜ Níveis de detalhe e simplificação visual; terreno por região visível; medição e leitura de cota; pontos de visita salvos; colisão; propriedades IFC completas; realidade mista (passthrough).

## Próxima etapa recomendada

1. Conferir as famílias com os catálogos vigentes dos fornecedores do projeto e completar o que ficou genérico (PEAD, curvas PBA, ferro dúctil e válvulas de fabricantes brasileiros).
2. Peças de transição e verificação do tipo de extremidade, para que flange e ponta não se conectem sem a peça adequada.
3. Abrir o IFC exportado em visualizadores de terceiros e ajustar o que for necessário; conferir o IDS com o `ifctester`.
4. Completar na aba BIM / IFC os dados que o catálogo não traz (pressões de serviço, acionamento das válvulas, dados das bombas) e, havendo fonte, levá-los às famílias do catálogo.
