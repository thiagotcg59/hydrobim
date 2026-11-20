# Interface do editor

Organização da tela, distribuição dos comandos e regras de comportamento. A interface não contém regras de modelagem: lê o projeto e chama operações do domínio por meio da store.

## Três conceitos separados

| Conceito | Valores | Onde se escolhe | O que muda |
| --- | --- | --- | --- |
| **Ambiente** | MEP, Infra | Seletor "Ambiente", no cabeçalho | A disciplina do projeto (especificação e grade padrão, planta própria). É uma alteração do projeto, com desfazer. |
| **Tarefa** | Modelagem, Documentação, Visualizar, Análise, BIM / IFC, Exportação, Gerenciar | Abas da faixa de comandos | Só os comandos à mostra. |
| **Vista** | Modelo 3D, Planta MEP ou Planta Infra | Abas sobre a área de desenho (e navegador do projeto) | O que é desenhado. |

Trocar de aba de tarefa não altera o ambiente, o modelo, a vista nem a operação em andamento, não marca o projeto como alterado e não entra no histórico. Trocar de vista mantém a ferramenta de modelagem, o trecho em andamento, a medição, a seleção e o ponto observado; as ferramentas de documentação só existem na planta e são encerradas ao ir para o modelo 3D.

**Exceção declarada — consulta BIM / IFC.** A aba BIM / IFC abre um modo de consulta e cadastro sobre o Modelo 3D, sem modelagem. Ao entrar, a ferramenta e o trecho em andamento ficam **suspensos**; ao sair (por outra aba de tarefa ou pela troca de vista) a vista anterior, a aba anterior e a operação suspensa são retomadas, desde que o ponto de partida ainda exista no modelo. Enquanto a consulta está aberta, ferramentas de criação e Excluir ficam indisponíveis — pelos botões, pelos atalhos e pela busca — com o motivo informado.

**Perfil longitudinal.** Ainda é um diálogo de análise, não uma vista: o botão "Perfil…" junto das abas de vista (ambiente Infra) e o comando de Análise abrem o mesmo diálogo. Só vira vista quando o conteúdo for adaptado (roadmap, Fase 5).

**Operações do terreno.** Área, furo, corte e consulta de cota não são ferramentas da store do editor: são um modo de sessão (`terrain/terrainStore.ts`) que recebe os cliques da Planta Infra enquanto a ferramenta é Selecionar. Escolher uma ferramenta de modelagem ou sair da planta encerra a operação. Enter conclui, Backspace desfaz o último ponto e Esc cancela. O painel "Superfície do terreno" e o perfil do corte são painéis sobre a planta; a superfície gerada vai para o projeto, com desfazer — a área em edição, o corte e as opções de visualização não entram no projeto nem no histórico.
## Regiões da tela

```
┌ HydroBIM │ Arquivo ▾ │ Nome do projeto · salvo │ salvar desfazer refazer │ Ambiente [MEP|Infra] ┐
├ Modelagem │ Documentação │ Visualizar │ Análise │ BIM / IFC │ Exportação │ Gerenciar │ buscar ⌃ ┤
│ grupos de comandos da tarefa                                                                    │
├────────────┬──────────────────────────────────────────────────────────┬────────────────────────┤
│ Navegador  │ [Modelo 3D] [Planta] [Perfil…]          navegação da vista│ Ferramenta│Propriedades│
│  Vistas    │                                                          │  seções recolhíveis    │
│  Níveis    │                    área de desenho                       │                        │
│  Sistemas  │                                                          │                        │
│  └ elementos                                                          │                        │
├────────────┴──────────────────────────────────────────────────────────┴────────────────────────┤
│ instrução da operação │ X Y Z │ cota de desenho │ captura │ grade │ mensagem │ pendências        │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Região | Componente | Conteúdo |
| --- | --- | --- |
| Cabeçalho | `ui/TopBar.tsx` | Identidade, menu Arquivo, nome e estado de salvamento, acesso rápido (salvar, desfazer, refazer), ambiente. |
| Faixa de comandos | `ui/ToolBar.tsx` | Abas de tarefa, grupos, busca de comandos, botão de recolher (ou duplo clique na aba). |
| Navegador do projeto | `ui/ProjectBrowser.tsx` (na consulta BIM: `bim/BimTree.tsx`) | Vistas, níveis (plano de trabalho), sistemas com visibilidade e seleção, elementos com busca. |
| Área central | `ui/ViewTabs.tsx` + `viewport/Viewport.tsx` ou `plan/PlanView.tsx` | Abas de vista em posição fixa e controles de navegação (enquadrar, topo, elevação, perspectiva, isométrica, ortográfica). |
| Painel direito | `App.tsx` (`RightPanel`), `ui/ToolOptions.tsx`, `ui/PropertiesPanel.tsx`, `bim/IfcPanel.tsx` | Aba **Ferramenta**: parâmetros do próximo elemento. Aba **Propriedades**: elementos já selecionados (única, múltipla ou nenhuma). |
| Barra de status | `ui/StatusBar.tsx` | Instrução da operação, coordenadas, cota de desenho, captura, grade, restrição de catálogo, mensagens e pendências. |
| Molduras dos painéis | `ui/SidePanel.tsx` | Recolher para uma régua e redimensionar pela borda (arrastar ou setas). |

Os painéis laterais e a faixa são recolhíveis; as larguras são ajustáveis (navegador 180–420 px, propriedades 280–560 px). **Restaurar layout** (Visualizar › Painéis e Gerenciar › Preferências) volta ao padrão. Em telas estreitas os botões compactam e a faixa quebra em linhas, sem esconder comandos.

## Distribuição dos comandos

| Onde | Grupos e comandos |
| --- | --- |
| **Menu Arquivo** | Novo projeto · Abrir projeto (salvos no navegador, arquivo, demonstração) · recentes · Salvar no navegador · Baixar arquivo `.hydrobim.json`. O menu explica a diferença: salvar guarda só neste navegador; baixar gera um arquivo do usuário. |
| **Modelagem** | Geral: Selecionar, Medir · Criar: Tubulação, Joelho, Tê, Redução, Válvula, Bomba, Reservatório · Modificar: Mover, Copiar, Excluir, Comprimento, Elevação, Girar · Conectar: Tubo da extremidade, Ligar extremidades, Desconectar · Catálogo · Terreno (só no Infra): Superfície do terreno, Área do terreno, Corte do terreno, Consultar cota |
| **Documentação** | Anotar na planta: Cota, Texto, Chamada, Etiqueta · Escala e cotas: escala de documentação do ambiente, tipo de cota · Previstos (desabilitados, com a fase): Pranchas, Cotas de nível |
| **Visualizar** | Câmera: Perspectiva, Isométrica, Ortográfica, Topo, Elevação · Enquadrar: Projeto, Seleção · Aparência da planta: tema, linhas finas · Mapa e camadas e Localização (só no Infra): fundo, imagem, opacidade, camadas, rótulos, fonte própria, ir para, georreferência · Terreno (só no Infra): cor, curvas de nível e intervalo, triangulação, escala vertical (1:1 por padrão) · Painéis |
| **Análise** | Verificação: Pendências, Interferências · Quantitativos · Perfil e recobrimento · Medição · Terreno (só no Infra): Corte do terreno, Consultar cota |
| **BIM / IFC** | Modelo de informação (esquema, contagens, conformidade) · Visibilidade: Isolar e Ocultar seleção · Classificação da biblioteca · Entrega: IFC, IDS |
| **Exportação** | Modelo: IFC 4.3, DXF do modelo 3D · Planta: DXF e SVG · Dados: CSV, INP, IDS · Conteúdo e requisitos de cada saída |
| **Gerenciar** | Projeto: Níveis, Sistemas · Famílias e catálogo · Local: Georreferência, Terreno · Preferências da interface |

Os comandos de **Modificar** e **Conectar** que dependem de valores (deslocamento, comprimento, cota, porta) levam ao campo do painel de propriedades que executa a operação; não há uma segunda implementação. O antigo diálogo "Projeto" foi dividido: configuração em **Gerenciar** (níveis, sistemas, georreferência, terreno) e resultados em **Análise** (interferências, quantitativo, perfil).

As exportações de planta funcionam de qualquer vista: o DXF é gerado do modelo (`plan/planExport.ts`); o SVG é o desenho da planta e por isso a abre antes de gerar o arquivo.

## Registro de comandos

`apps/web/src/commands/commands.ts` é a definição única de cada comando: identificador, rótulo, finalidade, ícone, atalho, `data-testid`, disponibilidade (`state`, com o motivo) e execução. Leem dele:

- a faixa de comandos e o menu Arquivo (`ui/CommandButton.tsx`);
- os atalhos de teclado (`commands/useCommands.ts`);
- a busca de comandos (`ui/CommandPalette.tsx`, Ctrl+K), que mostra onde o comando fica e por que está indisponível;
- o diálogo de exportação (`ui/ExportDialog.tsx`), com conteúdo, opções e requisitos de cada saída.

Regras:

- Comando novo entra no registro; a faixa (`RIBBON`, em `ui/ToolBar.tsx`) só diz em que aba e grupo ele aparece.
- A disponibilidade é uma função pura do contexto (`CommandContext`), testada em `commands.test.ts`. Botão, atalho e busca aplicam a mesma regra; um comando indisponível explica o motivo na dica.
- Recurso não implementado tem `phase` e aparece desabilitado com a fase do roadmap (regra 11 do `AGENTS.md`).
- Atalhos não disparam com o foco em campos, menus ou diálogos, exceto os globais (Ctrl+S e Ctrl+K).

Uma mesma configuração tem um só controle e uma só fonte de estado (a store do editor). Controles de configuração (escala, tema, mapa) não se repetem em abas diferentes; comandos podem aparecer em mais de um lugar (por exemplo, IFC em Exportação e em BIM / IFC), sempre a partir do mesmo registro.

## Estado da interface

`apps/web/src/state/uiStore.ts` guarda o que não é dado de engenharia: aba de tarefa, aba do painel direito, diálogos abertos, lista de pendências e as preferências de layout (faixa recolhida, painéis abertos, larguras). As preferências são gravadas no navegador (`localStorage`, chave `hydrobim.layout.v1`), separadas do projeto. Nada disso passa pela store do editor, pelo histórico ou pelo arquivo do projeto.

## Preparação para novas disciplinas

Ferramentas de arquitetura (paredes, pisos, telhados) não existem. A organização as comporta sem mudança de estrutura: novos comandos entram no registro e ganham um grupo em Modelagem › Criar (ou uma aba própria em `TASKS`), e o navegador já agrupa por sistema e nível.

## Testes

- Unitários: `apps/web/src/commands/commands.test.ts` (registro, atalhos, disponibilidade) e `apps/web/src/state/uiStore.test.ts` (abas, suspensão da modelagem na consulta BIM, preferências).
- E2E: `tests/e2e/layout.spec.ts` (independência entre tarefa, vista e ambiente; painéis; menu Arquivo; busca; teclado; exportações pelos novos acessos; 1366 × 768). Os demais testes usam `tests/e2e/ui.ts` (`ctl`, `openTask`, `openProjectTab`) para abrir a aba, o menu ou o painel que contém cada controle.

## Limites conhecidos

- A consulta BIM / IFC só existe sobre o Modelo 3D; entrar nela reenquadra a vista.
- O perfil longitudinal ainda é diálogo.
- A ferramenta de tubo não tem escolha de sistema para o próximo elemento: o sistema é atribuído depois, nas propriedades.
- O inspetor de anotações da planta continua sobre o desenho, não no painel direito.
- Não há personalização de atalhos, de abas ou de grupos, nem painéis flutuantes.
- Validado em 1366 × 768, 1440 × 900 e 1920 × 1080; abaixo de 1100 px a faixa quebra em mais de uma linha.
