# Realidade virtual (WebXR)

Visualização imersiva do modelo do HydroBIM no navegador de um headset, pela WebXR Device API. É uma **vista de inspeção em leitura**: mostra o mesmo projeto aberto no editor, em escala real, e não altera parâmetros nem conectividade. Não há aplicativo separado, APK, Unity nem serviço externo — é o próprio editor, na mesma página.

Dispositivo de referência: **Meta Quest 2**, no navegador do headset, pela versão publicada em <https://thiagotcg59.github.io/hydrobim/>.

> **Estado da validação.** O módulo tem testes unitários e testes no navegador com um dispositivo WebXR **simulado**. **Ainda não foi testado em um headset físico.** Conforto, legibilidade, rastreamento, mapeamento real dos controles e taxa de quadros só se confirmam no aparelho: siga o [roteiro de teste físico](#roteiro-de-teste-no-meta-quest-2) e registre o resultado.

## Como acessar

1. Abra o projeto no editor (pelo navegador do headset ou no computador).
2. Aba **Visualizar** › grupo **VR** › **Entrar em VR** (o botão com o símbolo de óculos; também pela busca de comandos, Ctrl+K, "Entrar em VR").
3. A área de desenho dá lugar à vista **Realidade virtual**, com a prévia do ponto de partida. Em um navegador com WebXR e headset, o mesmo clique já pede a sessão imersiva; o navegador pode pedir permissão na primeira vez.
4. Para sair: **Sair do VR** no menu da sessão, o botão do sistema do headset, **Encerrar a sessão** ou **Voltar ao editor** na barra da vista.

Em navegador sem WebXR, sem headset ou fora de HTTPS, a vista informa o motivo, o botão de entrada fica indisponível e o editor segue normal — "Voltar ao editor" reabre o viewport convencional.

### Controles (Meta Quest Touch)

| Controle | Ação |
| --- | --- |
| Direcional para a frente (qualquer mão) | Mira o teletransporte: arco e marcador verdes (destino aceito) ou vermelhos (recusado). Soltar confirma; puxar para trás desiste. |
| Direcional para os lados | Giro de 30° por toque. Não há locomoção contínua. |
| Gatilho | Seleciona o elemento apontado pelo raio (abre o painel de propriedades) ou aciona um botão de painel. Apontando para o vazio, limpa a seleção. |
| A / B (direita), X / Y (esquerda) ou aperto lateral | Abre e fecha o menu, diante do usuário. |

**Menu**: Ponto inicial · Recentrar (vira o modelo para a frente do olhar, sem sair do lugar) · mostrar/ocultar por categoria (só as que existem no projeto) · Terreno (quando há superfície) · Piso virtual por nível (quando o projeto não tem terreno nem pisos) · Informações do projeto (com triângulos, chamadas de desenho e quadros por segundo) · Sair do VR.

**Painel de propriedades**: categoria, identificação, diâmetro (DN e designação), material, norma, classe, comprimento (tubos), cota, sistema e fabricante — lidos do elemento do projeto no momento da consulta, só os campos que ele tem. O elemento consultado fica selecionado também no editor.

## Arquitetura

Tudo em `apps/web/src/vr/`. Só `VRView.tsx` conhece React e a cena; o resto são funções puras ou módulos sem interface, testados em Node.

| Arquivo | Responsabilidade |
| --- | --- |
| `vrCoordinates.ts` | Conversão Z para cima → Y para cima e posição do modelo em volta do usuário (âncora, giro, piso): teletransporte, giro por etapas, ponto inicial, recentrar. |
| `vrSession.ts` | Detecção de compatibilidade, pedido da sessão `immersive-vr`, ligação ao renderizador (`local-floor` com alternativa `local`), mensagens. |
| `vrStore.ts` | Estado da sessão (Zustand): vista aberta, suporte, fase, sessão pendente, leitura. Entrar, sair, fechar. Fora do projeto e do histórico. |
| `vrModel.ts` | Adaptador de cena: a rede em lotes (`BatchedMesh`), com identidade por parte, visibilidade por categoria e destaque da seleção. |
| `vrWalkable.ts` | Superfícies caminháveis, arco e destino do teletransporte, ponto de partida. |
| `vrInput.ts` | Direcional e botões (`xr-standard`) → ações discretas. |
| `vrInfo.ts` | Linhas do painel de propriedades, lidas do projeto. |
| `vrPanel.ts` | Painéis flutuantes: layout, acerto do raio e desenho em canvas 2D. |
| `vrPerformance.ts` | Qualidade da sessão (resolução, foveação, taxa de quadros) e medidor de quadros. |
| `VRView.tsx` | A vista: `Canvas`, cena, controles, laço de quadros, barra de estado. |

### Renderizador e ciclo de vida

- A vista segue o precedente do Percurso (`walk/WalkView.tsx`): um `Canvas` do React Three Fiber próprio, montado no lugar da área de desenho. **Enquanto ela está aberta o Modelo 3D convencional fica desmontado** — há um só renderizador em uso — e volta, com a câmera que tinha, ao sair. Reaproveitar o `Canvas` do editor exigiria retirar dele a órbita, os rótulos HTML, o gizmo e a origem de desenho durante a sessão; a vista própria isola tudo isso sem tocar no viewport de modelagem.
- O mesmo renderizador serve a prévia no monitor e a sessão: `renderer.xr.setSession` liga a sessão, e o React Three Fiber troca o laço para `renderer.xr.setAnimationLoop` ao receber `sessionstart` (e de volta em `sessionend`). Não há laço nem renderizador duplicado.
- A sessão é pedida **no clique** do comando (os navegadores só a concedem a um gesto do usuário) e entregue à vista quando a cena termina de montar. Os controles anunciados nesse intervalo são reanunciados ao ligar a sessão (`announceInputSources`).
- Desmontar a vista encerra a sessão, remove os controles da cena e libera geometrias, materiais e texturas (`VrModel.dispose`, painéis, arco, marcador).

### Coordenadas, escala e origem local

- O projeto usa Z para cima; a WebXR, Y para cima com −Z à frente. A conversão é um giro de −90° em torno de X: **(X, Y, Z) → (X, Z, −Y)**. É uma rotação própria (sem espelhamento), sem escala: 1 m do modelo é 1 m no espaço físico. O leste continua à direita, o norte fica à frente.
- **Quem se move é a cena, não o usuário nem o modelo.** O espaço de referência da sessão (`local-floor`, origem no piso físico) fica parado; a cena é posta em volta dele por três grupos: giro em torno da vertical, eixo vertical e translação por `−âncora`. Teletransportar é escolher a âncora que leva o destino para baixo da cabeça — o deslocamento físico dentro da área rastreada é preservado, e a altura é a real do headset, sem acréscimo.
- **Coordenadas grandes (UTM)**: a âncora é subtraída em precisão dupla antes de as matrizes irem para a placa de vídeo. A rede em lotes guarda as posições em relação a uma origem local (`nextRenderOrigin`, a mesma regra das outras vistas: múltiplos de 1 km, trocada a mais de 5 km), e a cena é refeita em torno do novo ponto quando o usuário se afasta.
- Sem `local-floor`, a sessão usa `local` (origem na cabeça) e o piso é posto 1,60 m abaixo — a barra da vista avisa "piso estimado".
- Nada disso chega ao projeto: persistência, IFC e DXF continuam nas coordenadas originais.

### Superfícies caminháveis

Só é piso o que o modelo declara como piso: a **superfície do terreno** à mostra (natural ou projetada) e as **lajes e pisos** da arquitetura (face superior, dentro do contorno e fora das aberturas). O topo de um reservatório ou de um flange não é piso. Projeto sem terreno nem pisos recebe um **piso virtual** (grade de 1 m) na cota de apoio do modelo ou na de um nível escolhido no menu — não entra no projeto.

O destino é recusado quando o arco não chega a uma superfície, quando o terreno tem mais de 35° de declividade no ponto ou quando há um elemento do modelo no caminho do arco.

### Desempenho

- **Lotes**: as partes de todos os elementos com o mesmo acabamento vão em um `BatchedMesh` (cor e posição por parte). A rede inteira sai em poucas chamadas de desenho — 2 no exemplo do barrilete, contra uma por parte no viewport de modelagem —, com descarte por parte fora do campo de visão. Malhas idênticas são guardadas uma vez.
- Sem sombras dinâmicas nem pós-processamento; iluminação por hemisfério, uma direcional e o ambiente procedural (sem arquivos).
- Resolução de renderização nativa e foveação fixa máxima; acima de 350 mil triângulos, ou se a sessão anterior ficou abaixo de 65 quadros/s, a resolução cai (85 %, depois 70 %) e a rede passa a sombreamento difuso. Pede 72 Hz quando o dispositivo deixa escolher.
- A geometria é a de `buildElementGeometry`, sem simplificação: os dados de engenharia não mudam, e a imagem é a mesma do Modelo 3D.

Esses limites são pontos de partida conservadores, **não medições** — ver o roteiro abaixo.

## Publicação (GitHub Pages)

Nada muda no deploy: o módulo é parte do pacote do editor, sem rota nova, sem arquivos externos e sem backend. O fluxo `.github/workflows/pages.yml` compila com `--base=/hydrobim/` e publica a `main`; a página é servida em HTTPS, que a WebXR exige. Os modelos dos controles são formas simples desenhadas pelo próprio editor (nenhum arquivo é buscado em CDN).

Para publicar: pull request da branch de trabalho para `develop` e de `develop` para `main`; o push na `main` dispara a publicação.

Teste local no headset (antes de publicar): a WebXR exige contexto seguro, e `http://<ip-do-computador>:5180` não é. Use o encaminhamento de porta do `adb` (`adb reverse tcp:5180 tcp:5180`, com o headset em modo desenvolvedor e ligado por USB) e abra `http://localhost:5180` no navegador do Quest.

## Testes

Automatizados (rodam sem headset):

- `apps/web/src/vr/vrCoordinates.test.ts` — conversão de eixos e inversa, escala, ausência de espelhamento, coincidência com a cadeia de grupos da cena, ida e volta em coordenadas UTM, teletransporte, giro, ponto inicial.
- `apps/web/src/vr/vrSession.test.ts` — detecção (sem WebXR, sem VR, sem HTTPS, consulta recusada), pedido e ligação da sessão com objetos simulados, alternativa sem piso rastreado, entrada, saída, sessão pendente, recusa, falha ao ligar e limpeza.
- `apps/web/src/vr/vrScene.test.ts` — cena de todos os projetos de demonstração, lotes, identidade de cada elemento pelo raio, escala e posições, origem local, visibilidade por categoria, destaque, liberação de recursos; propriedades; superfícies e teletransporte; controles; painéis; qualidade.
- `tests/e2e/vr.spec.ts` (Chromium) — navegador sem dispositivo e sem WebXR (mensagem, editor intacto); sessão com o dispositivo simulado de `tests/e2e/fakeXr.ts`: entrar, laço de quadros, teletransporte, giro, seleção, menu, saída pelo dispositivo e pelo botão, reentrada, piso estimado, sem erros de console.

O dispositivo simulado implementa a parte da WebXR que o Three.js usa e desenha os dois olhos lado a lado no canvas. Ele prova que o código da sessão executa; **não** prova nada sobre o headset. A extensão Immersive Web Emulator (Meta) pode ser usada no Chrome do computador para um ensaio manual das interações.

### Roteiro de teste no Meta Quest 2

Registre data, versão do sistema e do navegador do headset, projeto usado e o resultado de cada item.

1. Abrir <https://thiagotcg59.github.io/hydrobim/> no navegador do Quest; o editor carrega e o projeto de demonstração aparece.
2. Visualizar › Entrar em VR: o navegador oferece a sessão e ela começa (a barra mostraria "piso estimado" se o piso não fosse rastreado — não é o esperado no Quest).
3. Escala: comparar um tubo de diâmetro conhecido e uma altura conhecida (um nível, um reservatório) com o corpo; o piso do modelo coincide com o piso físico.
4. Orientação: tubos verticais na vertical; o que está ao norte na planta fica à frente ao entrar; nada espelhado (conferir uma derivação à direita na planta).
5. Teletransporte com cada mão: arco, marcador, destino aceito e recusado (apontar para o céu; em projeto com terreno, para um talude íngreme; para trás de uma peça).
6. Giro de 30° para os dois lados; andar fisicamente um passo e teletransportar (o destino fica sob os pés, não sob o centro da sala).
7. Seleção: apontar para tubo, conexão, válvula, bomba e reservatório; o painel mostra os dados do elemento certo e é legível sem esforço.
8. Menu: abrir e fechar; ponto inicial; recentrar; ocultar e mostrar cada categoria; terreno (projeto Infra); informações do projeto.
9. Desempenho: anotar os quadros por segundo do menu (meta: 72) no barrilete, na edificação e em um projeto Infra com terreno; observar engasgos ao olhar em volta.
10. Sair pelo menu, pelo botão do sistema e por "Voltar ao editor"; o editor responde e o Modelo 3D reabre; entrar de novo.
11. Projeto Infra georreferenciado (coordenadas UTM): a geometria não treme ao aproximar a cabeça de uma peça.

## Limitações conhecidas

- **Sem validação em headset físico** até o roteiro acima ser executado.
- Só leitura: não edita, não mede, não corta. As anotações, cotas e vistas salvas não aparecem.
- O botão da faixa mostra só o símbolo (a aba Visualizar tem de caber em uma linha a 1920 px); o nome está na dica e na busca de comandos.
- Geometria sem níveis de detalhe: redes com muitas peças flangeadas (furação desenhada) podem passar do orçamento do Quest 2. O terreno é desenhado inteiro, com a malha do projeto, e o mapa sobre ele continua sendo baixado se estiver ligado.
- Sem colisão: o usuário pode atravessar peças andando fisicamente. O obstáculo só é verificado no arco do teletransporte, não no ponto de chegada.
- O giro "Recentrar" aponta para o centro do modelo; não há pontos de visita salvos.
- Com exagero vertical do terreno ligado, o usuário anda sobre a superfície como desenhada, e a rede deixa de coincidir com ela (como no Modelo 3D).
- Controles: formas simples, sem o modelo do fabricante; rastreamento de mãos não é usado.
- Alterar o projeto com a vista aberta (desfazer, comandos pela faixa) refaz a cena inteira.

## Próxima versão

1. Executar o roteiro no Quest 2 e ajustar os limites de desempenho e o conforto com as medições.
2. Níveis de detalhe por distância e simplificação visual das peças detalhadas; terreno por região visível.
3. Medição entre dois pontos e leitura de cota no raio; pontos de visita salvos no projeto; mapa de localização no pulso.
4. Colisão e verificação do ponto de chegada; realidade mista (passthrough) no Quest 3, para sobrepor o projeto ao local.
5. Propriedades IFC completas no painel (as da aba BIM / IFC).
