# Interface do editor

Organização da tela, distribuição dos comandos e regras de comportamento. A interface não contém regras de modelagem: lê o projeto e chama operações do domínio por meio da store.

## Três conceitos separados

| Conceito | Valores | Onde se escolhe | O que muda |
| --- | --- | --- | --- |
| **Ambiente** | MEP, Infra | Seletor "Ambiente", no cabeçalho | A disciplina do projeto (especificação e grade padrão, planta própria). É uma alteração do projeto, com desfazer. |
| **Tarefa** | Modelagem, Documentação, Visualizar, Análise, BIM / IFC, Exportação, Gerenciar | Abas da faixa de comandos | Só os comandos à mostra. |
| **Vista** | Planta MEP ou Planta Infra, Modelo 3D | Cabeçalho de cada vista (e navegador do projeto) | O que é desenhado. Lado a lado, as duas ficam à mostra e a vista ativa é a que o cursor aponta. |

Trocar de aba de tarefa não altera o ambiente, o modelo, a vista nem a operação em andamento, não marca o projeto como alterado e não entra no histórico. Trocar de vista mantém a ferramenta de modelagem, o trecho em andamento, a medição, a seleção e o ponto observado; as ferramentas de documentação só existem na planta e são encerradas ao ir para o modelo 3D.

**Exceção declarada — consulta BIM / IFC.** A aba BIM / IFC abre um modo de consulta e cadastro sobre o Modelo 3D, sem modelagem. Ao entrar, a ferramenta e o trecho em andamento ficam **suspensos**; ao sair (por outra aba de tarefa ou pela troca de vista) a vista anterior, a aba anterior e a operação suspensa são retomadas, desde que o ponto de partida ainda exista no modelo. Enquanto a consulta está aberta, ferramentas de criação e Excluir ficam indisponíveis — pelos botões, pelos atalhos e pela busca — com o motivo informado.

**Percurso (aba BIM / IFC).** "Percorrer" (BIM / IFC › Navegação) e a aba de vista **Percurso**, no cabeçalho da consulta, trocam a órbita do Modelo 3D por um observador em primeira pessoa (`walk/WalkView.tsx`; movimento e apoio em `walk/walkMotion.ts`, funções puras):

- **W / S** andam para a frente e para trás, **A / D** para a esquerda e a direita — sempre na horizontal, na direção do olhar. **E** sobe e **Q** desce a altura da vista (1,70 m ao abrir; de −30 m, para ver a rede enterrada, a 500 m). **Shift** corre; a roda do mouse muda a velocidade.
- Arrastar com o mouse (ou as setas) gira o olhar. **F** ou o botão "travar o mouse" prendem o cursor na vista: o olhar segue o mouse sem arrastar e o clique vale na mira; Esc solta.
- Com superfície de terreno à mostra, o observador **caminha sobre ela, na cota dela** (com exagero vertical, sobre a superfície como está desenhada; a leitura informa a cota real). Fora da superfície vale a última cota de apoio; sem terreno, o apoio é o plano de trabalho, com a grade de 1 m.
- Um **clique em um elemento** o seleciona: o painel à direita mostra as propriedades IFC, como na órbita. A árvore, ocultar/isolar e o filtro por classe valem igualmente.
- Céu, sol com sombras e bruma são apresentação: a geometria é a mesma do Modelo 3D. O ponto de partida fica diante da seleção (ou do modelo; sem elementos, no meio do terreno).
- É estado de interface (`uiStore.bimWalk`): não altera o projeto nem o histórico, e termina ao sair da consulta. No percurso, "Modelo 3D" volta à órbita sem encerrar a consulta, e as teclas do observador não acionam atalhos de comando (S, E, Q).

**Perfil longitudinal.** Ainda é um diálogo de análise, não uma vista: o botão "Perfil…" junto das abas de vista (ambiente Infra) e o comando de Análise abrem o mesmo diálogo. Só vira vista quando o conteúdo for adaptado (roadmap, Fase 5).

**Operações do terreno.** Área, furo, corte e consulta de cota não são ferramentas da store do editor: são um modo de sessão (`terrain/terrainStore.ts`) que recebe os cliques da Planta Infra enquanto a ferramenta é Selecionar. Escolher uma ferramenta de modelagem ou sair da planta encerra a operação. Enter conclui, Backspace desfaz o último ponto e Esc cancela. O painel "Superfície do terreno" e o perfil do corte são painéis sobre a planta; a superfície gerada vai para o projeto, com desfazer — a área em edição, o corte e as opções de visualização não entram no projeto nem no histórico.
## Regiões da tela

```
┌ HydroBIM │ Arquivo ▾ │ Projeto: nome │ salvo        Ambiente: [MEP|Infra] │ salvar desfazer refazer ┐  azul-marinho
├ Modelagem │ Documentação │ Visualizar │ Análise │ BIM / IFC │ Exportação │ Gerenciar │    buscar ⌃ ┤
│ ▭ Tubos  ⌐ Conexões ▾  ⋈ Válvulas  ◔ Equipamentos ▾ │ ➤ Selecionar  ✥ Mover … │ … │ ▥ Catálogo      │  uma linha
│       CRIAR                                          │       MODIFICAR          │   │   BIBLIOTECA    │
├────────────┬─────────────────────────────┬─────────────────────────────┬────────────────────────────┤
│ Projeto    │ Planta MEP   1:50    ⛶ ⤢    │ Modelo 3D  Isométrica … ⤢   │ Ferramenta │ Propriedades  │
│  buscar    │                             ║                             │  ▣ Tubo                    │
│  ▾ projeto │          planta             ║         modelo 3D           │    Tubo 2                  │
│   ▾ Pavim. │                             ║                             │  ▾ Identificação           │
│   ▾ Sistem.│                             ║                      XYZ    │  ▾ Especificação           │
│   ▸ Equip. ├─────────────────────────────╨─────────────────────────────┤  ▾ Geometria               │
│ Vistas     │ Referências  (●) Grade 0,10 m  ✓ Extremidades  ⓘ instrução │                            │
├────────────┴────────────────────────────────────────────────────────────┴────────────────────────────┤
│ ➤ ferramenta: estado │ ⌖ captura │ X Y Z │ cota de desenho │ unidades │ mensagem │ pendências        │  azul-marinho
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Região | Componente | Conteúdo |
| --- | --- | --- |
| Cabeçalho | `ui/TopBar.tsx` | Identidade, menu Arquivo, nome do projeto, estado de salvamento (etiqueta: "salvo" ou, em âmbar e com ponto cheio, "não salvo"), seletor de ambiente e acesso rápido (salvar, desfazer, refazer). |
| Abas de tarefa e barra de ferramentas | `ui/ToolBar.tsx` | Abas de tarefa (a ativa tem fundo azul-claro e linha inferior azul), **uma linha** de comandos com símbolo e nome, agrupados e legendados; botões com seta para comandos relacionados; busca de comandos; botão de recolher (ou duplo clique na aba). |
| Navegador do projeto | `ui/ProjectBrowser.tsx` (na consulta BIM: `bim/BimTree.tsx`) | Busca no topo e árvore: projeto › Pavimentos (plano de trabalho) · Sistemas › sistema › Tubos / Conexões / Válvulas · Equipamentos (bombas) · Reservatórios · Referências (terreno, georreferência). Visibilidade e seleção por sistema, à direita da linha. Vistas no pé. |
| Área de desenho | `ui/Workspace.tsx` + `plan/PlanView.tsx` e `viewport/Viewport.tsx` | Planta à esquerda e modelo 3D à direita (**lado a lado**, o padrão), com divisor ajustável, ou uma vista por vez. Cada vista tem o seu cabeçalho: título, enquadrar, orientação (no 3D) e maximizar. Ver "Vistas lado a lado". |
| Barra de referências | `ui/ReferenceBar.tsx` | Junto do desenho: grade de captura (liga/desliga e passo), capturas sempre ativas (extremidades, ponto sobre o tubo), capturas previstas identificadas como tal, restrição de catálogo e a instrução da operação em andamento. |
| Painel direito | `App.tsx` (`RightPanel`), `ui/ToolOptions.tsx`, `ui/PropertiesPanel.tsx`, `bim/IfcPanel.tsx` | Aba **Ferramenta**: parâmetros do próximo elemento. Aba **Propriedades**: símbolo do tipo e nome do elemento, seções recolhíveis com cabeçalho em faixa, campos em duas colunas com a unidade à vista. Campo editável tem caixa branca; informação somente para leitura é texto simples; campo bloqueado tem contorno tracejado e o motivo na dica. |
| Barra de status | `ui/StatusBar.tsx` | Ferramenta ativa e o que ela aguarda, captura de pontos, coordenadas, cota de desenho, unidades, mensagens e pendências. |
| Molduras dos painéis | `ui/SidePanel.tsx` | Recolher para uma régua e redimensionar pela borda (arrastar ou setas). |

Os painéis laterais e a barra de ferramentas são recolhíveis; as larguras são ajustáveis (navegador 180–420 px, propriedades 280–560 px, divisão das vistas de 25 % a 75 %). **Restaurar layout** (Visualizar › Vistas e painéis e Gerenciar › Preferências) volta ao padrão.

### Vistas lado a lado

- **Lado a lado** (comando `view.split`, em Visualizar › Vistas e painéis e no cabeçalho da vista única) alterna entre as duas disposições. É preferência de interface: fica no navegador, não no projeto.
- As duas vistas mostram o **mesmo projeto e a mesma seleção**; cada uma guarda a própria navegação. Enquadrar vale para as duas e, havendo seleção, enquadra os elementos selecionados (sem seleção, o projeto inteiro).
- A **vista ativa** é a que o cursor aponta (linha azul no topo do cabeçalho; `viewMode` na store): recebe as setas do teclado e define a instrução mostrada. Ferramenta, trecho em andamento, medição e seleção atravessam de uma vista para a outra. O que só existe na planta — anotações, operações do terreno, escolha da origem no mapa — não é encerrado por passar o cursor sobre o modelo 3D, só por um clique nele.
- **Maximizar** (botão no cabeçalho de cada vista) faz a vista ocupar a área; a outra continua montada e conserva a câmera. Com uma vista maximizada o cabeçalho traz as abas de vista, e escolher a outra troca a que está maximizada.
- Os comandos de câmera (topo, elevação, perspectiva, isométrica, ortográfica) ficam no cabeçalho do modelo 3D e continuam disponíveis com a planta ativa; só ficam indisponíveis quando o modelo 3D está fora da tela.
- A consulta BIM / IFC usa só o modelo 3D, qualquer que seja a disposição.

### Peças na linha: cotas e alça

- Com uma válvula, um tê, uma cruzeta ou outra peça (não tubo) selecionada, as duas vistas mostram, de cada extremidade conectada, a **cota até o próximo elemento**: o comprimento de tubo, de porta a porta (fundo da bolsa ou face do flange), até a conexão, o acessório ou o equipamento seguinte, ou até a extremidade livre da tubulação. A cota fica acima do trecho horizontal (no 3D) ou de um lado fixo da linha (na planta). Em percurso com mudança de direção sem peça, mostra o comprimento pelo percurso, sem edição.
- **Cotas na linha** (comando `view.inlineClearances`, em Visualizar › Vistas e painéis, e a caixa "Mostrar as cotas nas vistas" da seção **Posição na linha** do painel) liga e desliga as cotas. É estado de interface (`uiStore`), não do projeto.
- A peça com passagem reta tem uma **alça em losango** no centro: arrastá-la desliza a peça entre os tubos, com prévia ao vivo, a cota no passo da grade e um único passo no histórico; Esc cancela. Na seção **Posição na linha**, cada cota em trecho reto é editável: digitar o valor reposiciona a peça e o tubo do outro lado compensa (`setInlineClearance`).

### Aparência

Cabeçalho e barra de status em azul-marinho; painéis brancos sobre cinza muito claro; azul-claro para a ferramenta, a aba e o item selecionados; ciano para os elementos selecionados no desenho (planta e 3D). As cores ficam em variáveis no início de `styles/app.css`; a aparência da bancada, em `styles/workbench.css`. Todo estado tem um sinal além da cor: o comando ativo tem contorno, linha inferior e negrito; o item selecionado da árvore, barra à esquerda e negrito; o indisponível fica esmaecido e explica o motivo na dica; "não salvo" troca o símbolo.

### Ícones

- Biblioteca: `lucide-react`. Símbolos técnicos que ela não tem (tubo, joelho, tê, redução, válvula, bomba, reservatório) ficam em `ui/EngineeringIcons.tsx`, desenhados no mesmo padrão: quadro de 24, traço arredondado de espessura única (1,6, aplicada a todos os ícones em `workbench.css`), sem preenchimento.
- Tamanhos: 20 px nos comandos da barra de ferramentas, 18 px nos botões só com ícone, 16–17 px na árvore e nos controles menores. A área clicável é sempre maior que o desenho (32 px de altura na barra, 24–27 px nos cabeçalhos de vista e na árvore).
- Comandos principais têm nome ao lado do símbolo. Comandos secundários (Comprimento, Girar, Excluir, Conectar, Medir) mostram só o símbolo abaixo de 1700 px de largura; o nome continua na dica e no leitor de tela.
- A dica de todo comando traz nome, atalho, finalidade e, se for o caso, por que está indisponível.

## Distribuição dos comandos

| Onde | Grupos e comandos |
| --- | --- |
| **Menu Arquivo** | Novo projeto · Abrir projeto (salvos no navegador, arquivo, demonstração) · recentes · Salvar no navegador · Baixar arquivo `.hydrobim.json`. O menu explica a diferença: salvar guarda só neste navegador; baixar gera um arquivo do usuário. |
| **Modelagem** | Criar: Tubos, Conexões ▾ (Joelho, Tê, Redução), Válvulas, Equipamentos ▾ (Bomba, Reservatório) · Modificar: Selecionar, Mover, Copiar, Elevação, Comprimento, Girar, Excluir (Girar 90° — Espaço — e Alinhar por pontos — N ou botão direito — ficam no teclado, no menu e na busca: a faixa a 1920 px não comporta mais botões numa linha) · Conectar: Alinhar e conectar (A), Tubo da extremidade, Ligar extremidades (Converter tê ⇄ cruzeta e Desconectar ficam no painel de propriedades, no menu do botão direito e na busca; a faixa a 1920 px não comporta mais botões numa linha) · Medir · Biblioteca: Catálogo · Terreno (só no Infra): Superfície, Área do terreno, Corte do terreno, Consultar cota |
| **Documentação** | Anotar na planta: Cota, Texto, Chamada, Etiqueta · Escala e cotas: escala de documentação do ambiente, tipo de cota · Previstos (desabilitados, com a fase): Pranchas, Cotas de nível |
| **Visualizar** | Câmera: Perspectiva, Isométrica, Ortográfica, Topo, Elevação · Enquadrar: Projeto, Seleção · Aparência da planta: tema, linhas finas · Mapa e camadas e Localização (só no Infra): fundo, imagem, opacidade, camadas, rótulos, fonte própria, ir para, georreferência · Terreno: cor, curvas de nível e intervalo, triangulação, escala vertical (1:1 por padrão) · Vistas e painéis: Lado a lado, Navegador, Propriedades, Restaurar layout |
| **Análise** | Verificação: Pendências, Interferências · Quantitativos · Perfil e recobrimento · Medição · Terreno (só no Infra): Corte do terreno, Consultar cota |
| **BIM / IFC** | Modelo de informação (esquema, contagens, conformidade) · Navegação: Percorrer (percurso em primeira pessoa) · Visibilidade: Isolar e Ocultar seleção · Classificação da biblioteca · Entrega: IFC, IDS |
| **Exportação** | Modelo: IFC 4.3, DXF do modelo 3D · Planta: DXF e SVG · Dados: CSV, INP, IDS · Conteúdo e requisitos de cada saída |
| **Gerenciar** | Projeto: Níveis, Sistemas · Famílias e catálogo · Local: Georreferência, Terreno · Preferências da interface |

**Alinhar e conectar** é uma ferramenta: clique a extremidade livre do trecho e, depois, a porta de referência (bocal de equipamento ou porta de outra peça). O painel da ferramenta mostra as duas portas com a cota, as guias medidas pela porta real e as alternativas (das mais simples às mais invasivas), cada uma com as peças inseridas e os elementos existentes afetados; a confirmação grava exatamente a alternativa escolhida, em um passo do histórico. "Alinhar" só posiciona o trecho; "Conectar" completa a montagem e registra a ligação; o equipamento fica fixo, salvo a alternativa explícita "Mover o equipamento". Na ferramenta **Tubulação**, "Conexão da derivação: Automática | Tê | Cruzeta" e as famílias de tê e de cruzeta ficam nas opções; um tê ou cruzeta existente pode ser início ou fim do ramal. **Converter tê ⇄ cruzeta** fica no painel de propriedades (seção "Tê ⇄ cruzeta") e no menu do botão direito, sempre com prévia antes de confirmar.

**Mover** (Modificar › Mover ou botão direito sobre um elemento › Mover) é interativo nas duas vistas: indique o ponto-base (uma porta ou um ponto) e, depois, o destino; a prévia mostra o resultado como fantasma antes do clique, calculada pela mesma operação de domínio (`translateElements`) que a confirmação grava em um passo do histórico. Sobre o plano, a grade ou na planta o deslocamento é horizontal (a cota só muda capturando uma porta ou com Shift no 3D); as coordenadas digitadas valem como informadas. Os tubos ligados se ajustam quando o deslocamento segue o eixo deles; caso contrário o destino é recusado com o motivo e o mover continua, e a opção "Levar a rede ligada" desloca rigidamente o conjunto conectado. Esc volta ao ponto-base; o segundo Esc encerra. "Mover" não é ferramenta da faixa: só começa com elementos a deslocar. O deslocamento numérico (ΔX, ΔY, ΔZ) continua no painel de propriedades. O menu do botão direito abre sobre qualquer elemento (no corpo do tubo, sem "Criar tubo", que exige uma extremidade livre).

**Girar** (Modificar › Girar, atalho G, ou botão direito › Girar) segue o fluxo do Revit, nas duas vistas, em torno de um eixo vertical: o centro de giro já começa no meio da seleção ("Escolher outro centro" ou "Origem do elemento" o trocam; um ponto ou porta clicados viram o centro); o primeiro clique indica o raio inicial e o segundo o raio final — o giro é o ângulo entre os dois, de 15° em 15°, positivo no sentido anti-horário visto de cima — ou digite o ângulo (atalhos ±90°, 180°, ±45°) e confirme. Com "Girar a rede ligada" (padrão) os tubos, conexões e acessórios ligados giram junto como um conjunto rígido (`rotateElements` sobre o conjunto conectado): comprimentos, ligações, identificadores e cotas se mantêm. Sem essa opção, um giro que rompa ligação com o restante da rede é recusado com o motivo. "Copiar" gira uma cópia (`copyRotatedElements`) e mantém os originais; as cópias ficam selecionadas. A prévia é o mesmo cálculo da confirmação; um passo no histórico; Esc volta ao raio inicial e o segundo Esc encerra. **Girar 90°** (barra de espaço, como no Revit) gira a seleção 90° em torno do centro dela, com a rede ligada, sem abrir o comando. O giro de uma peça em torno do eixo de uma de suas portas continua no painel de propriedades.

**Alinhar por pontos** (atalho N, botão direito › Alinhar por pontos ou busca de comandos) segue o ALIGN do AutoCAD, nas duas vistas: clique o 1º ponto de origem (uma porta ou um ponto do elemento) e o destino dele; depois o 2º ponto de origem e o 2º destino. O conjunto vai da origem 1 ao destino 1 e gira até a direção origem 1 → 2 apontar, em planta, para o destino 2. O giro é só em torno do eixo vertical e não há escala (tubos e peças têm dimensões de catálogo); fora de porta, o destino 1 mantém a cota da origem, como no Mover. Linhas tracejadas numeradas ligam cada origem ao seu destino, e a prévia em fantasmas mostra o resultado antes do último clique (com o giro no painel). "Aplicar só o 1º par" apenas desloca. "Levar a rede ligada" (padrão) leva tubos e peças ligados junto; sem ela, um giro que rompa uma ligação é recusado e o alinhar continua. "Copiar" alinha uma cópia. "Ponto livre (sem ajuste à grade)" deixa os pontos exatamente onde se clica — só no alinhar, sem mexer no "Ajustar à grade" das outras ferramentas; as extremidades das peças continuam sendo capturadas, e a escolha vale até o fim da sessão. Cada Esc desfaz o último ponto; sem pontos, encerra. Um alinhamento é um passo no histórico.

**Opções de projeto** (Gerenciar › Projeto › Opções de projeto, ou o indicador "Precisão" na barra de status) reúne a precisão da modelagem e a grade de captura. Os passos de precisão — comprimento (padrão 5 cm) e ângulo (padrão 1°) — valem para o cursor: no traçado de tubos, com o trecho em andamento, a direção anda de 1° em 1° (a partir do eixo do tubo de partida, ou de +X) e o comprimento de 5 em 5 cm; ao esticar um tubo pela alça, o comprimento anda de 5 em 5 cm; no Girar, o ângulo pelo cursor anda de 1° em 1°. Saindo de uma extremidade com "Somente peças de catálogo", a direção continua restrita aos joelhos do catálogo (o comprimento segue o passo); Shift mantém a trava de 45°/90°. Valores digitados continuam exatos. São auxílios de desenho, guardados neste navegador (`state/precisionStore.ts`, cálculo em `editor/precision.ts`), não dados do projeto — como a grade. Desligados, volta o comportamento da grade.

**Seleção por janela na planta**: em Selecionar, arrastar com o botão esquerdo abre a janela (a vista se desloca com o botão direito ou o do meio). Da esquerda para a direita (traço contínuo, azul) entram os elementos inteiramente contidos; da direita para a esquerda (tracejado, verde), os tocados pela janela (cruzamento). Ctrl/Shift somam à seleção. A forma testada é a mesma desenhada na planta MEP; no Infra, o eixo dos tubos e as portas das peças (`plan/planSelection.ts`, sobre `editor/crossingSelection.ts`).

**Prévia nas duas vistas** (`state/viewPreview.ts`): a operação em andamento — traçado com tê/cruzeta, alternativa de "Alinhar e conectar", conversão — é calculada pela mesma função que a confirmação grava; a planta (`PlanPreviewLayer`) e o modelo 3D (`PreviewGhosts`) desenham os elementos criados e alterados como fantasmas (verde), o símbolo da peça de derivação, as guias (eixos das portas, projeção, encontro, ΔH/ΔV/distância; na planta, a cota de cada porta) e a recusa junto ao cursor. No 3D, rótulos `Html` montam um quadro depois da cena (montá-los no mesmo render que cria a cena faz o React desmontá-los).

Os comandos de **Modificar** e **Conectar** que dependem de valores (deslocamento, comprimento, cota, porta) levam ao campo do painel de propriedades que executa a operação; não há uma segunda implementação. O antigo diálogo "Projeto" foi dividido: configuração em **Gerenciar** (níveis, sistemas, georreferência, terreno) e resultados em **Análise** (interferências, quantitativo, perfil).

As exportações de planta funcionam de qualquer vista: o DXF é gerado do modelo (`plan/planExport.ts`); o SVG é o desenho da planta e por isso a abre antes de gerar o arquivo.

## Registro de comandos

`apps/web/src/commands/commands.ts` é a definição única de cada comando: identificador, rótulo, finalidade, ícone, atalho, `data-testid`, disponibilidade (`state`, com o motivo) e execução. Leem dele:

- a faixa de comandos e o menu Arquivo (`ui/CommandButton.tsx`);
- os atalhos de teclado (`commands/useCommands.ts`);
- a busca de comandos (`ui/CommandPalette.tsx`, Ctrl+K), que mostra onde o comando fica e por que está indisponível;
- o diálogo de exportação (`ui/ExportDialog.tsx`), com conteúdo, opções e requisitos de cada saída.

Regras:

- Comando novo entra no registro; a barra de ferramentas (`RIBBON`, em `ui/ToolBar.tsx`) só diz em que aba e grupo ele aparece, se é principal ou secundário (`compact`) e se entra em um botão com seta (`menu`). O botão com seta mostra o símbolo do comando em uso e a busca de comandos informa o caminho completo (ex.: Modelagem › Criar › Conexões).
- A disponibilidade é uma função pura do contexto (`CommandContext`), testada em `commands.test.ts`. Botão, atalho e busca aplicam a mesma regra; um comando indisponível explica o motivo na dica.
- Recurso não implementado tem `phase` e aparece desabilitado com a fase do roadmap (regra 11 do `AGENTS.md`).
- Atalhos não disparam com o foco em campos, menus ou diálogos, exceto os globais (Ctrl+S e Ctrl+K).

Uma mesma configuração tem um só controle e uma só fonte de estado (a store do editor). Controles de configuração (escala, tema, mapa) não se repetem em abas diferentes; comandos podem aparecer em mais de um lugar (por exemplo, IFC em Exportação e em BIM / IFC), sempre a partir do mesmo registro.

## Estado da interface

`apps/web/src/state/uiStore.ts` guarda o que não é dado de engenharia: aba de tarefa, aba do painel direito, diálogos abertos, lista de pendências, vista maximizada e as preferências de layout (barra recolhida, painéis abertos, larguras, disposição das vistas e proporção do divisor). As preferências são gravadas no navegador (`localStorage`, chave `hydrobim.layout.v1`), separadas do projeto. Nada disso passa pela store do editor, pelo histórico ou pelo arquivo do projeto.

## Preparação para novas disciplinas

Ferramentas de arquitetura (paredes, pisos, telhados) não existem. A organização as comporta sem mudança de estrutura: novos comandos entram no registro e ganham um grupo em Modelagem › Criar (ou uma aba própria em `TASKS`), e o navegador já agrupa por sistema e nível.

## Testes

- Unitários: `apps/web/src/commands/commands.test.ts` (registro, atalhos, disponibilidade) e `apps/web/src/state/uiStore.test.ts` (abas, suspensão da modelagem na consulta BIM, preferências).
- E2E: `tests/e2e/workbench.spec.ts` (disposição padrão: vistas lado a lado, vista ativa, divisor, maximizar, traçado que começa na planta e continua no 3D; barra de ferramentas e botões com seta; navegador em árvore; referências e barra de status; 1366 × 768 e 1920 × 1080 com painéis abertos, redimensionados e recolhidos). Os demais fluxos partem de uma vista por vez, fixada como preferência em `playwright.config.ts`.
- Percurso: `apps/web/src/walk/walkMotion.test.ts` (teclas, deslocamento, altura da vista, apoio no terreno) e `tests/e2e/walk.spec.ts` (W A S D, E e Q, terreno em rampa, clique → propriedades IFC, no navegador real).
- E2E: `tests/e2e/layout.spec.ts` (independência entre tarefa, vista e ambiente; painéis; menu Arquivo; busca; teclado; exportações pelos novos acessos; 1366 × 768). Os demais testes usam `tests/e2e/ui.ts` (`ctl`, `openTask`, `openProjectTab`) para abrir a aba, o menu ou o painel que contém cada controle.

## Limites conhecidos

- A consulta BIM / IFC só existe sobre o Modelo 3D; entrar nela reenquadra a vista.
- Percurso: não há colisão com os elementos nem gravidade (o observador atravessa peças e não cai ao sair do terreno); a posição não é guardada entre uma abertura e outra; não há medição nem corte na vista. As sombras cobrem 60 m em torno do observador.
- O perfil longitudinal ainda é diálogo.
- A ferramenta de tubo não tem escolha de sistema para o próximo elemento: o sistema é atribuído depois, nas propriedades.
- O inspetor de anotações da planta continua sobre o desenho, não no painel direito.
- Não há personalização de atalhos, de abas ou de grupos, nem painéis flutuantes.
- A visibilidade é por sistema (`system.visible`): o modelo não guarda visibilidade por elemento nem por categoria, e por isso a árvore não oferece esse controle fora da linha do sistema.
- Das capturas de referência, só a grade se liga e desliga. Extremidades e ponto sobre o tubo são sempre ativas; ponto médio, perpendicular e alinhamento têm o núcleo pronto (`editor/referenceSnaps.ts`) e aparecem como previstos até serem ligados às vistas.
- Lado a lado, cada vista move a origem de desenho para o seu ponto de interesse; em redes extensas com as duas vistas em regiões distantes a precisão do desenho é a da vista navegada por último.
- Validado em 1366 × 768, 1440 × 900 e 1920 × 1080. Em 1366 px, no ambiente Infra, a aba Visualizar com terreno e mapa quebra em duas linhas; abaixo de 1100 px todas as abas podem quebrar.
